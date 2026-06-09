<script setup lang="ts">
import { ArrowRight, Lock, Message } from '@element-plus/icons-vue'
import { useAuth } from '../composables/useAuth'

const emit = defineEmits<{
  login: []
  'sso-login': []
}>()

const {
  loginForm,
  rememberPassword,
  autoSsoLogin,
  querySearchProfiles,
  handlePickProfile,
  setAutoSsoLogin,
  loggingIn,
} = useAuth()
</script>

<template>
  <div class="login-page">
    <div class="login-bg" aria-hidden="true">
      <div class="login-bg-grid" />
    </div>
    <span class="login-corner-diamond" aria-hidden="true">◇</span>

    <div class="login-card">
      <div class="login-header">
        <div class="login-logo">
          <span class="login-logo-letter">G</span>
          <span class="login-logo-label">T-IIT</span>
        </div>
        <div class="login-header-text">
          <div class="login-title">GTIIT 校园助手</div>
          <div class="login-subtitle">统一登录后可访问 Moodle 与 Students 数据</div>
        </div>
      </div>

      <div class="login-form">
        <div class="login-field">
          <label class="login-label">邮箱账号</label>
          <el-autocomplete
            v-model="loginForm.username"
            autocomplete="username"
            clearable
            placeholder="请输入学校邮箱"
            style="width: 100%"
            :prefix-icon="Message"
            :fetch-suggestions="querySearchProfiles"
            @select="handlePickProfile"
          />
        </div>

        <div class="login-field">
          <label class="login-label">密码</label>
          <el-input
            v-model="loginForm.password"
            autocomplete="current-password"
            show-password
            type="password"
            placeholder="请输入密码"
            :prefix-icon="Lock"
            @keyup.enter="emit('login')"
          />
        </div>

        <div class="login-options-row">
          <el-checkbox v-model="rememberPassword" class="login-checkbox">
            记住密码
          </el-checkbox>
          <el-checkbox
            :model-value="autoSsoLogin"
            class="login-checkbox"
            @update:model-value="(value) => setAutoSsoLogin(Boolean(value))"
          >
            下次自动登录
          </el-checkbox>
        </div>

        <el-button
          class="login-submit-btn"
          :loading="loggingIn"
          @click="emit('login')"
        >
          <el-icon v-if="!loggingIn"><ArrowRight /></el-icon>
          登录并进入系统
        </el-button>

        <div class="login-sso-divider">
          <span>或使用统一身份认证</span>
        </div>

        <div class="login-sso-row">
          <button class="login-sso-btn" type="button" :disabled="loggingIn" @click="emit('sso-login')">
            <span class="ms-icon" aria-hidden="true">
              <span class="ms-sq ms-sq-r" />
              <span class="ms-sq ms-sq-g" />
              <span class="ms-sq ms-sq-b" />
              <span class="ms-sq ms-sq-y" />
            </span>
            <el-icon v-if="!loggingIn"><ArrowRight /></el-icon>
            使用 GTIIT SSO 登录
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  background-color: #0c1f28;
}

.login-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(155deg, #14303d 0%, #0e2530 45%, #091c22 100%);
}

.login-bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(100, 210, 195, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(100, 210, 195, 0.045) 1px, transparent 1px);
  background-size: 72px 56px;
}

.login-corner-diamond {
  position: absolute;
  bottom: 24px;
  right: 36px;
  font-size: 44px;
  color: rgba(255, 255, 255, 0.13);
  pointer-events: none;
  z-index: 1;
  line-height: 1;
  font-weight: 100;
}

.login-card {
  position: relative;
  z-index: 2;
  width: 490px;
  background: var(--login-card-bg);
  border-radius: 16px;
  padding: 36px 40px 32px;
  box-shadow: 0 20px 70px rgba(0, 0, 0, 0.4);
  border: 1px solid var(--login-card-border);
}

.login-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 30px;
}

.login-logo {
  width: 54px;
  height: 54px;
  background: #1a2535;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.login-logo-letter {
  font-size: 24px;
  font-weight: 900;
  color: #fff;
  line-height: 1.1;
}

.login-logo-label {
  font-size: 8px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.6);
  letter-spacing: 0.5px;
  line-height: 1.2;
}

.login-title {
  font-size: 19px;
  font-weight: 700;
  color: var(--text-h);
  line-height: 1.25;
}

.login-subtitle {
  font-size: 12px;
  color: #6e7f8d;
  margin-top: 3px;
  line-height: 1.4;
}

.login-form {
  display: flex;
  flex-direction: column;
}

.login-field {
  margin-bottom: 16px;
}

.login-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--login-label);
  margin-bottom: 7px;
}

.login-field :deep(.el-input__wrapper:hover),
.login-field :deep(.el-autocomplete .el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px #4abfb0 inset;
}

.login-field :deep(.el-input__wrapper.is-focus),
.login-field :deep(.el-autocomplete .el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #3ab0a1 inset;
}

.login-options-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.login-checkbox :deep(.el-checkbox__label) {
  font-size: 13px;
  color: var(--login-label);
}

.login-submit-btn {
  width: 100% !important;
  height: 44px !important;
  font-size: 15px !important;
  font-weight: 600 !important;
  background: #1a2535 !important;
  border-color: #1a2535 !important;
  color: #fff !important;
  border-radius: 10px !important;
  letter-spacing: 0.2px;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 8px !important;
}

.login-submit-btn:hover {
  background: #243040 !important;
  border-color: #243040 !important;
}

.login-sso-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 20px 0 14px;
  font-size: 12.5px;
  color: #9aabb8;
}

.login-sso-divider::before,
.login-sso-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e8ecf0;
}

.login-sso-row {
  display: flex;
  gap: 10px;
}

.login-sso-btn {
  flex: 1;
  height: 42px;
  border: 1px solid var(--login-sso-border);
  background: var(--login-sso-bg);
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--login-sso-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: inherit;
  transition: border-color 0.15s, background 0.15s;
}

.login-sso-btn:hover {
  background: var(--bg-surface-hover);
  border-color: var(--border-strong);
}

.ms-icon {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.ms-sq {
  display: block;
  border-radius: 1px;
}

.ms-sq-r { background: #f25022; }
.ms-sq-g { background: #7fba00; }
.ms-sq-b { background: #00a4ef; }
.ms-sq-y { background: #ffb900; }
</style>
