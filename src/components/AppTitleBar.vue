<script setup lang="ts">
defineProps<{
  isMaximized: boolean
  isDark: boolean
}>()

defineEmits<{
  minimize: []
  maximize: []
  close: []
  'toggle-theme': []
}>()
</script>

<template>
  <div class="title-bar">
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
      <!-- Theme toggle button -->
      <button
        class="tb-btn tb-btn--theme"
        :title="isDark ? '切换到亮色模式' : '切换到暗色模式'"
        @click="$emit('toggle-theme')"
      >
        <!-- Moon icon: shown in light mode to switch to dark -->
        <svg v-if="!isDark" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
        <!-- Sun icon: shown in dark mode to switch to light -->
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
    </div>
  </div>
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
}

.tb-left {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  flex-shrink: 0;
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
</style>
