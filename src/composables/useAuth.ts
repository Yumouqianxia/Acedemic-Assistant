import { computed, reactive, ref, watch } from 'vue'
import type { MoodleProfile, MoodleUser, UsernameSuggestion } from '../types'

export const SESSION_LOGIN_USER_KEY = 'campus-dashboard:login-user'
const AUTO_SSO_LOGIN_KEY = 'campus-dashboard:auto-sso-login'
const LAST_LOGIN_USERNAME_KEY = 'campus-dashboard:last-login-username'

// Module-level shared state (singleton across all callers)
export const user = ref<MoodleUser | null>(null)
const loginForm = reactive({ username: '', password: '' })
const rememberPassword = ref(false)
const profiles = ref<MoodleProfile[]>([])
const loggingIn = ref(false)
const autoSsoLogin = ref(localStorage.getItem(AUTO_SSO_LOGIN_KEY) === '1')

const userInitial = computed(() => {
  const name = user.value?.fullName ?? ''
  return name.charAt(0).toUpperCase() || '?'
})

const loadProfiles = async (): Promise<void> => {
  profiles.value = await window.electronAPI.moodleProfilesList()
}

const querySearchProfiles = (
  queryString: string,
  cb: (items: UsernameSuggestion[]) => void,
): void => {
  const keyword = queryString.trim().toLowerCase()
  const list = profiles.value
    .filter((item) => {
      if (!keyword) return true
      return `${item.fullName} ${item.username}`.toLowerCase().includes(keyword)
    })
    .slice(0, 10)
    .map((item) => ({
      value: `${item.fullName} (${item.username})`,
      profile: item,
    }))
  cb(list)
}

const fillRememberedPassword = async (username: string): Promise<boolean> => {
  const credential = await window.electronAPI.moodleCredentialGet({ username })
  if (!credential.password) return false
  if (loginForm.username.trim().toLowerCase() !== username.trim().toLowerCase()) return false
  loginForm.password = credential.password
  rememberPassword.value = true
  return true
}

const handlePickProfile = async (item: Record<string, unknown>): Promise<void> => {
  const profile = (item as UsernameSuggestion).profile
  if (!profile) return
  loginForm.username = profile.username
  if (profile.hasRememberedPassword) {
    await fillRememberedPassword(profile.username)
  }
}

const saveLastLoginUsername = (username: string): void => {
  const normalized = username.trim()
  if (!normalized) return
  localStorage.setItem(LAST_LOGIN_USERNAME_KEY, normalized)
}

const hydrateRememberedLogin = async (): Promise<void> => {
  if (loginForm.username.trim()) return
  const lastUsername = localStorage.getItem(LAST_LOGIN_USERNAME_KEY)?.trim()
  if (!lastUsername) return
  loginForm.username = lastUsername
  await fillRememberedPassword(lastUsername)
}

const setAutoSsoLogin = (enabled: boolean): void => {
  autoSsoLogin.value = enabled
  localStorage.setItem(AUTO_SSO_LOGIN_KEY, enabled ? '1' : '0')
}

const saveSession = (u: MoodleUser): void => {
  sessionStorage.setItem(SESSION_LOGIN_USER_KEY, JSON.stringify(u))
}

const restoreSession = (): MoodleUser | null => {
  const cached = sessionStorage.getItem(SESSION_LOGIN_USER_KEY)
  if (!cached) return null
  try {
    const parsed = JSON.parse(cached) as MoodleUser
    return parsed?.username ? parsed : null
  } catch {
    sessionStorage.removeItem(SESSION_LOGIN_USER_KEY)
    return null
  }
}

const clearSession = (): void => {
  sessionStorage.removeItem(SESSION_LOGIN_USER_KEY)
}

let watchInitialized = false

export function useAuth() {
  if (!watchInitialized) {
    watchInitialized = true
    watch(
      () => loginForm.username,
      async (value) => {
        const keyword = value.trim().toLowerCase()
        if (!keyword) {
          rememberPassword.value = false
          return
        }
        const matched = profiles.value.find((item) => item.username.toLowerCase() === keyword)
        if (!matched?.hasRememberedPassword) return
        await fillRememberedPassword(matched.username)
      },
    )
  }

  return {
    user,
    loginForm,
    rememberPassword,
    profiles,
    loggingIn,
    autoSsoLogin,
    userInitial,
    loadProfiles,
    querySearchProfiles,
    fillRememberedPassword,
    handlePickProfile,
    saveLastLoginUsername,
    hydrateRememberedLogin,
    setAutoSsoLogin,
    saveSession,
    restoreSession,
    clearSession,
  }
}
