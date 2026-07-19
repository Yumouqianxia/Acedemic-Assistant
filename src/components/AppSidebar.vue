<script setup lang="ts">
defineProps<{
  activeStage: string
}>()

const emit = defineEmits<{
  navigate: [stage: string]
}>()

const mainNavItems = [
  {
    id: 'dashboard',
    label: 'Dashboard',
  },
  {
    id: 'course',
    label: 'Course',
  },
  {
    id: 'notebook',
    label: 'Notebook',
  },
  {
    id: 'study',
    label: 'Study Planner',
  },
  {
    id: 'grade',
    label: 'Grade',
  },
  {
    id: 'profile',
    label: 'My Profile',
  },
]
</script>

<template>
  <aside class="sidebar">
    <nav class="sidebar-nav">
      <ul class="sidebar-list">
        <li
          v-for="item in mainNavItems"
          :key="item.id"
          class="sidebar-item"
          :class="{ 'sidebar-item--active': activeStage === item.id }"
          @click="emit('navigate', item.id)"
        >
          <!-- Dashboard icon -->
          <svg v-if="item.id === 'dashboard'" class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="14" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
          </svg>
          <!-- Course icon -->
          <svg v-else-if="item.id === 'course'" class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            <line x1="9" y1="8" x2="15" y2="8"/>
            <line x1="9" y1="12" x2="13" y2="12"/>
          </svg>
          <!-- Notebook icon -->
          <svg v-else-if="item.id === 'notebook'" class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            <line x1="8.5" y1="6.5" x2="8.5" y2="17.5" />
            <line x1="11.5" y1="9" x2="17" y2="9" />
            <line x1="11.5" y1="13" x2="17" y2="13" />
          </svg>
          <!-- Grade icon -->
          <svg v-else-if="item.id === 'study'" class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="8"/>
            <path d="M12 8v4l3 2"/>
            <path d="M7 3 4 6M17 3l3 3"/>
          </svg>
          <!-- Grade icon -->
          <svg v-else-if="item.id === 'grade'" class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          <!-- Profile icon -->
          <svg v-else-if="item.id === 'profile'" class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>

          <span class="sidebar-label">{{ item.label }}</span>
        </li>
      </ul>

      <div class="sidebar-divider" />

      <!-- Settings at bottom of nav -->
      <ul class="sidebar-list">
        <li
          class="sidebar-item"
          :class="{ 'sidebar-item--active': activeStage === 'settings' }"
          @click="emit('navigate', 'settings')"
        >
          <svg class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span class="sidebar-label">Settings</span>
        </li>
      </ul>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 200px;
  min-width: 200px;
  background: #1b2a3b;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
  overflow-y: auto;
}

.sidebar-nav {
  flex: 1;
  padding: 16px 0 12px;
  display: flex;
  flex-direction: column;
}

.sidebar-list {
  list-style: none;
  margin: 0;
  padding: 0 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-divider {
  margin: 10px 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.sidebar-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s, color 0.15s;
  user-select: none;
}

.sidebar-item:hover {
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.85);
}

.sidebar-item--active {
  background: rgba(58, 123, 213, 0.18);
  color: #58a6ff;
}

.sidebar-item--active:hover {
  background: rgba(58, 123, 213, 0.24);
  color: #7bbcff;
}

.sidebar-icon {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
}

.sidebar-label {
  flex: 1;
  letter-spacing: 0.1px;
}

</style>
