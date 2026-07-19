<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Bell, Calendar, Check, Clock, Delete, Document, Plus, Timer } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import StudyCsvImportDialog from '../components/study/StudyCsvImportDialog.vue'
import { useDashboard } from '../composables/useDashboard'
import { useStudyPlanner } from '../composables/useStudyPlanner'
import { notifyError, notifySuccess } from '../composables/useUtils'
import type { NotebookItem, PersonalExam, StudyTask, UnifiedCourse } from '../types'

const { dashboard, loadDashboard } = useDashboard()
const {
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
} = useStudyPlanner()

const now = ref(new Date())
const selectedDate = ref(toDateKey(now.value))
const weekAnchor = ref(startOfWeek(now.value))
const taskDialogOpen = ref(false)
const savingTask = ref(false)
const availableNotes = ref<NotebookItem[]>([])
const loadingNotes = ref(false)
const focusMinutes = ref(50)
const focusTaskId = ref<number | null>(null)
const personalExams = ref<PersonalExam[]>([])
const examDialogOpen = ref(false)
const savingExam = ref(false)
const csvDialog = ref<InstanceType<typeof StudyCsvImportDialog> | null>(null)
const exportingPdf = ref(false)
const bulkMode = ref(false)
const selectedTaskIds = ref<Set<number>>(new Set())
let tickTimer: number | undefined
let removeStudyAlert: (() => void) | null = null

const taskForm = reactive({
  courseKey: '',
  title: '',
  description: '',
  scheduledDate: selectedDate.value,
  startTime: '09:00',
  estimatedMinutes: 50,
  priority: 2 as 1 | 2 | 3,
  noteId: '',
  reminderEnabled: true,
})

const examForm = reactive({
  courseKey: '',
  courseName: '',
  examSession: 'A',
  startsAt: `${toDateKey(now.value)}T09:00`,
  durationMinutes: 180,
  venue: '',
})

const exportCalendarPdf = async () => {
  exportingPdf.value = true
  try {
    const result = await window.electronAPI.studyCalendarExportPdf()
    if (!result.canceled) notifySuccess(`Calendar PDF exported with ${result.count} tasks.`, 'Study Planner')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to export calendar PDF', 'Study Planner')
  } finally {
    exportingPdf.value = false
  }
}

const weekDays = computed(() => Array.from({ length: 7 }, (_, index) => {
  const date = addDays(weekAnchor.value, index)
  return {
    date,
    key: toDateKey(date),
    weekday: new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date),
    label: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date),
  }
}))

const selectedDayTasks = computed(() => tasks.value.filter((task) => task.scheduledDate === selectedDate.value))
const todayTasks = computed(() => tasks.value.filter((task) => task.scheduledDate === toDateKey(now.value)))
const timelineStartHour = 8
const timelineEndHour = 22
const timelineHourHeight = 72
const timelineHeight = (timelineEndHour - timelineStartHour) * timelineHourHeight
const timelineHours = Array.from(
  { length: timelineEndHour - timelineStartHour + 1 },
  (_, index) => timelineStartHour + index,
)
const hasAnytimeTasks = computed(() => weekDays.value.some((day) => tasksForDay(day.key).some((task) => !task.startTime)))
const completedToday = computed(() => todayTasks.value.filter((task) => task.status === 'done').length)
const focusTask = computed(() => tasks.value.find((task) => task.id === focusTaskId.value) ?? null)
const activeFocusRemaining = computed(() => {
  if (!activeFocus.value) return 0
  return Math.max(0, Math.ceil((new Date(activeFocus.value.endsAt).getTime() - now.value.getTime()) / 1000))
})
const activeFocusProgress = computed(() => {
  if (!activeFocus.value) return 0
  return Math.min(100, Math.max(0, 100 - activeFocusRemaining.value / activeFocus.value.plannedSeconds * 100))
})

const upcomingExams = computed(() => [
  ...dashboard.value.exams.map((exam) => ({ ...exam, startsAt: parseExamDate(exam.date, exam.time), personalId: null as number | null })),
  ...personalExams.value.map((exam) => ({
    courseCode: '',
    courseName: exam.courseName,
    examSession: exam.examSession,
    date: new Date(exam.startsAt).toLocaleDateString(),
    time: new Date(exam.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    duration: `${exam.durationMinutes} min`,
    venue: exam.venue,
    startsAt: new Date(exam.startsAt),
    personalId: exam.id as number | null,
  })),
]
  .filter((exam) => exam.startsAt && exam.startsAt.getTime() >= startOfDay(now.value).getTime())
  .sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime())
  .slice(0, 3))

const weekTitle = computed(() => {
  const first = weekDays.value[0].date
  const last = weekDays.value[6].date
  return `${formatShortDate(first)} – ${formatShortDate(last)}`
})

const selectedCourse = computed(() => dashboard.value.courses.find((course) => course.courseKey === taskForm.courseKey) ?? null)

const loadPersonalExams = async () => {
  try {
    personalExams.value = await window.electronAPI.studyExamsList() as PersonalExam[]
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to load personal exams', 'Study Planner')
  }
}

const openExamDialog = () => {
  Object.assign(examForm, {
    courseKey: '',
    courseName: '',
    examSession: 'A',
    startsAt: `${toDateKey(now.value)}T09:00`,
    durationMinutes: 180,
    venue: '',
  })
  examDialogOpen.value = true
}

const saveExam = async () => {
  const course = dashboard.value.courses.find((item) => item.courseKey === examForm.courseKey)
  const courseName = course?.courseName || examForm.courseName.trim()
  if (!courseName) {
    notifyError('Please select a course or enter its name.', 'Study Planner')
    return
  }
  savingExam.value = true
  try {
    const exam = await window.electronAPI.studyExamCreate({
      courseKey: course?.courseKey || '',
      courseName,
      examSession: examForm.examSession,
      startsAt: new Date(examForm.startsAt).toISOString(),
      durationMinutes: examForm.durationMinutes,
      venue: examForm.venue,
    }) as PersonalExam
    personalExams.value = [...personalExams.value, exam].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    examDialogOpen.value = false
    notifySuccess('Exam added to the countdown.', 'Study Planner')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to add exam', 'Study Planner')
  } finally {
    savingExam.value = false
  }
}

const removePersonalExam = async (id: number) => {
  try {
    await window.electronAPI.studyExamDelete({ id })
    personalExams.value = personalExams.value.filter((exam) => exam.id !== id)
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to delete exam', 'Study Planner')
  }
}

const toggleTaskSelection = (id: number) => {
  const next = new Set(selectedTaskIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedTaskIds.value = next
}

const toggleBulkMode = () => {
  bulkMode.value = !bulkMode.value
  if (!bulkMode.value) selectedTaskIds.value = new Set()
}

const selectAllForDay = () => {
  const ids = selectedDayTasks.value.map((task) => task.id)
  selectedTaskIds.value = selectedTaskIds.value.size === ids.length ? new Set() : new Set(ids)
}

const runBulkOperation = async (
  operation: 'complete' | 'reopen' | 'move-days' | 'priority' | 'duration' | 'delete',
  value?: number,
) => {
  const ids = [...selectedTaskIds.value]
  if (!ids.length) return
  try {
    if (operation === 'delete') {
      await ElMessageBox.confirm(`Delete ${ids.length} selected tasks?`, 'Bulk delete', {
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel',
        type: 'warning',
      })
    }
    const response = await window.electronAPI.studyTasksBulkUpdate({ ids, operation, value })
    selectedTaskIds.value = new Set()
    await reloadWeek()
    notifySuccess(`${response.changed} tasks updated.`, 'Bulk edit')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    notifyError(error instanceof Error ? error.message : 'Bulk update failed', 'Bulk edit')
  }
}

const reloadWeek = async () => {
  const first = weekDays.value[0].key
  const last = weekDays.value[6].key
  try {
    await loadTasks(first, last)
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to load study tasks', 'Study Planner')
  }
}

const shiftWeek = (amount: number) => {
  weekAnchor.value = addDays(weekAnchor.value, amount * 7)
  selectedDate.value = toDateKey(weekAnchor.value)
}

const goToday = () => {
  weekAnchor.value = startOfWeek(now.value)
  selectedDate.value = toDateKey(now.value)
}

const openTaskDialog = (date = selectedDate.value) => {
  Object.assign(taskForm, {
    courseKey: '',
    title: '',
    description: '',
    scheduledDate: date,
    startTime: '09:00',
    estimatedMinutes: 50,
    priority: 2,
    noteId: '',
    reminderEnabled: true,
  })
  availableNotes.value = []
  taskDialogOpen.value = true
}

const loadCourseNotes = async () => {
  taskForm.noteId = ''
  availableNotes.value = []
  const course = selectedCourse.value
  if (!course) return
  loadingNotes.value = true
  try {
    const result = await window.electronAPI.notebookCourseGet({ course: toNotebookCourse(course) })
    availableNotes.value = result.index.items
  } catch {
    availableNotes.value = []
  } finally {
    loadingNotes.value = false
  }
}

const saveTask = async () => {
  if (!taskForm.title.trim()) {
    notifyError('Please enter a task title.', 'Study Planner')
    return
  }
  savingTask.value = true
  try {
    const course = selectedCourse.value
    const reminderAt = taskForm.reminderEnabled && taskForm.startTime
      ? toIsoAt(taskForm.scheduledDate, taskForm.startTime)
      : null
    await createTask({
      courseKey: course?.courseKey ?? '',
      courseName: course?.courseName ?? '',
      title: taskForm.title.trim(),
      description: taskForm.description.trim(),
      scheduledDate: taskForm.scheduledDate,
      startTime: taskForm.startTime,
      estimatedMinutes: taskForm.estimatedMinutes,
      priority: taskForm.priority,
      noteId: taskForm.noteId || null,
      reminderAt,
    })
    taskDialogOpen.value = false
    notifySuccess('Study task added.', 'Study Planner')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to add task', 'Study Planner')
  } finally {
    savingTask.value = false
  }
}

const toggleTask = async (task: StudyTask) => {
  try {
    await updateTask(task.id, { status: task.status === 'done' ? 'todo' : 'done' })
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to update task', 'Study Planner')
  }
}

const postponeTask = async (task: StudyTask) => {
  const nextDate = toDateKey(addDays(new Date(`${task.scheduledDate}T12:00:00`), 1))
  const reminderAt = task.reminderAt && task.startTime ? toIsoAt(nextDate, task.startTime) : null
  try {
    await updateTask(task.id, { scheduledDate: nextDate, reminderAt })
    if (nextDate > weekDays.value[6].key) await reloadWeek()
    notifySuccess(`Moved to ${nextDate}.`, 'Study Planner')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to postpone task', 'Study Planner')
  }
}

const confirmDeleteTask = async (task: StudyTask) => {
  try {
    await ElMessageBox.confirm(`Delete “${task.title}”?`, 'Delete task', {
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
      type: 'warning',
    })
    await deleteTask(task.id)
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    notifyError(error instanceof Error ? error.message : 'Failed to delete task', 'Study Planner')
  }
}

const beginTaskFocus = async (task: StudyTask) => {
  focusTaskId.value = task.id
  focusMinutes.value = task.estimatedMinutes || 50
  await beginFocus()
}

const beginFocus = async () => {
  try {
    await startFocus({
      taskId: focusTask.value?.id ?? null,
      label: focusTask.value?.title || 'Independent study',
      mode: 'focus',
      durationSeconds: focusMinutes.value * 60,
    })
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to start focus timer', 'Focus')
  }
}

const beginBreak = async () => {
  try {
    await startFocus({ label: 'Break', mode: 'break', durationSeconds: 10 * 60 })
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to start break', 'Focus')
  }
}

const cancelFocus = async () => {
  try {
    await stopFocus('cancelled')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to stop timer', 'Focus')
  }
}

const openLinkedNote = async (task: StudyTask) => {
  if (!task.noteId || !task.courseKey) return
  const course = dashboard.value.courses.find((item) => item.courseKey === task.courseKey)
  if (!course) {
    notifyError('The linked course is no longer available.', 'Notebook')
    return
  }
  try {
    await window.electronAPI.notebookOpenNote({ course: toNotebookCourse(course), noteId: task.noteId })
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to open linked note', 'Notebook')
  }
}

const tasksForDay = (date: string) => tasks.value.filter((task) => task.scheduledDate === date)
const scheduledTasksForDay = (date: string) => tasksForDay(date)
  .filter((task) => task.startTime)
  .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
const anytimeTasksForDay = (date: string) => tasksForDay(date).filter((task) => !task.startTime)
const calendarTaskStyle = (task: StudyTask) => {
  const [hour, minute] = (task.startTime || '08:00').split(':').map(Number)
  const taskStart = hour * 60 + minute
  const rangeStart = timelineStartHour * 60
  const rangeEnd = timelineEndHour * 60
  const visibleStart = Math.max(rangeStart, taskStart)
  const visibleEnd = Math.min(rangeEnd, taskStart + task.estimatedMinutes)
  return {
    top: `${(visibleStart - rangeStart) / 60 * timelineHourHeight}px`,
    height: `${Math.max(0, visibleEnd - visibleStart) / 60 * timelineHourHeight}px`,
  }
}
const examDaysRemaining = (date: Date) => Math.max(0, Math.ceil((startOfDay(date).getTime() - startOfDay(now.value).getTime()) / 86_400_000))

watch(weekAnchor, () => void reloadWeek())
watch(() => taskForm.courseKey, () => void loadCourseNotes())

onMounted(async () => {
  if (!dashboard.value.courses.length) {
    try { await loadDashboard() } catch { /* Study planner also works without synced courses. */ }
  }
  await Promise.all([reloadWeek(), hydrateActiveFocus(), loadPersonalExams()])
  tickTimer = window.setInterval(() => { now.value = new Date() }, 1000)
  removeStudyAlert = window.electronAPI.onStudyAlert((payload) => {
    if (payload.type === 'focus') {
      activeFocus.value = null
      notifySuccess(payload.session?.mode === 'break' ? 'Break finished.' : 'Focus session complete.', 'Focus')
    } else {
      notifySuccess(payload.task?.title || 'A study task is ready.', 'Study reminder')
    }
  })
})

onBeforeUnmount(() => {
  if (tickTimer !== undefined) window.clearInterval(tickTimer)
  removeStudyAlert?.()
})

function toNotebookCourse(course: UnifiedCourse) {
  return {
    courseKey: course.courseKey,
    courseCode: course.courseCode || course.courseKey,
    courseName: course.courseName || course.courseCode || course.courseKey,
  }
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfWeek(date: Date) {
  const start = startOfDay(date)
  const weekday = start.getDay() || 7
  start.setDate(start.getDate() - weekday + 1)
  return start
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function parseExamDate(date: string, time: string) {
  const normalizedDate = date.trim().replace(/[./]/g, '-').replace(/^(\d{2})-(\d{2})-(\d{4})$/, '$3-$2-$1')
  const normalizedTime = time.trim().match(/\d{1,2}:\d{2}/)?.[0] || '09:00'
  const parsed = new Date(`${normalizedDate}T${normalizedTime}:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function toIsoAt(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString()
}

function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}
</script>

<template>
  <div class="study-page">
    <header class="study-hero">
      <div>
        <div class="eyebrow">Study Planner</div>
        <h1>{{ now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</h1>
        <p>{{ now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) }}</p>
      </div>
      <div class="hero-progress">
        <span>Today</span>
        <strong>{{ completedToday }}/{{ todayTasks.length }}</strong>
        <el-progress :percentage="todayTasks.length ? Math.round(completedToday / todayTasks.length * 100) : 0" :show-text="false" />
      </div>
      <div class="hero-actions">
        <button class="secondary-action" :disabled="exportingPdf" @click="exportCalendarPdf">
          {{ exportingPdf ? 'Exporting…' : 'Export calendar PDF' }}
        </button>
        <button class="secondary-action" @click="csvDialog?.open()">Import / Export CSV</button>
        <button class="primary-action" @click="openTaskDialog(toDateKey(now))">
          <el-icon><Plus /></el-icon> Add task
        </button>
      </div>
    </header>

    <section class="exam-strip">
      <template v-if="upcomingExams.length">
        <div v-for="exam in upcomingExams" :key="`${exam.courseCode}-${exam.examSession}-${exam.date}-${exam.personalId}`" class="exam-card">
          <div class="exam-days">{{ examDaysRemaining(exam.startsAt!) }}<small>days</small></div>
          <div class="exam-info">
            <strong>{{ exam.courseName }}</strong>
            <span>{{ exam.examSession }} · {{ exam.date }} {{ exam.time }}</span>
          </div>
          <button v-if="exam.personalId" class="exam-delete" title="Delete personal exam" @click="removePersonalExam(exam.personalId)">×</button>
        </div>
      </template>
      <div v-else class="exam-empty">
        <el-icon><Calendar /></el-icon>
        <span>No upcoming exam data. Add the known A/B dates now or sync Students later.</span>
      </div>
      <button class="exam-add" @click="openExamDialog"><el-icon><Plus /></el-icon> Add exam</button>
    </section>

    <div class="study-grid">
      <section class="panel task-panel">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">Selected day</span>
            <h2>{{ selectedDate }}</h2>
          </div>
          <div class="heading-actions">
            <button class="text-action" :class="{ active: bulkMode }" @click="toggleBulkMode">{{ bulkMode ? 'Cancel select' : 'Select' }}</button>
            <button class="icon-action" title="Add task" @click="openTaskDialog()"><el-icon><Plus /></el-icon></button>
          </div>
        </div>

        <div v-if="bulkMode" class="bulk-bar">
          <button @click="selectAllForDay">{{ selectedTaskIds.size === selectedDayTasks.length && selectedDayTasks.length ? 'Clear all' : 'Select all' }}</button>
          <strong>{{ selectedTaskIds.size }} selected</strong>
          <span class="bulk-spacer" />
          <button :disabled="!selectedTaskIds.size" @click="runBulkOperation('complete')">Complete</button>
          <button :disabled="!selectedTaskIds.size" @click="runBulkOperation('reopen')">Reopen</button>
          <button :disabled="!selectedTaskIds.size" @click="runBulkOperation('move-days', 1)">+1 day</button>
          <button :disabled="!selectedTaskIds.size" @click="runBulkOperation('move-days', 7)">+7 days</button>
          <button :disabled="!selectedTaskIds.size" @click="runBulkOperation('priority', 1)">Set P1</button>
          <button class="bulk-delete" :disabled="!selectedTaskIds.size" @click="runBulkOperation('delete')">Delete</button>
        </div>

        <div v-if="loadingTasks" class="empty-state">Loading tasks…</div>
        <div v-else-if="!selectedDayTasks.length" class="empty-state">Nothing planned yet. Add one concrete next action.</div>
        <div v-else class="task-list">
          <article v-for="task in selectedDayTasks" :key="task.id" class="task-row" :class="{ done: task.status === 'done', 'task-row--bulk': bulkMode, selected: selectedTaskIds.has(task.id) }">
            <input v-if="bulkMode" class="bulk-checkbox" type="checkbox" :checked="selectedTaskIds.has(task.id)" :aria-label="`Select ${task.title}`" @change="toggleTaskSelection(task.id)">
            <button class="task-check" @click="toggleTask(task)"><el-icon v-if="task.status === 'done'"><Check /></el-icon></button>
            <div class="task-body">
              <div class="task-title-line">
                <strong>{{ task.title }}</strong>
                <span :class="`priority priority-${task.priority}`">P{{ task.priority }}</span>
              </div>
              <div class="task-meta">
                <span v-if="task.startTime"><el-icon><Clock /></el-icon>{{ task.startTime }}</span>
                <span><el-icon><Timer /></el-icon>{{ task.estimatedMinutes }} min</span>
                <span v-if="task.courseName">{{ task.courseName }}</span>
                <span v-if="task.reminderAt"><el-icon><Bell /></el-icon></span>
              </div>
              <p v-if="task.description">{{ task.description }}</p>
            </div>
            <div class="task-actions">
              <button v-if="task.noteId" title="Open linked note" @click="openLinkedNote(task)"><el-icon><Document /></el-icon></button>
              <button title="Start focus" @click="beginTaskFocus(task)"><el-icon><Timer /></el-icon></button>
              <button title="Move to tomorrow" @click="postponeTask(task)">+1</button>
              <button title="Delete" @click="confirmDeleteTask(task)"><el-icon><Delete /></el-icon></button>
            </div>
          </article>
        </div>
      </section>

      <section class="panel focus-panel">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">Focus</span>
            <h2>{{ activeFocus ? (activeFocus.mode === 'break' ? 'Break' : activeFocus.label) : 'Ready to focus' }}</h2>
          </div>
        </div>

        <template v-if="activeFocus">
          <div class="timer-display">{{ formatTimer(activeFocusRemaining) }}</div>
          <el-progress :percentage="activeFocusProgress" :stroke-width="8" :show-text="false" />
          <p class="timer-caption">{{ activeFocus.mode === 'break' ? 'Step away and reset.' : 'The timer survives page changes and app restarts.' }}</p>
          <button class="secondary-action danger" @click="cancelFocus">Stop session</button>
        </template>
        <template v-else>
          <select v-model="focusTaskId" class="field-control">
            <option :value="null">Independent study</option>
            <option v-for="task in todayTasks.filter(item => item.status === 'todo')" :key="task.id" :value="task.id">{{ task.title }}</option>
          </select>
          <div class="duration-options">
            <button v-for="minutes in [25, 50, 90, 180]" :key="minutes" :class="{ active: focusMinutes === minutes }" @click="focusMinutes = minutes">{{ minutes }}m</button>
          </div>
          <button class="primary-action wide" @click="beginFocus"><el-icon><Timer /></el-icon> Start focus</button>
          <button class="secondary-action wide" @click="beginBreak">Start 10-minute break</button>
        </template>
      </section>
    </div>

    <section class="panel calendar-panel">
      <div class="panel-heading calendar-heading">
        <div>
          <span class="eyebrow">Weekly schedule</span>
          <h2>{{ weekTitle }}</h2>
        </div>
        <div class="calendar-actions">
          <button @click="shiftWeek(-1)">‹</button>
          <button @click="goToday">Today</button>
          <button @click="shiftWeek(1)">›</button>
        </div>
      </div>
      <div class="week-timeline-scroll">
        <div
          class="week-timeline"
          :style="{ '--timeline-height': `${timelineHeight}px`, '--hour-height': `${timelineHourHeight}px` }"
        >
          <div class="timeline-header">
            <div class="timeline-corner">Time</div>
            <div
              v-for="day in weekDays"
              :key="day.key"
              class="timeline-day-header"
              :class="{ selected: selectedDate === day.key, today: day.key === toDateKey(now) }"
            >
              <button class="timeline-day-select" @click="selectedDate = day.key">
                <span>{{ day.weekday }}</span><strong>{{ day.label }}</strong>
              </button>
              <button class="timeline-header-add" :aria-label="`Add task on ${day.label}`" @click="openTaskDialog(day.key)">+</button>
            </div>
          </div>

          <div v-if="hasAnytimeTasks" class="all-day-row">
            <div class="all-day-label">Anytime</div>
            <div v-for="day in weekDays" :key="day.key" class="all-day-cell">
              <button
                v-for="task in anytimeTasksForDay(day.key)"
                :key="task.id"
                class="anytime-task"
                :class="{ done: task.status === 'done' }"
                :title="task.title"
                @click="selectedDate = day.key"
              >{{ task.title }}</button>
            </div>
          </div>

          <div class="timeline-body">
            <div class="time-ruler" :style="{ height: `${timelineHeight}px` }">
              <span
                v-for="hour in timelineHours"
                :key="hour"
                :style="{ top: `${(hour - timelineStartHour) * timelineHourHeight}px` }"
              >{{ String(hour).padStart(2, '0') }}:00</span>
            </div>
            <div
              v-for="day in weekDays"
              :key="day.key"
              class="timeline-day"
              :class="{ selected: selectedDate === day.key, today: day.key === toDateKey(now) }"
              :style="{ height: `${timelineHeight}px` }"
              @click="selectedDate = day.key"
            >
              <button
                v-for="task in scheduledTasksForDay(day.key)"
                :key="task.id"
                class="calendar-task"
                :class="{ done: task.status === 'done', compact: task.estimatedMinutes < 45 }"
                :style="calendarTaskStyle(task)"
                :title="`${task.startTime} · ${task.estimatedMinutes} min\n${task.title}`"
                @click.stop="selectedDate = day.key"
              >
                <span>{{ task.startTime }} · {{ task.estimatedMinutes }}m</span>
                <strong>{{ task.title }}</strong>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <el-dialog v-model="taskDialogOpen" title="Add study task" width="560px" append-to-body>
      <div class="task-form">
        <label>Course</label>
        <select v-model="taskForm.courseKey" class="field-control">
          <option value="">General / no course</option>
          <option v-for="course in dashboard.courses" :key="course.courseKey" :value="course.courseKey">
            {{ course.courseCode }} {{ course.courseName }}
          </option>
        </select>

        <label>Task</label>
        <input v-model="taskForm.title" class="field-control" placeholder="e.g. Complete row-reduction exercises 1–12">

        <label>Details / completion standard</label>
        <textarea v-model="taskForm.description" class="field-control textarea" placeholder="Textbook chapter, exercise numbers, target accuracy…" />

        <div class="form-row">
          <div><label>Date</label><input v-model="taskForm.scheduledDate" type="date" class="field-control"></div>
          <div><label>Start</label><input v-model="taskForm.startTime" type="time" class="field-control"></div>
          <div><label>Minutes</label><input v-model.number="taskForm.estimatedMinutes" type="number" min="1" max="720" class="field-control"></div>
        </div>

        <div class="form-row form-row--two">
          <div>
            <label>Priority</label>
            <select v-model.number="taskForm.priority" class="field-control">
              <option :value="1">P1 — High</option>
              <option :value="2">P2 — Normal</option>
              <option :value="3">P3 — Low</option>
            </select>
          </div>
          <div>
            <label>Linked note</label>
            <select v-model="taskForm.noteId" class="field-control" :disabled="!taskForm.courseKey || loadingNotes">
              <option value="">{{ loadingNotes ? 'Loading…' : 'No linked note' }}</option>
              <option v-for="note in availableNotes" :key="note.id" :value="note.id">{{ note.title }}</option>
            </select>
          </div>
        </div>

        <label class="reminder-toggle"><input v-model="taskForm.reminderEnabled" type="checkbox"> Notify me at the start time</label>
      </div>
      <template #footer>
        <button class="secondary-action" @click="taskDialogOpen = false">Cancel</button>
        <button class="primary-action" :disabled="savingTask" @click="saveTask">{{ savingTask ? 'Saving…' : 'Add task' }}</button>
      </template>
    </el-dialog>

    <el-dialog v-model="examDialogOpen" title="Add exam" width="500px" append-to-body>
      <div class="task-form">
        <label>Existing course</label>
        <select v-model="examForm.courseKey" class="field-control">
          <option value="">Enter a course name manually</option>
          <option v-for="course in dashboard.courses" :key="course.courseKey" :value="course.courseKey">
            {{ course.courseCode }} {{ course.courseName }}
          </option>
        </select>
        <template v-if="!examForm.courseKey">
          <label>Course name</label>
          <input v-model="examForm.courseName" class="field-control" placeholder="Algebra 1 Extended">
        </template>
        <div class="form-row">
          <div><label>Session</label><input v-model="examForm.examSession" class="field-control" placeholder="A or B"></div>
          <div><label>Date and time</label><input v-model="examForm.startsAt" type="datetime-local" class="field-control"></div>
          <div><label>Minutes</label><input v-model.number="examForm.durationMinutes" type="number" min="1" max="720" class="field-control"></div>
        </div>
        <label>Venue (optional)</label>
        <input v-model="examForm.venue" class="field-control" placeholder="Room or online link">
      </div>
      <template #footer>
        <button class="secondary-action" @click="examDialogOpen = false">Cancel</button>
        <button class="primary-action" :disabled="savingExam" @click="saveExam">{{ savingExam ? 'Saving…' : 'Add exam' }}</button>
      </template>
    </el-dialog>

    <StudyCsvImportDialog ref="csvDialog" @imported="reloadWeek" />
  </div>
</template>

<style scoped>
.study-page { flex: 1; min-height: 0; overflow-y: auto; padding: 24px 28px 36px; background: var(--bg-page); color: var(--text-b); }
.study-hero { display: grid; grid-template-columns: 1fr 220px auto; align-items: center; gap: 28px; padding: 22px 24px; border: 1px solid var(--border); border-radius: 16px; background: var(--bg-surface); box-shadow: var(--shadow-s); }
.eyebrow { font-size: 11px; font-weight: 800; letter-spacing: .8px; text-transform: uppercase; color: var(--accent-b); }
h1 { margin: 3px 0 0; font-size: 36px; line-height: 1; color: var(--text-h); font-variant-numeric: tabular-nums; }
h2 { margin: 3px 0 0; font-size: 17px; color: var(--text-h); }
.study-hero p { margin: 7px 0 0; color: var(--text-m); font-size: 13px; }
.hero-actions,.heading-actions { display: flex; align-items: center; gap: 8px; }.hero-actions { justify-content: flex-end; }
.hero-progress { display: grid; grid-template-columns: 1fr auto; gap: 5px 12px; color: var(--text-m); font-size: 12px; }
.hero-progress strong { color: var(--text-h); }.hero-progress :deep(.el-progress) { grid-column: 1 / -1; }
.primary-action,.secondary-action,.icon-action,.calendar-actions button,.task-actions button,.duration-options button { border: 1px solid var(--border-strong); border-radius: 8px; background: var(--bg-surface); color: var(--text-b); font: inherit; cursor: pointer; }
.primary-action { height: 38px; padding: 0 16px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border-color: var(--accent-b); background: var(--accent-b); color: #fff; font-size: 13px; font-weight: 700; }
.primary-action:disabled,.secondary-action:disabled { opacity: .55; cursor: wait; }.primary-action.wide,.secondary-action.wide { width: 100%; }
.secondary-action { height: 36px; padding: 0 14px; font-size: 12px; font-weight: 700; }.secondary-action.danger { color: #c2410c; border-color: #fed7aa; }
.exam-strip { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 14px 0; padding-right: 102px; }
.exam-card,.exam-empty { min-height: 74px; display: flex; align-items: center; gap: 14px; padding: 13px 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-surface); }
.exam-days { width: 48px; color: var(--accent-o); font-size: 24px; font-weight: 800; line-height: .9; text-align: center; }.exam-days small { display: block; margin-top: 5px; font-size: 9px; text-transform: uppercase; }
.exam-info { min-width: 0; flex: 1; }.exam-card strong,.exam-card span { display: block; }.exam-card strong { overflow: hidden; color: var(--text-h); font-size: 13px; white-space: nowrap; text-overflow: ellipsis; }.exam-card span { margin-top: 4px; color: var(--text-m); font-size: 11px; }
.exam-empty { grid-column: 1 / -1; color: var(--text-m); font-size: 12px; }.exam-empty .el-icon { color: var(--accent-o); font-size: 18px; }.exam-delete { border: 0; background: transparent; color: var(--text-m); cursor: pointer; font-size: 17px; }.exam-add { position: absolute; right: 0; top: 0; height: 100%; width: 90px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 1px dashed var(--border-strong); border-radius: 12px; background: transparent; color: var(--accent-b); cursor: pointer; font: inherit; font-size: 11px; font-weight: 700; }
.study-grid { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(300px, .75fr); gap: 14px; }
.panel { border: 1px solid var(--border); border-radius: 14px; background: var(--bg-surface); box-shadow: var(--shadow-s); overflow: hidden; }
.panel-heading { min-height: 68px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.icon-action { width: 32px; height: 32px; color: var(--accent-b); }
.text-action { height: 32px; padding: 0 10px; border: 1px solid var(--border-strong); border-radius: 7px; background: var(--bg-surface); color: var(--text-m); font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }.text-action.active { border-color: var(--accent-b); color: var(--accent-b); background: var(--chip-bg); }
.bulk-bar { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border); background: var(--bg-surface-alt); overflow-x: auto; }.bulk-bar button { flex-shrink: 0; height: 29px; padding: 0 9px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--bg-surface); color: var(--text-b); font: inherit; font-size: 10px; cursor: pointer; }.bulk-bar button:disabled { opacity: .45; cursor: not-allowed; }.bulk-bar strong { flex-shrink: 0; color: var(--accent-b); font-size: 10px; }.bulk-bar .bulk-delete { color: #b91c1c; border-color: #fecaca; }.bulk-spacer { flex: 1; min-width: 8px; }
.task-list { padding: 7px; }.empty-state { min-height: 150px; display: grid; place-items: center; padding: 24px; color: var(--text-m); font-size: 12px; text-align: center; }
.task-row { display: grid; grid-template-columns: 24px minmax(0,1fr) auto; gap: 10px; align-items: start; padding: 11px; border-radius: 10px; }.task-row:hover { background: var(--bg-surface-hover); }.task-row.done { opacity: .58; }.task-row.done strong { text-decoration: line-through; }
.task-row--bulk { grid-template-columns: 18px 24px minmax(0,1fr) auto; }.task-row.selected { background: var(--bg-surface-hover); box-shadow: inset 3px 0 0 var(--accent-b); }.bulk-checkbox { width: 16px; height: 16px; margin-top: 4px; accent-color: var(--accent-b); }
.task-check { width: 20px; height: 20px; display: grid; place-items: center; margin-top: 2px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--bg-surface); color: #fff; cursor: pointer; }.task-row.done .task-check { border-color: #16a34a; background: #16a34a; }
.task-title-line { display: flex; align-items: center; gap: 7px; }.task-title-line strong { color: var(--text-h); font-size: 13px; }.priority { padding: 2px 5px; border-radius: 4px; font-size: 9px; font-weight: 800; }.priority-1 { color: #b91c1c; background: #fee2e2; }.priority-2 { color: #1d4ed8; background: #dbeafe; }.priority-3 { color: #475569; background: #e2e8f0; }
.task-meta { display: flex; flex-wrap: wrap; gap: 7px 12px; margin-top: 5px; color: var(--text-m); font-size: 10.5px; }.task-meta span { display: inline-flex; align-items: center; gap: 3px; }.task-body p { margin: 7px 0 0; color: var(--text-m); font-size: 11px; line-height: 1.45; }
.task-actions { display: flex; gap: 4px; }.task-actions button { min-width: 28px; height: 28px; padding: 0 6px; color: var(--text-m); font-size: 10px; }.task-actions button:hover { color: var(--accent-b); border-color: var(--accent-b); }
.focus-panel { padding-bottom: 16px; }.focus-panel > :not(.panel-heading) { margin-left: 18px; margin-right: 18px; }.timer-display { margin-top: 26px !important; color: var(--text-h); font-size: 48px; font-weight: 800; line-height: 1; text-align: center; font-variant-numeric: tabular-nums; }.focus-panel :deep(.el-progress) { margin-top: 20px; }.timer-caption { min-height: 34px; color: var(--text-m); font-size: 11px; line-height: 1.45; text-align: center; }
.field-control { width: 100%; min-height: 36px; box-sizing: border-box; border: 1px solid var(--border-strong); border-radius: 8px; outline: 0; padding: 0 10px; background: var(--bg-surface-alt); color: var(--text-b); font: inherit; font-size: 12px; }.focus-panel > .field-control { width: calc(100% - 36px); margin-top: 18px; }.field-control:focus { border-color: var(--accent-b); }
.duration-options { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 10px; }.duration-options button { height: 32px; font-size: 11px; }.duration-options button.active { border-color: var(--accent-b); background: var(--chip-bg); color: var(--accent-b); font-weight: 800; }.focus-panel .primary-action,.focus-panel .secondary-action { margin-top: 10px; }
.calendar-panel { margin-top: 14px; }.calendar-heading { min-height: 62px; }.calendar-actions { display: flex; gap: 5px; }.calendar-actions button { height: 30px; min-width: 32px; padding: 0 10px; font-size: 11px; }
.week-timeline-scroll { max-height: 720px; overflow: auto; scrollbar-gutter: stable; }
.week-timeline { min-width: 1050px; background: var(--bg-surface); }
.timeline-header,.all-day-row,.timeline-body { display: grid; grid-template-columns: 54px repeat(7, minmax(138px,1fr)); }
.timeline-header { position: sticky; z-index: 8; top: 0; min-height: 48px; border-bottom: 1px solid var(--border); background: var(--bg-surface); }
.timeline-corner,.all-day-label { position: sticky; z-index: 9; left: 0; display: flex; align-items: center; justify-content: center; border-right: 1px solid var(--border); background: var(--bg-surface); color: var(--text-m); font-size: 9px; font-weight: 700; text-transform: uppercase; }
.timeline-day-header { display: grid; grid-template-columns: minmax(0,1fr) 28px; align-items: center; border-right: 1px solid var(--border); background: var(--bg-surface); }
.timeline-day-header.selected { background: var(--bg-surface-hover); }.timeline-day-header.today { box-shadow: inset 0 3px 0 var(--accent-b); }
.timeline-day-select { min-width: 0; height: 100%; display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 0 6px 0 10px; border: 0; background: transparent; color: var(--text-m); font: inherit; font-size: 10px; cursor: pointer; }.timeline-day-select strong { color: var(--text-h); }
.timeline-header-add { width: 24px; height: 24px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-surface); color: var(--text-m); font: inherit; cursor: pointer; }.timeline-header-add:hover { border-color: var(--accent-b); color: var(--accent-b); }
.all-day-row { position: sticky; z-index: 7; top: 48px; min-height: 36px; border-bottom: 1px solid var(--border); background: var(--bg-surface); }.all-day-cell { min-width: 0; padding: 5px; border-right: 1px solid var(--border); }.anytime-task { width: 100%; overflow: hidden; border: 1px solid var(--border); border-radius: 5px; padding: 4px 6px; background: var(--bg-surface-alt); color: var(--text-b); font: inherit; font-size: 9px; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; }.anytime-task.done { opacity: .5; text-decoration: line-through; }
.timeline-body { position: relative; }
.time-ruler { position: sticky; z-index: 4; left: 0; border-right: 1px solid var(--border); background: var(--bg-surface); }
.time-ruler span { position: absolute; right: 8px; transform: translateY(-50%); color: var(--text-m); font-size: 9px; font-variant-numeric: tabular-nums; }.time-ruler span:first-child { transform: translateY(4px); }.time-ruler span:last-child { transform: translateY(calc(-100% - 4px)); }
.timeline-day { position: relative; min-width: 0; border-right: 1px solid var(--border); cursor: pointer; background-color: var(--bg-surface); background-image: linear-gradient(to bottom, var(--border) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--border) 55%, transparent) 1px, transparent 1px); background-size: 100% var(--hour-height), 100% calc(var(--hour-height) / 2); }
.timeline-day.selected { background-color: var(--bg-surface-hover); }.timeline-day.today { background-color: color-mix(in srgb, var(--accent-b) 4%, var(--bg-surface)); }
.calendar-task { position: absolute; z-index: 2; left: 5px; width: calc(100% - 10px); min-height: 0; overflow: hidden; box-sizing: border-box; border: 1px solid var(--border-strong); border-radius: 7px; padding: 6px 7px; background: color-mix(in srgb, var(--accent-b) 8%, var(--bg-surface)); color: var(--text-b); text-align: left; cursor: pointer; transition: border-color .18s ease, box-shadow .18s ease, background-color .18s ease; }.calendar-task:hover { z-index: 3; border-color: var(--accent-b); box-shadow: var(--shadow-s); background: color-mix(in srgb, var(--accent-b) 12%, var(--bg-surface)); }.calendar-task span,.calendar-task strong { display: block; overflow: hidden; }.calendar-task span { color: var(--text-m); font-size: 9px; line-height: 1.2; white-space: nowrap; }.calendar-task strong { margin-top: 3px; font-size: 10.5px; line-height: 1.28; }.calendar-task.compact { padding-top: 4px; padding-bottom: 4px; }.calendar-task.compact span { display: inline; margin-right: 4px; }.calendar-task.compact strong { display: inline; margin-top: 0; font-size: 9.5px; white-space: nowrap; text-overflow: ellipsis; }.calendar-task.done { opacity: .5; }.calendar-task.done strong { text-decoration: line-through; }
.task-form { display: flex; flex-direction: column; gap: 7px; }.task-form label { margin-top: 4px; color: var(--text-m); font-size: 11px; font-weight: 700; }.textarea { min-height: 72px; padding: 9px 10px; resize: vertical; }.form-row { display: grid; grid-template-columns: 1.2fr .8fr .7fr; gap: 10px; }.form-row--two { grid-template-columns: .8fr 1.2fr; }.form-row > div { display: flex; flex-direction: column; gap: 7px; }.reminder-toggle { display: flex; align-items: center; gap: 7px; cursor: pointer; }
@media (max-width: 1100px) { .study-hero { grid-template-columns: 1fr auto; }.hero-progress { display: none; }.study-grid { grid-template-columns: 1fr; }.exam-strip { grid-template-columns: 1fr; }.exam-card { grid-column: 1; } }
</style>
