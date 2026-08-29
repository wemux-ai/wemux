# 会话模型

## Session 类型区分

| Session | 说明 | 页面 |
|---------|------|------|
| `mainChatSession` | 主 Agent 聊天会话 | /chat |
| `workspaceSession` | 工作区会话，关联具体项目 worktree | /workspace |
| `distributedTask` | 分发的编码任务，投递到 worker 执行 | 任务执行层 |

## Main Chat Session

主聊天会话，处理主 Agent 编排链路：

- 需求理解
- worker 路由
- Agent 选择
- 需求下发
- 结果验证
- 人工确认

**Server 路由**：`apps/server/src/routes/project-main-chat-session.ts`

## Workspace Session

工作区会话，关联具体项目 worktree：

- `workspaceId` - 工作区 ID
- `workspaceSessionId` - 工作区会话 ID
- `taskId` - 当前任务 ID
- `runtimeId` - 执行的 runtime

**Server 路由**：
- `apps/server/src/routes/collaboration-workspace-routes.ts`
- `apps/server/src/routes/workspace-group-chat-routes.ts`
- `apps/server/src/routes/workspace-management-routes.ts`

## Runtime Session

Agent runtime 的原生会话 ID：

- `runtimeSessionId` 不等于页面 session id
- 按 scope（runtimeId + executorId + cwd hash）复用

## Distributed Task

分发的编码任务：

- `distributedTaskId` 不等于 `taskId`
- 投递到 worker 执行
- 在 `/execution` 可见生命周期

## Session Continuation 原则

1. **优先复用 native session**：按 scope 复用，而不是粗粒度按 agentType
2. **scope 不匹配时退回摘要交接**：不会错误地跨 runtime/executor/model 直接续接旧原生线程
3. **Legacy fallback 仅当历史数据无 scoped continuation 时**：不再无条件 fallback

## 关键检查

- `workspaceSessionId` 不等于 `taskId`
- `runtimeSessionId` 不等于页面 session id
- `main chat session`、`workspace session`、`external thread` 需要分开命名和存储

## 相关文档

- [关键概念与术语](./02-key-concepts.md)
- [三个页面边界](./13-page-boundaries.md)
- [Agent 执行链路](./11-agent-execution-flow.md)
