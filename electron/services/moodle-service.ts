import axios from 'axios'
import Store from 'electron-store'
import { BrowserWindow, net, session } from 'electron'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DashboardDb } from '../dashboard-db'

type MoodleProfile = {
  username: string
  fullName: string
  siteName: string
  lastSyncAt: string
  hasRememberedPassword: boolean
}

type PersistedState = {
  moodleProfiles: MoodleProfile[]
}

type MoodleSiteInfo = {
  userid: number
  fullname: string
  sitename: string
  username: string
}

type MoodleCourse = {
  id: number
  fullname: string
  shortname: string
  progress?: number | null
  hidden?: boolean
}

type MoodleSection = {
  id: number
  name: string
  modules?: Array<{
    id: number
    name: string
    modname: string
    url?: string
    visible: boolean
    uservisible: boolean
    contents?: Array<{
      type: string
      filename?: string
      filesize?: number
      fileurl?: string
      mimetype?: string
      isexternalfile?: boolean
    }>
  }>
}

type MoodleTimelineCourses = {
  courses: MoodleCourse[]
}

type MoodleCalendarEvent = {
  id: number
  name: string
  description?: string
  courseid: number
  timestart: number
  timesort: number
  modulename?: string
  instance: number
  course?: { id: number; fullname: string; shortname: string }
  action?: { name: string; url: string; actionable: boolean }
  url?: string
}

type MoodleCalendarResponse = {
  events: MoodleCalendarEvent[]
  firstid?: number
  lastid?: number
}

type MoodleAssignmentRaw = {
  id: number
  cmid: number
  name: string
  intro: string
  introformat: number
  duedate: number
  allowsubmissionsfromdate: number
  configs: Array<{ plugin: string; subtype: string; name: string; value: string }>
}

type MoodleAssignmentsResponse = {
  courses: Array<{ id: number; assignments: MoodleAssignmentRaw[] }>
}

type MoodleSubmissionPlugin = {
  type: string
  name: string
  fileareas?: Array<{
    area: string
    files: Array<{ filename: string; filesize: number; fileurl: string }>
  }>
}

type MoodleSubmissionStatusRaw = {
  gradingsummary?: {
    submissionsenabled: boolean
    submissiondrafts: boolean
    cansubmit: boolean
    duedate: number
  }
  lastattempt?: {
    submission?: {
      id: number
      status: string
      plugins: MoodleSubmissionPlugin[]
    }
    cansubmit: boolean
    caneditsettings: boolean
  }
}

export type TimelineEvent = {
  id: number
  name: string
  description: string
  courseid: number
  coursename: string
  timestart: number
  timesort: number
  modulename: string
  /** cmid extracted from actionUrl (?id=CMID) — reliable identifier */
  cmid: number
  actionUrl: string
}

export type AssignmentDetail = {
  id: number
  cmid: number
  name: string
  intro: string
  duedate: number
  allowsubmissionsfromdate: number
  fileSubmissionEnabled: boolean
  maxFileSubmissions: number
  allowedFileTypes: string
}

export type SubmissionStatus = {
  status: string
  canSubmit: boolean
  canEdit: boolean
  submittedFiles: Array<{ filename: string; filesize: number; fileurl: string }>
}

export type UploadedFile = {
  itemid: number
  filename: string
  fileSize: number
}

const MOODLE_BASE = 'https://moodle.gtiit.edu.cn/moodle'
const MOODLE_TOKEN_URL = `${MOODLE_BASE}/login/token.php`
const MOODLE_WS_URL = `${MOODLE_BASE}/webservice/rest/server.php`
const TERM_REGEX = /(Spring|Summer|Fall|Winter)\s+(\d{4})/i

export class MoodleService {
  private appStore: Store<PersistedState>
  private moodleSessions = new Map<string, { token: string; username: string }>()
  private activeUsername: string | null = null
  /** In-memory cache: cmid → AssignmentDetail (cleared on logout) */
  private assignmentCache = new Map<number, AssignmentDetail>()

  constructor(private readonly db: DashboardDb) {
    this.appStore = new Store<PersistedState>({
      defaults: { moodleProfiles: [] },
    })
  }

  private extractTermLabel(name: string) {
    const hit = name.match(TERM_REGEX)
    if (!hit) return ''
    const season = hit[1].charAt(0).toUpperCase() + hit[1].slice(1).toLowerCase()
    return `${season} ${hit[2]}`
  }

  private pickCurrentTermCourses(courses: MoodleCourse[]) {
    const visible = courses.filter((course) => !course.hidden)
    const termCounter = new Map<string, number>()
    visible.forEach((course) => {
      const term = this.extractTermLabel(course.fullname)
      if (term) {
        termCounter.set(term, (termCounter.get(term) ?? 0) + 1)
      }
    })

    const dominantTerm = [...termCounter.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
    if (!dominantTerm) {
      return { termLabel: '', courses: visible }
    }
    const filtered = visible.filter((course) => this.extractTermLabel(course.fullname) === dominantTerm)
    return { termLabel: dominantTerm, courses: filtered.length ? filtered : visible }
  }

  private withToken(fileUrl: string, token: string) {
    if (!fileUrl) return ''
    return fileUrl.includes('?') ? `${fileUrl}&token=${token}` : `${fileUrl}?token=${token}`
  }

  private async requestMoodleToken(username: string, password: string) {
    const { data } = await axios.get(MOODLE_TOKEN_URL, {
      params: { username, password, service: 'moodle_mobile_app' },
    })
    if (!data || typeof data !== 'object') throw new Error('Moodle token 响应格式异常')
    if ('error' in data && data.error) throw new Error(String(data.error))
    if (!('token' in data) || typeof data.token !== 'string') throw new Error('未获取到 Moodle token')
    return data.token
  }

  private async callMoodleWs<T>(
    wsfunction: string,
    token: string,
    extraParams: Record<string, string | number | boolean> = {},
    options?: { method?: 'get' | 'post' },
  ) {
    const params: Record<string, string | number | boolean> = {
      wstoken: token,
      moodlewsrestformat: 'json',
      wsfunction,
      ...extraParams,
    }
    const method = options?.method ?? 'get'
    const data = method === 'post'
      ? (await axios.post<T>(
          MOODLE_WS_URL,
          new URLSearchParams(
            Object.entries(params).map(([key, value]) => [key, String(value)]),
          ).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          },
        )).data
      : (await axios.get<T>(MOODLE_WS_URL, { params })).data

    if (data && typeof data === 'object' && 'exception' in (data as Record<string, unknown>)) {
      const exceptionData = data as { message?: string; errorcode?: string; debuginfo?: string }
      const msg = exceptionData.message ?? 'Moodle 接口返回异常'
      const detail = [exceptionData.errorcode, exceptionData.debuginfo].filter(Boolean).join(' | ')
      throw new Error(detail ? `${msg} (${detail})` : msg)
    }
    return data
  }

  private ensureSession(username?: string) {
    const key = username?.trim() || this.activeUsername
    if (!key) throw new Error('请先登录 Moodle')
    const session = this.moodleSessions.get(key)
    if (!session?.token) throw new Error('当前账号会话已失效，请重新登录')
    return session
  }

  hasActiveSession() {
    if (!this.activeUsername) return false
    return this.moodleSessions.has(this.activeUsername)
  }

  private upsertProfile(profile: Omit<MoodleProfile, 'lastSyncAt'>) {
    const profiles = this.appStore.get('moodleProfiles')
    const nextProfile: MoodleProfile = { ...profile, lastSyncAt: new Date().toISOString() }
    const idx = profiles.findIndex((item) => item.username === profile.username)
    if (idx >= 0) profiles[idx] = nextProfile
    else profiles.push(nextProfile)
    this.appStore.set('moodleProfiles', profiles)
  }

  private listProfiles() {
    return this.appStore
      .get('moodleProfiles')
      .map((item) => ({
        ...item,
        hasRememberedPassword: Boolean(this.db.getMoodleCredential(item.username)),
      }))
      .sort((a, b) => (a.lastSyncAt < b.lastSyncAt ? 1 : -1))
  }

  async login(payload: { username: string; password: string; rememberPassword?: boolean }) {
    const username = payload?.username?.trim()
    const password = payload?.password
    if (!username || !password) throw new Error('请输入 Moodle 账号和密码')

    const token = await this.requestMoodleToken(username, password)
    this.moodleSessions.set(username, { token, username })
    this.activeUsername = username

    const siteInfo = await this.callMoodleWs<MoodleSiteInfo>('core_webservice_get_site_info', token)
    const user = {
      username: siteInfo.username,
      fullName: siteInfo.fullname,
      siteName: siteInfo.sitename,
      userId: siteInfo.userid,
    }
    this.upsertProfile({
      username: user.username,
      fullName: user.fullName,
      siteName: user.siteName,
      hasRememberedPassword: false,
    })
    if (payload.rememberPassword) this.db.setMoodleCredential(user.username, password)
    else this.db.removeMoodleCredential(user.username)
    return user
  }

  async sync(payload?: { username?: string }) {
    const session = this.ensureSession(payload?.username)
    const siteInfo = await this.callMoodleWs<MoodleSiteInfo>('core_webservice_get_site_info', session.token)
    const timeline = await this.callMoodleWs<MoodleTimelineCourses>(
      'core_course_get_enrolled_courses_by_timeline_classification',
      session.token,
      { classification: 'inprogress', limit: 100, offset: 0, sort: 'fullname' },
    )
    const { termLabel, courses } = this.pickCurrentTermCourses(timeline.courses ?? [])
    const normalizedCourses = courses.map((course) => ({
      id: course.id,
      fullname: course.fullname,
      shortname: course.shortname,
      progress: course.progress ?? null,
    }))

    const delta = this.db.upsertMoodleCourses(termLabel, normalizedCourses)
    this.db.setMeta('sync:moodle:last', {
      at: new Date().toISOString(),
      username: siteInfo.username,
      termLabel,
      count: normalizedCourses.length,
      delta,
    })

    return {
      user: {
        username: siteInfo.username,
        fullName: siteInfo.fullname,
        siteName: siteInfo.sitename,
        userId: siteInfo.userid,
      },
      termLabel,
      courses: normalizedCourses,
      delta,
    }
  }

  async courseContents(payload: { courseId: number; username?: string }) {
    const courseId = Number(payload?.courseId)
    if (!Number.isFinite(courseId)) throw new Error('无效课程 ID')
    const session = this.ensureSession(payload?.username)
    const sections = await this.callMoodleWs<MoodleSection[]>('core_course_get_contents', session.token, { courseid: courseId })

    return sections.map((section) => ({
      id: section.id,
      name: section.name,
      moduleCount: section.modules?.length ?? 0,
      modules: (section.modules ?? []).map((module) => ({
        id: module.id,
        name: module.name,
        modname: module.modname,
        url: module.url ?? '',
        visible: module.visible,
        uservisible: module.uservisible,
        resources: (module.contents ?? [])
          .filter((item) => item.type === 'file' || item.type === 'url')
          .map((item) => ({
            type: item.type,
            filename: item.filename ?? '',
            filesize: item.filesize ?? 0,
            mimetype: item.mimetype ?? '',
            isexternalfile: Boolean(item.isexternalfile),
            fileurl: this.withToken(item.fileurl ?? '', session.token),
          })),
      })),
    }))
  }

  profilesList() {
    return this.listProfiles()
  }

  profileRemove(payload: { username: string }) {
    const username = payload?.username?.trim()
    if (!username) throw new Error('缺少要删除的账号')
    const next = this.listProfiles().filter((item) => item.username !== username)
    this.appStore.set('moodleProfiles', next)
    this.db.removeMoodleCredential(username)
    this.moodleSessions.delete(username)
    if (this.activeUsername === username) this.activeUsername = null
    return true
  }

  credentialGet(payload: { username: string }) {
    const username = payload?.username?.trim()
    if (!username) return { username: '', password: null }
    return {
      username,
      password: this.db.getMoodleCredential(username),
    }
  }

  async loginViaSso(getParentWindow: () => BrowserWindow | null): Promise<{
    username: string
    fullName: string
    siteName: string
    userId: number
  }> {
    const MOODLE_LOGIN_URL = `${MOODLE_BASE}/login/index.php`
    const passport = `${Date.now()}${Math.random().toString(36).slice(2)}`
    const LAUNCH_URL = `${MOODLE_BASE}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passport}&urlscheme=moodlemobile`

    const PARTITION = 'persist:students'
    const ses = session.fromPartition(PARTITION)

    const parent = getParentWindow() ?? undefined
    const win = new BrowserWindow({
      width: 1100,
      height: 760,
      title: 'GT-IIT Campus Dashboard — SSO 登录',
      modal: Boolean(parent),
      parent,
      autoHideMenuBar: true,
      show: true,
      webPreferences: {
        // Share the same partition as Students so Office 365 session is reused
        partition: PARTITION,
        contextIsolation: true,
        sandbox: true,
      },
    })

    return new Promise((resolve, reject) => {
      let done = false
      let moodleLoginDetected = false
      let launchNavigated = false
      let launchTimeoutId: ReturnType<typeof setTimeout> | null = null
      let globalTimer: ReturnType<typeof setTimeout>

      const unregisterProtocol = () => {
        try { ses.protocol.unregisterProtocol('moodlemobile') } catch { /* already removed */ }
      }

      const finish = (value: { username: string; fullName: string; siteName: string; userId: number } | Error) => {
        if (done) return
        done = true
        clearTimeout(globalTimer)
        if (launchTimeoutId) clearTimeout(launchTimeoutId)
        unregisterProtocol()
        if (!win.isDestroyed()) win.close()
        if (value instanceof Error) reject(value)
        else resolve(value)
      }

      // Register moodlemobile:// at the session level so Electron intercepts it
      // before Windows tries to open it with a system app.
      ses.protocol.registerStringProtocol('moodlemobile', (request) => {
        processTokenUrl(request.url)
      })

      globalTimer = setTimeout(
        () => finish(new Error('SSO 登录超时（5 分钟），请重试')),
        5 * 60 * 1000,
      )

      const processTokenUrl = (url: string) => {
        if (done) return
        try {
          const raw = url.replace(/^moodlemobile:\/\/token=/, '')
          if (!raw) throw new Error('token 参数为空')
          const decoded = Buffer.from(raw, 'base64').toString('utf8')
          // Moodle token format: "username:::wstoken" (:::privatetoken is optional)
          const parts = decoded.split(':::')
          if (parts.length < 2) throw new Error(`token 格式异常: ${decoded}`)
          const [username, token] = parts
          if (!username || !token) throw new Error('username 或 token 为空')

          this.moodleSessions.set(username, { token, username })
          this.activeUsername = username

          this.callMoodleWs<MoodleSiteInfo>('core_webservice_get_site_info', token)
            .then((siteInfo) => {
              // Re-key the session with the canonical API username so that
              // ensureSession() can find it when the frontend passes siteInfo.username
              this.moodleSessions.delete(username)
              this.moodleSessions.set(siteInfo.username, { token, username: siteInfo.username })
              this.activeUsername = siteInfo.username
              this.upsertProfile({
                username: siteInfo.username,
                fullName: siteInfo.fullname,
                siteName: siteInfo.sitename,
                hasRememberedPassword: false,
              })
              finish({
                username: siteInfo.username,
                fullName: siteInfo.fullname,
                siteName: siteInfo.sitename,
                userId: siteInfo.userid,
              })
            })
            .catch((err) => finish(err instanceof Error ? err : new Error(String(err))))
        } catch (err) {
          finish(err instanceof Error ? err : new Error(`解析 SSO token 失败: ${err}`))
        }
      }

      const navigateToLaunch = () => {
        if (done || launchNavigated || win.isDestroyed()) return
        launchNavigated = true
        // If launch.php doesn't redirect within 30s, the plugin might not be enabled
        launchTimeoutId = setTimeout(() => {
          if (!done) {
            finish(new Error(
              'Moodle 未返回 SSO token（launch.php 无响应），可能该插件未启用。请改用账号密码登录。',
            ))
          }
        }, 30 * 1000)
        win.webContents.loadURL(LAUNCH_URL).catch(() => {})
      }

      // Primary: will-navigate fires when the page tries to navigate to moodlemobile://
      win.webContents.on('will-navigate', (_evt, url) => {
        if (url.startsWith('moodlemobile://')) processTokenUrl(url)
      })

      // Backup A: did-fail-load fires after Electron rejects the unknown scheme
      win.webContents.on('did-fail-load', (_evt, _code, _desc, validatedURL, isMainFrame) => {
        if (!isMainFrame) return
        if (validatedURL?.startsWith('moodlemobile://')) processTokenUrl(validatedURL)
      })

      // Detect successful Moodle login by watching main-frame navigations
      win.webContents.on('did-navigate', (_evt, url) => {
        if (done) return
        if (url.startsWith('moodlemobile://')) { processTokenUrl(url); return }

        const onMoodle = url.includes('moodle.gtiit.edu.cn/moodle')
        const onLoginPage = url.includes('/login/')
        const onMSAuth = url.includes('microsoftonline.com')
          || url.includes('login.live.com')
          || url.includes('login.microsoft.com')

        if (onMoodle && !onLoginPage && !onMSAuth && !moodleLoginDetected) {
          moodleLoginDetected = true
          // Wait for the page to settle, then trigger token extraction
          setTimeout(navigateToLaunch, 1500)
        }
      })

      win.on('closed', () => { if (!done) finish(new Error('SSO 窗口已关闭')) })

      win.loadURL(MOODLE_LOGIN_URL).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('ERR_ABORTED')) finish(new Error(msg))
      })
    })
  }

  async getTimeline(payload?: { username?: string; daysAhead?: number }): Promise<TimelineEvent[]> {
    const session = this.ensureSession(payload?.username)
    const now = Math.floor(Date.now() / 1000)
    const daysAhead = payload?.daysAhead ?? 30
    const timesortto = now + daysAhead * 24 * 60 * 60

    const data = await this.callMoodleWs<MoodleCalendarResponse>(
      'core_calendar_get_action_events_by_timesort',
      session.token,
      {
        timesortfrom: now,
        timesortto,
        limitnum: 50,
        limittononsuspendedevents: 1,
      },
    )

    return (data.events ?? []).map((event) => {
      const actionUrl = event.action?.url ?? event.url ?? ''
      const cmidMatch = actionUrl.match(/[?&]id=(\d+)/)
      const cmid = cmidMatch ? parseInt(cmidMatch[1], 10) : 0
      return {
        id: event.id,
        name: event.name,
        description: event.description ?? '',
        courseid: event.courseid,
        coursename: event.course?.fullname ?? '',
        timestart: event.timestart,
        timesort: event.timesort,
        modulename: event.modulename ?? '',
        cmid,
        actionUrl,
      }
    })
  }

  async getAssignmentDetail(payload: { cmid: number; courseId: number; username?: string }): Promise<AssignmentDetail> {
    const session = this.ensureSession(payload?.username)
    const data = await this.callMoodleWs<MoodleAssignmentsResponse>(
      'mod_assign_get_assignments',
      session.token,
      { 'courseids[0]': payload.courseId },
    )

    const allAssignments = (data.courses ?? []).flatMap((c) => c.assignments ?? [])
    // Match by cmid (the course module ID extracted from the event URL — reliable)
    const assign = allAssignments.find((a) => a.cmid === payload.cmid)
    if (!assign) throw new Error(`未找到课程模块 cmid=${payload.cmid} 对应的作业`)

    const configs = assign.configs ?? []
    const getConfig = (plugin: string, name: string) =>
      configs.find((c) => c.plugin === plugin && c.name === name)?.value ?? ''

    const fileEnabled = getConfig('file', 'enabled') === '1'
    const maxFiles = parseInt(getConfig('file', 'maxfilesubmissions') || '1', 10)
    const fileTypes = getConfig('file', 'filetypesList') ?? ''

    return {
      id: assign.id,
      cmid: assign.cmid,
      name: assign.name,
      intro: assign.intro,
      duedate: assign.duedate,
      allowsubmissionsfromdate: assign.allowsubmissionsfromdate,
      fileSubmissionEnabled: fileEnabled,
      maxFileSubmissions: isNaN(maxFiles) ? 1 : maxFiles,
      allowedFileTypes: fileTypes,
    }
  }

  async getSubmissionStatus(payload: { assignId: number; username?: string }): Promise<SubmissionStatus> {
    const session = this.ensureSession(payload?.username)
    const data = await this.callMoodleWs<MoodleSubmissionStatusRaw>(
      'mod_assign_get_submission_status',
      session.token,
      { assignid: payload.assignId },
    )
    return this.parseSubmissionStatus(data, session.token)
  }

  private parseSubmissionStatus(data: MoodleSubmissionStatusRaw, token: string): SubmissionStatus {
    const attempt = data.lastattempt
    const submission = attempt?.submission
    const filePlugin = submission?.plugins?.find((p) => p.type === 'file')
    const submissionFiles = filePlugin?.fileareas?.find((a) => a.area === 'submission_files')?.files ?? []
    const canSubmit =
      attempt?.cansubmit ??
      data.gradingsummary?.cansubmit ??
      (data.gradingsummary?.submissionsenabled !== false)
    return {
      status: submission?.status ?? 'new',
      canSubmit,
      canEdit: attempt?.caneditsettings ?? true,
      submittedFiles: submissionFiles.map((f) => ({
        filename: f.filename,
        filesize: f.filesize,
        fileurl: this.withToken(f.fileurl, token),
      })),
    }
  }

  /**
   * Combined method: fetches assignment detail + submission status with minimal latency.
   * Strategy:
   *   1. Fast call: core_course_get_course_module(cmid) → get real assignId (~0.3 s)
   *   2. Parallel:  mod_assign_get_assignments(courseId) + mod_assign_get_submission_status(assignId)
   *   3. Cache assignment detail (cmid → detail) so subsequent opens skip step 1+2a
   */
  async getAssignmentWithStatus(payload: { cmid: number; courseId: number; username?: string }): Promise<{
    detail: AssignmentDetail
    status: SubmissionStatus
  }> {
    const sess = this.ensureSession(payload?.username)

    const cached = this.assignmentCache.get(payload.cmid)
    if (cached) {
      // Cache hit: only fetch the live submission status
      const statusData = await this.callMoodleWs<MoodleSubmissionStatusRaw>(
        'mod_assign_get_submission_status', sess.token, { assignid: cached.id },
      )
      return { detail: cached, status: this.parseSubmissionStatus(statusData, sess.token) }
    }

    // Cache miss: resolve real assignId from cmid, then fetch detail + status in parallel
    const moduleData = await this.callMoodleWs<{ cm: { instance: number; modname: string } }>(
      'core_course_get_course_module', sess.token, { cmid: payload.cmid },
    )
    const assignId = moduleData.cm.instance

    const [assignmentsData, statusData] = await Promise.all([
      this.callMoodleWs<MoodleAssignmentsResponse>(
        'mod_assign_get_assignments', sess.token, { 'courseids[0]': payload.courseId },
      ),
      this.callMoodleWs<MoodleSubmissionStatusRaw>(
        'mod_assign_get_submission_status', sess.token, { assignid: assignId },
      ),
    ])

    const allAssignments = (assignmentsData.courses ?? []).flatMap((c) => c.assignments ?? [])
    const assign = allAssignments.find((a) => a.cmid === payload.cmid)
    if (!assign) throw new Error(`未找到课程模块 cmid=${payload.cmid} 对应的作业`)

    const configs = assign.configs ?? []
    const getConfig = (plugin: string, name: string) =>
      configs.find((c) => c.plugin === plugin && c.name === name)?.value ?? ''

    const detail: AssignmentDetail = {
      id: assign.id,
      cmid: assign.cmid,
      name: assign.name,
      intro: assign.intro,
      duedate: assign.duedate,
      allowsubmissionsfromdate: assign.allowsubmissionsfromdate,
      fileSubmissionEnabled: getConfig('file', 'enabled') === '1',
      maxFileSubmissions: parseInt(getConfig('file', 'maxfilesubmissions') || '1', 10) || 1,
      allowedFileTypes: getConfig('file', 'filetypesList') ?? '',
    }
    this.assignmentCache.set(payload.cmid, detail)

    return { detail, status: this.parseSubmissionStatus(statusData, sess.token) }
  }

  async uploadFile(payload: { filePath: string; username?: string }): Promise<UploadedFile> {
    const sess = this.ensureSession(payload?.username)
    const filePath = payload.filePath
    const filename = path.basename(filePath)
    const fileBuffer = readFileSync(filePath)
    const fileSize = fileBuffer.length

    const ext = path.extname(filename).toLowerCase().slice(1)
    const MIME: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      zip: 'application/zip',
      rar: 'application/x-rar-compressed',
      txt: 'text/plain',
      mp4: 'video/mp4',
      mp3: 'audio/mpeg',
    }
    const mimeType = MIME[ext] ?? 'application/octet-stream'

    // Build multipart body manually and use Electron net.fetch (Chromium networking stack)
    // — far more reliable than axios or Node global fetch in the main process
    const boundary = `WebKitFormBoundary${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
    const CRLF = '\r\n'
    const enc = (s: string) => Buffer.from(s, 'utf8')

    const body = Buffer.concat([
      enc(`--${boundary}${CRLF}Content-Disposition: form-data; name="token"${CRLF}${CRLF}${sess.token}${CRLF}`),
      enc(`--${boundary}${CRLF}Content-Disposition: form-data; name="filearea"${CRLF}${CRLF}draft${CRLF}`),
      enc(`--${boundary}${CRLF}Content-Disposition: form-data; name="itemid"${CRLF}${CRLF}0${CRLF}`),
      enc(`--${boundary}${CRLF}Content-Disposition: form-data; name="file_1"; filename="${filename}"${CRLF}Content-Type: ${mimeType}${CRLF}${CRLF}`),
      fileBuffer,
      enc(`${CRLF}--${boundary}--${CRLF}`),
    ])

    const uploadUrl = `${MOODLE_BASE}/webservice/upload.php`
    const start = Date.now()
    const timeoutMs = 45_000
    const abortController = new AbortController()
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs)

    console.info('[moodle:upload] start', {
      username: sess.username,
      filename,
      fileSize,
      mimeType,
      timeoutMs,
    })

    let response: Awaited<ReturnType<typeof net.fetch>>
    try {
      response = await net.fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        signal: abortController.signal,
      })
    } catch (error) {
      const elapsedMs = Date.now() - start
      if ((error as Error).name === 'AbortError') {
        console.error('[moodle:upload] timeout', { filename, elapsedMs, timeoutMs })
        throw new Error(`文件上传超时（>${timeoutMs / 1000}s），请检查网络或稍后重试`)
      }
      console.error('[moodle:upload] request failed', { filename, elapsedMs, error })
      throw error
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.error('[moodle:upload] http error', {
        filename,
        status: response.status,
        elapsedMs: Date.now() - start,
        response: text.slice(0, 300),
      })
      throw new Error(`文件上传失败 (HTTP ${response.status}): ${text.slice(0, 300)}`)
    }

    const data = await response.json() as Array<{ itemid: number; filename: string }> | { error?: string; exception?: string; message?: string }
    if (!Array.isArray(data)) {
      const errMsg = (data as { message?: string }).message ?? JSON.stringify(data)
      throw new Error(`文件上传失败: ${errMsg}`)
    }
    if (data[0]?.itemid == null) {
      throw new Error(`文件上传返回格式异常: ${JSON.stringify(data)}`)
    }
    console.info('[moodle:upload] success', {
      filename,
      elapsedMs: Date.now() - start,
      itemid: data[0].itemid,
    })
    return { itemid: data[0].itemid, filename: data[0].filename ?? filename, fileSize }
  }

  async saveSubmission(payload: { assignId: number; draftItemId: number; username?: string }): Promise<boolean> {
    const session = this.ensureSession(payload?.username)
    const assignId = Number(payload.assignId)
    const draftItemId = Number(payload.draftItemId)
    if (!Number.isFinite(assignId) || assignId <= 0) throw new Error('作业 ID 无效')
    if (!Number.isFinite(draftItemId) || draftItemId <= 0) throw new Error('上传草稿 ID 无效')

    const variants: Array<{ name: string; params: Record<string, string | number | boolean> }> = [
      {
        name: 'files_filemanager(number)',
        params: {
          assignmentid: assignId,
          'plugindata[files_filemanager]': draftItemId,
        },
      },
      {
        name: 'files_filemanager(string)',
        params: {
          assignmentid: assignId,
          'plugindata[files_filemanager]': String(draftItemId),
        },
      },
      {
        name: 'files(string)',
        params: {
          assignmentid: assignId,
          'plugindata[files]': String(draftItemId),
        },
      },
      {
        name: 'files + files_filemanager',
        params: {
          assignmentid: assignId,
          'plugindata[files]': String(draftItemId),
          'plugindata[files_filemanager]': String(draftItemId),
        },
      },
    ]

    let lastError: Error | null = null
    for (const variant of variants) {
      try {
        console.info('[moodle:save-submission] try', {
          username: session.username,
          assignId,
          draftItemId,
          variant: variant.name,
        })
        await this.callMoodleWs<{ savedsuccess?: boolean; warnings?: unknown[] }>(
          'mod_assign_save_submission',
          session.token,
          variant.params,
          { method: 'post' },
        )
        console.info('[moodle:save-submission] success', {
          assignId,
          draftItemId,
          variant: variant.name,
        })
        return true
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        lastError = err
        // Only retry when Moodle reports invalid parameters; other errors should fail fast.
        if (!err.message.includes('Invalid parameter value detected')) {
          throw err
        }
        console.warn('[moodle:save-submission] variant failed', {
          assignId,
          draftItemId,
          variant: variant.name,
          error: err.message,
        })
      }
    }
    throw lastError ?? new Error('提交失败')
  }

  logout(payload?: { username?: string }) {
    const username = payload?.username?.trim() || this.activeUsername
    if (username) {
      this.moodleSessions.delete(username)
      if (this.activeUsername === username) this.activeUsername = null
    }
    this.assignmentCache.clear()
    return true
  }
}

