<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { TimelineEvent, UnifiedCourse } from './types'
import { useAuth } from './composables/useAuth'
import { useDashboard } from './composables/useDashboard'
import { useTimeline } from './composables/useTimeline'
import { useSubmission } from './composables/useSubmission'
import { useWindowControls } from './composables/useWindowControls'
import { useTheme, type ThemeMode } from './composables/useTheme'
import { formatCourseDelta, notifyError, notifySuccess, notifyWarning } from './composables/useUtils'
import AppTitleBar from './components/AppTitleBar.vue'
import AppSidebar from './components/AppSidebar.vue'
import LoginView from './views/LoginView.vue'
import DashboardView from './views/DashboardView.vue'
import CoursesView from './views/CoursesView.vue'
import NotebookView from './views/NotebookView.vue'
import SubmissionView from './views/SubmissionView.vue'
import CourseDetailView from './views/CourseDetailView.vue'
import SettingsView from './views/SettingsView.vue'
import GradeView from './views/GradeView.vue'
import ProfileView from './views/ProfileView.vue'

const router = useRouter()
const appStage = ref<'login' | 'dashboard' | 'course' | 'notebook' | 'grade' | 'profile' | 'submission' | 'courseDetail' | 'settings'>('login')
const submissionBackTarget = ref<'dashboard' | 'course'>('dashboard')
const courseDetailBackTarget = ref<'dashboard' | 'course'>('dashboard')
const isMac = ref(false)

const sidebarActiveStage = computed(() => {
  if (appStage.value === 'courseDetail' || appStage.value === 'course') return 'course'
  if (appStage.value === 'submission') return 'dashboard'
  return appStage.value
})

const handleSidebarNavigate = (stage: string) => {
  if (stage === 'dashboard') {
    appStage.value = 'dashboard'
    void router.push({ name: 'home' })
  } else if (stage === 'course') {
    appStage.value = 'course'
    void router.push({ name: 'home' })
  } else if (stage === 'notebook') {
    appStage.value = 'notebook'
  } else if (stage === 'grade') {
    appStage.value = 'grade'
  } else if (stage === 'profile') {
    appStage.value = 'profile'
  } else if (stage === 'settings') {
    handleOpenSettings()
  }
}

const {
  user,
  loginForm,
  rememberPassword,
  loggingIn,
  autoSsoLogin,
  loadProfiles,
  saveLastLoginUsername,
  hydrateRememberedLogin,
  saveSession,
  restoreSession,
  clearSession,
} = useAuth()
const { moodleSyncing, studentsSyncing, selectedCourse, selectedSections, loadingSections, selectedCourseExams, loadDashboard, loadCourseContents, clearDashboard } = useDashboard()
const { loadTimeline, clearTimeline } = useTimeline()
const { openSubmission, clearSubmission } = useSubmission()
const { isMaximized, winMinimize, winMaximize, winClose, initWindowState } = useWindowControls()
const { isDark, themeMode, setThemeMode, toggleTheme } = useTheme()
const language = ref<'zh-CN' | 'en-US'>('zh-CN')
const autoSyncIntervalHours = ref<0 | 6 | 24>(24)
const downloadDirectory = ref('')
const appVersion = ref('')
let removeUpdaterStatusListener: (() => void) | null = null

// ── Cross-cutting orchestration ───────────────────────────────────────────────

const syncAfterLogin = async (username: string) => {
  moodleSyncing.value = true
  studentsSyncing.value = true
  try {
    const syncResult = await window.electronAPI.dashboardSyncAll({ username, trigger: 'login' })
    await loadProfiles()
    await loadDashboard()
    const moodleText = `Moodle(${formatCourseDelta(syncResult.moodle.delta)})`
    const studentsTimeout = Boolean(syncResult.studentsError && /ERR_TIMED_OUT/i.test(syncResult.studentsError))
    const studentsText = syncResult.students
      ? `Students(课程${formatCourseDelta(syncResult.students.delta.courses)}；考试 新增 ${syncResult.students.delta.exams.inserted}，更新 ${syncResult.students.delta.exams.updated}，删除 ${syncResult.students.delta.exams.deleted})`
      : studentsTimeout
        ? 'Students(网络超时，已跳过本次登录同步)'
        : `Students(跳过：${syncResult.studentsError || '未认证'})`
    if (syncResult.students || !syncResult.studentsError) {
      notifySuccess(`登录后同步完成：${moodleText}，${studentsText}`, '同步完成')
    } else {
      notifyWarning(`登录后仅完成 Moodle 同步：${moodleText}，${studentsText}`, '同步部分完成')
    }
    void loadTimeline()
  } catch (error) {
    notifyWarning(error instanceof Error ? `登录后自动同步失败：${error.message}` : '登录后自动同步失败', '同步失败')
  } finally {
    moodleSyncing.value = false
    studentsSyncing.value = false
  }
}

const handleLogin = async () => {
  loggingIn.value = true
  try {
    const result = await window.electronAPI.moodleLogin({
      username: loginForm.username,
      password: loginForm.password,
      rememberPassword: rememberPassword.value,
    })
    user.value = result
    saveSession(result)
    saveLastLoginUsername(result.username)
    loginForm.password = ''
    appStage.value = 'dashboard'
    notifySuccess('登录成功，正在后台同步 Moodle / Students 数据', '登录成功')
    await loadProfiles()
    await loadDashboard()
    void syncAfterLogin(result.username)
  } catch (error) {
    notifyError(error instanceof Error ? error.message : '登录失败', '登录失败')
  } finally {
    loggingIn.value = false
  }
}

const handleSsoLogin = async () => {
  loggingIn.value = true
  try {
    const result = await window.electronAPI.moodleSsoLogin()
    user.value = result
    saveSession(result)
    saveLastLoginUsername(result.username)
    appStage.value = 'dashboard'
    notifySuccess('SSO 登录成功，正在后台同步数据', '登录成功')
    await loadProfiles()
    await loadDashboard()
    void syncAfterLogin(result.username)
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'SSO 登录失败', 'SSO 登录失败')
  } finally {
    loggingIn.value = false
  }
}

const handleLogout = async () => {
  await window.electronAPI.moodleLogout({ username: user.value?.username })
  clearSession()
  user.value = null
  clearDashboard()
  clearTimeline()
  clearSubmission()
  submissionBackTarget.value = 'dashboard'
  appStage.value = 'login'
  notifySuccess('已退出当前账号', '退出成功')
}

const handleSyncAll = async () => {
  if (!user.value) return
  moodleSyncing.value = true
  studentsSyncing.value = true
  try {
    const result = await window.electronAPI.dashboardSyncAll({
      username: user.value.username,
      trigger: 'manual',
    })
    await loadDashboard()
    const moodleText = `Moodle(${formatCourseDelta(result.moodle.delta)})`
    const studentsText = result.students
      ? `Students(课程${formatCourseDelta(result.students.delta.courses)}；考试 新增 ${result.students.delta.exams.inserted}，更新 ${result.students.delta.exams.updated}，删除 ${result.students.delta.exams.deleted})`
      : `Students(跳过：${result.studentsError || '未认证'})`
    notifySuccess(`同步完成：${moodleText}，${studentsText}`, '同步完成')
    void loadTimeline()
  } catch (error) {
    notifyError(error instanceof Error ? error.message : '同步全部失败', '同步失败')
  } finally {
    moodleSyncing.value = false
    studentsSyncing.value = false
  }
}

const handleRefreshGrades = async () => {
  if (!user.value) {
    notifyWarning('请先登录后再刷新成绩', '未登录')
    return
  }
  studentsSyncing.value = true
  try {
    await window.electronAPI.studentsSync()
    await loadDashboard()
    notifySuccess('成绩刷新完成', '刷新成功')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : '刷新成绩失败', '刷新失败')
  } finally {
    studentsSyncing.value = false
  }
}

const handleSelectCourse = async (course: UnifiedCourse) => {
  courseDetailBackTarget.value = appStage.value === 'course' ? 'course' : 'dashboard'
  selectedCourse.value = course
  appStage.value = 'courseDetail'
  void router.push({
    name: 'course-detail',
    params: { courseId: course.moodleCourseId ?? course.courseKey },
  })
  void loadCourseContents(course)
}

const handleBackFromCourseDetail = () => {
  appStage.value = courseDetailBackTarget.value
  selectedCourse.value = null
  selectedSections.value = []
  loadingSections.value = false
  void router.push({ name: 'home' })
}

const handleOpenSettings = () => {
  appStage.value = 'settings'
  void router.push({ name: 'settings' })
}

const handleBackFromSettings = () => {
  appStage.value = 'dashboard'
  void router.push({ name: 'home' })
}

const persistPreferences = async (patch: Partial<{
  language: 'zh-CN' | 'en-US'
  themeMode: ThemeMode
  autoSyncIntervalHours: 0 | 6 | 24
  downloadDirectory: string | null
}>) => {
  try {
    const next = await window.electronAPI.appPreferencesUpdate(patch)
    language.value = next.language
    setThemeMode(next.themeMode)
    autoSyncIntervalHours.value = next.autoSyncIntervalHours
    downloadDirectory.value = next.downloadDirectory || await window.electronAPI.getDownloadDirectory()
  } catch (error) {
    notifyWarning(error instanceof Error ? error.message : '设置保存失败', '设置失败')
  }
}

const handleLanguageChange = (nextLanguage: 'zh-CN' | 'en-US') => {
  language.value = nextLanguage
  void persistPreferences({ language: nextLanguage })
}

const handleThemeModeChange = (mode: ThemeMode) => {
  setThemeMode(mode)
  void persistPreferences({ themeMode: mode })
}

const handleToggleThemeFromTitleBar = () => {
  toggleTheme()
  void persistPreferences({ themeMode: themeMode.value })
}

const handleAutoSyncIntervalChange = (hours: 0 | 6 | 24) => {
  autoSyncIntervalHours.value = hours
  void persistPreferences({ autoSyncIntervalHours: hours })
  notifySuccess(hours ? `已设置自动同步频率：每 ${hours} 小时` : '已关闭自动同步', '设置已保存')
}

const handleChooseDownloadDirectory = async () => {
  try {
    const result = await window.electronAPI.dialogOpenDirectory({ title: '选择下载目录' })
    if (result.canceled || !result.filePaths.length) return
    await window.electronAPI.setDownloadDirectory({ directory: result.filePaths[0] })
    await persistPreferences({ downloadDirectory: result.filePaths[0] })
    notifySuccess('下载目录已更新', '设置成功')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : '设置下载目录失败', '设置失败')
  }
}

const handleResetDownloadDirectory = async () => {
  try {
    await window.electronAPI.setDownloadDirectory({ directory: null })
    await persistPreferences({ downloadDirectory: null })
    notifySuccess('已恢复默认下载目录', '设置成功')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : '恢复默认目录失败', '设置失败')
  }
}

const handleClearPreviewCache = async () => {
  try {
    const result = await window.electronAPI.clearPreviewCache()
    notifySuccess(`已清理 ${result.removed} 项缓存`, '缓存已清理')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : '清理缓存失败', '操作失败')
  }
}

const handleCheckUpdates = async () => {
  const result = await window.electronAPI.updaterCheckNow()
  if (result.status === 'error') {
    notifyError(result.message, '检查更新失败')
    return
  }
  if (result.status === 'available') {
    notifySuccess(result.message, '发现更新')
    return
  }
  notifySuccess(result.message, '检查完成')
}

const handleOpenSubmissionFromCourse = (payload: {
  cmid: number
  courseId: number
  assignName: string
  courseName: string
}) => {
  const syntheticEvent: TimelineEvent = {
    id: 0,
    name: payload.assignName,
    description: '',
    courseid: payload.courseId,
    coursename: payload.courseName,
    timestart: 0,
    timesort: 0,
    modulename: 'assign',
    cmid: payload.cmid,
    actionUrl: '',
  }
  void handleOpenSubmission(syntheticEvent)
}

const handleOpenSubmission = async (event: TimelineEvent) => {
  if (event.modulename !== 'assign' || !event.cmid) {
    // openSubmission will show the appropriate warning; stay on current stage
    void openSubmission(event)
    return
  }
  submissionBackTarget.value = appStage.value === 'courseDetail' ? 'course' : 'dashboard'
  appStage.value = 'submission'
  void openSubmission(event)
}

const handleBackFromSubmission = () => {
  appStage.value = submissionBackTarget.value === 'course' ? 'courseDetail' : 'dashboard'
  clearSubmission()
}

onMounted(async () => {
  removeUpdaterStatusListener = window.electronAPI.onUpdaterStatus((payload) => {
    if (payload.status === 'downloading') {
      notifySuccess(payload.message, '更新下载中')
      return
    }
    if (payload.status === 'downloaded' || payload.status === 'installing') {
      notifySuccess(payload.message, '准备安装更新')
      return
    }
    if (payload.status === 'error') {
      notifyError(payload.message, '更新失败')
    }
  })
  try {
    const platform = await window.electronAPI.appPlatform()
    isMac.value = platform === 'darwin'
  } catch {
    isMac.value = false
  }
  await initWindowState()
  try {
    appVersion.value = await window.electronAPI.appVersion()
  } catch {
    appVersion.value = ''
  }
  try {
    const pref = await window.electronAPI.appPreferencesGet()
    language.value = pref.language
    setThemeMode(pref.themeMode)
    autoSyncIntervalHours.value = pref.autoSyncIntervalHours
    downloadDirectory.value = pref.downloadDirectory || await window.electronAPI.getDownloadDirectory()
  } catch {
    // ignore preference load failures
  }
  const cached = restoreSession()
  if (cached) {
    user.value = cached
    appStage.value = 'dashboard'
  }
  await loadProfiles()
  await hydrateRememberedLogin()
  try {
    await loadDashboard()
  } catch {
    // ignore on first load
  }
  if (appStage.value === 'dashboard') {
    void loadTimeline()
  } else if (autoSsoLogin.value && !loggingIn.value) {
    void handleSsoLogin()
  }
})

onBeforeUnmount(() => {
  removeUpdaterStatusListener?.()
  removeUpdaterStatusListener = null
})
</script>

<template>
<div class="app-root" :class="{ dark: isDark }">

  <AppTitleBar
    :is-maximized="isMaximized"
    :is-dark="isDark"
    :is-mac="isMac"
    :user="user"
    @minimize="winMinimize"
    @maximize="winMaximize"
    @close="winClose"
    @toggle-theme="handleToggleThemeFromTitleBar"
    @logout="handleLogout"
  />

  <!-- Login screen: full width, no sidebar -->
  <LoginView
    v-if="appStage === 'login'"
    @login="handleLogin"
    @sso-login="handleSsoLogin"
  />

  <!-- Main layout: sidebar + content -->
  <div v-else class="app-body">
    <AppSidebar
      :active-stage="sidebarActiveStage"
      @navigate="handleSidebarNavigate"
    />

    <div class="app-content">

      <DashboardView
        v-if="appStage === 'dashboard'"
        @select-course="handleSelectCourse"
        @open-submission="handleOpenSubmission"
        @sync-all="handleSyncAll"
      />

      <CoursesView
        v-else-if="appStage === 'course'"
        @select-course="handleSelectCourse"
      />

      <NotebookView v-else-if="appStage === 'notebook'" />

      <GradeView
        v-else-if="appStage === 'grade'"
        @refresh-grades="handleRefreshGrades"
      />

      <ProfileView v-else-if="appStage === 'profile'" />

      <SettingsView
        v-else-if="appStage === 'settings'"
        :app-version="appVersion"
        :theme-mode="themeMode"
        :auto-sync-interval-hours="autoSyncIntervalHours"
        :download-directory="downloadDirectory"
        :language="language"
        @back="handleBackFromSettings"
        @update-theme-mode="handleThemeModeChange"
        @update-auto-sync-interval="handleAutoSyncIntervalChange"
        @update-language="handleLanguageChange"
        @choose-download-directory="handleChooseDownloadDirectory"
        @reset-download-directory="handleResetDownloadDirectory"
        @clear-preview-cache="handleClearPreviewCache"
        @check-updates="handleCheckUpdates"
      />

      <CourseDetailView
        v-else-if="appStage === 'courseDetail' && selectedCourse"
        :back-target="courseDetailBackTarget"
        :course="selectedCourse"
        :sections="selectedSections"
        :loading="loadingSections"
        :exams="selectedCourseExams"
        @back="handleBackFromCourseDetail"
        @open-submission="handleOpenSubmissionFromCourse"
      />

      <SubmissionView
        v-else-if="appStage === 'submission'"
        :back-target="submissionBackTarget"
        @back="handleBackFromSubmission"
      />

    </div>
  </div>

</div>
</template>

<style>
/* ── Theme CSS Variables ──────────────────────────────────────────────── */
.app-root {
  /* Backgrounds */
  --bg-page:         #f0f2f5;
  --bg-surface:      #ffffff;
  --bg-surface-alt:  #fafbfc;
  --bg-surface-hover:#f6f8fa;
  --bg-header:       #1b2a3b;

  /* Borders */
  --border:          #e8ecf0;
  --border-subtle:   #f0f2f5;
  --border-strong:   #d0d7de;

  /* Text */
  --text-h:  #1b2a3b;
  --text-b:  #374151;
  --text-2:  #4a5568;
  --text-3:  #5a6a7a;
  --text-m:  #7a8a9a;
  --text-f:  #9aabb8;
  --text-i:  #b0bac8;

  /* Accents */
  --accent-o:  #e05c2a;
  --accent-b:  #3a7bd5;
  --accent-bb: #1a73e8;
  --accent-g:  #3fb950;
  --accent-p:  #9b59b6;

  /* Sync button */
  --sync-bg:          #d4f0e2;
  --sync-border:      #b6e4cc;
  --sync-text:        #1a6640;
  --sync-hover-bg:    #bfe9d4;
  --sync-hover-border:#9dd4b8;

  /* Timeline */
  --tl-event-bg:      #fafbfc;
  --tl-event-border:  #f0f2f5;
  --tl-hover-bg:      #f3f6fb;
  --tl-hover-border:  #d0d9e6;
  --tl-date-border:   #f5e8e2;

  /* Stat cards */
  --stat-gpa-bg:      #eef8f1;
  --stat-gpa-border:  #c8e6d4;

  /* Source tags */
  --tag-m-bg:     #e8f3ff;
  --tag-m-text:   #1a73e8;
  --tag-m-border: #aaccff;
  --tag-s-bg:     #e8f5e9;
  --tag-s-text:   #2e7d32;
  --tag-s-border: #a5d6a7;

  /* Chip (meta badges) */
  --chip-bg:     #f0f2f5;
  --chip-border: #e8ecf0;

  /* CourseDetail specific */
  --cd-badge-forum-bg:      #dbeafe;
  --cd-badge-forum-text:    #3a7bd5;
  --cd-badge-assign-bg:     #ede9fe;
  --cd-badge-assign-text:   #7c3aed;
  --cd-badge-url-bg:        #d1fae5;
  --cd-badge-url-text:      #065f46;
  --cd-action-p-bg:         #dbeafe;
  --cd-action-p-border:     #1a73e8;
  --cd-action-p-text:       #1a73e8;
  --cd-action-assign-bg:    #ede9fe;
  --cd-action-assign-border:#7c3aed;
  --cd-action-assign-text:  #7c3aed;
  --cd-type-tag-bg:         #f0f2f5;
  --cd-type-tag-text:       #7a8a9a;

  /* Login */
  --login-card-bg:    #ffffff;
  --login-card-border:#e4e9ef;
  --login-label:      #374151;
  --login-sso-bg:     #ffffff;
  --login-sso-border: #d0d7de;
  --login-sso-text:   #374151;

  /* Footer */
  --footer-text:   #a0b0c0;
  --footer-border: #eaecef;

  /* Shadows */
  --shadow-s: 0 1px 4px rgba(0,0,0,0.04);
  --shadow-m: 0 4px 16px rgba(0,0,0,0.08);
  --shadow-h: 0 2px 10px rgba(0,0,0,0.06);
}

.app-root.dark {
  --bg-page:          #0d1117;
  --bg-surface:       #161b22;
  --bg-surface-alt:   #0d1117;
  --bg-surface-hover: #1c2129;
  --bg-header:        #161b22;

  --border:           #21262d;
  --border-subtle:    #21262d;
  --border-strong:    #30363d;

  --text-h:  #e6edf3;
  --text-b:  #c9d1d9;
  --text-2:  #8b949e;
  --text-3:  #8b949e;
  --text-m:  #8b949e;
  --text-f:  #6e7683;
  --text-i:  #6e7683;

  --accent-o:  #ff7b3d;
  --accent-b:  #58a6ff;
  --accent-bb: #58a6ff;
  --accent-g:  #3fb950;
  --accent-p:  #c084fc;

  --sync-bg:          #1a3a1a;
  --sync-border:      #2d5a2d;
  --sync-text:        #3fb950;
  --sync-hover-bg:    #152e15;
  --sync-hover-border:#1d4a1d;

  --tl-event-bg:      #0d1117;
  --tl-event-border:  #21262d;
  --tl-hover-bg:      #1c2129;
  --tl-hover-border:  #30363d;
  --tl-date-border:   #30363d;

  --stat-gpa-bg:      #0d2218;
  --stat-gpa-border:  #1a4a2a;

  --tag-m-bg:     #1a2d4a;
  --tag-m-text:   #58a6ff;
  --tag-m-border: #1a4a8a;
  --tag-s-bg:     #0d2218;
  --tag-s-text:   #3fb950;
  --tag-s-border: #1a4a2a;

  --chip-bg:     #21262d;
  --chip-border: #30363d;

  --cd-badge-forum-bg:      #1a3a5c;
  --cd-badge-forum-text:    #58a6ff;
  --cd-badge-assign-bg:     #2d1f3d;
  --cd-badge-assign-text:   #c084fc;
  --cd-badge-url-bg:        #1f2d1f;
  --cd-badge-url-text:      #6ee7b7;
  --cd-action-p-bg:         #1a3a5c;
  --cd-action-p-border:     #1a73e8;
  --cd-action-p-text:       #58a6ff;
  --cd-action-assign-bg:    #2d1f3d;
  --cd-action-assign-border:#7c3aed;
  --cd-action-assign-text:  #c084fc;
  --cd-type-tag-bg:         #21262d;
  --cd-type-tag-text:       #8b949e;

  --login-card-bg:    #161b22;
  --login-card-border:#21262d;
  --login-label:      #c9d1d9;
  --login-sso-bg:     #21262d;
  --login-sso-border: #30363d;
  --login-sso-text:   #c9d1d9;

  --footer-text:   #6e7683;
  --footer-border: #21262d;

  --shadow-s: 0 1px 4px rgba(0,0,0,0.3);
  --shadow-m: 0 4px 16px rgba(0,0,0,0.5);
  --shadow-h: 0 2px 10px rgba(0,0,0,0.4);
}

/* Smooth theme transitions */
.app-root,
.app-root * {
  transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
}

/* ── Global toast overrides ───────────────────────────────────────────── */
.campus-toast.el-message {
  position: fixed !important;
  left: 50% !important;
  right: auto !important;
  transform: translateX(-50%) !important;
  top: 16px !important;
  margin: 0 !important;
  width: max-content;
  max-width: min(90vw, 760px);
  z-index: 9999 !important;
  display: block !important;
  padding-right: 34px !important;
}
.campus-toast .el-message__icon { display: none !important; }
.campus-toast .el-message__content { padding-right: 0; }
.campus-toast .el-message__closeBtn {
  position: absolute !important;
  top: 10px !important;
  right: 10px !important;
  left: auto !important;
  margin: 0 !important;
  background: transparent !important;
  color: #909399 !important;
  font-size: 16px !important;
  line-height: 1 !important;
}
.campus-toast .el-message__closeBtn:hover {
  background: transparent !important;
  color: #606266 !important;
}
.campus-toast.el-message--success {
  background-color: #f0f9eb !important;
  border-color: #e1f3d8 !important;
  color: #67c23a !important;
}
.campus-toast.el-message--warning {
  background-color: #fdf6ec !important;
  border-color: #faecd8 !important;
  color: #e6a23c !important;
}
.campus-toast.el-message--error {
  background-color: #fef0f0 !important;
  border-color: #fde2e2 !important;
  color: #f56c6c !important;
}
</style>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.app-body {
  flex: 1;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

.app-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
