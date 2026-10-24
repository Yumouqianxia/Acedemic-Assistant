export type AiProviderConfig = {
  baseUrl: string
  model: string
  apiMode: 'responses' | 'chat-completions'
  hasApiKey: boolean
  secureStorageAvailable: boolean
}

export type HomeworkQuestion = {
  id: string
  number: string
  prompt: string
  options: string[]
  answerType: string
  currentAnswer: string
  formulas: string[]
  images: Array<{ src: string; alt: string; dataUrl?: string }>
  answerFields?: HomeworkAnswerField[]
  fillContext?: { token: string; path: string; fingerprint: string }
}

export type HomeworkAnswerField = {
  name: string
  kind: 'text' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox'
  label: string
  options: Array<{ value: string; label: string }>
  currentValues: string[]
  mathInput?: boolean
}

export type HomeworkAnswerFill = { field: string; values: string[]; latex?: string }
export type HomeworkSolveResult = { answer: string; model: string; fills: HomeworkAnswerFill[] }
export type HomeworkFillResult = { filled: number; skipped: number; message: string }

export type HomeworkWebview = HTMLElement & {
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>
}
