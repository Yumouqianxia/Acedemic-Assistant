<script setup lang="ts">
import { useAuth } from '../composables/useAuth'
import { useDashboard } from '../composables/useDashboard'

const { user, userInitial } = useAuth()
const { gpaDisplay, completedCreditsNum } = useDashboard()
</script>

<template>
  <div class="profile-page">
    <div class="profile-header">
      <h2 class="profile-title">My Profile</h2>
      <p class="profile-subtitle">Your account and academic information</p>
    </div>

    <div class="profile-body" v-if="user">
      <!-- Avatar & Name Card -->
      <div class="profile-hero-card">
        <div class="profile-avatar">{{ userInitial }}</div>
        <div class="profile-hero-info">
          <div class="profile-hero-name">{{ user.fullName }}</div>
          <div class="profile-hero-username">{{ user.username }}</div>
        </div>
      </div>

      <!-- Account Info -->
      <div class="profile-card">
        <div class="profile-card-title">Account Information</div>
        <div class="profile-row">
          <span class="profile-row-label">Full Name</span>
          <span class="profile-row-value">{{ user.fullName || '—' }}</span>
        </div>
        <div class="profile-row">
          <span class="profile-row-label">Username</span>
          <span class="profile-row-value">{{ user.username || '—' }}</span>
        </div>
        <div class="profile-row">
          <span class="profile-row-label">Site</span>
          <span class="profile-row-value">{{ user.siteName || '—' }}</span>
        </div>
        <div class="profile-row">
          <span class="profile-row-label">User ID</span>
          <span class="profile-row-value">{{ user.userId }}</span>
        </div>
      </div>

      <!-- Academic Stats -->
      <div class="profile-card">
        <div class="profile-card-title">Academic Summary</div>
        <div class="profile-row">
          <span class="profile-row-label">GPA</span>
          <span class="profile-row-value profile-row-value--accent">{{ gpaDisplay ?? '—' }}</span>
        </div>
        <div class="profile-row">
          <span class="profile-row-label">Completed Credits</span>
          <span class="profile-row-value">{{ completedCreditsNum ?? '—' }}</span>
        </div>
      </div>
    </div>

    <div v-else class="profile-empty">
      <el-empty description="未登录" />
    </div>
  </div>
</template>

<style scoped>
.profile-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-page);
  overflow-y: auto;
}

.profile-header {
  padding: 28px 28px 0;
}

.profile-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-h);
  margin: 0 0 4px;
}

.profile-subtitle {
  font-size: 13px;
  color: var(--text-m);
  margin: 0;
}

.profile-body {
  padding: 20px 28px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 640px;
}

/* Hero Card */
.profile-hero-card {
  background: var(--bg-header);
  border-radius: 16px;
  padding: 24px 28px;
  display: flex;
  align-items: center;
  gap: 20px;
}

.profile-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: #2a5298;
  color: #fff;
  font-size: 28px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.profile-hero-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-hero-name {
  font-size: 20px;
  font-weight: 700;
  color: #fff;
}

.profile-hero-username {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.55);
}

/* Info Cards */
.profile-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
  box-shadow: var(--shadow-s);
}

.profile-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-h);
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.profile-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.profile-row:last-child {
  border-bottom: none;
}

.profile-row-label {
  font-size: 13px;
  color: var(--text-m);
}

.profile-row-value {
  font-size: 13px;
  color: var(--text-b);
  font-weight: 500;
}

.profile-row-value--accent {
  color: var(--accent-b);
  font-size: 18px;
  font-weight: 700;
}

.profile-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
