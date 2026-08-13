<script setup lang="ts">
import { ArrowRight, Back, Clock, Delete, Document, Download, EditPen, Refresh, Trophy, Upload, View } from '@element-plus/icons-vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useSubmission } from '../composables/useSubmission'
import { useTimeline } from '../composables/useTimeline'
import { formatBytes } from '../composables/useUtils'
import { getMoodleQuizTheme, MOODLE_QUIZ_ENHANCEMENTS_SCRIPT } from '../styles/moodleQuizTheme'

type MoodleWebviewElement = HTMLElement & {
  insertCSS: (css: string) => Promise<string>
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>
  reload: () => void
}

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
  submissionQuiz,
  submissionLoading,
  selectedFiles,
  submitting,
  submissionDueDate,
  submissionStatusLabel,
  quizStatusLabel,
  totalSelectedSize,
  handleSelectFiles,
  handleAddLocalFiles,
  handleRemoveFile,
  handleSubmit,
  handleOpenQuiz,
  prepareQuizEmbed,
  openSubmission,
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

const dragActive = ref(false)

const extractFilePaths = (files: FileList | null | undefined): string[] => {
  if (!files?.length) return []
  return Array.from(files)
    .map((file) => ((file as File & { path?: string }).path || '').trim())
    .filter((path): path is string => Boolean(path))
}

const onDropzoneDragOver = (event: DragEvent) => {
  event.preventDefault()
  dragActive.value = true
}

const onDropzoneDragLeave = (event: DragEvent) => {
  event.preventDefault()
  dragActive.value = false
}

const onDropzoneDrop = (event: DragEvent) => {
  event.preventDefault()
  dragActive.value = false
  const paths = extractFilePaths(event.dataTransfer?.files)
  if (!paths.length) return
  handleAddLocalFiles(paths)
}

const onWindowPaste = (event: ClipboardEvent) => {
  const paths = extractFilePaths(event.clipboardData?.files)
  if (!paths.length) return
  event.preventDefault()
  handleAddLocalFiles(paths)
}

onMounted(() => {
  window.addEventListener('paste', onWindowPaste)
})

onBeforeUnmount(() => {
  window.removeEventListener('paste', onWindowPaste)
})

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

const formatQuizDate = (timestamp: number) => timestamp
  ? new Date(timestamp * 1000).toLocaleString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  : 'Not set'

const formatQuizDuration = (seconds: number) => {
  if (!seconds) return 'No time limit'
  if (seconds < 60) return `${seconds} sec`
  const minutes = Math.round(seconds / 60)
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} hr` : `${minutes} min`
}

const formatQuizScore = (score: number | null, maximum: number) =>
  score == null ? '—' : `${Number(score.toFixed(2))} / ${Number(maximum.toFixed(2))}`

const quizActionLabel = computed(() => {
  if (submissionQuiz.value?.status === 'in-progress') return 'Continue Attempt in Moodle'
  return submissionQuiz.value?.attempts.length ? 'Start Another Attempt in Moodle' : 'Start Quiz in Moodle'
})

const quizOpeningTarget = ref<number | 'main' | null>(null)
const quizEmbedUrl = ref('')
const quizEmbedLoading = ref(false)
const quizEmbedError = ref('')
const quizWebview = ref<MoodleWebviewElement | null>(null)

const openQuizWindow = async (attemptId?: number) => {
  if (quizOpeningTarget.value != null) return
  quizOpeningTarget.value = attemptId ?? 'main'
  try {
    const launchUrl = await prepareQuizEmbed(attemptId)
    if (!launchUrl) return
    quizEmbedError.value = ''
    quizEmbedLoading.value = true
    quizEmbedUrl.value = launchUrl
  } finally {
    quizOpeningTarget.value = null
  }
}

const closeQuizEmbed = () => {
  quizEmbedUrl.value = ''
  quizEmbedLoading.value = false
  quizEmbedError.value = ''
  if (submissionEvent.value) void openSubmission(submissionEvent.value)
}

const refreshQuizEmbed = () => {
  quizEmbedError.value = ''
  quizEmbedLoading.value = true
  quizWebview.value?.reload()
}

const onQuizDomReady = async () => {
  const webview = quizWebview.value
  if (!webview) return
  const dark = document.querySelector('.app-root')?.classList.contains('dark') ?? false
  try {
    await webview.insertCSS(getMoodleQuizTheme(dark))
    await webview.executeJavaScript(MOODLE_QUIZ_ENHANCEMENTS_SCRIPT)
  } catch (error) {
    console.warn('Failed to apply the custom Moodle Quiz theme', error)
  }
}

const onQuizLoadFailed = (event: Event & { errorCode?: number; errorDescription?: string }) => {
  if (event.errorCode === -3) return
  quizEmbedLoading.value = false
  quizEmbedError.value = event.errorDescription || 'The Moodle Quiz page could not be loaded.'
}
</script>

<template>
  <div class="submission-page">
    <div v-if="quizEmbedUrl" class="quiz-browser-shell">
      <div class="quiz-browser-toolbar">
        <button class="quiz-browser-back" @click="closeQuizEmbed">
          <el-icon><Back /></el-icon>
          Back to Quiz Details
        </button>
        <div class="quiz-browser-title">
          <span class="quiz-browser-dot" />
          <span>{{ submissionQuiz?.name || 'Moodle Quiz' }}</span>
          <small>{{ quizEmbedLoading ? 'Loading Moodle…' : 'Custom campus theme' }}</small>
        </div>
        <button
          class="quiz-browser-refresh"
          :disabled="quizEmbedLoading"
          aria-label="Refresh embedded Moodle Quiz"
          @click="refreshQuizEmbed"
        >
          <el-icon :class="{ 'is-loading': quizEmbedLoading }"><Refresh /></el-icon>
          Refresh
        </button>
      </div>

      <div class="quiz-browser-viewport">
        <webview
          ref="quizWebview"
          class="quiz-browser-webview"
          :src="quizEmbedUrl"
          partition="persist:students"
          webpreferences="contextIsolation=yes, nodeIntegration=no, sandbox=yes"
          @dom-ready="onQuizDomReady"
          @did-start-loading="quizEmbedLoading = true"
          @did-stop-loading="quizEmbedLoading = false"
          @did-fail-load="onQuizLoadFailed"
        ></webview>
        <div v-if="quizEmbedLoading" class="quiz-browser-loading" aria-live="polite">
          <el-icon class="is-loading"><Refresh /></el-icon>
          Applying the campus Quiz theme…
        </div>
        <div v-if="quizEmbedError" class="quiz-browser-error" role="alert">
          <strong>Unable to load Moodle Quiz</strong>
          <span>{{ quizEmbedError }}</span>
          <button @click="refreshQuizEmbed">Try again</button>
          <button class="is-secondary" @click="handleOpenQuiz()">Open original Moodle window</button>
        </div>
      </div>
    </div>

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
      Loading activity details...
    </div>

    <div v-else-if="submissionQuiz" class="sub-content quiz-content">
      <div class="sub-header quiz-header">
        <div class="sub-title-row">
          <div class="quiz-title-lockup">
            <div class="quiz-title-icon"><el-icon><EditPen /></el-icon></div>
            <h1 class="sub-title">{{ submissionQuiz.name }}</h1>
          </div>
          <div
            class="sub-status-badge"
            :style="{ background: quizStatusLabel.color + '22', color: quizStatusLabel.color, borderColor: quizStatusLabel.color + '55' }"
          >
            {{ quizStatusLabel.text }}
          </div>
        </div>
        <div class="quiz-summary-grid">
          <div class="quiz-summary-item">
            <span class="quiz-summary-label"><el-icon><Clock /></el-icon>Closes</span>
            <strong>{{ formatQuizDate(submissionQuiz.timeClose) }}</strong>
          </div>
          <div class="quiz-summary-item">
            <span class="quiz-summary-label">Attempts allowed</span>
            <strong>{{ submissionQuiz.attemptsAllowed || 'Unlimited' }}</strong>
          </div>
          <div class="quiz-summary-item">
            <span class="quiz-summary-label">Time limit</span>
            <strong>{{ formatQuizDuration(submissionQuiz.timeLimit) }}</strong>
          </div>
          <div class="quiz-summary-item">
            <span class="quiz-summary-label">Grading method</span>
            <strong>{{ submissionQuiz.gradingMethod }}</strong>
          </div>
        </div>
      </div>

      <div v-if="submissionQuiz.intro" class="sub-section">
        <div class="sub-section-title">Quiz Description</div>
        <div class="sub-intro" v-html="submissionQuiz.intro" />
      </div>

      <div class="sub-section quiz-attempts-section">
        <div class="sub-section-title quiz-section-heading">
          <span><el-icon><Trophy /></el-icon>Previous Attempts</span>
          <span v-if="submissionQuiz.bestGrade != null" class="quiz-best-grade">
            Final grade {{ formatQuizScore(submissionQuiz.bestGrade, submissionQuiz.maxGrade) }}
          </span>
        </div>

        <div v-if="submissionQuiz.attempts.length" class="quiz-attempt-table-wrap">
          <table class="quiz-attempt-table">
            <thead>
              <tr>
                <th>Attempt</th>
                <th>State</th>
                <th>Submitted</th>
                <th>Marks</th>
                <th>Grade</th>
                <th><span class="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="attempt in submissionQuiz.attempts" :key="attempt.id">
                <td>{{ attempt.attemptNumber }}</td>
                <td><span class="quiz-state" :class="`is-${attempt.state}`">{{ attempt.state }}</span></td>
                <td>{{ attempt.finishedAt ? formatQuizDate(attempt.finishedAt) : 'In progress' }}</td>
                <td>{{ formatQuizScore(attempt.rawMark, submissionQuiz.maxRawMark) }}</td>
                <td>{{ formatQuizScore(attempt.grade, submissionQuiz.maxGrade) }}</td>
                <td class="quiz-review-cell">
                  <button
                    v-if="attempt.state === 'finished'"
                    class="quiz-review-btn"
                    :disabled="quizOpeningTarget != null"
                    :aria-label="`Review attempt ${attempt.attemptNumber} in Moodle`"
                    @click="openQuizWindow(attempt.id)"
                  >
                    <el-icon :class="{ 'is-loading': quizOpeningTarget === attempt.id }">
                      <Refresh v-if="quizOpeningTarget === attempt.id" />
                      <View v-else />
                    </el-icon>{{ quizOpeningTarget === attempt.id ? 'Opening...' : 'Review' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="quiz-empty-attempts">
          {{ submissionQuiz.canAttempt
            ? 'No attempts yet. Start the Quiz in Moodle when you are ready.'
            : submissionQuiz.status === 'closed'
              ? 'This Quiz closed without an attempt.'
              : 'No attempts are available yet.' }}
        </div>
      </div>

      <div class="quiz-actions">
        <button
          v-if="submissionQuiz.canAttempt"
          class="quiz-primary-btn"
          :disabled="quizOpeningTarget != null"
          @click="openQuizWindow()"
        >
          <el-icon :class="{ 'is-loading': quizOpeningTarget === 'main' }">
            <Refresh v-if="quizOpeningTarget === 'main'" />
            <ArrowRight v-else />
          </el-icon>{{ quizOpeningTarget === 'main' ? 'Opening Moodle...' : quizActionLabel }}
        </button>
        <p class="quiz-action-hint">
          The Quiz opens here with the campus theme. Moodle still handles timing, autosave, and final submission.
        </p>
      </div>
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
          <div
            v-for="file in submissionStatus.submittedFiles"
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

        <div
          class="sub-dropzone"
          :class="{ 'is-drag-active': dragActive }"
          @click="handleSelectFiles"
          @dragover="onDropzoneDragOver"
          @dragleave="onDropzoneDragLeave"
          @drop="onDropzoneDrop"
        >
          <el-icon class="sub-drop-icon"><Upload /></el-icon>
          <div class="sub-drop-text">Click, drag, or paste files</div>
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
      Failed to load activity. Please go back and try again.
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

.quiz-browser-shell {
  position: absolute;
  inset: 0;
  z-index: 120;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg-page);
}

.quiz-browser-toolbar {
  min-height: 56px;
  padding: 0 18px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  background: var(--bg-header);
  color: #fff;
  border-bottom: 1px solid color-mix(in srgb, #fff 12%, transparent);
  flex-shrink: 0;
}

.quiz-browser-back,
.quiz-browser-refresh {
  min-height: 38px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid color-mix(in srgb, #fff 22%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, #fff 8%, transparent);
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
}

.quiz-browser-back:hover,
.quiz-browser-refresh:hover:not(:disabled) {
  background: color-mix(in srgb, #fff 15%, transparent);
  border-color: color-mix(in srgb, #fff 35%, transparent);
}

.quiz-browser-back:focus-visible,
.quiz-browser-refresh:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--accent-b) 65%, #fff);
  outline-offset: 2px;
}

.quiz-browser-refresh:disabled {
  opacity: 0.55;
  cursor: wait;
}

.quiz-browser-title {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
}

.quiz-browser-title > span:not(.quiz-browser-dot) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quiz-browser-title small {
  color: color-mix(in srgb, #fff 62%, transparent);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.quiz-browser-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-g);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-g) 22%, transparent);
  flex-shrink: 0;
}

.quiz-browser-viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-page);
}

.quiz-browser-webview {
  display: flex;
  width: 100%;
  height: 100%;
  border: 0;
  background: var(--bg-page);
}

.quiz-browser-loading,
.quiz-browser-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--bg-page);
  color: var(--text-m);
  font-size: 14px;
}

.quiz-browser-loading .el-icon { font-size: 22px; color: var(--accent-o); }

.quiz-browser-error {
  flex-direction: column;
  padding: 32px;
  text-align: center;
}

.quiz-browser-error strong { color: var(--text-h); font-size: 17px; }
.quiz-browser-error span { max-width: 560px; line-height: 1.6; }

.quiz-browser-error button {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--accent-o);
  border-radius: 8px;
  background: var(--accent-o);
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.quiz-browser-error button.is-secondary {
  background: var(--bg-surface);
  border-color: var(--border-strong);
  color: var(--text-b);
}

@media (max-width: 760px) {
  .quiz-browser-toolbar { padding: 0 10px; gap: 8px; }
  .quiz-browser-title small { display: none; }
  .quiz-browser-back { font-size: 0; }
  .quiz-browser-back .el-icon { font-size: 16px; }
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

.quiz-content {
  box-sizing: border-box;
  max-width: 1040px;
  padding-left: 40px;
  padding-right: 40px;
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

.sub-dropzone.is-drag-active {
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

.quiz-title-lockup,
.quiz-summary-label,
.quiz-section-heading > span,
.quiz-review-btn,
.quiz-primary-btn {
  display: inline-flex;
  align-items: center;
}

.quiz-title-lockup { gap: 12px; }

.quiz-title-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--accent-p) 14%, var(--bg-surface));
  color: var(--accent-p);
  font-size: 20px;
  flex-shrink: 0;
}

.quiz-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 12px;
  margin-top: 20px;
}

.quiz-summary-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-surface);
  color: var(--text-h);
  font-size: 13px;
}

.quiz-summary-label {
  gap: 5px;
  color: var(--text-m);
  font-size: 12px;
}

.quiz-section-heading {
  justify-content: space-between;
  gap: 16px;
}

.quiz-section-heading > span { gap: 7px; }

.quiz-best-grade {
  color: var(--accent-p);
  font-size: 13px;
  white-space: nowrap;
}

.quiz-attempt-table-wrap {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.quiz-attempt-table {
  width: 100%;
  min-width: 0;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 13px;
  color: var(--text-b);
}

.quiz-attempt-table th,
.quiz-attempt-table td {
  padding: 13px 10px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.quiz-attempt-table th:nth-child(1),
.quiz-attempt-table td:nth-child(1) { width: 11%; }
.quiz-attempt-table th:nth-child(2),
.quiz-attempt-table td:nth-child(2) { width: 14%; }
.quiz-attempt-table th:nth-child(3),
.quiz-attempt-table td:nth-child(3) { width: 29%; }
.quiz-attempt-table th:nth-child(4),
.quiz-attempt-table td:nth-child(4) { width: 14%; }
.quiz-attempt-table th:nth-child(5),
.quiz-attempt-table td:nth-child(5) { width: 15%; }
.quiz-attempt-table th:nth-child(6),
.quiz-attempt-table td:nth-child(6) { width: 17%; }

.quiz-attempt-table td:nth-child(1),
.quiz-attempt-table td:nth-child(2),
.quiz-attempt-table td:nth-child(3),
.quiz-attempt-table td:nth-child(4),
.quiz-attempt-table td:nth-child(5) {
  white-space: nowrap;
}

.quiz-attempt-table th {
  background: var(--bg-surface-alt);
  color: var(--text-m);
  font-size: 12px;
  font-weight: 600;
}

.quiz-attempt-table tbody tr:last-child td { border-bottom: 0; }

.quiz-state {
  text-transform: capitalize;
  font-weight: 600;
}

.quiz-state.is-finished { color: #67c23a; }
.quiz-state.is-inprogress,
.quiz-state.is-overdue { color: #e6a23c; }

.quiz-review-cell { text-align: right !important; }

.quiz-review-btn {
  gap: 5px;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-surface);
  color: var(--accent-b);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
  max-width: 94px;
  justify-content: center;
  white-space: nowrap;
}

.quiz-review-btn:hover { background: var(--bg-surface-hover); }
.quiz-review-btn:disabled,
.quiz-primary-btn:disabled {
  opacity: 0.5;
  cursor: wait;
}
.quiz-review-btn:focus-visible,
.quiz-primary-btn:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--accent-b) 45%, transparent);
  outline-offset: 2px;
}

.quiz-empty-attempts {
  padding: 28px;
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
  color: var(--text-m);
  text-align: center;
}

.quiz-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.quiz-primary-btn {
  gap: 8px;
  min-height: 44px;
  padding: 0 22px;
  border: 1px solid var(--accent-p);
  border-radius: 10px;
  background: var(--accent-p);
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
}

.quiz-primary-btn:hover { filter: brightness(0.94); }

.quiz-action-hint {
  margin: 0;
  color: var(--text-m);
  font-size: 12.5px;
  line-height: 1.5;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 900px) {
  .quiz-summary-grid { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
  .quiz-actions { align-items: flex-start; flex-direction: column; }
  .quiz-content { padding-left: 24px; padding-right: 24px; }
  .quiz-attempt-table { font-size: 12px; }
  .quiz-attempt-table th,
  .quiz-attempt-table td { padding-left: 7px; padding-right: 7px; }
  .quiz-review-btn { padding: 0 7px; }
}
</style>
