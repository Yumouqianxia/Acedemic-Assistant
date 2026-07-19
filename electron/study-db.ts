import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'

const require = createRequire(import.meta.url)
const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3')

export type StudyTaskStatus = 'todo' | 'done'

export type StudyTask = {
  id: number
  courseKey: string
  courseName: string
  title: string
  description: string
  scheduledDate: string
  startTime: string
  estimatedMinutes: number
  status: StudyTaskStatus
  priority: 1 | 2 | 3
  noteId: string | null
  reminderAt: string | null
  reminderFiredAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type StudyTaskInput = {
  courseKey?: string
  courseName?: string
  title: string
  description?: string
  scheduledDate: string
  startTime?: string
  estimatedMinutes?: number
  priority?: 1 | 2 | 3
  noteId?: string | null
  reminderAt?: string | null
}

export type FocusSession = {
  id: number
  taskId: number | null
  label: string
  mode: 'focus' | 'break'
  startedAt: string
  endsAt: string
  plannedSeconds: number
  status: 'active' | 'completed' | 'cancelled'
  endedAt: string | null
}

export type PersonalExam = {
  id: number
  courseKey: string
  courseName: string
  examSession: string
  startsAt: string
  durationMinutes: number
  venue: string
  createdAt: string
}

export class StudyDb {
  private db: import('better-sqlite3').Database

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.initSchema()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS study_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_key TEXT NOT NULL DEFAULT '',
        course_name TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        scheduled_date TEXT NOT NULL,
        start_time TEXT NOT NULL DEFAULT '',
        estimated_minutes INTEGER NOT NULL DEFAULT 50,
        status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'done')),
        priority INTEGER NOT NULL DEFAULT 2 CHECK(priority BETWEEN 1 AND 3),
        note_id TEXT,
        reminder_at TEXT,
        reminder_fired_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_study_tasks_date
        ON study_tasks(scheduled_date, start_time, priority);
      CREATE INDEX IF NOT EXISTS idx_study_tasks_reminder
        ON study_tasks(reminder_at, reminder_fired_at);

      CREATE TABLE IF NOT EXISTS focus_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER,
        label TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('focus', 'break')),
        started_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        planned_seconds INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
        ended_at TEXT,
        FOREIGN KEY(task_id) REFERENCES study_tasks(id) ON DELETE SET NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_focus
        ON focus_sessions(status) WHERE status = 'active';

      CREATE TABLE IF NOT EXISTS personal_exams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_key TEXT NOT NULL DEFAULT '',
        course_name TEXT NOT NULL,
        exam_session TEXT NOT NULL DEFAULT 'A',
        starts_at TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 180,
        venue TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_personal_exams_start ON personal_exams(starts_at);

      CREATE TABLE IF NOT EXISTS study_import_batches (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        created_count INTEGER NOT NULL DEFAULT 0,
        updated_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        undone_at TEXT
      );

      CREATE TABLE IF NOT EXISTS study_import_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        task_id INTEGER NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('create', 'update')),
        before_json TEXT,
        after_json TEXT NOT NULL,
        FOREIGN KEY(batch_id) REFERENCES study_import_batches(id) ON DELETE CASCADE
      );
    `)
  }

  private nowIso() {
    return new Date().toISOString()
  }

  listTasks(fromDate: string, toDate: string) {
    return this.db.prepare(`
      SELECT
        id,
        course_key AS courseKey,
        course_name AS courseName,
        title,
        description,
        scheduled_date AS scheduledDate,
        start_time AS startTime,
        estimated_minutes AS estimatedMinutes,
        status,
        priority,
        note_id AS noteId,
        reminder_at AS reminderAt,
        reminder_fired_at AS reminderFiredAt,
        completed_at AS completedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM study_tasks
      WHERE scheduled_date BETWEEN ? AND ?
      ORDER BY scheduled_date, CASE WHEN start_time = '' THEN 1 ELSE 0 END, start_time, priority, id
    `).all(fromDate, toDate) as StudyTask[]
  }

  createTask(input: StudyTaskInput) {
    const now = this.nowIso()
    const result = this.db.prepare(`
      INSERT INTO study_tasks (
        course_key, course_name, title, description, scheduled_date, start_time,
        estimated_minutes, priority, note_id, reminder_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.courseKey ?? '',
      input.courseName ?? '',
      input.title,
      input.description ?? '',
      input.scheduledDate,
      input.startTime ?? '',
      input.estimatedMinutes ?? 50,
      input.priority ?? 2,
      input.noteId ?? null,
      input.reminderAt ?? null,
      now,
      now,
    )
    return this.getTask(Number(result.lastInsertRowid))
  }

  getTask(id: number) {
    return this.db.prepare(`
      SELECT
        id, course_key AS courseKey, course_name AS courseName, title, description,
        scheduled_date AS scheduledDate, start_time AS startTime,
        estimated_minutes AS estimatedMinutes, status, priority, note_id AS noteId,
        reminder_at AS reminderAt, reminder_fired_at AS reminderFiredAt,
        completed_at AS completedAt, created_at AS createdAt, updated_at AS updatedAt
      FROM study_tasks WHERE id = ?
    `).get(id) as StudyTask | undefined
  }

  updateTask(id: number, patch: Partial<StudyTaskInput & { status: StudyTaskStatus }>) {
    const current = this.getTask(id)
    if (!current) throw new Error('Study task not found')
    const next = {
      courseKey: patch.courseKey ?? current.courseKey,
      courseName: patch.courseName ?? current.courseName,
      title: patch.title ?? current.title,
      description: patch.description ?? current.description,
      scheduledDate: patch.scheduledDate ?? current.scheduledDate,
      startTime: patch.startTime ?? current.startTime,
      estimatedMinutes: patch.estimatedMinutes ?? current.estimatedMinutes,
      status: patch.status ?? current.status,
      priority: patch.priority ?? current.priority,
      noteId: patch.noteId === undefined ? current.noteId : patch.noteId,
      reminderAt: patch.reminderAt === undefined ? current.reminderAt : patch.reminderAt,
    }
    const now = this.nowIso()
    const completedAt = next.status === 'done' ? (current.completedAt ?? now) : null
    const reminderFiredAt = next.reminderAt === current.reminderAt ? current.reminderFiredAt : null
    this.db.prepare(`
      UPDATE study_tasks SET
        course_key = ?, course_name = ?, title = ?, description = ?, scheduled_date = ?,
        start_time = ?, estimated_minutes = ?, status = ?, priority = ?, note_id = ?,
        reminder_at = ?, reminder_fired_at = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.courseKey, next.courseName, next.title, next.description, next.scheduledDate,
      next.startTime, next.estimatedMinutes, next.status, next.priority, next.noteId,
      next.reminderAt, reminderFiredAt, completedAt, now, id,
    )
    return this.getTask(id)
  }

  deleteTask(id: number) {
    return this.db.prepare('DELETE FROM study_tasks WHERE id = ?').run(id).changes > 0
  }

  findDuplicateTask(input: Pick<StudyTaskInput, 'courseKey' | 'courseName' | 'title' | 'scheduledDate' | 'startTime'>) {
    return this.db.prepare(`
      SELECT id, course_key AS courseKey, course_name AS courseName, title, description,
        scheduled_date AS scheduledDate, start_time AS startTime,
        estimated_minutes AS estimatedMinutes, status, priority, note_id AS noteId,
        reminder_at AS reminderAt, reminder_fired_at AS reminderFiredAt,
        completed_at AS completedAt, created_at AS createdAt, updated_at AS updatedAt
      FROM study_tasks
      WHERE scheduled_date = ? AND start_time = ? AND lower(title) = lower(?)
        AND (course_key = ? OR (? = '' AND lower(course_name) = lower(?)))
      LIMIT 1
    `).get(
      input.scheduledDate,
      input.startTime ?? '',
      input.title,
      input.courseKey ?? '',
      input.courseKey ?? '',
      input.courseName ?? '',
    ) as StudyTask | undefined
  }

  importTasks(payload: {
    rows: Array<StudyTaskInput & { id?: number }>
    fileName: string
    duplicateStrategy: 'skip' | 'update' | 'create'
  }) {
    const batchId = randomUUID()
    const createdAt = this.nowIso()
    let created = 0
    let updated = 0
    let skipped = 0
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO study_import_batches (id, file_name, created_at)
        VALUES (?, ?, ?)
      `).run(batchId, payload.fileName, createdAt)
      const insertChange = this.db.prepare(`
        INSERT INTO study_import_changes (batch_id, task_id, action, before_json, after_json)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const row of payload.rows) {
        let target = row.id ? this.getTask(row.id) : this.findDuplicateTask(row)
        if (row.id && !target) {
          skipped += 1
          continue
        }
        if (!row.id && target && payload.duplicateStrategy === 'skip') {
          skipped += 1
          continue
        }
        if (!row.id && target && payload.duplicateStrategy === 'create') target = undefined
        if (target) {
          const before = JSON.stringify(target)
          const next = this.updateTask(target.id, row)
          if (!next) throw new Error(`Failed to update task ${target.id}`)
          insertChange.run(batchId, target.id, 'update', before, JSON.stringify(next))
          updated += 1
        } else {
          const next = this.createTask(row)
          if (!next) throw new Error('Failed to create imported task')
          insertChange.run(batchId, next.id, 'create', null, JSON.stringify(next))
          created += 1
        }
      }
      this.db.prepare(`
        UPDATE study_import_batches SET created_count = ?, updated_count = ?, skipped_count = ? WHERE id = ?
      `).run(created, updated, skipped, batchId)
    })
    tx()
    return { batchId, created, updated, skipped }
  }

  undoImport(batchId: string) {
    const batch = this.db.prepare(`
      SELECT id, undone_at AS undoneAt FROM study_import_batches WHERE id = ?
    `).get(batchId) as { id: string; undoneAt: string | null } | undefined
    if (!batch) throw new Error('Import batch not found')
    if (batch.undoneAt) throw new Error('This import has already been undone')
    const changes = this.db.prepare(`
      SELECT task_id AS taskId, action, before_json AS beforeJson
      FROM study_import_changes WHERE batch_id = ? ORDER BY id DESC
    `).all(batchId) as Array<{ taskId: number; action: 'create' | 'update'; beforeJson: string | null }>
    const tx = this.db.transaction(() => {
      for (const change of changes) {
        if (change.action === 'create') {
          this.db.prepare('DELETE FROM study_tasks WHERE id = ?').run(change.taskId)
        } else if (change.beforeJson) {
          this.restoreTask(JSON.parse(change.beforeJson) as StudyTask)
        }
      }
      this.db.prepare('UPDATE study_import_batches SET undone_at = ? WHERE id = ?').run(this.nowIso(), batchId)
    })
    tx()
    return { restored: changes.length }
  }

  bulkUpdateTasks(payload: {
    ids: number[]
    operation: 'complete' | 'reopen' | 'move-days' | 'priority' | 'duration' | 'delete'
    value?: number
  }) {
    const uniqueIds = [...new Set(payload.ids.filter((id) => Number.isInteger(id) && id > 0))]
    const tx = this.db.transaction(() => {
      let changed = 0
      for (const id of uniqueIds) {
        const task = this.getTask(id)
        if (!task) continue
        if (payload.operation === 'delete') {
          changed += this.deleteTask(id) ? 1 : 0
        } else if (payload.operation === 'complete' || payload.operation === 'reopen') {
          this.updateTask(id, { status: payload.operation === 'complete' ? 'done' : 'todo' })
          changed += 1
        } else if (payload.operation === 'move-days') {
          const date = new Date(`${task.scheduledDate}T12:00:00`)
          date.setDate(date.getDate() + Math.round(payload.value ?? 0))
          const scheduledDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
          const reminderAt = task.reminderAt && task.startTime ? new Date(`${scheduledDate}T${task.startTime}:00`).toISOString() : null
          this.updateTask(id, { scheduledDate, reminderAt })
          changed += 1
        } else if (payload.operation === 'priority') {
          const priority = payload.value === 1 || payload.value === 3 ? payload.value : 2
          this.updateTask(id, { priority })
          changed += 1
        } else if (payload.operation === 'duration') {
          const estimatedMinutes = Math.min(720, Math.max(1, Math.round(payload.value ?? 50)))
          this.updateTask(id, { estimatedMinutes })
          changed += 1
        }
      }
      return changed
    })
    return { changed: tx() }
  }

  private restoreTask(task: StudyTask) {
    this.db.prepare(`
      INSERT INTO study_tasks (
        id, course_key, course_name, title, description, scheduled_date, start_time,
        estimated_minutes, status, priority, note_id, reminder_at, reminder_fired_at,
        completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        course_key = excluded.course_key, course_name = excluded.course_name, title = excluded.title,
        description = excluded.description, scheduled_date = excluded.scheduled_date,
        start_time = excluded.start_time, estimated_minutes = excluded.estimated_minutes,
        status = excluded.status, priority = excluded.priority, note_id = excluded.note_id,
        reminder_at = excluded.reminder_at, reminder_fired_at = excluded.reminder_fired_at,
        completed_at = excluded.completed_at, created_at = excluded.created_at, updated_at = excluded.updated_at
    `).run(
      task.id, task.courseKey, task.courseName, task.title, task.description, task.scheduledDate,
      task.startTime, task.estimatedMinutes, task.status, task.priority, task.noteId,
      task.reminderAt, task.reminderFiredAt, task.completedAt, task.createdAt, task.updatedAt,
    )
  }

  listPersonalExams() {
    return this.db.prepare(`
      SELECT id, course_key AS courseKey, course_name AS courseName,
        exam_session AS examSession, starts_at AS startsAt,
        duration_minutes AS durationMinutes, venue, created_at AS createdAt
      FROM personal_exams ORDER BY starts_at
    `).all() as PersonalExam[]
  }

  createPersonalExam(input: {
    courseKey?: string
    courseName: string
    examSession?: string
    startsAt: string
    durationMinutes?: number
    venue?: string
  }) {
    const now = this.nowIso()
    const result = this.db.prepare(`
      INSERT INTO personal_exams (
        course_key, course_name, exam_session, starts_at, duration_minutes, venue, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.courseKey ?? '', input.courseName, input.examSession ?? 'A', input.startsAt,
      input.durationMinutes ?? 180, input.venue ?? '', now,
    )
    return this.db.prepare(`
      SELECT id, course_key AS courseKey, course_name AS courseName,
        exam_session AS examSession, starts_at AS startsAt,
        duration_minutes AS durationMinutes, venue, created_at AS createdAt
      FROM personal_exams WHERE id = ?
    `).get(Number(result.lastInsertRowid)) as PersonalExam
  }

  deletePersonalExam(id: number) {
    return this.db.prepare('DELETE FROM personal_exams WHERE id = ?').run(id).changes > 0
  }

  startFocus(payload: { taskId?: number | null; label: string; mode: 'focus' | 'break'; durationSeconds: number }) {
    const now = new Date()
    const startedAt = now.toISOString()
    const endsAt = new Date(now.getTime() + payload.durationSeconds * 1000).toISOString()
    const tx = this.db.transaction(() => {
      this.db.prepare(`UPDATE focus_sessions SET status = 'cancelled', ended_at = ? WHERE status = 'active'`).run(startedAt)
      const result = this.db.prepare(`
        INSERT INTO focus_sessions (task_id, label, mode, started_at, ends_at, planned_seconds, status)
        VALUES (?, ?, ?, ?, ?, ?, 'active')
      `).run(payload.taskId ?? null, payload.label, payload.mode, startedAt, endsAt, payload.durationSeconds)
      return Number(result.lastInsertRowid)
    })
    return this.getFocusSession(tx())
  }

  getActiveFocus() {
    return this.db.prepare(`
      SELECT id, task_id AS taskId, label, mode, started_at AS startedAt, ends_at AS endsAt,
        planned_seconds AS plannedSeconds, status, ended_at AS endedAt
      FROM focus_sessions WHERE status = 'active' LIMIT 1
    `).get() as FocusSession | undefined
  }

  private getFocusSession(id: number) {
    return this.db.prepare(`
      SELECT id, task_id AS taskId, label, mode, started_at AS startedAt, ends_at AS endsAt,
        planned_seconds AS plannedSeconds, status, ended_at AS endedAt
      FROM focus_sessions WHERE id = ?
    `).get(id) as FocusSession | undefined
  }

  stopFocus(status: 'completed' | 'cancelled') {
    const active = this.getActiveFocus()
    if (!active) return null
    const endedAt = this.nowIso()
    this.db.prepare('UPDATE focus_sessions SET status = ?, ended_at = ? WHERE id = ?')
      .run(status, endedAt, active.id)
    return this.getFocusSession(active.id) ?? null
  }

  consumeDueAlerts(nowIso: string) {
    const dueTasks = this.db.prepare(`
      SELECT id, course_key AS courseKey, course_name AS courseName, title,
        scheduled_date AS scheduledDate, start_time AS startTime
      FROM study_tasks
      WHERE status = 'todo' AND reminder_at IS NOT NULL AND reminder_at <= ? AND reminder_fired_at IS NULL
      ORDER BY reminder_at
    `).all(nowIso) as Array<Pick<StudyTask, 'id' | 'courseKey' | 'courseName' | 'title' | 'scheduledDate' | 'startTime'>>

    const active = this.getActiveFocus()
    const focusDue = active && active.endsAt <= nowIso ? active : null
    const tx = this.db.transaction(() => {
      if (dueTasks.length) {
        const ids = dueTasks.map((item) => item.id)
        const placeholders = ids.map(() => '?').join(',')
        this.db.prepare(`UPDATE study_tasks SET reminder_fired_at = ? WHERE id IN (${placeholders})`)
          .run(nowIso, ...ids)
      }
      if (focusDue) {
        this.db.prepare(`UPDATE focus_sessions SET status = 'completed', ended_at = ? WHERE id = ?`)
          .run(nowIso, focusDue.id)
      }
    })
    tx()
    return { tasks: dueTasks, focus: focusDue }
  }

  close() {
    this.db.close()
  }
}
