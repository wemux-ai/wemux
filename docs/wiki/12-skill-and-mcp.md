# Skill 与 MCP

## Skill 同步语义

Skill 的真实生效路径不是"常驻同步到 worker"，而是**执行级打包下发**：

1. server 在每次 prompt/task 调度前构建 `runtimeSkillPackages`
2. worker 收到请求后才把这些 Skill 写入 runtime 目录
3. runtime 读取到的始终是本次执行可见的 Skill 快照

**当前 4 个 runtime 都能消费这条路径**：

| Runtime | Skill 读取方式 |
|---------|---------------|
| OpenCode | 沿用现有 SDK 能力读取 |
| Codex/ClaudeCode | worker 物化的本地目录读取 |
| Pi | `DefaultResourceLoader + additionalSkillPaths` 读取 |

## Skill 根目录

| Runtime | 目录 |
|---------|------|
| OpenCode | `.opencode/skills` |
| Codex | `.codex/skills` |
| ClaudeCode | `.claude/skills` |
| Pi | `.pi/skills` |

## 行为约束

- worker 优先将 Skill 写入 worker 管理的临时 runtime 目录，并在会话结束后清理
- 只有临时目录物化失败时，才会退回写入项目目录
- 项目目录兜底路径默认不做会话结束清理

## Pi 的 Skill 注入

Pi 的 preparation 额外会注入：
- `WEMUX_PI_AGENT_DIR`
- `WEMUX_PI_SKILL_PATHS`

这让 Pi runner 可以在不依赖默认 CLI 目录猜测的情况下，显式拿到：
- 当前应绑定的 Pi agent 根目录
- 当前执行上下文物化出来的 Skill 路径

## MCP 同步语义

MCP 有两条路径：
- **worker 配置级**：通过配置同步常驻到 worker
- **执行级**：本次请求携带 `mcpServers` 快照覆盖当前执行

## 不同 Runtime 的 MCP 物化方式

| Runtime | 物化方式 |
|---------|----------|
| OpenCode | 沿用现有 SDK 配置链路 |
| Codex | 生成稳定 `CODEX_HOME/config.toml` |
| ClaudeCode | 生成 `--mcp-config` 临时文件，并在必要时覆盖项目内 `.claude/settings.local.json` |
| Pi | 将启用且 `capabilityMode = resources+tools` 的 MCP server 动态桥接成 Pi SDK `customTools` |

## Pi MCP Bridge

Pi 的 MCP bridge 在 `apps/worker/src/execution/pi-mcp-tools.ts`。

**当前支持**：
- `stdio`
- `sse`
- `streamable http`

**桥接原则**：
- 复用 Wemux 已经解析好的 MCP server 定义
- 在 worker 里实时连接 MCP server
- 将远端 MCP tool 暴露为 Pi `customTools`
- 会话结束后统一关闭 MCP client

**限制**：`resources-only` MCP server 不会自动变成 Pi 的可调用工具

## 相关文档

- [Runtime 架构](./10-runtime-architecture.md)
- [Agent 执行链路](./11-agent-execution-flow.md)
- [CLI 与控制面 MCP](./19-cli-and-control-plane-mcp.md)（控制面 MCP 工具面：/mcp 端点、inbox/drive/chat 工具）
