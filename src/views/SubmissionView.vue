<script setup lang="ts">
import { ArrowRight, Back, Delete, Document, Download, Refresh, Upload } from '@element-plus/icons-vue'
import { useSubmission } from '../composables/useSubmission'
import { useTimeline } from '../composables/useTimeline'
import { formatBytes } from '../composables/useUtils'

const props = withDefaults(defineProps<{
  backTarget?: 'course' | 'dashboard'
}>(), {
  backTarget: 'dashboard',
})

defineEmits<{
  back: []
}>()

const {
  submissionEvent,
  submissionAssignment,
  submissionStatus,
  submissionLoading,
  selectedFiles,
  submitting,
  submissionDueDate,
  submissionStatusLabel,
  totalSelectedSize,
  handleSelectFiles,
  handleRemoveFile,
  handleSubmit,
} = useSubmission()

const { shortCourseName } = useTimeline()

const getAttExt = (filename: string) => {
  const parts = filename.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'FILE'
}

const getAttExtColor = (filename: string) => {
  const ext = getAttExt(filename)
  const map: Record<string, string> = {
    PDF: '#e74c3c',
    DOC: '#2980b9', DOCX: '#2980b9',
    PPT: '#e67e22', PPTX: '#e67e22',
    XLS: '#27ae60', XLSX: '#27ae60',
    ZIP: '#8e44ad', RAR: '#8e44ad',
  }
  return map[ext] ?? '#555e6a'
}

const isForceDownloadUrl = (url: string) => /[?&]forcedownload=1(?:&|$)/i.test(url)

const withForcedownload = (url: string, value: '0' | '1') => {
  try {
    const u = new URL(url)
    u.searchParams.set('forcedownload', value)
    return u.toString()
  } catch {
    return url
  }
}

const openAttachment = async (file: { filename: string; fileurl: string; mimetype?: string }) => {
  const isPdf = file.mimetype === 'application/pdf' || file.filename.toLowerCase().endsWith('.pdf')
  const forceDownload = isForceDownloadUrl(file.fileurl)
  if (forceDownload) {
    await window.electronAPI.downloadAndOpenFile({
      url: file.fileurl,
      filename: file.filename,
    })
    return
  }
  if (isPdf) {
    try {
      await window.electronAPI.openPdfViewer({
        url: withForcedownload(file.fileurl, '0'),
        title: file.filename,
      })
    } catch {
      await window.electronAPI.downloadAndOpenFile({
        url: withForcedownload(file.fileurl, '1'),
        filename: file.filename,
      })
    }
  } else {
    window.open(file.fileurl, '_blank')
  }
}

const formatGradedAt = (timestamp: number | null) => {
  if (!timestamp) return '评分时间未知'
  return new Date(timestamp * 1000).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const backButtonText = computed(() => (props.backTarget === 'course' ? 'Back to Course' : 'Back to Dashboard'))
</script>

<template>
  <div class="submission-page">
    <div class="sub-topbar">
      <button class="sub-back-btn" @click="$emit('back')">
        <el-icon><Back /></el-icon>
        {{ backButtonText }}
      </button>
      <span class="sub-breadcrumb">
        {{ shortCourseName(submissionEvent?.coursename ?? '') }}
      </span>
    </div>

    <div v-if="submissionLoading" class="sub-loading">
      <el-icon class="is-loading"><Refresh /></el-icon>
      Loading assignment details...
    </div>

    <div v-else-if="submissionAssignment" class="sub-content">
      <div class="sub-header">
        <div class="sub-title-row">
          <h1 class="sub-title">{{ submissionAssignment.name }}</h1>
          <div
            class="sub-status-badge"
            :style="{ background: submissionStatusLabel.color + '22', color: submissionStatusLabel.color, borderColor: submissionStatusLabel.color + '55' }"
          >
            {{ submissionStatusLabel.text }}
          </div>
        </div>
        <div class="sub-meta-row">
          <span class="sub-meta-item">
            <el-icon><Document /></el-icon>
            Due:&nbsp;
            <strong>
              {{ submissionDueDate
                ? submissionDueDate.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : 'No due date' }}
            </strong>
          </span>
          <span class="sub-meta-item">
            <el-icon><Document /></el-icon>
            Max {{ submissionAssignment.maxFileSubmissions }} file{{ submissionAssignment.maxFileSubmissions !== 1 ? 's' : '' }}
          </span>
          <span class="sub-meta-item sub-meta-types">
            {{ submissionAssignment.allowedFileTypes || 'All file types accepted' }}
          </span>
        </div>
      </div>

      <div v-if="submissionAssignment.intro" class="sub-section">
        <div class="sub-section-title">Assignment Description</div>
        <div class="sub-intro" v-html="submissionAssignment.intro" />
      </div>

      <div v-if="submissionAssignment.introAttachments?.length" class="sub-section">
        <div class="sub-section-title">
          <el-icon><Download /></el-icon>
          Assignment Files
        </div>
        <div class="sub-file-list">
          <div
            v-for="file in submissionAssignment.introAttachments"
            :key="file.fileurl"
            class="sub-attachment-file"
            @click="openAttachment(file)"
          >
            <div class="sub-att-ext" :style="{ background: getAttExtColor(file.filename) }">
              {{ getAttExt(file.filename) }}
            </div>
            <div class="sub-att-info">
              <span class="sub-file-name">{{ file.filename }}</span>
              <span class="sub-file-size">{{ formatBytes(file.filesize) }}</span>
            </div>
            <el-icon class="sub-att-action"><Download /></el-icon>
          </div>
        </div>
      </div>

      <div v-if="submissionStatus?.submittedFiles.length" class="sub-section">
        <div class="sub-section-title">
          <el-icon><Document /></el-icon>
          Currently Submitted Files
        </div>
        <div class="sub-file-list">
          <div v-for="file in submissionStatus.submittedFiles" :key="file.fileurl" class="sub-submitted-file">
            <el-icon class="sub-file-icon"><Document /></el-icon>
            <span class="sub-file-name">{{ file.filename }}</span>
            <span class="sub-file-size">{{ formatBytes(file.filesize) }}</span>
          </div>
        </div>
      </div>

      <div
        v-if="submissionStatus?.gradeText || submissionStatus?.feedbackFiles.length"
        class="sub-section"
      >
        <div class="sub-section-title">
          <el-icon><Document /></el-icon>
          Grading Feedback
        </div>
        <div v-if="submissionStatus?.gradeText" class="sub-feedback-grade">
          <div class="sub-feedback-label">Score</div>
          <div class="sub-feedback-value">{{ submissionStatus.gradeText }}</div>
          <div v-if="submissionStatus.grader" class="sub-feedback-grader">
            Graded by: <strong>{{ submissionStatus.grader.fullName }}</strong>
            <a
              v-if="submissionStatus.grader.email"
              class="sub-feedback-mail-link"
              :href="`mailto:${submissionStatus.grader.email}`"
            >
              {{ submissionStatus.grader.email }}
            </a>
          </div>
          <div class="sub-feedback-time">{{ formatGradedAt(submissionStatus.gradedAt) }}</div>
        </div>
        <div v-if="submissionStatus?.feedbackFiles.length" class="sub-file-list">
          <div
            v-for="file in submissionStatus.feedbackFiles"
            :key="file.fileurl"
            class="sub-attachment-file"
            @click="openAttachment(file)"
          >
            <div class="sub-att-ext" :style="{ background: getAttExtColor(file.filename) }">
              {{ getAttExt(file.filename) }}
            </div>
            <div class="sub-att-info">
              <span class="sub-file-name">{{ file.filename }}</span>
              <span class="sub-file-size">{{ formatBytes(file.filesize) }}</span>
            </div>
            <el-icon class="sub-att-action"><Download /></el-icon>
          </div>
        </div>
      </div>

      <div class="sub-section">
        <div class="sub-section-title">
          <el-icon><Upload /></el-icon>
          Upload New Submission
        </div>

        <div class="sub-dropzone" @click="handleSelectFiles">
          <el-icon class="sub-drop-icon"><Upload /></el-icon>
          <div class="sub-drop-text">Click to select files</div>
          <div class="sub-drop-hint">
            Max {{ submissionAssignment.maxFileSubmissions }} file{{ submissionAssignment.maxFileSubmissions !== 1 ? 's' : '' }}
            · {{ submissionAssignment.allowedFileTypes || 'All file types' }}
          </div>
        </div>

        <div v-if="selectedFiles.length" class="sub-selected-files">
          <div v-for="(file, idx) in selectedFiles" :key="file.path" class="sub-sel-file">
            <div class="sub-sel-left">
              <el-icon class="sub-sel-icon" :class="{ 'is-loading': file.uploading, 'sub-sel-error': file.error }">
                <Refresh v-if="file.uploading" />
                <Document v-else />
              </el-icon>
              <div class="sub-sel-info">
                <div class="sub-sel-name">{{ file.name }}</div>
                <div v-if="file.uploading" class="sub-sel-status sub-sel-uploading">Uploading...</div>
                <div v-else-if="file.error" class="sub-sel-status sub-sel-err">{{ file.error }}</div>
                <div v-else class="sub-sel-status sub-sel-ok">Ready</div>
              </div>
            </div>
            <button class="sub-sel-remove" @click="handleRemoveFile(idx)">
              <el-icon><Delete /></el-icon>
            </button>
          </div>
        </div>

        <div v-if="selectedFiles.length" class="sub-summary">
          <span>{{ selectedFiles.length }} file{{ selectedFiles.length !== 1 ? 's' : '' }} selected</span>
          <span v-if="totalSelectedSize">· {{ formatBytes(totalSelectedSize) }}</span>
        </div>
      </div>

      <div class="sub-actions">
        <el-button
          class="sub-submit-btn"
          :loading="submitting"
          :disabled="!selectedFiles.length"
          @click="handleSubmit"
        >
          <el-icon v-if="!submitting"><ArrowRight /></el-icon>
          {{ submissionStatus?.status === 'submitted' ? 'Resubmit Assignment' : 'Submit Assignment' }}
        </el-button>
      </div>
    </div>

    <div v-else class="sub-loading">
      Failed to load assignment. Please go back and try again.
    </div>
  </div>
</template>

<style scoped>
.submission-page {
  position: absolute;
  inset: 40px 0 0;
  background: var(--bg-page);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  z-index: 100;
}

.sub-topbar {
  height: 52px;
  background: var(--bg-header);
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  flex-shrink: 0;
}

.sub-back-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  border-radius: 7px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s;
}

.sub-back-btn:hover {
  background: rgba(255, 255, 255, 0.18);
}

.sub-breadcrumb {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sub-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 14px;
  color: var(--text-m);
}

.sub-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 28px 60px 48px;
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
}

.sub-header {
  background: var(--bg-surface);
  border-radius: 14px;
  border: 1px solid var(--border);
  padding: 26px 30px 22px;
  box-shadow: var(--shadow-s);
}

.sub-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.sub-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-h);
  line-height: 1.3;
  margin: 0;
}

.sub-status-badge {
  font-size: 12px;
  font-weight: 700;
  padding: 5px 14px;
  border-radius: 20px;
  border: 1px solid;
  white-space: nowrap;
  flex-shrink: 0;
  margin-top: 4px;
}

.sub-meta-row {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--text-3);
}

.sub-meta-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.sub-meta-types {
  background: var(--chip-bg);
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 11.5px;
  color: var(--text-m);
}

.sub-section {
  background: var(--bg-surface);
  border-radius: 14px;
  border: 1px solid var(--border);
  padding: 22px 28px;
  box-shadow: var(--shadow-s);
}

.sub-section-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-b);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.sub-intro {
  font-size: 14px;
  color: var(--text-b);
  line-height: 1.7;
}

.sub-intro :deep(p) { margin: 0 0 8px; }
.sub-intro :deep(ul), .sub-intro :deep(ol) { padding-left: 22px; margin: 6px 0; }
.sub-intro :deep(a) { color: var(--accent-b); }

.sub-file-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sub-feedback-grade {
  border: 1px solid var(--border);
  background: var(--bg-surface-hover);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 12px;
}

.sub-feedback-label {
  font-size: 12px;
  color: var(--text-f);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.sub-feedback-value {
  font-size: 24px;
  line-height: 1.25;
  font-weight: 700;
  color: var(--text-h);
  margin-top: 2px;
}

.sub-feedback-time {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-m);
}

.sub-feedback-grader {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--text-b);
}

.sub-feedback-mail-link {
  font-size: 12px;
  color: var(--accent-b);
  text-decoration: none;
  border-bottom: 1px dashed currentColor;
}

.sub-feedback-mail-link:hover {
  opacity: 0.75;
}

.sub-submitted-file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-surface-hover);
  border-radius: 8px;
  border: 1px solid var(--border);
}

.sub-file-icon {
  font-size: 18px;
  color: var(--accent-b);
  flex-shrink: 0;
}

.sub-file-name {
  font-size: 13.5px;
  color: var(--text-h);
  flex: 1;
  font-weight: 500;
}

.sub-file-size {
  font-size: 12px;
  color: var(--text-f);
  flex-shrink: 0;
}

.sub-attachment-file {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-surface-hover);
  border-radius: 8px;
  border: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.sub-attachment-file:hover {
  background: var(--tl-hover-bg);
  border-color: var(--accent-b);
}

.sub-att-ext {
  min-width: 38px;
  height: 28px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}

.sub-att-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.sub-att-action {
  font-size: 16px;
  color: var(--text-i);
  flex-shrink: 0;
}

.sub-attachment-file:hover .sub-att-action {
  color: var(--accent-b);
}

.sub-dropzone {
  border: 2px dashed var(--border-strong);
  border-radius: 12px;
  padding: 30px 20px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  background: var(--bg-surface-alt);
}

.sub-dropzone:hover {
  border-color: var(--accent-b);
  background: var(--tl-hover-bg);
}

.sub-drop-icon {
  font-size: 32px;
  color: var(--text-i);
  margin-bottom: 8px;
}

.sub-drop-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-3);
  margin-bottom: 4px;
}

.sub-drop-hint {
  font-size: 12px;
  color: var(--text-f);
}

.sub-selected-files {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sub-sel-file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--bg-surface-hover);
  border-radius: 9px;
  border: 1px solid var(--border);
  gap: 12px;
}

.sub-sel-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.sub-sel-icon {
  font-size: 20px;
  color: var(--accent-b);
  flex-shrink: 0;
}

.sub-sel-error { color: #f56c6c; }

.sub-sel-info {
  min-width: 0;
}

.sub-sel-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-h);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 480px;
}

.sub-sel-status {
  font-size: 12px;
  margin-top: 2px;
}

.sub-sel-uploading { color: #e6a23c; }
.sub-sel-ok { color: #67c23a; }
.sub-sel-err { color: #f56c6c; }

.sub-sel-remove {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-i);
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}

.sub-sel-remove:hover {
  background: #fee2e2;
  color: #f56c6c;
}

.sub-summary {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--text-m);
  display: flex;
  gap: 6px;
}

.sub-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.sub-submit-btn {
  height: 46px !important;
  padding: 0 32px !important;
  font-size: 15px !important;
  font-weight: 600 !important;
  background: var(--bg-header) !important;
  border-color: var(--bg-header) !important;
  color: #fff !important;
  border-radius: 10px !important;
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
}

.sub-submit-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.sub-submit-btn:disabled {
  opacity: 0.4 !important;
}
</style>
