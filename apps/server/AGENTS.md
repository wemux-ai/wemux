# apps/server - 控制面（L2）

> 职责边界、主要成员、对外接口与依赖方向。本文件是 L2 文档层级，变更时更新此头部，然后检查根 `AGENTS.md`。

## 定位

Hono 控制面：HTTP / WebSocket / SSE、鉴权、调度、状态聚合、聊天编排、计费、外部集成、收件箱与自动化。

## 职责边界

- **做**：编排与调度、状态聚合、产物登记、GitHub 资源同步、任务/工作区控制面、worker 请求派发。
- **不做**：不执行代码任务；不保存任务 patch / 测试文件；不做 worker 本地仓库执行。
- 路由层只做协议与校验；业务逻辑下沉 services / control-plane / repositories / integrations。

## 主要成员（src/）

| 成员 | 职责 |
|------|------|
| `routes/` | HTTP / WS 路由：项目/任务/工作区/会话/团队/设置/收件箱/自动化/计费/admin 等 |
| `services/` | 业务服务：聊天编排、调度、收件箱（inbox-*）、自动化（automation-*）、GitHub、Agent 事件和运行时能力等 |
| `control-plane/` | 执行器控制面：`executor-ws-service`（连接）、`executor-registry`、`scheduler`（调度）、`task-dispatch`、`task-chat-service`、`governance-service` |
| `integrations/` | 外部集成：telegram / feishu / github / opencode / mcp / agent / coding-agent |
| `repositories/` + `storage/` | 数据访问层；`storage/postgres`（Drizzle schema/migration）、conversation/distributed-task/execution-event/governance 等 store |
| `lib/` | filesystem-paths、runtime-paths、system-skills |
| `cluster/` | 集群相关 |
| `commercial-extension-loader.ts` + `extension-registry.ts` | 可选扩展运行时装配边界；没有扩展挂载时保持空注册表 |

## 对外接口

- 对 web：REST API + WS（main-chat/task-chat/workspace-session-history）+ SSE（inbox）。
- 对 worker：executor WebSocket 协议（发起 `task.assign` / `executor.*.request`，接收 ack/event/result/heartbeat）。
- 发起 worker 请求时**必须携带真实执行 `workspaceId`**；涉及用户私有 runtime/auth 时携带 `actingUserId` / `requestedByUserId`。

## 依赖方向

- 依赖 `packages/shared`（`@shared/*`）；使用 Postgres（Drizzle）+ S3 兼容对象存储。
- 被 `apps/web` 依赖；通过 executor 协议驱动 `apps/worker`。
- 扩展组合构建可从被忽略的独立挂载加载实现；核心只能依赖 gate/registry，不能静态 import 扩展模块。

## 数据与存储

- **唯一 DDL 路径**：改 `storage/postgres/schema.ts` / `schema-core.ts` → `pnpm db:generate` → 提交 `drizzle/000x_*.sql`；启动自动 migrate，老库自动 baseline。
- 禁止新增启动手写 `schemaStatements` / `migrationStatements`；web/worker/shared 禁止 import DB 客户端。

## 测试

- 路由/服务层单测：`pnpm exec tsx --test apps/server/src/**/*.test.ts`。

[PROTOCOL]: 模块结构或对外契约变化时，更新本文件"主要成员"，然后检查根 AGENTS.md 与 Code Wiki（docs/wiki/）。
