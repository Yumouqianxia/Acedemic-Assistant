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
    selectedCourseExams,
    loadDashboard,
    loadCourseContents,
    clearDashboard,
  }
}
