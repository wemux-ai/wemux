# Wemux

> **AI Native organization OS.**
>
> **Agent 与人类共同协作的平台** — AI agent orchestration with real isolated worker execution.
>
> **English**: [README.md](README.md) | **中文**: README.zh-CN.md

**中文简介**：Wemux 是一个以 worker 为唯一代码执行入口的 AI 编排平台。主聊天/任务/工作区把需求派发给本地 worker，在隔离 worktree 中执行代码任务并交付可验证的结果。

Wemux 是开源的 Agent 协作平台：它编排的 AI Agent 在 **worker 机器**（你的机器、你的凭据）上的隔离 Git worktree 中执行真实编码工作，全程可追溯——而不是在云端黑盒里运行。

**开源** — Apache-2.0 许可（见 [LICENSE](LICENSE)），完全可自托管，社区驱动。在 [GitHub](https://github.com/wemux-ai/wemux) 上给我们点 Star，提 [issue](https://github.com/wemux-ai/wemux/issues)，或参与讨论。欢迎贡献——见 [CONTRIBUTING.md](CONTRIBUTING.md)。

> **注意** — 本仓库包含 Wemux 的开源社区版。部分平台能力——托管模型网关、按用量计费、托管云节点池与合作商系统——作为独立商业服务运营，**不包含在本仓库中**。**自托管云节点是开源的**（自带 Docker/BoxLite 宿主即可，见 [SELF-HOSTING.md § 七](docs/SELF-HOSTING.md)）。本仓库所有内容在 Apache-2.0 下免费使用。完整对照见 [开源 vs 商业托管](#开源-vs-商业托管)。

## 目录

- [核心特性](#核心特性)
- [开源 vs 商业托管](#开源-vs-商业托管)
- [工作原理](#工作原理)
- [架构](#架构)
- [快速开始（自托管）](#快速开始自托管)
- [Railway 一键部署](#railway-一键部署)
- [模型配置（BYOK）](#模型配置byok)
- [开发](#开发)
- [常见问题](#常见问题)
- [遥测（匿名，可关闭）](#遥测匿名可关闭)
- [社区与资源](#社区与资源)
- [贡献](#贡献)
- [安全](#安全)
- [许可](#许可)

## 核心特性

- **Worker 优先执行** — 代码任务在 worker daemon 的隔离 worktree/分支中运行；控制面永不执行你的代码。
- **主聊天编排** — 主 Agent 理解需求、路由到 worker、挑选 Agent、派发、验证并请求人工确认。
- **工作区与任务** — 看板任务管理、自然语言创建任务、支持实时协作的工作区会话、与 Agent 的群聊。
- **Drive 云盘** — 工作区级文件存储与分享。
- **渠道集成** — 飞书、Slack、钉钉、企业微信、微信、WhatsApp 入站渠道。
- **多节点组网** — 连接多个 worker，用 easytier 分组，按能力路由。
- **BYOK 模型配置** — Agent 通过 worker 上的 OpenCode/Claude Code/Codex 运行时使用你自己的模型密钥。
- **原生客户端** — Electron 桌面端与 React Native/Expo 移动端（Android/iOS）应用。

## 开源 vs 商业托管

本仓库是**可自托管的社区版**：左列能力全部包含在本仓库中，Apache-2.0 下免费使用、可自由修改。右列能力作为独立商业托管服务运营，**不包含在本仓库中**——在代码里它们只是中性的空实现 stub（从不拦截、从不收费、不会以任何方式限制社区版）。

| 能力 | 开源（本仓库） | 仅商业托管 |
|---|---|---|
| 核心平台——Web 控制台 / 控制面 / worker daemon | ✅ | — |
| Worker 执行（配对 / worktree / agent runtime） | ✅ | — |
| BYOK 模型配置 | ✅ | — |
| 主聊天 / 任务 / 工作区编排与群聊 | ✅ | — |
| Drive（工作区文件存储与分享） | ✅ | — |
| 渠道集成（飞书 / Slack / 钉钉 / 企微 / 微信 / WhatsApp） | ✅ | — |
| 多节点组网（easytier） | ✅ | — |
| 用量看板与用户自设 token 配额 | ✅ | 平台强制配额 |
| Admin 控制台（用户 / 反馈 / 运营） | ✅ | 计费 / 积分 / 网关 / 云节点 / 合作商面板 |
| 原生客户端（Electron 桌面 + React Native Android/iOS） | ✅ | — |
| 托管模型网关（官方模型目录） | — | ✅ |
| 云节点（托管沙箱 worker 池） | **自托管运行时已包含**（docker-cli / boxlite / ascii-box / CF sandbox） | 托管池 |
| 订阅 / 按量计费、积分与支付 | — | ✅ |
| 合作商系统 | — | ✅ |

社区版以**本地 worker + BYOK** 为完整自洽的执行核心，上述边界不影响任何核心编排 / 执行 / 协作功能。另见 [SELF-HOSTING.md §七 社区版能力边界](docs/SELF-HOSTING.md)。

## 工作原理

Wemux 让人类始终在环，Agent 负责重活：

1. **描述** — 在主聊天、工作区看板甚至入站 IM 渠道（飞书 / Slack / …）里用自然语言创建任务。
2. **规划** — 主 Agent 把你的话转成结构化任务，挑选 Agent 与工作区，并路由到可用的 worker。
3. **执行** — worker 在你机器上准备隔离 Git worktree，Agent 运行时（OpenCode / Claude Code / Codex）用你的凭据干活——你的代码永不离开你的机器。
4. **审核** — worker 回报 diff 与结果；合入前由你审阅确认。
5. **交付** — 确认后的变更交付，每一步在工作区会话中全程可追溯。

## 架构

```text
┌─────────────┐   ┌──────────────┐   ┌─────────────────────┐
│  web        │──▶│  server      │──▶│  worker (daemon)    │
│  console    │   │  control     │   │  ├─ repo prepare    │
│  (React)    │   │  plane       │   │  ├─ worktree        │
│             │   │  (Hono)      │   │  ├─ agent runtime   │
└─────────────┘   │  Postgres    │   │  └─ git delivery    │
                  │  S3/R2       │   └─────────────────────┘
                  └──────────────┘
```

- `apps/web` — React + Vite + TanStack Start 控制台
- `apps/server` — Hono 控制面：调度、聊天编排、鉴权、工作区/任务管理
- `apps/worker` — 本地执行器 daemon：配对、仓库准备、隔离 worktree、Agent 运行时（OpenCode/Claude Code/Codex）、结果交付
- `apps/desktop` — Electron 桌面客户端
- `apps/mobile` — React Native + Expo 移动客户端（Android/iOS）
- `packages/shared` — 跨端类型、契约与纯函数工具

存储：PostgreSQL（Drizzle 迁移）+ S3 兼容对象存储（R2/MinIO）。

## 快速开始（自托管）

环境要求：Node.js 20+、pnpm 10+、Docker（Postgres 用）。

```bash
git clone https://github.com/wemux-ai/wemux.git
cd wemux
pnpm install

# 1. 启动基础设施（Postgres + 对象存储）
pnpm dev:infra:up

# 2. 配置环境变量
cp .env.development.local.example .env.development.local
#   按需修改 DATABASE_URL / OBJECT_STORAGE_*

# 3. 启动控制面 + 控制台
pnpm dev:server    # API 在 :8989
pnpm dev:client    # web 控制台

# 4. 启动 worker（同机或任意机器）
pnpm dev:worker
#   将 worker 与控制面配对，然后创建任务
```

想一条命令搞定？`pnpm dev` 会在 TUI 里同时启动 server、console 与 worker。

worker 不需要与控制面运行在同一台机器。打开控制面的 **执行中心 → 新增节点**，选择目标系统并复制生成的安装命令。macOS/Linux 命令形如：

```bash
curl -fsSL https://<server>/install | bash -s -- \
  --pairing-code '<PAIRING_CODE>' \
  --server-url 'https://<server>'
```

该命令会完成安装、配对、注册服务和启动；同一弹窗也会提供 Windows/WSL 与 Docker 命令。

生产级部署见 [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)、`deploy/` 与 Dockerfile（`deploy/docker/Dockerfile.control-plane`、`deploy/docker/Dockerfile.managed-worker`）。一键生产栈可用 `deploy/docker/docker-compose.production.yml` + `.env.production.example`。

## Railway 一键部署

无需管理 VPS 即可部署自己的实例。仓库根目录已包含 `railway.json`，Railway 使用 RAILPACK 执行：

```text
pnpm build:client && pnpm build:server && pnpm build:worker:preview-installer
NODE_ENV=production node dist-server/apps/server/src/control-plane-entry.js
```

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy/wemux-community)

Railway 模板会尝试预置控制面、Postgres 与对象存储 Bucket。如果通过 **New Project → Deploy from GitHub repo** 直接部署，`railway.json` 只负责构建、启动和健康检查，不会自动创建数据库或对象存储服务，需要自行添加 Railway Postgres 和 S3 兼容对象存储。

部署前在控制面服务中设置以下变量：

| 变量 | 必填值 / 默认值 |
|---|---|
| `DATABASE_URL` | **必填。** 引用 Railway Postgres，例如 `${{Postgres.DATABASE_URL}}`（按实际服务名调整 `Postgres`）。也支持 `POSTGRES_URL`。 |
| `OBJECT_STORAGE_ENDPOINT` | **上传功能必填。** Railway Bucket、Cloudflare R2 或其他 S3 兼容服务的 HTTPS endpoint。 |
| `OBJECT_STORAGE_BUCKET` | **上传功能必填。** 已创建的 bucket 名称。 |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | **上传功能必填。** 对象存储 Access Key。 |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | **上传功能必填。** 对象存储 Secret Key。 |
| `OBJECT_STORAGE_REGION` | 可选，默认 `auto`。 |
| `BETTER_AUTH_SECRET` | **生产必填。** 使用 `openssl rand -hex 32` 生成。 |
| `TOKEN_SECRET` | **生产必填。** 单独使用 `openssl rand -hex 32` 生成。 |
| `SECRET_ENCRYPTION_KEY` | **必填。** 32 字节十六进制密钥，单独使用 `openssl rand -hex 32` 生成。 |
| `WEMUX_PUBLIC_BASE_URL` | 设置为最终公开 origin，例如 `https://your-app.up.railway.app`。 |
| `BETTER_AUTH_URL` | 设置为相同公开 origin，确保登录和 OAuth 回调可靠。 |
| `HOST` | 可选，默认 `0.0.0.0`。 |
| `PORT` | 不要固定；Railway 会注入 `PORT`，应用回退值为 `8989`。 |
| `NODE_ENV` | `railway.json` 已在启动命令中设为 `production`。 |

部署后在 **Settings → Networking** 生成 Railway 域名，把两个公开 URL 变量更新为该 HTTPS origin 并重新部署。访问 `https://<domain>/api/ready` 验证后，进入 `/execution`，点击**新增节点**，在 worker 机器执行页面生成的安装命令。

完整配置、自定义域名、worker 配对与升级说明：见 [SELF-HOSTING.md → Railway](docs/SELF-HOSTING.md)。

## 模型配置（BYOK）

模型密钥在 **worker 侧**配置——你的密钥永远不会离开你的机器。在 worker 上配置运行时（OpenCode/Claude Code/Codex），然后在控制台的模型中心选择模型。Wemux 不内置任何 API 密钥。

> **运行时许可** — Wemux 平台是 Apache-2.0，但它编排的 Agent CLI 各自持有许可：[OpenCode](https://github.com/sst/opencode) 是 Apache-2.0；Claude Code 与 Codex 分别是 Anthropic 与 OpenAI 的专有工具——你用自己账户认证并遵守其条款。

## 开发

```bash
pnpm install
pnpm typecheck                  # web + server 严格 TS 检查
pnpm dev                        # 一体开发：server + console + worker（TUI）
pnpm build                      # 生产构建（client + server）

# 聚焦测试
pnpm exec tsx --test packages/shared/src/task-workspace.test.ts
```

数据库表结构变更走 Drizzle：改 schema 后运行 `pnpm db:generate` 并提交生成的 migration。部署细节见 [SELF-HOSTING.md](docs/SELF-HOSTING.md)，贡献指南见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 常见问题

**我的代码会离开我的机器吗？**
不会。任务在你的 worker 上、隔离的 Git worktree 中执行；只有 diff、日志与产物回传给控制面。Agent 运行时用你机器上的凭据运行，BYOK 模型密钥永不离开 worker。控制面从不执行你的代码。

**需要高配机器或 GPU 吗？**
不需要。worker 只是在本地跑 Agent CLI——模型推理发生在你的模型服务商（Anthropic、OpenAI、OpenRouter、本地模型…）。任何笔记本或服务器都能当 worker。

**支持哪些 Agent 运行时与模型？**
Wemux 编排 OpenCode、Claude Code 与 Codex 运行时，支持运行时支持的任何模型——自带密钥（BYOK）。

**必须自托管吗？**
不是。同一产品也以托管服务形式提供（wemux.ai），含托管云节点与计费。本仓库是可自托管的社区版。

**真的免费吗？**
是的。本仓库所有内容都是 Apache-2.0，包括自托管云节点运行时。只有独立运营的托管服务——模型网关、托管云节点池、计费、合作商系统——是商业的，而且都不在本仓库中。

**Wemux 与云端 Agent 平台有什么不同？**
Worker 优先执行：代码跑在你控制的机器上、隔离 worktree 中，合入前有人工审阅 diff 环节；外加多节点组网、IM 渠道集成与工作区级协作——全部可自托管。

## 遥测（匿名，可关闭）

自托管实例每天上报一次**匿名聚合用量**，帮助我们了解社区版的使用情况：版本、操作系统、五个累计计数器（用户 / 组织 / 任务 / 会话 / Agent 启动数）。

- ❌ 绝不收集：仓库名、任务标题、会话内容、用户名、邮箱、IP、代码——任何内容或身份数据。
- ✅ 完整 payload 结构已文档化且可审计：[docs/TELEMETRY.md](docs/TELEMETRY.md)（字段白名单在源码 `packages/shared/src/types/community-usage.ts`）。

用一个环境变量即可关闭：

```bash
WEMUX_USAGE_REPORTING_DISABLED=1
```

上报是尽力而为的，从不阻塞任何功能——关闭不影响任何特性。

## 社区与资源

- [GitHub Issues](https://github.com/wemux-ai/wemux/issues) — 可复现缺陷与范围明确的工程任务
- [GitHub Discussions](https://github.com/wemux-ai/wemux/discussions) — 使用问题、想法、使用案例与路线图讨论
- [社区治理](docs/COMMUNITY-GOVERNANCE.md) — 入口分流、Issue 标准与维护流程
- [路线图](ROADMAP.md) — 后续计划
- [SELF-HOSTING.md](docs/SELF-HOSTING.md) — 生产部署指南
- [更新日志](CHANGELOG.md) — 发布历史

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。外部贡献走标准 fork → PR 流程。请先阅读贡献指南——部分兼容性 stub 由维护者负责，可能不接受直接修改。

## 安全

发现漏洞？见 [SECURITY.md](SECURITY.md)——请私下报告，不要开公开 issue。

## 许可

[Apache-2.0](LICENSE)。文档与营销素材另行授权（见 NOTICE）。"wemux" 名称与 wemux.ai 域名是商标，不随开源许可授予。
