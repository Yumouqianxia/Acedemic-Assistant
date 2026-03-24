<script setup lang="ts">
import { ArrowRight, Calendar, Clock, DocumentCopy, Reading, Refresh } from '@element-plus/icons-vue'
import type { TimelineEvent } from '../../types'
import { useTimeline } from '../../composables/useTimeline'

defineEmits<{
  'open-submission': [event: TimelineEvent]
}>()

const {
  timelineEvents,
  timelineLoading,
  timelineLoaded,
  timelineGrouped,
  loadTimeline,
  formatEventTime,
  shortCourseName,
} = useTimeline()
</script>

<template>
  <div class="timeline-panel">
    <div class="timeline-header">
      <div class="timeline-title">
        <el-icon class="timeline-title-icon"><Clock /></el-icon>
        Upcoming Deadlines
      </div>
      <el-button
        class="btn-refresh-timeline"
        :loading="timelineLoading"
        size="small"
        @click="loadTimeline"
      >
        <el-icon><Refresh /></el-icon>
        Refresh
      </el-button>
    </div>

    <div v-if="timelineLoading && !timelineLoaded" class="timeline-loading">
      <el-icon class="is-loading"><Refresh /></el-icon> Loading timeline...
    </div>

    <div v-else-if="timelineLoaded && !timelineEvents.length" class="timeline-empty">
      No upcoming deadlines in the next 30 days
    </div>

    <div v-else-if="!timelineLoaded && !timelineLoading" class="timeline-empty">
      Sync Moodle to load upcoming deadlines
    </div>

    <div v-else class="timeline-groups">
      <div v-for="group in timelineGrouped" :key="group.dateKey" class="timeline-group">
        <div class="timeline-date-label">{{ group.dateLabel }}</div>
        <div
          v-for="ev in group.events"
          :key="ev.id"
          class="timeline-event"
          :class="{ 'timeline-event--clickable': ev.modulename === 'assign' }"
          @click="$emit('open-submission', ev)"
        >
          <div class="tl-left">
            <el-icon class="tl-mod-icon" :class="`tl-mod--${ev.modulename}`">
              <DocumentCopy v-if="ev.modulename === 'assign'" />
              <Reading v-else-if="ev.modulename === 'quiz'" />
              <Calendar v-else />
            </el-icon>
            <div class="tl-info">
              <div class="tl-name">{{ ev.name }}</div>
              <div class="tl-course">{{ shortCourseName(ev.coursename) }}</div>
            </div>
          </div>
          <div class="tl-right">
            <span class="tl-time">{{ formatEventTime(ev.timesort) }}</span>
            <el-icon v-if="ev.modulename === 'assign'" class="tl-arrow"><ArrowRight /></el-icon>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline-panel {
  margin: 6px 28px 0;
  background: var(--bg-surface);
  border-radius: 14px;
  border: 1px solid var(--border);
  padding: 18px 22px 14px;
  box-shadow: var(--shadow-s);
}

.timeline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.timeline-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-h);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.timeline-title-icon {
  font-size: 15px;
  color: var(--accent-o);
}

.btn-refresh-timeline {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  color: var(--text-m);
  border-color: var(--border-strong);
}

.timeline-loading,
.timeline-empty {
  font-size: 13px;
  color: var(--text-f);
  padding: 10px 0 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.timeline-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.timeline-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.timeline-date-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--accent-o);
  letter-spacing: 0.3px;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--tl-date-border);
  margin-bottom: 4px;
}

.timeline-event {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--tl-event-border);
  background: var(--tl-event-bg);
  transition: box-shadow 0.15s, border-color 0.15s, background 0.15s;
  gap: 12px;
}

.timeline-event--clickable {
  cursor: pointer;
}

.timeline-event--clickable:hover {
  border-color: var(--tl-hover-border);
  background: var(--tl-hover-bg);
  box-shadow: var(--shadow-h);
}

.tl-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.tl-mod-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.tl-mod--assign { color: var(--accent-o); }
.tl-mod--quiz { color: var(--accent-p); }
.tl-mod--forum,
.tl-mod--resource { color: var(--accent-b); }

.tl-info {
  min-width: 0;
}

.tl-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-h);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 420px;
}

.tl-course {
  font-size: 11.5px;
  color: var(--text-m);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 420px;
}

.tl-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.tl-time {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.tl-arrow {
  font-size: 13px;
  color: var(--text-i);
}
</style>
