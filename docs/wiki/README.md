# Wemux Code Wiki

> 面向社区的代码知识库，记录公开架构、代码模式、关键概念和开发规范。

## 目录

### 核心概念
- [项目概述](./01-project-overview.md) - Wemux 是什么、技术栈、目录结构
- [关键概念与术语](./02-key-concepts.md) - session、workspace、task 等核心概念的区分
- [执行架构](./03-execution-architecture.md) - worker-only 执行模型、runtime 抽象

### 代码组织
- [目录结构指南](./04-directory-structure.md) - apps/web/server/worker/packages/shared 职责划分
- [命名规范](./05-naming-conventions.md) - 变量、函数、路由、session 的命名要求
- [类型与共享](./06-types-and-shared.md) - packages/shared 的使用、类型定义规范

### 开发指南
- [本地开发](./07-local-development.md) - 开发命令、环境配置、调试方法
- [API 设计规范](./08-api-conventions.md) - HTTP/WebSocket 协议、错误处理、响应格式
- [数据库规范](./09-database-conventions.md) - Postgres + **Drizzle** schema / 迁移（启动 migrate、改表流程）
- 总览补充：[Drizzle Adoption](../DRIZZLE-ADOPTION.md)、[文档索引](../README.md)

### Runtime 与 Agent
- [Runtime 架构](./10-runtime-architecture.md) - OpenCode/Codex/ClaudeCode/Pi 统一底座
- [Agent 执行链路](./11-agent-execution-flow.md) - task runner、prompt runner、session continuation
- [Skill 与 MCP](./12-skill-and-mcp.md) - Skill 同步语义、MCP 注入机制
- [CLI 与控制面 MCP](./19-cli-and-control-plane-mcp.md) - wemux CLI 命令树、控制面 MCP 工具面（inbox/drive/chat）

### 页面与会话
- [三个页面边界](./13-page-boundaries.md) - /chat、/workspace、/workspaces 的职责划分
- [会话模型](./14-session-models.md) - mainChatSession、workspaceSession、distributedTask

### 基础设施
- [Postgres 与对象存储](./15-infrastructure.md) - 开发环境、生产环境的数据库和 S3 配置
- [Hybrid 开发模式](./16-hybrid-development.md) - web/server 在 Docker、worker 在宿主机的开发模式

### 参考
- [常见问题](./18-faq.md) - 开发中常见问题与解决方案
