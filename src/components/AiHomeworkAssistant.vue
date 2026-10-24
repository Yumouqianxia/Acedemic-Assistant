<script setup lang="ts">
import { ArrowRight, Back, ChatDotRound, Close, CopyDocument, MagicStick, Refresh, Setting } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import katex from 'katex'
import MarkdownIt from 'markdown-it'
import texmath from 'markdown-it-texmath'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import 'katex/dist/katex.min.css'
import 'markdown-it-texmath/css/texmath.css'
import type { AiProviderConfig, HomeworkAnswerFill, HomeworkFillResult, HomeworkQuestion, HomeworkWebview } from '../types/ai-homework'
import { getHomeworkExtractionScript } from '../utils/homework-extraction'
import { getHomeworkAnswerFillScript } from '../utils/homework-answer-fields'
import { WebworkAutoRunner, parseAutoRecords, type AutoAttemptRecord, type AutoRunState, type WebworkPage } from '../utils/webwork-auto-runner'
import { getWebworkInspectScript, getWebworkNextScript, getWebworkSubmitScript } from '../utils/webwork-page-tools'

const props = withDefaults(defineProps<{
  webview: HomeworkWebview | null
  source?: 'moodle' | 'webwork'
  layout?: 'overlay' | 'inline'
}>(), { source: 'moodle', layout: 'overlay' })
const emit = defineEmits<{ openChange: [open: boolean] }>()
const sourceLabel = computed(() => props.source === 'webwork' ? ' WeBWorK ' : ' Moodle ')
let pageVersion = 0

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true })
  .use(texmath, {
    engine: katex,
    delimiters: ['dollars', 'brackets'],
    katexOptions: { throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' },
  })

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
const autoFillAnswers = ref(true)
const replaceAnswers = ref(false)
const aiFills = ref<HomeworkAnswerFill[]>([])
const aiFilling = ref(false)
const aiFillStatus = ref('')
const autoSubmitEnabled = ref(false)
const autoState = ref<AutoRunState>({ running: false, phase: 'idle', message: '', scope: '', account: '' })
const autoPage = ref<WebworkPage | null>(null)
const autoHistory = ref<AutoAttemptRecord[]>([])
const AUTO_HISTORY_KEY = 'campus-dashboard:webwork-auto-attempts:v1'
const recordLabels: Record<AutoAttemptRecord['status'], string> = {
  pending: '等待确认 · 不重试', correct: '正确', incorrect: '需检查 · 不重试', unknown: '结果未知 · 不重试', skipped: '已跳过',
}
const visibleHistory = computed(() => autoHistory.value.filter(record =>
  record.scope === (autoPage.value?.scope || autoState.value.scope)
    && record.account === (autoPage.value?.account || autoState.value.account),
).slice().reverse())
const guestScript = <T,>(script: string): Promise<T> => {
  if (!props.webview) return Promise.reject(new Error('作业页面已关闭。'))
  return props.webview.executeJavaScript(script) as Promise<T>
}
const readAutoHistory = () => parseAutoRecords(window.localStorage.getItem(AUTO_HISTORY_KEY))
const autoRunner = new WebworkAutoRunner({
  inspect: async () => {
    const page = await guestScript<WebworkPage | null>(getWebworkInspectScript())
    if (page) autoPage.value = page
    return page
  },
  extract: () => guestScript<HomeworkQuestion[]>(getHomeworkExtractionScript('webwork')),
  solve: question => window.electronAPI.aiHomeworkSolve({ question: JSON.parse(JSON.stringify(question)) as HomeworkQuestion }),
  fill: (question, fills) => guestScript<HomeworkFillResult>(getHomeworkAnswerFillScript(question, fills)),
  submit: (page, question, fills) => guestScript<boolean>(getWebworkSubmitScript(page, question, fills)),
  next: page => guestScript<boolean>(getWebworkNextScript(page)),
  records: readAutoHistory,
  save: records => { window.localStorage.setItem(AUTO_HISTORY_KEY, JSON.stringify(records)); autoHistory.value = records },
  update: state => { autoState.value = state },
  result: (question, result) => {
    aiQuestions.value = [question]
    aiSelectedQuestionId.value = question.id
    aiAnswer.value = result.answer
    aiAnswerModel.value = result.model
    aiFills.value = result.fills
  },
})

const startAutoRun = async () => {
  if (!autoSubmitEnabled.value || props.source !== 'webwork' || autoState.value.running) return
  if (!aiConfig.value.hasApiKey) { aiSettingsOpen.value = true; aiError.value = '请先保存 API Key。'; return }
  await autoRunner.start()
  if (props.webview && !aiQuestions.value.length) await readQuestions()
}
const closeAssistant = () => {
  autoRunner.stop('已关闭助手，连续解题已停止。')
  aiDrawerOpen.value = false
}
watch(autoSubmitEnabled, enabled => { if (!enabled) autoRunner.stop() })
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
const aiRenderedQuestion = computed(() => markdown.render(aiSelectedQuestion.value?.prompt || ''))

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

const readQuestions = async () => {
  const webview = props.webview
  if (!webview || aiReading.value || aiSolving.value || aiFilling.value || autoState.value.running) return
  const version = pageVersion
  aiReading.value = true
  resetAiAnswer()
  try {
    const result = await webview.executeJavaScript(getHomeworkExtractionScript(props.source)) as HomeworkQuestion[]
    if (version !== pageVersion) return
    aiQuestions.value = Array.isArray(result) ? result.filter(question => question.prompt || question.options.length || question.images.length) : []
    if (!aiQuestions.value.some(question => question.id === aiSelectedQuestionId.value)) {
      aiSelectedQuestionId.value = aiQuestions.value[0]?.id ?? ''
    }
    if (!aiQuestions.value.length) aiError.value = '当前页面没有读取到题目，请先进入某一道题或作答页面。'
    if (props.source === 'webwork') {
      autoPage.value = await guestScript<WebworkPage | null>(getWebworkInspectScript())
      autoHistory.value = readAutoHistory()
    }
  } catch (error) {
    if (version !== pageVersion) return
    aiError.value = `读取题目失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    if (version === pageVersion) aiReading.value = false
  }
}

const openAiAssistant = async () => {
  aiDrawerOpen.value = true
  await loadAiConfig()
  await readQuestions()
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
  if (!question || aiSolving.value || autoState.value.running) return
  if (!aiConfig.value.hasApiKey) {
    aiSettingsOpen.value = true
    aiError.value = '请先保存 API Key。'
    return
  }
  const version = pageVersion
  aiSolving.value = true
  aiError.value = ''
  aiAnswer.value = ''
  aiFills.value = []
  aiFillStatus.value = ''
  try {
    // Electron IPC cannot structured-clone Vue's reactive Proxy objects.
    const plainQuestion = JSON.parse(JSON.stringify(question)) as HomeworkQuestion
    const result = await window.electronAPI.aiHomeworkSolve({ question: plainQuestion })
    if (version !== pageVersion) return
    aiAnswer.value = result.answer
    aiAnswerModel.value = result.model
    aiFills.value = Array.isArray(result.fills) ? result.fills : []
    if (autoFillAnswers.value) await fillAnswers()
  } catch (error) {
    if (version !== pageVersion) return
    aiError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (version === pageVersion) aiSolving.value = false
  }
}

const fillAnswers = async (overwrite = false) => {
  const question = aiSelectedQuestion.value
  const webview = props.webview
  if (!question || !webview || aiFilling.value || autoState.value.running) return
  if (!aiFills.value.length) {
    aiFillStatus.value = '本次解答没有可可靠匹配的答案，请参照解答手动填写。'
    return
  }
  const version = pageVersion
  aiFilling.value = true
  aiFillStatus.value = ''
  try {
    const result = await webview.executeJavaScript(
      getHomeworkAnswerFillScript(question, aiFills.value, overwrite),
    ) as HomeworkFillResult
    if (version !== pageVersion) return
    aiFillStatus.value = result.message
  } catch (error) {
    if (version !== pageVersion) return
    aiFillStatus.value = `填入失败：${error instanceof Error ? error.message : String(error)}。请检查题目页面。`
  } finally {
    if (version === pageVersion) aiFilling.value = false
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
  aiFills.value = []
  aiFilling.value = false
  aiFillStatus.value = ''
  replaceAnswers.value = false
}

const changeAiQuestion = async (offset: -1 | 1) => {
  if (aiSolving.value || aiFilling.value || autoState.value.running) return
  const target = aiQuestions.value[aiSelectedQuestionIndex.value + offset]
  if (!target) return
  aiSelectedQuestionId.value = target.id
  aiSettingsOpen.value = false
  resetAiAnswer()
  await nextTick()
  aiDrawerScroll.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

// Navigation invalidates pending extraction and answers from the previous problem.
const invalidatePage = () => {
  pageVersion += 1
  aiReading.value = false
  aiSolving.value = false
  aiQuestions.value = []
  aiSelectedQuestionId.value = ''
  resetAiAnswer()
}
watch(aiDrawerOpen, (open) => emit('openChange', open))
watch(() => props.webview, (webview, _previous, onCleanup) => {
  if (autoState.value.running) autoRunner.stop('作业浏览器已变化，连续解题已停止。')
  invalidatePage()
  if (!webview) return
  const onNavigation = (event: Event & { isMainFrame?: boolean; isInPlace?: boolean }) => {
    if (event.isMainFrame === true && !event.isInPlace) {
      if (autoState.value.running && !['submitting', 'grading', 'navigating'].includes(autoState.value.phase)) {
        autoRunner.stop('题目页面已切换，连续解题已暂停。')
      }
      invalidatePage()
    }
  }
  const onReady = () => { if (aiDrawerOpen.value && !aiQuestions.value.length && !autoState.value.running) void readQuestions() }
  webview.addEventListener('did-start-navigation', onNavigation)
  webview.addEventListener('dom-ready', onReady)
  webview.addEventListener('did-finish-load', onReady)
  onCleanup(() => {
    webview.removeEventListener('did-start-navigation', onNavigation)
    webview.removeEventListener('dom-ready', onReady)
    webview.removeEventListener('did-finish-load', onReady)
  })
}, { immediate: true })
onBeforeUnmount(() => { pageVersion += 1; autoRunner.stop('作业页面已关闭。') })
</script>

<template>
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

  <aside v-if="aiDrawerOpen" class="ai-drawer" :class="{ 'ai-drawer--inline': layout === 'inline' }" aria-label="AI 作业助手">
    <header class="ai-drawer-header">
      <div class="ai-drawer-title">
        <span class="ai-drawer-icon"><el-icon><MagicStick /></el-icon></span>
        <div>
          <strong>AI 作业助手</strong>
          <small>自动读取当前{{ sourceLabel }}题目</small>
        </div>
      </div>
      <div class="ai-header-actions">
        <button aria-label="AI 设置" title="AI 设置" @click="aiSettingsOpen = !aiSettingsOpen">
          <el-icon><Setting /></el-icon>
        </button>
        <button aria-label="关闭 AI 助手" title="关闭" @click="closeAssistant">
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
          <button class="ai-text-button" :disabled="aiReading || aiSolving || aiFilling || autoState.running" @click="readQuestions">
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
            <select v-model="aiSelectedQuestionId" :disabled="aiSolving || aiFilling || autoState.running" @change="resetAiAnswer">
              <option v-for="question in aiQuestions" :key="question.id" :value="question.id">
                {{ question.number }} · {{ question.prompt.slice(0, 52) }}
              </option>
            </select>
          </label>
          <div v-if="aiSelectedQuestion" class="ai-question-preview">
            <strong>{{ aiSelectedQuestion.number }}</strong>
            <div class="ai-markdown" v-html="aiRenderedQuestion" />
            <ul v-if="aiSelectedQuestion.options.length">
              <li v-for="option in aiSelectedQuestion.options.slice(0, 8)" :key="option">{{ option }}</li>
            </ul>
            <div class="ai-question-meta">
              <span>{{ aiSelectedQuestion.answerType }}</span>
              <span v-if="aiSelectedQuestion.images.length">{{ aiSelectedQuestion.images.length }} 张图片</span>
              <span v-if="aiSelectedQuestion.formulas.length">{{ aiSelectedQuestion.formulas.length }} 个公式</span>
            </div>
            <div v-if="aiSelectedQuestion.images.some(image => image.dataUrl)" class="ai-question-images">
              <template v-for="(image, index) in aiSelectedQuestion.images" :key="index">
                <img v-if="image.dataUrl" :src="image.dataUrl" :alt="image.alt || `题目图片 ${index + 1}`">
              </template>
            </div>
            <p v-if="aiSelectedQuestion.images.some(image => !image.dataUrl)">
              部分图片未能读取，解答可能缺少图示信息。请重新读取题目。
            </p>
          </div>
          <label class="ai-fill-option">
            <input v-model="autoFillAnswers" type="checkbox">
            解答后自动填入空白答案（含下拉选项）
          </label>
          <button class="ai-primary-button" :disabled="aiSolving || aiFilling || autoState.running || !aiSelectedQuestion" @click="solveSelectedQuestion">
            <el-icon :class="{ 'is-loading': aiSolving }"><Refresh v-if="aiSolving" /><MagicStick v-else /></el-icon>
            {{ aiSolving ? '正在分析…' : aiAnswer ? '重新生成解答' : '一键解题' }}
          </button>
        </template>
      </section>

      <section v-if="source === 'webwork'" class="ai-auto-card">
        <strong>连续解题</strong>
        <label class="ai-fill-option">
          <input v-model="autoSubmitEnabled" type="checkbox">
          自动解答、提交并进入下一题
        </label>
        <p>从当前题开始处理未提交的题目。答错会标记并跳过，不自动二次提交；评分不明时暂停。</p>
        <button v-if="!autoState.running" class="ai-primary-button"
          :disabled="!autoSubmitEnabled || aiReading || aiSolving || aiFilling" @click="startAutoRun">开始连续解题</button>
        <button v-else class="ai-primary-button" @click="autoRunner.stop()">停止连续解题</button>
        <p v-if="autoState.message" role="status">{{ autoState.message }}</p>
        <ul v-if="visibleHistory.length" class="ai-auto-history" aria-label="自动提交记录">
          <li v-for="record in visibleHistory" :key="record.key" :class="`is-${record.status}`">
            <strong>{{ record.label }}</strong>
            <span>{{ recordLabels[record.status] }}{{ record.score !== null ? ` · ${record.score}%` : '' }}</span>
            <small>{{ record.message }}</small>
          </li>
        </ul>
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
        <div v-if="aiFills.length" class="ai-fill-controls">
          <strong>待填答案</strong>
          <ul>
            <li v-for="(fill, index) in aiFills" :key="fill.field">
              答案 {{ index + 1 }}：<code>{{ fill.values.join(', ') || '不勾选' }}</code>
            </li>
          </ul>
          <label class="ai-fill-option">
            <input v-model="replaceAnswers" type="checkbox" :disabled="aiFilling || autoState.running">
            替换读取题目时已有的答案
          </label>
          <button class="ai-primary-button" :disabled="aiFilling || aiReading || autoState.running" @click="fillAnswers(replaceAnswers)">
            {{ aiFilling ? '正在填入…' : '填入答案' }}
          </button>
        </div>
        <p v-if="aiFillStatus" class="ai-fill-status" role="status">{{ aiFillStatus }}</p>
      </section>

      <p class="ai-disclaimer">
        <el-icon><ChatDotRound /></el-icon>
        内容由 AI 生成，请自行核对。{{ source === 'webwork' ? '连续解题开启后会自动提交；其他情况下由你手动提交。' : '可自动填入答案，提交仍由你手动完成。' }}
      </p>
    </div>

    <footer v-if="aiQuestions.length" class="ai-question-nav" aria-label="题目导航">
      <button
        :disabled="!aiHasPreviousQuestion || aiSolving || aiFilling || autoState.running"
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
        :disabled="!aiHasNextQuestion || aiSolving || aiFilling || autoState.running"
        aria-label="切换到下一题"
        @click="changeAiQuestion(1)"
      >
        下一题
        <el-icon><ArrowRight /></el-icon>
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.ai-auto-card { display: flex; flex-direction: column; gap: 12px; border: 1px solid var(--border-soft); border-radius: 12px; padding: 16px; }
.ai-auto-card p { margin: 0; font-size: 12px; line-height: 1.6; color: var(--text-m); }
.ai-auto-history { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; list-style: none; }
.ai-auto-history li { display: flex; flex-direction: column; gap: 3px; overflow-wrap: anywhere; font-size: 12px; }
.ai-auto-history small { color: var(--text-m); }
.ai-auto-history .is-incorrect, .ai-auto-history .is-unknown { color: var(--el-color-danger); }

.ai-fill-option { display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; }
.ai-fill-option input { flex: 0 0 auto; }
.ai-fill-controls { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
.ai-fill-controls ul { margin: 0; padding-left: 20px; overflow-wrap: anywhere; }
.ai-fill-status { font-size: 12px; line-height: 1.6; color: var(--text-m); }

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
  top: 0;
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
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: scroll;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ai-drawer-scroll > * { flex-shrink: 0; }

.ai-drawer-scroll::-webkit-scrollbar { width: 12px; }
.ai-drawer-scroll::-webkit-scrollbar-track { background: var(--bg-surface); }
.ai-drawer-scroll::-webkit-scrollbar-thumb {
  background: var(--text-m);
  border: 3px solid var(--bg-surface);
  border-radius: 8px;
}

/* Inline panels participate in the host grid instead of covering the page. */
.ai-drawer.ai-drawer--inline {
  position: relative;
  inset: auto;
  width: auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  border-top: 1px solid var(--border-soft);
  box-shadow: none;
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
.ai-question-images { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.ai-question-images img { max-width: 100%; max-height: 160px; object-fit: contain; border-radius: 6px; background: #fff; }
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
  .ai-drawer { width: min(92vw, 420px); }
  .ai-fab { right: 16px; bottom: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .ai-reading-state span { animation: none; opacity: 0.72; }
}
</style>
