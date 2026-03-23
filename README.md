# GT-IIT Campus Dashboard

本地桌面端聚合面板，将公网 **Moodle** 学习系统与内网 **Students** 成绩系统整合在同一个 Dashboard 中展示。

## 技术栈

| 层次 | 技术 |
|------|------|
| 桌面框架 | Electron（主进程处理跨域、自动化、会话） |
| 前端渲染 | Vue 3 + TypeScript + Vite |
| UI 组件 | Element Plus（按需引入） |
| 数据库 | SQLite（`better-sqlite3`，持久化课程/考试/元数据） |
| 网络请求 | Axios |
| 本地存储 | `electron-store`（Moodle 账号资料） |

## 已实现功能

### 认证与登录

- **GT-IIT SSO 一键登录**：使用 Microsoft Office 365 SSO，在共享 `persist:students` session 分区内完成认证。Moodle `launch.php` 的 `moodlemobile://` token 重定向在 Electron session 层拦截，Students 内网系统同一次 Office 365 会话复用，无需二次输入密码。
- **账号密码备用登录**：直接调用 Moodle `token.php` 换取 `wstoken`，网络异常或 SSO 不可用时使用。
- 自定义无边框窗口 + 顶部 Title Bar（Logo、应用名、窗口控制按钮）。

### Moodle 模块

- 拉取当前学期课程列表（按学期智能过滤最近学期）
- 拉取课程章节与课件资源（文件名、大小、可访问链接）
- 课程增量合并写入 SQLite，支持离线查看
- 多账号基础支持，`wstoken` 仅存于内存

### Students 模块

- 隐式 `BrowserWindow` 浏览器自动化（RPA），访问内网 Students 系统
- 自动处理 Office 365 SSO 跳转与 "Continue" 二次确认弹窗
- 抓取成绩数据：课程列表、GPA、已修学分、考试安排
- 数据写入 SQLite，支持增量比对（新增/更新/删除 delta）
- Sync 时若未认证，自动弹出认证窗口，认证成功后自动重试

### Dashboard UI

- 核心指标卡：GPA（百分制）、已修学分、本学期学分
- 课程卡片网格：Moodle / Students 双来源标记，"View Details" 底部对齐
- 同步面板：Moodle（书本图标）、Students（人员图标）、一键 Sync All
- 登录后自动触发同步；每天自动后台同步一次

## 目录结构

```
electron/
  app-main.ts          主进程：窗口、IPC handlers、自动同步调度
  preload.ts           安全桥接 API（window.electronAPI）
  dashboard-db.ts      SQLite 数据库封装（课程、考试、元数据）
  services/
    moodle-service.ts  Moodle API + SSO loginViaSso 流程
    students-service.ts Students RPA 自动化 + 认证流程
src/
  App.vue              主 UI（登录页 + Dashboard 页）
  vite-env.d.ts        window.electronAPI 类型声明
  style.css            全局样式
vite.config.ts         Vite + Electron + Element Plus 配置
```

## 运行方式

```bash
pnpm install
pnpm dev
```

构建：

```bash
pnpm vite build
```

## 注意事项

- 本项目统一使用 `pnpm`，不要使用 `npm / yarn`。
- `wstoken` 和 Students session 仅存于内存，重启应用后需重新登录。
- 请勿在仓库中提交真实账号密码或 token。
- Students 模块依赖已登录的 Office 365 全局会话，需在校内网或 VPN 环境下运行。

## Roadmap

- [x] Phase 1：基础设施搭建（Electron + Vue + TS + IPC + SQLite）
- [x] Phase 2：Moodle 账号密码登录与课程同步
- [x] Phase 3：Students 内网 RPA 自动化与成绩抓取
- [x] Phase 4：Dashboard UI 设计（自定义 Title Bar、核心指标卡、课程网格）
- [x] Phase 5：GT-IIT SSO 一键登录（Office 365 共享 session，Moodle + Students 同时打通）
- [ ] 课件资源筛选与本地缓存
- [ ] 多语言支持（中文 / 英文）
- [ ] 打包分发（electron-builder）
