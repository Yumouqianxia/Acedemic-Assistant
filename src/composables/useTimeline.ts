import { computed, ref } from 'vue'
import type { TimelineEvent } from '../types'
import { notifyError } from './useUtils'

// Module-level shared state (singleton across all callers)
const timelineEvents = ref<TimelineEvent[]>([])
const timelineLoading = ref(false)
const timelineLoaded = ref(false)

const timelineGrouped = computed(() => {
  const groups: { dateLabel: string; dateKey: string; events: TimelineEvent[] }[] = []
  const seen = new Map<string, TimelineEvent[]>()
  for (const ev of timelineEvents.value) {
    const d = new Date(ev.timesort * 1000)
    const dateKey = d.toISOString().slice(0, 10)
    const dateLabel = d.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    if (!seen.has(dateKey)) {
      seen.set(dateKey, [])
      groups.push({ dateLabel, dateKey, events: seen.get(dateKey)! })
    }
    seen.get(dateKey)!.push(ev)
  }
  return groups
})

const loadTimeline = async (): Promise<void> => {
  if (timelineLoading.value) return
  timelineLoading.value = true
  try {
    timelineEvents.value = await window.electronAPI.moodleTimeline({ daysAhead: 30 })
    timelineLoaded.value = true
  } catch (error) {
    notifyError(error instanceof Error ? error.message : '获取 Timeline 失败', 'Timeline')
  } finally {
    timelineLoading.value = false
  }
}

const formatEventTime = (ts: number): string => {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

const shortCourseName = (name: string): string => {
  const m = name.match(/^\d+\s*[-–]\s*(.+?)(?:\s*-\s*(?:Spring|Summer|Fall|Winter)\s*\d{4})?$/i)
  return m ? m[1].trim() : name
}

const clearTimeline = (): void => {
  timelineEvents.value = []
  timelineLoaded.value = false
}

export function useTimeline() {
  return {
    timelineEvents,
    timelineLoading,
    timelineLoaded,
    timelineGrouped,
    loadTimeline,
    formatEventTime,
    shortCourseName,
    clearTimeline,
  }
}
