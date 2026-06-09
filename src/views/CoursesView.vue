<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import type { UnifiedCourse } from '../types'
import { useDashboard } from '../composables/useDashboard'
import CourseGrid from './dashboard/CourseGrid.vue'

const emit = defineEmits<{
  'select-course': [course: UnifiedCourse]
}>()

const { dashboard } = useDashboard()
const selectedSemester = ref('all')

type AcademicTerm = 'Fall' | 'Winter' | 'Spring' | 'Summer'

type TermMeta = {
  key: string
  label: string
  sortScore: number
}

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

const toFullYear = (yearText: string) => {
  if (yearText.length === 4) return Number.parseInt(yearText, 10)
  const yy = Number.parseInt(yearText, 10)
  return yy >= 70 ? 1900 + yy : 2000 + yy
}

const toAcademicYearStart = (term: AcademicTerm, calendarYear: number) => {
  if (term === 'Fall') return calendarYear
  return calendarYear - 1
}

const makeTermMeta = (academicStartYear: number, term: AcademicTerm): TermMeta => {
  const startShort = String(academicStartYear).slice(-2)
  const endShort = String(academicStartYear + 1).slice(-2)
  return {
    key: `${academicStartYear}-${term}`,
    label: `${startShort}-${endShort} ${term}`,
    sortScore: academicStartYear * 10 + termOrder[term],
  }
}

const parseTermText = (text: string): TermMeta | null => {
  const raw = text.trim()
  if (!raw) return null

  const academicYearHit = raw.match(/(20\d{2})\s*[-/]\s*(?:20)?(\d{2})\s*[-/ ]*\s*(spring|sping|summer|fall|autumn|winter)\b/i)
  if (academicYearHit) {
    const term = enTermName[academicYearHit[3].toLowerCase()]
    return makeTermMeta(Number.parseInt(academicYearHit[1], 10), term)
  }

  const termFirst = raw.match(/\b(spring|sping|summer|fall|autumn|winter)\s*[-/ ]*\s*(\d{2,4})\b/i)
  if (termFirst) {
    const term = enTermName[termFirst[1].toLowerCase()]
    const calendarYear = toFullYear(termFirst[2])
    return makeTermMeta(toAcademicYearStart(term, calendarYear), term)
  }

  const yearFirst = raw.match(/\b(\d{2,4})\s*[-/ ]*\s*(spring|sping|summer|fall|autumn|winter)\b/i)
  if (yearFirst) {
    const calendarYear = toFullYear(yearFirst[1])
    const term = enTermName[yearFirst[2].toLowerCase()]
    return makeTermMeta(toAcademicYearStart(term, calendarYear), term)
  }

  // Students semesterTechnion fallback, e.g. "2025-2026-2" / "202520262".
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
    return makeTermMeta(academicStartYear, term)
  }

  return null
}

const resolveCourseTerm = (course: UnifiedCourse): TermMeta => {
  const candidates = [course.semesterLabel, course.courseName, course.semesterTechnion]
  for (const item of candidates) {
    const parsed = parseTermText(item || '')
    if (parsed) return parsed
  }
  const fallback = (course.semesterLabel || course.semesterTechnion || 'Unknown term').trim() || 'Unknown term'
  return {
    key: `unknown:${fallback}`,
    label: fallback,
    sortScore: -1,
  }
}

const moodleCourses = computed(() =>
  dashboard.value.courses.filter((course) => course.hasMoodle && course.moodleCourseId),
)

const coursesWithTerm = computed(() =>
  moodleCourses.value.map((course) => ({
    course,
    term: resolveCourseTerm(course),
  })),
)

const semesterOptions = computed(() => {
  const map = new Map<string, { label: string; sortScore: number }>()
  for (const item of coursesWithTerm.value) {
    const existing = map.get(item.term.key)
    if (!existing || item.term.sortScore > existing.sortScore) {
      map.set(item.term.key, { label: item.term.label, sortScore: item.term.sortScore })
    }
  }
  return Array.from(map.entries())
    .map(([value, meta]) => ({ value, label: meta.label, sortScore: meta.sortScore }))
    .sort((a, b) => b.sortScore - a.sortScore || a.label.localeCompare(b.label))
})

watchEffect(() => {
  if (selectedSemester.value === 'all') return
  const exists = semesterOptions.value.some((item) => item.value === selectedSemester.value)
  if (!exists) selectedSemester.value = 'all'
})

const filteredCourses = computed(() =>
  coursesWithTerm.value
    .filter((item) => selectedSemester.value === 'all' || item.term.key === selectedSemester.value)
    .sort((a, b) => {
      if (a.term.sortScore !== b.term.sortScore) return b.term.sortScore - a.term.sortScore
      return a.course.courseCode.localeCompare(b.course.courseCode)
        || a.course.courseName.localeCompare(b.course.courseName)
    })
    .map((item) => item.course),
)
</script>

<template>
  <div class="courses-layout">
    <div class="courses-toolbar">
      <div class="courses-title">Moodle Courses</div>
      <div class="courses-filter">
        <span class="courses-filter-label">Term</span>
        <el-select v-model="selectedSemester" size="small" style="width: 220px">
          <el-option label="All terms" value="all" />
          <el-option
            v-for="opt in semesterOptions"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </div>
    </div>
    <CourseGrid
      v-if="filteredCourses.length"
      :courses="filteredCourses"
      @select-course="(course) => emit('select-course', course)"
    />
    <div v-else class="empty-wrap">
      <el-empty description="No Moodle courses match the selected term." />
    </div>
  </div>
</template>

<style scoped>
.courses-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-page);
  overflow-y: auto;
}

.courses-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 28px 0;
}

.courses-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-h);
}

.courses-filter {
  display: flex;
  align-items: center;
  gap: 8px;
}

.courses-filter-label {
  font-size: 12px;
  color: var(--text-m);
}

.empty-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 40px;
}
</style>
