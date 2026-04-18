export type MoodleProfile = {
  username: string
  fullName: string
  siteName: string
  lastSyncAt: string
  hasRememberedPassword: boolean
}

export type MoodleUser = { username: string; fullName: string; siteName: string; userId: number }

export type UsernameSuggestion = { value: string; profile: MoodleProfile }

export type UnifiedCourse = {
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
}

export type StudentsExam = {
  semesterTechnion: string
  courseCode: string
  courseName: string
  examSession: string
  date: string
  time: string
  duration: string
  venue: string
}

export type MoodleSection = {
  id: number
  name: string
  moduleCount: number
  modules: Array<{
    id: number
    name: string
    modname: string
    url: string
    resources: Array<{
      filename: string
      filesize: number
      mimetype: string
      fileurl: string
    }>
  }>
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
  /** cmid from ?id=CMID in actionUrl — reliable identifier */
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
  introAttachments: Array<{
    filename: string
    filesize: number
    fileurl: string
    mimetype: string
  }>
}

export type SubmissionStatus = {
  status: string
  canSubmit: boolean
  canEdit: boolean
  submittedFiles: Array<{ filename: string; filesize: number; fileurl: string }>
  gradeText: string | null
  gradedAt: number | null
  grader: { id: number; fullName: string; email: string | null } | null
  feedbackFiles: Array<{ filename: string; filesize: number; fileurl: string; mimetype: string }>
}

export type SelectedFile = {
  path: string
  name: string
  size: number
  itemid: number | null
  uploading: boolean
  error: string | null
}

export type DashboardData = {
  courses: UnifiedCourse[]
  exams: StudentsExam[]
  lastMoodleSyncAt: { at: string; username: string; termLabel: string; count: number } | null
  lastStudentsSyncAt: { at: string; semester: string; semesterTechnion: string; courseCount: number; examCount: number } | null
  lastAutoSync: { at: string; studentsError?: string | null; error?: string } | null
  studentsProfile: {
    studentId: string
    programName: string
    chineseName: string
    pinyinName: string
    cohort: string
    gpa: string
    accumulatedCreditPoints: string
  } | null
}
