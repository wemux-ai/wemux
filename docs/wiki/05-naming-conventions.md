# 命名规范

## 核心原则

**名字要反映作用域，避免含糊的通用词**。如果一个概念在 UI、路由、存储、执行链路里不是同一个东西，名字就不该一样。

## Session 命名

| 场景 | 正确命名 | 错误命名 |
|------|----------|----------|
| 主聊天 session | `mainChatSessionId` | `sessionId`、`chatData` |
| 工作区 session | `workspaceSessionId` | `sessionId`、`workspaceData` |
| 分发的任务 | `distributedTaskId` | `taskId`（可能混淆） |
| Runtime session | `runtimeSessionId` | `sessionId` |

## 变量命名

```typescript
// Good - 明确反映类型和用途
const mainChatSession = useMainChatSession()
const workspaceSession = useWorkspaceSession()
const distributedTask = useDistributedTask()
const isTaskExecuting = ref(false)

// Bad - 过于泛化
const session = useSession()
const data = getData()
const flag = isLoading
```

## 函数命名

```typescript
// Good - 动词 + 明确目标
function createMainChatSession() {}
function createWorkspaceSession() {}
function dispatchDistributedTask() {}
function prepareWorktree() {}

// Bad - 过于泛化
function createSession() {}
function doTask() {}
```

## 路由与 API

```typescript
// Good - 反映具体业务语义
POST /api/projects/:projectId/main-chat-sessions
POST /api/workspaces/:workspaceId/workspace-sessions
POST /api/distributed-tasks

// Bad - 泛化
POST /api/sessions
POST /api/tasks
```

## 日志与注释

```typescript
// Good
logger.info(`[mainChatSession:${sessionId}] User message sent`)
logger.info(`[workspaceSession:${sessionId}] Executing task ${taskId}`)
logger.info(`[distributedTask:${taskId}] Worker ${executorId} started`)

// Bad
logger.info(`Session ${id} updated`)
logger.info(`Task started`)
```

## 文件命名

- 页面组件：`[page-name].tsx`（如 `chat.tsx`、`workspace.tsx`）
- 页面子组件：`-[sub-component-name].tsx`（如 `-chat-message.tsx`）
- Hooks：`use[ContextName].ts`（如 `useWorkspaceLaunch.ts`）
- 类型文件：`[feature].types.ts` 或在 `packages/shared/src/types/` 集中管理

## 常量枚举

```typescript
// Good
enum RuntimeId {
  OpenCode = 'opencode',
  Codex = 'codex',
  ClaudeCode = 'claudecode',
  Pi = 'pi',
}

enum SessionScope {
  MainChat = 'mainChat',
  Workspace = 'workspace',
}

// Bad
enum Runtime {
  R1 = 'opencode',
  R2 = 'codex',
}
```

## 相关文档

- [关键概念与术语](./02-key-concepts.md)
- [三个页面边界](./13-page-boundaries.md)
