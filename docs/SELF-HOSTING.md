# Wemux 自托管部署指南（Self-Hosting）

> 覆盖：生产部署（docker compose）、worker 安装与配对、模型配置、常见问题。

## 架构

```text
┌──────────────────────────────────────┐
│ 一台服务器（或任意可跑 Docker 的机器）   │
│  ├─ control-plane（web + server 一体） │
│  ├─ Postgres 16                       │
│  └─ MinIO（S3 兼容对象存储）           │
└──────────────┬───────────────────────┘
               │ WEMUX_NODE_URL / 配对码
┌──────────────▼───────────────────────┐
│ worker（你的电脑/任意机器，可多台）      │
│  ├─ 仓库准备 + 隔离 worktree           │
│  ├─ OpenCode / Claude Code / Codex    │
│  └─ 你的模型密钥（不出机器）            │
└──────────────────────────────────────┘
```

## 一、部署控制面

### 方式 A：Railway 一键部署（最快，无需 Docker/VPS）

适合不想维护 VPS 的用户。正式模板入口：

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy/wemux-community)

#### 1. 创建服务

- **从模板部署**：模板会尝试创建 control-plane、Postgres 与对象存储 Bucket，并预置变量引用；仍需逐项确认引用和值有效。
- **直接从 GitHub 部署**：在 Railway 选择 **New Project → Deploy from GitHub repo → `wemux-ai/wemux`**。仓库的 `railway.json` 只定义应用构建、启动和健康检查，不会创建 Postgres 或对象存储；需要在项目内自行添加 Railway Postgres，并连接 Railway Bucket、Cloudflare R2 或其他 S3 兼容服务。

`railway.json` 使用 RAILPACK，无需 Dockerfile，实际执行：

```text
build: pnpm build:client && pnpm build:server && pnpm build:worker:preview-installer
start: NODE_ENV=production node dist-server/apps/server/src/control-plane-entry.js
healthcheck: /api/ready
```

#### 2. 设置变量

在 control-plane 服务的 **Settings → Variables** 配置：

| 变量 | 是否必填 | 值与默认值 |
|---|---|---|
| `DATABASE_URL` | 必填 | Railway Postgres 的连接串。推荐用变量引用 `${{Postgres.DATABASE_URL}}`；若服务名不是 `Postgres`，按实际名称修改。应用也接受 `POSTGRES_URL`。 |
| `OBJECT_STORAGE_ENDPOINT` | 上传功能必填 | Railway Bucket、Cloudflare R2 或其他 S3 兼容服务的 HTTPS endpoint。 |
| `OBJECT_STORAGE_BUCKET` | 上传功能必填 | 已存在的 bucket 名称。 |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | 上传功能必填 | 对象存储 Access Key。 |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | 上传功能必填 | 对象存储 Secret Key。 |
| `OBJECT_STORAGE_REGION` | 可选 | 默认 `auto`；服务商明确要求其他 region 时按其文档填写。 |
| `BETTER_AUTH_SECRET` | 生产必填 | 运行 `openssl rand -hex 32` 生成。 |
| `TOKEN_SECRET` | 生产必填 | 另运行一次 `openssl rand -hex 32` 生成，不要与其他 secret 共用。 |
| `SECRET_ENCRYPTION_KEY` | 必填 | 32 字节十六进制密钥；另运行一次 `openssl rand -hex 32` 生成。 |
| `WEMUX_PUBLIC_BASE_URL` | 推荐必填 | 最终公开 origin，例如 `https://wemux-production.up.railway.app`，不要带末尾 `/`。 |
| `BETTER_AUTH_URL` | 推荐必填 | 与 `WEMUX_PUBLIC_BASE_URL` 相同，用于登录/OAuth 回调。 |
| `HOST` | 可选 | 默认 `0.0.0.0`。 |
| `PORT` | 不要设置 | Railway 自动注入；应用在非 Railway 环境的回退值为 `8989`。 |
| `NODE_ENV` | 不要设置 | `railway.json` 的 start command 已设为 `production`。 |

三个 secret 必须分别生成，并在后续升级中保持不变，否则现有登录会话、签名 token 或已加密凭据会失效。

对象存储用于头像、图片和 Drive。使用 Railway 模板时，打开 Bucket 的 Credentials 页面，把其 endpoint、bucket、access key 和 secret key 引用到 control-plane；使用 R2 时先创建 bucket 和 API Token，再填入同名变量。对象存储变量不完整时相关上传功能会失败。

#### 3. 配置域名并验证

1. 打开 control-plane 服务的 **Settings → Networking**，点击 **Generate Domain** 获取 `*.up.railway.app` HTTPS 域名。
2. 把 `WEMUX_PUBLIC_BASE_URL` 和 `BETTER_AUTH_URL` 都设为该完整 origin，然后 Redeploy。
3. 验证 readiness：

   ```bash
   curl -fsS https://<railway-domain>/api/ready
   ```

   正常时返回 HTTP 200，JSON 中有 `"ok": true`。`/api/ready` 检查 Postgres 与存储变更监听器，适合作为 Railway healthcheck；`/api/health` 提供更详细的运行信息，适合排障。

绑定自定义域名时，在 **Settings → Networking → Custom Domain** 输入域名，并按 Railway 提示在 DNS 服务商添加 CNAME/记录。证书就绪后，将两个公开 URL 变量更新为新的 `https://...` origin 并 Redeploy；再用新域名检查 `/api/ready`，并重新登录。

#### 4. 安装并配对 worker

1. 打开 Railway 域名并注册/登录。
2. 进入 `https://<railway-domain>/execution`，点击**新增节点**，选择本机、Docker 等运行方式与目标系统，然后点击**生成连接命令**。
3. 在要运行 worker 的机器上复制并执行页面给出的完整命令。macOS/Linux 命令形如：

   ```bash
   curl -fsSL https://<railway-domain>/install | bash -s -- \
     --pairing-code '<PAIRING_CODE>' \
     --server-url 'https://<railway-domain>'
   ```

   安装器会下载当前部署构建的 worker，完成配对、注册用户服务并启动。Windows/WSL 与 Docker 请直接使用弹窗针对所选目标生成的命令，避免手工改写参数。
4. 回到执行中心，确认节点状态为在线；失败时重新生成配对码（配对码会过期）并检查 worker 到 Railway 域名的 HTTPS/WebSocket 连通性。

#### 5. 升级

1. 升级前备份 Railway Postgres 和对象存储数据。
2. 将新版本推到已连接的 GitHub 分支，或在 Railway Deployments 中执行 **Deploy latest / Redeploy**。
3. Railway 会重新执行 `railway.json` 的 build command 并启动新版本；server 启动时自动执行尚未应用的 Drizzle migrations，无需手工运行 `pnpm db:migrate`。
4. 检查 Deploy logs，然后确认 `https://<domain>/api/ready` 返回 HTTP 200 与 `"ok": true`。

保留现有数据库、对象存储和三个 secret，即可让新部署继续使用已有数据与会话。

### 方式 B：Docker Compose 生产栈（自管服务器）

前置：Docker + Docker Compose、域名（可选，也可直接用 IP）。

```bash
git clone https://github.com/wemux-ai/wemux.git
cd wemux

cp .env.production.example .env.production
# 编辑 .env.production：
#   - 设置强密码（POSTGRES_PASSWORD / OBJECT_STORAGE_SECRET_ACCESS_KEY）
#   - openssl rand -hex 32 生成三个 secret
#   - WEMUX_PUBLIC_BASE_URL 填你的域名或 IP

docker compose -f deploy/docker/docker-compose.production.yml --env-file .env.production up -d --build
```

首次启动自动：建库 → 跑 Drizzle 迁移 → 起 MinIO 并建桶 → 起控制面。
验证：`curl http://localhost:8989/api/health` 应返回 `{"ok":true,...}`。

> HTTPS：建议在控制面前放 Caddy / Nginx / Cloudflare Tunnel 做 TLS 终止，
> 并把 `WEMUX_PUBLIC_BASE_URL` 设为 https 地址。

## 二、安装并配对 worker

worker 是代码执行的唯一入口，运行在你的机器上（不要求与服务器同机）。

**macOS / Linux**：
```bash
# 推荐从“执行中心 → 新增节点”复制完整命令；以下为命令格式
curl -fsSL https://<server>/install | bash -s -- \
  --pairing-code '<PAIRING_CODE>' \
  --server-url 'https://<server>'
# 或本地开发模式：
pnpm install && pnpm dev:worker
```

**Windows/WSL、Docker**：从“执行中心 → 新增节点”选择目标后，执行页面生成的完整安装命令。

配对：
1. 打开控制面 Web（`http://<server>:8989`），注册账号
2. 执行中心 → 新增节点，生成连接命令
3. 在 worker 终端执行完整命令；安装器会自动安装、配对并启动服务
4. 控制面「执行中心」出现该节点（在线）

多台机器可重复此步骤组建节点集群；多节点组网可用 easytier（worker 内置支持）。

## 登录与账号（社区版默认行为）

- **邮箱注册**：默认**无需邮箱验证**——未配置邮件发送服务时注册即成功，可直接登录。
  只有配置了邮件发送（`EMAIL_PROVIDER=cloudflare` + `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`）后，
  注册才会发送验证邮件并要求验证。
- **Google 登录**：默认不可用——未配置 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 时，登录页 Google 按钮置灰；配置后自动点亮。
- **忘记密码**：同样依赖邮件服务；未配置时无法自助重置，请联系管理员处理。
- 登录页为单页布局：邮箱登录/注册在上，Google 登录在下（可用时）。

## 匿名使用上报（可关闭）

自托管实例默认开启匿名使用上报：每天一次向 wemux.ai 发送聚合计数（版本 / OS / 用户·组织·任务·会话·Agent 启动的累计数），
**不包含任何内容类数据与身份信息**。设 `WEMUX_USAGE_REPORTING_DISABLED=1` 即可关闭；完整字段清单见 [docs/TELEMETRY.md](./TELEMETRY.md)。

## 三、模型配置（BYOK）

模型密钥**只在 worker 侧配置**，服务端不接触你的密钥：

1. 在 worker 机器上配置对应运行时：
   - **OpenCode**：`~/.config/opencode/opencode.json` 或 `opencode auth login`
   - **Claude Code**：`claude` CLI 登录（`ANTHROPIC_API_KEY`）
   - **Codex**：`codex` CLI 登录

> **运行时许可边界**：Wemux 平台以 Apache-2.0 开源，但它调度的 agent CLI 各自有独立许可——OpenCode 为 Apache-2.0 开源；Claude Code 与 Codex 分别是 Anthropic / OpenAI 的专有工具，需使用你自己的账号登录并遵守其服务条款。
2. 控制面「模型中心」会从 worker 读取运行时模型列表，选择默认模型即可
3. 任务/聊天执行时自动使用该模型的密钥

没有任何内置 API key；未配置模型时任务会提示先配置。

## 四、频道集成（可选）

飞书 / Slack / 钉钉 / 企业微信 / 微信 / WhatsApp 均需自建应用凭据：
- 控制面「设置 → 频道」按各平台指引创建应用并回填 App ID / Secret
- 各平台的回调地址：`https://<你的域名>/api/channels/<channel>/callback`

## 五、升级

```bash
git pull
docker compose -f deploy/docker/docker-compose.production.yml --env-file .env.production up -d --build
# 迁移在 server 启动时自动执行（Drizzle），无需手工 db:migrate
```

升级前建议备份 Postgres 卷与 MinIO 卷。

## 五·五、AI 运维健康检查

控制面提供两个健康端点：

- `GET /api/health`：基础健康（Postgres/存储/节点/心跳），无需鉴权
- `GET /api/health/detailed`：**完整诊断端点**，为 AI/自动化运维设计，返回结构化信息：
  - `meta`：版本 / 环境 / Node 版本 / 运行时长 / 平台
  - `brand`：wemux / 官网 / edition
  - `database`：Postgres 连接与连接池、存储变更监听延迟
  - `node`：节点 ID / 心跳新鲜度 / 已连接执行器数
  - `resources`：内存占用 / 系统负载
  - `security`：健康 token 是否配置 / dev 登录开关 / Turnstile
  - `checks`：扁平检查项列表（`postgres` / `storage-change-listener` / `node-heartbeat` / `executors` / `fire-and-forget-persistence`），每项 `ok|warning|error` + detail——AI 可直接逐项判断
  - 汇总：`ok` / `degraded` / `warningCount` / `summary`

用法：

```bash
# 未配置 WEMUX_HEALTH_TOKEN 时：直接访问（自托管默认开放）
curl https://your-domain/api/health/detailed

# 配置 WEMUX_HEALTH_TOKEN 后：需带 token
curl -H "x-health-token: $WEMUX_HEALTH_TOKEN" https://your-domain/api/health/detailed
curl "https://your-domain/api/health/detailed?token=$WEMUX_HEALTH_TOKEN"
```

检查失败时返回 503（HTTP 状态可被监控直接告警）。

## 六、常见问题

| 现象 | 处理 |
|---|---|
| `/api/health` 不通 | 看 `docker compose logs server`；常见为 DATABASE_URL 或迁移失败 |
| worker 显示离线 | 检查 worker 与服务器网络（同网/公网可达）；确认 WEMUX_NODE_URL 配置 |
| 任务卡「无执行节点」 | 确认 worker 已配对在线；OpenCode 任务需要 worker 上配置了模型 |
| 上传头像/图片失败 | 确认 MinIO 健康且 `OBJECT_STORAGE_*` 与 compose 内一致 |
| 想换 R2/S3 | 把 compose 的 MinIO 换成任意 S3 兼容服务，改 `OBJECT_STORAGE_ENDPOINT` 等环境变量 |


## 七、社区版能力边界

本仓库是 Wemux 的社区版，包含以下能力：本地 worker 执行、BYOK 模型、主聊天/任务/工作区编排、渠道集成（飞书/Slack/钉钉/企微/微信/WhatsApp）、多节点组网（easytier）、**自托管云节点**（docker-cli / boxlite / ascii-box / cloudflare-sandbox 底座）、桌面与移动客户端、对象存储（S3 兼容，含 Railway Bucket / MinIO / R2）。

以下平台能力**不包含在本仓库中**（作为独立的商业服务运营）：平台托管模型网关与用量计费、订阅计费、合作商系统、官方托管云节点池（wemux.ai 的沙箱 worker）。社区版以**本地 worker + 自托管云节点 + BYOK** 为执行核心，上述边界不影响核心编排/执行/协作功能。

### 自托管云节点（配置后可用，不配置不可用）

社区版支持按需配置自托管执行节点，执行资源由你自己提供：

```bash
# 1. 开启云节点准入（production 默认关闭，显式开启）
WEMUX_MANAGED_CLOUD_ENABLED=1

# 2. 选择底座（任选其一）
WEMUX_MANAGED_CLOUD_RUNTIME_PROVIDER=docker-cli        # 本机/远程 Docker
# WEMUX_MANAGED_CLOUD_RUNTIME_PROVIDER=boxlite-cli     # BoxLite
# WEMUX_MANAGED_CLOUD_RUNTIME_PROVIDER=ascii-box-cli   # ASCII Box
# WEMUX_MANAGED_CLOUD_RUNTIME_PROVIDER=unsafe-local-process  # 本机进程（仅开发）

# 3. 按底座配置（Docker 示例）
WEMUX_MANAGED_CLOUD_DOCKER_HOST=tcp://10.0.0.5:2375    # 远程 Docker 宿主（可选，默认本机）
WEMUX_MANAGED_CLOUD_DOCKER_IMAGE=wemux/worker:latest
WEMUX_MANAGED_CLOUD_DOCKER_CPUS=2
WEMUX_MANAGED_CLOUD_DOCKER_MEMORY=4g
```

配置完成后，控制面「执行中心」会显示云节点面板，任务可派发到云节点执行（worker 在容器内运行，隔离工作区）。不配置 `WEMUX_MANAGED_CLOUD_ENABLED` 时云节点面板显示「不可用」，不影响本地 worker。

> 云节点运行时镜像需包含 wemux worker。不同运行时的具体参数以对应自托管环境文档为准。
