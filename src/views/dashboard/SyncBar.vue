<script setup lang="ts">
import { Refresh, Reading, UserFilled } from '@element-plus/icons-vue'
import { useDashboard } from '../../composables/useDashboard'
import { formatTime } from '../../composables/useUtils'

const { dashboard, moodleSyncing, studentsSyncing } = useDashboard()

defineEmits<{
  'sync-all': []
}>()
</script>

<template>
  <div class="sync-bar">
    <div class="sync-status">
      <span class="sync-item">
        <el-icon class="sync-icon-moodle"><Reading /></el-icon>
        <b>Moodle</b>&nbsp;Last Sync:&nbsp;{{ formatTime(dashboard.lastMoodleSyncAt?.at) }}
      </span>
      <span class="sync-sep">|</span>
      <span class="sync-item">
        <el-icon class="sync-icon-students"><UserFilled /></el-icon>
        <b>Students</b>&nbsp;Last Sync:&nbsp;{{ formatTime(dashboard.lastStudentsSyncAt?.at) }}
      </span>
    </div>
    <div class="sync-actions">
      <el-button
        class="btn-sync-all"
        :loading="moodleSyncing || studentsSyncing"
        @click="$emit('sync-all')"
      >
        <el-icon><Refresh /></el-icon>
        SYNC ALL
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.sync-bar {
  margin: 16px 28px;
  background: var(--bg-surface);
  border-radius: 12px;
  border: 1px solid var(--border);
  padding: 14px 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  box-shadow: var(--shadow-s);
}

.sync-status {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--text-2);
}

.sync-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sync-icon-moodle {
  font-size: 16px;
  color: var(--accent-o);
}

.sync-icon-students {
  font-size: 16px;
  color: var(--accent-b);
}

.sync-sep {
  color: var(--border-strong);
  font-size: 18px;
  line-height: 1;
}

.sync-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

.btn-sync-all {
  background: var(--sync-bg) !important;
  border-color: var(--sync-border) !important;
  color: var(--sync-text) !important;
  font-weight: 600;
  font-size: 13px;
  padding: 8px 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 5px;
}

.btn-sync-all:hover {
  background: var(--sync-hover-bg) !important;
  border-color: var(--sync-hover-border) !important;
}
</style>
