export type AcademicTerm = 'Fall' | 'Winter' | 'Spring' | 'Summer'

export type TermMeta = { key: string; label: string; sortScore: number }

type CourseTerm = { semesterLabel: string; courseName: string; semesterTechnion: string }

const termNames: Record<string, AcademicTerm> = {
  fall: 'Fall', autumn: 'Fall', winter: 'Winter',
  spring: 'Spring', sping: 'Spring', summer: 'Summer',
}
const termOrder: Record<AcademicTerm, number> = { Fall: 1, Winter: 2, Spring: 3, Summer: 4 }
const seasonPattern = '(spring|sping|summer|fall|autumn|winter)'
const yearPattern = '(20\\d{2}|\\d{2})'

const fullYear = (text: string) => {
  const year = Number(text)
  return text.length === 4 ? year : year >= 70 ? 1900 + year : 2000 + year
}

const makeTerm = (startYear: number, term: AcademicTerm): TermMeta => ({
  key: `${startYear}-${term}`,
  label: `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)} ${term}`,
  sortScore: startYear * 10 + termOrder[term],
})

export function parseTermText(text: string): TermMeta | null {
  const raw = text.trim()
  if (!raw) return null

  const yearRange = `${yearPattern}\\s*[-/]\\s*${yearPattern}`
  const rangeFirst = raw.match(new RegExp(`\\b${yearRange}\\s*[-/ ]*\\s*${seasonPattern}\\b`, 'i'))
  const seasonFirst = raw.match(new RegExp(`\\b${seasonPattern}\\s*[-/ ]*\\s*${yearRange}\\b`, 'i'))
  if (rangeFirst || seasonFirst) {
    const start = fullYear(rangeFirst ? rangeFirst[1] : seasonFirst![2])
    const end = fullYear(rangeFirst ? rangeFirst[2] : seasonFirst![3])
    const term = termNames[(rangeFirst ? rangeFirst[3] : seasonFirst![1]).toLowerCase()]
    if (end === start + 1) return makeTerm(start, term)
  }

  const termFirst = raw.match(new RegExp(`\\b${seasonPattern}\\s*[-/ ]*\\s*${yearPattern}\\b`, 'i'))
  const yearFirst = raw.match(new RegExp(`\\b${yearPattern}\\s*[-/ ]*\\s*${seasonPattern}\\b`, 'i'))
  if (termFirst || yearFirst) {
    const term = termNames[(termFirst ? termFirst[1] : yearFirst![2]).toLowerCase()]
    const year = fullYear(termFirst ? termFirst[2] : yearFirst![1])
    // GTIIT's Winter 2026 starts the 2026–27 academic year, like Fall.
    return makeTerm(term === 'Fall' || term === 'Winter' ? year : year - 1, term)
  }

  const technion = raw.match(/\b(20\d{2})\D*(20\d{2})\D*([1234])\b/)
  if (technion) {
    const term: AcademicTerm = technion[3] === '2' ? 'Spring'
      : technion[3] === '3' ? 'Summer' : technion[3] === '4' ? 'Winter' : 'Fall'
    return makeTerm(Number(technion[1]), term)
  }
  return null
}

export function resolveCourseTerm(course: CourseTerm): TermMeta {
  // Human-readable Moodle labels take precedence over legacy stored term codes.
  for (const text of [course.semesterLabel, course.courseName, course.semesterTechnion]) {
    const term = parseTermText(text || '')
    if (term) return term
  }
  const label = (course.semesterLabel || course.semesterTechnion || 'Unknown term').trim() || 'Unknown term'
  return { key: `unknown:${label}`, label, sortScore: -1 }
}

export function latestTermCourses<T extends CourseTerm>(courses: T[]): T[] {
  const latest = courses.reduce((score, course) => Math.max(score, resolveCourseTerm(course).sortScore), -1)
  return latest < 0 ? courses : courses.filter((course) => resolveCourseTerm(course).sortScore === latest)
}
