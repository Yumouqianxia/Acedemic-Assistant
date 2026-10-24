import type { HomeworkAnswerField, HomeworkAnswerFill, HomeworkFillResult, HomeworkQuestion } from '../types/ai-homework'

// Serialized into the isolated guest page. All browser helpers stay in this closure.
export function createHomeworkAnswerTools() {
  type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  type MathEditor = Element & { input?: Control; mathField?: { latex: (value: string) => unknown } }
  const mathEditor = (input: Control) => {
    const editors = (window as Window & { answerQuills?: Record<string, MathEditor> }).answerQuills
    const editor = editors?.[input.id || input.name]
      || document.getElementById(`mq-answer-${input.id || input.name}`) as MathEditor | null
    return editor && (editor.input === input || input.parentElement?.contains(editor)) ? editor : null
  }
  const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
  const placeholder = (option: HTMLOptionElement) => option.disabled || option.hidden || option.value === ''
    || /^(?:select(?:\s+(?:one|an?\s+(?:answer|option)))?|choose(?:\s+(?:one|an?\s+(?:answer|option)))?|please\s+(?:select|choose).*|请选择.*|选择|\?+|-+|—+)(?:\s*\.{3})?$/i.test(clean(option.textContent))
  const controls = (root: Element) => Array.from(root.querySelectorAll<Control>('input, textarea, select'))
    .filter(input => input.name && !input.disabled && !('readOnly' in input && input.readOnly)
      && !input.closest('.mq-editable-field, .mq-textarea, .hint, .solution')
      && ['text', 'number', 'textarea', 'select-one', 'radio', 'checkbox'].includes(input.type))
  const current = (inputs: Control[]) => inputs.filter(input =>
    input instanceof HTMLSelectElement ? Boolean(input.selectedOptions[0] && !placeholder(input.selectedOptions[0]))
      : input instanceof HTMLInputElement && ['radio', 'checkbox'].includes(input.type) ? input.checked : Boolean(input.value),
  ).map(input => input.value)

  const describe = (root: Element): HomeworkAnswerField[] => {
    const groups = new Map<string, Control[]>()
    for (const input of controls(root)) groups.set(input.name, [...groups.get(input.name) || [], input])
    return [...groups].filter(([, inputs]) => inputs.length === 1 || ['radio', 'checkbox'].includes(inputs[0].type)).map(([name, inputs]) => {
      const first = inputs[0]
      const kind = first instanceof HTMLSelectElement ? 'select' : first.type as HomeworkAnswerField['kind']
      const label = clean(first.getAttribute('aria-label') || first.labels?.[0]?.textContent) || name
      const options = first instanceof HTMLSelectElement
        ? Array.from(first.options).filter(option => !placeholder(option)).map(option => ({ value: option.value, label: clean(option.textContent) }))
        : ['radio', 'checkbox'].includes(kind)
          ? inputs.map(input => ({ value: input.value, label: clean(input.labels?.[0]?.textContent || input.closest('label')?.textContent) }))
          : []
      return { name, kind, label, options, currentValues: current(inputs), mathInput: Boolean(mathEditor(first)?.mathField) }
    })
  }

  const fingerprint = (root: Element) => {
    const clone = root.cloneNode(true) as Element
    clone.querySelectorAll('input, textarea, select, script, .mq-editable-field, .mq-math-mode, .mq-selectable, .mq-sr-only, .hint, .solution')
      .forEach(node => node.remove())
    const value = clean(clone.textContent) + Array.from(clone.querySelectorAll('img')).map(img => img.getAttribute('src')).join('|')
    let hash = 2166136261
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
    return (hash >>> 0).toString(36)
  }

  const context = (root: Element) => {
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    root.setAttribute('data-campus-answer-root', token)
    return { token, path: `${location.origin}${location.pathname}`, fingerprint: fingerprint(root) }
  }

  const locate = (question: Pick<HomeworkQuestion, 'fillContext'>) => {
    const ctx = question.fillContext
    const root = ctx && Array.from(document.querySelectorAll('[data-campus-answer-root]'))
      .find(node => node.getAttribute('data-campus-answer-root') === ctx.token)
    if (!root || `${location.origin}${location.pathname}` !== ctx?.path || fingerprint(root) !== ctx.fingerprint) {
      return null
    }
    return root
  }

  const matches = (question: Pick<HomeworkQuestion, 'fillContext' | 'answerFields'>, fills: HomeworkAnswerFill[]) => {
    const root = locate(question)
    if (!root) return false
    const fields = describe(root)
    return fields.length > 0 && fields.length === fills.length && new Set(fills.map(item => item.field)).size === fields.length
      && fields.every(field => {
        const expected = fills.find(item => item.field === field.name)
        return expected && JSON.stringify(field.currentValues) === JSON.stringify(expected.values)
      })
  }

  const fill = (question: Pick<HomeworkQuestion, 'fillContext' | 'answerFields'>, fills: HomeworkAnswerFill[], overwrite: boolean): HomeworkFillResult => {
    const root = locate(question)
    if (!root) return { filled: 0, skipped: fills.length, message: '题目页面已变化，请重新读取并解答。' }
    const fields = describe(root)
    const inputs = controls(root)
    const plans: Array<{ fill: HomeworkAnswerFill; targets: Control[] }> = []
    let skipped = 0
    const names = new Set<string>()
    for (const item of fills) {
      const field = fields.find(field => field.name === item.field)
      const original = question.answerFields?.find(field => field.name === item.field)
      const targets = inputs.filter(input => input.name === item.field)
      if (!field || !original || names.has(item.field) || !Array.isArray(item.values)
        || item.values.some(value => typeof value !== 'string' || value.length > 4096)
        || (field.kind !== 'checkbox' && item.values.length !== 1)
        || (['select', 'radio', 'checkbox'].includes(field.kind) && item.values.some(value => !field.options.some(option => option.value === value)))
        || (!field.options.length && !item.values[0]?.trim())
        || (field.mathInput && (!item.latex || item.latex.length > 4096))
        || (field.kind === 'number' && !Number.isFinite(Number(item.values[0])))) {
        return { filled: 0, skipped: fills.length, message: '答案与输入框不能可靠匹配，请手动填写。' }
      }
      names.add(item.field)
      // Do not overwrite work entered while the AI request was in flight.
      if ((!overwrite && field.currentValues.length)
        || JSON.stringify(field.currentValues) !== JSON.stringify(original.currentValues)) {
        skipped++
        continue
      }
      plans.push({ fill: item, targets })
    }
    let filled = 0
    for (const { fill: item, targets } of plans) {
      for (const input of targets) {
        const choice = input instanceof HTMLInputElement && ['checkbox', 'radio'].includes(input.type)
        if (choice) input.checked = item.values.includes(input.value)
        else {
          const editor = mathEditor(input)
          if (editor?.mathField && item.latex) editor.mathField.latex(item.latex)
          const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype
            : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
          Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, item.values[0])
        }
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
      filled++
    }
    return { filled, skipped, message: `已填入 ${filled} 个答案框${skipped ? `，保留 ${skipped} 个已有答案` : ''}，请检查后手动提交。` }
  }
  return { describe, context, fill, matches }
}

export function getHomeworkAnswerFillScript(question: HomeworkQuestion, fills: HomeworkAnswerFill[], overwrite = false) {
  const target = { fillContext: question.fillContext, answerFields: question.answerFields }
  return `(${createHomeworkAnswerTools.toString()})().fill(${JSON.stringify(target)},${JSON.stringify(fills)},${JSON.stringify(overwrite)})`
}
