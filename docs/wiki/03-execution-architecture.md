# 执行架构

## 核心原则：Worker-First

Wemux 的执行架构遵循 **worker-first** 原则：

- `server`：只负责控制面 API、调度、状态汇聚、产物登记、聊天/规划能力
- `worker`：唯一的代码任务执行入口，负责仓库准备、worktree、OpenCode 调用、patch/branch/commit 产物
- `web`：统一访问控制面，创建任务时默认走 worker；没有在线 worker 时不会回退到 server 本地执行

## 执行链路

```
User Request (web)
       │
       ▼
Server (control plane)
       │ dispatch task
       ▼
Worker (execution plane)
       │ prepare repo / worktree
       │ prepare runtime context
       │ execute via OpenCode/Codex/ClaudeCode/Pi
       │ collect artifacts / patches
       ▼
Artifact Registration (server)
       ▼
UI Update (web)
```

## Runtime 抽象

共享 runtime 定义在 `packages/shared/src/agent-type.ts`：

| Runtime | Transport | 模型 ID 策略 | Worker 执行 |
|---------|-----------|--------------|-------------|
| OpenCode | SDK | canonical | 是 |
| Codex | STDIO | native | 是 |
| ClaudeCode | STDIO | native | 是 |
| Pi | SDK | canonical | 是 |

## 关键文件

- `apps/worker/src/execution/agent-runner.ts` - 统一执行入口
- `apps/worker/src/execution/runtime-context.ts` - runtime 上下文准备
- `apps/worker/src/execution/runtime-preparation.ts` - runtime 准备
- `packages/shared/src/task-workspace.ts` - 会话续接逻辑

## Session Continuation

Native session continuation 按 scope 复用：

```typescript
interface RuntimeContinuationScope {
  runtimeId: string      // opencode | codex | claudecode | pi
  executorId: string     // worker executor id
  customAgentId?: string
  executionModel?: string
  cwdHash: string         // working directory hash
}
```

续接策略：
1. 优先读取 `runtimeContinuations`
2. scope 不匹配时退回 handoff snapshot（摘要交接）
3. 不再允许错误地跨 runtime/executor/model 直接续接旧原生线程

## 相关文档

- [Runtime 架构](./10-runtime-architecture.md)
- [Agent 执行链路](./11-agent-execution-flow.md)
