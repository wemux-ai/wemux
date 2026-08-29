# apps/worker - 执行面（L2）

> 职责边界、主要成员、对外接口与依赖方向。本文件是 L2 文档层级，变更时更新此头部，然后检查根 `AGENTS.md`。

## 定位

**唯一的代码执行入口**：worker daemon / Agent runtime / 仓库准备 / worktree / Git 交付 / 预览与终端。控制面不碰代码执行。

## 职责边界

- **做**：配对与连接、仓库准备（clone/fetch/探测）、worktree / original-dir、Agent runtime（OpenCode/Codex/ClaudeCode/Pi）、终端、预览、Git 交付（branch/commit/patch + 身份注入）、本地控制台。
- **不做**：不承担控制面 UI 假设；不持久化 Git 凭据（仅执行期内存，结束清除）；不伪造 workspace id 或退回根级目录结构。
- 新代码优先放入已有职责目录（见下），`index.ts` 只做命令入口分发。

## 主要成员（src/）

| 成员 | 职责 |
|------|------|
| `core/` | 配置、路径、runtime bootstrap、workspace 布局、cloud-url |
| `control-plane/` | 控制面通信边界：`pair-client`（配对）、`ws-client`、`route-selection`、`observation-client` |
| `execution/` | 任务执行链路：`agent-runner.ts`（统一入口）、`task-executor/`（git-workspace + preset-commands）、`runtime-context`、`prompt-attachments`、`git-identity` |
| `runtime/` | daemon、doctor、终端（terminal-session/zellij）、消息分发（`message-handler/`）、本地仓库探测、mesh、desktop-sandbox、browser-runner、model-config-export |
| `local-api/` | 本地 HTTP API + Worker Console 静态资源（默认 48121） |
| `preview-ingress/` `preview-tunnel/` | 预览入口与隧道（Local Direct / Gateway / Tunnel） |
| `update/` `cli/` `web/` `service/` | 版本检查、CLI、控制台 UI、服务安装 |

## 对外接口

- 对 server：executor WebSocket 协议（注册/heartbeat/task.ack/event/result，响应 `executor.*.request`）。
- 本地：`local-api`（/api/pair、/api/doctor、/api/status 等）+ Worker Console（48121）。
- **只出站连接控制面**，不做入站端口开放（本地控制台除外）。

## 依赖方向

- 依赖 `packages/shared`（`@shared/*` 协议类型）；连接 server；使用本机 Git / 终端 / runtime。
- 被 `apps/server` 通过 executor 协议驱动。

## 本地存储（重要）

- 分层：`~/.vibemux-dev/node`（节点级）、`users/<userId>`（用户私有，含凭据 runtime）、`workspaces/<workspaceId>`（workspace 共享）。
- 路径只用真实 `workspaceId`；`workspaceSessionId` 不能进目录层级；`unknown` 仅作迁移信号。
- 路径 helper 统一在 `packages/shared/src/workspace-paths.ts`。

## 测试

- 单测：`pnpm exec tsx --test apps/worker/src/**/*.test.ts`；smoke：`runtime-launch-smoke`。

[PROTOCOL]: 执行链路或对外协议变化时，更新本文件"主要成员"，然后检查根 AGENTS.md 与 Code Wiki（docs/wiki/03-execution-architecture.md、10-runtime-architecture.md）。
