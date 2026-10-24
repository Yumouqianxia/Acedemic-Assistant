<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import type { UnifiedCourse } from '../types'
import { useDashboard } from '../composables/useDashboard'
import CourseGrid from './dashboard/CourseGrid.vue'
import { resolveCourseTerm } from '../utils/academic-terms'

const emit = defineEmits<{
  'select-course': [course: UnifiedCourse]
}>()

const { dashboard } = useDashboard()
const selectedSemester = ref('all')

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
