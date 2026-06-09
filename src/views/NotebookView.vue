<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  DocumentAdd,
  FolderOpened,
  Link,
  Notebook,
  Refresh,
  View,
} from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import { useDashboard } from '../composables/useDashboard'
import { notifyError, notifySuccess, notifyWarning } from '../composables/useUtils'
import type { NotebookCourse, NotebookIndex, NotebookItem, UnifiedCourse } from '../types'

const { dashboard, dashboardCourses, loadDashboard } = useDashboard()

const selectedCourseKey = ref('')
const selectedNoteId = ref('')
const courseScope = ref<'current' | 'all'>('current')
const courseSearch = ref('')
const notebookIndex = ref<NotebookIndex | null>(null)
const courseDir = ref('')
const noteSource = ref('')
const noteHtml = ref('')
const noteTitle = ref('')
const loadingNotebook = ref(false)
const loadingNote = ref(false)
const saving = ref(false)
const notebookMode = ref<'index' | 'note'>('index')
const previewMode = ref<'single' | 'course'>('single')
const draggingNoteId = ref('')
const dragOverNoteId = ref('')

const currentCourseKeys = computed(() => new Set(dashboardCourses.value.map((course) => course.courseKey)))
const hasCurrentCourses = computed(() => currentCourseKeys.value.size > 0)
const courses = computed(() => {
  const query = courseSearch.value.trim().toLowerCase()
  const source = courseScope.value === 'current' && hasCurrentCourses.value
    ? dashboardCourses.value
    : dashboard.value.courses
  const filtered = query
    ? source.filter((course) =>
      [
        course.courseCode,
        course.courseName,
        course.semesterLabel,
        course.semesterTechnion,
      ].some((value) => value.toLowerCase().includes(query)),
    )
    : source
  return [...filtered].sort((a, b) => {
    const aCurrent = currentCourseKeys.value.has(a.courseKey) ? 0 : 1
    const bCurrent = currentCourseKeys.value.has(b.courseKey) ? 0 : 1
    if (aCurrent !== bCurrent) return aCurrent - bCurrent
    return (a.courseCode || a.courseName).localeCompare(b.courseCode || b.courseName)
  })
})
const selectedCourse = computed(() =>
  dashboard.value.courses.find((course) => course.courseKey === selectedCourseKey.value) ?? null,
)
const selectedNotebookCourse = computed<NotebookCourse | null>(() => {
  const course = selectedCourse.value
  if (!course) return null
  return toNotebookCourse(course)
})
const notes = computed(() => notebookIndex.value?.items ?? [])
const mirrorNotes = computed(() => notes.value.filter((note) => note.sourceType === 'html-import' && note.sourcePath))
const selectedNote = computed(() =>
  notes.value.find((note) => note.id === selectedNoteId.value) ?? null,
)
const canEditCurrentNote = computed(() => selectedNote.value?.sourceType === 'markdown')
const hasNotebook = computed(() => Boolean(selectedNotebookCourse.value))

const toNotebookCourse = (course: UnifiedCourse): NotebookCourse => ({
  courseKey: course.courseKey,
  courseCode: course.courseCode || course.courseKey,
  courseName: course.courseName || course.courseCode || course.courseKey,
})

const refreshNotebook = async (preserveNoteId = true) => {
  const course = selectedNotebookCourse.value
  if (!course) {
    notebookIndex.value = null
    courseDir.value = ''
    return
  }
  const previousNoteId = preserveNoteId ? selectedNoteId.value : ''
  loadingNotebook.value = true
  try {
    const result = await window.electronAPI.notebookCourseGet({ course })
    notebookIndex.value = result.index
    courseDir.value = result.courseDir
    const nextNote = previousNoteId && result.index.items.some((item) => item.id === previousNoteId)
      ? previousNoteId
      : ''
    selectedNoteId.value = nextNote
    if (notebookMode.value === 'note' && nextNote) await loadNote(nextNote)
    else clearCurrentNote()
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to load notebook', 'Notebook')
  } finally {
    loadingNotebook.value = false
  }
}

const clearCurrentNote = () => {
  selectedNoteId.value = ''
  noteSource.value = ''
  noteHtml.value = ''
  noteTitle.value = ''
  previewMode.value = 'single'
}

const loadNote = async (noteId: string) => {
  const course = selectedNotebookCourse.value
  if (!course || !noteId) return
  loadingNote.value = true
  notebookMode.value = 'note'
  previewMode.value = 'single'
  try {
    const result = await window.electronAPI.notebookReadNote({ course, noteId })
    selectedNoteId.value = result.item.id
    noteTitle.value = result.item.title
    noteSource.value = result.source
    noteHtml.value = result.html
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to open note', 'Notebook')
  } finally {
    loadingNote.value = false
  }
}

const createMarkdownNote = async () => {
  const course = selectedNotebookCourse.value
  if (!course) return
  try {
    const title = await ElMessageBox.prompt('Name this note or lecture.', 'New Markdown Note', {
      confirmButtonText: 'Create',
      cancelButtonText: 'Cancel',
      inputValue: `Lecture ${notes.value.length + 1}`,
      inputPattern: /\S+/,
      inputErrorMessage: 'Title is required',
    })
    const item = await window.electronAPI.notebookCreateMarkdown({
      course,
      title: title.value,
    })
    await refreshNotebook(false)
    notebookMode.value = 'index'
    selectedNoteId.value = item.id
    notifySuccess('Markdown note created', 'Notebook')
  } catch (error) {
    if (error === 'cancel') return
    notifyError(error instanceof Error ? error.message : 'Failed to create note', 'Notebook')
  }
}

const importHtmlNote = async () => {
  const course = selectedNotebookCourse.value
  if (!course) return
  try {
    const result = await window.electronAPI.dialogOpenFile({
      title: 'Import HTML notes',
      filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
    })
    if (result.canceled || !result.filePaths.length) return
    const imported = await window.electronAPI.notebookImportHtmlFiles({
      course,
      filePaths: result.filePaths,
    })
    await refreshNotebook(false)
    notebookMode.value = 'index'
    selectedNoteId.value = imported.items[0]?.id || ''
    const assetText = imported.copiedAssets.length
      ? `, copied ${imported.copiedAssets.length} asset file(s)`
      : ''
    notifySuccess(`Imported ${imported.items.length} HTML note(s)${assetText}`, 'Notebook')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to import HTML', 'Notebook')
  }
}

const importHtmlFolder = async () => {
  const course = selectedNotebookCourse.value
  if (!course) return
  try {
    const result = await window.electronAPI.dialogOpenDirectory({
      title: 'Import HTML notes folder',
    })
    if (result.canceled || !result.filePaths.length) return
    const imported = await window.electronAPI.notebookImportHtmlDirectory({
      course,
      directory: result.filePaths[0],
    })
    await refreshNotebook(false)
    notebookMode.value = 'index'
    selectedNoteId.value = imported.items[0]?.id || ''
    const assetText = imported.copiedAssets.length
      ? `, copied ${imported.copiedAssets.length} asset file(s)`
      : ''
    notifySuccess(`Imported ${imported.items.length} HTML note(s)${assetText}`, 'Notebook')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to import HTML folder', 'Notebook')
  }
}

const syncMirrorSources = async () => {
  const course = selectedNotebookCourse.value
  if (!course || !mirrorNotes.value.length) return
  try {
    const result = await window.electronAPI.notebookSyncSources({ course })
    notebookIndex.value = result.index
    const missingText = result.missing.length ? `, ${result.missing.length} missing source(s)` : ''
    const assetText = result.copiedAssets.length ? `, copied ${result.copiedAssets.length} asset file(s)` : ''
    notifySuccess(`Synced ${result.synced} mirrored note(s)${assetText}${missingText}`, 'Notebook')
    if (notebookMode.value === 'note' && selectedNoteId.value) {
      await loadNote(selectedNoteId.value)
    }
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to sync sources', 'Notebook')
  }
}

const saveMarkdownNote = async () => {
  const course = selectedNotebookCourse.value
  const note = selectedNote.value
  if (!course || !note || note.sourceType !== 'markdown') return
  saving.value = true
  try {
    const result = await window.electronAPI.notebookSaveMarkdown({
      course,
      noteId: note.id,
      title: noteTitle.value,
      source: noteSource.value,
    })
    noteHtml.value = result.html
    noteTitle.value = result.item.title
    await refreshNotebook(true)
    notifySuccess('Note saved and rendered to HTML', 'Notebook')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to save note', 'Notebook')
  } finally {
    saving.value = false
  }
}

const renderCoursePreview = async () => {
  const course = selectedNotebookCourse.value
  if (!course) return
  try {
    const result = await window.electronAPI.notebookRenderCourse({ course })
    notebookMode.value = 'note'
    selectedNoteId.value = ''
    noteTitle.value = `${course.courseName} Notes`
    noteSource.value = ''
    previewMode.value = 'course'
    noteHtml.value = result.html
    notifySuccess('Course HTML regenerated', 'Notebook')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to render course', 'Notebook')
  }
}

const openCurrentNote = async () => {
  const course = selectedNotebookCourse.value
  const note = selectedNote.value
  if (!course || !note) return
  try {
    await window.electronAPI.notebookOpenNote({ course, noteId: note.id })
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to open note', 'Notebook')
  }
}

const openCourseHtml = async () => {
  const course = selectedNotebookCourse.value
  if (!course) return
  try {
    await window.electronAPI.notebookOpenCourse({ course })
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to open course HTML', 'Notebook')
  }
}

const openCourseFolder = async () => {
  const course = selectedNotebookCourse.value
  if (!course) return
  try {
    await window.electronAPI.notebookOpenCourseFolder({ course })
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to open notebook folder', 'Notebook')
  }
}

const reorderNotes = async (orderedNotes: NotebookItem[]) => {
  const course = selectedNotebookCourse.value
  if (!course) return
  try {
    notebookIndex.value = await window.electronAPI.notebookReorderNotes({
      course,
      noteIds: orderedNotes.map((entry) => entry.id),
    })
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to reorder notes', 'Notebook')
  }
}

const startNoteDrag = (event: DragEvent, note: NotebookItem) => {
  draggingNoteId.value = note.id
  event.dataTransfer?.setData('text/plain', note.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

const overNoteDrag = (event: DragEvent, note: NotebookItem) => {
  if (!draggingNoteId.value || draggingNoteId.value === note.id) return
  event.preventDefault()
  dragOverNoteId.value = note.id
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

const dropNote = async (event: DragEvent, targetNote: NotebookItem) => {
  event.preventDefault()
  const sourceId = draggingNoteId.value || event.dataTransfer?.getData('text/plain')
  draggingNoteId.value = ''
  dragOverNoteId.value = ''
  if (!sourceId || sourceId === targetNote.id) return
  const next = [...notes.value]
  const sourceIndex = next.findIndex((note) => note.id === sourceId)
  const targetIndex = next.findIndex((note) => note.id === targetNote.id)
  if (sourceIndex < 0 || targetIndex < 0) return
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  if (notebookIndex.value) {
    notebookIndex.value = {
      ...notebookIndex.value,
      items: next,
    }
  }
  await reorderNotes(next)
}

const endNoteDrag = () => {
  draggingNoteId.value = ''
  dragOverNoteId.value = ''
}

const deleteNote = async (note: NotebookItem) => {
  const course = selectedNotebookCourse.value
  if (!course) return
  try {
    await ElMessageBox.confirm(
      `Delete "${note.title}" from this course notebook? This removes the local source and HTML files.`,
      'Delete Note',
      {
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel',
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      },
    )
    notebookIndex.value = await window.electronAPI.notebookDeleteNote({
      course,
      noteId: note.id,
    })
    if (selectedNoteId.value === note.id) clearCurrentNote()
    notifySuccess('Note deleted', 'Notebook')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    notifyError(error instanceof Error ? error.message : 'Failed to delete note', 'Notebook')
  }
}

const selectCourse = (course: UnifiedCourse) => {
  selectedCourseKey.value = course.courseKey
  notebookMode.value = 'index'
}

const backToIndex = () => {
  notebookMode.value = 'index'
  previewMode.value = 'single'
}

const selectFirstVisibleCourse = () => {
  if (courses.value.some((course) => course.courseKey === selectedCourseKey.value)) return
  selectedCourseKey.value = courses.value[0]?.courseKey || ''
}

const sourceTypeLabel = (note: NotebookItem) => {
  if (note.sourceType === 'markdown') return 'MD'
  if (note.sourceType === 'html-import') return note.sourcePath ? 'HTML mirror' : 'HTML copy'
  return 'RICH'
}

watch(selectedCourseKey, () => {
  void refreshNotebook(false)
})

watch([courseScope, courseSearch, courses], () => {
  selectFirstVisibleCourse()
})

onMounted(async () => {
  if (!dashboard.value.courses.length) {
    try {
      await loadDashboard()
    } catch {
      notifyWarning('No course data yet. Sync first to populate notebooks.', 'Notebook')
    }
  }
  if (!selectedCourseKey.value && courses.value.length) {
    if (!hasCurrentCourses.value) courseScope.value = 'all'
    selectedCourseKey.value = courses.value[0].courseKey
  }
})
</script>

<template>
  <div class="notebook-layout" :class="{ 'notebook-layout--note': notebookMode === 'note' }">
    <template v-if="notebookMode === 'index'">
    <aside class="course-rail">
      <div class="rail-header">
        <div>
          <div class="eyebrow">Notebook</div>
          <h2>Courses</h2>
        </div>
        <button class="icon-btn" title="Refresh" @click="refreshNotebook(true)">
          <el-icon><Refresh /></el-icon>
        </button>
      </div>

      <div v-if="dashboard.courses.length" class="course-filter">
        <div class="scope-tabs">
          <button
            :class="{ 'scope-tab--active': courseScope === 'current' }"
            :disabled="!hasCurrentCourses"
            @click="courseScope = 'current'"
          >
            Current
          </button>
          <button
            :class="{ 'scope-tab--active': courseScope === 'all' }"
            @click="courseScope = 'all'"
          >
            All
          </button>
        </div>
        <input
          v-model="courseSearch"
          class="course-search"
          placeholder="Search courses"
        >
      </div>
      <div v-if="!courses.length" class="empty-panel">
        {{ dashboard.courses.length ? 'No matching courses.' : 'Sync course data first.' }}
      </div>
      <div class="course-list">
        <button
          v-for="course in courses"
          :key="course.courseKey"
          class="course-row"
          :class="{ 'course-row--active': selectedCourseKey === course.courseKey }"
          @click="selectCourse(course)"
        >
          <span class="course-code">
            {{ course.courseCode || '-' }}
            <span v-if="currentCourseKeys.has(course.courseKey)" class="current-pill">Current</span>
          </span>
          <span class="course-name">{{ course.courseName }}</span>
          <span v-if="course.semesterLabel || course.semesterTechnion" class="course-term">
            {{ course.semesterLabel || course.semesterTechnion }}
          </span>
        </button>
      </div>
    </aside>

    <section class="index-panel">
      <div class="panel-header">
        <div>
          <div class="eyebrow">Index</div>
          <h2>{{ selectedCourse?.courseName || 'No course selected' }}</h2>
          <p v-if="courseDir" class="path-line" :title="courseDir">{{ courseDir }}</p>
        </div>
      </div>

      <div class="toolbar">
        <button class="tool-btn" :disabled="!hasNotebook" @click="createMarkdownNote">
          <el-icon><DocumentAdd /></el-icon>
          New MD
        </button>
        <button class="tool-btn" :disabled="!hasNotebook" @click="importHtmlNote">
          <el-icon><Link /></el-icon>
          Import HTML
        </button>
        <button class="tool-btn" :disabled="!hasNotebook" @click="importHtmlFolder">
          <el-icon><FolderOpened /></el-icon>
          Import Folder
        </button>
        <button class="tool-btn" :disabled="!hasNotebook" @click="openCourseFolder">
          <el-icon><FolderOpened /></el-icon>
          Folder
        </button>
        <button class="tool-btn" :disabled="!mirrorNotes.length" @click="syncMirrorSources">
          <el-icon><Refresh /></el-icon>
          Sync Sources
        </button>
        <button class="tool-btn" :disabled="!notes.length" @click="renderCoursePreview">
          Aggregate
        </button>
        <button class="tool-btn" :disabled="!notes.length" @click="openCourseHtml">
          Open Course
        </button>
      </div>

      <div v-if="loadingNotebook" class="empty-panel">Loading notebook...</div>
      <div v-else-if="!notes.length" class="empty-panel">
        Create a Markdown note or import an HTML file.
      </div>
      <div v-else class="note-list">
        <button
          v-for="(note, index) in notes"
          :key="note.id"
          class="note-row"
          :class="{
            'note-row--active': selectedNoteId === note.id,
            'note-row--dragging': draggingNoteId === note.id,
            'note-row--drop-target': dragOverNoteId === note.id,
          }"
          @dragover="overNoteDrag($event, note)"
          @drop="dropNote($event, note)"
          @click="loadNote(note.id)"
        >
          <span
            class="note-order"
            title="Drag to reorder"
            draggable="true"
            @dragstart.stop="startNoteDrag($event, note)"
            @dragend="endNoteDrag"
          >
            {{ index + 1 }}
          </span>
          <span class="note-main">
            <span class="note-title">{{ note.title }}</span>
            <span class="note-meta">{{ sourceTypeLabel(note) }} / {{ note.file }}</span>
            <span v-if="note.sourcePath" class="note-source" :title="note.sourcePath">
              Source: {{ note.sourcePath }}
            </span>
          </span>
          <span class="note-move">
            <button class="note-delete-btn" title="Delete note" @click.stop="deleteNote(note)">Delete</button>
          </span>
        </button>
      </div>
    </section>
    </template>

    <main v-if="notebookMode === 'note'" class="reader-panel">
      <div class="reader-toolbar">
        <div class="reader-title">
          <button class="tool-btn" @click="backToIndex">
            Back
          </button>
          <el-icon><Notebook /></el-icon>
          <input
            v-model="noteTitle"
            class="title-input"
            :disabled="!canEditCurrentNote"
            placeholder="Select or create a note"
          >
        </div>
        <div class="reader-actions">
          <button class="tool-btn" :disabled="!selectedNote" @click="openCurrentNote">
            <el-icon><View /></el-icon>
            Open
          </button>
          <button class="primary-btn" :disabled="!canEditCurrentNote || saving" @click="saveMarkdownNote">
            {{ saving ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </div>

      <div v-if="loadingNote" class="workspace-empty">Loading note...</div>
      <div v-else-if="!selectedNote && previewMode === 'single'" class="workspace-empty">
        Pick a course note from the index.
      </div>
      <div v-else class="workspace">
        <section class="editor-pane" :class="{ 'editor-pane--readonly': !canEditCurrentNote }">
          <div class="pane-label">
            {{ canEditCurrentNote ? 'Markdown Source' : 'Imported HTML is read-only in app' }}
          </div>
          <textarea
            v-if="canEditCurrentNote"
            v-model="noteSource"
            spellcheck="false"
            class="source-editor"
          />
          <pre v-else class="source-preview">{{ noteSource }}</pre>
        </section>

        <section class="preview-pane">
          <div class="pane-label">
            {{ previewMode === 'course' ? 'Aggregated Course HTML' : 'HTML Preview' }}
          </div>
          <iframe
            class="html-preview"
            sandbox=""
            :srcdoc="noteHtml"
          />
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.notebook-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  background: var(--bg-page);
  color: var(--text-b);
  overflow: hidden;
}

.notebook-layout--note {
  display: flex;
  flex-direction: column;
}

.course-rail,
.index-panel,
.reader-panel {
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-surface);
}

.course-rail,
.index-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.reader-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  background: var(--bg-page);
  border-right: 0;
}

.rail-header,
.panel-header,
.reader-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 18px 14px;
  border-bottom: 1px solid var(--border);
}

.eyebrow {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-b);
  text-transform: uppercase;
}

h2 {
  margin: 2px 0 0;
  font-size: 16px;
  line-height: 1.25;
  color: var(--text-h);
}

.path-line {
  max-width: 250px;
  margin: 6px 0 0;
  color: var(--text-m);
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.course-row,
.note-row {
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.course-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.course-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.course-list::-webkit-scrollbar,
.note-list::-webkit-scrollbar,
.source-editor::-webkit-scrollbar,
.source-preview::-webkit-scrollbar {
  width: 6px;
}

.course-list::-webkit-scrollbar-track,
.note-list::-webkit-scrollbar-track,
.source-editor::-webkit-scrollbar-track,
.source-preview::-webkit-scrollbar-track {
  background: transparent;
}

.course-list::-webkit-scrollbar-thumb,
.note-list::-webkit-scrollbar-thumb,
.source-editor::-webkit-scrollbar-thumb,
.source-preview::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 999px;
}

.course-row:hover,
.course-row--active {
  background: var(--bg-surface-hover);
}

.course-row--active {
  box-shadow: inset 3px 0 0 var(--accent-b);
}

.course-code {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--accent-b);
  font-size: 12px;
  font-weight: 700;
}

.course-name {
  color: var(--text-b);
  font-size: 13px;
  line-height: 1.35;
}

.course-term {
  color: var(--text-m);
  font-size: 11px;
  line-height: 1.3;
}

.course-filter {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
}

.scope-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.scope-tabs button {
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-surface);
  color: var(--text-m);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.scope-tabs button:hover,
.scope-tabs .scope-tab--active {
  border-color: var(--accent-b);
  color: var(--accent-b);
  background: var(--bg-surface-hover);
}

.scope-tabs button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.course-search {
  width: 100%;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-surface-alt);
  color: var(--text-b);
  padding: 0 10px;
  outline: 0;
  font: inherit;
  font-size: 12px;
}

.course-search:focus {
  border-color: var(--accent-b);
}

.current-pill {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--tag-s-bg);
  border: 1px solid var(--tag-s-border);
  color: var(--tag-s-text);
  font-size: 10px;
  font-weight: 700;
}

.toolbar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
}

.tool-btn,
.primary-btn,
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  background: var(--bg-surface);
  color: var(--text-b);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.icon-btn {
  width: 32px;
}

.tool-btn:hover,
.icon-btn:hover {
  color: var(--accent-b);
  border-color: var(--accent-b);
}

.tool-btn:disabled,
.primary-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.primary-btn {
  min-width: 76px;
  background: var(--accent-b);
  border-color: var(--accent-b);
  color: #fff;
}

.note-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
}

.note-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 8px;
}

.note-row:hover,
.note-row--active {
  background: var(--bg-surface-hover);
  border-color: var(--border);
}

.note-row--active {
  border-color: var(--accent-b);
}

.note-row--dragging {
  opacity: 0.5;
}

.note-row--drop-target {
  border-color: var(--accent-b);
  background: var(--bg-surface-hover);
  box-shadow: inset 3px 0 0 var(--accent-b);
}

.note-order {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--chip-bg);
  color: var(--text-m);
  font-size: 12px;
  font-weight: 700;
  cursor: grab;
  user-select: none;
}

.note-order:active {
  cursor: grabbing;
}

.note-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.note-title {
  color: var(--text-h);
  font-size: 13px;
  font-weight: 700;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.note-meta {
  color: var(--text-m);
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.note-source {
  color: var(--text-f);
  font-size: 10px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.note-move {
  display: flex;
  gap: 3px;
}

.note-move button {
  height: 22px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-surface);
  color: var(--text-m);
  font-size: 10px;
  padding: 0 5px;
  cursor: pointer;
}

.note-move .note-delete-btn {
  min-width: 48px;
  color: #c2410c;
  border-color: #fed7aa;
}

.note-move .note-delete-btn:hover {
  background: #fff7ed;
  border-color: #fb923c;
}

.reader-toolbar {
  background: var(--bg-surface);
}

.reader-title {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.reader-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title-input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-h);
  font-size: 16px;
  font-weight: 700;
}

.workspace,
.workspace-empty {
  flex: 1;
  min-height: 0;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(320px, 0.95fr) minmax(360px, 1.05fr);
  gap: 12px;
  padding: 12px;
}

.workspace-empty,
.empty-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 18px;
  color: var(--text-m);
  font-size: 13px;
  text-align: center;
}

.editor-pane,
.preview-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-surface);
  overflow: hidden;
}

.pane-label {
  flex-shrink: 0;
  height: 34px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-m);
  font-size: 12px;
  font-weight: 700;
}

.source-editor,
.source-preview {
  flex: 1;
  min-height: 0;
  width: 100%;
  margin: 0;
  padding: 16px;
  border: 0;
  outline: 0;
  resize: none;
  background: var(--bg-surface-alt);
  color: var(--text-b);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 13px;
  line-height: 1.65;
  overflow: auto;
}

.source-preview {
  white-space: pre-wrap;
}

.editor-pane--readonly {
  opacity: 0.92;
}

.html-preview {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 0;
  background: #fff;
}

@media (max-width: 1180px) {
  .notebook-layout {
    grid-template-columns: 260px minmax(0, 1fr);
  }

  .workspace {
    grid-template-columns: 1fr;
  }
}
</style>
