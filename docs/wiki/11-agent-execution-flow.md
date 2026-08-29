# Agent 执行链路

## 执行链路总览

```
Server (dispatch task)
    │
    ▼
Worker Agent Runner
    │
    ├─► 1. Check runtime readiness
    │
    ├─► 2. Materialize attachments & skills
    │
    ├─► 3. Prepare runtime context
    │
    ├─► 4. Select runner (by RuntimeId)
    │       ├─► OpenCode Runner
    │       ├─► Codex Runner
    │       ├─► ClaudeCode Runner
    │       └─► Pi Runner
    │
    ├─► 5. Execute task
    │
    ├─► 6. Stream events back to server/UI
    │
    └─► 7. Cleanup session
```

## 统一执行入口

`apps/worker/src/execution/agent-runner.ts`

主要流程：
1. 检查目标 runtime readiness
2. 物化附件与执行级 Skill
3. 准备 runtime 上下文与 runtime env
4. 通过 `RuntimeId -> runner` 注册表选择具体实现
5. 将标准化事件回传给 server/UI
6. 做会话级清理

## Task Runner 差异

| Runtime | Prompt Runner | Task Runner |
|---------|---------------|-------------|
| OpenCode | 原生 | 继续走专用 task runner |
| Codex | 原生 | 复用统一包装层 |
| ClaudeCode | 原生 | 复用统一包装层 |
| Pi | 原生 | 通过真实 Pi SDK prompt runner 执行 |

## Session Continuation

Native session continuation 按 scope 复用：

```typescript
interface RuntimeContinuationScope {
  runtimeId: string       // opencode | codex | claudecode | pi
  executorId: string      // worker executor id
  customAgentId?: string
  executionModel?: string
  cwdHash: string         // working directory hash
}
```

**续接策略**：
1. 优先读取 `runtimeContinuations`
2. 如果某个 runtime 已经进入新 continuation 结构，则不再回退到 legacy `agentSessionId`/`opencodeSessionId`
3. 只有历史数据还没有该 runtime 的 scoped continuation 时，才允许 legacy fallback

## Handoff Snapshot

当 native continuation scope 不再安全复用时，系统走 handoff snapshot：

- 较早摘要
- 最近消息窗口
- 最新用户/助手摘要

## Pi 接入方式

Pi runner 在 `apps/worker/src/execution/pi-runner.ts`，直接使用官方 SDK：
- `createAgentSession`
- `DefaultResourceLoader`
- `SessionManager`
- `SettingsManager`
- `ModelRegistry`

Pi 会话目录固定落到：`agentDir/sessions-vibemux/<agentDir+cwd hash>`

## 相关文档

- [Runtime 架构](./10-runtime-architecture.md)
- [会话模型](./14-session-models.md)
