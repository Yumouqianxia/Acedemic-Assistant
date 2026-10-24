import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../electron/services/ai-answer-format.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } })
const { parseAnswerFills } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const field = (name, kind = 'text', options = []) => ({ name, kind, options, currentValues: [], label: name })
const question = { answerFields: [field('AnSwEr0001'), field('choice', 'radio', [{ value: '42', label: 'B' }])] }
const response = (answers) => `## 思路\nReasoning\n## 答案\n42\n## 检查\nChecked\n\`\`\`answer-fields\n${JSON.stringify({ answers })}\n\`\`\``

test('extracts named values while keeping the explanation readable', () => {
  const answers = [{ field: 'AnSwEr0001', values: ['sqrt(2)'], latex: '\\sqrt{2}' }, { field: 'choice', values: ['42'] }]
  const result = parseAnswerFills(response(answers), question)
  assert.deepEqual(result.fills, answers)
  assert.match(result.answer, /## 答案/)
  assert.doesNotMatch(result.answer, /answer-fields/)
})

test('rejects unknown, duplicate or invalid option mappings without guessing', () => {
  for (const answers of [
    [{ field: 'submitAnswers', values: ['1'] }],
    [{ field: 'choice', values: ['B'] }],
    [{ field: 'AnSwEr0001', values: ['1', '2'] }],
    [{ field: 'AnSwEr0001', values: ['1'] }, { field: 'AnSwEr0001', values: ['2'] }],
  ]) assert.deepEqual(parseAnswerFills(response(answers), question).fills, [])
})

test('missing, malformed and ambiguous JSON preserves the explanation but cannot fill', () => {
  for (const value of ['## 答案\n42', '## 答案\n42\n```answer-fields\ninvalid\n```', response([]) + response([])]) {
    const result = parseAnswerFills(value, question)
    assert.equal(result.fills.length, 0)
    assert.match(result.answer, /42/)
  }
})

test('MathQuill fields require equivalent LaTeX; plain values alone are insufficient', () => {
  const q = { answerFields: [{ ...field('math'), mathInput: true }] }
  assert.equal(parseAnswerFills(response([{ field: 'math', values: ['1/2'] }]), q).fills.length, 0)
  assert.equal(parseAnswerFills(response([{ field: 'math', values: ['1/2'], latex: '\\frac{1}{2}' }]), q).fills.length, 1)
})

test('supports checkbox groups and rejects nonnumeric number fields', () => {
  const q = { answerFields: [field('checks', 'checkbox', [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]), field('num', 'number')] }
  for (const values of [[], ['a'], ['a', 'b']]) {
    assert.equal(parseAnswerFills(response([{ field: 'checks', values }]), q).fills.length, 1)
  }
  assert.equal(parseAnswerFills(response([{ field: 'num', values: ['sqrt(2)'] }]), q).fills.length, 0)
})
