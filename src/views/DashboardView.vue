<script setup lang="ts">
import type { TimelineEvent, UnifiedCourse } from '../types'
import { useAuth } from '../composables/useAuth'
import { useDashboard } from '../composables/useDashboard'
import StatsSection from './dashboard/StatsSection.vue'
import SyncBar from './dashboard/SyncBar.vue'
import TimelineSection from './dashboard/TimelineSection.vue'
import CourseGrid from './dashboard/CourseGrid.vue'

const emit = defineEmits<{
  'select-course': [course: UnifiedCourse]
  'open-submission': [event: TimelineEvent]
  'sync-all': []
  logout: []
}>()

const { user, userInitial } = useAuth()
const { dashboard, gpaDisplay, completedCreditsNum, currentSemesterInfo } = useDashboard()
</script>

<template>
  <div class="app-layout">
    <div class="app-header">
      <div class="header-left">
        <div class="header-avatar">{{ userInitial }}</div>
        <div class="header-user-info">
          <div class="header-user-name">{{ user?.fullName }}</div>
          <div class="header-user-email">{{ user?.username }}</div>
        </div>
      </div>
      <el-button class="btn-logout" @click="emit('logout')">Logout</el-button>
    </div>

    <StatsSection
      :gpa-display="gpaDisplay"
      :completed-credits-num="completedCreditsNum"
      :current-semester-info="currentSemesterInfo"
    />

    <TimelineSection @open-submission="(ev) => emit('open-submission', ev)" />

    <SyncBar @sync-all="emit('sync-all')" />

    <CourseGrid
      v-if="dashboard.courses.length"
      :courses="dashboard.courses"
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

.app-header {
  background: var(--bg-header);
  padding: 0 28px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.header-avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.header-user-name {
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  line-height: 1.3;
}

.header-user-email {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 1px;
}

.btn-logout {
  border-radius: 7px;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.1) !important;
  border-color: rgba(255, 255, 255, 0.25) !important;
  color: #fff !important;
}

.btn-logout:hover {
  background: rgba(255, 255, 255, 0.18) !important;
  border-color: rgba(255, 255, 255, 0.4) !important;
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
