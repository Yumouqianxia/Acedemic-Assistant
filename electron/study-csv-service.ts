import { readFile } from 'node:fs/promises'
import type { StudyTask, StudyTaskInput } from './study-db'

export type CsvTaskRow = StudyTaskInput & {
  rowNumber: number
  id?: number
  courseCode: string
  reminderEnabled: boolean
  errors: string[]
  warnings: string[]
  action: 'create' | 'update' | 'skip' | 'invalid'
}

export type CsvPreview = {
  fileName: string
  headers: string[]
  rows: CsvTaskRow[]
  missingHeaders: string[]
}

const TEMPLATE_HEADERS = [
  'id',
  'course_code',
  'course_name',
  'title',
  'date',
  'start_time',
  'duration_minutes',
  'priority',
  'description',
  'note_id',
  'reminder',
]

const HEADER_ALIASES: Record<string, string> = {
  id: 'id',
  taskid: 'id',
  coursecode: 'courseCode',
  course: 'courseCode',
  coursename: 'courseName',
  title: 'title',
  task: 'title',
  tasktitle: 'title',
  date: 'scheduledDate',
  scheduleddate: 'scheduledDate',
  starttime: 'startTime',
  time: 'startTime',
  durationminutes: 'estimatedMinutes',
  duration: 'estimatedMinutes',
  minutes: 'estimatedMinutes',
  priority: 'priority',
  description: 'description',
  details: 'description',
  noteid: 'noteId',
  reminder: 'reminderEnabled',
  notify: 'reminderEnabled',
}

export function csvTemplateContent() {
  return `\uFEFF${TEMPLATE_HEADERS.join(',')}\r\n`
}

export function csvTasksContent(tasks: Array<StudyTask & { courseCode?: string }>) {
  const rows = tasks.map((task) => [
    task.id,
    task.courseCode ?? '',
    task.courseName,
    task.title,
    task.scheduledDate,
    task.startTime,
    task.estimatedMinutes,
    task.priority,
    task.description,
    task.noteId ?? '',
    task.reminderAt ? 'true' : 'false',
  ].map(csvCell).join(','))
  return `\uFEFF${TEMPLATE_HEADERS.join(',')}\r\n${rows.join('\r\n')}${rows.length ? '\r\n' : ''}`
}

export async function parseStudyTaskCsv(filePath: string): Promise<CsvPreview> {
  const source = await readFile(filePath, 'utf8')
  const matrix = parseCsv(source.replace(/^\uFEFF/, ''))
  if (!matrix.length) throw new Error('The CSV file is empty')
  const rawHeaders = matrix[0].map((header) => header.trim())
  const mappedHeaders = rawHeaders.map((header) => HEADER_ALIASES[normalizeHeader(header)] ?? '')
  const missingHeaders = ['title', 'scheduledDate'].filter((required) => !mappedHeaders.includes(required))
  const rows = matrix.slice(1)
    .map((cells, index) => toTaskRow(cells, mappedHeaders, index + 2))
    .filter((row) => row !== null) as CsvTaskRow[]
  return {
    fileName: filePath.split(/[\\/]/).pop() || 'study-tasks.csv',
    headers: rawHeaders,
    rows,
    missingHeaders,
  }
}

function toTaskRow(cells: string[], mappedHeaders: string[], rowNumber: number): CsvTaskRow | null {
  if (cells.every((cell) => !cell.trim())) return null
  const record: Record<string, string> = {}
  mappedHeaders.forEach((header, index) => {
    if (header) record[header] = cells[index]?.trim() ?? ''
  })
  const errors: string[] = []
  const warnings: string[] = []
  const idText = record.id || ''
  const id = idText ? Number.parseInt(idText, 10) : undefined
  if (idText && (!Number.isInteger(id) || Number(id) <= 0)) errors.push('id must be a positive integer')
  const title = record.title || ''
  if (!title) errors.push('title is required')
  const scheduledDate = normalizeDate(record.scheduledDate || '')
  if (!scheduledDate) errors.push('date must use YYYY-MM-DD')
  const startTime = normalizeTime(record.startTime || '')
  if (record.startTime && !startTime) errors.push('start_time must use HH:mm')
  const duration = record.estimatedMinutes ? Number.parseInt(record.estimatedMinutes, 10) : 50
  if (!Number.isInteger(duration) || duration < 1 || duration > 720) errors.push('duration_minutes must be between 1 and 720')
  const priority = record.priority ? Number.parseInt(record.priority, 10) : 2
  if (![1, 2, 3].includes(priority)) errors.push('priority must be 1, 2, or 3')
  const reminderEnabled = parseBoolean(record.reminderEnabled || '')
  if (record.reminderEnabled && reminderEnabled === null) errors.push('reminder must be true or false')
  if (reminderEnabled && !startTime) warnings.push('reminder ignored because start_time is empty')
  const reminderAt = reminderEnabled && scheduledDate && startTime
    ? new Date(`${scheduledDate}T${startTime}:00`).toISOString()
    : null
  return {
    rowNumber,
    ...(id ? { id } : {}),
    courseCode: record.courseCode || '',
    courseKey: '',
    courseName: record.courseName || '',
    title,
    description: record.description || '',
    scheduledDate: scheduledDate || record.scheduledDate || '',
    startTime: startTime || record.startTime || '',
    estimatedMinutes: Number.isInteger(duration) ? duration : 50,
    priority: [1, 2, 3].includes(priority) ? priority as 1 | 2 | 3 : 2,
    noteId: record.noteId || null,
    reminderAt,
    reminderEnabled: reminderEnabled === true,
    errors,
    warnings,
    action: errors.length ? 'invalid' : id ? 'update' : 'create',
  }
}

function parseCsv(source: string) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
      continue
    }
    if (char === '"' && !field) {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, '').replace(/[^a-z0-9]/g, '')
}

function normalizeDate(value: string) {
  const hit = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (!hit) return ''
  const month = Number(hit[2])
  const day = Number(hit[3])
  const date = new Date(Number(hit[1]), month - 1, day)
  if (date.getFullYear() !== Number(hit[1]) || date.getMonth() !== month - 1 || date.getDate() !== day) return ''
  return `${hit[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function normalizeTime(value: string) {
  if (!value) return ''
  const hit = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!hit || Number(hit[1]) > 23 || Number(hit[2]) > 59) return ''
  return `${String(Number(hit[1])).padStart(2, '0')}:${hit[2]}`
}

function parseBoolean(value: string): boolean | null {
  if (!value) return false
  if (/^(true|yes|y|1|是)$/i.test(value)) return true
  if (/^(false|no|n|0|否)$/i.test(value)) return false
  return null
}

function csvCell(value: string | number) {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
