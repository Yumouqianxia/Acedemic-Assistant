# Campus Dashboard

一个本地桌面端聚合面板，用于统一展示校园学习数据。

当前阶段聚焦 **Moodle**，`Students` 模块暂未接入（预留）。

## 技术栈

- `Electron`（主进程处理网络与会话）
- `Vue 3 + TypeScript + Vite`（渲染进程 UI）
- `Element Plus`（按需引入）
- `Axios`（Moodle API 请求）
- `electron-store`（本地账号资料存储）

## 已实现功能（Moodle）

- 登录页输入账号密码，主进程自动请求 `token.php` 换取 `token`
- 拉取站点信息：`core_webservice_get_site_info`
- 拉取课程列表：`core_enrol_get_users_courses`
- 拉取课程章节/模块：`core_course_get_contents`
- 课件资源列表展示（文件名、大小、可访问链接）
- 多账号基础支持：
  - 本地保存账号资料（`username/fullName/siteName/lastSyncAt`）
  - 不保存明文密码
  - 会话 `token` 仅保存在内存

## 目录结构

- `electron/main.ts`：主进程、Moodle IPC、会话与本地存储
- `electron/preload.ts`：安全桥接 API（`window.electronAPI`）
- `src/App.vue`：登录与 Moodle 数据面板
- `vite.config.ts`：Vue + Electron + Element Plus 按需配置

## 运行方式

```bash
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm exec vue-tsc --noEmit
pnpm exec vite build
```

## 说明

- 本项目统一使用 `pnpm`，不要使用 `npm/yarn`。
- 首次安装若 Electron 未下载成功，重新执行 `pnpm install`。
- 请勿在仓库中提交真实账号密码或 token。

## Roadmap

- [x] Phase 1：基础设施搭建（Electron + Vue + TS + IPC）
- [x] Phase 2（部分）：Moodle 登录与课程同步
- [ ] Moodle 增强：资源类型筛选、缓存、错误重试
- [ ] Students 模块：后续接入（当前留空）
