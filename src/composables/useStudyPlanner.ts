import { ref } from 'vue'
import type { FocusSession, StudyTask, StudyTaskInput } from '../types'

const tasks = ref<StudyTask[]>([])
const activeFocus = ref<FocusSession | null>(null)
const loadingTasks = ref(false)

export function useStudyPlanner() {
  const loadTasks = async (fromDate: string, toDate: string) => {
    loadingTasks.value = true
    try {
      tasks.value = await window.electronAPI.studyTasksList({ fromDate, toDate }) as StudyTask[]
      return tasks.value
    } finally {
      loadingTasks.value = false
    }
  }

  const createTask = async (input: StudyTaskInput) => {
    const task = await window.electronAPI.studyTaskCreate(input) as StudyTask
    tasks.value = [...tasks.value, task].sort(taskSort)
    return task
  }

  const updateTask = async (id: number, patch: Partial<StudyTaskInput & { status: 'todo' | 'done' }>) => {
    const task = await window.electronAPI.studyTaskUpdate({ id, patch }) as StudyTask
    tasks.value = tasks.value.map((item) => item.id === id ? task : item).sort(taskSort)
    return task
  }

  const deleteTask = async (id: number) => {
    await window.electronAPI.studyTaskDelete({ id })
    tasks.value = tasks.value.filter((item) => item.id !== id)
  }

  const hydrateActiveFocus = async () => {
    activeFocus.value = await window.electronAPI.studyFocusGetActive() as FocusSession | null
    return activeFocus.value
  }

  const startFocus = async (payload: { taskId?: number | null; label: string; mode?: 'focus' | 'break'; durationSeconds: number }) => {
    activeFocus.value = await window.electronAPI.studyFocusStart(payload) as FocusSession
    return activeFocus.value
  }

  const stopFocus = async (status: 'completed' | 'cancelled' = 'cancelled') => {
    await window.electronAPI.studyFocusStop({ status })
    activeFocus.value = null
  }

  return {
    tasks,
    activeFocus,
    loadingTasks,
    loadTasks,
    createTask,
    updateTask,
    deleteTask,
    hydrateActiveFocus,
    startFocus,
    stopFocus,
  }
}

function taskSort(a: StudyTask, b: StudyTask) {
  return a.scheduledDate.localeCompare(b.scheduledDate)
    || Number(!a.startTime) - Number(!b.startTime)
    || a.startTime.localeCompare(b.startTime)
    || a.priority - b.priority
    || a.id - b.id
}
