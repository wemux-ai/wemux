# 类型与共享

## 核心原则

**只要 web/server/worker 至少两端都要理解的结构，优先放 `packages/shared`**。禁止在三端各自复制一份相同类型再慢慢漂移。

## packages/shared 职责

1. 跨端共享类型与契约
2. 协议字段定义
3. 纯函数工具
4. 常量枚举

## 禁止在 shared 做的

- 耦合浏览器 API（如 `window`、`document`）
- 耦合 Node 特有副作用（如 `fs`、`path` 在非 node:test 场景）
- 直接发起网络请求

## 类型定义位置

```typescript
// packages/shared/src/agent-type.ts
export enum RuntimeId {
  OpenCode = 'opencode',
  Codex = 'codex',
  ClaudeCode = 'claudecode',
  Pi = 'pi',
}

export interface RuntimeDefinition {
  runtimeId: RuntimeId
  transport: 'sdk' | 'stdio'
  modelIdStrategy: 'canonical' | 'native'
}

// packages/shared/src/task-workspace.ts
export interface WorkspaceSession {
  workspaceId: string
  workspaceSessionId: string
  taskId?: string
  runtimeId: RuntimeId
  // ...
}
```

## 导入方式

```typescript
// 1. 使用 @shared 别名
import { RuntimeId } from '@shared/agent-type'
import type { WorkspaceSession } from '@shared/task-workspace'

// 2. 跨端共享纯函数
import { buildWorkspaceRouteSearch } from '@shared/task-workspace'
```

## 类型修改流程

1. 新增跨端字段时，先改 `packages/shared`
2. 同步检查消费方（web/server/worker）
3. 运行 `pnpm typecheck` 验证

## 常用类型文件

| 文件 | 内容 |
|------|------|
| `agent-type.ts` | RuntimeId、AgentType、RuntimeDefinition |
| `task-workspace.ts` | WorkspaceSession、WorkspaceSessionScope、session continuation |
| `types/index.ts` | 通用类型定义 |

## 导入顺序规范

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
