<script setup lang="ts">
const props = defineProps<{
  appVersion: string
  themeMode: 'light' | 'dark' | 'system'
  autoSyncIntervalHours: 0 | 6 | 24
  downloadDirectory: string
  language: 'zh-CN' | 'en-US'
}>()

const emit = defineEmits<{
  back: []
  'update-theme-mode': [mode: 'light' | 'dark' | 'system']
  'update-auto-sync-interval': [hours: 0 | 6 | 24]
  'update-language': [language: 'zh-CN' | 'en-US']
  'choose-download-directory': []
  'reset-download-directory': []
  'clear-preview-cache': []
  'check-updates': []
}>()
</script>

<template>
  <div class="settings-page">
    <div class="settings-topbar">
      <span class="settings-title">Settings</span>
    </div>

    <div class="settings-body">
      <div class="settings-card">
        <div class="settings-card-title">界面</div>
        <div class="settings-row">
          <span class="settings-row-label">主题</span>
          <el-select
            :model-value="props.themeMode"
            style="width: 180px"
            @update:model-value="(value) => emit('update-theme-mode', value as 'light' | 'dark' | 'system')"
          >
            <el-option label="跟随系统" value="system" />
            <el-option label="浅色" value="light" />
            <el-option label="深色" value="dark" />
          </el-select>
        </div>
        <div class="settings-row">
          <span class="settings-row-label">语言</span>
          <el-select
            :model-value="props.language"
            style="width: 180px"
            @update:model-value="(value) => emit('update-language', value as 'zh-CN' | 'en-US')"
          >
            <el-option label="中文" value="zh-CN" />
            <el-option label="English" value="en-US" />
          </el-select>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">同步</div>
        <div class="settings-row">
          <span class="settings-row-label">自动同步频率</span>
          <el-select
            :model-value="props.autoSyncIntervalHours"
            style="width: 180px"
            @update:model-value="(value) => emit('update-auto-sync-interval', value as 0 | 6 | 24)"
          >
            <el-option label="关闭" :value="0" />
            <el-option label="每 6 小时" :value="6" />
            <el-option label="每 24 小时" :value="24" />
          </el-select>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">文件与缓存</div>
        <div class="settings-row settings-row--top">
          <span class="settings-row-label">下载目录</span>
          <div class="settings-actions">
            <div class="settings-value" :title="props.downloadDirectory">{{ props.downloadDirectory }}</div>
            <div class="settings-btns">
              <el-button size="small" @click="emit('choose-download-directory')">更改目录</el-button>
              <el-button size="small" @click="emit('reset-download-directory')">恢复默认</el-button>
            </div>
          </div>
        </div>
        <div class="settings-row">
          <span class="settings-row-label">预览缓存</span>
          <el-button size="small" @click="emit('clear-preview-cache')">清理缓存</el-button>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">关于</div>
        <div class="settings-row">
          <span class="settings-row-label">当前版本</span>
          <span class="settings-value">v{{ props.appVersion || '-' }}</span>
        </div>
        <div class="settings-row">
          <span class="settings-row-label">更新检查</span>
          <el-button size="small" @click="emit('check-updates')">检查更新</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-page);
  color: var(--text-b);
}

.settings-topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 24px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
}

.settings-back-btn {
  border-radius: 8px;
}

.settings-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-h);
}

.settings-body {
  padding: 18px 24px 24px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 14px;
}

.settings-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
}

.settings-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-h);
  margin-bottom: 12px;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
}

.settings-row--top {
  align-items: flex-start;
}

.settings-row-label {
  font-size: 13px;
  color: var(--text-b);
}

.settings-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.settings-btns {
  display: flex;
  gap: 8px;
}

.settings-value {
  max-width: 360px;
  color: var(--text-m);
  font-size: 12px;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
