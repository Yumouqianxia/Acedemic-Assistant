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

const electronAPI = {
  ping(message: string) {
    return ipcRenderer.invoke('ipc-test:ping', message)
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
      courses: Array<{ name: string; code: string; credits: number }>
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
        courses: Array<{ name: string; code: string; credits: number }>
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
