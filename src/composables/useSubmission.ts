import { computed, ref } from 'vue'
import type { AssignmentDetail, SelectedFile, SubmissionStatus, TimelineEvent } from '../types'
import { user } from './useAuth'
import { notifyError, notifySuccess, notifyWarning, withTimeout } from './useUtils'

// Module-level shared state (singleton across all callers)
const submissionEvent = ref<TimelineEvent | null>(null)
const submissionAssignment = ref<AssignmentDetail | null>(null)
const submissionStatus = ref<SubmissionStatus | null>(null)
const submissionLoading = ref(false)
const selectedFiles = ref<SelectedFile[]>([])
const submitting = ref(false)

const submissionDueDate = computed(() => {
  const ts = submissionAssignment.value?.duedate
  if (!ts) return null
  return new Date(ts * 1000)
})

const submissionStatusLabel = computed(() => {
  const s = submissionStatus.value?.status
  if (!s || s === 'new') return { text: 'Not Submitted', color: '#f56c6c' }
  if (s === 'draft') return { text: 'Draft Saved', color: '#e6a23c' }
  if (s === 'submitted') return { text: 'Submitted', color: '#67c23a' }
  return { text: s, color: '#909399' }
})

const totalSelectedSize = computed(() =>
  selectedFiles.value.reduce((sum, f) => sum + f.size, 0),
)

const openSubmission = async (event: TimelineEvent): Promise<void> => {
  if (event.modulename !== 'assign') {
    notifyWarning('仅支持 Assignment 类型的提交，其他类型请在 Moodle 中操作', '暂不支持')
    return
  }
  if (!event.cmid) {
    notifyWarning('无法获取作业 ID，请在 Moodle 中操作', '数据异常')
    return
  }
  submissionEvent.value = event
  submissionAssignment.value = null
  submissionStatus.value = null
  selectedFiles.value = []
  submissionLoading.value = true
  try {
    const { detail, status } = await window.electronAPI.moodleAssignmentDetailWithStatus({
      cmid: event.cmid,
      courseId: event.courseid,
    })
    submissionAssignment.value = detail
    submissionStatus.value = status
  } catch (error) {
    notifyError(error instanceof Error ? error.message : '加载作业详情失败', '加载失败')
  } finally {
    submissionLoading.value = false
  }
}

const updateSelectedFileAt = (index: number, patch: Partial<SelectedFile>): void => {
  const current = selectedFiles.value[index]
  if (!current) return
  selectedFiles.value[index] = { ...current, ...patch }
}

const uploadSelectedFile = async (index: number): Promise<void> => {
  const current = selectedFiles.value[index]
  if (!current) return

  updateSelectedFileAt(index, { uploading: true, error: null })
  try {
    const result = await withTimeout(
      window.electronAPI.moodleAssignmentUploadFile({
        filePath: current.path,
        username: user.value?.username,
      }),
      50_000,
      '上传超时（50 秒），请检查网络后重试',
    )
    updateSelectedFileAt(index, {
      itemid: result.itemid,
      name: result.filename || current.name,
      size: result.fileSize,
    })
  } catch (error) {
    updateSelectedFileAt(index, { error: error instanceof Error ? error.message : '上传失败' })
  } finally {
    updateSelectedFileAt(index, { uploading: false })
  }
}

const handleSelectFiles = async (): Promise<void> => {
  const result = await window.electronAPI.dialogOpenFile({
    title: 'Select files to submit',
    filters: [{ name: 'All Files', extensions: ['*'] }],
  })
  if (result.canceled || !result.filePaths.length) return

  const maxFiles = submissionAssignment.value?.maxFileSubmissions ?? 1
  const currentCount = selectedFiles.value.length

  for (const filePath of result.filePaths) {
    if (currentCount + selectedFiles.value.length >= maxFiles) {
      notifyWarning(`最多允许上传 ${maxFiles} 个文件`, '文件数量限制')
      break
    }
    const name = filePath.split(/[\\/]/).pop() ?? filePath
    const alreadyAdded = selectedFiles.value.some((f) => f.path === filePath)
    if (alreadyAdded) continue

    const file: SelectedFile = {
      path: filePath,
      name,
      size: 0,
      itemid: null,
      uploading: false,
      error: null,
    }
    selectedFiles.value.push(file)
    const fileIndex = selectedFiles.value.length - 1
    void uploadSelectedFile(fileIndex)
  }
}

const handleRemoveFile = (index: number): void => {
  selectedFiles.value.splice(index, 1)
}

const handleSubmit = async (): Promise<void> => {
  if (!submissionAssignment.value || !submissionEvent.value) return

  const pendingUploads = selectedFiles.value.filter((f) => f.uploading)
  if (pendingUploads.length) {
    notifyWarning('请等待文件上传完成后再提交', '上传中')
    return
  }
  const failedUploads = selectedFiles.value.filter((f) => f.error)
  if (failedUploads.length) {
    notifyError('有文件上传失败，请重新选择后再提交', '提交失败')
    return
  }
  const uploadedFiles = selectedFiles.value.filter((f) => f.itemid != null)
  if (!uploadedFiles.length && !submissionStatus.value?.submittedFiles.length) {
    notifyWarning('请至少选择一个文件', '未选择文件')
    return
  }

  const draftItemId = uploadedFiles[0]?.itemid
  if (draftItemId == null) {
    notifyWarning('文件尚未完成上传', '等待中')
    return
  }

  submitting.value = true
  try {
    await window.electronAPI.moodleAssignmentSaveSubmission({
      assignId: submissionAssignment.value.id,
      draftItemId,
    })
    notifySuccess('作业提交成功！', '提交成功')
    const refreshed = await window.electronAPI.moodleAssignmentDetailWithStatus({
      cmid: submissionEvent.value!.cmid,
      courseId: submissionEvent.value!.courseid,
    })
    submissionStatus.value = refreshed.status
    selectedFiles.value = []
  } catch (error) {
    notifyError(error instanceof Error ? error.message : '提交失败', '提交失败')
  } finally {
    submitting.value = false
  }
}

const clearSubmission = (): void => {
  submissionEvent.value = null
  submissionAssignment.value = null
  submissionStatus.value = null
  selectedFiles.value = []
}

export function useSubmission() {
  return {
    submissionEvent,
    submissionAssignment,
    submissionStatus,
    submissionLoading,
    selectedFiles,
    submitting,
    submissionDueDate,
    submissionStatusLabel,
    totalSelectedSize,
    openSubmission,
    handleSelectFiles,
    handleRemoveFile,
    handleSubmit,
    clearSubmission,
  }
}
