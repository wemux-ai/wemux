# 目录结构指南

## 顶层结构

```
vibemux/
├── apps/                    # 三端应用
│   ├── web/                 # React + Vite + TanStack Start（控制台）
│   ├── server/              # Hono 控制面 / WS / 调度 / 集成
│   └── worker/              # 本地执行器 daemon / worker console
├── packages/
│   └── shared/              # 跨端共享类型与契约
├── docs/                    # 文档
├── scripts/                 # 构建与开发脚本
└── dist-server/             # 服务端构建产物
```

## apps/web 前端

```
apps/web/
├── src/
│   ├── routes/              # 页面路由
│   │   ├── chat.tsx         # /chat - 主聊天页
│   │   ├── workspace.tsx     # /workspace - 工作区详情页
│   │   ├── workspaces.tsx   # /workspaces - 工作区列表页
│   │   └── -chat-route/      # 主聊天相关子组件
│   └── components/           # UI 与业务组件
└── public/
```

**职责**：负责 UI、路由、交互状态、表单、展示与调用控制面 API。不要在 web 里发明本地执行逻辑。

## apps/server 控制面

```
apps/server/src/
├── routes/                   # HTTP / WebSocket 路由
│   ├── project-main-chat-session.ts  # 主聊天会话
│   ├── collaboration-workspace-routes.ts  # 工作区路由
│   └── ...
├── services/                 # 业务逻辑
├── repositories/             # 数据访问
└── integrations/              # 外部集成
```

**职责**：负责 Hono HTTP/WebSocket、调度、鉴权、计费、聊天编排、工作区/任务控制面。不承担 worker 本地仓库执行职责。

## apps/worker 执行器

```
apps/worker/src/
├── execution/                # 核心执行逻辑
│   ├── agent-runner.ts      # 统一执行入口
│   ├── runtime-context.ts   # runtime 上下文
│   ├── opencode-runner.ts   # OpenCode 执行器
│   ├── codex-runner.ts      # Codex 执行器
│   ├── claudecode-runner.ts # ClaudeCode 执行器
│   ├── pi-runner.ts         # Pi 执行器
│   └── pi-mcp-tools.ts      # Pi MCP bridge
├── runtime/                  # Runtime 配置导出
├── local-api/                # Worker Console API
└── daemon/                   # Daemon 主进程
```

**职责**：负责配对、daemon、仓库准备、worktree、agent CLI/runtime、产物回传。涉及 Git worktree、仓库 checkout、patch 生成、终端执行问题，默认先从 worker 查。

## packages/shared 共享层

```
packages/shared/src/
├── agent-type.ts             # RuntimeId、AgentType 定义
├── task-workspace.ts         # 会话续接、工作区相关类型
├── types/                    # 共享类型定义
└── ...
```

**职责**：放共享类型、协议、数据结构、跨端纯函数。只要 web/server/worker 至少两端都要理解的结构，优先放这里。禁止在三端各自复制一份相同类型再慢慢漂移。

## 导入别名

```typescript
// @shared/* → packages/shared/src/*
import { buildWorkspaceRouteSearch } from '@shared/task-workspace'

// @/* 或 @web/* → apps/web/src/*
import { Button } from '@/components/ui/button'

// @server/* → apps/server/src/*
// @worker/* → apps/worker/src/*
```

## 相关文档

- [AGENTS.md](../../AGENTS.md) - 项目开发指南中的目录结构说明
