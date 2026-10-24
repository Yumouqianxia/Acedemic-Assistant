<script setup lang="ts">
import { Back, Link, Refresh } from '@element-plus/icons-vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AiHomeworkAssistant from './AiHomeworkAssistant.vue'
import type { HomeworkWebview } from '../types/ai-homework'

const props = defineProps<{
  cmid: number
  title: string
  courseName: string
}>()

defineEmits<{ close: [] }>()

const launchUrl = ref('')
const loading = ref(false)
const preparing = ref(false)
// Once a document is visible, keep it visible throughout problem navigation.
// Loading another page or an iframe is not another Moodle authentication.
const pageReady = ref(false)
const slow = ref(false)
const error = ref('')
const browserKey = ref(0)
const ltiWebview = ref<HomeworkWebview | null>(null)
const aiDrawerOpen = ref(false)
let requestId = 0
let slowTimer: ReturnType<typeof setTimeout> | undefined

const loadingHint = computed(() => slow.value
  ? '页面响应较慢，仍在加载，可继续等待或重新连接。'
  : preparing.value ? '正在准备作业连接…' : '正在加载作业页面…')

const clearSlowTimer = () => {
  clearTimeout(slowTimer)
  slowTimer = undefined
}

const startLoading = () => {
  loading.value = true
  error.value = ''
  if (!slowTimer) slowTimer = setTimeout(() => { slow.value = true }, 15_000)
}

const stopLoading = () => {
  loading.value = false
  slow.value = false
  clearSlowTimer()
}

const onNavigationStarted = (event: Event & { isMainFrame?: boolean; isInPlace?: boolean }) => {
  if (event.isMainFrame !== true || event.isInPlace) return
  startLoading()
}

const onDomReady = () => {
  pageReady.value = true
  // DOM readiness makes the page usable; slow fonts, images and subframes must
  // not keep an opaque loading screen over the assignment.
  stopLoading()
}

const launch = async () => {
  const currentRequest = ++requestId
  launchUrl.value = ''
  aiDrawerOpen.value = false
  preparing.value = true
  pageReady.value = false
  slow.value = false
  clearSlowTimer()
  startLoading()
  try {
    const url = await window.electronAPI.moodleLtiLaunchUrl({ cmid: props.cmid })
    if (currentRequest !== requestId) return
    browserKey.value += 1
    launchUrl.value = url
  } catch (cause) {
    if (currentRequest !== requestId) return
    stopLoading()
    error.value = cause instanceof Error ? cause.message : '无法连接作业，请重试。'
  } finally {
    if (currentRequest === requestId) preparing.value = false
  }
}

const onLoadFailed = (event: Event & {
  errorCode?: number
  errorDescription?: string
  isMainFrame?: boolean
}) => {
  // Redirects cancel the previous navigation; missing subresources should not
  // cover a usable assignment with an error screen.
  if (event.errorCode === -3 || event.isMainFrame === false) return
  stopLoading()
  error.value = event.errorDescription || '作业页面加载失败，请检查网络后重新连接。'
}

watch(() => props.cmid, () => { void launch() }, { immediate: true })
onBeforeUnmount(() => { requestId += 1; clearSlowTimer() })
</script>

<template>
  <section class="lti-browser homework-browser" aria-label="外部作业">
    <header class="lti-toolbar">
      <button class="lti-button" @click="$emit('close')">
        <el-icon><Back /></el-icon>
        返回课程
      </button>
      <div class="lti-heading">
        <strong><el-icon><Link /></el-icon>{{ title }}</strong>
        <span :title="courseName" :role="loading ? 'status' : undefined">
          {{ loading ? loadingHint : courseName }}
        </span>
      </div>
      <button class="lti-button" :disabled="preparing" @click="launch">
        <el-icon :class="{ 'is-loading': preparing }"><Refresh /></el-icon>
        重新连接
      </button>
    </header>
    <div class="homework-browser-content" :class="{ 'has-ai-drawer': aiDrawerOpen }">
      <div class="lti-viewport homework-browser-viewport" :aria-busy="loading">
        <webview
          v-if="launchUrl"
          ref="ltiWebview"
          :key="browserKey"
          class="homework-browser-webview"
          :src="launchUrl"
          partition="persist:students"
          webpreferences="contextIsolation=yes, nodeIntegration=no, sandbox=yes"
          @did-start-navigation="onNavigationStarted"
          @dom-ready="onDomReady"
          @did-stop-loading="stopLoading"
          @did-fail-load="onLoadFailed"
        ></webview>
        <div v-if="loading && !pageReady && !slow && !error" class="lti-status lti-loading" role="status">
          <el-icon class="is-loading"><Refresh /></el-icon>
          {{ loadingHint }}
        </div>
        <div v-if="error" class="lti-status lti-error" role="alert">
          <strong>暂时无法打开作业</strong>
          <p>{{ error }}</p>
          <button class="lti-button" :disabled="preparing" @click="launch">重新连接</button>
        </div>
      </div>
      <AiHomeworkAssistant
        v-if="launchUrl"
        :webview="ltiWebview"
        source="webwork"
        layout="inline"
        @open-change="aiDrawerOpen = $event"
      />
    </div>
  </section>
</template>

<style scoped>
@import '../styles/embeddedHomeworkLayout.css';

.lti-browser {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.lti-toolbar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px 24px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
}
.lti-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 9px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-surface);
  color: var(--text-b);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.lti-button:hover:not(:disabled) { border-color: var(--accent-b); color: var(--accent-b); }
.lti-button:focus-visible { outline: 2px solid var(--accent-b); outline-offset: 3px; }
.lti-button:disabled { opacity: 0.5; cursor: wait; }
.lti-heading { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.lti-heading strong { display: flex; align-items: center; gap: 8px; color: var(--text-h); }
.lti-heading span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-m); font-size: 12px; }
.lti-viewport { background: #fff; }
.lti-status {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
  padding: 24px;
  background: var(--bg-page);
  color: var(--text-b);
  text-align: center;
}
.lti-loading { pointer-events: none; }
.lti-status p { margin: 0; max-width: 560px; overflow-wrap: anywhere; }
</style>
