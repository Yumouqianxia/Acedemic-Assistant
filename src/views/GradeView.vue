<script setup lang="ts">
import { computed, ref } from 'vue'
import { RefreshRight } from '@element-plus/icons-vue'
import { useDashboard } from '../composables/useDashboard'

const emit = defineEmits<{
  'refresh-grades': []
}>()

const { dashboard, gpaDisplay, completedCreditsNum, currentSemesterInfo, studentsSyncing } = useDashboard()
const gradeCourses = computed(() => dashboard.value.courses.filter((course) => course.hasStudents))
const gradeSearchKeyword = ref('')

const semesterScore = (semesterTechnion: string) => {
  const match = semesterTechnion.match(/(20\d{2})\D*(\d{2})$/)
  if (!match) return -1
  return Number.parseInt(match[1], 10) * 10 + Number.parseInt(match[2], 10)
}

const toComparableName = (name: string) =>
  name.replace(/^\s*\d{5,6}\s*-\s*/i, '').trim().toLowerCase()

const normalizedGradeCourses = computed(() => {
  const map = new Map<string, (typeof gradeCourses.value)[number]>()
  for (const course of gradeCourses.value) {
    const normalizedCode = course.courseCode?.trim() || ''
    const normalizedSemester = course.semesterTechnion?.trim() || course.semesterLabel?.trim() || 'unknown'
    const fallbackName = toComparableName(course.courseName || '')
    const dedupeKey = normalizedCode
      ? `${normalizedCode}__${normalizedSemester}`
      : `${fallbackName}__${normalizedSemester}`
    const existing = map.get(dedupeKey)
    if (!existing) {
      map.set(dedupeKey, course)
      continue
    }
    const currentHasGrade = Boolean(course.grade)
    const existingHasGrade = Boolean(existing.grade)
    if (currentHasGrade && !existingHasGrade) {
      map.set(dedupeKey, course)
      continue
    }
    const currentHasCode = Boolean(course.courseCode?.trim())
    const existingHasCode = Boolean(existing.courseCode?.trim())
    if (currentHasCode && !existingHasCode) {
      map.set(dedupeKey, course)
      continue
    }
    const currentNameLength = (course.courseName || '').length
    const existingNameLength = (existing.courseName || '').length
    if (currentNameLength > existingNameLength) {
      map.set(dedupeKey, course)
      continue
    }
    const currentUpdatedAt = Date.parse(course.updatedAt || '')
    const existingUpdatedAt = Date.parse(existing.updatedAt || '')
    if (Number.isFinite(currentUpdatedAt) && Number.isFinite(existingUpdatedAt) && currentUpdatedAt > existingUpdatedAt) {
      map.set(dedupeKey, course)
    }
  }
  return Array.from(map.values())
})

const filteredGradeCourses = computed(() => {
  const keyword = gradeSearchKeyword.value.trim().toLowerCase()
  if (!keyword) return normalizedGradeCourses.value
  return normalizedGradeCourses.value.filter((course) => {
    const code = (course.courseCode || '').toLowerCase()
    const name = (course.courseName || '').toLowerCase()
    return code.includes(keyword) || name.includes(keyword)
  })
})

const groupedGradeCourses = computed(() => {
  const groups = new Map<string, { label: string; score: number; courses: typeof gradeCourses.value }>()
  for (const course of filteredGradeCourses.value) {
    const key = course.semesterTechnion || course.semesterLabel || 'unknown'
    const label = course.semesterLabel || course.semesterTechnion || '未知学期'
    const score = semesterScore(course.semesterTechnion)
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, { label, score, courses: [course] })
      continue
    }
    existing.courses.push(course)
  }
  return Array.from(groups.entries())
    .map(([key, value]) => ({
      key,
      label: value.label,
      score: value.score,
      courses: value.courses.sort((a, b) => a.courseCode.localeCompare(b.courseCode) || a.courseName.localeCompare(b.courseName)),
    }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
})

type CourseStatus = 'retaken' | 'suggest-retake' | 'normal' | 'in-progress'

const toGradeNumber = (grade: string | null) => {
  if (!grade) return Number.NaN
  const num = Number.parseFloat(grade)
  return Number.isFinite(num) ? num : Number.NaN
}

const courseStatus = computed(() => {
  const latestByCode = new Map<string, { semesterScore: number; updatedAt: number }>()
  for (const course of normalizedGradeCourses.value) {
    const code = course.courseCode?.trim()
    if (!code) continue
    const score = semesterScore(course.semesterTechnion)
    const updatedAt = Date.parse(course.updatedAt || '')
    const existing = latestByCode.get(code)
    if (!existing) {
      latestByCode.set(code, { semesterScore: score, updatedAt })
      continue
    }
    if (score > existing.semesterScore) {
      latestByCode.set(code, { semesterScore: score, updatedAt })
      continue
    }
    if (score === existing.semesterScore && Number.isFinite(updatedAt) && updatedAt > existing.updatedAt) {
      latestByCode.set(code, { semesterScore: score, updatedAt })
    }
  }

  const result = new Map<string, CourseStatus>()
  for (const course of normalizedGradeCourses.value) {
    const key = course.courseKey
    const code = course.courseCode?.trim()
    if (!code) {
      result.set(key, 'in-progress')
      continue
    }
    const latest = latestByCode.get(code)
    const currentScore = semesterScore(course.semesterTechnion)
    const currentUpdatedAt = Date.parse(course.updatedAt || '')
    const hasLaterAttempt = Boolean(
      latest
      && (latest.semesterScore > currentScore
        || (latest.semesterScore === currentScore
          && Number.isFinite(latest.updatedAt)
          && Number.isFinite(currentUpdatedAt)
          && latest.updatedAt > currentUpdatedAt)),
    )
    if (hasLaterAttempt) {
      result.set(key, 'retaken')
      continue
    }
    if (!course.grade) {
      result.set(key, 'in-progress')
      continue
    }
    const numeric = toGradeNumber(course.grade)
    if (Number.isFinite(numeric) && numeric < 65) {
      result.set(key, 'suggest-retake')
      continue
    }
    result.set(key, 'normal')
  }
  return result
})

const statusLabelMap: Record<CourseStatus, string> = {
  retaken: '已重修',
  'suggest-retake': '推荐重修（低于65）',
  normal: '正常',
  'in-progress': '在修',
}

const statusClassMap: Record<CourseStatus, string> = {
  retaken: 'status-tag--retaken',
  'suggest-retake': 'status-tag--suggest-retake',
  normal: 'status-tag--normal',
  'in-progress': 'status-tag--in-progress',
}

const resolveStatus = (courseKey: string): CourseStatus => {
  return courseStatus.value.get(courseKey) ?? 'in-progress'
}
</script>

<template>
  <div class="grade-page">
    <div class="grade-header">
      <div>
        <h2 class="grade-title">Grade Overview</h2>
        <p class="grade-subtitle">Your academic performance summary</p>
      </div>
      <el-button
        class="grade-refresh-btn"
        :loading="studentsSyncing"
        @click="emit('refresh-grades')"
      >
        <el-icon v-if="!studentsSyncing"><RefreshRight /></el-icon>
        刷新成绩
      </el-button>
    </div>

    <div class="grade-body">
      <!-- GPA Card -->
      <div class="grade-card grade-card--gpa">
        <div class="gc-label">Cumulative GPA</div>
        <div class="gc-value">{{ gpaDisplay ?? '—' }}</div>
        <div class="gc-sub">Overall academic standing</div>
      </div>

      <!-- Credits -->
      <div class="grade-card">
        <div class="gc-label">Completed Credits</div>
        <div class="gc-value">{{ completedCreditsNum ?? '—' }}</div>
        <div class="gc-sub">Accumulated credit points</div>
      </div>

      <!-- Current semester -->
      <div class="grade-card">
        <div class="gc-label">Current Semester Credits</div>
        <div class="gc-value">{{ currentSemesterInfo?.credits ?? '—' }}</div>
        <div class="gc-sub">{{ currentSemesterInfo?.label ?? '—' }}</div>
      </div>

      <!-- Course grades table -->
      <div class="grade-table-card" v-if="groupedGradeCourses.length">
        <div class="grade-table-head">
          <div class="grade-table-title">Course List</div>
          <el-input
            v-model="gradeSearchKeyword"
            class="grade-search-input"
            clearable
            placeholder="按课程代码或课程名搜索"
          />
        </div>
        <div
          v-for="semester in groupedGradeCourses"
          :key="semester.key"
          class="grade-semester-group"
        >
          <div class="grade-semester-title">{{ semester.label }}</div>
          <el-table
            :data="semester.courses"
            class="grade-table"
            :border="false"
            stripe
          >
            <el-table-column prop="courseCode" label="Course Code" width="130" />
            <el-table-column prop="courseName" label="Course" min-width="240" />
            <el-table-column prop="credits" label="Credits" width="90" align="center" />
            <el-table-column label="Grade" width="110" align="center">
              <template #default="{ row }">
                {{ row.grade || '—' }}
              </template>
            </el-table-column>
            <el-table-column label="状态" width="170" align="center">
              <template #default="{ row }">
                <span class="status-tag" :class="statusClassMap[resolveStatus(row.courseKey)]">
                  {{ statusLabelMap[resolveStatus(row.courseKey)] }}
                </span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <div v-else class="grade-empty">
        <el-empty description="暂无成绩数据，请先同步" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.grade-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-page);
  overflow-y: auto;
}

.grade-header {
  padding: 28px 28px 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.grade-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-h);
  margin: 0 0 4px;
}

.grade-subtitle {
  font-size: 13px;
  color: var(--text-m);
  margin: 0;
}

.grade-refresh-btn {
  border-radius: 8px;
}

.grade-body {
  padding: 20px 28px 28px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  align-content: start;
}

.grade-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 24px 26px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: var(--shadow-s);
}

.grade-card--gpa {
  background: var(--stat-gpa-bg);
  border-color: var(--stat-gpa-border);
}

.gc-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-m);
}

.gc-value {
  font-size: 40px;
  font-weight: 700;
  color: var(--text-h);
  line-height: 1;
}

.gc-sub {
  font-size: 12px;
  color: var(--text-m);
}

.grade-table-card {
  grid-column: 1 / -1;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px;
  box-shadow: var(--shadow-s);
}

.grade-table-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-h);
}

.grade-table-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.grade-search-input {
  width: 280px;
}

.grade-semester-group + .grade-semester-group {
  margin-top: 16px;
}

.grade-semester-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  margin-bottom: 8px;
}

.status-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid transparent;
  line-height: 1.4;
  white-space: nowrap;
}

.status-tag--retaken {
  color: #7c3aed;
  background: #f3e8ff;
  border-color: #d8b4fe;
}

.status-tag--suggest-retake {
  color: #b45309;
  background: #fffbeb;
  border-color: #fcd34d;
}

.status-tag--normal {
  color: #166534;
  background: #f0fdf4;
  border-color: #86efac;
}

.status-tag--in-progress {
  color: #374151;
  background: #f3f4f6;
  border-color: #d1d5db;
}

.grade-table {
  --el-table-bg-color: var(--bg-surface);
  --el-table-tr-bg-color: var(--bg-surface);
  --el-table-header-bg-color: var(--bg-surface-alt);
  --el-table-border-color: var(--border);
  --el-table-text-color: var(--text-b);
  --el-table-header-text-color: var(--text-m);
  --el-table-row-hover-bg-color: var(--bg-surface-hover);
  border-radius: 8px;
  overflow: hidden;
}

.grade-empty {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
}
</style>
