<script setup lang="ts">
import { Back, Link, Refresh } from '@element-plus/icons-vue'
import { onBeforeUnmount, ref, watch } from 'vue'
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
const error = ref('')
const browserKey = ref(0)
const ltiWebview = ref<HomeworkWebview | null>(null)
const aiDrawerOpen = ref(false)
let requestId = 0

const launch = async () => {
  const currentRequest = ++requestId
  launchUrl.value = ''
  aiDrawerOpen.value = false
  preparing.value = true
  loading.value = true
  error.value = ''
  try {
    const url = await window.electronAPI.moodleLtiLaunchUrl({ cmid: props.cmid })
    if (currentRequest !== requestId) return
    browserKey.value += 1
    launchUrl.value = url
  } catch (cause) {
    if (currentRequest !== requestId) return
    loading.value = false
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
  loading.value = false
  error.value = event.errorDescription || '作业页面加载失败，请检查网络后重新连接。'
}

watch(() => props.cmid, () => { void launch() }, { immediate: true })
onBeforeUnmount(() => { requestId += 1 })
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
        <span :title="courseName">{{ courseName }}</span>
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
          @did-start-loading="loading = true; error = ''"
          @did-stop-loading="loading = false"
          @did-fail-load="onLoadFailed"
        ></webview>
        <div v-if="loading && !error" class="lti-status lti-loading" role="status">
          <el-icon class="is-loading"><Refresh /></el-icon>
          正在通过 Moodle 连接作业…
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
