<script setup lang="ts">
import { ArrowRight, Back, ChatDotRound, Clock, Close, CopyDocument, Delete, Document, Download, EditPen, MagicStick, Refresh, Setting, Trophy, Upload, View } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import katex from 'katex'
import MarkdownIt from 'markdown-it'
import texmath from 'markdown-it-texmath'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import 'katex/dist/katex.min.css'
import 'markdown-it-texmath/css/texmath.css'
import { useSubmission } from '../composables/useSubmission'
import { useTimeline } from '../composables/useTimeline'
import { formatBytes } from '../composables/useUtils'
import { getMoodleQuizTheme, MOODLE_QUIZ_ENHANCEMENTS_SCRIPT } from '../styles/moodleQuizTheme'

type MoodleWebviewElement = HTMLElement & {
  insertCSS: (css: string) => Promise<string>
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>
  reload: () => void
}

type AiProviderConfig = {
  baseUrl: string
  model: string
  apiMode: 'responses' | 'chat-completions'
  hasApiKey: boolean
  secureStorageAvailable: boolean
}

type HomeworkQuestion = {
  id: string
  number: string
  prompt: string
  options: string[]
  answerType: string
  currentAnswer: string
  formulas: string[]
  images: Array<{ src: string; alt: string; dataUrl?: string }>
}

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true })
  .use(texmath, {
    engine: katex,
    delimiters: ['dollars', 'brackets'],
    katexOptions: {
      throwOnError: false,
      strict: 'ignore',
      output: 'htmlAndMathml',
    },
  })

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
const aiDrawerOpen = ref(false)
const aiSettingsOpen = ref(false)
const aiReading = ref(false)
const aiSolving = ref(false)
const aiQuestions = ref<HomeworkQuestion[]>([])
const aiSelectedQuestionId = ref('')
const aiDrawerScroll = ref<HTMLElement | null>(null)
const aiAnswer = ref('')
const aiAnswerModel = ref('')
const aiError = ref('')
const aiConfig = ref<AiProviderConfig>({
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5.4-mini',
  apiMode: 'responses',
  hasApiKey: false,
  secureStorageAvailable: true,
})
const aiConfigForm = ref({
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5.4-mini',
  apiMode: 'responses' as 'responses' | 'chat-completions',
  apiKey: '',
})
const aiSavingConfig = ref(false)

const aiSelectedQuestion = computed(() =>
  aiQuestions.value.find(question => question.id === aiSelectedQuestionId.value) ?? null,
)
const aiSelectedQuestionIndex = computed(() =>
  aiQuestions.value.findIndex(question => question.id === aiSelectedQuestionId.value),
)
const aiHasPreviousQuestion = computed(() => aiSelectedQuestionIndex.value > 0)
const aiHasNextQuestion = computed(() =>
  aiSelectedQuestionIndex.value >= 0 && aiSelectedQuestionIndex.value < aiQuestions.value.length - 1,
)
const aiRenderedAnswer = computed(() => markdown.render(aiAnswer.value))

const syncAiConfigForm = (config: AiProviderConfig) => {
  aiConfig.value = config
  aiConfigForm.value.baseUrl = config.baseUrl
  aiConfigForm.value.model = config.model
  aiConfigForm.value.apiMode = config.apiMode
  aiConfigForm.value.apiKey = ''
}

const loadAiConfig = async () => {
  try {
    syncAiConfigForm(await window.electronAPI.aiHomeworkConfigGet())
    aiSettingsOpen.value = !aiConfig.value.hasApiKey
  } catch (error) {
    aiError.value = error instanceof Error ? error.message : String(error)
  }
}

const getQuestionExtractionScript = () => `(() => {
  const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
  const nodes = Array.from(document.querySelectorAll('.que'));
  const imageToDataUrl = async img => {
    try {
      const response = await fetch(img.currentSrc || img.src, { credentials: 'include' });
      const blob = await response.blob();
      if (!blob.type.startsWith('image/') || blob.size > 3000000) return '';
      return await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      });
    } catch { return ''; }
  };
  return Promise.all(nodes.map(async (node, index) => {
    const inputs = Array.from(node.querySelectorAll('input, textarea, select')).filter(input => {
      const type = String(input.type || input.tagName).toLowerCase();
      return !['hidden', 'image', 'submit', 'button', 'reset'].includes(type);
    });
    const checked = inputs.filter(input => input.checked || (input.tagName === 'SELECT' && input.value) || ((input.type === 'text' || input.type === 'number') && input.value));
    const isQuestionImage = img => {
      const style = getComputedStyle(img);
      const rect = img.getBoundingClientRect();
      const source = String(img.currentSrc || img.src || '').toLowerCase();
      const marker = String(img.className || '') + ' ' + source;
      const alt = clean(img.alt || img.getAttribute('title'));
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || !rect.width || !rect.height) return false;
      if (/icon|smallicon|mathjax|mathtex|texrender|filter_tex|equation|emoticon|feedback/.test(marker.toLowerCase())) return false;
      const firstChar = alt.charCodeAt(0);
      if (alt.startsWith('$') || firstChar === 92) return false;
      return rect.width >= 48 && rect.height >= 40 && rect.width * rect.height >= 3200;
    };
    const imageElements = Array.from(node.querySelectorAll('.qtext img, .answer img'))
      .filter(isQuestionImage)
      .filter((img, position, all) => all.findIndex(other => (other.currentSrc || other.src) === (img.currentSrc || img.src)) === position)
      .slice(0, 4);
    const images = await Promise.all(imageElements.map(async img => ({
      src: img.currentSrc || img.src || '',
      alt: clean(img.alt || img.getAttribute('title')),
      dataUrl: await imageToDataUrl(img),
    })));
    const formulaGroups = [
      Array.from(node.querySelectorAll('script[type^="math/tex"]')).map(el => clean(el.textContent)),
      Array.from(node.querySelectorAll('[data-latex]')).map(el => clean(el.getAttribute('data-latex'))),
      Array.from(node.querySelectorAll('mjx-container[aria-label]')).map(el => clean(el.getAttribute('aria-label'))),
    ];
    const formulas = (formulaGroups.find(group => group.some(Boolean)) || [])
      .filter((value, position, all) => value && all.indexOf(value) === position);
    const options = Array.from(node.querySelectorAll('.answer label, .answer .r0, .answer .r1, .answer .specificfeedback'))
      .map(el => clean(el.textContent)).filter((value, position, all) => value && all.indexOf(value) === position);
    return {
      id: node.id || 'question-' + (index + 1),
      number: clean(node.querySelector('.qno, .info h3, .info .no')?.textContent) || String(index + 1),
      prompt: clean(node.querySelector('.qtext')?.textContent || node.querySelector('.formulation')?.textContent),
      options,
      answerType: inputs.map(input => input.type || input.tagName.toLowerCase()).filter((value, position, all) => all.indexOf(value) === position).join(', ') || 'unknown',
      currentAnswer: checked.map(input => clean(input.closest('label')?.textContent || input.value)).filter(Boolean).join('; '),
      formulas,
      images: images.filter(image => image.src),
    };
  }));
})()`

const readQuizQuestions = async () => {
  const webview = quizWebview.value
  if (!webview || aiReading.value) return
  aiReading.value = true
  aiError.value = ''
  try {
    const result = await webview.executeJavaScript(getQuestionExtractionScript()) as HomeworkQuestion[]
    aiQuestions.value = Array.isArray(result) ? result.filter(question => question.prompt || question.options.length) : []
    if (!aiQuestions.value.some(question => question.id === aiSelectedQuestionId.value)) {
      aiSelectedQuestionId.value = aiQuestions.value[0]?.id ?? ''
    }
    if (!aiQuestions.value.length) aiError.value = '当前页面没有读取到题目，请先进入某一道题或作答页面。'
  } catch (error) {
    aiError.value = `读取题目失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    aiReading.value = false
  }
}

const openAiAssistant = async () => {
  aiDrawerOpen.value = true
  await loadAiConfig()
  await readQuizQuestions()
}

const saveAiConfig = async () => {
  aiSavingConfig.value = true
  aiError.value = ''
  try {
    const config = await window.electronAPI.aiHomeworkConfigSave({
      baseUrl: aiConfigForm.value.baseUrl,
      model: aiConfigForm.value.model,
      apiMode: aiConfigForm.value.apiMode,
      apiKey: aiConfigForm.value.apiKey || undefined,
    })
    syncAiConfigForm(config)
    aiSettingsOpen.value = false
    ElMessage.success('AI 配置已安全保存')
  } catch (error) {
    aiError.value = error instanceof Error ? error.message : String(error)
  } finally {
    aiSavingConfig.value = false
  }
}

const solveSelectedQuestion = async () => {
  const question = aiSelectedQuestion.value
  if (!question || aiSolving.value) return
  if (!aiConfig.value.hasApiKey) {
    aiSettingsOpen.value = true
    aiError.value = '请先保存 API Key。'
    return
  }
  aiSolving.value = true
  aiError.value = ''
  aiAnswer.value = ''
  try {
    // Electron IPC cannot structured-clone Vue's reactive Proxy objects.
    const plainQuestion = JSON.parse(JSON.stringify(question)) as HomeworkQuestion
    const result = await window.electronAPI.aiHomeworkSolve({ question: plainQuestion })
    aiAnswer.value = result.answer
    aiAnswerModel.value = result.model
  } catch (error) {
    aiError.value = error instanceof Error ? error.message : String(error)
  } finally {
    aiSolving.value = false
  }
}

const copyAiAnswer = async () => {
  if (!aiAnswer.value) return
  await navigator.clipboard.writeText(aiAnswer.value)
  ElMessage.success('解答已复制')
}

const resetAiAnswer = () => {
  aiAnswer.value = ''
  aiAnswerModel.value = ''
  aiError.value = ''
}

const changeAiQuestion = async (offset: -1 | 1) => {
  if (aiSolving.value) return
  const target = aiQuestions.value[aiSelectedQuestionIndex.value + offset]
  if (!target) return
  aiSelectedQuestionId.value = target.id
  aiSettingsOpen.value = false
  resetAiAnswer()
  await nextTick()
  aiDrawerScroll.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

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
  aiDrawerOpen.value = false
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
    if (aiDrawerOpen.value) await readQuizQuestions()
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

      <div class="quiz-browser-viewport" :class="{ 'has-ai-drawer': aiDrawerOpen }">
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

      <button
        v-if="!aiDrawerOpen"
        class="ai-fab"
        aria-label="打开 AI 作业助手"
        title="AI 作业助手"
        @click="openAiAssistant"
      >
        <el-icon><MagicStick /></el-icon>
        <span>AI</span>
      </button>

      <aside v-if="aiDrawerOpen" class="ai-drawer" aria-label="AI 作业助手">
        <header class="ai-drawer-header">
          <div class="ai-drawer-title">
            <span class="ai-drawer-icon"><el-icon><MagicStick /></el-icon></span>
            <div>
              <strong>AI 作业助手</strong>
              <small>自动读取当前 Moodle 题目</small>
            </div>
          </div>
          <div class="ai-header-actions">
            <button aria-label="AI 设置" title="AI 设置" @click="aiSettingsOpen = !aiSettingsOpen">
              <el-icon><Setting /></el-icon>
            </button>
            <button aria-label="关闭 AI 助手" title="关闭" @click="aiDrawerOpen = false">
              <el-icon><Close /></el-icon>
            </button>
          </div>
        </header>

        <div ref="aiDrawerScroll" class="ai-drawer-scroll">
          <section v-if="aiSettingsOpen" class="ai-settings-card">
            <div class="ai-section-heading">
              <strong>模型设置</strong>
              <span>{{ aiConfig.hasApiKey ? '密钥已保存' : '首次使用需配置' }}</span>
            </div>
            <label class="ai-field">
              <span>API URL</span>
              <input v-model.trim="aiConfigForm.baseUrl" type="url" autocomplete="url" placeholder="https://api.openai.com/v1">
            </label>
            <label class="ai-field">
              <span>模型</span>
              <input v-model.trim="aiConfigForm.model" type="text" autocomplete="off" placeholder="gpt-5.4-mini">
            </label>
            <label class="ai-field">
              <span>接口模式</span>
              <select v-model="aiConfigForm.apiMode">
                <option value="responses">Responses API</option>
                <option value="chat-completions">Chat Completions（兼容模式）</option>
              </select>
            </label>
            <label class="ai-field">
              <span>API Key</span>
              <input
                v-model="aiConfigForm.apiKey"
                type="password"
                autocomplete="new-password"
                :placeholder="aiConfig.hasApiKey ? '已保存；留空则不修改' : '请输入 API Key'"
              >
            </label>
            <p class="ai-security-note">
              密钥仅加密保存在本机 Electron 主进程，不会写入题目页面。
            </p>
            <button class="ai-primary-button" :disabled="aiSavingConfig" @click="saveAiConfig">
              <el-icon :class="{ 'is-loading': aiSavingConfig }"><Refresh v-if="aiSavingConfig" /><Setting v-else /></el-icon>
              {{ aiSavingConfig ? '保存中…' : '保存设置' }}
            </button>
          </section>

          <section class="ai-question-card">
            <div class="ai-section-heading">
              <strong>读取到的题目</strong>
              <button class="ai-text-button" :disabled="aiReading" @click="readQuizQuestions">
                <el-icon :class="{ 'is-loading': aiReading }"><Refresh /></el-icon>
                {{ aiReading ? '读取中…' : '重新读取' }}
              </button>
            </div>
            <div v-if="aiReading" class="ai-reading-state" aria-live="polite">
              <span /><span /><span />
              正在读取题干、公式和图片…
            </div>
            <template v-else-if="aiQuestions.length">
              <label class="ai-field">
                <span>选择题目</span>
                <select v-model="aiSelectedQuestionId" :disabled="aiSolving" @change="resetAiAnswer">
                  <option v-for="question in aiQuestions" :key="question.id" :value="question.id">
                    {{ question.number }} · {{ question.prompt.slice(0, 52) }}
                  </option>
                </select>
              </label>
              <div v-if="aiSelectedQuestion" class="ai-question-preview">
                <strong>{{ aiSelectedQuestion.number }}</strong>
                <p>{{ aiSelectedQuestion.prompt }}</p>
                <ul v-if="aiSelectedQuestion.options.length">
                  <li v-for="option in aiSelectedQuestion.options.slice(0, 8)" :key="option">{{ option }}</li>
                </ul>
                <div class="ai-question-meta">
                  <span>{{ aiSelectedQuestion.answerType }}</span>
                  <span v-if="aiSelectedQuestion.images.length">{{ aiSelectedQuestion.images.length }} 张图片</span>
                  <span v-if="aiSelectedQuestion.formulas.length">{{ aiSelectedQuestion.formulas.length }} 个公式</span>
                </div>
              </div>
              <button class="ai-primary-button" :disabled="aiSolving || !aiSelectedQuestion" @click="solveSelectedQuestion">
                <el-icon :class="{ 'is-loading': aiSolving }"><Refresh v-if="aiSolving" /><MagicStick v-else /></el-icon>
                {{ aiSolving ? '正在分析…' : aiAnswer ? '重新生成解答' : '一键解题' }}
              </button>
            </template>
          </section>

          <div v-if="aiError" class="ai-error" role="alert">{{ aiError }}</div>

          <section v-if="aiSolving" class="ai-answer-card ai-answer-loading" aria-live="polite">
            <el-icon class="is-loading"><Refresh /></el-icon>
            <strong>AI 正在解题</strong>
            <span>会综合题干、选项、公式和题目图片。</span>
          </section>

          <section v-else-if="aiAnswer" class="ai-answer-card">
            <div class="ai-section-heading">
              <div>
                <strong>AI 解答</strong>
                <span>{{ aiAnswerModel }}</span>
              </div>
              <button class="ai-icon-text-button" aria-label="复制解答" @click="copyAiAnswer">
                <el-icon><CopyDocument /></el-icon>复制
              </button>
            </div>
            <div class="ai-markdown" v-html="aiRenderedAnswer" />
          </section>

          <p class="ai-disclaimer">
            <el-icon><ChatDotRound /></el-icon>
            内容由 AI 生成，请自行核对。助手不会填写或提交 Moodle 答案。
          </p>
        </div>

        <footer v-if="aiQuestions.length" class="ai-question-nav" aria-label="题目导航">
          <button
            :disabled="!aiHasPreviousQuestion || aiSolving"
            aria-label="切换到上一题"
            @click="changeAiQuestion(-1)"
          >
            <el-icon><Back /></el-icon>
            上一题
          </button>
          <span aria-live="polite">
            <strong>{{ aiSelectedQuestionIndex + 1 }}</strong> / {{ aiQuestions.length }}
          </span>
          <button
            class="is-next"
            :disabled="!aiHasNextQuestion || aiSolving"
            aria-label="切换到下一题"
            @click="changeAiQuestion(1)"
          >
            下一题
            <el-icon><ArrowRight /></el-icon>
          </button>
        </footer>
      </aside>
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
  transition: margin-right 0.22s ease;
}

.quiz-browser-viewport.has-ai-drawer {
  margin-right: 420px;
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

.ai-fab {
  position: absolute;
  right: 24px;
  bottom: 24px;
  z-index: 145;
  width: 58px;
  height: 58px;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--accent-o) 75%, #fff);
  border-radius: 50%;
  background: linear-gradient(145deg, color-mix(in srgb, var(--accent-o) 88%, #fff), #8e4fd1);
  color: #fff;
  box-shadow: 0 12px 28px color-mix(in srgb, var(--accent-o) 34%, transparent);
  cursor: pointer;
  transition: box-shadow 0.2s ease, filter 0.2s ease;
}

.ai-fab:hover { filter: brightness(1.08); box-shadow: 0 14px 34px color-mix(in srgb, var(--accent-o) 44%, transparent); }
.ai-fab:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent-b) 65%, #fff); outline-offset: 3px; }
.ai-fab .el-icon { font-size: 23px; transform: translateY(-5px); }
.ai-fab span { position: absolute; bottom: 9px; font-size: 10px; font-weight: 800; letter-spacing: 0.08em; }

.ai-drawer {
  position: absolute;
  z-index: 144;
  top: 56px;
  right: 0;
  bottom: 0;
  width: 420px;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  color: var(--text-b);
  border-left: 1px solid var(--border-soft);
  box-shadow: -12px 0 32px color-mix(in srgb, #07162c 12%, transparent);
}

.ai-drawer-header {
  min-height: 72px;
  padding: 0 16px 0 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}

.ai-drawer-title, .ai-drawer-title > div, .ai-section-heading, .ai-section-heading > div {
  display: flex;
}

.ai-drawer-title { min-width: 0; align-items: center; gap: 11px; }
.ai-drawer-title > div { min-width: 0; flex-direction: column; gap: 2px; }
.ai-drawer-title strong { color: var(--text-h); font-size: 15px; }
.ai-drawer-title small { color: var(--text-m); font-size: 11px; }
.ai-drawer-icon { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 12px; color: var(--accent-o); background: color-mix(in srgb, var(--accent-o) 13%, var(--bg-surface)); }
.ai-drawer-icon .el-icon { font-size: 20px; }

.ai-header-actions { display: flex; gap: 4px; }
.ai-header-actions button {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-m);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ai-header-actions button:hover { background: var(--bg-page); color: var(--text-h); }
.ai-header-actions button:focus-visible { outline: 2px solid var(--accent-b); outline-offset: 1px; }

.ai-drawer-scroll {
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ai-settings-card, .ai-question-card, .ai-answer-card {
  padding: 16px;
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  background: var(--bg-surface);
  box-shadow: 0 4px 14px color-mix(in srgb, #07162c 5%, transparent);
}

.ai-settings-card, .ai-question-card { display: flex; flex-direction: column; gap: 13px; }
.ai-settings-card { background: color-mix(in srgb, var(--accent-o) 3%, var(--bg-surface)); border-color: color-mix(in srgb, var(--accent-o) 24%, var(--border-soft)); }
.ai-section-heading { align-items: center; justify-content: space-between; gap: 12px; }
.ai-section-heading > div { flex-direction: column; gap: 2px; }
.ai-section-heading strong { color: var(--text-h); font-size: 13px; }
.ai-section-heading span { color: var(--text-m); font-size: 10.5px; }

.ai-field { display: flex; flex-direction: column; gap: 6px; color: var(--text-b); font-size: 12px; font-weight: 600; }
.ai-field input, .ai-field select {
  width: 100%;
  min-height: 40px;
  box-sizing: border-box;
  padding: 0 11px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  outline: none;
  background: var(--bg-surface);
  color: var(--text-h);
  font: inherit;
  font-size: 12px;
}
.ai-field input:focus, .ai-field select:focus { border-color: var(--accent-b); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-b) 14%, transparent); }
.ai-security-note, .ai-disclaimer { margin: 0; color: var(--text-m); font-size: 11px; line-height: 1.55; }

.ai-primary-button {
  min-height: 42px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 0;
  border-radius: 9px;
  background: linear-gradient(135deg, var(--accent-o), #9351cf);
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: filter 0.15s, opacity 0.15s;
}
.ai-primary-button:hover:not(:disabled) { filter: brightness(1.06); }
.ai-primary-button:disabled { opacity: 0.58; cursor: wait; }
.ai-primary-button:focus-visible, .ai-text-button:focus-visible, .ai-icon-text-button:focus-visible { outline: 2px solid var(--accent-b); outline-offset: 2px; }

.ai-text-button, .ai-icon-text-button {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--accent-b);
  font: inherit;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}
.ai-text-button { padding: 0 5px; }
.ai-icon-text-button { padding: 0 8px; }
.ai-text-button:hover, .ai-icon-text-button:hover { background: color-mix(in srgb, var(--accent-b) 9%, transparent); }

.ai-reading-state { min-height: 78px; display: flex; align-items: center; justify-content: center; gap: 5px; color: var(--text-m); font-size: 11px; }
.ai-reading-state span { width: 6px; height: 6px; border-radius: 50%; background: var(--accent-o); animation: ai-pulse 1s ease-in-out infinite; }
.ai-reading-state span:nth-child(2) { animation-delay: 0.15s; }
.ai-reading-state span:nth-child(3) { animation-delay: 0.3s; margin-right: 5px; }
@keyframes ai-pulse { 0%, 100% { opacity: 0.3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }

.ai-question-preview { max-height: 210px; overflow: auto; padding: 12px; border-radius: 10px; background: var(--bg-page); }
.ai-question-preview > strong { display: block; margin-bottom: 6px; color: var(--accent-o); font-size: 12px; }
.ai-question-preview p { margin: 0; color: var(--text-h); font-size: 12px; line-height: 1.6; }
.ai-question-preview ul { margin: 9px 0 0; padding-left: 18px; color: var(--text-b); font-size: 11.5px; line-height: 1.55; }
.ai-question-meta { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
.ai-question-meta span { padding: 3px 7px; border-radius: 999px; background: color-mix(in srgb, var(--accent-b) 9%, transparent); color: var(--text-m); font-size: 9.5px; }

.ai-error { padding: 11px 12px; border: 1px solid color-mix(in srgb, #db4655 38%, transparent); border-radius: 10px; background: color-mix(in srgb, #db4655 8%, var(--bg-surface)); color: #c83747; font-size: 11.5px; line-height: 1.5; overflow-wrap: anywhere; }
.ai-answer-card { display: flex; flex-direction: column; gap: 12px; }
.ai-answer-loading { min-height: 112px; align-items: center; justify-content: center; text-align: center; color: var(--text-m); }
.ai-answer-loading .el-icon { color: var(--accent-o); font-size: 22px; }
.ai-answer-loading strong { color: var(--text-h); font-size: 13px; }
.ai-answer-loading span { font-size: 11px; }
.ai-markdown { color: var(--text-b); font-size: 12.5px; line-height: 1.7; overflow-wrap: anywhere; }
.ai-markdown :deep(h2) { margin: 15px 0 6px; color: var(--text-h); font-size: 14px; }
.ai-markdown :deep(h2:first-child) { margin-top: 0; }
.ai-markdown :deep(p) { margin: 0 0 9px; }
.ai-markdown :deep(pre), .ai-markdown :deep(code) { white-space: pre-wrap; background: var(--bg-page); border-radius: 6px; }
.ai-markdown :deep(code) { padding: 2px 4px; }
.ai-markdown :deep(pre) { padding: 10px; overflow: auto; }
.ai-markdown :deep(.katex) { color: var(--text-h); font-size: 1.04em; }
.ai-markdown :deep(.katex-display) {
  max-width: 100%;
  margin: 12px 0;
  padding: 10px 12px;
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid var(--border-soft);
  border-radius: 9px;
  background: var(--bg-page);
  text-align: left;
  scrollbar-width: thin;
}
.ai-markdown :deep(.katex-display > .katex) { min-width: max-content; text-align: left; }
.ai-markdown :deep(.katex-error) { color: #c83747; font-family: inherit; white-space: pre-wrap; }
.ai-disclaimer { padding: 2px 4px 10px; display: flex; align-items: flex-start; gap: 6px; }
.ai-disclaimer .el-icon { margin-top: 2px; flex-shrink: 0; color: var(--accent-o); }

.ai-question-nav {
  min-height: 68px;
  padding: 10px 16px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  border-top: 1px solid var(--border-soft);
  background: color-mix(in srgb, var(--bg-surface) 94%, transparent);
  box-shadow: 0 -8px 22px color-mix(in srgb, #07162c 6%, transparent);
}

.ai-question-nav button {
  min-height: 44px;
  padding: 0 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  background: var(--bg-surface);
  color: var(--text-b);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
}

.ai-question-nav button.is-next {
  border-color: color-mix(in srgb, var(--accent-o) 42%, var(--border-strong));
  color: var(--accent-o);
}

.ai-question-nav button:hover:not(:disabled) {
  border-color: var(--accent-o);
  background: color-mix(in srgb, var(--accent-o) 8%, var(--bg-surface));
  color: var(--accent-o);
}

.ai-question-nav button:focus-visible { outline: 2px solid var(--accent-b); outline-offset: 2px; }
.ai-question-nav button:disabled { opacity: 0.38; cursor: not-allowed; }
.ai-question-nav > span { min-width: 46px; color: var(--text-m); font-size: 11px; text-align: center; white-space: nowrap; }
.ai-question-nav > span strong { color: var(--text-h); font-size: 14px; }

@media (max-width: 760px) {
  .quiz-browser-toolbar { padding: 0 10px; gap: 8px; }
  .quiz-browser-title small { display: none; }
  .quiz-browser-back { font-size: 0; }
  .quiz-browser-back .el-icon { font-size: 16px; }
  .quiz-browser-viewport.has-ai-drawer { margin-right: 0; }
  .ai-drawer { width: min(92vw, 420px); }
  .ai-fab { right: 16px; bottom: 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .quiz-browser-viewport { transition: none; }
  .ai-reading-state span { animation: none; opacity: 0.72; }
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
