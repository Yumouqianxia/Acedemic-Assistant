/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    ping: (message: string) => Promise<string>
    appPlatform: () => Promise<string>
    onMainMessage: (callback: (message: string) => void) => () => void
    moodleLogin: (payload: { username: string; password: string; rememberPassword?: boolean }) => Promise<{
      username: string
      fullName: string
      siteName: string
      userId: number
    }>
    moodleSync: (payload?: { username?: string }) => Promise<{
      user: {
        username: string
        fullName: string
        siteName: string
        userId: number
      }
      termLabel: string
      courses: Array<{
        id: number
        fullname: string
        shortname: string
        progress?: number | null
      }>
      delta: {
        inserted: number
        updated: number
      }
    }>
    moodleCourseContents: (payload: { courseId: number; username?: string }) => Promise<Array<{
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
    }>>
    moodleProfilesList: () => Promise<Array<{
      username: string
      fullName: string
      siteName: string
      lastSyncAt: string
      hasRememberedPassword: boolean
    }>>
    moodleProfileRemove: (payload: { username: string }) => Promise<boolean>
    moodleCredentialGet: (payload: { username: string }) => Promise<{
      username: string
      password: string | null
    }>
    moodleLogout: (payload?: { username?: string }) => Promise<boolean>
    moodleSsoLogin: () => Promise<{
      username: string
      fullName: string
      siteName: string
      userId: number
    }>
    moodleTimeline: (payload?: { username?: string; daysAhead?: number }) => Promise<Array<{
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
    moodleAssignmentDetailWithStatus: (payload: { cmid: number; courseId: number; username?: string }) => Promise<{
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
        submittedFiles: Array<{ filename: string; filesize: number; fileurl: string }>
        gradeText: string | null
        gradedAt: number | null
        grader: { id: number; fullName: string; email: string | null } | null
        feedbackFiles: Array<{ filename: string; filesize: number; fileurl: string; mimetype: string }>
      }
    }>
    moodleAssignmentDetail: (payload: { cmid: number; courseId: number; username?: string }) => Promise<{
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
    moodleAssignmentSubmissionStatus: (payload: { assignId: number; username?: string }) => Promise<{
      status: string
      canSubmit: boolean
      canEdit: boolean
      submittedFiles: Array<{ filename: string; filesize: number; fileurl: string }>
      gradeText: string | null
      gradedAt: number | null
      grader: { id: number; fullName: string; email: string | null } | null
      feedbackFiles: Array<{ filename: string; filesize: number; fileurl: string; mimetype: string }>
    }>
    moodleAssignmentUploadFile: (payload: { filePath: string; username?: string }) => Promise<{
      itemid: number
      filename: string
      fileSize: number
    }>
    moodleAssignmentSaveSubmission: (payload: { assignId: number; draftItemId: number; username?: string }) => Promise<boolean>
    openPdfViewer: (payload: { url: string; title?: string }) => Promise<boolean>
    downloadAndOpenFile: (payload: { url: string; filename?: string }) => Promise<{ filePath: string }>
    dialogOpenFile: (options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{
      canceled: boolean
      filePaths: string[]
    }>
    windowMinimize: () => Promise<void>
    windowMaximize: () => Promise<void>
    windowClose: () => Promise<void>
    windowIsMaximized: () => Promise<boolean>
    studentsAuthenticate: () => Promise<{
      authenticated: boolean
      reason?: string
      finalUrl?: string
    }>
    studentsSync: () => Promise<{
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
    studentsSessionClear: () => Promise<boolean>
    dashboardGet: () => Promise<{
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
      studentsProfile: {
        studentId: string
        programName: string
        chineseName: string
        pinyinName: string
        cohort: string
        gpa: string
        accumulatedCreditPoints: string
      } | null
    }>
    dashboardSyncAll: (payload?: { username?: string; trigger?: 'manual' | 'login' | 'auto' }) => Promise<{
      trigger: 'manual' | 'login' | 'auto'
      at: string
      moodle: {
        user: {
          username: string
          fullName: string
          siteName: string
          userId: number
        }
        termLabel: string
        courses: Array<{
          id: number
          fullname: string
          shortname: string
          progress?: number | null
        }>
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
  }
}
