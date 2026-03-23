<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

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
const studentsAuthing = ref(false)
const studentsSyncing = ref(false)

const dashboard = ref<{
  courses: UnifiedCourse[]
  exams: StudentsExam[]
  lastMoodleSyncAt: { at: string; username: string; termLabel: string; count: number } | null
  lastStudentsSyncAt: { at: string; semester: string; semesterTechnion: string; courseCount: number; examCount: number } | null
  lastAutoSync: { at: string; studentsError?: string | null; error?: string } | null
}>({
  courses: [],
  exams: [],
  lastMoodleSyncAt: null,
  lastStudentsSyncAt: null,
  lastAutoSync: null,
})

const selectedCourse = ref<UnifiedCourse | null>(null)
const selectedSections = ref<MoodleSection[]>([])
const loadingSections = ref(false)

const selectedCourseExams = computed(() => {
  const code = selectedCourse.value?.courseCode
  if (!code) return []
  return dashboard.value.exams.filter((exam) => exam.courseCode === code)
})

const loadProfiles = async () => {
  profiles.value = await window.electronAPI.moodleProfilesList()
}

const loadDashboard = async () => {
  dashboard.value = await window.electronAPI.dashboardGet()
}

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

const autoSyncStatusText = computed(() => {
  const info = dashboard.value.lastAutoSync
  if (!info) return '尚未执行'
  if (info.error) return `失败：${info.error}`
  if (info.studentsError) return `部分成功（Students 失败：${info.studentsError}）`
  return '成功'
})

const nextAutoSyncText = computed(() => {
  const candidates = [
    dashboard.value.lastAutoSync?.at,
    dashboard.value.lastMoodleSyncAt?.at,
  ].filter(Boolean) as string[]
  if (!candidates.length) return '-'
  const latest = Math.max(...candidates.map((value) => new Date(value).getTime()))
  if (!Number.isFinite(latest) || latest <= 0) return '-'
  return new Date(latest + 24 * 60 * 60 * 1000).toLocaleString()
})

const hasAutoSyncRecord = computed(() => Boolean(dashboard.value.lastAutoSync?.at))

const querySearchProfiles = (queryString: string, cb: (items: UsernameSuggestion[]) => void) => {
  const keyword = queryString.trim().toLowerCase()
  const list = profiles.value
    .filter((item) => {
      if (!keyword) return true
      const name = `${item.fullName} ${item.username}`.toLowerCase()
      return name.includes(keyword)
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
    const syncResult = await window.electronAPI.dashboardSyncAll({ username: result.username, trigger: 'login' })
    await loadProfiles()
    await loadDashboard()
    appStage.value = 'dashboard'
    const moodleText = `Moodle(${formatCourseDelta(syncResult.moodle.delta)})`
    const studentsText = syncResult.students
      ? `Students(课程${formatCourseDelta(syncResult.students.delta.courses)}；考试 新增 ${syncResult.students.delta.exams.inserted}，更新 ${syncResult.students.delta.exams.updated}，删除 ${syncResult.students.delta.exams.deleted})`
      : `Students(跳过：${syncResult.studentsError || '未认证'})`
    notifySuccess(`登录成功并完成同步：${moodleText}，${studentsText}`, '登录成功')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : '登录失败', '登录失败')
  } finally {
    loggingIn.value = false
  }
}

const syncMoodle = async () => {
  if (!user.value) return
  moodleSyncing.value = true
  try {
    const result = await window.electronAPI.moodleSync({ username: user.value.username })
    await loadDashboard()
    notifySuccess(`Moodle 同步完成：${formatCourseDelta(result.delta)}`, '同步完成')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Moodle 同步失败', '同步失败')
  } finally {
    moodleSyncing.value = false
  }
}

const authStudents = async () => {
  studentsAuthing.value = true
  try {
    const res = await window.electronAPI.studentsAuthenticate()
    if (res.authenticated) {
      notifySuccess('Students 认证成功', '认证成功')
    } else {
      notifyWarning(`Students 认证未完成：${res.reason || 'unknown'}`, '认证未完成')
    }
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Students 认证失败', '认证失败')
  } finally {
    studentsAuthing.value = false
  }
}

const syncStudents = async () => {
  studentsSyncing.value = true
  try {
    const result = await window.electronAPI.studentsSync()
    await loadDashboard()
    notifySuccess(
      `Students 同步完成：课程 ${formatCourseDelta(result.delta.courses)}；考试 新增 ${result.delta.exams.inserted}，更新 ${result.delta.exams.updated}，删除 ${result.delta.exams.deleted}`,
      '同步完成',
    )
  } catch (error) {
    notifyError(error instanceof Error ? error.message : 'Students 同步失败', '同步失败')
  } finally {
    studentsSyncing.value = false
  }
}

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

const handleSelectCourse = async (row: UnifiedCourse) => {
  selectedCourse.value = row
  selectedSections.value = []
  if (!row.moodleCourseId || !user.value) return
  loadingSections.value = true
  try {
    selectedSections.value = await window.electronAPI.moodleCourseContents({
      courseId: row.moodleCourseId,
      username: user.value.username,
    })
  } finally {
    loadingSections.value = false
  }
}

const handleLogout = async () => {
  await window.electronAPI.moodleLogout({ username: user.value?.username })
  sessionStorage.removeItem(SESSION_LOGIN_USER_KEY)
  user.value = null
  selectedCourse.value = null
  selectedSections.value = []
  dashboard.value = { courses: [], exams: [], lastMoodleSyncAt: null, lastStudentsSyncAt: null, lastAutoSync: null }
  appStage.value = 'login'
  notifySuccess('已退出当前账号', '退出成功')
}

onMounted(async () => {
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
    // ignore
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
  <main class="page">
    <el-card class="card">
      <template #header>
        <div class="title">Campus Dashboard</div>
      </template>

      <el-space v-if="appStage === 'login'" direction="vertical" fill size="large">
        <el-alert title="登录后进入统一课程面板（Moodle + Students 合并）" type="info" :closable="false" />
        <el-form label-position="top">
          <el-form-item label="账号（邮箱）">
            <el-autocomplete
              v-model="loginForm.username"
              autocomplete="username"
              clearable
              placeholder="请输入账号"
              style="width: 100%"
              :fetch-suggestions="querySearchProfiles"
              @select="handlePickProfile"
            />
          </el-form-item>
          <el-form-item label="密码">
            <el-input
              v-model="loginForm.password"
              autocomplete="current-password"
              show-password
              type="password"
              @keyup.enter="handleLogin"
            />
          </el-form-item>
          <el-form-item>
            <el-checkbox v-model="rememberPassword">记住密码</el-checkbox>
          </el-form-item>
          <el-button type="primary" :loading="loggingIn" @click="handleLogin">
            登录并进入面板
          </el-button>
        </el-form>
      </el-space>

      <el-space v-else direction="vertical" fill size="large">
        <el-alert
          v-if="user"
          type="success"
          :closable="false"
          :title="`已登录：${user.fullName}（${user.username}）`"
        />

        <el-space wrap>
          <el-button :loading="studentsAuthing" @click="authStudents">Students 认证</el-button>
          <el-button :loading="moodleSyncing" @click="syncMoodle">同步 Moodle</el-button>
          <el-button :loading="studentsSyncing" @click="syncStudents">同步 Students</el-button>
          <el-button type="primary" :loading="moodleSyncing || studentsSyncing" @click="syncAll">同步全部</el-button>
          <el-button @click="loadDashboard">刷新本地缓存视图</el-button>
          <el-button type="warning" plain @click="handleLogout">退出登录</el-button>
        </el-space>

        <el-descriptions :column="2" border>
          <el-descriptions-item label="Moodle 上次同步">{{ formatTime(dashboard.lastMoodleSyncAt?.at) }}</el-descriptions-item>
          <el-descriptions-item label="Students 上次同步">{{ formatTime(dashboard.lastStudentsSyncAt?.at) }}</el-descriptions-item>
          <el-descriptions-item v-if="hasAutoSyncRecord" label="自动同步状态">{{ autoSyncStatusText }}</el-descriptions-item>
          <el-descriptions-item v-if="hasAutoSyncRecord" label="下次自动同步预计">{{ nextAutoSyncText }}</el-descriptions-item>
          <el-descriptions-item label="课程总数">{{ dashboard.courses.length }}</el-descriptions-item>
          <el-descriptions-item label="考试总数">{{ dashboard.exams.length }}</el-descriptions-item>
        </el-descriptions>

        <el-table :data="dashboard.courses" border @row-click="handleSelectCourse">
          <el-table-column prop="courseCode" label="课程代码" width="130" />
          <el-table-column prop="courseName" label="课程名称" />
          <el-table-column prop="semesterLabel" label="学期" width="160" />
          <el-table-column label="学分" width="100">
            <template #default="{ row }">{{ row.credits ?? '-' }}</template>
          </el-table-column>
          <el-table-column label="来源" width="170">
            <template #default="{ row }">
              <el-tag size="small" type="success" v-if="row.hasMoodle">Moodle</el-tag>
              <el-tag size="small" type="info" v-if="row.hasStudents">Students</el-tag>
            </template>
          </el-table-column>
        </el-table>

        <el-divider />

        <el-alert
          v-if="selectedCourse"
          type="info"
          :closable="false"
          :title="`当前课程：${selectedCourse.courseCode || '-'} ${selectedCourse.courseName}`"
        />
        <el-empty v-else description="点击上方课程可查看详情（课件+考试）" />

        <el-table v-if="selectedCourseExams.length" :data="selectedCourseExams" border>
          <el-table-column prop="examSession" label="场次" width="80" />
          <el-table-column prop="date" label="日期" width="130" />
          <el-table-column prop="time" label="时间" width="100" />
          <el-table-column prop="duration" label="时长" width="120" />
          <el-table-column prop="venue" label="地点" />
        </el-table>

        <el-alert v-if="loadingSections" type="info" :closable="false" title="正在加载 Moodle 课件..." />
        <el-collapse v-if="selectedSections.length">
          <el-collapse-item
            v-for="section in selectedSections"
            :key="section.id"
            :title="`${section.name || '未命名章节'}（${section.moduleCount} 项）`"
            :name="section.id"
          >
            <el-table :data="section.modules" border size="small">
              <el-table-column prop="modname" label="类型" width="120" />
              <el-table-column prop="name" label="资源名称" />
              <el-table-column label="资源文件">
                <template #default="{ row }">
                  <el-space v-if="row.resources.length" direction="vertical" alignment="start">
                    <a
                      v-for="item in row.resources"
                      :key="`${item.fileurl}-${item.filename}`"
                      :href="item.fileurl"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {{ item.filename || item.mimetype || '未命名资源' }} ({{ formatBytes(item.filesize) }})
                    </a>
                  </el-space>
                  <span v-else>{{ row.url || '-' }}</span>
                </template>
              </el-table-column>
            </el-table>
          </el-collapse-item>
        </el-collapse>
      </el-space>
    </el-card>
  </main>
</template>

<style scoped>
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

:global(.campus-toast .el-message__icon) {
  display: none !important;
}

:global(.campus-toast .el-message__content) {
  padding-right: 0;
}

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

.page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}

.card {
  width: min(1180px, 100%);
}

.title {
  font-weight: 600;
}
</style>
