# 常见问题

## 开发环境问题

### 端口占用

**症状**：启动时报端口占用错误

**解决**：
```bash
docker ps -a
docker rm -f wemux-postgres wemux-rustfs wemux-rustfs-init
```

### 需要重置基础设施

**症状**：数据库或对象存储状态异常

**解决**：
```bash
pnpm dev:infra:down
# 如需连数据一起重置
docker volume rm wemux_wemux-postgres-data wemux_wemux-rustfs-data
pnpm dev:infra:up
```

### RustFS bucket 未创建

**症状**：上传文件失败

**解决**：
```bash
pnpm dev:infra:logs
# 检查 rustfs-init 日志
```

## Worker 问题

### 执行器显示 offline

**检查顺序**：
1. `http://127.0.0.1:48121` 是否显示 `Cloud Session = Connected`
2. `/execution` 中执行器是否显示"已连接"，并且最近心跳时间有更新
3. 是否只启动了一套 `web/server/worker`，避免旧 dev 进程占用端口
4. 必要时重新在 Worker Console 点击"连接云端"或重新配对

### Git worktree 创建失败

**检查**：
- 项目路径是否存在
- 该路径是否已初始化 Git
- 当前仓库是否允许创建新分支/worktree

## Session 问题

### Session 混用

**症状**：消息追到错误的会话

**检查**：
- 确认使用的是 `mainChatSession` 还是 `workspaceSession`
- 确认 URL 对应的页面（`/chat`、`/workspace`、`/workspaces`）
- 检查 session ID 的来源和注入点

### 切换 runtime 后消息追到旧会话

**原因**：没有正确使用 scoped continuation

**解决**：
- 确认 `runtimeContinuations` 中有该 runtime 的 continuation
- 确认 scope（runtimeId + executorId + cwd hash）匹配
- 检查 handoff snapshot 是否正确生成

## 类型问题

### TypeScript 报错

**解决**：
```bash
pnpm typecheck
```

### 类型不一致

**原因**：可能三端各自复制了相同类型

**解决**：
- 确认类型是否应该放在 `packages/shared`
- 检查 web/server/worker 是否各自定义了相同的类型
- 统一到 shared 层

## 构建问题

### 基础设施容器不可用

**症状**：`pnpm dev:hybrid` 预检失败

**原因**：Docker/OrbStack daemon 不可用，或镜像无法拉取

**解决**：等待 Docker 服务恢复，或手动拉取镜像

## 相关文档

- [本地开发](./07-local-development.md)
- [Hybrid 开发](./16-hybrid-development.md)
- [会话模型](./14-session-models.md)
