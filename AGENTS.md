# AGENTS.md - Wemux 项目开发指南

> 本指南供 AI coding agent 使用。人类开发者请优先参考 `README.md` 与相关 `docs/`。

## Open Core 边界

- 本仓库是公开核心，只能提交社区版代码和明确允许公开的文档。
- 可选的商业扩展通过 gate/registry 边界装配；不得把商业实现或内部运营材料复制进本仓库。
- `docs/` 只收录面向社区的开发、自托管、架构和贡献文档；内部战略、发布、营销、调研、生产运维和实施方案不得加入。
- 修改或推送前运行 `node scripts/open-core/public-boundary.mjs --staged`；
  公开构建必须在没有可选扩展挂载的干净环境中通过。

## 核心哲学

**1. 好品味优先**
- 优先消灭特殊分支，而不是堆更多 `if`
- 能通过重构让边界自然消失，就不要补丁式修补
- 复杂度会上瘾，默认先怀疑复杂方案

**2. Worker-first**
- Wemux 是一个“由 worker 执行代码任务”的平台
- `server` 是控制面，不是本地代码执行器
- `web` 是控制台，不是执行环境
- 涉及代码执行、worktree、仓库准备、agent runtime 时，默认先看 `worker`

**3. 实用主义**
- 优先解决真实线上/开发流问题
- 不为假想抽象重写整条链路
- 小步修正，保持系统可运行、可验证、可回退

**4. 简洁执念**
- 函数应短小、单一职责
- 超过 3 层缩进时，优先重构
- 新增函数尽量控制在 100 行内
- 新增文件若逼近 800 行，优先拆分，至少不要继续恶化

## 项目现实

- 当前仓库是 monorepo，不再是早期的 `src/` + `server/` 扁平结构
- 前端在 `apps/web`
- 控制面后端在 `apps/server`
- 执行器 / daemon / 本地控制台在 `apps/worker`
- 跨端共享类型与契约在 `packages/shared`
- Postgres 是主持久化存储；**schema / 迁移由 Drizzle 管理**（见下方「Postgres 与 Drizzle」）
- S3 兼容对象存储用于头像、图片等非代码文件对象；任务 patch 与测试文件不得上传到控制面
- worker 是唯一代码执行入口；没有在线 worker 时，不应偷偷回退成 server 本地执行
- Main Chat、Direct Chat、Group Chat 与外部渠道 Agent 涉及项目仓库的代码、Git、测试与构建时，优先派发到 Workspace Session 执行，以获得正确仓库上下文、隔离 worktree 与可追溯记录；不涉及项目仓库，或没有关联项目/可用 Workspace 时，允许在 Agent 自己的默认工作目录直接完成。这是提示词层的优先级约定，运行时不再按渠道限制工具能力
- 普通聊天或外部渠道中的项目代码工作默认先创建 Task，再选择或创建 Workspace 并派发执行；只有用户在当前消息中明确要求直接创建工作区时才允许跳过 Task
- Agent 都是用户拥有的普通 Agent；`CEO Agent` 只是一份新用户首 Agent 示例模板，创建后可自由修改或删除，不具备系统身份且删除后不会自动重建

## 当前目录结构

```text
.
├── apps/
│   ├── web/                    # React + Vite + TanStack Start
│   │   ├── src/routes/         # 页面路由
│   │   └── src/components/     # UI 与业务组件
│   ├── server/                 # Hono 控制面 / WS / 调度 / 集成
│   │   └── src/
│   ├── worker/                 # 本地执行器 daemon / worker console
│   │   └── src/
│   ├── desktop/                # Electron 桌面客户端
│   ├── mobile/                 # React Native + Expo 移动客户端
├── packages/
│   └── shared/                 # 共享类型、契约、工具
├── scripts/                    # 构建与开发脚本
├── docs/                       # 面向社区的开发、架构与部署文档
└── dist-server/                # 服务端构建产物
```

## 页面与会话边界

### 三个页面概念必须分清

- `http://app.vibemux.localtest.me:15173/chat` 是 **Agent Chat / 主聊天页**
- `http://app.vibemux.localtest.me:15173/workspace?...` 是 **单个工作区详情页**
- `http://app.vibemux.localtest.me:15173/workspaces?...` 是 **工作区列表 / 工作区会话入口页**

### 默认语义

- 用户说“AI 会话”“聊天窗口”“agent chat”“对话页”时，默认指 `/chat`
- `/chat` 同时支持直接 Agent 会话和组织群聊；群聊只是人/Agent 沟通容器，不等于任务负责人中的 Squad，也不进入任务指派或评论 Mention 目录
- 用户说“工作区”“工作台”“workspace detail”“单个会话工作区”时，默认指 `/workspace`
- 用户说“工作区会话列表”“workspaces 页面”“某任务下有哪些会话”时，默认指 `/workspaces`

### 禁止混用

- 不得把 `/chat` 当作 workspace session 页面处理
- 不得把 `/workspace` 当作主 chat 页面处理
- 不得把 `/workspaces` 当作单个 workspace detail 页面处理
- 用户已经明确说“这是 agent chat”或“这是工作区会话”时，后续实现必须严格服从

### 动手前先定位代码

- `/chat` 先看 `apps/web/src/routes/chat.tsx` 与 `apps/web/src/routes/-chat-route/*`
- `/workspace` 先看 `apps/web/src/routes/workspace.tsx` 与 `components/workspaces/*`
- `/workspaces` 先看 `apps/web/src/routes/workspaces.tsx` 与 `components/workspaces/*`
- server 侧主聊天相关优先看 `project-main-chat*`、`conversation-routes.ts`
- server 侧工作区相关优先看 `collaboration-workspace-routes.ts`、`workspace-group-chat-routes.ts`、`workspace-management-routes.ts`

### 命名要求

- 变量、函数、日志、注释里尽量写清 `mainChatSession`、`workspaceSession`、`distributedTask`
- 避免只写含糊的 `session`、`chatData`、`workspaceData`
- 只要跨页面共享逻辑，名称里要反映作用域，避免后续 AI 再改错地方

## 架构职责

### `apps/web`

- 负责 UI、路由、交互状态、表单、展示与调用控制面 API
- 不要在 web 里发明本地执行逻辑
- 路由相关逻辑优先靠近 `routes/` 与对应 `components/` 放置

### `apps/server`

- 负责 Hono HTTP / WebSocket、调度、鉴权、计费、聊天编排、工作区/任务控制面
- server 可以做 orchestration、state aggregation、artifact registration
- server 不应承担 worker 本地仓库执行职责

### `apps/worker`

- 负责配对、daemon、仓库准备、worktree、agent CLI/runtime、产物回传
- 任何 Git worktree、仓库 checkout、patch 生成、终端执行问题，默认先从 `worker` 查
- 修改执行链路时，要小心控制面协议兼容

### `packages/shared`

- 放共享类型、协议、数据结构、跨端纯函数
- 只要 web/server/worker 至少两端都要理解的结构，优先放这里
- 禁止在三端各自复制一份相同类型再慢慢漂移

## Worker 本地存储与多用户隔离

worker 本地目录要按“节点级、用户私有、workspace 共享”分层，长期目标结构见 `docs/WORKER-LOCAL-STORAGE.md`：

```text
~/.vibemux-dev/
├── node/
│   ├── config.json
│   ├── machine-id
│   ├── runtime/
│   └── cache/
├── users/
│   └── <userId>/
│       ├── projects/
│       ├── repos/
│       ├── worktrees/
│       ├── runtime/
│       └── cache/
└── workspaces/
    └── <workspaceId>/
        ├── projects/
        ├── repos/
        ├── worktrees/
        ├── cache/
        └── artifacts/
```

目录规则：

- `node/` 只放机器级配置、machine id、节点级 daemon/tool runtime/cache，不放项目代码或用户凭据。
- 私人项目或尚未进入执行 workspace 的资源落在 `users/<ownerUserId>/projects|repos|worktrees`。
- Codex/Claude 等带凭据的 agent runtime 落在 `users/<actingUserId>/runtime`，不能放进 workspace 共享目录。
- workspace session 执行资源落在 `workspaces/<workspaceId>/projects|repos|worktrees|cache|artifacts`。
- 同一个 workspace 被多个成员使用时，路径只使用真实 `workspaceId`；不要按 owner 或 acting user 再拆一份 workspace 目录。
- `project.workspaceId` 是项目可见性/团队归属，不等于本地执行 workspace id；只有真实 `WorkspaceRecord.id` / workspace session scope 才能用于本地路径。
- `workspaceSessionId` 不能替代 `workspaceId` 出现在目录层级里。
- `unknown` 只能作为历史路径识别或迁移信号，不能作为新建目录的 userId 或 workspaceId。

改本地路径相关代码时：

- 优先改 `packages/shared/src/workspace-paths.ts` 里的共享 helper，再同步消费方。
- server 发起 worker 请求时必须统一携带真实执行 `workspaceId`；涉及用户私有 runtime/auth 时必须携带 `actingUserId` / `requestedByUserId`。
- worker 不要用 `taskId` 伪造 workspace id，也不要退回创建根级 `projects/`、`repos/`、`worktrees/`。
- 旧结构只允许 remap/识别，不允许作为新的目标结构继续创建。

## 本地开发命令

### 常用

```bash
pnpm install
pnpm dev
pnpm dev:preview
pnpm dev:server
pnpm dev:worker
pnpm typecheck
pnpm build
pnpm build:server
pnpm build:worker:console
```

### 基础设施

```bash
pnpm dev:infra:up
pnpm dev:infra:down
pnpm dev:infra:logs
pnpm db:reset
pnpm db:reset:all
```

### Hybrid 开发

```bash
cp .env.development.hybrid.example .env
pnpm dev:hybrid
pnpm dev:hybrid:up
pnpm dev:worker:hybrid
pnpm dev:hybrid:logs
pnpm dev:hybrid:down
```

### 默认地址

- 常规前端开发：`http://localhost:3000` 或 Vite 当前输出地址
- 本地 server：`http://127.0.0.1:8989`
- worker console：`http://127.0.0.1:48121`
- hybrid web：`http://app.vibemux.localtest.me:15173`
- hybrid server：`http://127.0.0.1:18989`

## 导入与依赖规则

### 导入顺序

```typescript
// 1. Node 内置
import path from 'node:path'

// 2. React / 第三方库
import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

// 3. 跨端共享别名
import { buildWorkspaceRouteSearch } from '@shared/task-workspace'
import type { Task } from '@shared/types'

// 4. 应用内别名
import { Button } from '@/components/ui/button'

// 5. 相对路径模块
import { useWorkspaceLaunch } from './-use-workspace-launch'
```

### 别名约定

- `@shared/*` 指向 `packages/shared/src/*`
- `@/*` 与 `@web/*` 指向 `apps/web/src/*`
- `@server/*` 指向 `apps/server/src/*`
- 能用别名表达清楚边界时，优先别名，不要写超长 `../../../`

## 代码规范

### TypeScript

- 保持 `strict` 思维，避免 `any`
- 优先复用 `packages/shared/src` 中已有类型
- 新增跨端字段时，先改 shared，再改 web/server/worker
- `import type` 能分离时就分离

### React / Web

- 路由页面放 `apps/web/src/routes`
- 页面专属复杂逻辑可拆到 `routes/-xxx-*` 或 `components/xxx/*`
- 尽量避免把巨量业务逻辑都堆在一个 route 文件里
- **写 UI/UX 时必须遵循 `docs/LINEAR-STYLE-UI-GUIDE.md`**：扁平布局、react-resizable-panels 双栏、紧凑控件、统一色板、禁止 Card 嵌套
- 改动 workspace 页面时，留意 `taskId`、`workspaceId`、`workspaceSessionId` 三者不是一回事
- 改动 chat 页面时，留意主聊天 session 与 workspace chat 不是一回事

### Server

- 路由层负责协议、参数校验、响应码
- 业务逻辑优先下沉到 `services/`、`repositories/`、`integrations/`
- 需要跨路由复用的逻辑，不要复制到多个 route 文件里
- 任何新协议字段都要考虑 WebSocket / HTTP / 存储兼容

### Postgres 与 Drizzle

- **唯一 DDL 路径**：改 `apps/server/src/storage/postgres/schema.ts` 或 `schema-core.ts` → `pnpm db:generate` → 提交 `drizzle/000x_*.sql`
- **禁止**再新增/恢复启动时手写 `schemaStatements` / `migrationStatements` 建表路径（已删除）
- 业务读写：`getDrizzleDb()` / `withDrizzleTransaction()`；复杂 SQL 可用 `sql\`...\``，不要为了“纯 Drizzle”把清晰 SQL 写绕
- 启动：`ensurePostgresReady()` 会 `migrate()`；已有老库（有 `users` 表、journal 为空）会 **自动 baseline**
- 部署后通常 **不必** 手工 `db:migrate`（server 启动会跑）；改表的 PR 必须带上 migration 文件
- 参考：`docs/DRIZZLE-ADOPTION.md`、`docs/wiki/09-database-conventions.md`、`README.md`「Postgres 与 Drizzle」

### Worker

- 执行链路改动优先保持“仓库准备 -> worktree/original dir -> agent 执行 -> 产物回传”这条主路径清晰
- 不要在 worker 内偷偷引入 server 侧 UI 假设
- 涉及 CLI、终端、Git、SSH、MCP、runtime bootstrap 的改动，先检查是否影响本地与 preview 两种连接模式

### Shared

- 共享层必须保持纯净，避免耦合浏览器 API 或 Node 特有副作用
- 共享函数优先纯函数化，便于 `node:test` 覆盖

## 数据与状态边界

- `project`、`task`、`workspace`、`workspaceSession`、`distributedTask` 是不同层级，不要混成一个概念
- `workspaceSessionId` 不等于 `taskId`
- `runtimeSessionId` 不等于页面 session id
- `main chat session`、`workspace session`、`external thread` 需要分开命名和存储
- 改状态同步逻辑时，先确认数据源来自 `web state`、`server API`、`worker runtime` 还是 `shared helper`
- GitHub PR、Issue、Workflow Run 的远端事实分别以 `project_pull_requests`、`project_issues`、`project_workflow_runs` 为权威；与任务、工作区、工作区会话的关系以 `github_resource_bindings` 为权威
- 同一 GitHub 资源可被多个 Project 使用，项目归属以 `github_project_resources` 为权威；同步只能新增或刷新项目关联，禁止覆盖其他 Project 的资源归属
- `Task.result.delivery` 与 `Workspace.deliverySummary` 只表示执行时快照，禁止作为实时 GitHub 状态或资源关联的权威来源
- 分支匹配只能创建 `suggested` 关联；Agent 交付、人工选择和创建 PR 可创建 `confirmed` 关联；后续启发式同步不得覆盖人工确认或拒绝
- GitHub 资源模型与评论扩展约束见 `docs/GITHUB-RESOURCE-MODEL.md`

## 测试与验证

### 最低要求

- `pnpm typecheck` 必须通过

### 适合当前仓库的验证方式

```bash
pnpm typecheck
pnpm exec tsx --test apps/server/src/routes/project-main-chat-session.test.ts
pnpm exec tsx --test packages/shared/src/task-workspace.test.ts
```

### 验证策略

- 改 shared 纯函数：优先补 `node:test` / `tsx --test`
- 改 server 规则与编排：优先补 route/service 单测
- 改 web 路由与关键交互：至少手测对应页面
- 改 chat/workspace/workspaces 页面时，最好至少验证一次 URL、选择态、加载态、空态没有串页

## Open Core 边界

公开核心只提供稳定的 gate、registry 和路由壳；可选扩展在独立工作区实现并在构建时装配。
核心代码不得直接依赖扩展实现，公开构建必须在没有扩展挂载时仍可运行。提交前运行
`node scripts/open-core/public-boundary.mjs --staged`，不要把内部方案、运营数据或凭据写入公开历史。

## Git 与发布规则

- `dev` 是日常开发分支，功能和修复应先进入 `dev`
- `preview` 只能从 `dev` 同步，禁止直接在 `preview` 上开发
- `master` 只能通过 Pull Request 合并
- 同步分支前优先查看：

```bash
git log --oneline --decorate --graph --all -n 30
```

- 如果误把提交做到了 `preview`，先同步回 `dev`，确认无误后再继续发布链路

### 提交信息

```text
feat: 新增工作区会话回收提示
fix: 修复 chat 与 workspace session 混用
refactor: 拆分 workspace route 数据装配逻辑
docs: 更新 AGENTS.md
```

### 多 Agent 并发与 Git 破坏性操作纪律

> 本仓库的同一个 worktree 可能同时有多个 agent 会话在工作。任何"还原/丢弃"类操作扫掉的不只是你自己的改动，还有别人的。

- **禁止随意还原**：`git restore` / `git checkout -- <file>` / `git reset --hard` / `git clean` 等会丢弃工作区改动的命令，默认禁止；除非能证明目标文件是自己本轮创建且刚验证过的临时产物，且执行前先跑 `git status` 确认没有他人未提交改动
- 清理自己刚创建的临时提交用 `git reset --soft HEAD~1`（保留工作区），不要用 `--hard`
- 改动尽早 commit（小步提交）：未 add 过的内容在任何并发事故中都无法从 git 恢复
- 长任务 / 大改动放 feature 分支上做，避免与他人未提交改动互相踩踏
- 发现工作区有陌生改动（staged 文件、陌生 untracked 文件）时：不碰、不清理、不当垃圾处理——那可能是并行会话的工作现场
- 若发现疑似被误扫：先 `git fsck --dangling` 尝试找回（add 过的内容可恢复），再如实上报

## 安全红线

1. 禁止使用 `shell: true` 执行用户输入
2. 禁止 SQL 字符串拼接，必须参数化；表结构变更走 Drizzle migration，禁止绕过 schema 手写启动 DDL
3. 禁止路径遍历，所有文件路径都要校验作用域
4. 禁止在前端泄露密钥、token、内部调试凭证
5. 禁止让 web 直接假设本地文件系统可用
6. 禁止在未确认作用域时混改 chat 与 workspace 会话逻辑
7. 禁止把 Drizzle schema / DB 客户端 import 进 `apps/web`、`apps/worker`、`packages/shared`
8. 禁止在共享 worktree 中执行批量丢弃工作区的 git 操作（`git restore` / `git reset --hard` / `git clean`），除非得到明确授权并确认目标范围

## AI Agent 工作清单

### 计划与待做管理

面向社区的计划、设计和决策应写成经过审核的公开文档或 GitHub Discussion。
内部计划、运营记录、发布清单和未完成方案不得加入公开仓库。

### 统一上下文协议：分形文档 × CodeGraph × Ponytail

三者按固定顺序协作，不是三套并列流程：

1. **分形文档定边界**：先读根 L1、目标目录最近的 L2，再检查目标业务文件的 L3。
2. **CodeGraph 证结构**：定位定义、调用链、依赖方向和影响面；字面量、日志、注释才用 `rg`。
3. **Ponytail 控方案**：理解真实链路后，从“不做、复用现有、标准库/原生能力、已有依赖、最小新增”依次选择第一个可靠方案。
4. **实现并验证**：修共享根因，保留最小必要 diff；非平凡逻辑至少留下一个能失败的聚焦检查。
5. **文档反向回环**：完成后按 `L3 -> L2 -> L1` 回查，只更新真实变化的层级。

文档层级：

- **L1**：根目录 `AGENTS.md`，记录项目架构、顶级模块、全局不变量、工作与验证规则。仅在跨模块或项目级事实变化时更新。
- **L2**：稳定模块目录中的 `AGENTS.md`，记录职责边界、主要成员、对外接口和依赖方向。仅在模块结构或契约变化时更新。当前 L2：`packages/shared/AGENTS.md`、`apps/server/AGENTS.md`、`apps/worker/AGENTS.md`、`apps/web/AGENTS.md`。
- **L3**：重要业务文件头部的 `INPUT / OUTPUT / POS` 契约，记录依赖能力、对外输出和模块定位。仅在文件职责、关键依赖或导出契约变化时更新。

新增或更新 L2/L3 时包含：

```text
[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
```

采用渐进补齐：禁止为了覆盖率批量制造 L2/L3。触及的重要业务文件缺少 L3 时补齐；稳定模块发生结构性变化且缺少 L2 时补齐。生成文件、迁移快照、测试夹具、纯配置和简单 barrel 默认不加 L3。删除或重命名文件后清理对应 L2 成员记录。

CodeGraph 查询返回的是代码结构事实，分形文档表达的是职责与约束。二者冲突时先确认代码是否偏离设计：修代码或修文档，但不得让冲突继续存在。Ponytail 只约束方案规模，不能省略安全、校验、数据完整性、可访问性或明确需求。

文档事实以源码和公开文档为准；发现文档与代码不符时，优先修正公开文档并在变更中说明原因。

### 开始改代码前

- 先确认需求属于 `web`、`server`、`worker`、`shared` 哪一层
- 先确认需求属于 `/chat`、`/workspace`、`/workspaces` 哪个页面
- 先确认变更是否会影响现有协议、已有 session、旧数据

### 改代码时

- 优先沿着现有模块边界改，不要横向打穿三层
- 改 shared 契约时，同步检查消费方
- 改会话逻辑时，名称里写清楚作用域
- 发现“只是因为名字太泛才改错地方”的情况，顺手把命名修正掉

### 收尾时

- 运行最小必要验证
- 明确说明改的是哪个页面、哪个会话模型、哪个层
- 若未跑测试，要明确写出没跑什么

## Code Review 检查清单

- [ ] 修改目标页面是否明确，未混淆 `/chat`、`/workspace`、`/workspaces`
- [ ] 没有把 worker 执行职责塞回 server 或 web
- [ ] 没有新增 `any` 或重复类型
- [ ] shared 契约变更已同步到消费方
- [ ] 错误有明确返回，不静默吞错
- [ ] 新增代码没有继续恶化超长函数/超大文件
- [ ] 若改了表结构：已更新 Drizzle schema 并提交 `drizzle/` migration，未再写启动手写 SQL
- [ ] `pnpm typecheck` 已通过

---

> “如果一个概念在 UI、路由、存储、执行链路里其实不是同一个东西，那名字就不该一样。”
