# Worker Agent 架构总览

> 更新时间：2026-05-15

这份文档描述 Wemux 当前的 `worker-only coding runtime` 架构，以及 4 个 coding agent 在会话续接、MCP、Skill、模型绑定上的真实状态。

## 1. 当前结论

- Wemux 已经是明确的 `worker-only execution` 架构。
- `server` 负责控制面、状态持久化、权限、调度和执行快照组装。
- `apps/worker` 负责本地仓库、runtime readiness、Skill 物化、MCP 注入、CLI/SDK 调用、native session 续接和结果回传。
- 4 个 coding runtime 现在都已经进入统一底座：
  - `OpenCode`
  - `Codex`
  - `ClaudeCode`
  - `Pi`

## 2. Runtime 抽象

共享 runtime 定义在：

- `packages/shared/src/agent-type.ts`

当前矩阵：

| Runtime | Transport | 模型 ID 策略 | Worker 执行 | 当前状态 |
| --- | --- | --- | --- | --- |
| OpenCode | SDK | canonical | 是 | 已接入 |
| Codex | STDIO | native | 是 | 已接入 |
| ClaudeCode | STDIO | native | 是 | 已接入 |
| Pi | SDK | canonical | 是 | 已接入 |

这里的关键点是：

- `RuntimeId` 已成为 worker 侧的真实执行标识。
- `AgentType` 仍是业务层入口，但执行层不再靠散落的 `if/else` 挂接 runtime。
- `Pi` 不再是占位字符串，而是完整进入 runtime registry、runtime bootstrap、runtime preparation、prompt runner、model export、session inspect 的一等成员。

## 3. 执行链路

统一执行入口在：

- `apps/worker/src/execution/agent-runner.ts`

主流程：

1. 检查目标 runtime readiness。
2. 物化附件与执行级 Skill。
3. 准备 runtime 上下文与 runtime env。
4. 通过 `RuntimeId -> runner` 注册表选择具体实现。
5. 将标准化事件回传给 server / UI。
6. 做会话级清理。

当前 task 能力矩阵：

| Runtime | Prompt | Task | 当前行为 |
| --- | --- | --- | --- |
| OpenCode | 原生 | 原生 | 继续走专用 task runner |
| Codex | 原生 | prompt 包装 | 复用统一包装层 |
| ClaudeCode | 原生 | prompt 包装 | 复用统一包装层 |
| Pi | 原生 | prompt 包装 | 通过真实 Pi SDK prompt runner 执行 |

这意味着：

- OpenCode 仍保留最成熟的专用任务链。
- Codex / ClaudeCode / Pi 目前共享“任务包装成 prompt”的执行模型。
- Pi 已能真正执行，但还没有专属 task runner。

## 4. Runtime Preparation

runtime 上下文准备在：

- `apps/worker/src/execution/runtime-context.ts`

不同 runtime 的 Skill 根目录：

- OpenCode: `.opencode/skills`
- Codex: `.codex/skills`
- ClaudeCode: `.claude/skills`
- Pi: `.pi/skills`

行为约束：

- worker 优先将 Skill 写入 worker 管理的临时 runtime 目录，并在会话结束后清理。
- 只有临时目录物化失败时，才会退回写入项目目录。
- 项目目录兜底路径默认不做会话结束清理。

Pi 的 preparation 额外会注入：

- `WEMUX_PI_AGENT_DIR`
- `WEMUX_PI_SKILL_PATHS`

这让 Pi runner 可以在不依赖默认 CLI 目录猜测的情况下，显式拿到：

- 当前应绑定的 Pi agent 根目录
- 当前执行上下文物化出来的 Skill 路径

## 5. Skill 同步语义

Skill 的真实生效路径不是“常驻同步到 worker”，而是“执行级打包下发”：

- server 在每次 prompt / task 调度前构建 `runtimeSkillPackages`
- worker 收到请求后才把这些 Skill 写入 runtime 目录
- runtime 读取到的始终是本次执行可见的 Skill 快照

当前 4 个 runtime 都能消费这条路径：

- OpenCode 通过原有 SDK 能力读取
- Codex / ClaudeCode 通过 worker 物化的本地目录读取
- Pi 通过 `DefaultResourceLoader + additionalSkillPaths` 读取

因此“系统全局 Skill 是否能同步到 4 个 coding agent”这个问题，当前答案是：

- 可以
- 但同步语义是“下一次执行时按上下文物化”，不是“后台常驻预同步”

## 6. MCP 同步语义

MCP 有两条路径：

- worker 配置级：通过配置同步常驻到 worker
- 执行级：本次请求携带 `mcpServers` 快照覆盖当前执行

不同 runtime 的物化方式不同：

- OpenCode：沿用现有 SDK 配置链路
- Codex：生成稳定 `CODEX_HOME/config.toml`
- ClaudeCode：生成 `--mcp-config` 临时文件，并在必要时覆盖项目内 `.claude/settings.local.json`
- Pi：将启用且 `capabilityMode = resources+tools` 的 MCP server 动态桥接成 Pi SDK `customTools`

Pi 的 MCP bridge 在：

- `apps/worker/src/execution/pi-mcp-tools.ts`

当前支持：

- `stdio`
- `sse`
- `streamable http`

桥接原则：

- 复用 Wemux 已经解析好的 MCP server 定义
- 在 worker 里实时连接 MCP server
- 将远端 MCP tool 暴露为 Pi `customTools`
- 会话结束后统一关闭 MCP client

因此“系统全局 MCP 能不能给 4 个 coding agent 用”的当前答案是：

- 可以
- 但 Pi 侧当前只桥接 `resources+tools` 服务器里的 tool 能力
- `resources-only` MCP server 不会自动变成 Pi 的可调用工具

## 7. Pi 真实接入方式

Pi runner 在：

- `apps/worker/src/execution/pi-runner.ts`

它不是 CLI shim，而是直接使用官方 SDK：

- `createAgentSession`
- `DefaultResourceLoader`
- `SessionManager`
- `SettingsManager`
- `ModelRegistry`

Pi 会话准备在：

- `apps/worker/src/execution/pi-session-config.ts`

当前行为：

- `agentDir` 按以下优先级解析：
  - 执行级 `WEMUX_PI_AGENT_DIR`
  - `agentSettings.Pi.agentDir`
  - `workerConfig.piAgentDir`
  - `~/.pi/agent`
- Pi 会话目录不再依赖默认 CLI 路径，而是固定落到：
  - `agentDir/sessions-wemux/<agentDir+cwd hash>`
- 执行模型会优先走 canonical `provider/model`
- 如果 worker 运行时提供了自定义 `baseUrl` 或模型不在当前 `models.json` 中，会生成 overlay `models.json`
- API key 会通过 `AuthStorage.setRuntimeApiKey()` 注入 runtime 作用域

这保证了 Pi 在 Wemux 中具备：

- 稳定的会话续接路径
- 可控的模型/provider 覆盖能力
- 不污染默认 Pi CLI 会话目录的可管理落盘行为

## 8. Native Session Continuation

主会话续接相关逻辑在：

- `packages/shared/src/task-workspace.ts`
- `apps/server/src/routes/project-main-chat-session.ts`

当前 native continuation 是按 scope 复用，而不是粗粒度按 agentType 复用。

scope 关键字段包括：

- `runtimeId`
- `executorId`
- `customAgentId`
- `executionModel`
- `cwd hash`

当前续接策略：

- 优先读取 `runtimeContinuations`
- 如果某个 runtime 已经进入新 continuation 结构，则不再回退到 legacy `agentSessionId` / `opencodeSessionId`
- 只有历史数据还没有该 runtime 的 scoped continuation 时，才允许 legacy fallback

这个修正非常关键，因为它消除了过去几个高风险问题：

- 切换 runtime 还误接旧会话
- 切换 executor 还误接旧会话
- 切换 execution model 还误把消息追加进错误 native thread

Pi 接入后，这套 continuation 也同样适用：

- server 侧 continuation 已是 runtime-aware
- worker 侧 Pi session manager 已有稳定会话目录
- local agent session inspector 也能读取 Pi managed sessions

## 9. Handoff Snapshot

当 native continuation scope 不再安全复用时，系统不会回放全量历史，而是走 handoff snapshot：

- 较早摘要
- 最近消息窗口
- 最新用户/助手摘要

所以“会话切换能不能流程切换”的当前答案是：

- 能
- 优先复用 native session
- scope 不匹配时退回摘要交接
- 不再允许错误地跨 runtime / executor / model 直接续接旧原生线程

## 10. 模型绑定与导出

worker 侧模型导出在：

- `apps/worker/src/runtime/model-config-export.ts`

当前已支持：

- OpenCode
- Codex
- ClaudeCode
- Pi

Pi 导出能力包括：

- 从 `agentSettings.Pi.defaultModel`、Pi `settings.json`、Pi `models.json` 推断默认绑定
- 导出 canonical `providerId/modelId`
- 透出 `runtimeSettings.defaultModel`
- 透出 `runtimeSettings.agentDir`

控制面配置导出现在也会回传：

- `agentSettings`
- `resolvedModelBindings`

这让以下链路都能正确处理 Pi：

- 设置页从 worker 导入 Pi 默认模型 / agentDir
- 模型 Profile 从 worker 导入 Pi binding
- runtime-specific 模型列表读取

### 10.1 模型库自动发现入库

从 2026-05-15 开始，`resolvedModelBindings` 不再只是“设置页导入时临时读一下”，而是开始承担统一模型库的自动发现入口：

- worker 节点上线后，server 会主动向在线 executor 请求 `config.export.request(includeResolvedModelBindings: true)`
- 控制面会把 `OpenCode`、`Codex`、`ClaudeCode`、`Pi` 当前解析出的 `providerId/modelId/baseUrl/apiToken/runtimeSettings` 同步进 `model_profiles`
- 模型库页新增了“从节点获取模型”按钮，用于手动触发全量同步
- 同一个 `providerId + modelId + baseUrl` 会尽量归并成同一个模型 Profile，方便跨节点复用
- 如果只是“别人共享给你可见”的模型命中相同 binding，自动发现只复用，不会越权改写对方的 Profile

这样模型库开始从“手工录入入口”变成真正的中心索引：

- 节点本地配置负责提供发现来源
- 控制面负责统一入库和跨节点共享
- runtime 执行时继续按模型库绑定注入对应 env / base URL / token

## 11. Worker Console / Local Inspect

本地 agent session inspect 在：

- `apps/worker/src/local-api/agent-sessions.ts`

当前支持：

- `claude`
- `opencode`
- `codex`
- `pi`

Pi inspect 现在不仅会扫默认 `sessions` 目录，也会扫：

- `agentDir/sessions-wemux`

因此 worker console 可以看到 Wemux 自己管理的 Pi 会话，而不是只看到 Pi 默认 CLI 会话。

## 12. Runtime 能力矩阵

| Runtime | Bootstrap | Prompt Runner | Task Runner | Skills | MCP | Session Continuation |
| --- | --- | --- | --- | --- | --- | --- |
| OpenCode | 已接入 | 已接入 | 已接入 | 执行级物化 | 已接入 | 已接入 |
| Codex | 已接入 | 已接入 | prompt 包装 | 执行级物化 | 已接入 | 已接入 |
| ClaudeCode | 已接入 | 已接入 | prompt 包装 | 执行级物化 | 已接入 | 已接入 |
| Pi | 已接入 | 已接入 | prompt 包装 | `DefaultResourceLoader` 读取执行级 Skill | MCP tool bridge 已接入 | 已接入 |

## 13. Runtime 配置同步与认证适配

这一节记录 4 个 coding runtime 当前的“跨节点可移植配置”语义，避免后面继续把“同步配置”“同步登录态”“复制宿主机目录”混成一件事。

统一原则：

- Wemux 默认同步的是 `worker managed config`，不是直接复制宿主机 `~/.agent-home`。
- 真正执行时始终物化临时 runtime home，并把本次执行需要的配置、Skill、MCP、env 注入进去。
- 只有用户显式从模型库切换模型时，才覆盖 runtime 默认模型/provider；否则优先尊重同步过来的本地 runtime 配置。
- 高敏感凭证优先走“运行时环境变量注入”，不默认复制或中央托管原始认证文件。

当前矩阵：

| Runtime | 中央同步主配置 | 认证/密钥策略 | 跨节点适配要点 | 当前备注 |
| --- | --- | --- | --- | --- |
| OpenCode | `opencodeConfigContent` | 以配置内容与 runtime env 为主 | 执行期仍走 worker 物化，不直接覆盖宿主机 OpenCode 配置目录 | 继续沿用现有 managed config + runtime merge 语义 |
| Codex | `codexConfigContent` + `codexAuthContent` | `codexAuthContent` 现在表示运行时 env JSON，而不是默认写回 `auth.json` | 自定义 provider 必须在临时 `config.toml` 中显式物化 `name` 与 `env_key`；如果已有 provider token，则不能再把 `account/read.requiresOpenaiAuth = true` 当成致命未登录 | 这是 2026-05-15 跨节点适配打通的关键修正 |
| ClaudeCode | `claudeCodeConfigContent` | 优先读取 `settings.json` 里的 env；缺失时回退本地 `.credentials.json` | 仍然是临时 `CLAUDE_HOME` 物化，不要求每个节点先手动改宿主机配置 | 中央同步的是 settings，不是强制复制本地 credentials |
| Pi | `agentSettings.Pi` / `piAgentDir` / runtime overlay | 运行时注入 API key 与 overlay `models.json` | 会话目录、模型 overlay、Skill 路径都由 worker 统一管理 | 新节点上已确认可以成功回复；Pi 没有走“复制本地 CLI home”路线 |

### 13.1 Codex 当前落地规则

这次 Codex 跨节点跑通后，约束已经比较明确：

1. 不复制宿主机 `~/.codex` 到新节点。
2. 同步 `config.toml` 时，只要求 provider/base_url/model/env_key 这些“可移植运行配置”。
3. `codexAuthContent` 保存的是运行时密钥 env JSON，例如 `OPENAI_API_KEY`，不是默认托管 `auth.json`。
4. worker 执行前会生成临时 `CODEX_HOME`，并确保自定义 provider section 至少包含：
   - `name`
   - `env_key`
5. 如果用户没有显式切换模型库模型，Codex 默认继续使用同步来的本地默认配置。
6. 只有用户显式选择模型库模型时，worker 才在 launch 时重写 `model` / `model_provider` / `base_url`。
7. `account/read` 在 provider 模式下只能作为参考信号，不能再单独决定“是否允许执行”。

## 14. 一句话总结

Wemux 的 worker agent 架构为多个 coding runtime 提供统一的会话续接、Skill 注入、MCP 注入、模型导出和本地会话观测链路。
