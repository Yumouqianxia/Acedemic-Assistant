import { computed, ref } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_MODE_KEY = 'campus-theme-mode'
const cachedMode = localStorage.getItem(THEME_MODE_KEY)
const initialMode: ThemeMode = cachedMode === 'light' || cachedMode === 'dark' || cachedMode === 'system'
  ? cachedMode
  : 'system'

const themeMode = ref<ThemeMode>(initialMode)
const media = window.matchMedia?.('(prefers-color-scheme: dark)')
const systemDark = ref(Boolean(media?.matches))

if (media) {
  media.addEventListener('change', (event) => {
    systemDark.value = event.matches
  })
}

const isDark = computed(() => {
  if (themeMode.value === 'dark') return true
  if (themeMode.value === 'light') return false
  return systemDark.value
})

const setThemeMode = (mode: ThemeMode) => {
  themeMode.value = mode
  localStorage.setItem(THEME_MODE_KEY, mode)
}

const toggleTheme = () => {
  const nextMode: ThemeMode = isDark.value ? 'light' : 'dark'
  setThemeMode(nextMode)
}

export function useTheme() {
  return { isDark, themeMode, setThemeMode, toggleTheme }
}
