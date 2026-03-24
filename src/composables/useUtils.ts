import { ElMessage } from 'element-plus'

export const formatTime = (iso: string | null | undefined): string => {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

export const formatBytes = (bytes: number): string => {
  if (!bytes) return '-'
  const mb = bytes / 1024 / 1024
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
}

export const formatCourseDelta = (delta?: { inserted: number; updated: number } | null): string => {
  if (!delta) return '新增 0，更新 0'
  return `新增 ${delta.inserted}，更新 ${delta.updated}`
}

export const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const notifySuccess = (message: string, title = '成功'): void => {
  ElMessage({
    message: `${title}：${message}`,
    type: 'success',
    duration: 2600,
    showClose: true,
    grouping: true,
    plain: false,
    offset: 18,
    customClass: 'campus-toast',
  })
}

export const notifyWarning = (message: string, title = '提醒'): void => {
  ElMessage({
    message: `${title}：${message}`,
    type: 'warning',
    duration: 3200,
    showClose: true,
    grouping: true,
    plain: false,
    offset: 18,
    customClass: 'campus-toast',
  })
}

export const notifyError = (message: string, title = '错误'): void => {
  ElMessage({
    message: `${title}：${message}`,
    type: 'error',
    duration: 4200,
    showClose: true,
    grouping: true,
    plain: false,
    offset: 18,
    customClass: 'campus-toast',
  })
}
