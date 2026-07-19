<script setup lang="ts">
import { computed, ref } from 'vue'
import { CircleCheck, Download, RefreshLeft, Upload } from '@element-plus/icons-vue'
import { notifyError, notifySuccess } from '../../composables/useUtils'
import type { CsvPreview, CsvTaskRow } from '../../types'

const emit = defineEmits<{ imported: [] }>()

const visible = ref(false)
const loading = ref(false)
const committing = ref(false)
const preview = ref<CsvPreview | null>(null)
const duplicateStrategy = ref<'skip' | 'update' | 'create'>('skip')
const result = ref<{ batchId: string; created: number; updated: number; skipped: number } | null>(null)
const undone = ref(false)

const validRows = computed(() => preview.value?.rows.filter((row) => !row.errors.length) ?? [])
const invalidRows = computed(() => preview.value?.rows.filter((row) => row.errors.length) ?? [])
const warningRows = computed(() => preview.value?.rows.filter((row) => row.warnings.length) ?? [])

const open = () => {
  visible.value = true
  preview.value = null
  result.value = null
  undone.value = false
  duplicateStrategy.value = 'skip'
}

defineExpose({ open })

const saveTemplate = async () => {
  try {
    const saved = await window.electronAPI.studyCsvSaveTemplate()
    if (!saved.canceled && saved.filePath) notifySuccess(`Template saved to ${saved.filePath}`, 'CSV template')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to save template', 'CSV template')
  }
}

const exportTasks = async () => {
  try {
    const exported = await window.electronAPI.studyCsvExport()
    if (!exported.canceled && exported.filePath) {
      notifySuccess(`Exported ${exported.count} tasks to ${exported.filePath}`, 'CSV export')
    }
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to export tasks', 'CSV export')
  }
}

const chooseCsv = async () => {
  loading.value = true
  try {
    const picked = await window.electronAPI.dialogOpenFile({
      title: 'Import study tasks from CSV',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (picked.canceled || !picked.filePaths.length) return
    preview.value = await window.electronAPI.studyCsvPreview({ filePath: picked.filePaths[0] }) as CsvPreview
    result.value = null
    undone.value = false
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to read CSV', 'CSV import')
  } finally {
    loading.value = false
  }
}

const validateRow = (row: CsvTaskRow) => {
  const retained = row.errors.filter((message) => message.startsWith('task id '))
  const errors = [...retained]
  row.title = row.title.trim()
  if (!row.title) errors.push('title is required')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.scheduledDate)) errors.push('date must use YYYY-MM-DD')
  if (row.startTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.startTime)) errors.push('start_time must use HH:mm')
  const minutes = Number(row.estimatedMinutes)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) {
    errors.push('duration_minutes must be between 1 and 720')
  }
  if (![1, 2, 3].includes(Number(row.priority))) errors.push('priority must be 1, 2, or 3')
  row.errors = errors
  row.action = errors.length ? 'invalid' : row.id ? 'update' : row.action === 'skip' ? 'skip' : 'create'
  row.reminderAt = row.reminderEnabled && row.scheduledDate && row.startTime && !errors.length
    ? new Date(`${row.scheduledDate}T${row.startTime}:00`).toISOString()
    : null
}

const commitImport = async () => {
  if (!preview.value || !validRows.value.length) return
  committing.value = true
  try {
    // Vue wraps preview rows in reactive proxies. Electron's IPC structured-clone
    // algorithm cannot serialize those proxies, so send a plain data snapshot.
    const rows = JSON.parse(JSON.stringify(validRows.value)) as CsvTaskRow[]
    result.value = await window.electronAPI.studyCsvCommit({
      fileName: preview.value.fileName,
      rows,
      duplicateStrategy: duplicateStrategy.value,
    })
    emit('imported')
    notifySuccess('CSV import completed.', 'Study Planner')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'CSV import failed', 'CSV import')
  } finally {
    committing.value = false
  }
}

const undoImport = async () => {
  if (!result.value || undone.value) return
  try {
    await window.electronAPI.studyCsvUndo({ batchId: result.value.batchId })
    undone.value = true
    emit('imported')
    notifySuccess('The imported changes were undone.', 'CSV import')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Failed to undo import', 'CSV import')
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="Import study tasks" width="92%" append-to-body class="csv-dialog">
    <div v-if="!preview && !result" class="import-start">
      <div class="import-option">
        <el-icon><Download /></el-icon>
        <div><strong>1. Generate a blank template</strong><p>Save a UTF-8 CSV with the supported column headers, then fill it in with Excel or another spreadsheet app.</p></div>
        <button class="secondary-btn" @click="saveTemplate">Save template</button>
      </div>
      <div class="import-option import-option--primary">
        <el-icon><Upload /></el-icon>
        <div><strong>2. Import a completed CSV</strong><p>You will review and edit every row before anything is written to the database.</p></div>
        <button class="primary-btn" :disabled="loading" @click="chooseCsv">{{ loading ? 'Reading…' : 'Choose CSV' }}</button>
      </div>
      <div class="import-option">
        <el-icon><Download /></el-icon>
        <div><strong>Export existing tasks for batch editing</strong><p>The exported file includes stable task IDs. Edit it in Excel and import it again to update existing rows.</p></div>
        <button class="secondary-btn" @click="exportTasks">Export all tasks</button>
      </div>
    </div>

    <template v-else-if="preview && !result">
      <div class="preview-toolbar">
        <div>
          <strong>{{ preview.fileName }}</strong>
          <span>{{ validRows.length }} ready · {{ warningRows.length }} warnings · {{ invalidRows.length }} invalid</span>
        </div>
        <div class="toolbar-actions">
          <button class="secondary-btn" @click="saveTemplate"><el-icon><Download /></el-icon> Template</button>
          <button class="secondary-btn" @click="chooseCsv"><el-icon><Upload /></el-icon> Replace file</button>
        </div>
      </div>

      <div v-if="preview.missingHeaders.length" class="import-alert import-alert--error" role="alert">
        Missing required columns: {{ preview.missingHeaders.join(', ') }}. Download the template and copy your data into it.
      </div>
      <div v-if="invalidRows.length" class="import-alert" role="alert">
        Invalid rows will not be imported. Edit the highlighted cells below; errors update when a field loses focus.
      </div>

      <div class="preview-table-wrap">
        <table class="preview-table">
          <thead><tr><th>Row</th><th>Action</th><th>Course</th><th>Title *</th><th>Date *</th><th>Start</th><th>Minutes</th><th>Priority</th><th>Reminder</th><th>Messages</th></tr></thead>
          <tbody>
            <tr v-for="row in preview.rows" :key="row.rowNumber" :class="{ 'row-invalid': row.errors.length, 'row-warning': !row.errors.length && row.warnings.length }">
              <td>{{ row.rowNumber }}</td>
              <td><span class="action-pill" :class="`action-${row.action}`">{{ row.action }}</span></td>
              <td><input v-model.trim="row.courseName" aria-label="Course name" @blur="validateRow(row)"></td>
              <td><input v-model.trim="row.title" aria-label="Task title" @blur="validateRow(row)"></td>
              <td><input v-model.trim="row.scheduledDate" aria-label="Scheduled date" @blur="validateRow(row)"></td>
              <td><input v-model.trim="row.startTime" aria-label="Start time" @blur="validateRow(row)"></td>
              <td><input v-model.number="row.estimatedMinutes" type="number" min="1" max="720" aria-label="Duration in minutes" @blur="validateRow(row)"></td>
              <td><select v-model.number="row.priority" aria-label="Priority" @change="validateRow(row)"><option :value="1">1</option><option :value="2">2</option><option :value="3">3</option></select></td>
              <td><input v-model="row.reminderEnabled" type="checkbox" aria-label="Reminder enabled" @change="validateRow(row)"></td>
              <td class="message-cell">
                <span v-for="message in row.errors" :key="message" class="error-message">{{ message }}</span>
                <span v-for="message in row.warnings" :key="message" class="warning-message">{{ message }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="import-footer-bar">
        <label>When a possible duplicate is found
          <select v-model="duplicateStrategy">
            <option value="skip">Skip it (safest)</option>
            <option value="update">Update the existing task</option>
            <option value="create">Create another task</option>
          </select>
        </label>
        <button class="primary-btn" :disabled="committing || !validRows.length || preview.missingHeaders.length > 0" @click="commitImport">
          {{ committing ? 'Importing…' : `Import ${validRows.length} valid rows` }}
        </button>
      </div>
    </template>

    <div v-else-if="result" class="import-result">
      <el-icon><CircleCheck /></el-icon>
      <h3>{{ undone ? 'Import undone' : 'Import complete' }}</h3>
      <p v-if="!undone">Created {{ result.created }}, updated {{ result.updated }}, skipped {{ result.skipped }}.</p>
      <p v-else>The tasks changed by this import have been restored.</p>
      <button v-if="!undone" class="secondary-btn danger" @click="undoImport"><el-icon><RefreshLeft /></el-icon> Undo this import</button>
      <button class="primary-btn" @click="visible = false">Done</button>
    </div>
  </el-dialog>
</template>

<style scoped>
.import-start { display: grid; gap: 12px; padding: 4px; }.import-option { display: grid; grid-template-columns: 42px minmax(0,1fr) auto; align-items: center; gap: 14px; padding: 18px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-surface-alt); }.import-option--primary { border-color: var(--accent-b); }.import-option > .el-icon { font-size: 25px; color: var(--accent-b); }.import-option strong { display: block; color: var(--text-h); font-size: 13px; }.import-option p { margin: 5px 0 0; color: var(--text-m); font-size: 11px; line-height: 1.5; }
.primary-btn,.secondary-btn { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--bg-surface); color: var(--text-b); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }.primary-btn { border-color: var(--accent-b); background: var(--accent-b); color: #fff; }.primary-btn:disabled { opacity: .5; cursor: not-allowed; }.secondary-btn.danger { color: #b91c1c; border-color: #fecaca; }
.preview-toolbar,.import-footer-bar { display: flex; align-items: center; justify-content: space-between; gap: 14px; }.preview-toolbar { margin-bottom: 12px; }.preview-toolbar strong,.preview-toolbar span { display: block; }.preview-toolbar strong { color: var(--text-h); font-size: 13px; }.preview-toolbar span { margin-top: 3px; color: var(--text-m); font-size: 11px; }.toolbar-actions { display: flex; gap: 7px; }
.import-alert { margin: 8px 0; padding: 10px 12px; border: 1px solid #fde68a; border-radius: 8px; background: #fffbeb; color: #92400e; font-size: 11px; }.import-alert--error { border-color: #fecaca; background: #fef2f2; color: #991b1b; }
.preview-table-wrap { max-height: 460px; overflow: auto; border: 1px solid var(--border); border-radius: 9px; }.preview-table { width: 100%; min-width: 1120px; border-collapse: collapse; background: var(--bg-surface); font-size: 11px; }.preview-table th { position: sticky; top: 0; z-index: 1; padding: 9px 7px; border-bottom: 1px solid var(--border); background: var(--bg-surface-alt); color: var(--text-m); text-align: left; }.preview-table td { padding: 6px; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }.preview-table input:not([type='checkbox']),.preview-table select { width: 100%; min-width: 82px; height: 30px; box-sizing: border-box; border: 1px solid transparent; border-radius: 5px; padding: 0 6px; background: transparent; color: var(--text-b); font: inherit; }.preview-table input:focus,.preview-table select:focus { outline: 0; border-color: var(--accent-b); background: var(--bg-surface); }.row-invalid { background: rgba(254,226,226,.45); }.row-warning { background: rgba(254,243,199,.35); }.message-cell { min-width: 220px; }.error-message,.warning-message { display: block; line-height: 1.35; }.error-message { color: #b91c1c; }.warning-message { color: #a16207; }.action-pill { display: inline-flex; padding: 2px 6px; border-radius: 999px; font-size: 9px; font-weight: 800; text-transform: uppercase; }.action-create { color: #166534; background: #dcfce7; }.action-update { color: #1d4ed8; background: #dbeafe; }.action-skip { color: #854d0e; background: #fef3c7; }.action-invalid { color: #991b1b; background: #fee2e2; }
.import-footer-bar { margin-top: 14px; }.import-footer-bar label { display: flex; align-items: center; gap: 9px; color: var(--text-m); font-size: 11px; }.import-footer-bar select { height: 34px; border: 1px solid var(--border-strong); border-radius: 7px; background: var(--bg-surface); color: var(--text-b); padding: 0 8px; }
.import-result { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; }.import-result > .el-icon { font-size: 52px; color: #16a34a; }.import-result h3 { margin: 0; color: var(--text-h); font-size: 20px; }.import-result p { margin: 0 0 8px; color: var(--text-m); font-size: 12px; }
@media (max-width: 820px) { .import-option { grid-template-columns: 36px 1fr; }.import-option button { grid-column: 1 / -1; }.preview-toolbar,.import-footer-bar { align-items: stretch; flex-direction: column; }.toolbar-actions { width: 100%; }.toolbar-actions button { flex: 1; } }
</style>
