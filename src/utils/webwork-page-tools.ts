import type { HomeworkAnswerFill, HomeworkQuestion } from '../types/ai-homework'
import type { WebworkPage } from './webwork-auto-runner'
import { createHomeworkAnswerTools } from './homework-answer-fields'

// Runs in the guest. URLs returned to the app omit all authentication queries.
export function createWebworkPageTools(answerTools: ReturnType<typeof createHomeworkAnswerTools>) {
  const clean = (text: string | null | undefined) => (text || '').replace(/\s+/g, ' ').trim()
  const pathInfo = (url: URL) => {
    const match = url.pathname.match(/^\/webwork2\/([^/]+)\/([^/]+)\/(\d+)\/?$/)
    return match ? { key: `${url.origin}${url.pathname.replace(/\/$/, '')}`,
      scope: `${url.origin}/webwork2/${match[1]}/${match[2]}/`, number: Number(match[3]) } : null
  }
  const nextLink = () => Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .find(link => /^(?:next problem|下一题)$/i.test(clean(link.textContent)) && link.getAttribute('aria-disabled') !== 'true')
  const submitButton = (form: HTMLFormElement) => Array.from(form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
    'button[name="submitAnswers"], input[type="submit"][name="submitAnswers"]',
  )).find(button => !button.disabled && button.form === form)
  const inspect = (): WebworkPage | null => {
    const url = new URL(location.href)
    const path = pathInfo(url)
    const root = document.querySelector('#problem_body')
    const form = root?.closest('form')
    const account = url.searchParams.get('effectiveUser')
      || document.querySelector<HTMLInputElement>('input[name="effectiveUser"]')?.value
      || document.querySelector<HTMLInputElement>('input[name="user"]')?.value || ''
    if (!path || !root || !(form instanceof HTMLFormElement) || !account || document.readyState === 'loading') return null
    const summary = form.cloneNode(true) as Element
    summary.querySelectorAll('#problem_body, .problem-content, script, .hint, .solution').forEach(node => node.remove())
    const text = clean(summary.textContent)
    const attemptsText = text.match(/You have attempted this problem\s+(\d+)\s+times?\./i)?.[1]
      || form.querySelector<HTMLInputElement>('#num_attempts, input[name="num_attempts"]')?.value
    const attempts = attemptsText && /^\d+$/.test(attemptsText) ? Number(attemptsText) : null
    const score = text.match(/Your overall recorded score is\s+([\d.]+)%/i)?.[1]
    const attemptScore = text.match(/You received a score of\s+([\d.]+)%\s+for this attempt/i)?.[1]
    const remaining = text.match(/You have\s+(\d+)\s+attempts?\s+remaining/i)?.[1]
    const next = nextLink()
    const nextUrl = next ? new URL(next.href, url) : null
    const nextPath = nextUrl && pathInfo(nextUrl)
    const safeNext = nextPath && nextPath.scope === path.scope && nextPath.number > path.number
      && (!nextUrl!.searchParams.has('effectiveUser') || nextUrl!.searchParams.get('effectiveUser') === account)
    return { ...path, account,
      label: clean(document.querySelector('#page-title, h1')?.textContent) || `Problem ${path.number}`,
      attempts, remaining: remaining === undefined ? null : Number(remaining),
      score: score === undefined ? null : Number(score),
      attemptScore: attemptScore === undefined ? null : Number(attemptScore),
      canSubmit: Boolean(submitButton(form)), nextKey: safeNext ? nextPath.key : null }
  }
  const submit = (expected: WebworkPage, question: HomeworkQuestion, fills: HomeworkAnswerFill[]) => {
    const page = inspect()
    const form = document.querySelector('#problem_body')?.closest('form')
    if (!page || !(form instanceof HTMLFormElement) || page.key !== expected.key || page.account !== expected.account
      || page.attempts !== 0 || expected.attempts !== 0 || !page.canSubmit
      || !answerTools.matches(question, fills) || !form.checkValidity()
      || form.hasAttribute('data-campus-auto-submitted')) return false
    const action = new URL(form.action || location.href, location.href)
    if (pathInfo(action)?.key !== page.key) return false
    const button = submitButton(form)
    if (!button) return false
    form.setAttribute('data-campus-auto-submitted', 'true')
    button.click()
    return true
  }
  const next = (expected: WebworkPage) => {
    const page = inspect()
    const link = nextLink()
    if (!page || page.key !== expected.key || page.account !== expected.account
      || !page.nextKey || page.nextKey !== expected.nextKey || !link) return false
    link.click()
    return true
  }
  return { inspect, submit, next }
}

const toolsScript = () => `(${createWebworkPageTools.toString()})((${createHomeworkAnswerTools.toString()})())`
export const getWebworkInspectScript = () => `${toolsScript()}.inspect()`
export const getWebworkSubmitScript = (page: WebworkPage, question: HomeworkQuestion, fills: HomeworkAnswerFill[]) => {
  const target = { fillContext: question.fillContext, answerFields: question.answerFields }
  return `${toolsScript()}.submit(${JSON.stringify(page)},${JSON.stringify(target)},${JSON.stringify(fills)})`
}
export const getWebworkNextScript = (page: WebworkPage) => `${toolsScript()}.next(${JSON.stringify(page)})`
