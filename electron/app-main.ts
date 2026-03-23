import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
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

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const AUTO_SYNC_CHECK_MS = 15 * 60 * 1000

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
  ipcMain.handle('ipc-test:ping', (_event, payload: string) => {
    return `pong from main: ${payload} @ ${new Date().toLocaleString()}`
  })

  ipcMain.handle('moodle:login', (_event, payload: { username: string; password: string; rememberPassword?: boolean }) => {
    return ensureServices().moodleService.login(payload)
  })
  ipcMain.handle('moodle:sync', (_event, payload?: { username?: string }) => {
    return ensureServices().moodleService.sync(payload)
  })
  ipcMain.handle('moodle:course:contents', (_event, payload: { courseId: number; username?: string }) => {
    return ensureServices().moodleService.courseContents(payload)
  })
  ipcMain.handle('moodle:profiles:list', () => ensureServices().moodleService.profilesList())
  ipcMain.handle('moodle:profile:remove', (_event, payload: { username: string }) => {
    return ensureServices().moodleService.profileRemove(payload)
  })
  ipcMain.handle('moodle:credential:get', (_event, payload: { username: string }) => {
    return ensureServices().moodleService.credentialGet(payload)
  })
  ipcMain.handle('moodle:logout', (_event, payload?: { username?: string }) => {
    return ensureServices().moodleService.logout(payload)
  })
  ipcMain.handle('moodle:sso-login', () => {
    return ensureServices().moodleService.loginViaSso(() => win)
  })

  ipcMain.handle('students:authenticate', () => ensureServices().studentsService.authenticate())
  ipcMain.handle('students:sync', () => ensureServices().studentsService.sync())
  ipcMain.handle('students:session:clear', () => ensureServices().studentsService.clearSession())

  ipcMain.handle('dashboard:get', () => ensureServices().dashboardDb.getDashboardSnapshot())
  ipcMain.handle('dashboard:sync-all', async (_event, payload?: { username?: string; trigger?: 'manual' | 'login' | 'auto' }) => {
    const trigger = payload?.trigger ?? 'manual'
    const { dashboardDb, moodleService, studentsService } = ensureServices()
    const moodle = await moodleService.sync({ username: payload?.username })
    let students:
      | Awaited<ReturnType<StudentsService['sync']>>
      | null = null
    let studentsError: string | null = null

    const tryStudentsSync = async () => {
      students = await studentsService.sync()
    }

    try {
      await tryStudentsSync()
    } catch (firstError) {
      const firstMsg = firstError instanceof Error ? firstError.message : String(firstError)
      const isNotLoggedIn = firstMsg.includes('当前未登录') || firstMsg.includes('未登录')

      if (isNotLoggedIn) {
        // Auto-trigger the authentication window, then retry sync
        try {
          const authResult = await studentsService.authenticate()
          if (authResult.authenticated) {
            try {
              await tryStudentsSync()
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
    return result
  })

  // Window controls
  ipcMain.handle('window:minimize', () => win?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (win?.isMaximized()) win?.unmaximize()
    else win?.maximize()
  })
  ipcMain.handle('window:close', () => win?.close())
  ipcMain.handle('window:is-maximized', () => win?.isMaximized() ?? false)
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
}).catch((error) => {
  console.error('[main] app init failed:', error)
})

