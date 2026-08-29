# Runtime 架构

## 概述

Wemux 支持 4 个 coding runtime 的统一底座：

| Runtime | Transport | 模型 ID 策略 | 状态 |
|---------|-----------|--------------|------|
| OpenCode | SDK | canonical | 已接入 |
| Codex | STDIO | native | 已接入 |
| ClaudeCode | STDIO | native | 已接入 |
| Pi | SDK | canonical | 已接入 |

## Runtime 定义

共享定义在 `packages/shared/src/agent-type.ts`：

```typescript
export enum RuntimeId {
  OpenCode = 'opencode',
  Codex = 'codex',
  ClaudeCode = 'claudecode',
  Pi = 'pi',
}
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `apps/worker/src/execution/agent-runner.ts` | 统一执行入口，根据 RuntimeId 分发 |
| `apps/worker/src/execution/runtime-context.ts` | runtime 上下文准备 |
| `apps/worker/src/runtime/model-config-export.ts` | 模型配置导出 |
| `apps/worker/src/execution/pi-runner.ts` | Pi SDK 接入 |
| `apps/worker/src/execution/pi-mcp-tools.ts` | Pi MCP bridge |

## Skill 根目录

| Runtime | Skill 目录 |
|---------|------------|
| OpenCode | `.opencode/skills` |
| Codex | `.codex/skills` |
| ClaudeCode | `.claude/skills` |
| Pi | `.pi/skills` |

## Skill 同步语义

Skill 的真实生效路径不是"常驻同步到 worker"，而是"执行级打包下发"：

1. server 在每次 prompt/task 调度前构建 `runtimeSkillPackages`
2. worker 收到请求后才把这些 Skill 写入 runtime 目录
3. runtime 读取到的始终是本次执行可见的 Skill 快照

## MCP 同步语义

MCP 有两条路径：
- **worker 配置级**：通过配置同步常驻到 worker
- **执行级**：本次请求携带 `mcpServers` 快照覆盖当前执行

## 模型绑定与导出

worker 侧模型导出在 `apps/worker/src/runtime/model-config-export.ts`：

- 支持 OpenCode、Codex、ClaudeCode、Pi
- 导出 canonical `providerId/modelId`
- 透出 `runtimeSettings.defaultModel` 和 `runtimeSettings.agentDir`

## Runtime 能力矩阵

| Runtime | Bootstrap | Prompt Runner | Task Runner | Skills | MCP | Session Continuation |
|---------|-----------|---------------|-------------|--------|-----|---------------------|
| OpenCode | 已接入 | 已接入 | 专用 task runner | 执行级物化 | 已接入 | 已接入 |
| Codex | 已接入 | 统一包装 | prompt 包装 | 执行级物化 | 已接入 | 已接入 |
| ClaudeCode | 已接入 | 统一包装 | prompt 包装 | 执行级物化 | 已接入 | 已接入 |
| Pi | 已接入 | 统一包装 | prompt 包装 | DefaultResourceLoader | MCP tool bridge | 已接入 |

## 相关文档

- [WORKER-AGENT-ARCHITECTURE.md](../../WORKER-AGENT-ARCHITECTURE.md) - 详细 runtime 架构
- [Agent 执行链路](./11-agent-execution-flow.md)
- [Skill 与 MCP](./12-skill-and-mcp.md)
