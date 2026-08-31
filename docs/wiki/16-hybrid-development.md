# Hybrid 开发模式

## 概念

Hybrid 模式是一种三段式开发架构：

- **web + server**：运行在 Docker 容器中
- **worker**：运行在宿主机上，直接访问本地仓库、Git、SSH 和终端

## 目的

1. 让 web/server 的开发环境与生产环境一致
2. 让 worker 继续访问本地文件系统、Git 和终端
3. 避免浏览器因 Private Network Access 限制而拒绝访问

## 地址映射

| 服务 | Hybrid 地址 | 宿主机直连 |
|------|------------|----------|
| 前端 | http://app.wemux.localtest.me:15173 | - |
| 后端 | http://app.wemux.localtest.me:18989 | http://127.0.0.1:18989 |
| Worker Console | http://127.0.0.1:48121 | http://127.0.0.1:48121 |

## 启动命令

```bash
# 一键启动
cp .env.development.hybrid.example .env
pnpm dev:hybrid

# 分开控制
pnpm dev:hybrid:up
pnpm dev:worker:hybrid
```

## 关闭

```bash
pnpm dev:hybrid:down
```

## 查看日志

```bash
pnpm dev:hybrid:logs
```

## 行为特点

- `web` 跑 `vite dev`，保留 HMR
- `server` 跑 `tsx watch`，保留自动重启
- `worker` 继续直接访问本机仓库、Git、SSH 和终端

## 局域网访问

`pnpm dev:hybrid` 会默认开放 `web/server` 到局域网，并自动探测一条局域网 IPv4 作为浏览器访问地址与 Vite HMR 地址。

如需固定 IP，可在 `.env` 中设置：

```bash
HYBRID_BIND_HOST=0.0.0.0
HYBRID_PUBLIC_HOST=192.168.1.23
```

## 预检机制

如果 Docker/OrbStack daemon 不可用，或 hybrid 依赖镜像暂时无法拉取，`pnpm dev:hybrid` 会先做预检并直接给出明确报错，避免 worker 被顺带启动后出现误导性的 WebSocket 错误。

## Worker 连接

Hybrid 模式下 worker 的 `Cloud URL` 固定指向 `http://127.0.0.1:18989`。

## 相关文档

- [HYBRID-DEV.md](../../HYBRID-DEV.md)
- [本地开发](./07-local-development.md)
