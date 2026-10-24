import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/utils/webwork-auto-runner.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } })
const { WebworkAutoRunner, parseAutoRecords } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const field = (name, kind = 'text') => ({ name, kind, label: name, options: [], currentValues: [] })

function fixture({ scores = [100, 0, 50], missingDropdown = false, noResponse = false,
  storageFails = false, destroyedContext = false, solve } = {}) {
  const pages = scores.map((_score, index) => ({ key: `https://ww.example/webwork2/course/set/${index + 1}`,
    scope: 'https://ww.example/webwork2/course/set/', account: 'student', label: `Problem ${index + 1}`,
    attempts: 0, remaining: 4, score: null, attemptScore: null, canSubmit: true,
    nextKey: index + 1 === scores.length ? null : `https://ww.example/webwork2/course/set/${index + 2}` }))
  let index = 0
  let stored = '[]'
  let state
  const calls = { solve: [], fill: [], submit: [], next: [] }
  const question = () => ({ id: pages[index].key, number: pages[index].label,
    prompt: 'Mixed text and dropdown problem', answerFields: [field('text'), field('inequality', 'select')] })
  const answer = () => ({ answer: 'Explanation', model: 'mock', fills: [
    { field: 'text', values: ['2'] }, ...missingDropdown ? [] : [{ field: 'inequality', values: ['lt'] }],
  ] })
  const adapter = {
    inspect: async () => structuredClone(pages[index]),
    extract: async () => [question()],
    solve: async (q) => { calls.solve.push(q.id); return solve ? solve(q) : answer() },
    fill: async () => { calls.fill.push(pages[index].key); return { filled: 2, skipped: 0, message: 'filled' } },
    submit: async (page) => {
      assert.equal(parseAutoRecords(stored).find(record => record.key === page.key)?.status, 'pending', 'intent must be durable before click')
      calls.submit.push(page.key)
      if (!noResponse) Object.assign(pages[index], { attempts: pages[index].attempts + 1, attemptScore: scores[index], score: 100 })
      if (destroyedContext) throw new Error('Execution context destroyed')
      return true
    },
    next: async (page) => { calls.next.push(page.key); index++; return true },
    records: () => parseAutoRecords(stored),
    save: records => { if (storageFails) throw new Error('Storage unavailable'); stored = JSON.stringify(records) },
    update: value => { state = value }, result: () => {}, wait: async () => {},
  }
  return { pages, calls, adapter, answer, records: () => parseAutoRecords(stored), state: () => state,
    reset: () => { index = 0 }, runner: () => new WebworkAutoRunner(adapter) }
}

test('solves, submits once, marks incorrect/partial attempts, and proceeds to the last problem', async () => {
  const f = fixture()
  await f.runner().start()
  assert.equal(f.calls.submit.length, 3)
  assert.deepEqual(f.records().map(record => record.status), ['correct', 'incorrect', 'incorrect'])
  assert.deepEqual(f.records().map(record => record.score), [100, 0, 50], 'use THIS attempt, even when the historical best is 100%')
  assert.equal(f.state().phase, 'complete')
  f.reset()
  await f.runner().start()
  assert.equal(f.calls.submit.length, 3, 'persistent records prevent resubmission after restart')
})

test('double start never runs two submission loops', async () => {
  const f = fixture({ scores: [100] })
  const runner = f.runner()
  const one = runner.start(), two = runner.start()
  assert.equal(one, two)
  await Promise.all([one, two])
  assert.equal(f.calls.submit.length, 1)
})

test('already attempted wrong problems are marked without consuming a second attempt', async () => {
  const f = fixture({ scores: [0, 100] })
  Object.assign(f.pages[0], { attempts: 1, score: 50 })
  await f.runner().start()
  assert.equal(f.calls.submit.length, 1)
  assert.equal(f.records()[0].status, 'incorrect')
  assert.equal(f.pages[0].attempts, 1)
})

test('missing dropdown answers are skipped without filling or submitting', async () => {
  const f = fixture({ scores: [100], missingDropdown: true })
  await f.runner().start()
  assert.equal(f.calls.fill.length, 0)
  assert.equal(f.calls.submit.length, 0)
  assert.equal(f.records()[0].status, 'skipped')
})

test('unknown response pauses and remains locked against automatic retries after restart', async () => {
  const f = fixture({ noResponse: true })
  await f.runner().start()
  assert.equal(f.calls.submit.length, 1)
  assert.equal(f.calls.next.length, 0)
  assert.equal(f.records()[0].status, 'unknown')
  assert.equal(f.state().phase, 'paused')
  await f.runner().start()
  assert.equal(f.calls.submit.filter(key => key === f.pages[0].key).length, 1)
})

test('a script-context error after the click still waits for the grade instead of clicking again', async () => {
  const f = fixture({ scores: [100], destroyedContext: true })
  await f.runner().start()
  assert.equal(f.calls.submit.length, 1)
  assert.equal(f.records()[0].status, 'correct')
})

test('storage failure prevents the submit click', async () => {
  const f = fixture({ scores: [100], storageFails: true })
  await f.runner().start()
  assert.equal(f.calls.submit.length, 0)
  assert.equal(f.state().phase, 'paused')
})

test('stopping while the model is solving discards the late answer and performs no writes', async () => {
  let finish
  const f = fixture({ scores: [100], solve: () => new Promise(resolve => { finish = resolve }) })
  const runner = f.runner()
  const work = runner.start()
  while (!finish) await Promise.resolve()
  runner.stop()
  await work
  finish(f.answer())
  await Promise.resolve()
  assert.equal(f.calls.fill.length, 0)
  assert.equal(f.calls.submit.length, 0)
  assert.equal(f.state().phase, 'stopped')
})

test('edited answers and account changes stop the loop without submission', async () => {
  const f = fixture({ scores: [100] })
  f.adapter.fill = async () => ({ filled: 1, skipped: 1, message: 'user edited an answer' })
  await f.runner().start()
  assert.equal(f.calls.submit.length, 0)
  const g = fixture({ scores: [100] })
  g.adapter.solve = async () => { g.pages[0].account = 'another-student'; return g.answer() }
  await g.runner().start()
  assert.equal(g.calls.submit.length, 0)
  assert.equal(g.state().phase, 'paused')
})

test('corrupt stored history is never treated as an empty history', () => {
  assert.deepEqual(parseAutoRecords(null), [])
  assert.throws(() => parseAutoRecords('not json'))
  assert.throws(() => parseAutoRecords('[{"key":"problem"}]'))
})
