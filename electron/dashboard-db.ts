import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3')

export type UnifiedCourse = {
  courseKey: string
  courseCode: string
  courseName: string
  semesterLabel: string
  semesterTechnion: string
  credits: number | null
  grade: string | null
  moodleCourseId: number | null
  hasMoodle: boolean
  hasStudents: boolean
  updatedAt: string
}

export type StudentsExam = {
  courseCode: string
  courseName: string
  examSession: string
  date: string
  time: string
  duration: string
  venue: string
}

type MoodleCourseInput = {
  id: number
  fullname: string
  shortname: string
  semesterLabel?: string
}

type StudentsCourseInput = {
  code: string
  name: string
  credits: number
  grade: string | null
  semesterLabel: string
  semesterTechnion: string
}

type SyncDelta = {
  inserted: number
  updated: number
}

type AcademicTerm = 'Fall' | 'Winter' | 'Spring' | 'Summer'

export class DashboardDb {
  private db: import('better-sqlite3').Database

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.initSchema()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS unified_courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_key TEXT NOT NULL UNIQUE,
        course_code TEXT NOT NULL,
        course_name TEXT NOT NULL,
        semester_label TEXT DEFAULT '',
        semester_technion TEXT DEFAULT '',
        credits REAL,
        course_grade TEXT,
        moodle_course_id INTEGER,
        has_moodle INTEGER NOT NULL DEFAULT 0,
        has_students INTEGER NOT NULL DEFAULT 0,
        moodle_shortname TEXT DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS students_exams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        semester_technion TEXT NOT NULL,
        course_code TEXT NOT NULL,
        course_name TEXT NOT NULL,
        exam_session TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        duration TEXT NOT NULL,
        venue TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS moodle_credentials (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    this.ensureUnifiedCoursesColumns()
  }

  private ensureUnifiedCoursesColumns() {
    const columns = this.db.prepare(`PRAGMA table_info('unified_courses')`).all() as Array<{ name: string }>
    const hasCourseGrade = columns.some((col) => col.name === 'course_grade')
    if (!hasCourseGrade) {
      this.db.exec('ALTER TABLE unified_courses ADD COLUMN course_grade TEXT')
    }
  }

  private nowIso() {
    return new Date().toISOString()
  }

  private normalizeCourseCode(name: string) {
    const hit = name.match(/\b\d{5,6}\b/)
    return hit?.[0] ?? ''
  }

  private toCourseKey(courseCode: string, fallback: string) {
    return courseCode || fallback.trim().toLowerCase()
  }

  private toYear(text: string) {
    if (text.length === 4) return Number.parseInt(text, 10)
    const yy = Number.parseInt(text, 10)
    return yy >= 70 ? 1900 + yy : 2000 + yy
  }

  private academicYearStart(term: AcademicTerm, calendarYear: number) {
    return term === 'Fall' ? calendarYear : calendarYear - 1
  }

  private parseAcademicTerm(...values: Array<string | undefined | null>) {
    const termMap: Record<string, AcademicTerm> = {
      fall: 'Fall',
      autumn: 'Fall',
      winter: 'Winter',
      spring: 'Spring',
      sping: 'Spring',
      summer: 'Summer',
    }
    for (const value of values) {
      const raw = (value || '').trim()
      if (!raw) continue

      const academicYearHit = raw.match(/(20\d{2})\s*[-/]\s*(?:20)?(\d{2})\s*[-/ ]*\s*(spring|sping|summer|fall|autumn|winter)\b/i)
      if (academicYearHit) {
        const startYear = Number.parseInt(academicYearHit[1], 10)
        const term = termMap[academicYearHit[3].toLowerCase()]
        return { key: `${startYear}-${term}`, startYear, term }
      }

      const termFirst = raw.match(/\b(spring|sping|summer|fall|autumn|winter)\s*[-/ ]*\s*(\d{2,4})\b/i)
      if (termFirst) {
        const term = termMap[termFirst[1].toLowerCase()]
        const startYear = this.academicYearStart(term, this.toYear(termFirst[2]))
        return { key: `${startYear}-${term}`, startYear, term }
      }

      const yearFirst = raw.match(/\b(\d{2,4})\s*[-/ ]*\s*(spring|sping|summer|fall|autumn|winter)\b/i)
      if (yearFirst) {
        const term = termMap[yearFirst[2].toLowerCase()]
        const startYear = this.academicYearStart(term, this.toYear(yearFirst[1]))
        return { key: `${startYear}-${term}`, startYear, term }
      }

      const techHit = raw.match(/(20\d{2})\D*(20\d{2})\D*([1234])/)
      if (techHit) {
        const startYear = Number.parseInt(techHit[1], 10)
        const term: AcademicTerm = techHit[3] === '2'
          ? 'Spring'
          : techHit[3] === '3'
            ? 'Summer'
            : techHit[3] === '4'
              ? 'Winter'
              : 'Fall'
        return { key: `${startYear}-${term}`, startYear, term }
      }
    }
    return null
  }

  private parseDisplayTerm(course: {
    semesterTechnion: string
    semesterLabel: string
    courseName: string
  }) {
    return this.parseAcademicTerm(course.courseName, course.semesterLabel, course.semesterTechnion)
  }

  private academicTermLabel(term: { startYear: number; term: AcademicTerm }) {
    const calendarYear = term.term === 'Fall' ? term.startYear : term.startYear + 1
    return `${String(calendarYear).slice(-2)} ${term.term}`
  }

  private cleanMoodleCourseName(name: string) {
    return name
      .replace(/^\s*\d{5,6}\s*[-:]\s*/i, '')
      .replace(/\s*[-–—]\s*(spring|sping|summer|fall|autumn|winter)\s+\d{2,4}\s*$/i, '')
      .replace(/\s*[-–—]\s*\d{2,4}\s+(spring|sping|summer|fall|autumn|winter)\s*$/i, '')
      .trim()
  }

  private toUnifiedCourseKey(courseCode: string, fallback: string, ...termValues: Array<string | undefined | null>) {
    const baseKey = this.toCourseKey(courseCode, fallback)
    const term = this.parseAcademicTerm(...termValues)
    return term ? `${baseKey}__${term.key}` : baseKey
  }

  upsertMoodleCourses(courses: MoodleCourseInput[]): SyncDelta {
    const now = this.nowIso()
    const queryByKey = this.db.prepare(`
      SELECT
        course_code as courseCode,
        course_name as courseName,
        semester_label as semesterLabel,
        moodle_course_id as moodleCourseId,
        has_moodle as hasMoodle,
        moodle_shortname as moodleShortname
      FROM unified_courses
      WHERE course_key = ?
    `)
    const stmt = this.db.prepare(`
      INSERT INTO unified_courses (
        course_key, course_code, course_name, semester_label, moodle_course_id,
        has_moodle, has_students, moodle_shortname, updated_at
      ) VALUES (
        @courseKey, @courseCode, @courseName, @semesterLabel, @moodleCourseId,
        1, 0, @moodleShortname, @updatedAt
      )
      ON CONFLICT(course_key) DO UPDATE SET
        course_code = excluded.course_code,
        course_name = excluded.course_name,
        semester_label = CASE
          WHEN excluded.semester_label <> '' THEN excluded.semester_label
          ELSE unified_courses.semester_label
        END,
        moodle_course_id = excluded.moodle_course_id,
        has_moodle = 1,
        moodle_shortname = excluded.moodle_shortname,
        updated_at = excluded.updated_at
    `)

    const tx = this.db.transaction(() => {
      let inserted = 0
      let updated = 0
      for (const course of courses) {
        const code = this.normalizeCourseCode(course.shortname || course.fullname)
        const key = this.toUnifiedCourseKey(code, course.fullname, course.semesterLabel, course.fullname, course.shortname)
        const existing = queryByKey.get(key) as
          | {
              courseCode: string
              courseName: string
              semesterLabel: string
              moodleCourseId: number | null
              hasMoodle: 0 | 1
              moodleShortname: string
            }
          | undefined
        const nextSemesterLabel = course.semesterLabel || existing?.semesterLabel || ''
        if (!existing) {
          inserted += 1
        } else {
          const changed = existing.courseCode !== code
            || existing.courseName !== course.fullname
            || existing.semesterLabel !== nextSemesterLabel
            || (existing.moodleCourseId ?? null) !== course.id
            || existing.hasMoodle !== 1
            || (existing.moodleShortname || '') !== (course.shortname || '')
          if (changed) updated += 1
        }
        stmt.run({
          courseKey: key,
          courseCode: code,
          courseName: course.fullname,
          semesterLabel: course.semesterLabel ?? '',
          moodleCourseId: course.id,
          moodleShortname: course.shortname,
          updatedAt: now,
        })
      }
      return { inserted, updated }
    })
    return tx()
  }

  upsertStudentsCourses(courses: StudentsCourseInput[]): SyncDelta {
    const now = this.nowIso()
    const queryByKey = this.db.prepare(`
      SELECT
        course_code as courseCode,
        course_name as courseName,
        semester_label as semesterLabel,
        semester_technion as semesterTechnion,
        credits,
        course_grade as grade,
        has_students as hasStudents
      FROM unified_courses
      WHERE course_key = ?
    `)
    const queryLegacyMoodleByKey = this.db.prepare(`
      SELECT
        course_key as courseKey,
        course_name as courseName,
        semester_label as semesterLabel,
        moodle_course_id as moodleCourseId,
        moodle_shortname as moodleShortname,
        has_moodle as hasMoodle
      FROM unified_courses
      WHERE course_key = ?
    `)
    const stmt = this.db.prepare(`
      INSERT INTO unified_courses (
        course_key, course_code, course_name, semester_label, semester_technion,
        credits, course_grade, has_moodle, has_students, updated_at
      ) VALUES (
        @courseKey, @courseCode, @courseName, @semesterLabel, @semesterTechnion,
        @credits, @grade, 0, 1, @updatedAt
      )
      ON CONFLICT(course_key) DO UPDATE SET
        course_code = excluded.course_code,
        course_name = excluded.course_name,
        semester_label = excluded.semester_label,
        semester_technion = excluded.semester_technion,
        credits = excluded.credits,
        course_grade = COALESCE(excluded.course_grade, unified_courses.course_grade),
        has_students = 1,
        updated_at = excluded.updated_at
    `)
    const mergeMoodleStmt = this.db.prepare(`
      UPDATE unified_courses
      SET
        moodle_course_id = COALESCE(moodle_course_id, @moodleCourseId),
        has_moodle = CASE WHEN @moodleCourseId IS NOT NULL THEN 1 ELSE has_moodle END,
        moodle_shortname = CASE WHEN @moodleShortname <> '' THEN @moodleShortname ELSE moodle_shortname END,
        semester_label = CASE
          WHEN semester_label = '' AND @moodleSemesterLabel <> '' THEN @moodleSemesterLabel
          ELSE semester_label
        END,
        updated_at = @updatedAt
      WHERE course_key = @courseKey
    `)
    const deleteLegacyMoodleStmt = this.db.prepare(`
      DELETE FROM unified_courses
      WHERE course_key = ?
    `)

    const tx = this.db.transaction(() => {
      let inserted = 0
      let updated = 0
      for (const course of courses) {
        const code = this.normalizeCourseCode(course.code || course.name) || course.code
        const baseKey = this.toCourseKey(code, course.name)
        const key = this.toUnifiedCourseKey(code, course.name, course.semesterTechnion, course.semesterLabel, course.name)
        const nextCredits = Number.isFinite(course.credits) ? course.credits : null
        const legacyMoodle = queryLegacyMoodleByKey.get(baseKey) as
          | {
              courseKey: string
              courseName: string
              semesterLabel: string
              moodleCourseId: number | null
              moodleShortname: string
              hasMoodle: 0 | 1
            }
          | undefined
        const legacyMoodleMatches = Boolean(
          legacyMoodle?.hasMoodle
          && legacyMoodle.moodleCourseId
          && this.parseAcademicTerm(legacyMoodle.semesterLabel, legacyMoodle.courseName)?.key
            === this.parseAcademicTerm(course.semesterTechnion, course.semesterLabel, course.name)?.key,
        )
        const existing = queryByKey.get(key) as
          | {
              courseCode: string
              courseName: string
              semesterLabel: string
              semesterTechnion: string
              credits: number | null
              grade: string | null
              hasStudents: 0 | 1
            }
          | undefined
        if (!existing) {
          inserted += 1
        } else {
          const changed = existing.courseCode !== code
            || existing.courseName !== course.name
            || existing.semesterLabel !== course.semesterLabel
            || existing.semesterTechnion !== course.semesterTechnion
            || (existing.credits ?? null) !== (nextCredits ?? null)
            || (existing.grade ?? null) !== (course.grade ?? null)
            || existing.hasStudents !== 1
          if (changed) updated += 1
        }
        stmt.run({
          courseKey: key,
          courseCode: code,
          courseName: course.name,
          semesterLabel: course.semesterLabel,
          semesterTechnion: course.semesterTechnion,
          credits: nextCredits,
          grade: course.grade,
          updatedAt: now,
        })
        if (legacyMoodleMatches && legacyMoodle) {
          mergeMoodleStmt.run({
            courseKey: key,
            moodleCourseId: legacyMoodle.moodleCourseId,
            moodleShortname: legacyMoodle.moodleShortname || '',
            moodleSemesterLabel: legacyMoodle.semesterLabel || '',
            updatedAt: now,
          })
          if (legacyMoodle.courseKey !== key) {
            deleteLegacyMoodleStmt.run(legacyMoodle.courseKey)
          }
        }
      }
      return { inserted, updated }
    })
    return tx()
  }

  replaceStudentsExams(semesterTechnion: string, exams: StudentsExam[]) {
    const now = this.nowIso()
    const beforeRows = this.db.prepare(`
      SELECT
        course_code as courseCode,
        exam_session as examSession,
        date,
        time,
        duration,
        venue
      FROM students_exams
      WHERE semester_technion = ?
    `).all(semesterTechnion) as Array<{
      courseCode: string
      examSession: string
      date: string
      time: string
      duration: string
      venue: string
    }>
    const del = this.db.prepare('DELETE FROM students_exams WHERE semester_technion = ?')
    const ins = this.db.prepare(`
      INSERT INTO students_exams (
        semester_technion, course_code, course_name, exam_session,
        date, time, duration, venue, updated_at
      ) VALUES (
        @semesterTechnion, @courseCode, @courseName, @examSession,
        @date, @time, @duration, @venue, @updatedAt
      )
    `)
    const tx = this.db.transaction(() => {
      del.run(semesterTechnion)
      for (const exam of exams) {
        ins.run({
          semesterTechnion,
          courseCode: exam.courseCode,
          courseName: exam.courseName,
          examSession: exam.examSession,
          date: exam.date,
          time: exam.time,
          duration: exam.duration,
          venue: exam.venue,
          updatedAt: now,
        })
      }
    })
    tx()
    const keyOf = (item: { courseCode: string; examSession: string; date: string; time: string }) =>
      `${item.courseCode}__${item.examSession}__${item.date}__${item.time}`
    const beforeMap = new Map(beforeRows.map((item) => [keyOf(item), item]))
    const nextKeys = new Set<string>()
    let inserted = 0
    let updated = 0
    for (const exam of exams) {
      const key = keyOf(exam)
      nextKeys.add(key)
      const previous = beforeMap.get(key)
      if (!previous) {
        inserted += 1
        continue
      }
      if ((previous.duration || '') !== (exam.duration || '') || (previous.venue || '') !== (exam.venue || '')) {
        updated += 1
      }
    }
    let deleted = 0
    for (const key of beforeMap.keys()) {
      if (!nextKeys.has(key)) deleted += 1
    }
    return {
      inserted,
      updated,
      deleted,
    }
  }

  setMeta(key: string, value: unknown) {
    const stmt = this.db.prepare(`
      INSERT INTO sync_meta (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `)
    stmt.run(key, JSON.stringify(value ?? null), this.nowIso())
  }

  setMoodleCredential(username: string, password: string) {
    const cleanUsername = username.trim()
    if (!cleanUsername) return
    const stmt = this.db.prepare(`
      INSERT INTO moodle_credentials (username, password, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        password = excluded.password,
        updated_at = excluded.updated_at
    `)
    stmt.run(cleanUsername, password, this.nowIso())
  }

  removeMoodleCredential(username: string) {
    const cleanUsername = username.trim()
    if (!cleanUsername) return
    this.db.prepare('DELETE FROM moodle_credentials WHERE username = ?').run(cleanUsername)
  }

  getMoodleCredential(username: string) {
    const cleanUsername = username.trim()
    if (!cleanUsername) return null
    const row = this.db.prepare('SELECT password FROM moodle_credentials WHERE username = ?').get(cleanUsername) as
      | { password?: string }
      | undefined
    return row?.password ?? null
  }

  getDashboardSnapshot() {
    const courses = this.db.prepare(`
      SELECT
        course_key as courseKey,
        course_code as courseCode,
        course_name as courseName,
        semester_label as semesterLabel,
        semester_technion as semesterTechnion,
        credits,
        course_grade as grade,
        moodle_course_id as moodleCourseId,
        has_moodle as hasMoodle,
        has_students as hasStudents,
        updated_at as updatedAt
      FROM unified_courses
      ORDER BY course_code, course_name
    `).all() as Array<{
      courseKey: string
      courseCode: string
      courseName: string
      semesterLabel: string
      semesterTechnion: string
      credits: number | null
      grade: string | null
      moodleCourseId: number | null
      hasMoodle: 0 | 1
      hasStudents: 0 | 1
      updatedAt: string
    }>

    const exams = this.db.prepare(`
      SELECT
        semester_technion as semesterTechnion,
        course_code as courseCode,
        course_name as courseName,
        exam_session as examSession,
        date,
        time,
        duration,
        venue
      FROM students_exams
      ORDER BY date, time, course_code
    `).all()

    const groupedCourses = new Map<string, typeof courses[number][]>()
    for (const course of courses) {
      const term = this.parseDisplayTerm(course)
      const groupKey = term ? `${course.courseCode || course.courseName}__${term.key}` : course.courseKey
      const group = groupedCourses.get(groupKey) || []
      group.push(course)
      groupedCourses.set(groupKey, group)
    }

    const toVisibleCourse = (course: typeof courses[number]) => {
      const term = this.parseDisplayTerm(course)
      return {
        ...course,
        courseName: this.cleanMoodleCourseName(course.courseName),
        semesterLabel: term ? this.academicTermLabel(term) : course.semesterLabel,
      }
    }

    const visibleCourses = Array.from(groupedCourses.values()).map((group) => {
      if (group.length === 1) return toVisibleCourse(group[0])
      const studentsRow = group.find((course) => course.hasStudents === 1)
      const moodleRow = group.find((course) => course.hasMoodle === 1 && course.moodleCourseId)
      const primary = studentsRow || moodleRow || group[0]
      const term = this.parseDisplayTerm(primary)
      const updatedAtValues = group.map((course) => course.updatedAt).sort()
      return {
        ...primary,
        courseKey: primary.courseKey,
        courseCode: primary.courseCode || moodleRow?.courseCode || '',
        courseName: this.cleanMoodleCourseName(studentsRow?.courseName || primary.courseName),
        semesterLabel: term ? this.academicTermLabel(term) : (studentsRow?.semesterLabel || primary.semesterLabel),
        semesterTechnion: studentsRow?.semesterTechnion || primary.semesterTechnion,
        credits: studentsRow?.credits ?? primary.credits,
        grade: studentsRow?.grade ?? primary.grade,
        moodleCourseId: primary.moodleCourseId ?? moodleRow?.moodleCourseId ?? null,
        hasMoodle: group.some((course) => course.hasMoodle === 1) ? 1 as const : 0 as const,
        hasStudents: group.some((course) => course.hasStudents === 1) ? 1 as const : 0 as const,
        updatedAt: updatedAtValues[updatedAtValues.length - 1] || primary.updatedAt,
      }
    })

    return {
      courses: visibleCourses.map((item) => ({
        ...item,
        hasMoodle: item.hasMoodle === 1,
        hasStudents: item.hasStudents === 1,
      })),
      exams,
      lastMoodleSyncAt: this.getMeta('sync:moodle:last'),
      lastStudentsSyncAt: this.getMeta('sync:students:last'),
      lastAutoSync: this.getMeta('sync:auto:last'),
      studentsProfile: this.getMeta('students:profile') as {
        studentId: string
        programName: string
        chineseName: string
        pinyinName: string
        cohort: string
        gpa: string
        accumulatedCreditPoints: string
      } | null,
    }
  }

  getMetaValue(key: string) {
    return this.getMeta(key)
  }

  private getMeta(key: string) {
    const row = this.db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(key) as { value?: string } | undefined
    if (!row?.value) return null
    try {
      return JSON.parse(row.value)
    } catch {
      return row.value
    }
  }
}

