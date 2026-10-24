import { safeStorage } from 'electron'
import axios from 'axios'
import Store from 'electron-store'
import type { HomeworkQuestion, HomeworkSolveResult } from '../../src/types/ai-homework'
import { parseAnswerFills } from './ai-answer-format'

export type AiApiMode = 'responses' | 'chat-completions'

export type AiProviderConfig = {
  baseUrl: string
  model: string
  apiMode: AiApiMode
  hasApiKey: boolean
  secureStorageAvailable: boolean
}

export type { HomeworkQuestion } from '../../src/types/ai-homework'

type StoredAiConfig = {
  baseUrl: string
  model: string
  apiMode: AiApiMode
  encryptedApiKey: string
}

type AiStoreSchema = {
  provider: StoredAiConfig
}

const DEFAULT_CONFIG: StoredAiConfig = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5.4-mini',
  apiMode: 'responses',
  encryptedApiKey: '',
}

const SYSTEM_PROMPT = `You are a careful homework tutor. Solve the supplied problem from first principles.
Reply in Simplified Chinese unless the question specifically requires another language.
Return Markdown with exactly these sections:
## 思路
Explain the method and the important intermediate steps.
## 答案
Give the final answer clearly, including the option letter or value and units where applicable.
## 检查
Briefly verify the result and mention uncertainty if the extracted question is incomplete.
After the three Markdown sections, append exactly one fenced code block tagged answer-fields.
Its JSON must be {"answers":[{"field":"exact input name","values":["answer value"],"latex":"optional LaTeX for math editors"}]}.
Use only names supplied in answerFields. Match every blank separately; never guess the mapping.
For text inputs, give platform-ready syntax (e.g. sqrt(2), x^2, (-infinity,-4) U (5,infinity)), without Markdown, units or explanations unless the input requires them.
For radio, checkbox and select, use the exact option values, not letters or labels. A checkbox group may have multiple values or [].
For mathInput fields also provide equivalent LaTeX in latex, e.g. "\\frac{1}{2}" or "(-\\infty,-4)\\cup(5,\\infty)".
If a value, field mapping, or problem statement is uncertain, omit that field. Return {"answers":[]} when none can be filled reliably.
Never claim that answers have been submitted. The app handles filling separately.`

const normalizeBaseUrl = (value: string) => {
  const trimmed = value.trim().replace(/\/+$/, '')
  const parsed = new URL(trimmed)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('API URL must use http:// or https://')
  return trimmed
}

const getErrorMessage = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: { message?: string }; message?: string } | undefined
    return data?.error?.message || data?.message || error.message
  }
  return error instanceof Error ? error.message : String(error)
}

export class AiHomeworkService {
  private readonly store = new Store<AiStoreSchema>({
    name: 'ai-homework-settings',
    defaults: { provider: DEFAULT_CONFIG },
  })

  getConfig(): AiProviderConfig {
    const config = this.store.get('provider', DEFAULT_CONFIG)
    return {
      baseUrl: config.baseUrl,
      model: config.model,
      apiMode: config.apiMode,
      hasApiKey: Boolean(config.encryptedApiKey),
      secureStorageAvailable: safeStorage.isEncryptionAvailable(),
    }
  }

  saveConfig(payload: { baseUrl: string; model: string; apiMode: AiApiMode; apiKey?: string; clearApiKey?: boolean }) {
    const current = this.store.get('provider', DEFAULT_CONFIG)
    const model = payload.model.trim()
    if (!model) throw new Error('Model cannot be empty')

    let encryptedApiKey = current.encryptedApiKey
    if (payload.clearApiKey) encryptedApiKey = ''
    if (payload.apiKey?.trim()) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Secure credential storage is unavailable. The API key was not saved.')
      }
      encryptedApiKey = safeStorage.encryptString(payload.apiKey.trim()).toString('base64')
    }

    this.store.set('provider', {
      baseUrl: normalizeBaseUrl(payload.baseUrl),
      model,
      apiMode: payload.apiMode === 'chat-completions' ? 'chat-completions' : 'responses',
      encryptedApiKey,
    })
    return this.getConfig()
  }

  private getApiKey(config: StoredAiConfig) {
    if (!config.encryptedApiKey) throw new Error('Please save an API key first')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable')
    try {
      return safeStorage.decryptString(Buffer.from(config.encryptedApiKey, 'base64'))
    } catch {
      throw new Error('The saved API key could not be decrypted. Please save it again.')
    }
  }

  async solve(question: HomeworkQuestion): Promise<HomeworkSolveResult> {
    const config = this.store.get('provider', DEFAULT_CONFIG)
    const apiKey = this.getApiKey(config)
    const baseUrl = normalizeBaseUrl(config.baseUrl)
    const questionText = JSON.stringify({
      questionNumber: question.number,
      prompt: question.prompt,
      answerType: question.answerType,
      answerFields: question.answerFields ?? [],
      options: question.options,
      currentAnswer: question.currentAnswer,
      formulas: question.formulas,
      imageDescriptions: question.images.map(image => image.alt).filter(Boolean),
    }, null, 2)
    const images = question.images.map(image => image.dataUrl).filter((value): value is string => Boolean(value))
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }

    try {
      if (config.apiMode === 'chat-completions') {
        const content: Array<Record<string, unknown>> = [
          { type: 'text', text: `请解答以下从作业页面读取的题目：\n\n${questionText}` },
          ...images.map(url => ({ type: 'image_url', image_url: { url } })),
        ]
        const { data } = await axios.post(`${baseUrl}/chat/completions`, {
          model: config.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content },
          ],
        }, { headers, timeout: 120_000 })
        const answer = data?.choices?.[0]?.message?.content
        if (!answer) throw new Error('The model returned an empty response')
        return { ...parseAnswerFills(String(answer), question), model: config.model }
      }

      const content: Array<Record<string, unknown>> = [
        { type: 'input_text', text: `请解答以下从作业页面读取的题目：\n\n${questionText}` },
        ...images.map(imageUrl => ({ type: 'input_image', image_url: imageUrl })),
      ]
      const { data } = await axios.post(`${baseUrl}/responses`, {
        model: config.model,
        instructions: SYSTEM_PROMPT,
        input: [{ role: 'user', content }],
      }, { headers, timeout: 120_000 })
      const answer = data?.output_text
        || data?.output?.flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item?.content ?? []).filter((item: { type?: string }) => item?.type === 'output_text').map((item: { text?: string }) => item.text ?? '').join('\n')
      if (!answer) throw new Error('The model returned an empty response')
      return { ...parseAnswerFills(String(answer), question), model: config.model }
    } catch (error) {
      throw new Error(`AI request failed: ${getErrorMessage(error)}`)
    }
  }
}
