# API 设计规范

## 路由组织

Server 路由在 `apps/server/src/routes/`：

```
apps/server/src/routes/
├── project-main-chat-session.ts    # 主聊天会话
├── collaboration-workspace-routes.ts # 工作区相关
├── workspace-group-chat-routes.ts   # 工作区群聊
├── workspace-management-routes.ts    # 工作区管理
└── ...
```

## HTTP 方法语义

| 方法 | 用途 | 示例 |
|------|------|------|
| GET | 获取资源 | `GET /api/projects/:id` |
| POST | 创建资源 | `POST /api/tasks` |
| PUT | 完整更新 | `PUT /api/projects/:id` |
| PATCH | 部分更新 | `PATCH /api/projects/:id` |
| DELETE | 删除资源 | `DELETE /api/projects/:id` |

## 响应格式

```typescript
// 成功响应
{
  "success": true,
  "data": { ... }
}

// 错误响应
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid project ID"
  }
}
```

## 错误处理原则

1. 错误有明确返回，不静默吞错
2. 使用 Zod 进行参数校验
3. HTTP 状态码语义正确（400/401/403/404/500）

## WebSocket 协议

WebSocket 用于实时事件推送：

```typescript
// 客户端订阅
ws://server/ws?sessionId=xxx

// 服务端推送事件
{
  "type": "task_update",
  "data": { ... }
}
```

## API 路由规范

```typescript
// Good - 语义清晰
POST /api/projects/:projectId/main-chat-sessions
POST /api/workspaces/:workspaceId/workspace-sessions
POST /api/distributed-tasks/:taskId/advance

// Bad - 过于泛化
POST /api/sessions
POST /api/tasks
```

## 业务逻辑下沉

路由层负责协议、参数校验、响应码；业务逻辑优先下沉到 `services/`、`repositories/`、`integrations/`。

```typescript
// routes/task.ts
router.post('/tasks', async (c) => {
  const body = await c.req.json()
  const validated = taskSchema.parse(body)

  // 业务逻辑下沉到 service
  const task = await taskService.create(validated)

  return c.json({ success: true, data: task })
})
```

## 相关文档

- [API 概览](../../README.md#API-概览)
