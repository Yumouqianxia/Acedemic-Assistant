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
}

export type HomeworkWebview = HTMLElement & {
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>
}
