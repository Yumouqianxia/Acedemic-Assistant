<script setup lang="ts">
import type { TimelineEvent, UnifiedCourse } from '../types'
import { useDashboard } from '../composables/useDashboard'
import StatsSection from './dashboard/StatsSection.vue'
import SyncBar from './dashboard/SyncBar.vue'
import TimelineSection from './dashboard/TimelineSection.vue'
import CourseGrid from './dashboard/CourseGrid.vue'

const emit = defineEmits<{
  'select-course': [course: UnifiedCourse]
  'open-submission': [event: TimelineEvent]
  'sync-all': []
}>()

const { dashboardCourses, gpaDisplay, completedCreditsNum, currentSemesterInfo } = useDashboard()
</script>

<template>
  <div class="app-layout">
    <StatsSection
      :gpa-display="gpaDisplay"
      :completed-credits-num="completedCreditsNum"
      :current-semester-info="currentSemesterInfo"
    />

    <TimelineSection @open-submission="(ev) => emit('open-submission', ev)" />

    <SyncBar @sync-all="emit('sync-all')" />

    <CourseGrid
      v-if="dashboardCourses.length"
      :courses="dashboardCourses"
      @select-course="(course) => emit('select-course', course)"
    />
    <div v-else class="empty-wrap">
      <el-empty description="暂无课程数据，点击 SYNC ALL 开始同步" />
    </div>

    <div class="app-footer">© 2026 GTIIT Campus Dashboard</div>
  </div>
</template>

<style scoped>
.app-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-page);
  overflow-y: auto;
}

.empty-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 40px;
}

.app-footer {
  text-align: right;
  padding: 16px 28px;
  font-size: 12px;
  color: var(--footer-text);
  border-top: 1px solid var(--footer-border);
  margin-top: 8px;
}
</style>
