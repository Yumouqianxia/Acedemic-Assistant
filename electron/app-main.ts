import { app, BrowserWindow, dialog, ipcMain, Menu, net, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { access, writeFile } from 'node:fs/promises'
import { autoUpdater } from 'electron-updater'
import { DashboardDb } from './dashboard-db'
import { MoodleService } from './services/moodle-service'
import { StudentsService } from './services/students-service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null = null
let dashboardDb: DashboardDb | null = null
let moodleService: MoodleService | null = null
let studentsService: StudentsService | null = null
let autoSyncTimer: NodeJS.Timeout | null = null
let autoSyncRunning = false
let updatePromptVisible = false
let updateDownloadStarted = false

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const AUTO_SYNC_CHECK_MS = 15 * 60 * 1000
const STUDENTS_RETRY_SETTLE_MS = 600
const CHECK_UPDATES_DELAY_MS = 15_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const now = () => Date.now()
const elapsed = (start: number) => `${Date.now() - start}ms`
const syncTag = () => `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const FILE_NAME_SAFE_RE = /[<>:"/\\|?*\u0000-\u001F]/g
const FORCE_DOWNLOAD_RE = /[?&]forcedownload=1(?:&|$)/i

function sanitizeFilename(name: string) {
  return name.replace(FILE_NAME_SAFE_RE, '_').trim() || `download-${Date.now()}`
}

async function pickAvailablePath(dir: string, filename: string) {
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  let candidate = path.join(dir, filename)
  let index = 1
  while (true) {
    try {
      await access(candidate)
      candidate = path.join(dir, `${base} (${index})${ext}`)
      index += 1
    } catch {
      return candidate
    }
  }
}

function shouldDownloadDirectly(fileUrl: string) {
  return FORCE_DOWNLOAD_RE.test(fileUrl)
}

async function downloadAndOpenRemoteFile(url: string, preferredFilename?: string) {
  const response = await net.fetch(url, { method: 'GET' })
  if (!response.ok) {
    throw new Error(`下载失败 (HTTP ${response.status})`)
  }
  const rawName = preferredFilename?.trim() || path.basename(new URL(url).pathname) || `download-${Date.now()}`
  const finalName = sanitizeFilename(rawName)
  const downloadDir = app.getPath('downloads')
  const outputPath = await pickAvailablePath(downloadDir, finalName)
  const bytes = await response.arrayBuffer()
  await writeFile(outputPath, Buffer.from(bytes))
  const openError = await shell.openPath(outputPath)
  if (openError) throw new Error(openError)
  return { filePath: outputPath }
}

const isStudentsNotReadyError = (message: string) => {
  const msg = message.toLowerCase()
  return msg.includes('未捕获到 authorization')
    || msg.includes('未检测到 sid')
    || msg.includes('session')
    || msg.includes('not ready')
}

const shouldRetryWithStudentsAuth = (message: string) => {
  const msg = message.toLowerCase()
  return msg.includes('当前未登录')
    || msg.includes('未登录')
    || msg.includes('未捕获到 authorization')
    || msg.includes('未检测到 sid')
}

function ensureServices() {
  if (!dashboardDb || !moodleService || !studentsService) {
    throw new Error('服务尚未初始化')
  }
  return { dashboardDb, moodleService, studentsService }
}

function createWindow() {
  // Remove the native menu bar entirely
  Menu.setApplicationMenu(null)

  win = new BrowserWindow({
    title: 'GTIIT Campus Dashboard',
    width: 1080,
    height: 780,
    minWidth: 860,
    minHeight: 600,
    frame: false,
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webviewTag: true,
    },
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function registerIpcHandlers() {
  const handle = <T extends any[]>(
    channel: string,
    listener: (event: Electron.IpcMainInvokeEvent, ...args: T) => unknown | Promise<unknown>,
  ) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, listener)
  }

  handle('ipc-test:ping', (_event, payload: string) => {
    return `pong from main: ${payload} @ ${new Date().toLocaleString()}`
  })

  handle('moodle:login', (_event, payload: { username: string; password: string; rememberPassword?: boolean }) => {
    return ensureServices().moodleService.login(payload)
  })
  handle('moodle:sync', (_event, payload?: { username?: string }) => {
    return ensureServices().moodleService.sync(payload)
  })
  handle('moodle:course:contents', (_event, payload: { courseId: number; username?: string }) => {
    return ensureServices().moodleService.courseContents(payload)
  })
  handle('moodle:profiles:list', () => ensureServices().moodleService.profilesList())
  handle('moodle:profile:remove', (_event, payload: { username: string }) => {
    return ensureServices().moodleService.profileRemove(payload)
  })
  handle('moodle:credential:get', (_event, payload: { username: string }) => {
    return ensureServices().moodleService.credentialGet(payload)
  })
  handle('moodle:logout', (_event, payload?: { username?: string }) => {
    return ensureServices().moodleService.logout(payload)
  })
  handle('moodle:sso-login', () => {
    return ensureServices().moodleService.loginViaSso(() => win)
  })
  // Compatibility alias for older/newer renderer bundles.
  handle('moodle:ssoLogin', () => {
    return ensureServices().moodleService.loginViaSso(() => win)
  })

  handle('students:authenticate', () => ensureServices().studentsService.authenticate())
  handle('students:sync', () => ensureServices().studentsService.sync())
  handle('students:session:clear', () => ensureServices().studentsService.clearSession())

  handle('dashboard:get', () => ensureServices().dashboardDb.getDashboardSnapshot())
  handle('dashboard:sync-all', async (_event, payload?: { username?: string; trigger?: 'manual' | 'login' | 'auto' }) => {
    const trace = syncTag()
    const startedAt = now()
    const trigger = payload?.trigger ?? 'manual'
    const { dashboardDb, moodleService, studentsService } = ensureServices()
    console.log(`[dashboard:sync-all][${trace}] start trigger=${trigger} username=${payload?.username ?? 'unknown'}`)
    const moodleStarted = now()
    const moodle = await moodleService.sync({ username: payload?.username })
    console.log(`[dashboard:sync-all][${trace}] moodle.sync done in ${elapsed(moodleStarted)}`)
    let students:
      | Awaited<ReturnType<StudentsService['sync']>>
      | null = null
    let studentsError: string | null = null

    const tryStudentsSync = async (
      label: string,
      options?: { discardRuntimeHints?: boolean; forceReload?: boolean },
    ) => {
      const s = now()
      console.log(`[dashboard:sync-all][${trace}] students.sync attempt=${label} begin`)
      students = await studentsService.sync({
        discardRuntimeHints: options?.discardRuntimeHints ?? false,
        forceReload: options?.forceReload ?? false,
      })
      console.log(`[dashboard:sync-all][${trace}] students.sync attempt=${label} success in ${elapsed(s)}`)
    }

    try {
      await tryStudentsSync('first')
    } catch (firstError) {
      const firstMsg = firstError instanceof Error ? firstError.message : String(firstError)
      console.warn(`[dashboard:sync-all][${trace}] students first attempt failed: ${firstMsg}`)
      const isNotReady = trigger === 'login' && isStudentsNotReadyError(firstMsg)

      if (isNotReady) {
        try {
          console.log(`[dashboard:sync-all][${trace}] students not-ready detected, warmup session then retry`)
          const warmup = await studentsService.warmupSession({
            forceReload: true,
            timeoutMs: 4500,
          })
          console.log(`[dashboard:sync-all][${trace}] warmup result ready=${warmup.ready} elapsed=${warmup.elapsedMs}ms`)
          await sleep(STUDENTS_RETRY_SETTLE_MS)
          await tryStudentsSync('after-warmup')
        } catch (retryAfterSettleError) {
          const retryMsg = retryAfterSettleError instanceof Error ? retryAfterSettleError.message : String(retryAfterSettleError)
          console.warn(`[dashboard:sync-all][${trace}] students retry-after-settle failed: ${retryMsg}`)
          if (trigger !== 'login' && shouldRetryWithStudentsAuth(retryMsg)) {
            try {
              const authStarted = now()
              console.log(`[dashboard:sync-all][${trace}] opening students auth window due to: ${retryMsg}`)
              const authResult = await studentsService.authenticate()
              console.log(`[dashboard:sync-all][${trace}] students authenticate done in ${elapsed(authStarted)} result=${authResult.authenticated ? 'ok' : `fail:${authResult.reason ?? 'unknown'}`}`)
              if (authResult.authenticated) {
                try {
                  await sleep(1000)
                  await tryStudentsSync('after-auth')
                } catch (retryError) {
                  studentsError = retryError instanceof Error ? retryError.message : String(retryError)
                }
              } else {
                studentsError = `Students 认证未完成（${authResult.reason ?? 'cancelled'}），数据未同步`
              }
            } catch (authError) {
              studentsError = authError instanceof Error ? authError.message : String(authError)
            }
          } else {
            studentsError = retryMsg
          }
        }
        if (students || studentsError) {
          return {
            trigger,
            at: new Date().toISOString(),
            moodle,
            students,
            studentsError,
          }
        }
      }

      if (trigger !== 'login' && shouldRetryWithStudentsAuth(firstMsg)) {
        // Auto-trigger the authentication window, then retry sync
        try {
          const authStarted = now()
          console.log(`[dashboard:sync-all][${trace}] opening students auth window due to first error`)
          const authResult = await studentsService.authenticate()
          console.log(`[dashboard:sync-all][${trace}] students authenticate done in ${elapsed(authStarted)} result=${authResult.authenticated ? 'ok' : `fail:${authResult.reason ?? 'unknown'}`}`)
          if (authResult.authenticated) {
            try {
              await sleep(1000)
              await tryStudentsSync('after-auth')
            } catch (retryError) {
              studentsError = retryError instanceof Error ? retryError.message : String(retryError)
            }
          } else {
            studentsError = `Students 认证未完成（${authResult.reason ?? 'cancelled'}），数据未同步`
          }
        } catch (authError) {
          studentsError = authError instanceof Error ? authError.message : String(authError)
        }
      } else {
        studentsError = firstMsg
      }
    }

    const result = {
      trigger,
      at: new Date().toISOString(),
      moodle,
      students,
      studentsError,
    }
    if (trigger === 'auto') {
      dashboardDb.setMeta('sync:auto:last', result)
    }
    console.log(`[dashboard:sync-all][${trace}] finish in ${elapsed(startedAt)} students=${students ? 'ok' : 'none'} studentsError=${studentsError ?? 'none'}`)
    return result
  })

  // ── Moodle Timeline & Submission ──────────────────────────────────────────
  handle('moodle:timeline', (_event, payload?: { username?: string; daysAhead?: number }) => {
    return ensureServices().moodleService.getTimeline(payload)
  })
  handle('moodle:assignment:detail', (_event, payload: { cmid: number; courseId: number; username?: string }) => {
    return ensureServices().moodleService.getAssignmentDetail(payload)
  })
  handle('moodle:assignment:detail-with-status', (_event, payload: { cmid: number; courseId: number; username?: string }) => {
    return ensureServices().moodleService.getAssignmentWithStatus(payload)
  })
  handle('moodle:assignment:submission-status', (_event, payload: { assignId: number; username?: string }) => {
    return ensureServices().moodleService.getSubmissionStatus(payload)
  })
  handle('moodle:assignment:upload-file', (_event, payload: { filePath: string; username?: string }) => {
    return ensureServices().moodleService.uploadFile(payload)
  })
  handle('moodle:assignment:save-submission', (_event, payload: { assignId: number; draftItemId: number; username?: string }) => {
    return ensureServices().moodleService.saveSubmission(payload)
  })

  // ── PDF / file viewer ─────────────────────────────────────────────────────
  handle('file:open-pdf', async (_event, payload: { url: string; title?: string }) => {
    if (!payload?.url) throw new Error('文件链接为空')
    if (shouldDownloadDirectly(payload.url)) {
      await downloadAndOpenRemoteFile(payload.url, payload.title)
      return true
    }
    // Some Moodle instances still respond with attachment content-disposition
    // even when forcedownload is not explicit in the URL.
    try {
      const headResp = await net.fetch(payload.url, { method: 'HEAD' })
      if (headResp.ok) {
        const contentDisposition = (headResp.headers.get('content-disposition') || '').toLowerCase()
        const contentType = (headResp.headers.get('content-type') || '').toLowerCase()
        const isAttachment = contentDisposition.includes('attachment')
        const isPdf = contentType.includes('pdf')
        if (isAttachment || (contentType && !isPdf)) {
          await downloadAndOpenRemoteFile(payload.url, payload.title)
          return true
        }
      }
    } catch {
      // If HEAD is not supported, continue with in-app preview.
    }
    const pdfWin = new BrowserWindow({
      width: 1100,
      height: 820,
      title: payload.title ?? 'File Viewer',
      autoHideMenuBar: true,
      webPreferences: {
        plugins: true,
      },
    })
    pdfWin.loadURL(payload.url)
    return true
  })
  handle('file:download-open', async (_event, payload: { url: string; filename?: string }) => {
    const url = payload?.url?.trim()
    if (!url) throw new Error('下载链接为空')
    return downloadAndOpenRemoteFile(url, payload?.filename)
  })

  // ── File dialog ───────────────────────────────────────────────────────────
  handle('dialog:open-file', async (_event, options?: Electron.OpenDialogOptions) => {
    if (!win) return { canceled: true, filePaths: [] }
    return dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      ...options,
    })
  })

  // Window controls
  handle('window:minimize', () => win?.minimize())
  handle('window:maximize', () => {
    if (win?.isMaximized()) win?.unmaximize()
    else win?.maximize()
  })
  handle('window:close', () => win?.close())
  handle('window:is-maximized', () => win?.isMaximized() ?? false)
}

function setupAutoUpdater() {
  if (VITE_DEV_SERVER_URL) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking for updates')
  })
  autoUpdater.on('update-available', async (info) => {
    console.log(`[updater] update available: ${info.version}`)
    if (updatePromptVisible || updateDownloadStarted) return
    updatePromptVisible = true
    try {
      const messageBoxOptions: Electron.MessageBoxOptions = {
        type: 'info',
        title: '发现新版本',
        message: `发现新版本 v${info.version}，是否立即更新？`,
        detail: '点击“立即更新”后将开始后台下载，下载完成后将在退出应用时自动安装。',
        buttons: ['稍后', '立即更新'],
        cancelId: 0,
        defaultId: 1,
        noLink: true,
      }
      const result = win
        ? await dialog.showMessageBox(win, messageBoxOptions)
        : await dialog.showMessageBox(messageBoxOptions)
      if (result.response === 1) {
        updateDownloadStarted = true
        void autoUpdater.downloadUpdate().catch((error) => {
          updateDownloadStarted = false
          console.error('[updater] download failed:', error)
        })
      } else {
        console.log('[updater] user postponed update download')
      }
    } catch (error) {
      console.error('[updater] failed to show update prompt:', error)
    } finally {
      updatePromptVisible = false
    }
  })
  autoUpdater.on('update-not-available', (info) => {
    console.log(`[updater] no updates. current target: ${info.version}`)
  })
  autoUpdater.on('download-progress', (progress) => {
    const percent = progress.percent.toFixed(1)
    console.log(`[updater] download ${percent}% (${Math.round(progress.bytesPerSecond / 1024)} KB/s)`)
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] update downloaded: ${info.version}, will install on quit`)
  })
  autoUpdater.on('error', (error) => {
    console.error('[updater] failed:', error)
  })

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((error) => {
      console.error('[updater] check failed:', error)
    })
  }, CHECK_UPDATES_DELAY_MS)
}

async function runAutoSyncIfDue() {
  if (autoSyncRunning) return
  const { dashboardDb, moodleService, studentsService } = ensureServices()
  if (!moodleService.hasActiveSession()) return
  const lastAuto = dashboardDb.getMetaValue('sync:auto:last') as { at?: string } | null
  const lastMoodle = dashboardDb.getMetaValue('sync:moodle:last') as { at?: string } | null
  const lastAt = [lastAuto?.at, lastMoodle?.at]
    .map((value) => (value ? new Date(value).getTime() : 0))
    .reduce((max, current) => (current > max ? current : max), 0)
  if (lastAt && Date.now() - lastAt < ONE_DAY_MS) return

  autoSyncRunning = true
  try {
    const moodle = await moodleService.sync()
    let students: Awaited<ReturnType<StudentsService['sync']>> | null = null
    let studentsError: string | null = null
    try {
      students = await studentsService.sync()
    } catch (error) {
      studentsError = error instanceof Error ? error.message : String(error)
    }
    dashboardDb.setMeta('sync:auto:last', {
      trigger: 'auto',
      at: new Date().toISOString(),
      moodle,
      students,
      studentsError,
    })
  } catch (error) {
    dashboardDb.setMeta('sync:auto:last', {
      trigger: 'auto',
      at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    autoSyncRunning = false
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (autoSyncTimer) {
      clearInterval(autoSyncTimer)
      autoSyncTimer = null
    }
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'dashboard.sqlite')
  dashboardDb = new DashboardDb(dbPath)
  moodleService = new MoodleService(dashboardDb)
  studentsService = new StudentsService(dashboardDb, () => win)
  studentsService.installRequestSniffer()

  registerIpcHandlers()
  void runAutoSyncIfDue()
  autoSyncTimer = setInterval(() => {
    void runAutoSyncIfDue()
  }, AUTO_SYNC_CHECK_MS)
  createWindow()
  setupAutoUpdater()
}).catch((error) => {
  console.error('[main] app init failed:', error)
})

