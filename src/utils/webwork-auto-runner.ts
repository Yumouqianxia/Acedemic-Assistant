import type { HomeworkAnswerFill, HomeworkFillResult, HomeworkQuestion, HomeworkSolveResult } from '../types/ai-homework'

export type WebworkPage = {
  key: string
  scope: string
  account: string
  label: string
  attempts: number | null
  remaining: number | null
  score: number | null
  attemptScore: number | null
  canSubmit: boolean
  nextKey: string | null
}
export type AutoAttemptRecord = {
  key: string; scope: string; account: string; label: string
  status: 'pending' | 'correct' | 'incorrect' | 'unknown' | 'skipped'
  score: number | null; message: string; at: string
}
export type AutoRunState = { running: boolean; phase: string; message: string; scope: string; account: string }
export type AutoRunAdapter = {
  inspect: () => Promise<WebworkPage | null>
  extract: () => Promise<HomeworkQuestion[]>
  solve: (question: HomeworkQuestion) => Promise<HomeworkSolveResult>
  fill: (question: HomeworkQuestion, fills: HomeworkAnswerFill[]) => Promise<HomeworkFillResult>
  submit: (page: WebworkPage, question: HomeworkQuestion, fills: HomeworkAnswerFill[]) => Promise<boolean>
  next: (page: WebworkPage) => Promise<boolean>
  records: () => AutoAttemptRecord[]
  save: (records: AutoAttemptRecord[]) => void
  update: (state: AutoRunState) => void
  result: (question: HomeworkQuestion, result: HomeworkSolveResult) => void
  wait?: (signal: AbortSignal) => Promise<void>
}

export function parseAutoRecords(value: string | null): AutoAttemptRecord[] {
  if (!value) return []
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item.key !== 'string'
    || typeof item.scope !== 'string' || typeof item.account !== 'string' || typeof item.label !== 'string'
    || !['pending', 'correct', 'incorrect', 'unknown', 'skipped'].includes(item.status)
    || typeof item.message !== 'string' || typeof item.at !== 'string'
    || (item.score !== null && (typeof item.score !== 'number' || !Number.isFinite(item.score))))) {
    throw new Error('自动提交记录无法读取，已暂停以避免重复提交。')
  }
  return parsed as AutoAttemptRecord[]
}

const waitForPage = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const cancel = () => { clearTimeout(timer); reject(new Error('已停止')) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, 500)
  if (signal.aborted) cancel()
  else signal.addEventListener('abort', cancel, { once: true })
})

export class WebworkAutoRunner {
  private controller: AbortController | null = null
  private active: Promise<void> | null = null
  private state: AutoRunState = { running: false, phase: 'idle', message: '', scope: '', account: '' }
  constructor(private readonly adapter: AutoRunAdapter) {}

  private notify(phase: string, message: string) {
    this.state = { ...this.state, phase, message }
    this.adapter.update({ ...this.state })
  }
  stop(message = '已停止；已提交的题目不会再次自动提交。') {
    this.controller?.abort()
    this.state.running = false
    this.notify('stopped', message)
  }
  start(): Promise<void> {
    if (this.active) return this.active
    this.controller = new AbortController()
    this.state.running = true
    const work = this.run(this.controller.signal).finally(() => {
      this.active = null
      this.state.running = false
      this.adapter.update({ ...this.state })
    })
    this.active = work
    return work
  }

  private check(signal: AbortSignal) {
    if (signal.aborted) throw new Error('已停止')
  }
  private async call<T>(signal: AbortSignal, operation: () => Promise<T>, timeout = 15_000): Promise<T> {
    this.check(signal)
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancel: (() => void) | undefined
    try {
      return await Promise.race([
        Promise.resolve().then(() => { this.check(signal); return operation() }),
        new Promise<never>((_resolve, reject) => {
          cancel = () => reject(new Error('已停止'))
          signal.addEventListener('abort', cancel, { once: true })
          timer = setTimeout(() => reject(new Error('等待超时，已暂停；不会自动重复提交。')), timeout)
        }),
      ])
    } finally {
      clearTimeout(timer)
      if (cancel) signal.removeEventListener('abort', cancel)
    }
  }
  private existing(page: WebworkPage) {
    return this.adapter.records().find(record => record.key === page.key && record.account === page.account && record.status !== 'skipped')
  }
  private record(page: WebworkPage, status: AutoAttemptRecord['status'], message: string, score: number | null = null) {
    const records = this.adapter.records().filter(record => record.key !== page.key || record.account !== page.account)
    this.adapter.save([...records, { key: page.key, scope: page.scope, account: page.account,
      label: page.label, status, score, message, at: new Date().toISOString() }])
  }
  private same(page: WebworkPage) {
    if (page.scope !== this.state.scope || page.account !== this.state.account) throw new Error('课程或账号已变化，连续解题已暂停。')
  }
  private async poll(signal: AbortSignal, accept: (page: WebworkPage) => boolean) {
    const started = Date.now()
    for (let i = 0; i < 90 && Date.now() - started < 45_000; i++) {
      this.check(signal)
      let page: WebworkPage | null = null
      try { page = await this.call(signal, this.adapter.inspect, 3000) } catch { /* The document can be unavailable during navigation. */ }
      this.check(signal)
      if (page) { this.same(page); if (accept(page)) return page }
      await (this.adapter.wait || waitForPage)(signal)
    }
    throw new Error('未能确认页面或提交结果，已暂停；不会自动再次提交。')
  }

  private async run(signal: AbortSignal) {
    let pending: WebworkPage | null = null
    try {
      this.notify('reading', '正在读取当前题目…')
      let page = await this.call(signal, this.adapter.inspect)
      this.check(signal)
      if (!page?.account) throw new Error('请先进入已登录的 WeBWorK 具体题目页面。')
      this.state.scope = page.scope
      this.state.account = page.account
      for (let count = 0; count < 200; count++) {
        this.check(signal)
        this.same(page)
        const previous = this.existing(page)
        if (previous) this.notify('skipping', `${page.label} 已有记录，跳过且不再次提交。`)
        else if (page.attempts === null) throw new Error('无法确认已提交次数，已暂停。')
        else if (page.attempts > 0 || page.score === 100 || !page.canSubmit || page.remaining === 0) {
          const incorrect = page.attempts > 0 && page.score !== 100
          this.record(page, incorrect ? 'incorrect' : 'skipped', incorrect
            ? '已有提交且未满分，已标记；不自动二次提交。' : '已完成或不可提交，已跳过。', page.score)
        } else {
          this.notify('solving', `正在解答 ${page.label}…`)
          const questions = await this.call(signal, this.adapter.extract, 25_000)
          this.check(signal)
          if (questions.length !== 1 || !questions[0].answerFields?.length) throw new Error('未能完整读取当前题目的答案框和下拉选项，已暂停。')
          const question = questions[0]
          const result = await this.call(signal, () => this.adapter.solve(question), 130_000)
          this.check(signal)
          this.adapter.result(question, result)
          const names = new Set(result.fills.map(item => item.field))
          if (names.size !== question.answerFields!.length || result.fills.length !== names.size
            || question.answerFields!.some(field => !names.has(field.name))) {
            this.record(page, 'skipped', '答案未完整覆盖所有文本框和下拉框，未提交，需人工检查。')
          } else {
            const before = await this.call(signal, this.adapter.inspect)
            this.check(signal)
            if (!before || before.key !== page.key || before.account !== page.account || before.attempts !== page.attempts) {
              throw new Error('题目或提交次数已变化，已暂停。')
            }
            this.notify('filling', `正在填写 ${page.label} 的全部答案…`)
            const filled = await this.call(signal, () => this.adapter.fill(question, result.fills))
            this.check(signal)
            if (filled.filled !== question.answerFields!.length || filled.skipped) {
              this.record(page, 'skipped', `未提交：${filled.message}`)
            } else {
              if (this.existing(page)) throw new Error('本题已有提交记录，禁止再次自动提交。')
              // Persist intent BEFORE clicking: a crash or missing response must never trigger a retry.
              this.record(page, 'pending', '已准备提交，等待评分确认；本题不会自动重复提交。')
              pending = page
              this.check(signal)
              this.notify('submitting', `正在提交 ${page.label}，本题仅提交一次…`)
              let clicked: boolean | null = null
              try { clicked = await this.call(signal, () => this.adapter.submit(page!, question, result.fills)) } catch { /* Navigation can destroy the script context after clicking. */ }
              this.check(signal)
              if (clicked === false) throw new Error('提交条件发生变化，已暂停，需人工检查。')
              this.notify('grading', '等待本次提交的评分…')
              const graded = await this.poll(signal, current => {
                if (current.key !== page!.key) throw new Error('等待评分时切换了题目，已暂停。')
                return current.attempts !== null && current.attempts > page!.attempts! && current.attemptScore !== null
              })
              const correct = graded.attemptScore === 100
              this.record(page, correct ? 'correct' : 'incorrect', correct
                ? '本次提交正确。' : '本次提交未满分，已标记；暂不二次提交。', graded.attemptScore)
              this.adapter.result(question, result)
              pending = null
              page = graded
            }
          }
        }
        this.check(signal)
        if (!page.nextKey) { this.notify('complete', '已处理到本作业最后一题；标记的题目留待检查。'); return }
        this.notify('navigating', '正在进入下一题…')
        const nextKey = page.nextKey
        if (!await this.call(signal, () => this.adapter.next(page!))) throw new Error('未能安全进入下一题，已暂停。')
        page = await this.poll(signal, current => current.key === nextKey)
      }
      this.notify('paused', '已达到本次连续处理上限，已暂停。')
    } catch (error) {
      if (pending) {
        try { this.record(pending, 'unknown', '提交结果未确认，需人工检查；不自动二次提交。') } catch { /* The earlier pending record remains if storage fails. */ }
      }
      if (!signal.aborted) this.notify('paused', error instanceof Error ? error.message : String(error))
    }
  }
}
