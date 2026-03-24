<script setup lang="ts">
import { Calendar, Medal, QuestionFilled, UserFilled } from '@element-plus/icons-vue'
import type { UnifiedCourse } from '../../types'

defineProps<{
  courses: UnifiedCourse[]
}>()

defineEmits<{
  'select-course': [course: UnifiedCourse]
}>()
</script>

<template>
  <div class="course-grid">
    <div
      v-for="course in courses"
      :key="course.courseKey"
      class="course-card"
    >
      <div class="course-card-header">
        <span class="course-code">{{ course.courseCode }}</span>
        <el-tooltip :content="course.courseName" placement="top" :show-after="400">
          <el-icon class="course-help-icon"><QuestionFilled /></el-icon>
        </el-tooltip>
      </div>
      <div class="course-name">{{ course.courseName }}</div>
      <div class="course-meta">
        <span class="course-meta-item">
          <el-icon><Calendar /></el-icon>
          {{ course.semesterLabel || '-' }}
        </span>
        <span class="course-meta-item">
          <el-icon><Medal /></el-icon>
          {{ course.credits ?? '-' }} Credits
        </span>
      </div>
      <div class="course-sources">
        <span class="sources-label">source</span>
        <span v-if="course.hasMoodle" class="source-tag source-tag--moodle">
          <span class="source-m-icon">m</span>Moodle
        </span>
        <span v-if="course.hasStudents" class="source-tag source-tag--students">
          <el-icon><UserFilled /></el-icon>Students
        </span>
      </div>
      <el-button class="btn-view-details" @click="$emit('select-course', course)">
        View Details
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.course-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  padding: 0 28px 24px;
  flex: 1;
  align-items: stretch;
}

.course-card {
  background: var(--bg-surface);
  border-radius: 12px;
  border: 1px solid var(--border);
  padding: 18px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: box-shadow 0.2s;
  height: 100%;
}

.course-card:hover {
  box-shadow: var(--shadow-m);
}

.course-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.course-code {
  font-size: 12px;
  color: var(--text-m);
  font-weight: 500;
  letter-spacing: 0.3px;
}

.course-help-icon {
  font-size: 15px;
  color: var(--text-i);
  cursor: default;
  flex-shrink: 0;
}

.course-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-h);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.course-meta {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12.5px;
  color: var(--text-3);
}

.course-meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.course-sources {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.sources-label {
  font-size: 11.5px;
  color: var(--text-f);
}

.source-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11.5px;
  font-weight: 500;
  border: 1px solid transparent;
}

.source-tag--moodle {
  background: var(--tag-m-bg);
  color: var(--tag-m-text);
  border-color: var(--tag-m-border);
}

.source-tag--students {
  background: var(--tag-s-bg);
  color: var(--tag-s-text);
  border-color: var(--tag-s-border);
}

.source-m-icon {
  font-size: 10px;
  font-weight: 900;
  line-height: 1;
}

.btn-view-details {
  width: 100%;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-b);
  border-color: var(--border-strong);
  background: var(--bg-surface);
  margin-top: auto;
  flex-shrink: 0;
}

.btn-view-details:hover {
  background: var(--bg-surface-hover);
  border-color: var(--border-strong);
}
</style>
