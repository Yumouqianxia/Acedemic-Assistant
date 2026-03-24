<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Back,
  Calendar,
  Medal,
  UserFilled,
  Document,
  Reading,
  DocumentCopy,
  ChatDotSquare,
  Link,
  Refresh,
  ArrowDown,
  ArrowUp,
  FolderOpened,
} from '@element-plus/icons-vue'

type UnifiedCourse = {
  courseKey: string
  courseCode: string
  courseName: string
  semesterLabel: string
  semesterTechnion: string
  credits: number | null
  moodleCourseId: number | null
  hasMoodle: boolean
  hasStudents: boolean
  updatedAt: string
}

type StudentsExam = {
  semesterTechnion: string
  courseCode: string
  courseName: string
  examSession: string
  date: string
  time: string
  duration: string
  venue: string
}

type MoodleSection = {
  id: number
  name: string
  moduleCount: number
  modules: Array<{
    id: number
    name: string
    modname: string
    url: string
    resources: Array<{
      filename: string
      filesize: number
      mimetype: string
      fileurl: string
    }>
  }>
}

const props = defineProps<{
  course: UnifiedCourse
  sections: MoodleSection[]
  loading: boolean
  exams: StudentsExam[]
}>()

const emit = defineEmits<{
  back: []
  openSubmission: [payload: { cmid: number; courseId: number; assignName: string; courseName: string }]
}>()

const collapsedSections = ref(new Set<number>())

const toggleSection = (id: number) => {
  if (collapsedSections.value.has(id)) {
    collapsedSections.value.delete(id)
  } else {
    collapsedSections.value.add(id)
  }
  // force reactivity
  collapsedSections.value = new Set(collapsedSections.value)
}

const isSectionCollapsed = (id: number) => collapsedSections.value.has(id)

const formatBytes = (bytes: number) => {
  if (!bytes) return '-'
  const mb = bytes / 1024 / 1024
  if (mb < 0.1) return `${(bytes / 1024).toFixed(0)} KB`
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
}

const getFileExt = (filename: string) => {
  const parts = filename.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'FILE'
}

const getExtColor = (ext: string) => {
  const map: Record<string, string> = {
    PDF: '#e74c3c',
    DOC: '#2980b9',
    DOCX: '#2980b9',
    PPT: '#e67e22',
    PPTX: '#e67e22',
    XLS: '#27ae60',
    XLSX: '#27ae60',
    ZIP: '#8e44ad',
    RAR: '#8e44ad',
    MP4: '#16a085',
    PNG: '#2980b9',
    JPG: '#2980b9',
  }
  return map[ext] ?? '#555e6a'
}

const isPdf = (resource: { filename: string; mimetype: string }) =>
  resource.mimetype === 'application/pdf' || resource.filename.toLowerCase().endsWith('.pdf')

const openResource = async (resource: { filename: string; fileurl: string; mimetype: string }) => {
  await window.electronAPI.openPdfViewer({ url: resource.fileurl, title: resource.filename })
}

const openUrl = (url: string) => {
  window.open(url, '_blank')
}

const visibleSections = computed(() =>
  props.sections.filter((s) => s.modules.length > 0),
)
</script>

<template>
  <div class="cd-page">
    <!-- Top nav bar -->
    <div class="cd-topbar">
      <button class="cd-back-btn" @click="emit('back')">
        <el-icon><Back /></el-icon>
        Back to Dashboard
      </button>
      <span class="cd-breadcrumb">
        Home
        <span class="cd-breadcrumb-sep">/</span>
        {{ course.courseCode }} - {{ course.courseName }}
      </span>
    </div>

    <div class="cd-body">
      <!-- Course header card -->
      <div class="cd-header-card">
        <div class="cd-course-icon">
          <el-icon :size="28"><Reading /></el-icon>
        </div>
        <div class="cd-course-info">
          <h1 class="cd-course-title">
            {{ course.courseName }}
            <span class="cd-course-code-inline"> ({{ course.courseCode }})</span>
          </h1>
          <div class="cd-course-meta">
            <span class="cd-meta-chip">
              <el-icon><Calendar /></el-icon>
              {{ course.semesterLabel || '-' }}
            </span>
            <span class="cd-meta-chip">
              <el-icon><Medal /></el-icon>
              {{ course.credits ?? '-' }} Credits
            </span>
            <span class="cd-meta-sources">
              <span class="cd-source-label">source</span>
              <span v-if="course.hasMoodle" class="source-tag source-tag--moodle">
                <span class="source-m-icon">m</span>Moodle
              </span>
              <span v-if="course.hasStudents" class="source-tag source-tag--students">
                <el-icon><UserFilled /></el-icon>Students
              </span>
            </span>
          </div>
        </div>
      </div>

      <!-- Exam table -->
      <div v-if="exams.length" class="cd-section-block">
        <div class="cd-section-header" @click="toggleSection(-1)">
          <div class="cd-section-title-row">
            <el-icon class="cd-section-icon"><DocumentCopy /></el-icon>
            <span class="cd-section-title">考试安排</span>
            <span class="cd-section-count">{{ exams.length }} 项</span>
          </div>
          <el-icon class="cd-section-toggle">
            <ArrowUp v-if="!isSectionCollapsed(-1)" />
            <ArrowDown v-else />
          </el-icon>
        </div>
        <div v-if="!isSectionCollapsed(-1)" class="cd-exam-table-wrap">
          <el-table :data="exams" size="small" class="cd-exam-table">
            <el-table-column prop="examSession" label="场次" width="70" />
            <el-table-column prop="date" label="日期" width="120" />
            <el-table-column prop="time" label="时间" width="80" />
            <el-table-column prop="duration" label="时长" width="100" />
            <el-table-column prop="venue" label="地点" />
          </el-table>
        </div>
      </div>

      <!-- Moodle sections -->
      <div v-if="loading" class="cd-loading-state">
        <el-icon class="is-loading cd-spin-icon"><Refresh /></el-icon>
        <span>加载课件中…</span>
      </div>
      <div v-else-if="!course.hasMoodle" class="cd-empty-state">
        该课程无 Moodle 记录
      </div>
      <div v-else-if="!visibleSections.length && !loading" class="cd-empty-state">
        暂无 Moodle 课件数据
      </div>

      <div
        v-for="section in visibleSections"
        :key="section.id"
        class="cd-section-block"
      >
        <!-- Section header (collapsible) -->
        <div class="cd-section-header" @click="toggleSection(section.id)">
          <div class="cd-section-title-row">
            <el-icon class="cd-section-icon"><FolderOpened /></el-icon>
            <span class="cd-section-title">{{ section.name || '未命名章节' }}</span>
            <span class="cd-section-count">{{ section.moduleCount }} 项</span>
          </div>
          <el-icon class="cd-section-toggle">
            <ArrowUp v-if="!isSectionCollapsed(section.id)" />
            <ArrowDown v-else />
          </el-icon>
        </div>

        <!-- Cards grid -->
        <div v-if="!isSectionCollapsed(section.id)" class="cd-cards-grid">
          <template v-for="mod in section.modules" :key="mod.id">

            <!-- Resource: one card per file -->
            <template v-if="mod.resources.length">
              <div
                v-for="res in mod.resources"
                :key="`${mod.id}-${res.fileurl}`"
                class="cd-file-card"
              >
                <div
                  class="cd-file-ext-badge"
                  :style="{ background: getExtColor(getFileExt(res.filename)) }"
                >
                  {{ getFileExt(res.filename) }}
                </div>
                <div class="cd-file-body">
                  <div class="cd-file-name" :title="res.filename">{{ res.filename || mod.name }}</div>
                  <div class="cd-file-sub">
                    <span class="cd-file-type-tag">{{ mod.modname }}</span>
                    <span class="cd-file-module-name" :title="mod.name">{{ mod.name }}</span>
                  </div>
                  <div class="cd-file-size">({{ formatBytes(res.filesize) }})</div>
                </div>
                <button
                  class="cd-action-btn cd-action-btn--primary"
                  :title="isPdf(res) ? '在新窗口预览' : '在新窗口打开'"
                  @click="openResource(res)"
                >
                  <el-icon><Document /></el-icon>
                  {{ isPdf(res) ? '预览 PDF' : '打开文件' }}
                </button>
              </div>
            </template>

            <!-- Forum module -->
            <div v-else-if="mod.modname === 'forum'" class="cd-file-card cd-file-card--forum">
              <div class="cd-file-ext-badge cd-file-ext-badge--forum">
                <el-icon :size="18"><ChatDotSquare /></el-icon>
              </div>
              <div class="cd-file-body">
                <div class="cd-file-name" :title="mod.name">{{ mod.name }}</div>
                <div class="cd-file-sub">
                  <span class="cd-file-type-tag cd-file-type-tag--forum">forum</span>
                  <span class="cd-file-url-preview" :title="mod.url">{{ mod.url }}</span>
                </div>
              </div>
              <button
                class="cd-action-btn cd-action-btn--forum"
                @click="openUrl(mod.url)"
              >
                <el-icon><ChatDotSquare /></el-icon>
                查看论坛
              </button>
            </div>

            <!-- Assignment module -->
            <div v-else-if="mod.modname === 'assign'" class="cd-file-card cd-file-card--assign">
              <div class="cd-file-ext-badge cd-file-ext-badge--assign">
                <el-icon :size="18"><DocumentCopy /></el-icon>
              </div>
              <div class="cd-file-body">
                <div class="cd-file-name" :title="mod.name">{{ mod.name }}</div>
                <div class="cd-file-sub">
                  <span class="cd-file-type-tag cd-file-type-tag--assign">assign</span>
                </div>
              </div>
              <button
                class="cd-action-btn cd-action-btn--assign"
                @click="emit('openSubmission', { cmid: mod.id, courseId: course.moodleCourseId!, assignName: mod.name, courseName: course.courseName })"
              >
                <el-icon><DocumentCopy /></el-icon>
                提交作业
              </button>
            </div>

            <!-- URL module -->
            <div v-else-if="mod.modname === 'url'" class="cd-file-card cd-file-card--url">
              <div class="cd-file-ext-badge cd-file-ext-badge--url">
                <el-icon :size="18"><Link /></el-icon>
              </div>
              <div class="cd-file-body">
                <div class="cd-file-name" :title="mod.name">{{ mod.name }}</div>
                <div class="cd-file-sub">
                  <span class="cd-file-type-tag">url</span>
                  <span class="cd-file-url-preview" :title="mod.url">{{ mod.url }}</span>
                </div>
              </div>
              <button
                class="cd-action-btn cd-action-btn--forum"
                @click="openUrl(mod.url)"
              >
                <el-icon><Link /></el-icon>
                打开链接
              </button>
            </div>

            <!-- Other module types (no resources) -->
            <div v-else class="cd-file-card cd-file-card--other">
              <div class="cd-file-ext-badge" :style="{ background: '#555e6a' }">
                <el-icon :size="18"><Reading /></el-icon>
              </div>
              <div class="cd-file-body">
                <div class="cd-file-name" :title="mod.name">{{ mod.name }}</div>
                <div class="cd-file-sub">
                  <span class="cd-file-type-tag">{{ mod.modname }}</span>
                </div>
              </div>
              <button
                v-if="mod.url"
                class="cd-action-btn cd-action-btn--forum"
                @click="openUrl(mod.url)"
              >
                前往 Moodle
              </button>
            </div>

          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Page Layout ─────────────────────────────────────────────── */
.cd-page {
  position: absolute;
  inset: 40px 0 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-page);
  color: var(--text-b);
  overflow: hidden;
  z-index: 100;
}

/* ── Top nav bar ─────────────────────────────────────────────── */
.cd-topbar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 10px 24px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.cd-back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: var(--chip-bg);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  color: var(--text-b);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  font-family: inherit;
}

.cd-back-btn:hover {
  background: var(--bg-surface-hover);
  border-color: var(--accent-bb);
  color: var(--accent-bb);
}

.cd-breadcrumb {
  font-size: 13px;
  color: var(--text-m);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cd-breadcrumb-sep {
  margin: 0 6px;
  color: var(--border-strong);
}

/* ── Scrollable body ─────────────────────────────────────────── */
.cd-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px 40px;
}

.cd-body::-webkit-scrollbar {
  width: 6px;
}
.cd-body::-webkit-scrollbar-track {
  background: transparent;
}
.cd-body::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 3px;
}

/* ── Course header card ──────────────────────────────────────── */
.cd-header-card {
  display: flex;
  align-items: center;
  gap: 18px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px 24px;
  margin-bottom: 16px;
}

.cd-course-icon {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  background: var(--chip-bg);
  border: 1px solid var(--border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-b);
  flex-shrink: 0;
}

.cd-course-info {
  flex: 1;
  min-width: 0;
}

.cd-course-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-h);
  line-height: 1.3;
}

.cd-course-code-inline {
  font-size: 15px;
  font-weight: 400;
  color: var(--text-m);
}

.cd-course-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.cd-meta-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: var(--text-m);
  background: var(--chip-bg);
  border: 1px solid var(--chip-border);
  border-radius: 20px;
  padding: 3px 10px;
}

.cd-meta-sources {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.cd-source-label {
  font-size: 12px;
  color: var(--text-m);
}

.source-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 20px;
  border: 1.5px solid transparent;
  letter-spacing: 0.2px;
}

.source-tag--moodle {
  background: var(--tag-m-bg);
  color: var(--tag-m-text);
  border-color: var(--tag-m-border);
}

.source-tag--students {
  background: var(--tag-s-bg);
  color: var(--tag-s-text);
  border-color: var(--tag-s-border);
}

.source-m-icon {
  font-style: normal;
  font-weight: 700;
  font-size: 13px;
  font-family: Georgia, serif;
  color: var(--tag-m-text);
}

/* ── Section block ───────────────────────────────────────────── */
.cd-section-block {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 16px;
}

.cd-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.cd-section-header:hover {
  background: var(--bg-surface-hover);
}

.cd-section-title-row {
  display: flex;
  align-items: center;
  gap: 9px;
}

.cd-section-icon {
  color: var(--accent-b);
  flex-shrink: 0;
}

.cd-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-h);
}

.cd-section-count {
  font-size: 12px;
  color: var(--text-m);
  background: var(--chip-bg);
  border: 1px solid var(--chip-border);
  border-radius: 20px;
  padding: 1px 8px;
}

.cd-section-toggle {
  color: var(--text-m);
  font-size: 14px;
}

/* ── Exam table ──────────────────────────────────────────────── */
.cd-exam-table-wrap {
  padding: 0 16px 16px;
}

.cd-exam-table {
  border-radius: 8px;
  overflow: hidden;
}

/* el-table adaptive overrides */
.cd-exam-table-wrap :deep(.el-table) {
  background-color: var(--bg-surface-alt);
  color: var(--text-b);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.cd-exam-table-wrap :deep(.el-table tr),
.cd-exam-table-wrap :deep(.el-table th.el-table__cell),
.cd-exam-table-wrap :deep(.el-table td.el-table__cell) {
  background-color: var(--bg-surface-alt);
  color: var(--text-b);
  border-bottom-color: var(--border);
}

.cd-exam-table-wrap :deep(.el-table th.el-table__cell) {
  background-color: var(--bg-surface);
  color: var(--text-m);
  font-weight: 600;
  font-size: 12px;
}

.cd-exam-table-wrap :deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background-color: var(--bg-surface);
}

.cd-exam-table-wrap :deep(.el-table__body tr:hover > td.el-table__cell) {
  background-color: var(--bg-surface-hover);
}

.cd-exam-table-wrap :deep(.el-table__inner-wrapper::before),
.cd-exam-table-wrap :deep(.el-table__border-left-patch) {
  background-color: var(--border);
}

.cd-exam-table-wrap :deep(.el-table__cell) {
  border-right-color: var(--border);
}

.cd-exam-table-wrap :deep(.el-scrollbar__bar) {
  background-color: var(--border-strong);
}

/* ── Card grid ───────────────────────────────────────────────── */
.cd-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  padding: 12px 16px 16px;
}

/* ── File card ───────────────────────────────────────────────── */
.cd-file-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: var(--bg-surface-alt);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px;
  transition: border-color 0.15s, box-shadow 0.15s;
  position: relative;
}

.cd-file-card:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-h);
}

/* Ext badge */
.cd-file-ext-badge {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.3px;
}

.cd-file-ext-badge--forum {
  background: var(--cd-badge-forum-bg);
  color: var(--cd-badge-forum-text);
}

.cd-file-ext-badge--assign {
  background: var(--cd-badge-assign-bg);
  color: var(--cd-badge-assign-text);
}

.cd-file-ext-badge--url {
  background: var(--cd-badge-url-bg);
  color: var(--cd-badge-url-text);
}

/* File body */
.cd-file-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cd-file-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.cd-file-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.cd-file-type-tag {
  font-size: 10px;
  font-weight: 600;
  color: var(--cd-type-tag-text);
  background: var(--cd-type-tag-bg);
  border-radius: 4px;
  padding: 1px 5px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.cd-file-type-tag--forum {
  color: var(--cd-badge-forum-text);
  background: var(--cd-badge-forum-bg);
}

.cd-file-type-tag--assign {
  color: var(--cd-badge-assign-text);
  background: var(--cd-badge-assign-bg);
}

.cd-file-module-name,
.cd-file-url-preview {
  font-size: 11px;
  color: var(--text-m);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.cd-file-size {
  font-size: 11px;
  color: var(--text-m);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Action button */
.cd-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: row;
  gap: 5px;
  min-width: 88px;
  padding: 7px 12px;
  border-radius: 7px;
  border: 1.5px solid transparent;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  text-align: center;
  line-height: 1.4;
  flex-shrink: 0;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.cd-action-btn--primary {
  background: var(--cd-action-p-bg);
  border-color: var(--cd-action-p-border);
  color: var(--cd-action-p-text);
}

.cd-action-btn--primary:hover {
  background: var(--cd-action-p-border);
  color: #fff;
}

.cd-action-btn--forum {
  background: var(--bg-surface);
  border-color: var(--border-strong);
  color: var(--text-m);
}

.cd-action-btn--forum:hover {
  background: var(--bg-surface-hover);
  border-color: var(--accent-b);
  color: var(--accent-b);
}

.cd-action-btn--assign {
  background: var(--cd-action-assign-bg);
  border-color: var(--cd-action-assign-border);
  color: var(--cd-action-assign-text);
  min-width: 100px;
}

.cd-action-btn--assign:hover {
  background: var(--cd-action-assign-border);
  color: #fff;
}

/* ── Loading / empty states ──────────────────────────────────── */
.cd-loading-state,
.cd-empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 0;
  color: var(--text-m);
  font-size: 14px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  margin-bottom: 16px;
}

.cd-spin-icon {
  font-size: 20px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
