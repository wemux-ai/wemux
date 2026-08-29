# Hybrid 开发环境

目标：

- `web` 在 Docker 内跑开发模式
- `server` 在 Docker 内跑开发模式
- `worker` 在宿主机跑开发模式

这样可以同时满足：

- `server` 与本机开发环境隔离
- `web` 保留 Vite HMR
- `server` 保留 `tsx watch` 自动重启
- `worker` 继续访问本机仓库、Git、SSH、终端和 OpenCode

## 启动

```bash
cp .env.development.hybrid.example .env
pnpm dev:hybrid
```

如果 Docker / OrbStack 没启动，或 hybrid 依赖镜像暂时拉不下来，命令会先在本地直接失败；这时不会再把 `worker` 一起拉起来制造额外噪音。

如果你更喜欢分开启动：

```bash
pnpm dev:hybrid:up
pnpm dev:worker:hybrid
```

如果你要在多个 worktree 同时跑多套 hybrid 栈，可以在各自 worktree 的 `.env` 里设置不同的 `HYBRID_PROJECT_NAME`。没设置时默认项目名是 `vibemux`。

默认地址：

- Web：`http://app.vibemux.localtest.me:15173`
- Server：`http://app.vibemux.localtest.me:18989`
- Server（宿主机直连）：`http://127.0.0.1:18989`
- Worker Console：`http://127.0.0.1:48121`

hybrid dev 现在默认把 Web / Server 浏览器入口都收口到 `app.vibemux.localtest.me`。这样工作区右侧本地 Preview iframe 会和 `*.vibemux.localtest.me` 处在同一站点家族下，本地授权 cookie 与网络模型都尽量接近生产。

如果你误从 `127.0.0.1:15173` 或 `localhost:15173` 打开页面，登录页会自动把你收回到 `app.vibemux.localtest.me:15173`。

如果你要在本地直接跳过 Google OAuth，使用内建测试账号，见 [DEV-TEST-AUTH.md](./DEV-TEST-AUTH.md)。

`pnpm dev:hybrid` / `pnpm dev:hybrid:up` 会默认把 `web`、`server` 绑定到 `0.0.0.0`。浏览器公开入口默认收口到 `app.vibemux.localtest.me`，避免 workspace preview 落到跨站点 iframe，也避免浏览器从非 loopback 源站去直连 `127.0.0.1` 时触发 Private Network Access 拦截。如果你明确需要给局域网其他设备访问，再在 `.env` 里固定：

```bash
HYBRID_BIND_HOST=0.0.0.0
HYBRID_PUBLIC_HOST=192.168.1.23
```

这样同网段设备可直接访问：

- Web：`http://192.168.1.23:15173`
- Server：`http://192.168.1.23:18989`

## Preview Transport

workspace preview 现在有三条 transport，按优先级依次尝试：

1. `Local Direct (Experimental)`
   只有当 preview `sourceAppUrl` 是 loopback（`localhost` / `127.0.0.1` / `::1`），并且当前 workspace `executorId` 与本机 worker status 读到的 `runtime.executorId` 一致时，iframe 才会优先直连本机 `127.0.0.1:<port>`。浏览器按页面环境选择本机 worker 端口：development / hybrid 优先 `48121`，preview `vibemux.xyz` 优先 `48123`，production `vibemux.com` 优先 `48100`；优先端口不可达时再尝试其他环境端口。

2. `Gateway`
   正常 hosted preview 走平台 `public-proxy` 路径，由 `*.vibemux.xyz` 入口完成鉴权和反代。

3. `Tunnel`
   当 preview 不是 `public-proxy`，或者本地直连条件不满足时，保留原有 tunnel 兼容路径。

如果 `Local Direct` 超时或加载失败，页面会自动回退到现有 `Gateway / Tunnel`，不会把 preview 停在失败的 localhost 尝试上。

Google OAuth 例外：

- `pnpm dev:hybrid*` 默认会把 `web`、`api`、`better-auth` 全部统一到 `127.0.0.1`
- 这意味着同机浏览器里的 Google 登录可正常使用，但局域网其他设备访问 hybrid dev 时，Google 登录默认不可用；这类场景需要显式提供可被 Google 接受的公网域名并手动设置 `BETTER_AUTH_URL`

如果 Docker 内访问 `registry.npmjs.org` 不稳定，可在 `.env` 里追加：

```bash
NPM_REGISTRY=https://registry.npmmirror.com
```

它会同时作用于镜像 build 阶段和容器内 `pnpm install`。

## 停止与日志

```bash
pnpm dev:hybrid:logs
pnpm dev:hybrid:down
```

## 设计说明

- `deploy/docker/docker-compose.dev-hybrid.yml` 会启动 `postgres`、`server`、`web`
- `web` 容器运行 `pnpm dev:client:docker`，实际是 `vite dev`
- `server` 容器运行 `pnpm dev:server:docker`，实际是 `tsx watch apps/server/src/index.ts`
- 两个容器都挂载当前仓库源码，所以改代码会立刻触发热更新或自动重启
- `server` 通过 `WEMUX_WORKER_CONSOLE_URL=http://host.docker.internal:48121` 访问宿主机 worker console
- `server` 直接读取根目录 `.env` 里的 `OBJECT_STORAGE_*`，因此 hybrid dev 会跟随你当前配置的 R2 / S3-compatible 对象存储
- `server` 通过独立 runtime volume 持久化执行器 registry，避免容器重建后 worker token 丢失

## 常见操作

一键启动三端：

- `pnpm dev:hybrid`

修改 Web 代码：

- 浏览器会通过 Vite HMR 自动刷新

修改 Server 代码：

- `tsx watch` 会自动重启容器内服务进程

重新构建依赖层：

```bash
pnpm dev:hybrid:down
pnpm dev:hybrid:up
```

如果需要改端口：

- 编辑 `.env` 里的 `HYBRID_WEB_PORT`、`HYBRID_SERVER_PORT`

## 注意事项

- `worker` 仍然读取 `.env.development.local`，但 `WEMUX_CLOUD_URL` 会被 `dev:worker:hybrid` 强制指向 `http://127.0.0.1:18989`
- Linux Docker 需要支持 `host-gateway`，这样容器内 `host.docker.internal` 才能回连宿主机 worker
- 如果文件监听不稳定，可以继续把 `.env` 里的 `CHOKIDAR_USEPOLLING` 保持为 `true`
