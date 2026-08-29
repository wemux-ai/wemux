# 本地开发

## 常用命令

```bash
pnpm install              # 安装依赖
pnpm dev                  # 启动全栈（Turbo TUI 分屏）
pnpm dev:preview          # 预览 worker 连接 preview 控制面
pnpm dev:server           # 单独启动后端
pnpm dev:worker           # 单独启动 worker
pnpm dev:worker:preview   # 单独启动 worker 并连接 preview 控制面

# 基础设施
pnpm dev:infra:up         # 启动 Postgres + RustFS
pnpm dev:infra:down       # 关闭基础设施
pnpm dev:infra:logs       # 查看基础设施日志

# Hybrid 开发
pnpm dev:hybrid           # 三段式 hybrid（web/server Docker，worker 宿主机）
pnpm dev:hybrid:up        # 启动 hybrid 容器
pnpm dev:worker:hybrid    # 启动 hybrid worker
pnpm dev:hybrid:logs      # 查看 hybrid 日志
pnpm dev:hybrid:down      # 关闭 hybrid 容器

# 构建与检查
pnpm typecheck            # 类型检查
pnpm build                # 构建前端 + 后端
pnpm build:server         # 仅构建后端
```

## 默认地址

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:5173 |
| 后端 | http://127.0.0.1:8989 |
| Worker Console | http://127.0.0.1:48121 |

## Hybrid 开发地址

| 服务 | 地址 |
|------|------|
| 前端 | http://app.vibemux.localtest.me:15173 |
| 后端 | http://app.vibemux.localtest.me:18989 |
| 后端（宿主机直连） | http://127.0.0.1:18989 |
| Worker Console | http://127.0.0.1:48121 |

## 环境变量

推荐直接按用途复制模板：

```bash
cp .env.development.local.example .env.development.local
cp .env.development.hybrid.example .env
cp .env.offline.local.example .env.offline.local
cp .env.production.local.example .env.production.local
```

## 开发环境资源

| 资源 | 地址 |
|------|------|
| Postgres | 127.0.0.1:5434 |
| RustFS S3 API | 127.0.0.1:9100 |
| RustFS Console | http://127.0.0.1:9101 |
| Bucket | vibemux |
| Access Key | vibemux |
| Secret Key | 仅供本地开发的临时值（请自行替换） |

## Worker 配对流程

1. 启动 `pnpm dev` 或分别启动 `pnpm dev:server` 与 `pnpm dev:worker`
2. 打开 `/execution`，点击"新增执行器"生成配对码
3. 打开 `http://127.0.0.1:48121`
4. 在 Worker Console 粘贴配对码完成 pairing
5. 回到 `/execution`，确认执行器状态变为"已连接"

## 环境区分

| 命令 | Worker Cloud URL |
|------|----------------|
| `pnpm dev` | http://127.0.0.1:8989 |
| `pnpm dev:hybrid:*` | http://127.0.0.1:18989 |
| `pnpm dev:preview` | https://vibemux.xyz/ |

## 常见问题

**端口占用**：先执行 `docker ps -a` 检查旧容器，再执行 `docker rm -f vibemux-postgres vibemux-rustfs vibemux-rustfs-init`

**需要重置基础设施**：执行 `pnpm dev:infra:down`，如需连数据一起重置，再执行 `docker volume rm vibemux_vibemux-postgres-data vibemux_vibemux-rustfs-data`

## 相关文档

- [HYBRID-DEV.md](../../HYBRID-DEV.md)
- [Hybrid 开发模式](./16-hybrid-development.md)
