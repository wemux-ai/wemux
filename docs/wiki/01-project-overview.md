# 项目概述

## Wemux 是什么

Wemux 是一个以 worker 为唯一代码执行入口的 AI 编排平台。

核心特点：
- **Worker-first 架构**：所有代码执行必须通过 worker，禁止 server 本地执行
- **多 Runtime 支持**：OpenCode、Codex、ClaudeCode、Pi 四个 coding agent 统一底座
- **隔离执行**：通过 Git worktree/branch 实现仓库级别的任务隔离
- **控制面与执行面分离**：server 负责控制面，worker 负责执行面

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18, Vite, TanStack Start, Tailwind CSS, lucide-react |
| 后端 | Hono, @hono/node-server, Zod |
| 数据 | Postgres |
| 对象存储 | S3 兼容（RustFS） |
| Git | simple-git |
| 运行 | tsx, turbo |

## 核心能力

- **项目管理**：创建、编辑、删除项目，看板视图（待处理/开发中/审核中/已完成）
- **任务管理**：自然语言创建任务、执行日志、验证结果
- **主 Agent 编排**：需求理解、worker 路由、Agent 选择、需求下发
- **执行中心**：当前执行任务、待调度队列、远端执行链路观察
- **个人设置**：头像上传、OpenCode/Telegram 配置、团队协作

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动基础设施（Postgres + RustFS）
pnpm dev:infra:up

# 启动全栈开发环境
pnpm dev

# 访问地址
# 前端：http://localhost:5173
# 后端：http://127.0.0.1:8989
# Worker Console：http://127.0.0.1:48121
```

## 相关文档

- [WORKER-AGENT-ARCHITECTURE.md](../../WORKER-AGENT-ARCHITECTURE.md) - Worker Agent 架构详细文档
- [AGENTS.md](../../AGENTS.md) - AI Agent 开发规则
- [HYBRID-DEV.md](../../HYBRID-DEV.md) - Hybrid 开发模式说明
