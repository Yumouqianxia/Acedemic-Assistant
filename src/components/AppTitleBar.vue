<script setup lang="ts">
import { ref } from 'vue'
import type { MoodleUser } from '../types'

defineProps<{
  isMaximized: boolean
  isDark: boolean
  isMac: boolean
  user: MoodleUser | null
}>()

const emit = defineEmits<{
  minimize: []
  maximize: []
  close: []
  'toggle-theme': []
  logout: []
}>()

const accountDropdownVisible = ref(false)

const toggleAccountDropdown = () => {
  accountDropdownVisible.value = !accountDropdownVisible.value
}

const closeDropdown = () => {
  accountDropdownVisible.value = false
}

const handleLogout = () => {
  accountDropdownVisible.value = false
  emit('logout')
}
</script>

<template>
  <div class="title-bar" :class="{ 'title-bar--mac': isMac }">
    <div class="tb-left">
      <div class="tb-logo">
        <span class="tb-logo-g">G</span>
        <span class="tb-logo-t">T-IIT</span>
      </div>
      <span class="tb-app-name">GTIIT Campus Dashboard</span>
    </div>

    <div class="tb-center">
      <!-- reserved for future nav items -->
    </div>

    <div class="tb-controls">
      <!-- User account dropdown (only when logged in) -->
      <div v-if="user" class="tb-account" @click.stop="toggleAccountDropdown">
        <div class="tb-avatar">{{ user.fullName?.charAt(0).toUpperCase() || '?' }}</div>
        <span class="tb-username">{{ user.fullName }}</span>
        <svg class="tb-chevron" :class="{ 'tb-chevron--open': accountDropdownVisible }" width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <!-- Dropdown menu -->
        <div v-if="accountDropdownVisible" class="tb-dropdown" @click.stop>
          <div class="tb-dropdown-item tb-dropdown-item--danger" @click="handleLogout">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            <span>Logout</span>
          </div>
        </div>
      </div>

      <!-- Theme toggle button -->
      <button
        class="tb-btn tb-btn--theme"
        :title="isDark ? '切换到亮色模式' : '切换到暗色模式'"
        @click="$emit('toggle-theme')"
      >
        <svg v-if="!isDark" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
        <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      </button>

      <template v-if="!isMac">
        <button class="tb-btn tb-btn--minimize" title="最小化" @click="$emit('minimize')">
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button class="tb-btn tb-btn--maximize" :title="isMaximized ? '还原' : '最大化'" @click="$emit('maximize')">
          <svg v-if="isMaximized" width="10" height="10" viewBox="0 0 10 10">
            <rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/>
            <rect x="0" y="2" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/>
          </svg>
          <svg v-else width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/>
          </svg>
        </button>
        <button class="tb-btn tb-btn--close" title="关闭" @click="$emit('close')">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/>
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/>
          </svg>
        </button>
      </template>
    </div>
  </div>

  <!-- Click-outside overlay to close dropdown -->
  <div v-if="accountDropdownVisible" class="tb-overlay" @click="closeDropdown" />
</template>

<style scoped>
.title-bar {
  height: 40px;
  min-height: 40px;
  background: #151f2e;
  display: flex;
  align-items: center;
  -webkit-app-region: drag;
  user-select: none;
  flex-shrink: 0;
  z-index: 1000;
  position: relative;
}

.tb-left {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  flex-shrink: 0;
}

.title-bar--mac .tb-left {
  padding-left: 82px;
}

.tb-logo {
  width: 30px;
  height: 30px;
  background: #2a3f55;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tb-logo-g {
  font-size: 14px;
  font-weight: 900;
  color: #fff;
  line-height: 1;
}

.tb-logo-t {
  font-size: 5.5px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.3px;
  line-height: 1.2;
}

.tb-app-name {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  letter-spacing: 0.1px;
}

.tb-center {
  flex: 1;
}

.tb-controls {
  display: flex;
  align-items: center;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
}

/* ── Account area ──────────────────────────────────────────── */
.tb-account {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 40px;
  cursor: pointer;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  transition: background 0.15s;
}

.tb-account:hover {
  background: rgba(255, 255, 255, 0.08);
}

.tb-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #2a5298;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tb-username {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tb-chevron {
  color: rgba(255, 255, 255, 0.5);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.tb-chevron--open {
  transform: rotate(180deg);
}

.tb-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 150px;
  background: #1e2d3d;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 9999;
  overflow: hidden;
  animation: dropdownFadeIn 0.12s ease;
}

@keyframes dropdownFadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.tb-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s;
  color: rgba(255, 255, 255, 0.75);
}

.tb-dropdown-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.tb-dropdown-item--danger:hover {
  background: rgba(220, 50, 50, 0.2);
  color: #ff7b7b;
}

/* ── Regular buttons ───────────────────────────────────────── */
.tb-btn {
  width: 46px;
  height: 40px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 0.12s, color 0.12s;
  font-family: inherit;
}

.tb-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.tb-btn--theme {
  width: 42px;
  margin-right: 2px;
}

.tb-btn--theme:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #ffd700;
}

.tb-btn--close:hover {
  background: #e81123;
  color: #fff;
}

/* ── Click-outside overlay ─────────────────────────────────── */
.tb-overlay {
  position: fixed;
  inset: 0;
  z-index: 9998;
}
</style>
