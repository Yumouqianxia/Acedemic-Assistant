import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/utils/academic-terms.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
})
const { parseTermText, resolveCourseTerm, latestTermCourses } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)
const course = (semesterLabel, extra = {}) => ({ semesterLabel, courseName: '', semesterTechnion: '', ...extra })

test('Winter 2026 follows Summer 2026 and precedes Spring 2027', () => {
  const terms = ['Summer 2026', 'Winter 2026', 'Spring 2027'].map(parseTermText)
  assert.ok(terms[0].sortScore < terms[1].sortScore)
  assert.ok(terms[1].sortScore < terms[2].sortScore)
  assert.equal(terms[1].label, '26-27 Winter')
  assert.equal(parseTermText('Winter 2025').sortScore < terms[0].sortScore, true)
})

test('equivalent single-year, academic-year and Technion labels resolve consistently', () => {
  for (const text of ['Winter 2026', '26 Winter', '2026-2027 Winter', '26-27 Winter',
    'Winter 2026/27', '2026-2027-4', '202620274']) {
    assert.equal(parseTermText(text)?.key, '2026-Winter', text)
  }
  for (const text of ['Spring 2027', '2026-27 Spring', '202620272', 'Sping 2027']) {
    assert.equal(parseTermText(text)?.key, '2026-Spring', text)
  }
  assert.equal(parseTermText('Autumn 2026')?.key, '2026-Fall')
})

test('Moodle labels override conflicting legacy stored codes; names and codes are fallbacks', () => {
  assert.equal(resolveCourseTerm(course('26 Winter', { semesterTechnion: '2025-2026-4' })).key, '2026-Winter')
  assert.equal(resolveCourseTerm(course('', { courseName: '01040041 - CALCULUS - Winter 2026' })).key, '2026-Winter')
  assert.equal(resolveCourseTerm(course('', { semesterTechnion: '202620272' })).key, '2026-Spring')
})

test('dashboard selects all Winter courses even when Summer has more courses', () => {
  const winter = [course('Winter 2026'), course('26 Winter')]
  const courses = [...Array.from({ length: 10 }, () => course('Summer 2026')), ...winter,
    course('Spring 2026'), course('Winter 2025'), course('Unknown')]
  assert.deepEqual(latestTermCourses(courses), winter)
  assert.deepEqual(latestTermCourses([...courses, course('Spring 2027')]), [course('Spring 2027')])
})

test('empty and unrecognised terms preserve the available courses', () => {
  assert.equal(parseTermText(''), null)
  assert.equal(parseTermText('General course'), null)
  assert.deepEqual(latestTermCourses([]), [])
  const courses = [course(''), course('General')]
  assert.deepEqual(latestTermCourses(courses), courses)
})
