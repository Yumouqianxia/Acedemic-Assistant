import { ref } from 'vue'

const isMaximized = ref(false)

export function useWindowControls() {
  const winMinimize = () => window.electronAPI.windowMinimize()

  const winMaximize = async () => {
    await window.electronAPI.windowMaximize()
    isMaximized.value = !isMaximized.value
  }

  const winClose = () => window.electronAPI.windowClose()

  const initWindowState = async () => {
    isMaximized.value = await window.electronAPI.windowIsMaximized()
  }

  return { isMaximized, winMinimize, winMaximize, winClose, initWindowState }
}
