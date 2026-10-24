import { computed, ref } from 'vue'
import type { DashboardData, MoodleSection, UnifiedCourse } from '../types'
import { user } from './useAuth'
import { latestTermCourses, resolveCourseTerm } from '../utils/academic-terms'

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

const dashboardCourses = computed(() => {
  const all = dashboard.value.courses
  if (!all.length) return []
  const moodlePreferred = all.filter((course) => course.hasMoodle)
  const source = moodlePreferred.length ? moodlePreferred : all
  return latestTermCourses(source)
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
  const first = dashboardCourses.value[0]
  if (!first) return null
  const term = resolveCourseTerm(first)
  if (term.sortScore < 0) return null
  const courses = dashboard.value.courses.filter((course) => resolveCourseTerm(course).key === term.key)
  // Missing Students credits must not appear as a confirmed zero or partial total.
  const credits = courses.every((course) => course.credits !== null)
    ? courses.reduce((sum, course) => sum + (course.credits ?? 0), 0)
    : null
  return { label: term.label, credits }
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
