import { BrowserWindow, session } from 'electron'
import { DashboardDb } from '../dashboard-db'

const STUDENTS_URL = 'https://students.gtiit.edu.cn'
const STUDENTS_API_BASE = 'https://slcm-rp.gtiit.edu.cn/UGDBrestApi/api/Students'
const STUDENTS_PARTITION = 'persist:students'
const SYNC_READY_MAX_RETRIES = 8
const SYNC_READY_RETRY_MS = 600

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const now = () => Date.now()
const elapsed = (start: number) => `${Date.now() - start}ms`
const syncTrace = () => `students-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

type RuntimeHints = {
  sid?: string
  version?: string
  token?: string
  apiBase?: string
  capturedHeaders?: Record<string, string>
  capturedApiUrl?: string
  updatedAt: number
}

type SyncOptions = {
  discardRuntimeHints?: boolean
  forceReload?: boolean
}

type WarmupOptions = {
  forceReload?: boolean
  timeoutMs?: number
}

const pickTokenFromHeaders = (headers: Record<string, string>) => {
  const auth = headers.authorization || headers.Authorization || ''
  const xToken = headers['x-access-token'] || headers['X-Access-Token'] || ''
  if (xToken) return xToken
  if (auth) return auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth
  return ''
}

export class StudentsService {
  private studentsAuthWin: BrowserWindow | null = null
  private studentsRuntimeHints: RuntimeHints | null = null
  private studentsSnifferInstalled = false

  constructor(
    private readonly db: DashboardDb,
    private readonly getParentWindow: () => BrowserWindow | null,
  ) {}

  installRequestSniffer() {
    if (this.studentsSnifferInstalled) return
    this.studentsSnifferInstalled = true
    const ses = session.fromPartition(STUDENTS_PARTITION)
    ses.webRequest.onBeforeSendHeaders(
      {
        urls: [
          'https://slcm-rp.gtiit.edu.cn/*',
          'https://students.gtiit.edu.cn/*',
        ],
      },
      (details, callback) => {
        try {
          const requestHeaders = details.requestHeaders ?? {}
          const normalizedHeaders: Record<string, string> = {}
          Object.entries(requestHeaders).forEach(([key, value]) => {
            const normalized = Array.isArray(value) ? value[0] : value
            if (typeof normalized === 'string' && normalized) {
              normalizedHeaders[key.toLowerCase()] = normalized
            }
          })
          const authHeader = (requestHeaders.Authorization ||
            requestHeaders.authorization ||
            requestHeaders['x-access-token'] ||
            requestHeaders['X-Access-Token']) as string | string[] | undefined
          const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader

          const url = new URL(details.url)
          const sid = url.searchParams.get('sid') ?? ''
          const version = url.searchParams.get('v') ?? ''
          const isStudentsApi = url.pathname.includes('/UGDBrestApi/api/Students/')

          if (sid || version || authValue || isStudentsApi) {
            this.studentsRuntimeHints = {
              sid: sid || this.studentsRuntimeHints?.sid || '',
              version: version || this.studentsRuntimeHints?.version || '',
              token: authValue || this.studentsRuntimeHints?.token || '',
              apiBase: isStudentsApi ? `${url.origin}/UGDBrestApi/api/Students` : (this.studentsRuntimeHints?.apiBase || STUDENTS_API_BASE),
              capturedHeaders: isStudentsApi ? normalizedHeaders : (this.studentsRuntimeHints?.capturedHeaders || {}),
              capturedApiUrl: isStudentsApi ? details.url : (this.studentsRuntimeHints?.capturedApiUrl || ''),
              updatedAt: Date.now(),
            }
          }
        } catch {
          // keep request flow untouched even if parsing fails
        } finally {
          callback({ requestHeaders: details.requestHeaders })
        }
      },
    )
  }

  private isStudentsDashboardUrl(rawUrl: string) {
    try {
      const url = new URL(rawUrl)
      const hostOk = url.hostname.includes('students.gtiit.edu.cn')
      const blockedPath = url.pathname.toLowerCase().includes('/login')
      return hostOk && !blockedPath
    } catch {
      return false
    }
  }

  private async extractRuntimeHints(windowRef: BrowserWindow) {
    return windowRef.webContents.executeJavaScript(`
      (() => {
        const kv = {};
        const collect = (store) => {
          try {
            for (let i = 0; i < store.length; i += 1) {
              const k = store.key(i);
              if (!k) continue;
              kv[k] = store.getItem(k) || '';
            }
          } catch {}
        };
        collect(localStorage);
        collect(sessionStorage);
        const values = Object.values(kv).map((v) => String(v || ''));
        let token = '';
        const jwtDirect = values.find((v) => /^[A-Za-z0-9-_]+\\.[A-Za-z0-9-_]+\\.[A-Za-z0-9-_]+$/.test(v.trim()));
        if (jwtDirect) token = jwtDirect.trim();
        if (!token) {
          for (const raw of values) {
            if (!raw || raw.length < 20) continue;
            try {
              const obj = JSON.parse(raw);
              const candidates = [obj?.secret, obj?.accessToken, obj?.idToken, obj?.token];
              const found = candidates.find((x) => typeof x === 'string' && x.length > 20);
              if (found) {
                token = String(found);
                break;
              }
            } catch {}
          }
        }

        const resources = performance.getEntriesByType('resource').map((entry) => String(entry.name || ''));
        const joined = resources.join('\\n');
        const sidFromResource = (joined.match(/[?&]sid=([a-z0-9\\-]+)/i) || [])[1] || '';
        const version = (joined.match(/[?&]v=([0-9.]+)/i) || [])[1] || '';
        const sid = String(sidFromResource || kv.sessionID || '').replace(/^"+|"+$/g, '');
        const apiUrlHit = resources.find((url) => url.includes('/UGDBrestApi/api/Students/')) || '';
        let apiBase = '';
        if (apiUrlHit) {
          try {
            const u = new URL(apiUrlHit);
            apiBase = u.origin + '/UGDBrestApi/api/Students';
          } catch {}
        }

        return { sid, version, token, apiBase };
      })();
    `) as Promise<{ sid?: string; version?: string; token?: string; apiBase?: string }>
  }

  private async waitForMainFrameReady(windowRef: BrowserWindow, timeoutMs = 4000) {
    const wc = windowRef.webContents
    if (!wc.isLoadingMainFrame()) return
    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        wc.removeListener('did-finish-load', onLoad)
        wc.removeListener('did-fail-load', onFail)
        resolve()
      }
      const onLoad = () => finish()
      const onFail = (_event: Electron.Event, code: number, _desc: string, _url: string, isMainFrame: boolean) => {
        if (!isMainFrame || code === -3) return
        finish()
      }
      const timer = setTimeout(() => finish(), timeoutMs)
      wc.once('did-finish-load', onLoad)
      wc.once('did-fail-load', onFail)
    })
  }

  async authenticate() {
    const started = now()
    console.log('[students:authenticate] open auth window')
    if (this.studentsAuthWin && !this.studentsAuthWin.isDestroyed()) {
      this.studentsAuthWin.focus()
      console.log('[students:authenticate] window already open')
      return { authenticated: false, reason: 'auth-window-already-open' }
    }

    const parent = this.getParentWindow() ?? undefined
    const authWin = new BrowserWindow({
      width: 1100,
      height: 760,
      title: 'Students 登录验证',
      modal: Boolean(parent),
      parent,
      autoHideMenuBar: true,
      webPreferences: {
        partition: STUDENTS_PARTITION,
        contextIsolation: true,
        sandbox: true,
      },
    })
    this.studentsAuthWin = authWin

    const resultPromise = new Promise<{ authenticated: boolean; reason?: string; finalUrl?: string }>((resolve) => {
      let done = false
      let timer: NodeJS.Timeout | null = null
      let authDetected = false
      const finish = (payload: { authenticated: boolean; reason?: string; finalUrl?: string }) => {
        if (done) return
        done = true
        if (timer) clearTimeout(timer)
        resolve(payload)
        if (!authWin.isDestroyed()) authWin.close()
      }

      const check = async () => {
        try {
          const current = authWin.webContents.getURL()
          if (!this.isStudentsDashboardUrl(current) || authDetected) return
          authDetected = true
          for (let i = 0; i < 12; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 500))
            try {
              const hints = await this.extractRuntimeHints(authWin)
              this.studentsRuntimeHints = {
                sid: hints.sid || this.studentsRuntimeHints?.sid || '',
                version: hints.version || this.studentsRuntimeHints?.version || '',
                token: hints.token || this.studentsRuntimeHints?.token || '',
                apiBase: hints.apiBase || this.studentsRuntimeHints?.apiBase || STUDENTS_API_BASE,
                capturedHeaders: this.studentsRuntimeHints?.capturedHeaders || {},
                capturedApiUrl: this.studentsRuntimeHints?.capturedApiUrl || '',
                updatedAt: Date.now(),
              }
            } catch {
              // ignore and continue polling
            }
            const headerAuth = this.studentsRuntimeHints?.capturedHeaders?.authorization
              || this.studentsRuntimeHints?.capturedHeaders?.Authorization
              || this.studentsRuntimeHints?.capturedHeaders?.['x-access-token']
              || this.studentsRuntimeHints?.capturedHeaders?.['X-Access-Token']
            const hasSid = Boolean(this.studentsRuntimeHints?.sid)
            const hasAuth = Boolean(this.studentsRuntimeHints?.token || headerAuth)
            if (hasSid && hasAuth) {
              finish({ authenticated: true, finalUrl: current })
              return
            }
          }
          authDetected = false
        } catch {
          authDetected = false
        }
      }

      authWin.webContents.on('did-navigate', () => { void check().catch(() => {}) })
      authWin.webContents.on('did-navigate-in-page', () => { void check().catch(() => {}) })
      authWin.webContents.on('did-finish-load', () => { void check().catch(() => {}) })
      authWin.webContents.on('did-fail-load', (_event, code, desc, validatedURL, isMainFrame) => {
        if (!isMainFrame || code === -3) return
        finish({
          authenticated: false,
          reason: `did-fail-load:${code}:${desc}`,
          finalUrl: validatedURL,
        })
      })
      authWin.on('closed', () => {
        this.studentsAuthWin = null
        finish({ authenticated: false, reason: 'window-closed' })
      })
      timer = setTimeout(() => {
        finish({ authenticated: false, reason: 'auth-timeout' })
      }, 5 * 60 * 1000)
    })

    authWin.show()
    authWin.focus()
    void authWin.loadURL(STUDENTS_URL).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('ERR_ABORTED')) return
      if (!authWin.isDestroyed()) authWin.close()
    })
    const result = await resultPromise
    console.log(`[students:authenticate] finish in ${elapsed(started)} result=${result.authenticated ? 'ok' : `fail:${result.reason ?? 'unknown'}`}`)
    return result
  }

  async warmupSession(options?: WarmupOptions) {
    const trace = syncTrace()
    const started = now()
    const timeoutMs = options?.timeoutMs ?? 5000
    console.log(`[students:warmup][${trace}] start forceReload=${Boolean(options?.forceReload)} timeoutMs=${timeoutMs}`)
    const hidden = new BrowserWindow({
      show: false,
      webPreferences: {
        partition: STUDENTS_PARTITION,
        contextIsolation: true,
        sandbox: true,
      },
    })
    try {
      await hidden.loadURL(STUDENTS_URL)
      if (options?.forceReload) {
        hidden.webContents.reloadIgnoringCache()
        await this.waitForMainFrameReady(hidden, Math.min(timeoutMs, 5000))
      }
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        try {
          const hints = await this.extractRuntimeHints(hidden)
          this.studentsRuntimeHints = {
            sid: hints.sid || this.studentsRuntimeHints?.sid || '',
            version: hints.version || this.studentsRuntimeHints?.version || '',
            token: hints.token || this.studentsRuntimeHints?.token || '',
            apiBase: hints.apiBase || this.studentsRuntimeHints?.apiBase || STUDENTS_API_BASE,
            capturedHeaders: this.studentsRuntimeHints?.capturedHeaders || {},
            capturedApiUrl: this.studentsRuntimeHints?.capturedApiUrl || '',
            updatedAt: Date.now(),
          }
        } catch {
          // keep polling until timeout
        }
        const headerAuth = this.studentsRuntimeHints?.capturedHeaders?.authorization
          || this.studentsRuntimeHints?.capturedHeaders?.Authorization
          || this.studentsRuntimeHints?.capturedHeaders?.['x-access-token']
          || this.studentsRuntimeHints?.capturedHeaders?.['X-Access-Token']
        const hasSid = Boolean(this.studentsRuntimeHints?.sid)
        const hasAuth = Boolean(this.studentsRuntimeHints?.token || headerAuth)
        if (hasSid && hasAuth) {
          console.log(`[students:warmup][${trace}] ready in ${elapsed(started)}`)
          return { ready: true, elapsedMs: Date.now() - started }
        }
        await sleep(300)
      }
      console.log(`[students:warmup][${trace}] timeout in ${elapsed(started)}`)
      return { ready: false, elapsedMs: Date.now() - started, reason: 'timeout' }
    } finally {
      if (!hidden.isDestroyed()) hidden.destroy()
    }
  }

  async sync(options?: SyncOptions) {
    const trace = syncTrace()
    const started = now()
    console.log(`[students:sync][${trace}] start discardRuntimeHints=${Boolean(options?.discardRuntimeHints)} forceReload=${Boolean(options?.forceReload)}`)
    if (options?.discardRuntimeHints) {
      this.studentsRuntimeHints = null
      console.log(`[students:sync][${trace}] runtime hints cleared`)
    }
    const hidden = new BrowserWindow({
      show: false,
      webPreferences: {
        partition: STUDENTS_PARTITION,
        contextIsolation: true,
        sandbox: true,
      },
    })

    try {
      const loadStarted = now()
      await hidden.loadURL(STUDENTS_URL)
      console.log(`[students:sync][${trace}] loadURL done in ${elapsed(loadStarted)}`)
      if (options?.forceReload) {
        const reloadStarted = now()
        hidden.webContents.reloadIgnoringCache()
        await this.waitForMainFrameReady(hidden, 5000)
        console.log(`[students:sync][${trace}] reloadIgnoringCache done in ${elapsed(reloadStarted)}`)
      }
      const currentUrl = hidden.webContents.getURL()
      if (!this.isStudentsDashboardUrl(currentUrl)) {
        throw new Error('Students 当前未登录，请先完成验证')
      }

      const readEndpointMeta = async () => hidden.webContents.executeJavaScript(`
        (() => {
          try {
            const resources = performance.getEntriesByType('resource').map((entry) => String(entry.name || ''));
            const joined = resources.join('\\n');
            const sid = (joined.match(/[?&]sid=([a-z0-9\\-]+)/i) || [])[1] || '';
            const version = (joined.match(/[?&]v=([0-9.]+)/i) || [])[1] || '';
            const pick = (name) => resources.find((item) => item.includes('/' + name) || item.includes(name + '?')) || '';
            const toRelative = (raw) => {
              if (!raw) return '';
              try {
                const u = new URL(raw, location.origin);
                return u.pathname + u.search;
              } catch {
                return String(raw);
              }
            };
            return {
              ok: true,
              sid,
              version,
              currentsemester: toRelative(pick('currentsemester')),
              enrollments: toRelative(pick('enrollments')),
              exams: toRelative(pick('exams')),
              profile: toRelative(pick('profile')),
            };
          } catch (err) {
            return { ok: false, error: err && err.message ? String(err.message) : String(err) };
          }
        })();
      `) as Promise<{
        ok: boolean
        sid?: string
        version?: string
        currentsemester?: string
        enrollments?: string
        exams?: string
        profile?: string
        error?: string
      }>

      const endpointStarted = now()
      let endpointMeta = await readEndpointMeta()
      if (!endpointMeta.currentsemester && !endpointMeta.enrollments) {
        for (let i = 0; i < 5; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          endpointMeta = await readEndpointMeta()
          if (endpointMeta.currentsemester || endpointMeta.enrollments) break
        }
      }
      console.log(`[students:sync][${trace}] endpoint meta ready in ${elapsed(endpointStarted)} hasCurrent=${Boolean(endpointMeta.currentsemester)} hasEnroll=${Boolean(endpointMeta.enrollments)} sid=${Boolean(endpointMeta.sid)}`)
      if (!endpointMeta.ok) {
        throw new Error(`Students 同步脚本失败: ${endpointMeta.error || 'extract-endpoint-meta-failed'} @ ${currentUrl}`)
      }

      const cookies = await hidden.webContents.session.cookies.get({})
      const relatedCookies = cookies.filter((cookie) => {
        const domain = (cookie.domain || '').toLowerCase()
        return domain.includes('students.gtiit.edu.cn') || domain.includes('gtiit.edu.cn')
      })
      const cookieHeader = relatedCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')

      let authMeta = await hidden.webContents.executeJavaScript(`
        (() => {
          const kv = {};
          const collect = (store) => {
            try {
              for (let i = 0; i < store.length; i += 1) {
                const k = store.key(i);
                if (!k) continue;
                kv[k] = store.getItem(k) || '';
              }
            } catch {}
          };
          collect(localStorage);
          collect(sessionStorage);
          const values = Object.values(kv).map((v) => String(v || ''));
          const jwtLike = values.find((v) => /^[A-Za-z0-9-_]+\\.[A-Za-z0-9-_]+\\.[A-Za-z0-9-_]+$/.test(v.trim()));
          let token = jwtLike || '';
          if (!token) {
            for (const value of values) {
              if (!value || value.length < 20) continue;
              try {
                const parsed = JSON.parse(value);
                const nested = parsed?.secret || parsed?.accessToken || parsed?.idToken || parsed?.token;
                if (typeof nested === 'string' && nested.length > 20) {
                  token = nested;
                  break;
                }
              } catch {}
            }
          }
          return {
            token,
            sessionID: String(kv.sessionID || ''),
            keys: Object.keys(kv).slice(0, 50),
          };
        })();
      `) as { token?: string; sessionID?: string; keys?: string[] }

      const normalizePath = (input: string) => {
        if (!input) return ''
        try {
          const u = new URL(input, STUDENTS_URL)
          return u.toString()
        } catch {
          return input.startsWith('/') ? input : `/${input}`
        }
      }

      const buildQuery = (params: Record<string, string>) =>
        Object.entries(params)
          .filter(([, value]) => value)
          .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
          .join('&')

      let effectiveToken = authMeta?.token || this.studentsRuntimeHints?.token || ''
      let sid = (endpointMeta.sid || authMeta.sessionID || this.studentsRuntimeHints?.sid || '').replace(/^"+|"+$/g, '')
      let version = endpointMeta.version || this.studentsRuntimeHints?.version || ''

      if (!sid || !effectiveToken) {
        const waitReadyStarted = now()
        for (let i = 0; i < SYNC_READY_MAX_RETRIES; i += 1) {
          await sleep(SYNC_READY_RETRY_MS)
          endpointMeta = await readEndpointMeta()
          authMeta = await this.extractRuntimeHints(hidden).catch(() => ({}))
          sid = (endpointMeta.sid || authMeta.sessionID || this.studentsRuntimeHints?.sid || '').replace(/^"+|"+$/g, '')
          version = endpointMeta.version || this.studentsRuntimeHints?.version || ''
          effectiveToken = authMeta?.token || this.studentsRuntimeHints?.token || ''
          if (sid && effectiveToken) break
        }
        console.log(`[students:sync][${trace}] ready-wait done in ${elapsed(waitReadyStarted)} sid=${Boolean(sid)} token=${Boolean(effectiveToken)}`)
      }

      const defaultHeaders: Record<string, string> = {
        Accept: 'application/json, text/plain, */*',
        Referer: STUDENTS_URL,
      }
      const capturedHeaders = this.studentsRuntimeHints?.capturedHeaders || {}
      ;['authorization', 'x-access-token', 'correlation-id', 'accept-language', 'cache-control', 'pragma']
        .forEach((key) => {
          const value = capturedHeaders[key]
          if (value) defaultHeaders[key] = value
        })
      if (cookieHeader) defaultHeaders.Cookie = cookieHeader
      const capturedToken = pickTokenFromHeaders(defaultHeaders)
      // Prefer live captured request headers over storage-derived token to avoid stale token 401.
      effectiveToken = capturedToken || effectiveToken
      if (effectiveToken && !defaultHeaders.authorization && !defaultHeaders.Authorization) {
        defaultHeaders.Authorization = effectiveToken.startsWith('Bearer ') ? effectiveToken : `Bearer ${effectiveToken}`
      }
      if (effectiveToken && !defaultHeaders['x-access-token'] && !defaultHeaders['X-Access-Token']) {
        defaultHeaders['x-access-token'] = effectiveToken
      }

      const requestFirstOk = async <T>(candidates: string[]) => {
        const errors: string[] = []
        for (const candidate of candidates) {
          const path = normalizePath(candidate)
          if (!path) continue
          const fullUrl = path.startsWith('http') ? path : new URL(path, STUDENTS_URL).toString()
          const response = await hidden.webContents.session.fetch(fullUrl, {
            method: 'GET',
            headers: defaultHeaders,
          })
          if (response.ok) {
            const data = await response.json() as T
            return { data, path }
          }
          errors.push(`${response.status}:${path}`)
        }
        if (errors.some((item) => item.startsWith('401:'))) {
          throw new Error(`Students 会话已过期(401):${errors.join(' | ')}`)
        }
        throw new Error(`all-candidates-failed:${errors.join(' | ')}`)
      }

      const apiBase = this.studentsRuntimeHints?.apiBase || STUDENTS_API_BASE
      this.studentsRuntimeHints = {
        sid: sid || this.studentsRuntimeHints?.sid || '',
        version: version || this.studentsRuntimeHints?.version || '',
        token: effectiveToken || this.studentsRuntimeHints?.token || '',
        apiBase,
        capturedHeaders: this.studentsRuntimeHints?.capturedHeaders || {},
        capturedApiUrl: this.studentsRuntimeHints?.capturedApiUrl || '',
        updatedAt: Date.now(),
      }

      if (!sid && !endpointMeta.currentsemester) {
        const hint = (authMeta?.keys || []).slice(0, 8).join(',')
        throw new Error(`Students 未检测到 sid，会话尚未就绪。storage keys: ${hint || 'none'}`)
      }
      if (!defaultHeaders.authorization && !defaultHeaders.Authorization) {
        const hintUrl = this.studentsRuntimeHints?.capturedApiUrl || 'none'
        throw new Error(`Students 未捕获到 Authorization，请先完成认证后停留2秒。capturedApiUrl:${hintUrl}`)
      }

      const currentSemesterStarted = now()
      const currentSemesterResp = await requestFirstOk<Array<{ semesterTechnion: string; semesterName: string; isCurrent: boolean }>>([
        endpointMeta.currentsemester || '',
        `${apiBase}/currentsemester?${buildQuery({ sid, v: version })}`,
        `${apiBase}/currentsemester`,
        `/currentsemester?${buildQuery({ sid, v: version })}`,
        `/api/currentsemester?${buildQuery({ sid, v: version })}`,
        '/currentsemester',
        '/api/currentsemester',
      ])
      console.log(`[students:sync][${trace}] currentsemester fetched in ${elapsed(currentSemesterStarted)}`)

      const semesters = Array.isArray(currentSemesterResp.data) ? currentSemesterResp.data : []
      const currentSemester = semesters.find((item) => item?.isCurrent) ?? null
      const semesterTechnion = currentSemester?.semesterTechnion ?? ''
      const semesterName = currentSemester?.semesterName ?? ''

      const dataFetchStarted = now()
      const [enrollmentsResp, examsResp, profileResp] = await Promise.all([
        requestFirstOk<Array<{ semesterTechnion: string; courseName: string; courseCode: string; credit: string }>>([
          endpointMeta.enrollments || '',
          `${apiBase}/enrollments?${buildQuery({ sid, v: version })}`,
          `${apiBase}/enrollments`,
          `/enrollments?${buildQuery({ sid, v: version })}`,
          `/api/enrollments?${buildQuery({ sid, v: version })}`,
          '/enrollments',
          '/api/enrollments',
        ]),
        requestFirstOk<Array<{ courseCode: string; courseName: string; examSession: string; date: string; time: string; duration: string; venues: string[] }>>([
          endpointMeta.exams
            ? `${normalizePath(endpointMeta.exams).split('?')[0]}?${buildQuery({ semesterTechnion, sid, v: version })}`
            : '',
          `${apiBase}/exams?${buildQuery({ semesterTechnion, sid, v: version })}`,
          `${apiBase}/exams?${buildQuery({ semesterTechnion })}`,
          `${apiBase}/exams`,
          `/exams?${buildQuery({ semesterTechnion, sid, v: version })}`,
          `/api/exams?${buildQuery({ semesterTechnion, sid, v: version })}`,
          `/exams?${buildQuery({ semesterTechnion })}`,
          `/api/exams?${buildQuery({ semesterTechnion })}`,
          '/exams',
          '/api/exams',
        ]),
        requestFirstOk<{ studentId?: string; programName?: string; chineseName?: string; pinyinName?: string; cohort?: string; gpa?: string; accumulatedCreditPoints?: string }>([
          endpointMeta.profile || '',
          `${apiBase}/profile?${buildQuery({ sid, v: version })}`,
          `${apiBase}/profile`,
          `/profile?${buildQuery({ sid, v: version })}`,
          `/api/profile?${buildQuery({ sid, v: version })}`,
          '/profile',
          '/api/profile',
        ]),
      ])
      console.log(`[students:sync][${trace}] enrollments/exams/profile fetched in ${elapsed(dataFetchStarted)}`)

      const text = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()
      const enrollments = Array.isArray(enrollmentsResp.data) ? enrollmentsResp.data : []
      const exams = Array.isArray(examsResp.data) ? examsResp.data : []
      const profile = profileResp.data && typeof profileResp.data === 'object' ? profileResp.data : null

      const currentCourses = enrollments
        .filter((item) => text(item.semesterTechnion) === text(semesterTechnion))
        .map((item) => ({
          name: text(item.courseName),
          code: text(item.courseCode),
          credits: Number(item.credit || 0),
        }))
        .filter((item, idx, arr) => idx === arr.findIndex((x) => x.code === item.code))

      const normalizedExams = exams.map((item) => ({
        code: text(item.courseCode),
        course: text(item.courseName),
        term: text(item.examSession),
        startTime: text(item.date) && text(item.time)
          ? text(item.date).replace('T00:00:00', '') + ' ' + text(item.time).slice(0, 5)
          : text(item.date || ''),
        duration: text(item.duration) ? text(item.duration) + ' hours' : '',
        venue: Array.isArray(item.venues) ? item.venues.map((v) => text(v)).join(', ') : text(item.venues || ''),
      }))

      const data = {
        currentUrl,
        semester: semesterName,
        semesterTechnion,
        courses: currentCourses,
        exams: normalizedExams,
        profile: profile
          ? {
              studentId: text(profile.studentId),
              programName: text(profile.programName),
              chineseName: text(profile.chineseName),
              pinyinName: text(profile.pinyinName),
              cohort: text(profile.cohort),
              gpa: text(profile.gpa),
              accumulatedCreditPoints: text(profile.accumulatedCreditPoints),
            }
          : null,
        capturedAt: new Date().toISOString(),
      }

      const courseDelta = this.db.upsertStudentsCourses(
        data.semester,
        data.semesterTechnion,
        data.courses.map((course) => ({
          code: course.code,
          name: course.name,
          credits: course.credits,
        })),
      )
      const examDelta = this.db.replaceStudentsExams(
        data.semesterTechnion,
        data.exams.map((exam) => {
          const [date = '', time = ''] = exam.startTime.split(' ')
          return {
            courseCode: exam.code,
            courseName: exam.course,
            examSession: exam.term,
            date,
            time,
            duration: exam.duration,
            venue: exam.venue,
          }
        }),
      )
      this.db.setMeta('sync:students:last', {
        at: new Date().toISOString(),
        semester: data.semester,
        semesterTechnion: data.semesterTechnion,
        courseCount: data.courses.length,
        examCount: data.exams.length,
        delta: {
          courses: courseDelta,
          exams: examDelta,
        },
      })
      if (data.profile) {
        this.db.setMeta('students:profile', data.profile)
      }

      const result = {
        ...data,
        delta: {
          courses: courseDelta,
          exams: examDelta,
        },
      }
      console.log(`[students:sync][${trace}] finish in ${elapsed(started)} courses=${result.courses.length} exams=${result.exams.length}`)
      return result
    } finally {
      if (!hidden.isDestroyed()) hidden.destroy()
    }
  }

  async clearSession() {
    const ses = session.fromPartition(STUDENTS_PARTITION)
    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
    })
    this.studentsRuntimeHints = null
    return true
  }
}

