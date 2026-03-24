import { ref, watch } from 'vue'

const isDark = ref(localStorage.getItem('campus-theme') === 'dark')

watch(isDark, (val) => {
  localStorage.setItem('campus-theme', val ? 'dark' : 'light')
})

export function useTheme() {
  const toggleTheme = () => {
    isDark.value = !isDark.value
  }
  return { isDark, toggleTheme }
}
