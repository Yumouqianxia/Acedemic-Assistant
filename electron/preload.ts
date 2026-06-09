import { ipcRenderer, contextBridge } from 'electron'

type MoodleUser = {
  username: string
  fullName: string
  siteName: string
  userId: number
}

type MoodleCourse = {
  id: number
  fullname: string
  shortname: string
  progress?: number | null
}

type MoodleProfile = {
  username: string
  fullName: string
  siteName: string
  lastSyncAt: string
  hasRememberedPassword: boolean
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
    visible: boolean
    uservisible: boolean
    resources: Array<{
      type: string
      filename: string
      filesize: number
      mimetype: string
      isexternalfile: boolean
      fileurl: string
    }>
  }>
}

type ThemeMode = 'light' | 'dark' | 'system'
type Language = 'zh-CN' | 'en-US'
type AutoSyncIntervalHours = 0 | 6 | 24
type AppPreferences = {
  language: Language
  themeMode: ThemeMode
  autoSyncIntervalHours: AutoSyncIntervalHours
  downloadDirectory: string | null
}

type NotebookCourse = {
  courseKey: string
  courseCode: string
  courseName: string
}

type NotebookItem = {
  id: string
  title: string
  file: string
  htmlFile: string
  sourceType: 'markdown' | 'html-import' | 'richtext'
  editor: 'markdown' | 'external-html' | 'richtext'
  importMode?: 'copy' | 'mirror'
  sourcePath?: string
  sourceDir?: string
  syncedAt?: string
  createdAt: string
  updatedAt: string
}

type NotebookIndex = {
  version: 1
  course: NotebookCourse
  items: NotebookItem[]
  updatedAt: string
}

const electronAPI = {
  ping(message: string) {
    return ipcRenderer.invoke('ipc-test:ping', message)
  },
  appPlatform() {
    return ipcRenderer.invoke('app:platform') as Promise<string>
  },
  appVersion() {
    return ipcRenderer.invoke('app:get-version') as Promise<string>
  },
  appPreferencesGet() {
    return ipcRenderer.invoke('app:preferences:get') as Promise<AppPreferences>
  },
  appPreferencesUpdate(payload: Partial<AppPreferences>) {
    return ipcRenderer.invoke('app:preferences:update', payload) as Promise<AppPreferences>
  },
  notebookCourseGet(payload: { course: NotebookCourse }) {
    return ipcRenderer.invoke('notebook:course:get', payload) as Promise<{
      index: NotebookIndex
      courseDir: string
    }>
  },
  notebookCreateMarkdown(payload: { course: NotebookCourse; title: string }) {
    return ipcRenderer.invoke('notebook:note:create-markdown', payload) as Promise<NotebookItem>
  },
  notebookImportHtml(payload: { course: NotebookCourse; filePath: string }) {
    return ipcRenderer.invoke('notebook:note:import-html', payload) as Promise<NotebookItem>
  },
  notebookImportHtmlFiles(payload: { course: NotebookCourse; filePaths: string[] }) {
    return ipcRenderer.invoke('notebook:notes:import-html', payload) as Promise<{
      items: NotebookItem[]
      copiedAssets: string[]
    }>
  },
  notebookImportHtmlDirectory(payload: { course: NotebookCourse; directory: string }) {
    return ipcRenderer.invoke('notebook:notes:import-html-directory', payload) as Promise<{
      items: NotebookItem[]
      copiedAssets: string[]
    }>
  },
  notebookReadNote(payload: { course: NotebookCourse; noteId: string }) {
    return ipcRenderer.invoke('notebook:note:read', payload) as Promise<{
      item: NotebookItem
      source: string
      html: string
    }>
  },
  notebookSaveMarkdown(payload: { course: NotebookCourse; noteId: string; title: string; source: string }) {
    return ipcRenderer.invoke('notebook:note:save-markdown', payload) as Promise<{
      item: NotebookItem
      html: string
    }>
  },
  notebookRenderNote(payload: { course: NotebookCourse; noteId: string }) {
    return ipcRenderer.invoke('notebook:note:render', payload) as Promise<string>
  },
  notebookRenderCourse(payload: { course: NotebookCourse }) {
    return ipcRenderer.invoke('notebook:course:render', payload) as Promise<{
      html: string
      filePath: string
    }>
  },
  notebookRenameNote(payload: { course: NotebookCourse; noteId: string; title: string }) {
    return ipcRenderer.invoke('notebook:note:rename', payload) as Promise<NotebookItem>
  },
  notebookDeleteNote(payload: { course: NotebookCourse; noteId: string }) {
    return ipcRenderer.invoke('notebook:note:delete', payload) as Promise<NotebookIndex>
  },
  notebookSyncSources(payload: { course: NotebookCourse; noteIds?: string[] }) {
    return ipcRenderer.invoke('notebook:sources:sync', payload) as Promise<{
      index: NotebookIndex
      synced: number
      skipped: number
      missing: Array<{ id: string; title: string; sourcePath: string }>
      copiedAssets: string[]
    }>
  },
  notebookReorderNotes(payload: { course: NotebookCourse; noteIds: string[] }) {
    return ipcRenderer.invoke('notebook:notes:reorder', payload) as Promise<NotebookIndex>
  },
  notebookOpenNote(payload: { course: NotebookCourse; noteId: string }) {
    return ipcRenderer.invoke('notebook:note:open', payload) as Promise<boolean>
  },
  notebookOpenCourse(payload: { course: NotebookCourse }) {
    return ipcRenderer.invoke('notebook:course:open', payload) as Promise<boolean>
  },
  notebookOpenCourseFolder(payload: { course: NotebookCourse }) {
    return ipcRenderer.invoke('notebook:course:open-folder', payload) as Promise<boolean>
  },
  onMainMessage(callback: (message: string) => void) {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
    ipcRenderer.on('main-process-message', listener)
    return () => ipcRenderer.off('main-process-message', listener)
  },
  moodleLogin(payload: { username: string; password: string; rememberPassword?: boolean }) {
    return ipcRenderer.invoke('moodle:login', payload) as Promise<MoodleUser>
  },
  moodleSync(payload?: { username?: string }) {
    return ipcRenderer.invoke('moodle:sync', payload) as Promise<{
      user: MoodleUser
      termLabel: string
      courses: MoodleCourse[]
      delta: {
        inserted: number
        updated: number
      }
    }>
  },
  moodleCourseContents(payload: { courseId: number; username?: string }) {
    return ipcRenderer.invoke('moodle:course:contents', payload) as Promise<MoodleSection[]>
  },
  moodleProfilesList() {
    return ipcRenderer.invoke('moodle:profiles:list') as Promise<MoodleProfile[]>
  },
  moodleProfileRemove(payload: { username: string }) {
    return ipcRenderer.invoke('moodle:profile:remove', payload) as Promise<boolean>
  },
  moodleCredentialGet(payload: { username: string }) {
    return ipcRenderer.invoke('moodle:credential:get', payload) as Promise<{
      username: string
      password: string | null
    }>
  },
  moodleLogout(payload?: { username?: string }) {
    return ipcRenderer.invoke('moodle:logout', payload) as Promise<boolean>
  },
  moodleSsoLogin() {
    return ipcRenderer.invoke('moodle:sso-login') as Promise<{
      username: string
      fullName: string
      siteName: string
      userId: number
    }>
  },
  moodleTimeline(payload?: { username?: string; daysAhead?: number }) {
    return ipcRenderer.invoke('moodle:timeline', payload) as Promise<Array<{
      id: number
      name: string
      description: string
      courseid: number
      coursename: string
      timestart: number
      timesort: number
      modulename: string
      cmid: number
      actionUrl: string
    }>>
  },
  moodleAssignmentDetailWithStatus(payload: { cmid: number; courseId: number; username?: string }) {
    return ipcRenderer.invoke('moodle:assignment:detail-with-status', payload) as Promise<{
      detail: {
        id: number
        cmid: number
        name: string
        intro: string
        duedate: number
        allowsubmissionsfromdate: number
        fileSubmissionEnabled: boolean
        maxFileSubmissions: number
        allowedFileTypes: string
        introAttachments: Array<{
          filename: string
          filesize: number
          fileurl: string
          mimetype: string
        }>
      }
      status: {
        status: string
        canSubmit: boolean
        canEdit: boolean
        submittedFiles: Array<{ filename: string; filesize: number; fileurl: string; mimetype?: string }>
        gradeText: string | null
        gradedAt: number | null
        grader: { id: number; fullName: string; email: string | null } | null
        feedbackFiles: Array<{ filename: string; filesize: number; fileurl: string; mimetype: string }>
      }
    }>
  },
  moodleAssignmentDetail(payload: { cmid: number; courseId: number; username?: string }) {
    return ipcRenderer.invoke('moodle:assignment:detail', payload) as Promise<{
      id: number
      cmid: number
      name: string
      intro: string
      duedate: number
      allowsubmissionsfromdate: number
      fileSubmissionEnabled: boolean
      maxFileSubmissions: number
      allowedFileTypes: string
      introAttachments: Array<{
        filename: string
        filesize: number
        fileurl: string
        mimetype: string
      }>
    }>
  },
  moodleAssignmentSubmissionStatus(payload: { assignId: number; username?: string }) {
    return ipcRenderer.invoke('moodle:assignment:submission-status', payload) as Promise<{
      status: string
      canSubmit: boolean
      canEdit: boolean
      submittedFiles: Array<{ filename: string; filesize: number; fileurl: string; mimetype?: string }>
      gradeText: string | null
      gradedAt: number | null
      grader: { id: number; fullName: string; email: string | null } | null
      feedbackFiles: Array<{ filename: string; filesize: number; fileurl: string; mimetype: string }>
    }>
  },
  moodleAssignmentUploadFile(payload: { filePath: string; username?: string }) {
    return ipcRenderer.invoke('moodle:assignment:upload-file', payload) as Promise<{
      itemid: number
      filename: string
      fileSize: number
    }>
  },
  moodleAssignmentSaveSubmission(payload: { assignId: number; draftItemId: number; username?: string }) {
    return ipcRenderer.invoke('moodle:assignment:save-submission', payload) as Promise<boolean>
  },
  openPdfViewer(payload: { url: string; title?: string }) {
    return ipcRenderer.invoke('file:open-pdf', payload) as Promise<boolean>
  },
  downloadAndOpenFile(payload: { url: string; filename?: string }) {
    return ipcRenderer.invoke('file:download-open', payload) as Promise<{ filePath: string }>
  },
  downloadCourseResources(payload: {
    targetDirectory: string
    courseName: string
    courseCode: string
    resources: Array<{
      sectionName: string
      moduleName: string
      filename: string
      fileurl: string
    }>
  }) {
    return ipcRenderer.invoke('file:download-course-resources', payload) as Promise<{
      courseDir: string
      total: number
      succeeded: number
      failed: number
      results: Array<{ filename: string; filePath: string | null; ok: boolean; error?: string }>
    }>
  },
  getDownloadDirectory() {
    return ipcRenderer.invoke('file:get-download-directory') as Promise<string>
  },
  setDownloadDirectory(payload: { directory: string | null }) {
    return ipcRenderer.invoke('file:set-download-directory', payload) as Promise<{
      directory: string
      isDefault: boolean
    }>
  },
  clearPreviewCache() {
    return ipcRenderer.invoke('file:clear-preview-cache') as Promise<{ removed: number }>
  },
  dialogOpenFile(options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) {
    return ipcRenderer.invoke('dialog:open-file', options) as Promise<{
      canceled: boolean
      filePaths: string[]
    }>
  },
  dialogOpenDirectory(options?: { title?: string }) {
    return ipcRenderer.invoke('dialog:open-directory', options) as Promise<{
      canceled: boolean
      filePaths: string[]
    }>
  },
  updaterCheckNow() {
    return ipcRenderer.invoke('updater:check-now') as Promise<{
      status: 'disabled' | 'available' | 'up-to-date' | 'error'
      message: string
      currentVersion: string
      nextVersion?: string
    }>
  },
  studentsAuthenticate() {
    return ipcRenderer.invoke('students:authenticate') as Promise<{
      authenticated: boolean
      reason?: string
      finalUrl?: string
    }>
  },
  studentsSync() {
    return ipcRenderer.invoke('students:sync') as Promise<{
      currentUrl: string
      semester: string
      semesterTechnion: string
      courses: Array<{ name: string; code: string; credits: number; grade: string | null }>
      exams: Array<{
        code: string
        course: string
        term: string
        startTime: string
        duration: string
        venue: string
      }>
      profile: {
        studentId: string
        programName: string
        chineseName: string
        pinyinName: string
        cohort: string
        gpa: string
        accumulatedCreditPoints: string
      } | null
      capturedAt: string
      delta: {
        courses: {
          inserted: number
          updated: number
        }
        exams: {
          inserted: number
          updated: number
          deleted: number
        }
      }
    }>
  },
  studentsSessionClear() {
    return ipcRenderer.invoke('students:session:clear') as Promise<boolean>
  },
  dashboardGet() {
    return ipcRenderer.invoke('dashboard:get') as Promise<{
      courses: Array<{
        courseKey: string
        courseCode: string
        courseName: string
        semesterLabel: string
        semesterTechnion: string
        credits: number | null
        grade: string | null
        moodleCourseId: number | null
        hasMoodle: boolean
        hasStudents: boolean
        updatedAt: string
      }>
      exams: Array<{
        semesterTechnion: string
        courseCode: string
        courseName: string
        examSession: string
        date: string
        time: string
        duration: string
        venue: string
      }>
      lastMoodleSyncAt: {
        at: string
        username: string
        termLabel: string
        count: number
      } | null
      lastStudentsSyncAt: {
        at: string
        semester: string
        semesterTechnion: string
        courseCount: number
        examCount: number
      } | null
      lastAutoSync: {
        trigger?: 'auto'
        at: string
        studentsError?: string | null
        error?: string
      } | null
    }>
  },
  windowMinimize() {
    return ipcRenderer.invoke('window:minimize') as Promise<void>
  },
  windowMaximize() {
    return ipcRenderer.invoke('window:maximize') as Promise<void>
  },
  windowClose() {
    return ipcRenderer.invoke('window:close') as Promise<void>
  },
  windowIsMaximized() {
    return ipcRenderer.invoke('window:is-maximized') as Promise<boolean>
  },
  dashboardSyncAll(payload?: { username?: string; trigger?: 'manual' | 'login' | 'auto' }) {
    return ipcRenderer.invoke('dashboard:sync-all', payload) as Promise<{
      trigger: 'manual' | 'login' | 'auto'
      at: string
      moodle: {
        user: MoodleUser
        termLabel: string
        courses: MoodleCourse[]
        delta: {
          inserted: number
          updated: number
        }
      }
      students: {
        currentUrl: string
        semester: string
        semesterTechnion: string
        courses: Array<{ name: string; code: string; credits: number; grade: string | null }>
        exams: Array<{
          code: string
          course: string
          term: string
          startTime: string
          duration: string
          venue: string
        }>
        profile: {
          studentId: string
          programName: string
          chineseName: string
          pinyinName: string
          cohort: string
          gpa: string
          accumulatedCreditPoints: string
        } | null
        capturedAt: string
        delta: {
          courses: {
            inserted: number
            updated: number
          }
          exams: {
            inserted: number
            updated: number
            deleted: number
          }
        }
      } | null
      studentsError: string | null
    }>
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})
