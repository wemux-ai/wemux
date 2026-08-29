# 三个页面边界

## 核心原则

**三个页面概念必须分清，禁止混用**。

## 页面定义

### 1. /chat - Agent Chat / 主聊天页

- URL：`http://app.vibemux.localtest.me:15173/chat`
- 职责：主 Agent 编排、需求理解、worker 路由、Agent 选择、需求下发
- Session：`mainChatSession`
- 代码位置：`apps/web/src/routes/chat.tsx` 与 `apps/web/src/routes/-chat-route/*`

### 2. /workspace - 单个工作区详情页

- URL：`http://app.vibemux.localtest.me:15173/workspace?...`
- 职责：工作区会话详情、任务执行状态、terminal 输出
- Session：`workspaceSession` + `taskId` + `workspaceSessionId`
- 代码位置：`apps/web/src/routes/workspace.tsx` 与 `components/workspaces/*`

### 3. /workspaces - 工作区列表 / 工作区会话入口页

- URL：`http://app.vibemux.localtest.me:15173/workspaces?...`
- 职责：工作区列表、创建工作区、进入具体工作区会话
- Session：`workspaceId` + `workspaceSessionId` 列表
- 代码位置：`apps/web/src/routes/workspaces.tsx` 与 `components/workspaces/*`

## 禁止混用规则

| 禁止 | 说明 |
|------|------|
| 不得把 `/chat` 当作 workspace session 页面处理 | /chat 处理 mainChatSession，不是 workspace session |
| 不得把 `/workspace` 当作主 chat 页面处理 | /workspace 处理 workspaceSession，不是 mainChatSession |
| 不得把 `/workspaces` 当作单个 workspace detail 页面处理 | /workspaces 是列表页，不是详情页 |

## Server 侧对应

| 页面 | Server 路由 |
|------|-------------|
| /chat | `project-main-chat-session*`、`conversation-routes.ts` |
| /workspace | `collaboration-workspace-routes.ts`、`workspace-group-chat-routes.ts` |
| /workspaces | `workspace-management-routes.ts` |

## 改动时的检查

- 改 `/chat` 页面时，先看 `apps/web/src/routes/chat.tsx` 与 `apps/web/src/routes/-chat-route/*`
- 改 `/workspace` 页面时，先看 `apps/web/src/routes/workspace.tsx` 与 `components/workspaces/*`
- 改 `/workspaces` 页面时，先看 `apps/web/src/routes/workspaces.tsx` 与 `components/workspaces/*`

## 相关文档

- [关键概念与术语](./02-key-concepts.md)
- [会话模型](./14-session-models.md)
