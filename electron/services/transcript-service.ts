import fs from 'node:fs/promises'
import pdfParse from 'pdf-parse'
import { DashboardDb } from '../dashboard-db'

type TranscriptCourse = {
  code: string
  name: string
  credits: number
  grade: string
  semesterLabel: string
  semesterTechnion: string
}

type ParsedTranscript = {
  studentName: string
  studentId: string
  programName: string
  gpa: string
  accumulatedCreditPoints: string
  courses: TranscriptCourse[]
}

const TERM_TO_TECHNION: Record<string, string> = {
  FALL: '1',
  AUTUMN: '1',
  SPRING: '2',
  SUMMER: '3',
  WINTER: '4',
}

const COURSE_LINE_RE = /^(\d{8})(.+?)(20\d{2}-\d{2}\s+(?:SPRING|SUMMER|WINTER|FALL|AUTUMN))$/i
const CREDIT_VALUES = ['0.5', '1.5', '2.5', '3.5', '9', '8', '7', '6', '5', '4', '3', '2', '1']

function normalizePdfText(text: string) {
  return text
    .replace(/\u0000/g, 'ti')
    .replace(/\r/g, '\n')
}

function normalizeOfficialCourseCode(code: string) {
  const raw = code.trim()
  if (/^0\d{3}0\d{3}$/.test(raw)) {
    return `${raw.slice(1, 4)}${raw.slice(5)}`
  }
  if (raw.length > 6) return raw.replace(/^0+/, '').padStart(6, '0')
  return raw
}

function toSemesterTechnion(label: string) {
  const hit = label.trim().match(/^(20\d{2})-(\d{2})\s+([A-Z]+)$/i)
  if (!hit) return label.trim()
  const startYear = hit[1]
  const endYear = `${startYear.slice(0, 2)}${hit[2]}`
  const term = TERM_TO_TECHNION[hit[3].toUpperCase()] ?? '0'
  return `${startYear}-${endYear}-${term}`
}

function splitCoursePayload(payload: string) {
  for (const credit of CREDIT_VALUES) {
    const escapedCredit = credit.replace('.', '\\.')
    const match = payload.match(new RegExp(`^(.*)${escapedCredit}(\\d{2,3})$`))
    if (!match) continue
    const gradeNumber = Number.parseInt(match[2], 10)
    if (!Number.isFinite(gradeNumber) || gradeNumber < 0 || gradeNumber > 100) continue
    const name = match[1].trim().replace(/\s+/g, ' ')
    if (!name) continue
    return {
      name,
      credits: Number.parseFloat(credit),
      grade: String(gradeNumber),
    }
  }
  return null
}

function parseTranscriptText(text: string): ParsedTranscript {
  const cleanText = normalizePdfText(text)
  const compactText = cleanText.replace(/\s+/g, ' ')
  const studentHit = compactText.match(/Transcript of\s+(.+?)\s+Student ID\s+(\d+)/i)
  const programHit = compactText.match(/Bachelor.s Degree of Engineering in\s+(.+?)\s+and accumulated/i)
  const summaryHit = compactText.match(/accumulated\s+([\d.]+)\s+credit points,\s+with cumulative GPA of\s+([\d.]+)/i)

  const courses: TranscriptCourse[] = []
  for (const rawLine of cleanText.split('\n')) {
    const line = rawLine.replace(/\s+/g, ' ').trim()
    if (!line) continue
    const match = line.match(COURSE_LINE_RE)
    if (!match) continue
    const [, officialCode, payloadText, semesterLabelRaw] = match
    const payload = splitCoursePayload(payloadText)
    if (!payload) continue
    const semesterLabel = semesterLabelRaw.toUpperCase().replace(/\s+/, ' ')
    courses.push({
      code: normalizeOfficialCourseCode(officialCode),
      name: payload.name,
      credits: payload.credits,
      grade: payload.grade,
      semesterLabel,
      semesterTechnion: toSemesterTechnion(semesterLabel),
    })
  }

  if (!courses.length) {
    throw new Error('No transcript courses were found in this PDF.')
  }

  return {
    studentName: studentHit?.[1]?.trim().replace(/\s+/g, ' ') ?? '',
    studentId: studentHit?.[2] ?? '',
    programName: programHit?.[1]?.trim().replace(/\s+/g, ' ') ?? '',
    accumulatedCreditPoints: summaryHit?.[1] ?? '',
    gpa: summaryHit?.[2] ?? '',
    courses,
  }
}

export class TranscriptService {
  constructor(private readonly db: DashboardDb) {}

  async importPdf(payload: { filePath: string }) {
    const filePath = payload.filePath?.trim()
    if (!filePath) throw new Error('Transcript PDF path is empty.')
    if (!filePath.toLowerCase().endsWith('.pdf')) {
      throw new Error('Please choose a PDF transcript file.')
    }

    const buffer = await fs.readFile(filePath)
    const parsedPdf = await pdfParse(buffer)
    const parsed = parseTranscriptText(parsedPdf.text)
    const courseDelta = this.db.upsertStudentsCourses(parsed.courses)

    this.db.setMeta('sync:students:last', {
      at: new Date().toISOString(),
      source: 'transcript-pdf',
      filePath,
      semester: 'Transcript',
      semesterTechnion: 'transcript',
      courseCount: parsed.courses.length,
      examCount: 0,
      delta: {
        courses: courseDelta,
        exams: { inserted: 0, updated: 0, deleted: 0 },
      },
    })
    this.db.setMeta('students:profile', {
      studentId: parsed.studentId,
      programName: parsed.programName,
      chineseName: '',
      pinyinName: parsed.studentName,
      cohort: '',
      gpa: parsed.gpa,
      accumulatedCreditPoints: parsed.accumulatedCreditPoints,
    })

    return {
      filePath,
      studentName: parsed.studentName,
      studentId: parsed.studentId,
      programName: parsed.programName,
      gpa: parsed.gpa,
      accumulatedCreditPoints: parsed.accumulatedCreditPoints,
      courses: parsed.courses,
      delta: courseDelta,
      importedAt: new Date().toISOString(),
    }
  }
}
