# CLI 与控制面 MCP

> 记录 wemux CLI 命令树、控制面 MCP 工具面及其单一事实源。
> 用户侧命令参考见 docs 站 `guides/cli-reference`（`apps/web/src/content/docs/guides/cli-reference.*.mdx`）。

## 一、CLI 命令树

- **入口**：`apps/worker/src/index.ts`（顶层 worker 生命周期分发）+ `apps/worker/src/cli/index.ts`（资源命令路由）
- **单一事实源**：`apps/worker/src/cli/help.ts` 的 `RESOURCE_SPECS`（新增命令必须先改这里，`renderRootHelp`/`renderTopicHelp` 自动生成帮助）
- **命名**：规范命令名 `wemux`；`vbx` / `vibemux` 是旧别名（`getCliName()` 按启动 bin 名识别）；npm daemon 包 bin（`wemux-worker*`）按旧入口处理（裸调用默认 `daemon`）
- **规范 CLI 判定**：`isCanonicalCliName()`（`wemux`/`vbx`/`vibemux` 为规范 CLI，裸调用显示 help、顶层 worker 命令必须写 `wemux worker <cmd>`）
- **认证**：`WEMUX_TOKEN`（走 `/mcp`）或已配对 worker 的 executor token（走 `/mcp/executor`）

### 资源命令一览

| 资源 | 命令 |
|------|------|
| `worker` | connect / daemon / status / doctor / update / service / bootstrap / unpair / mesh / browser-inspect / desktop-sandbox / runtime-smoke / mcp-stdio / reset |
| `project` | list / get / create / update / select / delete |
| `task` | list / get / create / run / execution / send / subtask create / chat list\|get / model / agent / cancel / retry / runs / update / delete |
| `workspace` | list / get / create / delete / session list\|get\|runtime |
| `agent` | list / types |
| `skill` | list / get / packages / delete |
| `node` | list |
| `mcp` | list |
| `inbox` | list / groups / get / read / read-group / reply（user 视角收件箱） |
| `drive` | list / get / info / write（`--workspace` 团队 / `--personal` 个人） |
| `chat` | conversations / get / channel list\|send |

### 命名与参数约定

- `parseCliArgs`（`apps/worker/src/cli-flags.ts`）：布尔 flag 白名单维护在 `BOOLEAN_FLAGS`，新增布尔 flag 需登记
- 输出：`apps/worker/src/cli/output.ts`，`--json` 走 JSON，否则按数组 key（projects/tasks/workspaces/executors/conversations/items/groups/files/agents/servers/runs/sessions）打印表格
- 破坏性操作走 `confirmDangerousAction`（`-y` 跳过）

## 二、控制面 MCP 工具面

- **端点**：`POST /mcp`（Bearer token，用户身份）与 `POST /mcp/executor`（executor token，可选 `x-wemux-acting-user` 换身份）——`apps/server/src/routes/mcp-routes.ts`
- **组装**：`apps/server/src/integrations/mcp/wemux-mcp-tools.ts` 聚合注册以下模块：

| 模块 | 工具域 |
|------|--------|
| `vibemux-mcp-control-tools.ts` | project / session / workspace / conversation / channel / executor |
| `vibemux-mcp-task-tools.ts` | task 全套（含 chat_session） |
| `vibemux-mcp-task-collab-tools.ts` | task.assign / comment / send / delivery |
| `vibemux-mcp-workspace-session-tools.ts` | workspace.session.* |
| `vibemux-mcp-agent-runtime-tools.ts` | agent.event / agent.inbox.*（Agent 收件箱）/ handoff / wait / task.comment.add |
| `vibemux-mcp-drive-tools.ts` | drive.list_files / read_file / write_file / file_info（个人+团队 scope，角色鉴权） |
| `vibemux-mcp-inbox-tools.ts` | inbox.list / groups / get / read / read_group / reply（**user 视角**，复用 inbox-service `recipientType='user'`） |
| `vibemux-mcp-skill-tools.ts` | skill.* |

### 关键约定

- **收件箱双端**：`agent.inbox.*` 服务 Agent runtime（recipientType 写死 `'agent'`）；`inbox.*` 服务用户（`'user'`）。数据层共用 `inbox-service`（投递/分组/已读/回复都按 recipient 隔离），**不要复制一份收件箱逻辑**
- **只读注解**：查询类工具注册时带 `WEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS`，新增查询工具须同步
- **回复路由**：inbox item 的 `replyTo` 字段决定回信地址（task_comment / channel / inbox_item），渠道差异只活在那里，投递方必须填、路由层不猜
- CLI 与 Agent 共用同一工具面：CLI 命令是 `WemuxClient.callTool(name)` 的薄封装，**不为 CLI 发明服务端逻辑**
