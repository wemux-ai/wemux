# Worker Local Storage Layout

> 更新时间：2026-06-03

这份文档记录 Wemux worker 本地存储的长期结构。目标是让同一台节点可以安全服务多个用户、多个 workspace session，并避免旧的 `workspace/`、`users/unknown`、`workspaces/unknown` 结构继续扩散。

## 1. 设计目标

- 多用户隔离：同一台 worker 节点给多个用户使用时，不同用户的私有项目、仓库缓存、worktree、agent runtime/auth 不能混在同一个目录。
- workspace 共享：同一个 workspace 被多个成员使用时，代码、repo、worktree、产物应稳定落在同一个 workspace 共享目录，不随 owner 或 acting user 改变。
- workspace 隔离：多个 workspace/session 并行执行时，workspace 级 repo/worktree/cache/artifacts 应有独立目录。
- 节点级资源独立：机器配置、machine id、节点级 runtime/cache 属于节点，不属于任意用户或 workspace。
- worker-first：所有本地仓库准备、worktree、agent runtime、artifact 回传路径都由 worker 执行；server 只传递明确 scope，不直接执行本地文件操作。

## 2. 最终目录结构

```text
~/.wemux-dev/
├── node/
│   ├── config.json
│   ├── machine-id
│   ├── runtime/
│   └── cache/
├── users/
│   └── <userId>/
│       ├── projects/
│       ├── repos/
│       ├── worktrees/
│       ├── runtime/
│       └── cache/
└── workspaces/
    └── <workspaceId>/
        ├── projects/
        ├── repos/
        ├── worktrees/
        ├── cache/
        └── artifacts/
```

生产默认根目录是 `~/.wemux`，preview 是 `~/.wemux-preview`，development 是 `~/.wemux-dev`。如果配置了自定义 `workspaceRoot`，仍应保持同一套内部结构。

## 3. Scope 规则

### 节点级 scope

节点级目录只保存这台机器自己的配置和节点级缓存：

- `node/config.json`
- `node/machine-id`
- `node/runtime/`
- `node/cache/`

这些目录不应包含项目代码，也不应包含用户凭据。带用户身份的 agent home/auth runtime 必须进入用户级 scope。

### 用户级 scope

用户级目录用于没有进入具体执行 workspace 的资源：

```text
users/<ownerUserId>/projects/<project>
users/<ownerUserId>/repos/<repo>
users/<ownerUserId>/worktrees/<worktreeId>
users/<actingUserId>/runtime/<runtime>
users/<actingUserId>/cache/<cache>
```

典型场景：

- 新建私人空项目。
- 项目尚未绑定到某个 workspace session。
- 只需要用户自己的原始目录或 repo 缓存。
- Codex/Claude 等 agent runtime 需要用户自己的 auth/config/MCP 凭据。

### Workspace 级 scope

workspace/session 执行目录必须进入根级 workspace 共享 scope：

```text
workspaces/<workspaceId>/projects/<project>
workspaces/<workspaceId>/repos/<repo>
workspaces/<workspaceId>/worktrees/<worktreeId>
workspaces/<workspaceId>/cache/<cache>
workspaces/<workspaceId>/artifacts/<artifact>
```

典型场景：

- `/workspace` 或 `/workspaces` 中启动 workspace session。
- 任务会话需要独立 worktree。
- workspace 级 cache/artifacts 需要与其他 workspace 隔离。

同一个 workspace 被不同成员使用时，路径只使用真实 `workspaceId`。这样同一 workspace 的执行状态稳定落在同一个共享 scope，而不是按 owner 或每个操作者拆成多份。

## 4. ID 语义

- `ownerUserId`：业务拥有者/权限字段。私人项目可用它决定用户级目录；workspace 共享执行路径不使用它拼目录。
- `actingUserId` / `requestedByUserId`：用户私有 runtime/auth 隔离边界。任何带凭据的 agent runtime 都必须使用它。
- `workspaceId`：本地执行 workspace 的真实 id，来自 `WorkspaceRecord.id` 或 workspace session scope。
- `project.workspaceId`：项目可见性或团队归属，不等于本地执行 workspace id。不能直接用它生成 worker 本地路径。
- `workspaceSessionId`：页面会话/执行会话 id，不应替代 `workspaceId` 出现在目录层级里。

## 5. 禁止事项

- 不要再创建根级 `projects/`、`repos/`、`worktrees/`、`runtime/`、`cache/`、`artifacts/`。
- 不要再创建 `workspace/projects/...` 或 `workspace/worktrees/...`。
- 不要再创建 `users/<userId>/workspaces/<workspaceId>/...`。
- 不要把 `unknown` 当作新目录的 `userId` 或 `workspaceId`。
- 不要把用户凭据、agent auth、MCP token 放进 `workspaces/<workspaceId>`。
- 不要让 server/web 自行承担本地仓库、worktree 或 runtime 目录创建职责。
- 不要用 `taskId` 伪造 workspace id。

## 6. 历史数据处理

旧路径只能用于识别、展示、迁移或 remap，不应作为新建目标：

```text
~/.wemux-dev/workspace/projects/<project>
~/.wemux-dev/projects/<project>
~/.wemux-dev/repos/<repo>
~/.wemux-dev/users/<userId>/workspaces/<workspaceId>/projects/<project>
~/.wemux-dev/users/unknown/workspaces/unknown/projects/<project>
```

如果运行时看到 `users/unknown` 或 `workspaces/unknown`，优先检查：

- 是否还有旧 server/worker 进程未重启。
- 创建私人项目或 worker ensure 请求是否缺少 `ownerUserId` / `createdById`。
- workspace 执行请求是否缺少真实 `workspaceId`。
- agent runtime 请求是否缺少 `actingUserId` / `requestedByUserId`。
- Postgres 中项目 `local_path` 是否已经保存了旧路径。

## 7. 协议要求

跨 server/worker 的 worktree ensure、cleanup、terminal、repo prepare、desktop sandbox 等协议只要涉及本地路径，都应显式携带：

- `workspaceId`，仅在真实 workspace/session 执行时传，用于共享执行目录
- `ownerUserId` / `createdById`，仅用于私人项目等用户级资源
- `actingUserId` / `requestedByUserId`，用于用户私有 runtime/auth
- `workspaceSessionId`，仅用于会话定位，不用于目录层级

shared 层负责集中构造和识别托管路径，避免 web/server/worker 三端复制目录拼接逻辑。
