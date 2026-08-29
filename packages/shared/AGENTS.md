# packages/shared - 跨端共享层（L2）

> 职责边界、主要成员、对外接口与依赖方向。本文件是 L2 文档层级，变更时更新此头部，然后检查根 `AGENTS.md`。

## 定位

跨端（web / server / worker）共享的**类型、协议、数据结构与纯函数**。三端都理解的结构必须放这里，禁止各端复制类型再漂移。

## 职责边界

- **做**：共享类型（DTO/契约）、跨端纯函数（路径、状态机、差分规划、校验）、协议消息定义。
- **不做**：不引入浏览器 API 或 Node 特有副作用；不依赖 Drizzle / DB 客户端；不承载业务逻辑实现。

## 主要成员（src/）

| 成员 | 职责 |
|------|------|
| `types/` | 核心类型：`task-domain.ts`（Task/Workspace/Session/DistributedTask/Automation…）、`executor.ts` + `executor-messages.ts`（executor 双向协议）、`core.ts`、`desktop-sandbox.ts`、`preview.ts`、`remote-code.ts`、`mesh.ts` |
| `agent-type.ts` / `custom-agent.ts` | Runtime（OpenCode/Codex/ClaudeCode/Pi）与自定义 Agent 契约 |
| `workspace-paths.ts` | worker 本地路径 helper（node/users/workspaces 分层 + playground 自由工作区路径） |
| `playground-workspace.ts` | 无项目自由工作区虚拟项目常量 / worktreeId 标识 / 判定（`__playground__`） |
| `thread-message*.ts` | 消息双写模型与 fingerprint 差分规划器 |
| `inbox.ts` | 统一收件箱数据模型 |
| `user-appearance-settings.ts` | 用户主题与桌面毛玻璃效果配置契约 |
| `scheduling-brain.ts` | 工作区调度大脑契约（意图类型 + 规则分类/目标选择纯函数，feature） |
| `task-workspace.ts` / `main-chat-session.ts` / `workspace-session*.ts` | 会话/执行续接逻辑 |
| `skill.ts` / `mcp.ts` / `model-profile.ts` | 能力配置契约 |
| `task-history.ts` / `timeline.ts` / `task-status-flow.ts` | 状态与历史纯函数 |
| `utils.ts` | 通用纯函数 |

## 对外接口

- 被 `apps/web`、`apps/server`、`apps/worker` 三端消费（`@shared/*` 别名）。
- 新增跨端字段：**先改 shared**，再同步 web/server/worker 消费方。

## 依赖方向

- 零外部副作用依赖（仅 zod 等类型校验轻依赖）。
- **不反向依赖**任何 app；web/worker 禁止 import shared 中的 DB/环境特定实现。

## 测试

- 纯函数必须可单测（`node:test` / `tsx --test`），见 `*.test.ts`。

[PROTOCOL]: 变更 shared 顶层结构或大契约时，更新本文件"主要成员"，然后检查根 AGENTS.md 与 Code Wiki（docs/wiki/06-types-and-shared.md）。
