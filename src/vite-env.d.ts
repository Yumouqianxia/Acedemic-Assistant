/// <reference types="vite/client" />

type RendererStudyTask = {
  id: number
  courseKey: string
  courseName: string
  title: string
  description: string
  scheduledDate: string
  startTime: string
  estimatedMinutes: number
  status: 'todo' | 'done'
  priority: 1 | 2 | 3
  noteId: string | null
  reminderAt: string | null
  reminderFiredAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

type RendererStudyTaskInput = Pick<RendererStudyTask, 'title' | 'scheduledDate'> & Partial<Pick<RendererStudyTask,
  'courseKey' | 'courseName' | 'description' | 'startTime' | 'estimatedMinutes' | 'priority' | 'noteId' | 'reminderAt'
>>

type RendererFocusSession = {
  id: number
  taskId: number | null
  label: string
  mode: 'focus' | 'break'
  startedAt: string
  endsAt: string
  plannedSeconds: number
  status: 'active' | 'completed' | 'cancelled'
  endedAt: string | null
}

type RendererPersonalExam = {
  id: number
  courseKey: string
  courseName: string
  examSession: string
  startsAt: string
  durationMinutes: number
  venue: string
  createdAt: string
}

type RendererCsvTaskRow = RendererStudyTaskInput & {
  rowNumber: number
  id?: number
  courseCode: string
  reminderEnabled: boolean
  errors: string[]
  warnings: string[]
  action: 'create' | 'update' | 'skip' | 'invalid'
}

type RendererCsvPreview = {
  fileName: string
  headers: string[]
  rows: RendererCsvTaskRow[]
  missingHeaders: string[]
}

interface Window {
  electronAPI: {
    ping: (message: string) => Promise<string>
    appPlatform: () => Promise<string>
    appVersion: () => Promise<string>
    appPreferencesGet: () => Promise<{
      language: 'zh-CN' | 'en-US'
      themeMode: 'light' | 'dark' | 'system'
      autoSyncIntervalHours: 0 | 6 | 24
      downloadDirectory: string | null
    }>
    appPreferencesUpdate: (payload: Partial<{
      language: 'zh-CN' | 'en-US'
      themeMode: 'light' | 'dark' | 'system'
      autoSyncIntervalHours: 0 | 6 | 24
      downloadDirectory: string | null
    }>) => Promise<{
      language: 'zh-CN' | 'en-US'
      themeMode: 'light' | 'dark' | 'system'
      autoSyncIntervalHours: 0 | 6 | 24
      downloadDirectory: string | null
    }>
    notebookCourseGet: (payload: { course: { courseKey: string; courseCode: string; courseName: string } }) => Promise<{
      index: {
        version: 1
        course: { courseKey: string; courseCode: string; courseName: string }
        items: Array<{
          id: string
          title: string
          file: string
          htmlFile: string
          sourceType: 'markdown' | 'html-import' | 'richtext'
          editor: 'markdown' | 'external-html' | 'richtext'
          createdAt: string
          updatedAt: string
        }>
        updatedAt: string
      }
      courseDir: string
    }>
    notebookCreateMarkdown: (payload: { course: { courseKey: string; courseCode: string; courseName: string }; title: string }) => Promise<{
      id: string
      title: string
      file: string
      htmlFile: string
      sourceType: 'markdown' | 'html-import' | 'richtext'
      editor: 'markdown' | 'external-html' | 'richtext'
      createdAt: string
      updatedAt: string
    }>
    notebookImportHtml: (payload: { course: { courseKey: string; courseCode: string; courseName: string }; filePath: string }) => Promise<{
      id: string
      title: string
      file: string
      htmlFile: string
      sourceType: 'markdown' | 'html-import' | 'richtext'
      editor: 'markdown' | 'external-html' | 'richtext'
      createdAt: string
      updatedAt: string
    }>
    notebookImportHtmlFiles: (payload: { course: { courseKey: string; courseCode: string; courseName: string }; filePaths: string[] }) => Promise<{
      items: Array<{
        id: string
        title: string
        file: string
        htmlFile: string
        sourceType: 'markdown' | 'html-import' | 'richtext'
        editor: 'markdown' | 'external-html' | 'richtext'
        createdAt: string
        updatedAt: string
      }>
      copiedAssets: string[]
    }>
    notebookImportHtmlDirectory: (payload: { course: { courseKey: string; courseCode: string; courseName: string }; directory: string }) => Promise<{
      items: Array<{
        id: string
        title: string
        file: string
        htmlFile: string
        sourceType: 'markdown' | 'html-import' | 'richtext'
        editor: 'markdown' | 'external-html' | 'richtext'
        createdAt: string
        updatedAt: string
      }>
      copiedAssets: string[]
    }>
    notebookReadNote: (payload: { course: { courseKey: string; courseCode: string; courseName: string }; noteId: string }) => Promise<{
      item: {
        id: string
        title: string
        file: string
        htmlFile: string
        sourceType: 'markdown' | 'html-import' | 'richtext'
        editor: 'markdown' | 'external-html' | 'richtext'
        createdAt: string
        updatedAt: string
      }
      source: string
      html: string
    }>
    notebookSaveMarkdown: (payload: { course: { courseKey: string; courseCode: string; courseName: string }; noteId: string; title: string; source: string }) => Promise<{
      item: {
        id: string
        title: string
        file: string
        htmlFile: string
        sourceType: 'markdown' | 'html-import' | 'richtext'
        editor: 'markdown' | 'external-html' | 'richtext'
        createdAt: string
        updatedAt: string
      }
      html: string
    }>
    notebookRenderNote: (payload: { course: { courseKey: string; courseCode: string; courseName: string }; noteId: string }) => Promise<string>
    notebookRenderCourse: (payload: { course: { courseKey: string; courseCode: string; courseName: string } }) => Promise<{ html: string; filePath: string }>
    notebookRenameNote: (payload: { course: { courseKey: string; courseCode: string; courseName: string }; noteId: string; title: string }) => Promise<{
      id: string
      title: string
      file: string
      htmlFile: string
      sourceType: 'markdown' | 'html-import' | 'richtext'
      editor: 'markdown' | 'external-html' | 'richtext'
      createdAt: string
      updatedAt: string
    }>
    notebookDeleteNote: (payload: { course: { courseKey: string; courseCode: string; courseName: string }; noteId: string }) => Promise<{
      version: 1
      course: { courseKey: string; courseCode: string; courseName: string }
      items: Array<{
        id: string
        title: string
        file: string
        htmlFile: string
        sourceType: 'markdown' | 'html-import' | 'richtext'
        editor: 'markdown' | 'external-html' | 'richtext'
        createdAt: string
        updatedAt: string
      }>
      updatedAt: string
    }>
    notebookSyncSources: (payload: { course: { courseKey: string; courseCode: string; courseName: string }; noteIds?: string[] }) => Promise<{
      index: {
        version: 1
        course: { courseKey: string; courseCode: string; courseName: string }
        items: Array<{
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
        }>
        updatedAt: string
      }
      synced: number
      skipped: number
      missing: Array<{ id: string; title: string; sourcePath: string }>
      copiedAssets: string[]
    }>
    notebookReorderNotes: (payload: { course: { courseKey: string; courseCode: string; courseName: string }; noteIds: string[] }) => Promise<{
      version: 1
      course: { courseKey: string; courseCode: string; courseName: string }
      items: Array<{
        id: string
        title: string
        file: string
        htmlFile: string
        sourceType: 'markdown' | 'html-import' | 'richtext'
        editor: 'markdown' | 'external-html' | 'richtext'
        createdAt: string
        updatedAt: string
      }>
      updatedAt: string
    }>
    notebookOpenNote: (payload: { course: { courseKey: string; courseCode: string; courseName: string }; noteId: string }) => Promise<boolean>
    notebookOpenCourse: (payload: { course: { courseKey: string; courseCode: string; courseName: string } }) => Promise<boolean>
    notebookOpenCourseFolder: (payload: { course: { courseKey: string; courseCode: string; courseName: string } }) => Promise<boolean>
    onMainMessage: (callback: (message: string) => void) => () => void
    onUpdaterStatus: (callback: (payload: {
      status: 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'not-available' | 'error'
      version?: string
      percent?: number
      message: string
    }) => void) => () => void
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
        assignmentFiles?: Array<{
          filename: string
          filesize: number
          fileurl: string
          mimetype: string
        }>
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
        submittedFiles: Array<{ filename: string; filesize: number; fileurl: string; mimetype?: string }>
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
      submittedFiles: Array<{ filename: string; filesize: number; fileurl: string; mimetype?: string }>
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
    downloadCourseResources: (payload: {
      targetDirectory: string
      courseName: string
      courseCode: string
      resources: Array<{
        sectionName: string
        moduleName: string
        filename: string
        fileurl: string
      }>
    }) => Promise<{
      courseDir: string
      total: number
      succeeded: number
      failed: number
      results: Array<{ filename: string; filePath: string | null; ok: boolean; error?: string }>
    }>
    getDownloadDirectory: () => Promise<string>
    setDownloadDirectory: (payload: { directory: string | null }) => Promise<{
      directory: string
      isDefault: boolean
    }>
    clearPreviewCache: () => Promise<{ removed: number }>
    dialogOpenFile: (options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{
      canceled: boolean
      filePaths: string[]
    }>
    dialogOpenDirectory: (options?: { title?: string }) => Promise<{
      canceled: boolean
      filePaths: string[]
    }>
    updaterCheckNow: () => Promise<{
      status: 'disabled' | 'available' | 'up-to-date' | 'error'
      message: string
      currentVersion: string
      nextVersion?: string
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
    studentsImportTranscriptPdf: (payload: { filePath: string }) => Promise<{
      filePath: string
      studentName: string
      studentId: string
      programName: string
      gpa: string
      accumulatedCreditPoints: string
      courses: Array<{
        code: string
        name: string
        credits: number
        grade: string
        semesterLabel: string
        semesterTechnion: string
      }>
      delta: {
        inserted: number
        updated: number
      }
      importedAt: string
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
    studyTasksList: (payload: { fromDate: string; toDate: string }) => Promise<RendererStudyTask[]>
    studyTaskCreate: (payload: RendererStudyTaskInput) => Promise<RendererStudyTask>
    studyTaskUpdate: (payload: { id: number; patch: Partial<RendererStudyTaskInput & { status: 'todo' | 'done' }> }) => Promise<RendererStudyTask>
    studyTaskDelete: (payload: { id: number }) => Promise<boolean>
    studyCsvSaveTemplate: () => Promise<{ canceled: boolean; filePath: string | null }>
    studyCsvExport: () => Promise<{ canceled: boolean; filePath: string | null; count: number }>
    studyCalendarExportPdf: () => Promise<{ canceled: boolean; filePath: string | null; count: number }>
    studyCsvPreview: (payload: { filePath: string }) => Promise<RendererCsvPreview>
    studyCsvCommit: (payload: { fileName: string; rows: RendererCsvTaskRow[]; duplicateStrategy: 'skip' | 'update' | 'create' }) => Promise<{
      batchId: string
      created: number
      updated: number
      skipped: number
    }>
    studyCsvUndo: (payload: { batchId: string }) => Promise<{ restored: number }>
    studyTasksBulkUpdate: (payload: {
      ids: number[]
      operation: 'complete' | 'reopen' | 'move-days' | 'priority' | 'duration' | 'delete'
      value?: number
    }) => Promise<{ changed: number }>
    studyExamsList: () => Promise<RendererPersonalExam[]>
    studyExamCreate: (payload: { courseKey?: string; courseName: string; examSession?: string; startsAt: string; durationMinutes?: number; venue?: string }) => Promise<RendererPersonalExam>
    studyExamDelete: (payload: { id: number }) => Promise<boolean>
    studyFocusGetActive: () => Promise<RendererFocusSession | null>
    studyFocusStart: (payload: { taskId?: number | null; label?: string; mode?: 'focus' | 'break'; durationSeconds?: number }) => Promise<RendererFocusSession>
    studyFocusStop: (payload?: { status?: 'completed' | 'cancelled' }) => Promise<RendererFocusSession | null>
    onStudyAlert: (callback: (payload: {
      type: 'task' | 'focus'
      task?: RendererStudyTask
      session?: RendererFocusSession
    }) => void) => () => void
  }
}
