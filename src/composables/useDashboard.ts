import { computed, ref } from 'vue'
import type { DashboardData, MoodleSection, UnifiedCourse } from '../types'
import { user } from './useAuth'

// Module-level shared state (singleton across all callers)
const dashboard = ref<DashboardData>({
  courses: [],
  exams: [],
  lastMoodleSyncAt: null,
  lastStudentsSyncAt: null,
  lastAutoSync: null,
  studentsProfile: null,
})

const moodleSyncing = ref(false)
const studentsSyncing = ref(false)
const selectedCourse = ref<UnifiedCourse | null>(null)
const selectedSections = ref<MoodleSection[]>([])
const loadingSections = ref(false)

type AcademicTerm = 'Fall' | 'Winter' | 'Spring' | 'Summer'

const termOrder: Record<AcademicTerm, number> = {
  Fall: 1,
  Winter: 2,
  Spring: 3,
  Summer: 4,
}

const enTermName: Record<string, AcademicTerm> = {
  fall: 'Fall',
  autumn: 'Fall',
  winter: 'Winter',
  spring: 'Spring',
  sping: 'Spring',
  summer: 'Summer',
}

const toYear = (text: string) => {
  if (text.length === 4) return Number.parseInt(text, 10)
  const yy = Number.parseInt(text, 10)
  return yy >= 70 ? 1900 + yy : 2000 + yy
}

const toAcademicYearStart = (term: AcademicTerm, calendarYear: number) => {
  if (term === 'Fall') return calendarYear
  return calendarYear - 1
}

const academicTermScore = (academicStartYear: number, term: AcademicTerm) =>
  academicStartYear * 10 + termOrder[term]

const parseTermScore = (text: string) => {
  const raw = text.trim()
  if (!raw) return -1

  const academicYearHit = raw.match(/(20\d{2})\s*[-/]\s*(?:20)?(\d{2})\s*[-/ ]*\s*(spring|sping|summer|fall|autumn|winter)\b/i)
  if (academicYearHit) {
    const term = enTermName[academicYearHit[3].toLowerCase()]
    return academicTermScore(Number.parseInt(academicYearHit[1], 10), term)
  }

  const termFirst = raw.match(/\b(spring|sping|summer|fall|autumn|winter)\s*[-/ ]*\s*(\d{2,4})\b/i)
  if (termFirst) {
    const term = enTermName[termFirst[1].toLowerCase()]
    const calendarYear = toYear(termFirst[2])
    return academicTermScore(toAcademicYearStart(term, calendarYear), term)
  }

  const yearFirst = raw.match(/\b(\d{2,4})\s*[-/ ]*\s*(spring|sping|summer|fall|autumn|winter)\b/i)
  if (yearFirst) {
    const calendarYear = toYear(yearFirst[1])
    const term = enTermName[yearFirst[2].toLowerCase()]
    return academicTermScore(toAcademicYearStart(term, calendarYear), term)
  }

  const techHit = raw.match(/(20\d{2})\D*(20\d{2})\D*([1234])/)
  if (techHit) {
    const academicStartYear = Number.parseInt(techHit[1], 10)
    const term: AcademicTerm = techHit[3] === '2'
      ? 'Spring'
      : techHit[3] === '3'
        ? 'Summer'
        : techHit[3] === '4'
          ? 'Winter'
          : 'Fall'
    return academicTermScore(academicStartYear, term)
  }

  return -1
}

const termScore = (course: UnifiedCourse) => {
  const candidates = [course.semesterTechnion, course.semesterLabel, course.courseName]
  for (const value of candidates) {
    const score = parseTermScore(value || '')
    if (score >= 0) return score
  }
  return -1
}

const dashboardCourses = computed(() => {
  const all = dashboard.value.courses
  if (!all.length) return []
  const moodlePreferred = all.filter((course) => course.hasMoodle)
  const source = moodlePreferred.length ? moodlePreferred : all
  const latest = source.reduce((max, course) => Math.max(max, termScore(course)), -1)
  if (latest < 0) return source
  const filtered = source.filter((course) => termScore(course) === latest)
  return filtered.length ? filtered : source
})

const gpaDisplay = computed(() => {
  const raw = dashboard.value.studentsProfile?.gpa
  if (!raw) return null
  const n = parseFloat(raw)
  return isNaN(n) ? raw : n.toFixed(2)
})

const completedCreditsNum = computed(() => {
  const raw = dashboard.value.studentsProfile?.accumulatedCreditPoints
  if (!raw) return null
  const n = parseFloat(raw)
  return isNaN(n) ? null : n
})

const currentSemesterInfo = computed(() => {
  const syncInfo = dashboard.value.lastStudentsSyncAt
  if (!syncInfo) return null
  const courses = dashboard.value.courses.filter(
    (c) => c.semesterTechnion === syncInfo.semesterTechnion,
  )
  const credits = courses.reduce((sum, c) => sum + (c.credits ?? 0), 0)
  return { label: syncInfo.semester, credits }
})

const selectedCourseExams = computed(() => {
  const code = selectedCourse.value?.courseCode
  if (!code) return []
  return dashboard.value.exams.filter((exam) => exam.courseCode === code)
})

const loadDashboard = async (): Promise<void> => {
  dashboard.value = await window.electronAPI.dashboardGet()
}

const loadCourseContents = async (course: UnifiedCourse): Promise<void> => {
  if (!course.moodleCourseId || !user.value) return
  selectedSections.value = []
  loadingSections.value = true
  try {
    selectedSections.value = await window.electronAPI.moodleCourseContents({
      courseId: course.moodleCourseId,
      username: user.value.username,
    })
  } finally {
    loadingSections.value = false
  }
}

const clearDashboard = (): void => {
  selectedCourse.value = null
  selectedSections.value = []
  loadingSections.value = false
  dashboard.value = {
    courses: [],
    exams: [],
    lastMoodleSyncAt: null,
    lastStudentsSyncAt: null,
    lastAutoSync: null,
    studentsProfile: null,
  }
}

export function useDashboard() {
  return {
    dashboard,
    moodleSyncing,
    studentsSyncing,
    selectedCourse,
    selectedSections,
    loadingSections,
    gpaDisplay,
    completedCreditsNum,
    currentSemesterInfo,
    dashboardCourses,
    selectedCourseExams,
    loadDashboard,
    loadCourseContents,
    clearDashboard,
  }
}
