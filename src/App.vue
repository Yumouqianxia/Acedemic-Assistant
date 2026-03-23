<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Refresh,
  Calendar,
  Medal,
  QuestionFilled,
  UserFilled,
  Reading,
  DocumentCopy,
  Message,
  Lock,
  ArrowRight,
} from '@element-plus/icons-vue'

type MoodleProfile = {
  username: string
  fullName: string
  siteName: string
  lastSyncAt: string
  hasRememberedPassword: boolean
}
type MoodleUser = { username: string; fullName: string; siteName: string; userId: number }
type UsernameSuggestion = { value: string; profile: MoodleProfile }
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

const appStage = ref<'login' | 'dashboard'>('login')
const loginForm = reactive({ username: '', password: '' })
const rememberPassword = ref(false)
const profiles = ref<MoodleProfile[]>([])
const user = ref<MoodleUser | null>(null)
const SESSION_LOGIN_USER_KEY = 'campus-dashboard:login-user'

const loggingIn = ref(false)
const moodleSyncing = ref(false)
const studentsSyncing = ref(false)

const dashboard = ref<{
  courses: UnifiedCourse[]
  exams: StudentsExam[]
  lastMoodleSyncAt: { at: string; username: string; termLabel: string; count: number } | null
  lastStudentsSyncAt: { at: string; semester: string; semesterTechnion: string; courseCount: number; examCount: number } | null
  lastAutoSync: { at: string; studentsError?: string | null; error?: string } | null
  studentsProfile: {
    studentId: string
    programName: string
    chineseName: string
    pinyinName: string
    cohort: string
    gpa: string
    accumulatedCreditPoints: string
  } | null
}>({
  courses: [],
  exams: [],
  lastMoodleSyncAt: null,
  lastStudentsSyncAt: null,
  lastAutoSync: null,
  studentsProfile: null,
})

const showCourseDetail = ref(false)
const selectedCourse = ref<UnifiedCourse | null>(null)
const selectedSections = ref<MoodleSection[]>([])
const loadingSections = ref(false)

// ── Computed ─────────────────────────────────────────────────────────────────

const userInitial = computed(() => {
  const name = user.value?.fullName ?? ''
  return name.charAt(0).toUpperCase() || '?'
})

const gpaDisplay = computed(() => {
  const raw = dashboard.value.studentsProfile?.gpa
  if (!raw) return null
  const n = parseFloat(raw)
  return isNaN(n) ? raw : n.toFixed(1)
})

const completedCreditsNum = computed(() => {
  const raw = dashboard.value.studentsProfile?.accumulatedCreditPoints
  if (!raw) return null
  const n = parseFloat(raw)
  return isNaN(n) ? null : n
})

const currentSemesterInfo = computed(() => {
  const syncInfo = dashboard.value.lastStudentsSyncAt
  if (!syncInfo) return null
  const courses = dashboard.value.courses.filter(
    (c) => c.semesterTechnion === syncInfo.semesterTechnion,
  )
  const credits = courses.reduce((sum, c) => sum + (c.credits ?? 0), 0)
  return { label: syncInfo.semester, credits }
})

const selectedCourseExams = computed(() => {
  const code = selectedCourse.value?.courseCode
  if (!code) return []
  return dashboard.value.exams.filter((exam) => exam.courseCode === code)
})

// ── Utility ──────────────────────────────────────────────────────────────────

const formatTime = (iso: string | null | undefined) => {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

const formatBytes = (bytes: number) => {
  if (!bytes) return '-'
  const mb = bytes / 1024 / 1024
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
}

const formatCourseDelta = (delta?: { inserted: number; updated: number } | null) => {
  if (!delta) return '新增 0，更新 0'
  return `新增 ${delta.inserted}，更新 ${delta.updated}`
}

const notifySuccess = (message: string, title = '成功') => {
  ElMessage({
    message: `${title}：${message}`,
    type: 'success',
    duration: 2600,
    showClose: true,
    grouping: true,
    plain: false,
    offset: 18,
    customClass: 'campus-toast',
  })
}

const notifyWarning = (message: string, title = '提醒') => {
  ElMessage({
    message: `${title}：${message}`,
    type: 'warning',
    duration: 3200,
    showClose: true,
    grouping: true,
    plain: false,
    offset: 18,
    customClass: 'campus-toast',
  })
}

const notifyError = (message: string, title = '错误') => {
  ElMessage({
    message: `${title}：${message}`,
    type: 'error',
    duration: 4200,
    showClose: true,
    grouping: true,
    plain: false,
    offset: 18,
    customClass: 'campus-toast',
  })
}

// ── Data loaders ─────────────────────────────────────────────────────────────

const loadProfiles = async () => {
  profiles.value = await window.electronAPI.moodleProfilesList()
}

const loadDashboard = async () => {
  dashboard.value = await window.electronAPI.dashboardGet()
}

// ── Auth / Login ──────────────────────────────────────────────────────────────

const querySearchProfiles = (queryString: string, cb: (items: UsernameSuggestion[]) => void) => {
  const keyword = queryString.trim().toLowerCase()
  const list = profiles.value
    .filter((item) => {
      if (!keyword) return true
      return `${item.fullName} ${item.username}`.toLowerCase().includes(keyword)
    })
    .slice(0, 10)
    .map((item) => ({
      value: `${item.fullName} (${item.username})`,
      profile: item,
    }))
  cb(list)
}

const fillRememberedPassword = async (username: string) => {
  const credential = await window.electronAPI.moodleCredentialGet({ username })
  if (!credential.password) return false
  if (loginForm.username.trim().toLowerCase() !== username.trim().toLowerCase()) return false
  loginForm.password = credential.password
  rememberPassword.value = true
  return true
}

const handlePickProfile = async (item: Record<string, unknown>) => {
  const profile = (item as UsernameSuggestion).profile
  if (!profile) return
  loginForm.username = profile.username
  if (profile.hasRememberedPassword) {
    await fillRememberedPassword(profile.username)
  }
}

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
    sessionStorage.setItem(SESSION_LOGIN_USER_KEY, JSON.stringify(result))
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
    sessionStorage.setItem(SESSION_LOGIN_USER_KEY, JSON.stringify(result))
    appStage.value = 'dashboard'
    notifySuccess('SSO 登录成功，正在后台同步数据', '登录成功')
    await loadProfiles()
    await loadDashboard()
    // Students session is already established via shared Office 365 partition
    void syncAfterLogin(result.username)
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'SSO 登录失败', 'SSO 登录失败')
  } finally {
    loggingIn.value = false
  }
}

const handleSsoNotAvailable = () => {
  notifyWarning('该功能暂未开放，请使用账号密码登录', '提示')
}

const handleLogout = async () => {
  await window.electronAPI.moodleLogout({ username: user.value?.username })
  sessionStorage.removeItem(SESSION_LOGIN_USER_KEY)
  user.value = null
  selectedCourse.value = null
  selectedSections.value = []
  showCourseDetail.value = false
  dashboard.value = {
    courses: [],
    exams: [],
    lastMoodleSyncAt: null,
    lastStudentsSyncAt: null,
    lastAutoSync: null,
    studentsProfile: null,
  }
  appStage.value = 'login'
  notifySuccess('已退出当前账号', '退出成功')
}

// ── Sync ──────────────────────────────────────────────────────────────────────

const syncAll = async () => {
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
  } catch (error) {
    notifyError(error instanceof Error ? error.message : '同步全部失败', '同步失败')
  } finally {
    moodleSyncing.value = false
    studentsSyncing.value = false
  }
}

// ── Course detail ─────────────────────────────────────────────────────────────

const handleSelectCourse = async (course: UnifiedCourse) => {
  selectedCourse.value = course
  selectedSections.value = []
  showCourseDetail.value = true
  if (!course.moodleCourseId || !user.value) return
  loadingSections.value = true
  try {
    selectedSections.value = await window.electronAPI.moodleCourseContents({
      courseId: course.moodleCourseId,
      username: user.value.username,
    })
  } finally {
    loadingSections.value = false
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

// ── Window controls ───────────────────────────────────────────────────────────

const isMaximized = ref(false)

const winMinimize = () => window.electronAPI.windowMinimize()
const winMaximize = async () => {
  await window.electronAPI.windowMaximize()
  isMaximized.value = !isMaximized.value
}
const winClose = () => window.electronAPI.windowClose()

onMounted(async () => {
  isMaximized.value = await window.electronAPI.windowIsMaximized()

  const cachedUser = sessionStorage.getItem(SESSION_LOGIN_USER_KEY)
  if (cachedUser) {
    try {
      const parsed = JSON.parse(cachedUser) as MoodleUser
      if (parsed?.username) {
        user.value = parsed
        appStage.value = 'dashboard'
      }
    } catch {
      sessionStorage.removeItem(SESSION_LOGIN_USER_KEY)
    }
  }
  await loadProfiles()
  try {
    await loadDashboard()
  } catch {
    // ignore on first load
  }
})

watch(
  () => loginForm.username,
  async (value) => {
    const keyword = value.trim().toLowerCase()
    if (!keyword) {
      rememberPassword.value = false
      return
    }
    const matched = profiles.value.find((item) => item.username.toLowerCase() === keyword)
    if (!matched?.hasRememberedPassword) return
    await fillRememberedPassword(matched.username)
  },
)
</script>

<template>
<div class="app-root">

  <!-- ══════════════ CUSTOM TITLE BAR ══════════════ -->
  <div class="title-bar">
    <!-- Left: logo + app name -->
    <div class="tb-left">
      <div class="tb-logo">
        <span class="tb-logo-g">G</span>
        <span class="tb-logo-t">T-IIT</span>
      </div>
      <span class="tb-app-name">GTIIT Campus Dashboard</span>
    </div>

    <!-- Center: nav placeholder (language switcher etc.) -->
    <div class="tb-center">
      <!-- reserved for future nav items -->
    </div>

    <!-- Right: window controls -->
    <div class="tb-controls">
      <button class="tb-btn tb-btn--minimize" title="最小化" @click="winMinimize">
        <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
      </button>
      <button class="tb-btn tb-btn--maximize" :title="isMaximized ? '还原' : '最大化'" @click="winMaximize">
        <svg v-if="isMaximized" width="10" height="10" viewBox="0 0 10 10">
          <rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/>
          <rect x="0" y="2" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/>
        </svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10">
          <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/>
        </svg>
      </button>
      <button class="tb-btn tb-btn--close" title="关闭" @click="winClose">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/>
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- ══════════════ LOGIN PAGE ══════════════ -->
  <div v-if="appStage === 'login'" class="login-page">
    <!-- Background: dark building grid -->
    <div class="login-bg" aria-hidden="true">
      <div class="login-bg-grid" />
    </div>
    <!-- Bottom-right diamond decoration -->
    <span class="login-corner-diamond" aria-hidden="true">◇</span>

    <!-- Card -->
    <div class="login-card">
      <!-- Header: logo + title -->
      <div class="login-header">
        <div class="login-logo">
          <span class="login-logo-letter">G</span>
          <span class="login-logo-label">T-IIT</span>
        </div>
        <div class="login-header-text">
          <div class="login-title">GTIIT Campus Dashboard</div>
          <div class="login-subtitle">Login to unified access: Moodle + Students Data</div>
        </div>
      </div>

      <!-- Form -->
      <div class="login-form">
        <!-- Email -->
        <div class="login-field">
          <label class="login-label">Email Address</label>
          <el-autocomplete
            v-model="loginForm.username"
            autocomplete="username"
            clearable
            placeholder="Enter Account (Email)"
            style="width: 100%"
            :prefix-icon="Message"
            :fetch-suggestions="querySearchProfiles"
            @select="handlePickProfile"
          />
        </div>

        <!-- Password -->
        <div class="login-field">
          <label class="login-label">Password</label>
          <el-input
            v-model="loginForm.password"
            autocomplete="current-password"
            show-password
            type="password"
            placeholder="Enter Password"
            :prefix-icon="Lock"
            @keyup.enter="handleLogin"
          />
        </div>

        <!-- Options row -->
        <div class="login-options-row">
          <el-checkbox v-model="rememberPassword" class="login-checkbox">
            Keep Me Logged In
          </el-checkbox>
          <span class="login-forgot">Forgot Password?</span>
        </div>

        <!-- Submit -->
        <el-button
          class="login-submit-btn"
          :loading="loggingIn"
          @click="handleLogin"
        >
          <el-icon v-if="!loggingIn"><ArrowRight /></el-icon>
          Sign In & Access Dashboard
        </el-button>

        <!-- Chinese hint -->
        <div class="login-hint-text">登录后进入统一课程面板（Moodle + Students 合并）</div>

        <!-- SSO divider -->
        <div class="login-sso-divider">
          <span>Or sign in with:</span>
        </div>

        <!-- SSO buttons -->
        <div class="login-sso-row">
          <button class="login-sso-btn" type="button" :disabled="loggingIn" @click="handleSsoLogin">
            <span class="ms-icon" aria-hidden="true">
              <span class="ms-sq ms-sq-r" />
              <span class="ms-sq ms-sq-g" />
              <span class="ms-sq ms-sq-b" />
              <span class="ms-sq ms-sq-y" />
            </span>
            GT-IIT SSO (Microsoft)
          </button>
          <button class="login-sso-btn" type="button" @click="handleSsoNotAvailable">
            Alternative School Login
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- ══════════════ DASHBOARD PAGE ══════════════ -->
  <div v-else class="app-layout">

    <!-- ── Full-width header ── -->
    <div class="app-header">
      <div class="header-left">
        <div class="header-avatar">{{ userInitial }}</div>
        <div class="header-user-info">
          <div class="header-user-name">{{ user?.fullName }}</div>
          <div class="header-user-email">{{ user?.username }}</div>
        </div>
      </div>
      <el-button class="btn-logout" @click="handleLogout">Logout</el-button>
    </div>

    <!-- ── Core metric cards ── -->
    <div class="stat-section">
      <!-- GPA -->
      <div class="stat-card stat-card--gpa">
        <div class="stat-label">GPA</div>
        <div class="stat-value-row">
          <span class="stat-big">{{ gpaDisplay ?? '-' }}</span>
        </div>
      </div>

      <!-- Completed Credits -->
      <div class="stat-card">
        <div class="stat-label">Completed Credits</div>
        <div class="stat-value-row">
          <span class="stat-big">{{ completedCreditsNum ?? '-' }}</span>
        </div>
        <div class="stat-sub">Accumulated credit points</div>
      </div>

      <!-- Current Semester Credits -->
      <div class="stat-card">
        <div class="stat-label">Current Semester Credits</div>
        <div class="stat-value-row">
          <span class="stat-big">{{ currentSemesterInfo?.credits ?? '-' }}</span>
        </div>
        <div class="stat-sub">{{ currentSemesterInfo?.label ?? '-' }}</div>
      </div>
    </div>

    <!-- Sync bar -->
    <div class="sync-bar">
      <div class="sync-status">
        <span class="sync-item">
          <el-icon class="sync-icon-moodle"><Reading /></el-icon>
          <b>Moodle</b>&nbsp;Last Sync:&nbsp;{{ formatTime(dashboard.lastMoodleSyncAt?.at) }}
        </span>
        <span class="sync-sep">|</span>
        <span class="sync-item">
          <el-icon class="sync-icon-students"><UserFilled /></el-icon>
          <b>Students</b>&nbsp;Last Sync:&nbsp;{{ formatTime(dashboard.lastStudentsSyncAt?.at) }}
        </span>
      </div>
      <div class="sync-actions">
        <el-button
          class="btn-sync-all"
          :loading="moodleSyncing || studentsSyncing"
          @click="syncAll"
        >
          <el-icon><Refresh /></el-icon>
          SYNC ALL
        </el-button>
      </div>
    </div>

    <!-- Course grid -->
    <div class="course-grid" v-if="dashboard.courses.length">
      <div
        v-for="course in dashboard.courses"
        :key="course.courseKey"
        class="course-card"
      >
        <div class="course-card-header">
          <span class="course-code">{{ course.courseCode }}</span>
          <el-tooltip :content="course.courseName" placement="top" :show-after="400">
            <el-icon class="course-help-icon"><QuestionFilled /></el-icon>
          </el-tooltip>
        </div>
        <div class="course-name">{{ course.courseName }}</div>
        <div class="course-meta">
          <span class="course-meta-item">
            <el-icon><Calendar /></el-icon>
            {{ course.semesterLabel || '-' }}
          </span>
          <span class="course-meta-item">
            <el-icon><Medal /></el-icon>
            {{ course.credits ?? '-' }} Credits
          </span>
        </div>
        <div class="course-sources">
          <span class="sources-label">source</span>
          <span v-if="course.hasMoodle" class="source-tag source-tag--moodle">
            <span class="source-m-icon">m</span>Moodle
          </span>
          <span v-if="course.hasStudents" class="source-tag source-tag--students">
            <el-icon><UserFilled /></el-icon>Students
          </span>
        </div>
        <el-button class="btn-view-details" @click="handleSelectCourse(course)">
          View Details
        </el-button>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="empty-wrap">
      <el-empty description="暂无课程数据，点击 SYNC ALL 开始同步" />
    </div>

    <!-- Footer -->
    <div class="app-footer">© 2026 GTIIT Campus Dashboard</div>

    <!-- Course detail dialog -->
    <el-dialog
      v-model="showCourseDetail"
      :title="`${selectedCourse?.courseCode ?? ''} ${selectedCourse?.courseName ?? ''}`"
      width="680px"
      destroy-on-close
      class="course-dialog"
    >
      <div v-if="selectedCourse" class="dialog-content">
        <!-- Course meta -->
        <div class="dialog-meta-row">
          <span class="dialog-meta-item">
            <el-icon><Calendar /></el-icon>
            {{ selectedCourse.semesterLabel || '-' }}
          </span>
          <span class="dialog-meta-item">
            <el-icon><Medal /></el-icon>
            {{ selectedCourse.credits ?? '-' }} Credits
          </span>
          <span v-if="selectedCourse.hasMoodle" class="source-tag source-tag--moodle">
            <span class="source-m-icon">m</span>Moodle
          </span>
          <span v-if="selectedCourse.hasStudents" class="source-tag source-tag--students">
            <el-icon><UserFilled /></el-icon>Students
          </span>
        </div>

        <!-- Exams -->
        <div v-if="selectedCourseExams.length" class="dialog-section">
          <div class="dialog-section-title">
            <el-icon><DocumentCopy /></el-icon> 考试安排
          </div>
          <el-table :data="selectedCourseExams" size="small" class="dialog-table">
            <el-table-column prop="examSession" label="场次" width="70" />
            <el-table-column prop="date" label="日期" width="110" />
            <el-table-column prop="time" label="时间" width="80" />
            <el-table-column prop="duration" label="时长" width="100" />
            <el-table-column prop="venue" label="地点" />
          </el-table>
        </div>

        <!-- Moodle sections -->
        <div class="dialog-section">
          <div class="dialog-section-title">
            <el-icon><Reading /></el-icon> Moodle 课件
          </div>
          <div v-if="loadingSections" class="dialog-loading">
            <el-icon class="is-loading"><Refresh /></el-icon> 加载中...
          </div>
          <div v-else-if="!selectedCourse.hasMoodle" class="dialog-empty">该课程无 Moodle 记录</div>
          <div v-else-if="!selectedSections.length" class="dialog-empty">暂无课件数据</div>
          <el-collapse v-else>
            <el-collapse-item
              v-for="section in selectedSections"
              :key="section.id"
              :title="`${section.name || '未命名章节'}（${section.moduleCount} 项）`"
              :name="section.id"
            >
              <el-table :data="section.modules" size="small" border>
                <el-table-column prop="modname" label="类型" width="110" />
                <el-table-column prop="name" label="资源名称" />
                <el-table-column label="文件">
                  <template #default="{ row }">
                    <div v-if="row.resources.length">
                      <a
                        v-for="item in row.resources"
                        :key="`${item.fileurl}-${item.filename}`"
                        :href="item.fileurl"
                        target="_blank"
                        rel="noreferrer"
                        class="file-link"
                      >
                        {{ item.filename || item.mimetype || '未命名' }}
                        <span class="file-size">({{ formatBytes(item.filesize) }})</span>
                      </a>
                    </div>
                    <span v-else class="muted">{{ row.url || '-' }}</span>
                  </template>
                </el-table-column>
              </el-table>
            </el-collapse-item>
          </el-collapse>
        </div>
      </div>
    </el-dialog>

  </div>

</div>
</template>

<style scoped>
/* ── Global toast overrides ───────────────────────────────────────────── */
:global(.campus-toast.el-message) {
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
:global(.campus-toast .el-message__icon) { display: none !important; }
:global(.campus-toast .el-message__content) { padding-right: 0; }
:global(.campus-toast .el-message__closeBtn) {
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
:global(.campus-toast .el-message__closeBtn:hover) {
  background: transparent !important;
  color: #606266 !important;
}
:global(.campus-toast.el-message--success) {
  background-color: #f0f9eb !important;
  border-color: #e1f3d8 !important;
  color: #67c23a !important;
}
:global(.campus-toast.el-message--warning) {
  background-color: #fdf6ec !important;
  border-color: #faecd8 !important;
  color: #e6a23c !important;
}
:global(.campus-toast.el-message--error) {
  background-color: #fef0f0 !important;
  border-color: #fde2e2 !important;
  color: #f56c6c !important;
}

/* ── App root ─────────────────────────────────────────────────────────── */
.app-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* ── Custom title bar ─────────────────────────────────────────────────── */
.title-bar {
  height: 40px;
  min-height: 40px;
  background: #151f2e;
  display: flex;
  align-items: center;
  -webkit-app-region: drag;
  user-select: none;
  flex-shrink: 0;
  z-index: 1000;
}

.tb-left {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  flex-shrink: 0;
}

.tb-logo {
  width: 30px;
  height: 30px;
  background: #2a3f55;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tb-logo-g {
  font-size: 14px;
  font-weight: 900;
  color: #fff;
  line-height: 1;
}

.tb-logo-t {
  font-size: 5.5px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.3px;
  line-height: 1.2;
}

.tb-app-name {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  letter-spacing: 0.1px;
}

.tb-center {
  flex: 1;
  /* reserved for future nav items */
}

.tb-controls {
  display: flex;
  align-items: center;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
}

.tb-btn {
  width: 46px;
  height: 40px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 0.12s, color 0.12s;
  font-family: inherit;
}

.tb-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.tb-btn--close:hover {
  background: #e81123;
  color: #fff;
}

/* ── Login page ───────────────────────────────────────────────────────── */
.login-page {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  background-color: #0c1f28;
}

/* Background layers */
.login-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(155deg, #14303d 0%, #0e2530 45%, #091c22 100%);
}

.login-bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(100, 210, 195, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(100, 210, 195, 0.045) 1px, transparent 1px);
  background-size: 72px 56px;
}

/* Corner diamond */
.login-corner-diamond {
  position: absolute;
  bottom: 24px;
  right: 36px;
  font-size: 44px;
  color: rgba(255, 255, 255, 0.13);
  pointer-events: none;
  z-index: 1;
  line-height: 1;
  font-weight: 100;
}

/* Card */
.login-card {
  position: relative;
  z-index: 2;
  width: 490px;
  background: #fff;
  border-radius: 16px;
  padding: 36px 40px 32px;
  box-shadow: 0 20px 70px rgba(0, 0, 0, 0.4);
}

/* Header */
.login-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 30px;
}

.login-logo {
  width: 54px;
  height: 54px;
  background: #1a2535;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.login-logo-letter {
  font-size: 24px;
  font-weight: 900;
  color: #fff;
  line-height: 1.1;
}

.login-logo-label {
  font-size: 8px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.6);
  letter-spacing: 0.5px;
  line-height: 1.2;
}

.login-title {
  font-size: 19px;
  font-weight: 700;
  color: #1b2a3b;
  line-height: 1.25;
}

.login-subtitle {
  font-size: 12px;
  color: #6e7f8d;
  margin-top: 3px;
  line-height: 1.4;
}

/* Form */
.login-form {
  display: flex;
  flex-direction: column;
}

.login-field {
  margin-bottom: 16px;
}

.login-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 7px;
}

/* Input focus: mint-green ring */
.login-field :deep(.el-input__wrapper:hover),
.login-field :deep(.el-autocomplete .el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px #4abfb0 inset;
}
.login-field :deep(.el-input__wrapper.is-focus),
.login-field :deep(.el-autocomplete .el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #3ab0a1 inset;
}

/* Options row */
.login-options-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.login-checkbox :deep(.el-checkbox__label) {
  font-size: 13px;
  color: #374151;
}

.login-forgot {
  font-size: 13px;
  color: #6e7f8d;
  cursor: pointer;
  user-select: none;
}

.login-forgot:hover {
  color: #3a7bd5;
}

/* Submit button */
.login-submit-btn {
  width: 100% !important;
  height: 44px !important;
  font-size: 15px !important;
  font-weight: 600 !important;
  background: #1a2535 !important;
  border-color: #1a2535 !important;
  color: #fff !important;
  border-radius: 10px !important;
  letter-spacing: 0.2px;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 8px !important;
}

.login-submit-btn:hover {
  background: #243040 !important;
  border-color: #243040 !important;
}

/* Hint text */
.login-hint-text {
  text-align: center;
  font-size: 12px;
  color: #9aabb8;
  margin-top: 12px;
}

/* SSO divider */
.login-sso-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 20px 0 14px;
  font-size: 12.5px;
  color: #9aabb8;
}

.login-sso-divider::before,
.login-sso-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e8ecf0;
}

/* SSO buttons */
.login-sso-row {
  display: flex;
  gap: 10px;
}

.login-sso-btn {
  flex: 1;
  height: 38px;
  border: 1px solid #d0d7de;
  background: #fff;
  border-radius: 8px;
  font-size: 13px;
  color: #374151;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-family: inherit;
  transition: border-color 0.15s, background 0.15s;
}

.login-sso-btn:hover {
  background: #f6f8fa;
  border-color: #b0b8c4;
}

/* Microsoft 4-color squares */
.ms-icon {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.ms-sq {
  display: block;
  border-radius: 1px;
}

.ms-sq-r { background: #f25022; }
.ms-sq-g { background: #7fba00; }
.ms-sq-b { background: #00a4ef; }
.ms-sq-y { background: #ffb900; }

/* ── Dashboard layout ─────────────────────────────────────────────────── */
.app-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #f0f2f5;
  overflow-y: auto;
}

/* ── Full-width header ────────────────────────────────────────────────── */
.app-header {
  background: #1b2a3b;
  padding: 0 28px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.header-avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.header-user-name {
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  line-height: 1.3;
}

.header-user-email {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 1px;
}

.btn-logout {
  border-radius: 7px;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.1) !important;
  border-color: rgba(255, 255, 255, 0.25) !important;
  color: #fff !important;
}

.btn-logout:hover {
  background: rgba(255, 255, 255, 0.18) !important;
  border-color: rgba(255, 255, 255, 0.4) !important;
}

/* ── Core metric cards ────────────────────────────────────────────────── */
.stat-section {
  display: flex;
  gap: 16px;
  padding: 22px 28px 6px;
}

.stat-card {
  flex: 1;
  background: #fff;
  border-radius: 14px;
  border: 1px solid #e8ecf0;
  padding: 22px 26px 20px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.stat-card--gpa {
  background: #eef8f1;
  border-color: #c8e6d4;
}

.stat-label {
  font-size: 11px;
  color: #7a8a9a;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.stat-value-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}

.stat-big {
  font-size: 36px;
  font-weight: 700;
  color: #1b2a3b;
  line-height: 1;
}

.stat-max {
  font-size: 15px;
  color: #8a9ab0;
}

.stat-trend {
  font-size: 18px;
  color: #3db86e;
  font-weight: 700;
}

.stat-sub {
  font-size: 12px;
  color: #8a9ab0;
  margin-top: 1px;
}


/* ── Sync bar ─────────────────────────────────────────────────────────── */
.sync-bar {
  margin: 16px 28px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e8ecf0;
  padding: 14px 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.sync-status {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 13px;
  color: #4a5568;
}

.sync-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sync-icon-moodle {
  font-size: 16px;
  color: #e05c2a;
}

.sync-icon-students {
  font-size: 16px;
  color: #4a6fa5;
}

.sync-sep {
  color: #d8dde4;
  font-size: 18px;
  line-height: 1;
}

.sync-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

.btn-sync-all {
  background: #d4f0e2 !important;
  border-color: #b6e4cc !important;
  color: #1a6640 !important;
  font-weight: 600;
  font-size: 13px;
  padding: 8px 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 5px;
}

.btn-sync-all:hover {
  background: #bfe9d4 !important;
  border-color: #9dd4b8 !important;
}

/* ── Course grid ──────────────────────────────────────────────────────── */
.course-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  padding: 0 28px 24px;
  flex: 1;
  align-items: stretch;
}

.course-card {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e8ecf0;
  padding: 18px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: box-shadow 0.2s;
  /* Ensure equal height cards so View Details aligns */
  height: 100%;
}

.course-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.course-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.course-code {
  font-size: 12px;
  color: #7a8a9a;
  font-weight: 500;
  letter-spacing: 0.3px;
}

.course-help-icon {
  font-size: 15px;
  color: #b0bac8;
  cursor: default;
  flex-shrink: 0;
}

.course-name {
  font-size: 15px;
  font-weight: 700;
  color: #1b2a3b;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.course-meta {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12.5px;
  color: #5a6a7a;
}

.course-meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.course-sources {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.sources-label {
  font-size: 11.5px;
  color: #9aabb8;
}

.source-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11.5px;
  font-weight: 500;
}

.source-tag--moodle {
  background: #2e3848;
  color: #fff;
}

.source-tag--students {
  background: #2e3848;
  color: #fff;
}

.source-m-icon {
  font-size: 10px;
  font-weight: 900;
  line-height: 1;
}

.btn-view-details {
  width: 100%;
  border-radius: 8px;
  font-size: 13px;
  color: #374151;
  border-color: #d0d7de;
  background: #fff;
  margin-top: auto;
  flex-shrink: 0;
}

.btn-view-details:hover {
  background: #f6f8fa;
  border-color: #b0b8c4;
}

/* ── Empty / Footer ───────────────────────────────────────────────────── */
.empty-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 40px;
}

.app-footer {
  text-align: right;
  padding: 16px 28px;
  font-size: 12px;
  color: #a0b0c0;
  border-top: 1px solid #eaecef;
  margin-top: 8px;
}

/* ── Course dialog ────────────────────────────────────────────────────── */
.dialog-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.dialog-meta-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 13px;
  color: #5a6a7a;
  padding-bottom: 14px;
  border-bottom: 1px solid #f0f2f5;
}

.dialog-meta-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.dialog-section-title {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.dialog-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #7a8a9a;
  padding: 12px 0;
}

.dialog-empty {
  font-size: 13px;
  color: #9aabb8;
  padding: 10px 0;
}

.dialog-table {
  width: 100%;
}

.file-link {
  display: block;
  font-size: 12.5px;
  color: #3a7bd5;
  text-decoration: none;
  line-height: 1.8;
}

.file-link:hover {
  text-decoration: underline;
}

.file-size {
  color: #9aabb8;
  font-size: 11px;
}

.muted {
  color: #9aabb8;
  font-size: 12.5px;
}
</style>
