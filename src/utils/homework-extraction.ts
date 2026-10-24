import type { HomeworkQuestion } from '../types/ai-homework'
import { getMoodleQuestionExtractionScript } from './moodle-question-extraction'
import { createHomeworkAnswerTools } from './homework-answer-fields'

// This function runs inside the isolated guest page. Keep all runtime helpers
// inside it so serializing the function does not depend on the app's context.
async function extractWebworkQuestions(answerTools: ReturnType<typeof createHomeworkAnswerTools>): Promise<HomeworkQuestion[]> {
  const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
  type MathItem = { math: string; typesetRoot?: Element }
  const mathJax = (window as Window & {
    MathJax?: {
      startup?: { promise?: Promise<unknown>; document?: { getMathItemsWithin: (node: Element) => MathItem[] } }
    }
  }).MathJax
  // WeBWorK hides the problem while MathJax renders. Wait briefly for its source
  // map so fractions, exponents and limits retain their TeX, not flattened text.
  if (mathJax?.startup?.promise) {
    await Promise.race([mathJax.startup.promise.catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))])
  }
  const roots = Array.from(document.querySelectorAll('#problem_body, .problem-content'))
    .filter((node, index, all) => !all.some((other, otherIndex) => otherIndex !== index && other.contains(node)))
    .filter(node => getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none')

  return Promise.all(roots.map(async (root, index) => {
    const formulas: string[] = []
    const mathSources = new Map<Element, string>()
    try {
      for (const item of mathJax?.startup?.document?.getMathItemsWithin(root) || []) {
        if (item.typesetRoot && item.math) mathSources.set(item.typesetRoot, item.math)
      }
    } catch { /* Older MathJax versions expose TeX in script elements instead. */ }
    const asFormula = (value: string) => {
      const formula = clean(value)
      if (!formula) return ''
      if (!formulas.includes(formula)) formulas.push(formula)
      return ` \\(${formula}\\) `
    }
    const ignored = 'style, noscript, button, [hidden], .sr-only, .visually-hidden, mjx-assistive-mml, .MJX_Assistive_MathML, .MathJax, .MathJax_Display, .MathJax_Preview, .mq-editable-field, .mq-math-mode, .mq-selectable, .mq-textarea, .mq-sr-only, .popover, .hint, .solution'
    const textWithMath = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
      if (!(node instanceof Element)) return ''
      const math = mathSources.get(node)
      if (math) return asFormula(math)
      if (node.matches('script[type^="math/tex"]')) return asFormula(node.textContent || '')
      if (node.matches('script') || node.matches(ignored)) return ''
      const latex = node.getAttribute('data-latex')
        || (node.matches('math, semantics, mjx-container, .katex, .katex-mathml')
          ? node.querySelector('annotation[encoding="application/x-tex"]')?.textContent : '')
        || (node.matches('mjx-container') ? node.getAttribute('aria-label') : '')
      if (latex) return asFormula(latex)
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
        return node.type === 'hidden' ? '' : ` [答案框 ${node.getAttribute('name') || ''}] `
      }
      if (node instanceof HTMLImageElement) {
        const alt = clean(node.alt || node.getAttribute('title'))
        const isFormula = /equation|mathtex|texrender|filter_tex/i.test(node.src) || /^(?:\\[([]|\$)/.test(alt)
        return isFormula ? asFormula(alt) : alt ? ` [图片：${alt}] ` : ' [题目图片] '
      }
      const block = node.matches('p, div, br, li, tr, table, h1, h2, h3')
      const text = Array.from(node.childNodes).map(textWithMath).join('')
      return block ? `\n${text}\n` : text
    }
    const prompt = textWithMath(root).replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim()
    const inputs = Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'))
      .filter(input => Boolean(input.name) && !['hidden', 'password', 'submit', 'button', 'reset', 'image'].includes(input.type))
    const options = Array.from(root.querySelectorAll('label, select option'))
      .map(node => clean(textWithMath(node)))
      .filter((value, position, all) => Boolean(value) && all.indexOf(value) === position)
    const currentAnswer = inputs.filter(input => {
      if (input instanceof HTMLInputElement && ['radio', 'checkbox'].includes(input.type)) return input.checked
      return Boolean(input.value)
    }).map(input => `${input.name}: ${input.value}`).join('; ')

    const imageElements = Array.from(root.querySelectorAll<HTMLImageElement>('img'))
      .filter(img => {
        const style = getComputedStyle(img)
        const source = img.currentSrc || img.src
        const alt = clean(img.alt || img.getAttribute('title'))
        return style.display !== 'none' && style.visibility !== 'hidden'
          && !/icon|mathjax|mathtex|texrender|filter_tex|equation/i.test(`${img.className} ${source}`)
          && !/^(?:\\[([]|\$)/.test(alt)
          && !img.closest('.solution, .hint, .popover')
      })
      .filter((img, position, all) => all.findIndex(other => other.src === img.src) === position)
      .slice(0, 4)
    const images = await Promise.all(imageElements.map(async img => {
      let dataUrl = ''
      try {
        const response = await fetch(img.currentSrc || img.src, { credentials: 'include', signal: AbortSignal.timeout(8000) })
        if (!response.ok) throw new Error('Image unavailable')
        const blob = await response.blob()
        if (blob.type.startsWith('image/') && blob.size <= 3000000) {
          dataUrl = await new Promise<string>(resolve => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result || ''))
            reader.onerror = () => resolve('')
            reader.readAsDataURL(blob)
          })
        }
      } catch { /* The text and alt description remain available if an image fails. */ }
      return { src: img.currentSrc || img.src, alt: clean(img.alt || img.getAttribute('title')), dataUrl }
    }))
    // Do not carry authentication query parameters or hidden form fields back
    // to the assistant. Only the displayed problem and answer inputs are read.
    const number = clean(document.querySelector('#page-title')?.textContent)
      || clean(document.querySelector('h1')?.textContent) || `Problem ${index + 1}`
    return {
      id: `${location.pathname}#${root.id || index}`,
      number,
      prompt,
      options,
      answerType: [...new Set(inputs.map(input => input.type))].join(', ') || 'unknown',
      currentAnswer,
      formulas,
      images,
      answerFields: answerTools.describe(root),
      fillContext: answerTools.context(root),
    }
  }))
}

export function getHomeworkExtractionScript(source: 'moodle' | 'webwork') {
  return source === 'moodle'
    ? getMoodleQuestionExtractionScript()
    : `(${extractWebworkQuestions.toString()})((${createHomeworkAnswerTools.toString()})())`
}
