import type { StudyTask } from './study-db'

const DAY_MS = 24 * 60 * 60 * 1000
const START_MINUTE = 8 * 60
const END_MINUTE = 22 * 60
const TOTAL_MINUTES = END_MINUTE - START_MINUTE
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS)
}

function startOfWeek(date: Date) {
  const weekday = (date.getDay() + 6) % 7
  return addDays(date, -weekday)
}

function minuteOfDay(time: string) {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

function taskKind(task: StudyTask) {
  const course = task.courseName.toLowerCase()
  if (course.includes('algebra')) return { className: 'algebra', label: 'A' }
  if (course.includes('calculus')) return { className: 'calculus', label: 'C' }
  return { className: 'general', label: 'G' }
}

function taskBlock(task: StudyTask) {
  const start = Math.max(START_MINUTE, minuteOfDay(task.startTime || '08:00'))
  const end = Math.min(END_MINUTE, start + Math.max(20, task.estimatedMinutes || 50))
  if (end <= START_MINUTE || start >= END_MINUTE) return ''
  const top = ((start - START_MINUTE) / TOTAL_MINUTES) * 100
  const height = Math.max(2.8, ((end - start) / TOTAL_MINUTES) * 100)
  const kind = taskKind(task)
  const done = task.status === 'done' ? ' done' : ''
  if (task.estimatedMinutes <= 30) {
    const compactFont = task.estimatedMinutes <= 20 ? 4.5 : 5.2
    return `<article class="task ${kind.className} compact${done}" style="top:${top}%;height:${height}%;--compact-font:${compactFont}pt">
      <div class="compact-text"><b>[${kind.label}] ${escapeHtml(task.startTime)}</b> ${escapeHtml(task.title)}</div>
    </article>`
  }
  return `<article class="task ${kind.className}${done}" style="top:${top}%;height:${height}%">
    <div class="task-time"><b>[${kind.label}]</b> ${escapeHtml(task.startTime)} · ${task.estimatedMinutes} 分钟</div>
    <div class="task-title">${escapeHtml(task.title)}</div>
  </article>`
}

function routineBand(startMinute: number, endMinute: number, className: string, label: string) {
  const top = ((startMinute - START_MINUTE) / TOTAL_MINUTES) * 100
  const height = ((endMinute - startMinute) / TOTAL_MINUTES) * 100
  return `<div class="routine ${className}" style="top:${top}%;height:${height}%"><span>${label}</span></div>`
}

function weekPage(weekStart: Date, tasksByDate: Map<string, StudyTask[]>, index: number, total: number) {
  const days = Array.from({ length: 7 }, (_, dayIndex) => addDays(weekStart, dayIndex))
  const weekEnd = days[6]
  const dayColumns = days.map((day, dayIndex) => {
    const key = dateKey(day)
    const blocks = (tasksByDate.get(key) ?? []).map(taskBlock).join('')
    return `<section class="day">
      <header class="day-head"><strong>${WEEKDAYS[dayIndex]}</strong><span>${day.getMonth() + 1}/${day.getDate()}</span></header>
      <div class="day-body">
        ${routineBand(13 * 60, 14 * 60, 'lunch', '午餐 · 午休')}
        ${routineBand(16 * 60, 18 * 60, 'exercise', '运动 · 洗澡 · 晚餐')}
        ${blocks || '<div class="empty">无任务</div>'}
      </div>
    </section>`
  }).join('')

  const range = `${weekStart.getFullYear()}年${weekStart.getMonth() + 1}月${weekStart.getDate()}日 — ${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`
  return `<main class="page">
    <header class="page-head">
      <div><h1>学习计划周历</h1><p>${range}</p></div>
      <div class="legend"><span class="legend-a">[A] Algebra</span><span class="legend-c">[C] Calculus</span><span class="legend-g">[G] General</span><span>完成项以删除线显示</span></div>
    </header>
    <div class="calendar">
      <aside class="time-axis">
        <div class="axis-spacer"></div>
        <div class="axis-body">${Array.from({ length: 15 }, (_, hour) => `<span style="top:${hour / 14 * 100}%">${String(hour + 8).padStart(2, '0')}:00</span>`).join('')}</div>
      </aside>
      ${dayColumns}
    </div>
    <footer>黑白打印版 · 任务高度按时长显示 · 第 ${index + 1}/${total} 页</footer>
  </main>`
}

export function buildStudyCalendarHtml(tasks: StudyTask[]) {
  if (!tasks.length) throw new Error('No study tasks are available to export.')
  const sorted = [...tasks].sort((a, b) => `${a.scheduledDate} ${a.startTime}`.localeCompare(`${b.scheduledDate} ${b.startTime}`))
  const firstWeek = startOfWeek(parseDateKey(sorted[0].scheduledDate))
  const lastWeek = startOfWeek(parseDateKey(sorted[sorted.length - 1].scheduledDate))
  const weekCount = Math.round((lastWeek.getTime() - firstWeek.getTime()) / (7 * DAY_MS)) + 1
  const tasksByDate = new Map<string, StudyTask[]>()
  for (const task of sorted) {
    const list = tasksByDate.get(task.scheduledDate) ?? []
    list.push(task)
    tasksByDate.set(task.scheduledDate, list)
  }
  const pages = Array.from({ length: weekCount }, (_, index) => weekPage(addDays(firstWeek, index * 7), tasksByDate, index, weekCount)).join('')

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 7mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; color: #000; background: #fff; font-family: "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif; }
    .page { height: 196mm; page-break-after: always; display: flex; flex-direction: column; overflow: hidden; }
    .page:last-child { page-break-after: auto; }
    .page-head { height: 18mm; display: flex; align-items: center; justify-content: space-between; border-bottom: 1.2pt solid #000; }
    h1 { margin: 0; font-size: 15pt; line-height: 1.1; } .page-head p { margin: 2mm 0 0; font-size: 8.5pt; }
    .legend { display: flex; align-items: center; gap: 3mm; font-size: 7.2pt; white-space: nowrap; }
    .legend span { padding: 1.2mm 2mm; border: 1pt solid #000; } .legend-c { border-style: dashed !important; } .legend-g { border-style: double !important; border-width: 2pt !important; }
    .calendar { flex: 1; min-height: 0; display: grid; grid-template-columns: 11mm repeat(7, 1fr); border-bottom: 1pt solid #000; }
    .time-axis, .day { min-width: 0; border-right: .7pt solid #777; }
    .day:last-child { border-right: 1pt solid #000; }
    .axis-spacer, .day-head { height: 11mm; border-bottom: 1pt solid #000; }
    .day-head { display: flex; align-items: center; justify-content: space-between; padding: 0 2mm; font-size: 8pt; }
    .day-head strong { font-size: 9pt; } .day-head span { font-variant-numeric: tabular-nums; }
    .axis-body, .day-body { position: relative; height: calc(100% - 11mm); }
    .day-body { background-image: repeating-linear-gradient(to bottom, transparent 0, transparent calc(7.142857% - .25pt), #bbb calc(7.142857% - .25pt), #bbb 7.142857%); }
    .axis-body span { position: absolute; right: 1.5mm; transform: translateY(-50%); font: 6.7pt/1 Arial, sans-serif; font-variant-numeric: tabular-nums; }
    .task { position: absolute; left: 1.2mm; right: 1.2mm; z-index: 3; overflow: hidden; padding: .8mm 1mm; background: #fff; border: 1.2pt solid #000; }
    .task.calculus { border-style: dashed; } .task.general { border-style: double; border-width: 2pt; }
    .task.done { background: #eee; } .task.done .task-title { text-decoration: line-through; }
    .task-time { font-size: 6.1pt; line-height: 1.15; white-space: nowrap; } .task-title { margin-top: .5mm; font-size: 7.1pt; line-height: 1.18; font-weight: 700; overflow-wrap: anywhere; }
    .task.compact { padding: .25mm .55mm; display: flex; align-items: flex-start; }
    .compact-text { font-size: var(--compact-font); line-height: 1; font-weight: 700; overflow-wrap: anywhere; }
    .task.done .compact-text { text-decoration: line-through; }
    .routine { position: absolute; left: 0; right: 0; z-index: 1; display: flex; align-items: center; justify-content: center; border-top: .5pt solid #555; border-bottom: .5pt solid #555; color: #222; font-size: 6.2pt; font-weight: 700; }
    .routine span { padding: .5mm 1mm; background: rgba(255,255,255,.82); }
    .lunch { background: repeating-linear-gradient(135deg, #fff 0, #fff 2mm, #ddd 2mm, #ddd 2.4mm); }
    .exercise { background: radial-gradient(#999 .35mm, transparent .4mm); background-size: 2.4mm 2.4mm; }
    .empty { position: absolute; top: 2mm; left: 0; right: 0; text-align: center; font-size: 6.5pt; color: #666; }
    footer { height: 6mm; display: flex; align-items: end; justify-content: flex-end; font-size: 6.5pt; }
  </style></head><body>${pages}</body></html>`
}
