import axios from 'axios'
import Store from 'electron-store'
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

const MOODLE_BASE = 'https://moodle.gtiit.edu.cn/moodle'
const MOODLE_TOKEN_URL = `${MOODLE_BASE}/login/token.php`
const MOODLE_WS_URL = `${MOODLE_BASE}/webservice/rest/server.php`
const TERM_REGEX = /(Spring|Summer|Fall|Winter)\s+(\d{4})/i

export class MoodleService {
  private appStore: Store<PersistedState>
  private moodleSessions = new Map<string, { token: string; username: string }>()
  private activeUsername: string | null = null

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

  private async callMoodleWs<T>(wsfunction: string, token: string, extraParams: Record<string, string | number> = {}) {
    const { data } = await axios.get<T>(MOODLE_WS_URL, {
      params: {
        wstoken: token,
        moodlewsrestformat: 'json',
        wsfunction,
        ...extraParams,
      },
    })
    if (data && typeof data === 'object' && 'exception' in (data as Record<string, unknown>)) {
      const msg = (data as { message?: string }).message ?? 'Moodle 接口返回异常'
      throw new Error(msg)
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

  logout(payload?: { username?: string }) {
    const username = payload?.username?.trim() || this.activeUsername
    if (username) {
      this.moodleSessions.delete(username)
      if (this.activeUsername === username) this.activeUsername = null
    }
    return true
  }
}

