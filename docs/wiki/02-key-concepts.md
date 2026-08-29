# 关键概念与术语

## 核心概念区分

### Session 相关

| 概念 | 说明 | 作用域 |
|------|------|--------|
| `mainChatSession` | 主 Agent 聊天会话 | `/chat` 页面 |
| `workspaceSession` | 工作区会话，关联具体项目 worktree | `/workspace` 页面 |
| `distributedTask` | 分发的编码任务，投递到 worker 执行 | 任务执行层 |
| `runtimeSessionId` | Agent runtime 的原生会话 ID | 执行层 |

### Workspace 相关

| 概念 | 说明 | 页面 |
|------|------|------|
| `taskId` | 任务 ID，关联看板任务 | 工作区详情 |
| `workspaceId` | 工作区 ID，关联项目 | 工作区列表 |
| `workspaceSessionId` | 工作区会话 ID，关联具体执行 | 工作区详情 |
| `projectId` | 项目 ID | 全局 |

### 三个页面边界

```
/chat                    - Agent Chat / 主聊天页
                          处理 mainChatSession

/workspace?...           - 单个工作区详情页
                          处理 workspaceSession + taskId + workspaceSessionId

/workspaces?...          - 工作区列表 / 工作区会话入口页
                          处理 workspaceId + workspaceSessionId 列表
```

**禁止混用**：
- 不得把 `/chat` 当作 workspace session 页面处理
- 不得把 `/workspace` 当作主 chat 页面处理
- 不得把 `/workspaces` 当作单个 workspace detail 页面处理

## Runtime 相关

| 概念 | 说明 |
|------|------|
| `RuntimeId` | worker 侧的真实执行标识：opencode/codex/claudecode/pi |
| `AgentType` | 业务层入口，对应 RuntimeId |
| `runtimeContinuation` | 按 scope（runtimeId + executorId + cwd hash）复用的会话 |
| `handoffSnapshot` | 会话切换时的摘要交接 |

## 执行链路概念

| 概念 | 说明 |
|------|------|
| `worktree` | Git worktree，worker 执行任务时的隔离工作目录 |
| `runtimeSkillPackages` | 执行级打包下发的 Skill 快照 |
| `mcpServers` | MCP server 配置，可覆盖当前执行 |
| `pi-mcp-tools` | Pi SDK 的 MCP bridge，将 MCP tools 桥接成 Pi customTools |

## 命名要求

在变量、函数、日志、注释里尽量写清作用域：

```typescript
// Good
const mainChatSessionId = useMainChatSession()
const workspaceSessionId = useWorkspaceSessionId()
const distributedTaskId = createDistributedTask()

// Bad - 过于泛化
const sessionId = getSession()
const data = getWorkspaceData()
```

## 相关文档

- [三个页面边界](./13-page-boundaries.md)
- [会话模型](./14-session-models.md)
- [Runtime 架构](./10-runtime-architecture.md)
