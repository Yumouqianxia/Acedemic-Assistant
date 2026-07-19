import { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, shell, Tray } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { access, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { autoUpdater } from 'electron-updater'
import { DashboardDb } from './dashboard-db'
import { MoodleService } from './services/moodle-service'
import { StudentsService } from './services/students-service'
import { TranscriptService } from './services/transcript-service'
import { NotebookService, type NotebookCourse } from './notebook-service'
import { StudyDb, type StudyTaskInput } from './study-db'
import { csvTasksContent, csvTemplateContent, parseStudyTaskCsv, type CsvTaskRow } from './study-csv-service'
import { buildStudyCalendarHtml } from './study-calendar-pdf'

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
let transcriptService: TranscriptService | null = null
let notebookService: NotebookService | null = null
let studyDb: StudyDb | null = null
let autoSyncTimer: NodeJS.Timeout | null = null
let studyAlertTimer: NodeJS.Timeout | null = null
let tray: Tray | null = null
let isQuitting = false
let autoSyncRunning = false
let updatePromptVisible = false
let updateDownloadStarted = false
let updateLastProgressPercent = 0
const downloadedFileCache = new Map<string, string>()
const inFlightDownloadTasks = new Map<string, Promise<{ filePath: string }>>()

const AUTO_SYNC_CHECK_MS = 15 * 60 * 1000
const CHECK_UPDATES_DELAY_MS = 15_000
const STUDY_ALERT_CHECK_MS = 15_000
const DOWNLOAD_CACHE_SUBDIR = 'CampusDashboardCache'
const PREF_KEY = 'app:preferences'
const STUDENTS_SYNC_DISABLED_MESSAGE = 'Students sync is disabled for account safety. Import an official transcript instead.'

type ThemeMode = 'light' | 'dark' | 'system'
type Language = 'zh-CN' | 'en-US'
type AutoSyncIntervalHours = 0 | 6 | 24
type AppPreferences = {
  language: Language
  themeMode: ThemeMode
  autoSyncIntervalHours: AutoSyncIntervalHours
  downloadDirectory: string | null
}

type CourseDownloadResource = {
  sectionName: string
  moduleName: string
  filename: string
  fileurl: string
}

type UpdaterStatusPayload = {
  status: 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'not-available' | 'error'
  version?: string
  percent?: number
  message: string
}

const DEFAULT_PREFERENCES: AppPreferences = {
  language: 'zh-CN',
  themeMode: 'system',
  autoSyncIntervalHours: 24,
  downloadDirectory: null,
}

const now = () => Date.now()
const elapsed = (start: number) => `${Date.now() - start}ms`
const syncTag = () => `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const FILE_NAME_SAFE_RE = /[<>:"/\\|?*\u0000-\u001F]/g
const FORCE_DOWNLOAD_RE = /[?&]forcedownload=1(?:&|$)/i

function getAppIconPath() {
  if (process.platform === 'win32') {
    return path.join(process.env.APP_ROOT, 'build', 'icons', 'icon.ico')
  }
  if (process.platform === 'linux') {
    return path.join(process.env.APP_ROOT, 'build', 'icons', '512x512.png')
  }
  return path.join(process.env.VITE_PUBLIC, 'electron-vite.svg')
}

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

function buildDownloadCacheKey(url: string, preferredFilename?: string) {
  return `${url.trim()}::${(preferredFilename ?? '').trim()}`
}

async function openLocalFile(filePath: string) {
  const openError = await shell.openPath(filePath)
  if (openError) throw new Error(openError)
}

async function downloadAndOpenRemoteFile(
  url: string,
  preferredFilename?: string,
  options?: { reuseExisting?: boolean },
) {
  const cacheKey = buildDownloadCacheKey(url, preferredFilename)
  const reuseExisting = options?.reuseExisting ?? false
  const rawName = preferredFilename?.trim() || path.basename(new URL(url).pathname) || `download-${Date.now()}`
  const finalName = sanitizeFilename(rawName)
  const downloadDir = reuseExisting ? getPreviewCacheDir() : getDownloadBaseDir()
  await ensureDirectory(downloadDir)
  const reusableOutputPath = path.join(downloadDir, finalName)

  if (reuseExisting) {
    const cachedPath = downloadedFileCache.get(cacheKey)
    if (cachedPath) {
      try {
        await access(cachedPath)
        await openLocalFile(cachedPath)
        return { filePath: cachedPath }
      } catch {
        downloadedFileCache.delete(cacheKey)
      }
    }

    try {
      await access(reusableOutputPath)
      downloadedFileCache.set(cacheKey, reusableOutputPath)
      await openLocalFile(reusableOutputPath)
      return { filePath: reusableOutputPath }
    } catch {
      // file not found; continue to download
    }
  }

  if (reuseExisting) {
    const inFlightTask = inFlightDownloadTasks.get(cacheKey)
    if (inFlightTask) {
      const { filePath } = await inFlightTask
      await openLocalFile(filePath)
      return { filePath }
    }
  }

  const downloadTask = (async () => {
    const response = await net.fetch(url, { method: 'GET' })
    if (!response.ok) {
      throw new Error(`下载失败 (HTTP ${response.status})`)
    }
    const outputPath = reuseExisting
      ? reusableOutputPath
      : await pickAvailablePath(downloadDir, finalName)
    const bytes = await response.arrayBuffer()
    await writeFile(outputPath, Buffer.from(bytes))
    if (reuseExisting) downloadedFileCache.set(cacheKey, outputPath)
    return { filePath: outputPath }
  })()

  if (reuseExisting) inFlightDownloadTasks.set(cacheKey, downloadTask)

  try {
    const { filePath } = await downloadTask
    await openLocalFile(filePath)
    return { filePath }
  } finally {
    if (reuseExisting) inFlightDownloadTasks.delete(cacheKey)
  }
}

async function downloadCourseResources(payload: {
  targetDirectory: string
  courseName: string
  courseCode: string
  resources: CourseDownloadResource[]
}) {
  const targetDirectory = payload.targetDirectory?.trim()
  if (!targetDirectory) throw new Error('下载目录为空')
  const resources = Array.isArray(payload.resources) ? payload.resources : []
  if (!resources.length) throw new Error('没有可下载的课件资源')

  const courseFolderName = sanitizeFilename(
    [payload.courseCode, payload.courseName].filter(Boolean).join(' - ') || 'Moodle Course',
  )
  const courseDir = path.join(targetDirectory, courseFolderName)
  await ensureDirectory(courseDir)

  const results: Array<{
    filename: string
    filePath: string | null
    ok: boolean
    error?: string
  }> = []

  for (const resource of resources) {
    const sectionName = sanitizeFilename(resource.sectionName || 'Uncategorized')
    const sectionDir = path.join(courseDir, sectionName)
    await ensureDirectory(sectionDir)
    const filename = sanitizeFilename(resource.filename || path.basename(new URL(resource.fileurl).pathname) || 'resource')
    try {
      const response = await net.fetch(resource.fileurl, { method: 'GET' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const outputPath = await pickAvailablePath(sectionDir, filename)
      const bytes = await response.arrayBuffer()
      await writeFile(outputPath, Buffer.from(bytes))
      results.push({ filename, filePath: outputPath, ok: true })
    } catch (error) {
      results.push({
        filename,
        filePath: null,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    courseDir,
    total: resources.length,
    succeeded: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  }
}

function ensureServices() {
  if (!dashboardDb || !moodleService || !studentsService || !transcriptService) {
    throw new Error('服务尚未初始化')
  }
  return { dashboardDb, moodleService, studentsService, transcriptService }
}

function ensureNotebookService() {
  if (!notebookService) throw new Error('Notebook service is not ready')
  return notebookService
}

function ensureStudyDb() {
  if (!studyDb) throw new Error('Study planner is not ready')
  return studyDb
}

function validateStudyTaskInput(input: StudyTaskInput) {
  const title = input?.title?.trim()
  const scheduledDate = input?.scheduledDate?.trim()
  if (!title) throw new Error('Task title is required')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) throw new Error('A valid task date is required')
  const estimatedMinutes = Math.min(720, Math.max(1, Math.round(Number(input.estimatedMinutes) || 50)))
  const priority = input.priority === 1 || input.priority === 3 ? input.priority : 2
  return {
    ...input,
    title,
    scheduledDate,
    courseKey: input.courseKey?.trim() ?? '',
    courseName: input.courseName?.trim() ?? '',
    description: input.description?.trim() ?? '',
    startTime: /^\d{2}:\d{2}$/.test(input.startTime ?? '') ? input.startTime : '',
    estimatedMinutes,
    priority,
    noteId: input.noteId?.trim() || null,
    reminderAt: input.reminderAt || null,
  } satisfies StudyTaskInput
}

function checkStudyAlerts() {
  if (!studyDb) return
  const due = studyDb.consumeDueAlerts(new Date().toISOString())
  for (const task of due.tasks) {
    const body = [task.courseName, task.startTime ? `Start at ${task.startTime}` : 'Scheduled for today']
      .filter(Boolean)
      .join(' · ')
    if (Notification.isSupported()) {
      const notification = new Notification({ title: task.title, body })
      notification.on('click', showMainWindow)
      notification.show()
    }
    win?.webContents.send('study:alert', { type: 'task', task })
  }
  if (due.focus) {
    const isBreak = due.focus.mode === 'break'
    const title = isBreak ? 'Break finished' : 'Focus session finished'
    const body = isBreak ? 'Ready for the next study session?' : `${due.focus.label} is complete.`
    if (Notification.isSupported()) {
      const notification = new Notification({ title, body })
      notification.on('click', showMainWindow)
      notification.show()
    }
    win?.webContents.send('study:alert', { type: 'focus', session: due.focus })
  }
}

function normalizeNotebookCourse(course: NotebookCourse): NotebookCourse {
  if (!course?.courseKey?.trim()) throw new Error('Invalid course key')
  const courseKey = course.courseKey.trim()
  const courseCode = course.courseCode?.trim() || courseKey
  const courseName = course.courseName?.trim() || courseCode
  return { courseKey, courseCode, courseName }
}

function normalizePreferences(raw: unknown): AppPreferences {
  const obj = raw && typeof raw === 'object' ? raw as Partial<AppPreferences> : {}
  const language: Language = obj.language === 'en-US' ? 'en-US' : 'zh-CN'
  const themeMode: ThemeMode = obj.themeMode === 'light' || obj.themeMode === 'dark' || obj.themeMode === 'system'
    ? obj.themeMode
    : 'system'
  const autoSyncIntervalHours: AutoSyncIntervalHours = obj.autoSyncIntervalHours === 0 || obj.autoSyncIntervalHours === 6 || obj.autoSyncIntervalHours === 24
    ? obj.autoSyncIntervalHours
    : 24
  const downloadDirectory = typeof obj.downloadDirectory === 'string' && obj.downloadDirectory.trim()
    ? obj.downloadDirectory.trim()
    : null
  return {
    ...DEFAULT_PREFERENCES,
    language,
    themeMode,
    autoSyncIntervalHours,
    downloadDirectory,
  }
}

function getAppPreferences() {
  const value = ensureServices().dashboardDb.getMetaValue(PREF_KEY)
  return normalizePreferences(value)
}

function updateAppPreferences(patch: Partial<AppPreferences>) {
  const merged = normalizePreferences({ ...getAppPreferences(), ...patch })
  ensureServices().dashboardDb.setMeta(PREF_KEY, merged)
  return merged
}

function getDownloadBaseDir() {
  const pref = getAppPreferences()
  return pref.downloadDirectory || app.getPath('downloads')
}

function getPreviewCacheDir() {
  return path.join(getDownloadBaseDir(), DOWNLOAD_CACHE_SUBDIR)
}

async function ensureDirectory(dirPath: string) {
  await mkdir(dirPath, { recursive: true })
}

function getAutoSyncIntervalMs() {
  const hours = getAppPreferences().autoSyncIntervalHours
  if (!hours) return null
  return hours * 60 * 60 * 1000
}

function createWindow() {
  // Remove the native menu bar entirely
  Menu.setApplicationMenu(null)
  const isMac = process.platform === 'darwin'

  win = new BrowserWindow({
    title: 'GTIIT Campus Dashboard',
    width: 1080,
    height: 780,
    minWidth: 860,
    minHeight: 600,
    frame: !isMac ? false : true,
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const } : {}),
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webviewTag: true,
    },
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win?.hide()
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function showMainWindow() {
  if (!win || win.isDestroyed()) createWindow()
  win?.show()
  win?.focus()
}

function createTray() {
  if (tray) return
  tray = new Tray(getAppIconPath())
  tray.setToolTip('GTIIT Campus Dashboard')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Campus Dashboard', click: showMainWindow },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ]))
  tray.on('double-click', showMainWindow)
}

function sendUpdaterStatus(payload: UpdaterStatusPayload) {
  win?.webContents.send('updater:status', payload)
}

function resetUpdateProgressUi() {
  win?.setProgressBar(-1)
  if (win) win.setTitle('GTIIT Campus Dashboard - Installing update')
  updateLastProgressPercent = 0
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
  handle('app:platform', () => process.platform)
  handle('app:get-version', () => app.getVersion())
  handle('app:preferences:get', () => getAppPreferences())
  handle('app:preferences:update', (_event, payload?: Partial<AppPreferences>) => {
    if (!payload || typeof payload !== 'object') return getAppPreferences()
    return updateAppPreferences(payload)
  })

  handle('notebook:course:get', (_event, payload: { course: NotebookCourse }) => {
    return ensureNotebookService().getCourse({ course: normalizeNotebookCourse(payload.course) })
  })
  handle('notebook:note:create-markdown', (_event, payload: { course: NotebookCourse; title: string }) => {
    return ensureNotebookService().createMarkdown({
      course: normalizeNotebookCourse(payload.course),
      title: payload.title,
    })
  })
  handle('notebook:note:import-html', (_event, payload: { course: NotebookCourse; filePath: string }) => {
    return ensureNotebookService().importHtml({
      course: normalizeNotebookCourse(payload.course),
      filePath: payload.filePath,
    })
  })
  handle('notebook:notes:import-html', (_event, payload: { course: NotebookCourse; filePaths: string[] }) => {
    return ensureNotebookService().importHtmlFiles({
      course: normalizeNotebookCourse(payload.course),
      filePaths: Array.isArray(payload.filePaths) ? payload.filePaths : [],
    })
  })
  handle('notebook:notes:import-html-directory', (_event, payload: { course: NotebookCourse; directory: string }) => {
    return ensureNotebookService().importHtmlDirectory({
      course: normalizeNotebookCourse(payload.course),
      directory: payload.directory,
    })
  })
  handle('notebook:note:read', (_event, payload: { course: NotebookCourse; noteId: string }) => {
    return ensureNotebookService().readNote({
      course: normalizeNotebookCourse(payload.course),
      noteId: payload.noteId,
    })
  })
  handle('notebook:note:save-markdown', (_event, payload: { course: NotebookCourse; noteId: string; title: string; source: string }) => {
    return ensureNotebookService().saveMarkdown({
      course: normalizeNotebookCourse(payload.course),
      noteId: payload.noteId,
      title: payload.title,
      source: payload.source,
    })
  })
  handle('notebook:note:render', (_event, payload: { course: NotebookCourse; noteId: string }) => {
    return ensureNotebookService().renderNote({
      course: normalizeNotebookCourse(payload.course),
      noteId: payload.noteId,
    })
  })
  handle('notebook:course:render', (_event, payload: { course: NotebookCourse }) => {
    return ensureNotebookService().renderCourse({ course: normalizeNotebookCourse(payload.course) })
  })
  handle('notebook:note:rename', (_event, payload: { course: NotebookCourse; noteId: string; title: string }) => {
    return ensureNotebookService().renameNote({
      course: normalizeNotebookCourse(payload.course),
      noteId: payload.noteId,
      title: payload.title,
    })
  })
  handle('notebook:note:delete', (_event, payload: { course: NotebookCourse; noteId: string }) => {
    return ensureNotebookService().deleteNote({
      course: normalizeNotebookCourse(payload.course),
      noteId: payload.noteId,
    })
  })
  handle('notebook:sources:sync', (_event, payload: { course: NotebookCourse; noteIds?: string[] }) => {
    return ensureNotebookService().syncSources({
      course: normalizeNotebookCourse(payload.course),
      noteIds: payload.noteIds,
    })
  })
  handle('notebook:notes:reorder', (_event, payload: { course: NotebookCourse; noteIds: string[] }) => {
    return ensureNotebookService().reorderNotes({
      course: normalizeNotebookCourse(payload.course),
      noteIds: payload.noteIds,
    })
  })
  handle('notebook:note:open', (_event, payload: { course: NotebookCourse; noteId: string }) => {
    return ensureNotebookService().openNote({
      course: normalizeNotebookCourse(payload.course),
      noteId: payload.noteId,
    })
  })
  handle('notebook:course:open', (_event, payload: { course: NotebookCourse }) => {
    return ensureNotebookService().openCourse({ course: normalizeNotebookCourse(payload.course) })
  })
  handle('notebook:course:open-folder', (_event, payload: { course: NotebookCourse }) => {
    return ensureNotebookService().openCourseFolder({ course: normalizeNotebookCourse(payload.course) })
  })

  handle('study:tasks:list', (_event, payload: { fromDate: string; toDate: string }) => {
    return ensureStudyDb().listTasks(payload.fromDate, payload.toDate)
  })
  handle('study:task:create', (_event, payload: StudyTaskInput) => {
    return ensureStudyDb().createTask(validateStudyTaskInput(payload))
  })
  handle('study:task:update', (_event, payload: { id: number; patch: Partial<StudyTaskInput & { status: 'todo' | 'done' }> }) => {
    const current = ensureStudyDb().getTask(payload.id)
    if (!current) throw new Error('Study task not found')
    const merged = validateStudyTaskInput({ ...current, ...payload.patch })
    return ensureStudyDb().updateTask(payload.id, { ...merged, status: payload.patch.status })
  })
  handle('study:task:delete', (_event, payload: { id: number }) => {
    return ensureStudyDb().deleteTask(payload.id)
  })
  handle('study:csv:save-template', async () => {
    const options = {
      title: 'Save study task CSV template',
      defaultPath: 'study-tasks-template.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { canceled: true, filePath: null }
    await writeFile(result.filePath, csvTemplateContent(), 'utf8')
    return { canceled: false, filePath: result.filePath }
  })
  handle('study:csv:export', async () => {
    const options = {
      title: 'Export study tasks',
      defaultPath: 'study-tasks-export.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { canceled: true, filePath: null, count: 0 }
    const courses = ensureServices().dashboardDb.getDashboardSnapshot().courses
    const tasks = ensureStudyDb().listTasks('0000-01-01', '9999-12-31').map((task) => ({
      ...task,
      courseCode: courses.find((course) => course.courseKey === task.courseKey)?.courseCode ?? '',
    }))
    await writeFile(result.filePath, csvTasksContent(tasks), 'utf8')
    return { canceled: false, filePath: result.filePath, count: tasks.length }
  })
  handle('study:calendar:export-pdf', async () => {
    const tasks = ensureStudyDb().listTasks('0000-01-01', '9999-12-31')
    if (!tasks.length) throw new Error('Add at least one study task before exporting a calendar.')
    const result = win
      ? await dialog.showSaveDialog(win, {
          title: 'Export study calendar PDF',
          defaultPath: 'study-calendar.pdf',
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
      : await dialog.showSaveDialog({
          title: 'Export study calendar PDF',
          defaultPath: 'study-calendar.pdf',
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
    if (result.canceled || !result.filePath) return { canceled: true, filePath: null, count: 0 }

    const printWindow = new BrowserWindow({
      show: false,
      width: 1123,
      height: 794,
      webPreferences: { sandbox: true },
    })
    try {
      const html = buildStudyCalendarHtml(tasks)
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const pdf = await printWindow.webContents.printToPDF({
        landscape: true,
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        preferCSSPageSize: true,
      })
      await writeFile(result.filePath, pdf)
      return { canceled: false, filePath: result.filePath, count: tasks.length }
    } finally {
      if (!printWindow.isDestroyed()) printWindow.destroy()
    }
  })
  handle('study:csv:preview', async (_event, payload: { filePath: string }) => {
    const preview = await parseStudyTaskCsv(payload.filePath)
    const courses = ensureServices().dashboardDb.getDashboardSnapshot().courses
    preview.rows = preview.rows.map((row) => {
      const match = courses.find((course) =>
        (row.courseCode && course.courseCode.toLowerCase() === row.courseCode.toLowerCase())
        || (row.courseName && course.courseName.toLowerCase() === row.courseName.toLowerCase()),
      )
      if (match) {
        row.courseKey = match.courseKey
        row.courseName = match.courseName
      } else if (row.courseCode) {
        row.warnings.push(`course_code ${row.courseCode} was not found; course name will be kept as text`)
      }
      if (row.id && !ensureStudyDb().getTask(row.id)) {
        row.errors.push(`task id ${row.id} does not exist`)
      }
      if (!row.id && !row.errors.length) {
        const duplicate = ensureStudyDb().findDuplicateTask(row)
        if (duplicate) {
          row.warnings.push(`possible duplicate of task ${duplicate.id}`)
          row.action = 'skip'
        }
      }
      if (row.errors.length) row.action = 'invalid'
      return row
    })
    return preview
  })
  handle('study:csv:commit', (_event, payload: {
    fileName: string
    rows: CsvTaskRow[]
    duplicateStrategy: 'skip' | 'update' | 'create'
  }) => {
    const validRows = payload.rows.filter((row) => !row.errors?.length).map((row) => ({
      ...validateStudyTaskInput(row),
      ...(row.id ? { id: row.id } : {}),
    }))
    return ensureStudyDb().importTasks({
      rows: validRows,
      fileName: payload.fileName || 'study-tasks.csv',
      duplicateStrategy: payload.duplicateStrategy === 'update' || payload.duplicateStrategy === 'create'
        ? payload.duplicateStrategy
        : 'skip',
    })
  })
  handle('study:csv:undo', (_event, payload: { batchId: string }) => ensureStudyDb().undoImport(payload.batchId))
  handle('study:tasks:bulk-update', (_event, payload: {
    ids: number[]
    operation: 'complete' | 'reopen' | 'move-days' | 'priority' | 'duration' | 'delete'
    value?: number
  }) => ensureStudyDb().bulkUpdateTasks(payload))
  handle('study:exams:list', () => ensureStudyDb().listPersonalExams())
  handle('study:exam:create', (_event, payload: {
    courseKey?: string
    courseName?: string
    examSession?: string
    startsAt?: string
    durationMinutes?: number
    venue?: string
  }) => {
    const courseName = payload.courseName?.trim()
    const startsAt = payload.startsAt?.trim()
    if (!courseName) throw new Error('Exam course name is required')
    if (!startsAt || Number.isNaN(new Date(startsAt).getTime())) throw new Error('A valid exam date is required')
    return ensureStudyDb().createPersonalExam({
      courseKey: payload.courseKey?.trim() ?? '',
      courseName,
      examSession: payload.examSession?.trim() || 'A',
      startsAt,
      durationMinutes: Math.min(720, Math.max(1, Math.round(Number(payload.durationMinutes) || 180))),
      venue: payload.venue?.trim() ?? '',
    })
  })
  handle('study:exam:delete', (_event, payload: { id: number }) => ensureStudyDb().deletePersonalExam(payload.id))
  handle('study:focus:get-active', () => ensureStudyDb().getActiveFocus() ?? null)
  handle('study:focus:start', (_event, payload: { taskId?: number | null; label?: string; mode?: 'focus' | 'break'; durationSeconds?: number }) => {
    const durationSeconds = Math.min(4 * 60 * 60, Math.max(60, Math.round(Number(payload.durationSeconds) || 25 * 60)))
    return ensureStudyDb().startFocus({
      taskId: payload.taskId ?? null,
      label: payload.label?.trim() || (payload.mode === 'break' ? 'Break' : 'Focus session'),
      mode: payload.mode === 'break' ? 'break' : 'focus',
      durationSeconds,
    })
  })
  handle('study:focus:stop', (_event, payload?: { status?: 'completed' | 'cancelled' }) => {
    return ensureStudyDb().stopFocus(payload?.status === 'completed' ? 'completed' : 'cancelled')
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

  handle('students:authenticate', () => {
    throw new Error(STUDENTS_SYNC_DISABLED_MESSAGE)
  })
  handle('students:sync', () => {
    throw new Error(STUDENTS_SYNC_DISABLED_MESSAGE)
  })
  handle('students:transcript:import-pdf', (_event, payload: { filePath: string }) => {
    return ensureServices().transcriptService.importPdf(payload)
  })
  handle('students:session:clear', () => ensureServices().studentsService.clearSession())

  handle('dashboard:get', () => ensureServices().dashboardDb.getDashboardSnapshot())
  handle('dashboard:sync-all', async (_event, payload?: { username?: string; trigger?: 'manual' | 'login' | 'auto' }) => {
    const trace = syncTag()
    const startedAt = now()
    const trigger = payload?.trigger ?? 'manual'
    const { dashboardDb, moodleService } = ensureServices()
    console.log(`[dashboard:sync-all][${trace}] start trigger=${trigger} username=${payload?.username ?? 'unknown'} students=disabled`)
    const moodleStarted = now()
    const moodle = await moodleService.sync({ username: payload?.username })
    console.log(`[dashboard:sync-all][${trace}] moodle.sync done in ${elapsed(moodleStarted)}`)

    const result = {
      trigger,
      at: new Date().toISOString(),
      moodle,
      students: null,
      studentsError: STUDENTS_SYNC_DISABLED_MESSAGE,
    }
    if (trigger === 'auto') {
      dashboardDb.setMeta('sync:auto:last', result)
    }
    console.log(`[dashboard:sync-all][${trace}] finish in ${elapsed(startedAt)} students=disabled`)
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
      await downloadAndOpenRemoteFile(payload.url, payload.title, { reuseExisting: true })
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
          await downloadAndOpenRemoteFile(payload.url, payload.title, { reuseExisting: true })
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
  handle('file:download-course-resources', async (_event, payload: {
    targetDirectory: string
    courseName: string
    courseCode: string
    resources: CourseDownloadResource[]
  }) => {
    return downloadCourseResources(payload)
  })
  handle('file:get-download-directory', () => getDownloadBaseDir())
  handle('file:set-download-directory', async (_event, payload: { directory: string | null }) => {
    const directory = typeof payload?.directory === 'string' && payload.directory.trim()
      ? payload.directory.trim()
      : null
    if (directory) await ensureDirectory(directory)
    const next = updateAppPreferences({ downloadDirectory: directory })
    return {
      directory: next.downloadDirectory || app.getPath('downloads'),
      isDefault: !next.downloadDirectory,
    }
  })
  handle('file:clear-preview-cache', async () => {
    const cacheDir = getPreviewCacheDir()
    let removed = 0
    try {
      const entries = await readdir(cacheDir, { withFileTypes: true })
      await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(cacheDir, entry.name)
        await rm(fullPath, { recursive: true, force: true })
        removed += 1
      }))
    } catch {
      removed = 0
    }
    downloadedFileCache.clear()
    inFlightDownloadTasks.clear()
    return { removed }
  })

  // ── File dialog ───────────────────────────────────────────────────────────
  handle('dialog:open-file', async (_event, options?: Electron.OpenDialogOptions) => {
    if (!win) return { canceled: true, filePaths: [] }
    return dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      ...options,
    })
  })
  handle('dialog:open-directory', async (_event, options?: Electron.OpenDialogOptions) => {
    if (!win) return { canceled: true, filePaths: [] }
    return dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      ...options,
    })
  })

  handle('updater:check-now', async () => {
    if (VITE_DEV_SERVER_URL) {
      return {
        status: 'disabled',
        message: '开发模式下不可检查更新',
        currentVersion: app.getVersion(),
      }
    }
    try {
      const result = await autoUpdater.checkForUpdates()
      const nextVersion = result?.updateInfo?.version ?? app.getVersion()
      const hasUpdate = nextVersion !== app.getVersion()
      return {
        status: hasUpdate ? 'available' : 'up-to-date',
        message: hasUpdate ? `发现新版本 v${nextVersion}` : '当前已是最新版本',
        currentVersion: app.getVersion(),
        nextVersion,
      }
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        currentVersion: app.getVersion(),
      }
    }
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


function setupAutoUpdaterV2() {
  if (VITE_DEV_SERVER_URL) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking for updates')
    sendUpdaterStatus({
      status: 'checking',
      message: 'Checking for updates...',
    })
  })

  autoUpdater.on('update-available', async (info) => {
    console.log(`[updater] update available: ${info.version}`)
    if (updatePromptVisible || updateDownloadStarted) return
    updatePromptVisible = true
    sendUpdaterStatus({
      status: 'available',
      version: info.version,
      message: `New version v${info.version} is available.`,
    })

    try {
      const messageBoxOptions: Electron.MessageBoxOptions = {
        type: 'info',
        title: 'Update available',
        message: `New version v${info.version} is available. Update now?`,
        detail: 'Click Update Now to download in the background. When the download finishes, the app will quit, install the update, and restart automatically.',
        buttons: ['Later', 'Update Now'],
        cancelId: 0,
        defaultId: 1,
        noLink: true,
      }
      const result = win
        ? await dialog.showMessageBox(win, messageBoxOptions)
        : await dialog.showMessageBox(messageBoxOptions)

      if (result.response === 1) {
        updateDownloadStarted = true
        updateLastProgressPercent = 0
        win?.setProgressBar(0)
        sendUpdaterStatus({
          status: 'downloading',
          version: info.version,
          percent: 0,
          message: `Downloading v${info.version} in the background. The app will restart automatically after the download completes.`,
        })
        void autoUpdater.downloadUpdate().catch((error) => {
          updateDownloadStarted = false
          resetUpdateProgressUi()
          sendUpdaterStatus({
            status: 'error',
            version: info.version,
            message: error instanceof Error ? error.message : String(error),
          })
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
    sendUpdaterStatus({
      status: 'not-available',
      version: info.version,
      message: 'You are already on the latest version.',
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    const percent = progress.percent.toFixed(1)
    console.log(`[updater] download ${percent}% (${Math.round(progress.bytesPerSecond / 1024)} KB/s)`)
    const progressValue = Math.max(0, Math.min(1, progress.percent / 100))
    win?.setProgressBar(progressValue)
    if (win) win.setTitle(`GTIIT Campus Dashboard - Downloading update ${percent}%`)
    const wholePercent = Math.floor(progress.percent)
    if (wholePercent >= updateLastProgressPercent + 10 || wholePercent >= 100) {
      updateLastProgressPercent = wholePercent
      sendUpdaterStatus({
        status: 'downloading',
        percent: progress.percent,
        message: `Downloading update ${percent}%`,
      })
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] update downloaded: ${info.version}, installing now`)
    win?.setProgressBar(1)
    if (win) win.setTitle('GTIIT Campus Dashboard - Installing update')
    sendUpdaterStatus({
      status: 'downloaded',
      version: info.version,
      percent: 100,
      message: `v${info.version} has downloaded. Restarting to install now.`,
    })
    sendUpdaterStatus({
      status: 'installing',
      version: info.version,
      percent: 100,
      message: 'The app will quit and install the update now.',
    })
    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true)
    }, 1200)
  })

  autoUpdater.on('error', (error) => {
    updateDownloadStarted = false
    resetUpdateProgressUi()
    sendUpdaterStatus({
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
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
  const intervalMs = getAutoSyncIntervalMs()
  if (!intervalMs) return
  const { dashboardDb, moodleService } = ensureServices()
  if (!moodleService.hasActiveSession()) return
  const lastAuto = dashboardDb.getMetaValue('sync:auto:last') as { at?: string } | null
  const lastMoodle = dashboardDb.getMetaValue('sync:moodle:last') as { at?: string } | null
  const lastAt = [lastAuto?.at, lastMoodle?.at]
    .map((value) => (value ? new Date(value).getTime() : 0))
    .reduce((max, current) => (current > max ? current : max), 0)
  if (lastAt && Date.now() - lastAt < intervalMs) return

  autoSyncRunning = true
  try {
    const moodle = await moodleService.sync()
    dashboardDb.setMeta('sync:auto:last', {
      trigger: 'auto',
      at: new Date().toISOString(),
      moodle,
      students: null,
      studentsError: STUDENTS_SYNC_DISABLED_MESSAGE,
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
  if (isQuitting) {
    if (autoSyncTimer) {
      clearInterval(autoSyncTimer)
      autoSyncTimer = null
    }
    if (studyAlertTimer) {
      clearInterval(studyAlertTimer)
      studyAlertTimer = null
    }
    win = null
  }
})

app.on('before-quit', () => {
  isQuitting = true
  if (autoSyncTimer) clearInterval(autoSyncTimer)
  if (studyAlertTimer) clearInterval(studyAlertTimer)
  autoSyncTimer = null
  studyAlertTimer = null
})

app.on('activate', () => {
  showMainWindow()
})

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'dashboard.sqlite')
  dashboardDb = new DashboardDb(dbPath)
  moodleService = new MoodleService(dashboardDb)
  studentsService = new StudentsService(dashboardDb, () => win)
  transcriptService = new TranscriptService(dashboardDb)
  notebookService = new NotebookService(path.join(app.getPath('userData'), 'course-notes'))
  studyDb = new StudyDb(path.join(app.getPath('userData'), 'study.sqlite'))
  registerIpcHandlers()
  void runAutoSyncIfDue()
  autoSyncTimer = setInterval(() => {
    void runAutoSyncIfDue()
  }, AUTO_SYNC_CHECK_MS)
  checkStudyAlerts()
  studyAlertTimer = setInterval(checkStudyAlerts, STUDY_ALERT_CHECK_MS)
  createWindow()
  createTray()
  setupAutoUpdaterV2()
}).catch((error) => {
  console.error('[main] app init failed:', error)
})
