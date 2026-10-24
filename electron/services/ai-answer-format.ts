import type { HomeworkAnswerFill, HomeworkQuestion } from '../../src/types/ai-homework'

export function parseAnswerFills(response: string, question: HomeworkQuestion) {
  const blocks = [...response.matchAll(/```answer-fields\s*([\s\S]*?)```/gi)]
  const answer = response.replace(/```answer-fields\s*[\s\S]*?```/gi, '').trim()
  const fills: HomeworkAnswerFill[] = []
  if (!answer || blocks.length !== 1 || blocks[0][1].length > 32_000) return { answer, fills }
  try {
    const data: unknown = JSON.parse(blocks[0][1])
    if (!data || typeof data !== 'object' || !('answers' in data) || !Array.isArray(data.answers)
      || data.answers.length > 64) return { answer, fills }
    const seen = new Set<string>()
    for (const entry of data.answers) {
      if (!entry || typeof entry !== 'object') return { answer, fills: [] }
      const { field, values, latex } = entry as Record<string, unknown>
      const target = question.answerFields?.find(target => target.name === field)
      if (typeof field !== 'string' || !target || seen.has(field) || !Array.isArray(values)
        || values.length > 64 || values.some(value => typeof value !== 'string' || value.length > 4096)
        || (target.kind !== 'checkbox' && values.length !== 1)
        || (['select', 'radio', 'checkbox'].includes(target.kind) && values.some(value => !target.options.some(option => option.value === value)))
        || (!target.options.length && !values[0]?.trim())
        || (target.kind === 'number' && !Number.isFinite(Number(values[0])))
        || (latex !== undefined && (typeof latex !== 'string' || latex.length > 4096))
        || (target.mathInput && (typeof latex !== 'string' || !latex.trim()))) return { answer, fills: [] }
      seen.add(field)
      fills.push({ field, values, ...(typeof latex === 'string' ? { latex } : {}) })
    }
  } catch { return { answer, fills: [] } }
  return { answer, fills }
}
