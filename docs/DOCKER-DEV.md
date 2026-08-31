# 全 Docker 开发环境

目标：

- `postgres`、`server`、`web`、`worker` 全部在 Docker 内运行
- 开发者只需要一个命令，所有组件自动启动
- Worker 自动配对，登录测试账号即可看到在线节点

与 [Hybrid 模式](./HYBRID-DEV.md) 的区别：

| | Hybrid (`dev:hybrid`) | Full Docker (`dev:docker`) |
|---|---|---|
| postgres | Docker | Docker |
| server | Docker | Docker |
| web | Docker | Docker |
| worker | **宿主机** | **Docker** |
| 配对方式 | 手动在 Worker Console 粘贴配对码 | 自动配对 |
| 适用场景 | 需要在宿主机操作 Git/仓库/终端 | 纯控制面开发、UI 调试、快速启动 |

## 启动

```bash
cp .env.development.hybrid.example .env
pnpm dev:docker
```

首次启动会：

1. 检查 Docker daemon 是否可用
2. 拉取依赖镜像（`node:22-bookworm-slim`、`postgres:16-alpine`）
3. 启动 postgres → server → web → worker
4. Worker 自动等待 server 就绪，然后调用 `/api/control-plane/executors/auto-pair` 完成配对
5. Worker 连接到 server，节点上线

登录本地开发测试账号（账号由开发登录配置提供），在 `/execution` 页面即可看到已连接的节点。

如果你更喜欢分开启动：

```bash
pnpm dev:docker:up       # 后台启动所有容器
pnpm dev:docker:logs     # 查看日志
pnpm dev:docker:down     # 停止所有容器
```

默认地址：

- Web：`http://app.wemux.localtest.me:15173`
- Server：`http://127.0.0.1:18989`
- Worker Console：`http://127.0.0.1:48121`

## 自动配对机制

Worker 容器启动时会执行 `scripts/docker-worker-auto-pair.sh`：

1. **检查已有凭据**：如果 `/data/wemux-worker/node/config.json` 中已有 `executorId` + `executorToken`，直接启动 daemon（容器重启场景，秒连）
2. **等待 server 就绪**：轮询 `server:18989/api/health`，最长等待 120 秒
3. **调用自动配对**：`POST /api/control-plane/executors/auto-pair`，由 server 创建一个 executor 并返回凭据
4. **保存凭据**：写入 `config.json`
5. **启动 daemon**：`tsx watch apps/worker/src/index.ts daemon`

自动配对端点是 dev-only 的（`NODE_ENV !== 'production'` 时才可用），不需要认证，仅用于本地开发。

## 卷与持久化

| 卷名 | 用途 | 与 hybrid 共享 |
|------|------|---------------|
| `vibemux-hybrid-postgres-data` | Postgres 数据 | ✅ 是，切换模式不丢数据 |
| `vibemux-hybrid-server-runtime` | Server runtime 数据 | ✅ 是 |
| `vibemux-full-server-node-modules` | Server 依赖 | ❌ 独立 |
| `vibemux-full-web-node-modules` | Web 依赖 | ❌ 独立 |
| `vibemux-full-worker-node-modules` | Worker 依赖 | ❌ 独立 |
| `vibemux-full-worker-home` | Worker 配置与凭据 | ❌ 独立 |

Postgres 数据卷与 hybrid 模式共享，所以切换 `dev:hybrid` ↔ `dev:docker` 不会丢失数据库。

node_modules 卷独立维护，避免两种模式的依赖状态互相干扰。

## 设计说明

- `deploy/docker/docker-compose.dev-full.yml` 启动 `postgres`、`server`、`web`、`worker` 四个服务
- Worker 使用 `deploy/docker/Dockerfile.control-plane` 的 `worker-dev-deps` target（在 `deps` 基础上加了 git、ca-certificates、unzip）
- 所有容器通过 Docker 内部网络通信：worker → `server:18989`，server → `worker:48121`，server → `postgres:5432`
- Worker 容器需要 `NET_ADMIN` capability 和 `/dev/net/tun` 设备（EasyTier mesh 网络需要）
- Worker 环境变量 `WEMUX_WORKER_RUN_MODE=docker` 会给 executor 打上 `runtime:docker` 标签
- 源码通过 bind mount 挂载到容器内，`tsx watch` / `vite dev` 保留热更新

## 常见操作

查看所有容器日志：

```bash
pnpm dev:docker:logs
```

只看 worker 日志：

```bash
docker compose -f deploy/docker/docker-compose.dev-full.yml logs -f worker
```

重新构建依赖层（改了 package.json 后）：

```bash
pnpm dev:docker:down
pnpm dev:docker
```

重新配对（清除已有凭据）：

```bash
docker compose -f deploy/docker/docker-compose.dev-full.yml run --rm worker \
  sh -c 'rm -f /data/wemux-worker/node/config.json && echo "cleared"'
pnpm dev:docker
```

如果需要改端口：编辑 `.env` 里的 `HYBRID_WEB_PORT`、`HYBRID_SERVER_PORT`、`WEMUX_WORKER_PORT`。

## 限制

- Worker 在 Docker 内执行 agent（codex/claude）时，Git 操作作用于容器内文件系统，不直接访问宿主机仓库
- 需要宿主机文件系统访问的场景（如本地已有仓库的 worktree 操作），建议使用 hybrid 模式
- 首次启动需要拉取镜像和安装依赖，可能需要几分钟
