# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.130 Preview] - 2026-08-26

### Changed

- **Open core boundary**: public builds now contain only community-safe source and documentation, with optional integrations loaded through stable extension points.
- **Database migration split**: Drizzle migrations are maintained as separate, idempotent chains so self-hosted upgrades remain repeatable.
- **Landing positioning**: the Hero H1 now uses the product's primary positioning, “AI 原生组织的操作系统” / “The AI-Native Organization OS”; the supporting eyebrow is the control-plane anchor sentence.
- **Dashboard overview**: removed the redundant last-activity row and Kanban shortcut.

### Changed

- 清理根目录遗留文件：移除 npm 时代遗留的 `package-lock.json` 与误提交的 `vite.config.d.ts`，并加入 .gitignore 防复发
- 修复 worker 对 `WEMUX_WORKER_HOME` / `WEMUX_HOME` 中未展开 `~` 前缀的解析，避免在项目目录下生成 `~/` 错误目录

## [0.3.129 Preview] - 2026-08-23

### Added

- **反馈收件箱（多渠道治理闭环）**：统一 ingest 入口、多源 webhook 幂等去重、结构化整理、回复审查和 GitHub issue 转换。
- **工作区模型列表快速路径**：选中 Agent 后模型菜单不再阻塞等待 worker 配置导出（原最长 10s）——先展示模型库（系统模型库/官方目录/内置目录），worker 运行时模型后台补全后自动合并；实测冷缓存 1.02s、补拉 3.75s、热缓存 22ms。
- **OpenRouter OAuth BYOK**：模型中心新增一键连接（OAuth PKCE），免费模型自动登记，无需手动粘贴 API Key。
- **项目成员分享**：私有项目可拉同组织成员可见/协作。
- **桌面端服务器地址选择**：默认 wemux.ai，自托管用户可改；切换时清登录态防串号；下载页 macOS 标注 Apple Silicon / Intel 芯片版本。

### Changed

- **Worker 更新原子性**：staging 冒烟校验通过后再 swap + bin wrapper 级自修复（加载失败自动从控制面重装，真实故障演练验证）。
- **Worker 包体瘦身**：剔除 opencode 平台二进制 138MB→41MB（-70%），再剔除 sourcemap 与 SDK TS 源码再减 8MB。
- **控制面稳定性**：致命错误快速自愈 + 执行器僵尸连接清扫；扩展 gate 的启动与故障处理更加稳健。
- **核心边界收敛**：可选能力统一通过稳定的 gate/registry 接口装配；公开版迁移与构建检查更加可靠。
- **环境变量统一**：模块顶层读取统一走环境变量适配器，部署文档统一 WEMUX_ 前缀；i18n 补齐缺失翻译。
- **CI 优化**：push paths filter 减少不必要的构建；deploy-preview Docker 缓存写回。

## [0.3.128 Preview] - 2026-08-21

### Added

- **社区版登录体验**：未配置邮件发送时注册直接成功无需验证；Google 登录未配置时按钮置灰；登录页单页布局（邮箱在上、Google 在下）+ Google 图标。
- **社区版能力边界披露**：README 与 SELF-HOSTING 补充 Apache-2.0、自托管能力与可选服务说明。

### Changed

- **Railway 自托管部署**：DATABASE_URL 改为模板引用 `${{Postgres.DATABASE_URL}}`，避免跨项目引用错乱。
- **CI 单测全绿**：修复 8 个失败（品牌改名遗留断言 ×2、dev-auth 账号列表、时区敏感 ×3、platform 适配、产品演进断言同步）。
- **Worker 安装器**：安装脚本跳过 `vibemux-worker-preview` 残留目录；`--worker-name` 校验完善。

## [0.3.127 Preview] - 2026-08-20

### Added

- **GitHub App 协作仓库可见性**：新建项目选仓库时可读取被邀请协作/所在组织的仓库。新增 OAuth 授权链路（设置页「授权账号」），聚合所有用户可访问安装的仓库并去重；协作仓库绑定/克隆/推送自动使用对端安装 token。需要 GitHub App 启用 OAuth 并配置 `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET`，未配置时行为不变。

### Changed

- **反馈管理准入统一**：反馈接口与管理权限校验统一，修复页面与接口权限不一致的问题。
- **工作区 Git 身份诊断**：工作区管理接入 Git 身份诊断（`resolveUserProjectGitIdentityDiagnostic`），云节点 executor 启动/等待路径完善。

## [0.3.126 Preview] - 2026-08-20

### Fixed

- **Windows 节点安装弹窗导致离线**：计划任务改为 `conhost.exe --headless` 拉起 supervisor，安装/登录自启不再弹出可见终端窗口；supervisor 启动时自动隐藏自身控制台窗口（`ShowWindow SW_HIDE`，不触发 `CTRL_CLOSE`）兜底覆盖老安装，避免关窗杀进程导致节点离线。

## [0.3.125 Preview] - 2026-08-19

### Changed

- **GitHub 授权流程收口**：创建项目弹窗不再内联提交身份输入与直接授权，统一跳转设置页「Git 身份治理」绑定浮窗；`githubAppConnect=1` 参数触发自动弹出，并清理 URL 参数避免刷新重复弹窗。
- **模型中心执行节点选择**：下拉展示全部节点（含离线），离线节点标注离线状态，避免已配置节点离线时从下拉消失。
- **Onboarding 精简**：移除配对步骤的「节点网络类型」（internal/public）手动选择。

### Fixed

- **自包含安装器 bin 可执行位**：修复 tar 打包后 bin 文件丢失可执行位导致安装器报 `binary not found`。

## [0.3.124 Preview] - 2026-08-19

### Added

- **DM/群聊乐观气泡收敛**：发送消息携带 `clientMessageId`，WS 回声早于 HTTP 响应时按 ID 替换乐观气泡，避免短暂双显。

### Changed

- **Worker 自包含安装器**：安装包改为 tar 直出（构建期打入生产依赖），目标机不再依赖 npm；生成 vbx/vibemux/wemux 等 bin 软链（Windows 为 .cmd 包装器）。
- **入口清理**：Drive 移除「加入 Agent 共享知识」入口；主聊天入口去掉 Alpha 徽标。

### Fixed

- **模态弹窗内下拉菜单不可滚动/不可点击**：修复 Git Clone 等弹窗内授权仓库/执行节点选择器在弹窗打开后无法滚动与点击的问题（滚动锁误拦截 + body `pointer-events: none`）。

## [0.3.123 Preview] - 2026-08-19

### Added

- **Agent 文件视图**：Agent 配置新增「文件」Tab，并排查看执行位置（本地 workdir 或云节点 R2）与 Drive 中的 `agents/<agentId>/` 文件。
- **旧域名强制迁移**：control-plane 对 `vibemux.xyz` / `*.vibemux.xyz` 返回到 `wemux.xyz` 的 HTTP 308，对 `vibemux.com` / `*.vibemux.com` 返回到 `wemux.ai`；保留路径、查询参数和请求方法。

### Changed

- **发布资源命名**：Cloudflare Pages 默认项目、Dokploy 镜像模板、部署文档和 GitHub 仓库示例统一更新为 `wemux` 名称。

## [0.3.122 Preview] - 2026-08-19

### Added

- **多节点 Active-Active**：任务聊天队列与会话租约、跨节点 stop/cancel relay、节点 owning lease 校验、心跳回收和跨节点回归测试完善。
- **工作空间级聊天可见性**：DM、好友关系、用户搜索和聊天对象按工作空间隔离；跨空间联系人需在目标空间建立好友关系后才可匹配。

### Changed

- **连接关系存储**：`user_connections` 增加 `workspace_id` 范围与复合唯一约束，好友请求/接受/列表/私聊创建统一携带工作空间上下文。
- **聊天与协作体验**：统一聊天输入与会话侧栏、群聊/DM 交互和通知体验持续收敛。
- **品牌迁移兼容**：根包名更新为 `wemux`；Railway PR 健康检查同时识别新旧服务名及 GitHub 仓库地址。

### Fixed

- 修复切换工作空间后上一空间 DM、成员和搜索结果残留的问题。

## [0.3.121 Preview] - 2026-08-18

### Added

- **工作区分享与协作模型重构**：新 `workspace_shares` 表与 API（授权/撤销/列表/「共享给我的」）；权限三档（查看/可编辑/可协作）× 范围三级（整个工作区/所有会话/仅此会话）；分享弹窗两步交互（选目标 → 选发送会话），分享=授权+发链接消息、协作=仅授权；协作人可在被授权会话内发消息（chat-queue 鉴权放行）。
- **「共享给我的」面板**：从 /chat 侧栏移至 /workspaces 列表顶部（SharedWithMePanel），展示被共享的工作区/会话并可进入。
- **@会话 / @工作区 提及**：会话消息支持引用型提及（不通知、不唤醒 Agent），DM 与群聊路径均支持并持久化引用记录。
- **组织架构 tab 分组视图**：部门树废弃（工作空间保持平级），组织架构改为「分组」视图（复用空间内成员分组，人 + Agent 混合）。
- **DM 会话重命名 / 置顶 / 删除**：私聊会话可改名（PATCH /api/conversations/:id）、置顶/取消置顶（`pinnedAt` 持久化）、删除（DM/群聊）。
- **悬浮聊天开关**：设置页可关闭悬浮聊天 FAB（localStorage 持久化，同标签页实时联动，默认开启）。

### Changed

- **聊天输入框重构**：统一 `ChatComposer` + 飞书式悬浮输入区（`ChatComposerOverlay`），DM/群聊/工作区会话统一接入；旧 `agent-chat-composer` / `chat-composer-shell` 退役。
- **会话侧栏统一**：`chat-session-list-sidebar` 合并 DM 与群聊会话列表（置顶分组、未读、好友分区、添加好友入口）；`dm-session-sidebar` / `workspace-group-session-sidebar` 退役。
- **DM 通知回归 WS 实时订阅**：`dm-inbox` 服务退役，DM 消息通知由 WS 实时事件 + 未读红点承载。

### Removed

- 部门树相关能力：`parent_workspace_id` / `department_workspace_id` 两列删除（0083 migration）、`org-tree-service` / `org-tree-view` 退役。

## [0.3.120 Preview] - 2026-08-18

### Added

- **用户 ID（@username）体系**：全局唯一用户 ID（3–20 位 `a-z0-9._-`），老用户按邮箱前缀自动回填（设置页可修改，修改后 30 天冷静期）；搜索支持按 ID 匹配，用户卡片/群成员/私聊/DM 会话头部/设置页成员列表展示 `@username`。
- **跨协作空间连接机制（好友）**：双向确认的好友体系（请求 → 收件箱提醒 → 接受/拒绝），设置页「好友与连接」面板 + 用户卡片加好友按钮 + /chat 侧栏「好友」分区（实时刷新）。
- **跨空间可见性收紧（飞书式）**：用户搜索/Drive 协作者/全局搜索只返回「同协作空间成员 ∪ 已连接好友」，私聊强制可见性校验——未连接用户搜索不可见、不能私聊；同空间成员即使没聊过也互相可见。
- **入空间确认**：管理员添加成员改为发送待确认邀请，被邀请人收件箱提醒并跳转确认页，接受后才成为成员。
- **空间内分组**：协作空间成员分组（人 + Agent 混合、可多组），设置页分组管理；群聊创建按组筛选；群聊 `@组名` 展开为组内全部成员通知。

### Fixed

- **私聊实时性**：所有私聊会话统一 WS 订阅——消息即时上屏、未读红点实时 +1、已读游标推进；DM 消息生成收件箱提醒（铃铛红点 + 浏览器通知 + Web Push）并可深链跳回对应私聊。
- **DM 消息左右对齐**：对方消息强制左侧渲染（此前与自己的消息一样全在右侧）。
- **切换协作空间聊天对象残留**：切换时立即清空上一空间的群聊/成员/详情，选中态同步重置。
- **成员发起私聊选中态**：工作区成员/好友点击发起私聊后侧栏正确高亮（此前传错会话 id）。

## [0.3.119 Preview] - 2026-08-17

### Fixed

- **群聊选择器 Agent 可见性**：创建/转发群聊时「协作 Agent」列表只显示当前用户自己的 Agent 或已显式归属该工作空间的共享 Agent，不再把全库用户自动生成的默认 CEO Agent 全部列出来。
- **老 CEO Agent 头像回填**：8-17 之前自动创建的默认 CEO Agent 缺少内置头像（界面显示首字母占位）；server 启动时对仍保持默认模板身份的记录自动回填 agent-01.png，用户个性化修改不受影响。

## [0.3.118 Preview] - 2026-08-17

### Added

- **工作区协作路由**：新增可选的消息意图识别、未认领事件分发和共享上下文能力，帮助团队把工作交给合适的 Agent。
- **工作区协作设置**：新增协作行为与 Agent 选择设置，默认保持关闭并可按工作区启用。
- **组织概览增强**：顶部时间范围筛选（今天 / 近 7 天 / 近 30 天）+ Agent 完成率卡片（近 200 条工作记录样本统计 + 待跟进状态标注）。

## [0.3.117 Preview] - 2026-08-17

### Added

- **协作区治理**：团队成员、模型、Agent 和消息渠道的可见性与权限规则统一。
- **模型中心扩展**：10 家提供商接入模板（Gemini / OpenRouter / 阿里通义 / 智谱 / MiniMax / Mistral / Groq / xAI / 硅基流动 / 火山引擎）+ 10 个品牌 logo + 「新增模型」浮窗模板目录；Agent 消息头像卡片（点击弹身份卡，聊天/画像双入口）。
- **私聊对象级会话列表**：同一私聊对象可开多个会话；修复私聊选中时主面板误显示 Agent 面板（DM 三态路由）。

### Changed

- 执行节点列表重构：版本过旧与 Mesh 异常标记改为可点击（定位节点详情）、更多操作收 icon、行紧凑化；feedback dialog / inbox / kanban / chat 侧栏一批 UI 打磨；mcp 页支持移除选中服务器。
- CEO 模板固定内置头像（不再随机占位）。

## [0.3.116 Preview] - 2026-08-16

### Added

- **DM 私聊全链路**：会话 get-or-create + 用户/Agent 卡片发起 + 聊天面板；聊天 @ 能力统一（三种场景 @ + @文档 Drive 引用）；Agent 发消息 MCP 工具（`chat.send` / `group.list` / `user.list`）；dashboard 改版（需要我处理 / Agent 团队 / 协作动态 / 热力图折叠）；用户菜单 + 升级套餐弹窗；工作区会话分享到主聊天/群聊/链接。
- **Agent 外部渠道接入**：新增 Telegram、Discord、Slack、WhatsApp、钉钉等渠道适配，并统一 Agent 消息收发与配置界面。
- **实时通知**：新增 Web Push、会话未读同步和桌面原生通知支持。
- **录音、会议与桌面端**：新增会议记录、录音、桌面托盘、快捷键和系统通知等客户端能力。
- **Railway 集成**：新增 Railway 项目、资源、部署和绑定管理，以及 Integrations 页入口。
- **全局搜索**：`GET /api/search`（跨 8 类实体 + 用户作用域）+ 侧边栏按钮 / ⌘K 悬浮面板 + 消息正文全文 + 类型过滤。
- **品牌改名收尾**：完成用户可见名称清理、SEO 标记修复和旧地址兼容跳转。
- wemux CLI 新增 `inbox` / `drive` / `chat` 资源命令（收件箱 / 云盘 / 会话与渠道）；server 新增 `inbox.*` MCP 工具（`recipientType='user'`）。
- **邮件与运行时配置**：邮件发送模式提示更清晰；Codex OAuth worker WS 消息分发；新建项目不强制绑定执行节点；支持无项目自由工作区。

### Changed

- wemux CLI 规范命令名从 `vbx`/`vibemux` 改为 `wemux`（旧名保留别名）；`vbx-` API token 前缀有意保留（存量数据格式）。
- **Drizzle migrations**：持续整理反馈、遥测、集成与会话相关表的迁移链，确保自托管升级可重复执行。

## [0.3.98] - 2026-07-22

### Fixed
- Fixed newly created projects showing a success notification followed by `项目不存在` by persisting the project before follow-up binding requests.

## [0.3.115 Preview] - 2026-08-09

### Fixed

- 修复 preview worker 更新链路断裂：Publish Worker NPM workflow 包名未随 wemux 迁移同步（0.3.113/0.3.114 两次发布 MODULE_NOT_FOUND 失败，preview worker 停滞在 0.3.112），smoke test 与 publish 步骤改为 `wemux-worker(-preview)`。
- worker 更新检查不再依赖 npm registry：统一走 server installer（HTTP）manifest + package.tgz 通道，存量 `vibemux-worker-preview` 包与 `wemux-worker-preview` 包均从各自 server 更新。

### Changed

- worker 包服务名 / 默认 bin / 端口环境补认 `wemux-worker(-preview)` 新包名（品牌迁移遗漏项）。
- `scripts/package-worker-npm.mjs` 支持 `--package-name` 覆盖，用于一次性迁移包。

## [0.3.114 Preview] - 2026-08-08

### Fixed

- 阻止 `revoked_auth_tokens` 过期清理的无条件 DELETE 触发 `vibemux_storage_change` 反馈死循环（0 行 DELETE 也会产生事件 + notify → listener 再 refreshAuthStore → 再 DELETE）。现在仅在存在已过期 token 时执行清理；`storage_change_events` 增加 7 天保留定期清理。

### Added

- 组织概览页展示 Agent 头像（读取 custom agent 配置的 avatarUrl，web 端解析媒体地址渲染）。


## [0.3.113 Preview] - 2026-08-07

### Added

- Agent 体系按工作空间隔离（9 阶段）：Agent 归属 + 可见性（私有/工作空间共享）、侧边栏//agents/workspace 列表按空间过滤、Main Chat 会话历史隔离、任务指派/Mention 权限纳入 visibility、Agent Home/Workdir 按空间分层、模型库/Skill/MCP 选择器按当前 workspace 严格过滤、外部渠道（飞书/Telegram）按空间隔离、收件箱 Notion 式聚合 + workspace 筛选、仪表盘按协作工作空间过滤、执行节点共享按 workspace 隔离。
- 老数据迁移脚本 `scripts/migrate-agent-workspace-scope.ts`（`pnpm db:migrate:agent-scope`，dry-run + `--apply`）。
- Vibemux 品牌迁移至 wemux（用户可见品牌、域名、SEO、营销与文档），worker 默认 cloudUrl 在 wemux 域名未上线时自动回退 vibemux，存量 `VIBEMUX_*` env 双读兼容。

### Changed

- `isWorkspaceResourceVisible` / `isCustomAgentAccessible` / `isExecutorVisibleToUser` 统一资源可见性判断（系统级全局、owner 可见、workspace 共享必须归属当前空间）。
- executor 协议 `executor.agent.workdir.*` 新增可选 `workspaceId`（向后兼容，旧 worker 不传=全局）。
- 执行节点共享隔离为可选过滤：私有节点跨空间可用，共享节点在 workspace 上下文中按归属过滤（MCP/CLI/协议零影响）。

### Docs


## [0.3.112 Preview] - 2026-08-07

### Added

- Added a unified chat frontend model for main chat and workspace sessions (Thread/Message convergence, P2.3 merged transcript building, P2.4 useThread adoption across Agent panel and /chat).
- Added client-side true pagination for main chat history (seq cursor + load-more, P3b).
- Added reconnect-cursor resume and cross-tab incremental rendering for /chat and the Agent panel, including live reasoning/tool rendering (P6).
- Added a unified Agent live state aggregation across main chat and workspace sessions, with per-session live indicators in the chat list.
- Added shared executor runtime data caching across dashboard/execution/workspaces, WS replay-buffer expiry fallback refresh, and an api `methods.ts` split into 14 domain files (364 methods, no dropouts).
- Added `@tanstack/react-virtual` virtualized rows for the workspaces table panel.
- Added exponential backoff for main-chat WebSocket reconnect (2s→30s cap, stops when the token is cleared).

### Changed

- Chat transition states cleaned up: removed dead MessagePart types, `workspace_session_id` moved to a real column, `messages.sender_type` removed so `role` is the single source of truth.
- Kanban polling moved to react-query visibility-aware refetch; workspaces-page polling converged; detail pane unload strategy and PR matching memoization improved.
- Narrowed files-directory cache invalidation to the current executor scope.

### Docs

- Added a unified public documentation index and module-level architecture guidance.
- Landed module-level documentation and business-file contract headers for maintainers.

## [0.3.110 Preview] - 2026-07-25

### Added

- Added an explicit `control-plane` and `workspace` execution-surface contract across server-to-worker Agent prompt requests.

### Changed

- Main Chat, Direct Chat, Group Chat, and external-channel Agents now create or resume a Task before delegating code, documentation, Git, test, or build work to a Workspace Session.
- Main Chat no longer applies the retired five-minute server-side prompt timeout.

### Fixed

- Fixed Codex, Claude Code, OpenCode, and Pi control-plane turns being able to inherit write or command capabilities intended only for workspace execution.
- Fixed Agent instructions that could allow control-plane conversations to fall back to project-local or Agent Home code execution.

## [0.3.109 Preview] - 2026-07-24

### Added

- Added a required Wemux Agent collaboration protocol covering task events, workspace ownership, delegated execution, waiting/resume, and atomic delivery.
- Added a unified Task Timeline for create, assign, comment/Mention, Agent run lifecycle, waits, workspace creation, and file changes.
- Added server-side Attention notifications when workspace sessions complete, fail, or need attention, with precise task/workspace/session wait matching.
- Added a canonical GitHub resource model for Pull Requests, Issues, and Workflow Runs, plus multi-project membership and execution-context bindings.
- Added workspace group-chat Mention notifications and real Agent creator/author identity snapshots across tasks, workspaces, queues, and session history.

### Changed

- Task comments only start Agents on structured `@Agent` mentions; final Agent replies attach back to the triggering comment thread and report delivery once.
- Task detail now keeps draft protection for local title/description/status edits while refreshing workspaces, comments, and timeline over realtime events.
- Create-task Agent mode reuses the same project and assignee chip selectors as manual mode instead of a separate full-width searchable dropdown.
- `vbx worker status` reports only the daemon matching the current executor, keeping diagnostic logs on stderr so JSON stdout stays scriptable.

### Fixed

- Fixed create-task project menus being clipped by dialog overflow and failing to scroll when many projects were available.
- Fixed Agent assignment and delivery paths that could show the owner user instead of the real Agent identity.
- Fixed workspace completion and group-chat mention flows that could drop restore context or miss member notifications.
- Fixed GitHub PR/issue/workflow ownership and binding updates that could overwrite other projects or human-confirmed links.

## [0.3.108 Preview] - 2026-07-22

### Added

- Added custom Agent assignment for tasks with explicit start-now or assign-only modes, optional handoff prompts, task-level execution controls, retry actions, live logs, and independently persisted attempt transcripts.
- Added server-authoritative comment Mention previews and Agent triggers, plus comment threads, resolve state, editing, soft deletion, reactions, attachments, followers, and persisted notifications.
- Added workspace group chats to Agent Chat with creation, unread and running indicators, multi-Agent mentions, and creator-managed group settings.
- Added workspace defaults for execution nodes, Coding Agents, and models, together with user- and workspace-scoped Worker storage and Git SSH remote verification.

### Changed

- Unified Agent visibility and authorization around user-owned Agents shared explicitly to projects or collaboration workspaces; the initial CEO Agent is now only a normal, editable, deletable example Agent.
- Removed Squad from active task assignment, comment Mention, MCP, chat, and product surfaces while keeping group chat as a separate communication model.
- Consolidated code delivery on Worker-side branches, commits, and pull requests, removing control-plane patch and test artifact transport.
- Hardened workspace identity propagation, Agent runtime setup, Worker CLI and update behavior, realtime activity events, and task execution audit data.

### Fixed

- Fixed project creation returning before its persisted state was written.
- Fixed Agent assignment and Mention directories exposing inaccessible Agents or losing the Agent's real identity and avatar in persisted comments and group chat.
- Fixed workspace execution paths mixing task, workspace, and workspace-session identities or creating new resources under synthetic and unknown directory scopes.

## [0.3.107 Preview] - 2026-07-21

### Added

- Added Feishu QR authorization and managed long connections for custom Agents, including automatic binding detection and an explicit disconnect-and-clear action.
- Added live Feishu reply cards that stream reasoning summaries, MCP and Skill calls, read/edit/run operations, tool results, and the final answer as one ordered timeline.
- Added bounded Feishu group and topic context enrichment so Agents can read recent messages and reply chains without mixing separate topics.
- Added external-channel conversations and transcripts to the owning Agent's conversation history.

### Changed

- Simplified Feishu Agent configuration by removing the retired outgoing Webhook field and supporting either QR binding or manual app credentials.
- Feishu group chats now respond only when the configured bot is mentioned, reply to the original message, and use a temporary processing reaction that is removed before the final response.
- Feishu topic replies now preserve thread-scoped conversation identities and stay inside the originating topic.
- Workspace group chat now preserves the active responder's Agent identity and avatar throughout streamed and persisted messages.

### Fixed

- Fixed external Agent conversations incorrectly reporting an offline executor when the configured executor belongs to a different visible owner.
- Fixed duplicate optimistic chat bubbles after the server persists an identical user message.
- Fixed Feishu binding dialogs remaining open after authorization and hardened inbound deduplication, bot-message filtering, and card-update fallback behavior.
- Fixed Railway health checks to use the readiness endpoint.

## [0.3.106 Preview] - 2026-07-21

### Added

- Added taskless workspace-session runtime adapters and lifecycle rules, including a Drizzle migration that removes the retired workspace-session binding column.
- Added Pi MCP bridge visibility so Wemux project, task, and workspace tools are available to Pi Agent Chat sessions as callable custom tools.

### Changed

- Reworked workspace creation, selection, and execution preparation around the workspace session rather than synthetic task records.
- Simplified model-profile management to use explicit worker imports instead of automatic model discovery.

### Fixed

- Fixed Pi Agent Chat incorrectly reporting that Wemux MCP tools were unavailable despite being mounted at runtime.
- Stabilized workspace session persistence, terminal recovery, preview routing, and task/runtime synchronization.

## [0.3.105 Preview] - 2026-07-15

### Added

- Added file-level workspace Git status and diff inspection, staging, unstaging, discarding, and staged-only commits through the worker execution path.
- Added taskless workspace-session execution identities so standalone workspace sessions no longer require synthetic task records.

### Changed

- Workspace-session history and runtime persistence now support sessions without a task binding, including the accompanying Drizzle migration.
- Zellij installation now verifies the extracted executable against the upstream checksum and removes invalid cached binaries after a mismatch.

### Fixed

- Fixed Preview transport switching so selecting a public preview domain preserves the current path while replacing a stale public IP and port origin.

## [0.3.104 Preview] - 2026-07-14

### Added

- Added retained workspace panels so switching among workspace views preserves local UI state while keeping only the most recent sixteen panel instances.
- Added shared read-only metadata for Wemux MCP query tools and safe headless Codex elicitation handling for trusted built-in read operations.

### Changed

- Workspace runtime environment saves now immediately materialize the effective env file into the active prepared workspace session directory.

### Fixed

- Prevented environment-file writes from creating or targeting an unprepared workspace directory.
- Preserved loaded Agent Chat history when streaming session summaries append new messages.

## [0.3.103 Preview] - 2026-07-13

### Changed

- Added accessible inline loading feedback when switching a workspace session to another execution node while keeping prompt editing available.

### Fixed

- Prevented messages and executor-dependent settings from being applied before a node switch finishes, and restored the previous node when switching fails.

## [0.3.102 Preview] - 2026-07-13

### Changed

- Removed the workspace live-port scanner and its control-plane API. Configured Preview sources remain available through the existing preview flow, without exposing unrelated worker or agent runtime listeners.

### Fixed

- Fixed waiting workspace previews reconnecting after the preview service is restored.

## [0.3.101 Preview] - 2026-07-12

### Added

- Added a more complete Worker CLI surface for node status, task operations, MCP access, and agent runtime management, alongside matching documentation and installer guidance.
- Added ordered worker task-event handling and workspace-session persistence safeguards so distributed task status, comments, and final session messages remain consistent across reconnects.
- Added task assignment to custom agents and Agent Chat support for selecting the assigned runtime.
- Added Drizzle migrations for agent task waiting state, task assignee agents, and worker event sequencing.

### Changed

- Simplified the web-to-server API path by removing the retired oRPC client/router layer and keeping current HTTP APIs as the integration boundary.
- Refined executor connection, task dispatch, workspace lifecycle, and cross-node synchronization paths for more reliable worker-driven execution.
- Updated documentation, onboarding, and pairing guidance for current worker service and runtime behavior.

### Fixed

- Fixed workspace session completion ordering and state synchronization so completion messages are retained after task summaries and reconnects.
- Fixed worker runtime command routing and browser/desktop sandbox helpers across local and preview execution modes.

## [0.3.100 Preview] - 2026-07-11

### Added

- Added persisted artifact storage, realtime storage-change propagation, and the accompanying Drizzle migrations for multi-node control-plane state.

### Changed

- Reworked executor placement, runtime labels, and control-plane synchronization so managed workers remain correctly routed across multi-node deployments.
- Expanded `/workspace` and execution views with direct local-worker discovery, resource state management, and richer executor diagnostics.
- Added project OpenCode workflow skills and CodeGraph configuration for the supported development environment.

### Fixed

- Hardened Coding Agent runtime configuration and model selection, including Codex startup errors, managed credential isolation, and compatibility with current runtime profile formats.
- Fixed workspace lifecycle and realtime state updates so task execution, previews, files, Git state, and presence remain synchronized after executor changes.

## [0.3.99 Preview] - 2026-07-09

### Fixed

- Fixed `/workspaces` initial directory rendering after deferred archived loading so active workspace cards no longer disappear before the archived query runs.
- Fixed `/workspaces` archived workspace section visibility so the archived summary toggle remains available while the page is still using the active-only directory cache.

## [0.3.98 Preview] - 2026-07-09

### 🔧 Improved

- **Better Auth schema Drizzle 化** — 将 Better Auth 的 user/session/account/verification 四张表纳入 Drizzle 统一管理，移除启动时自动迁移逻辑，强制通过 migration 流程版本化管理 auth DDL。

## [0.3.97 Production] - 2026-07-08

> v0.3.68 → v0.3.97 生产环境合并发布，涵盖 29 个预览版本。以下为面向用户的变更摘要。

### 🚀 New

- **Tauri 原生桌面客户端** — Wemux 开始支持脱离浏览器运行，新增 Tauri Shell 工作区和原生客户端检测，为桌面/移动端原生体验奠定基础。
- **AI 工作区会话自动命名** — 发送首条消息后，AI 自动生成有意义的会话标题，告别手动命名。
- **Coding Agent 可用性检测** — 配置模型前先检测 Codex、Claude Code、OpenCode、Pi 是否真正可用，支持逐 Agent 通过/失败详情面板，不再盲配。
- **公共终端网关** — 工作区终端支持远程访问，随时随地连接你的开发环境。
- **多端口预览** — 工作区支持同时暴露多个预览端口，一键切换，前后端联调更方便。
- **工作区在线成员头像** — 工作区卡片上实时显示当前在线成员，一眼看到谁在协作。
- **自定义 Agent 头像预设** — 新建自定义 Agent 时内置多款角色头像可选，无需手动粘贴 URL。

### 🔧 Improved

- 侧边栏项目按个人/工作区分组显示，结构更清晰。
- 终端传输方式下拉简化，"控制面"更名为"云端"。
- Docker 托管 Worker 支持空闲自动更新，无需手动干预。
- Agent Chat 自动遵循自定义 Agent 的默认执行器。
- 模型配置仅对通过可用性检测的 Agent 保存，避免出现不可用的模型选项。

### 🪟 Windows Worker 大幅稳定

本次发布对 Windows 平台 Worker 进行了全面加固，覆盖安装、启动、更新、网络、终端、Agent 运行全链路：

- 服务启动改用 `node.exe` 直接启动，替代不稳定的 `.cmd` shim。
- Startup 回退服务改用 Node 服务监控替代 PowerShell 长驻进程，更可靠。
- 自更新支持分阶段安装，解决文件占用导致的 `EPERM` 错误。
- Mesh 网络默认启用用户态网络栈，无需 TUN 适配器即可组网。
- 终端、MCP、Codex、Claude、OpenCode 全面适配 Windows shell 和路径。
- 安装说明明确为当前用户模式，无需管理员权限。

### 🐛 Codex 运行时修复

- 修复 Codex 配置文件丢失顶级 model/provider 键导致回退到内置订阅的问题。
- 修复 Codex 启动挂起，添加有界超时保护。
- Codex MCP 改用 worker 托管 stdio 桥接，解决 Windows 上远程 MCP 表不可用的问题。
- 适配 Codex 0.41.0 协议变更（`app-server` → `proto`）。

### 🌐 工作区与预览修复

- 修复协作工作区引导列回填、预览链接解析、分支标签同步等基础问题。
- 预览端口切换现在正确重置 iframe 状态，无需手动刷新。
- 工作区会话创建和排队消息恢复更可靠。
- 系统提示时间线在窄屏设备上的布局优化。

---

## [0.3.97] - 2026-07-08

### Added
- Added AI-powered workspace session title renaming after the first user message so sessions are easier to identify.
- Added public terminal gateway for workspace terminal access.
- Added `saveProjectWorkspaceAssignment` to app-state-store for targeted project-workspace binding persistence.

### Changed
- Simplified terminal transport dropdown UI and renamed 控制面 to 云端.
- Split sidebar projects by scope so personal and workspace projects display in distinct groups.

### Fixed
- Fixed collab workspace bootstrap columns backfill for existing workspaces.
- Fixed system prompt timeline layout on narrow screens.
- Fixed workspace preview links to resolve from the current source.
- Fixed premature preview share toast appearing before the share link was ready.
- Fixed workspace list collapse button removal.
- Fixed workspace branch label sync on focus.
- Added preview active indicator for running workspace previews.

## [0.3.96] - 2026-07-08

### Fixed
- Fixed additional preview-port bootstrap redirects so generated preview domains keep the current binding host after viewer-token exchange instead of bouncing back to the primary preview domain and returning `401 Preview Authorization Required`.
- Fixed `/workspace` and `/workspaces` preview source wiring so generated preview ports use the merged viewer access bindings returned by the active preview session.
- Fixed preview port switching to fully reset iframe bootstrap/navigation state when changing ports, so switching from the default preview port to another generated port no longer requires a manual refresh before the new app appears.

## [0.3.95] - 2026-07-08

### Added
- Added an initial `apps/native` Tauri shell workspace, root native dev/build scripts, and native-client detection so Wemux can start running in a native shell without the web service worker path.
- Added workspace-directory preview summaries and list-side preview address resolution so `/workspaces` can show the active remote preview domain for each generated preview port.

### Fixed
- Fixed local hybrid canonical host handling so login and local preview flows can converge on `app.wemux.localtest.me:15173` instead of drifting back to loopback-only browser origins.
- Fixed workspace preview port switching so each generated preview port reloads with its own preview domain/bootstrap URL instead of keeping the iframe pinned to the previously selected port.

## [0.3.94] - 2026-07-07

### Fixed
- Fixed the preview Docker image build failing with `No loader is configured for ".md" files` by adding a `.md` text loader to the esbuild server bundle so Vite `?raw` markdown imports pulled in through `apps/web/src/lib/marketing-content.ts` resolve correctly under `pnpm build`.

## [0.3.93] - 2026-07-07

### Added
- Added real Coding Agent availability checks for model profiles across Codex, Claude Code, OpenCode, and Pi, including per-agent pass/fail cards and a terminal-style log panel with model, execution model, latency, output preview, and failure details.
- Added shared preview source helpers and preview-panel source switching so workspaces can expose a default preview port plus additional generated preview ports.

### Changed
- Model profile bindings are now saved only for Coding Agents that pass the runtime smoke check, preventing unavailable agents from seeing unusable custom models in workspace model selection.
- Project and workspace environment preview networking now presents the default preview port separately from additional preview ports.

### Fixed
- Fixed provider/runtime smoke checks treating blocked provider output such as `403 Your request was blocked` as success.
- Fixed duplicate preview ports by validating project and workspace environment templates on both client and server.
- Fixed workspace session creation and queued chat draining so new workspace sessions stay attached to the selected running task and resume queued prompts for the correct task/session scope.

## [0.3.92] - 2026-07-07

### Added
- Added a structured SEO content system for public `blog`, `compare`, and `use-cases` pages, including shared content metadata, topic hubs, archive routes, and reusable rendering templates.
- Added a public blog post about Codex Handoff and persistent AI coding, along with supporting marketing assets.
- Added `feed.xml` generation for published blog content.
- Added `pnpm seo:check` and a dedicated SEO content validation script to catch missing markdown bodies, missing marketing images, duplicate metadata, empty topic clusters, and weak page metadata before release.
- Added validation for public SEO content and metadata.

### Fixed
- Fixed `dev` and `preview` branch drift by syncing the preview-only Codex alternate-protocol startup retry hotfix back into the main development line before promotion.
- Fixed public marketing SEO metadata generation to use the shared indexed-page registry and shared structured-content source instead of repeating one-off route definitions.
- Fixed Codex runtime `config.toml` losing top-level `model`/`model_provider` keys when they appeared after an `mcp_servers` table. `removeTomlTable` deleted the managed MCP table and swept up any root keys that followed it, so Codex fell back to the built-in OpenAI/ChatGPT subscription and returned `403 没有可用的 Codex 订阅`. Root keys are now hoisted ahead of all tables before writing.
- Fixed the custom agent identity avatar section so built-in avatars are presented in a smaller, more structured picker instead of a stretched form row dominated by the raw avatar URL field.
- Fixed custom agent sidebar avatars and role labels not updating after save by reading sidebar profile data from `config.customAgent` and forcing the agent-list refresh path to bypass the short-lived cache.

## [0.3.90] - 2026-07-06

### Added
- Added built-in custom agent avatar presets and template defaults so new agents can start with a recognizable role-specific image without manually pasting an avatar URL.

### Changed
- Hybrid local development no longer starts the docs dev server on port `3001` by default; set `HYBRID_ENABLE_DOCS=1` when local docs are needed.

### Fixed
- Fixed idle worker auto-update checks so paired workers can still self-update while temporarily disconnected from the control plane.
- Fixed service-managed npm worker updates on non-Windows systems by applying the staged prefix synchronously and restarting the platform service.
- Fixed macOS worker service restart so it bootstraps the LaunchAgent before kickstarting it.
- Fixed failed or non-applied worker update attempts getting stuck behind the same `lastNotifiedVersion`, allowing later update checks to retry.
- Fixed Codex startup hangs by adding bounded startup RPC timeouts for initialize, account read, thread start/resume, thread naming, and turn start.

## [0.3.89] - 2026-07-06

### Fixed
- Fixed Win11 Codex sessions still failing on `mcp_servers.mcp_wemux` by materializing the built-in Wemux MCP server as a worker-managed stdio bridge instead of a remote HTTP Codex MCP table.
- Added a `mcp-stdio` worker bridge command that forwards Codex MCP JSON-RPC over executor-authenticated `/mcp/executor` requests while keeping stdout protocol-clean.
- Hardened Codex MCP config rewriting so stale `mcp-wemux`, `mcp_wemux`, and nested env tables are removed before the managed stdio config is written.

## [0.3.88] - 2026-07-06

### Added
- Added an indexed public use-case page for managing multiple AI coding agents, including sitemap, SEO metadata, static export coverage, and marketing navigation.

### Changed
- Docker-managed workers now install into a persistent npm prefix, expose that prefix in `PATH`, and use the `docker` restart strategy so idle worker self-updates can be applied safely.
- Full and hybrid local dev scripts now automatically choose the next available docs port when the preferred docs port is already occupied.
- Agent Chat now honors a custom agent's default executor as the effective executor when a session has no explicit executor binding.

### Fixed
- Fixed remaining Win11 worker launch paths for Coding agents and utilities by wrapping `.cmd` / `.bat` shims through the Windows shell across Claude, Codex, OpenCode, Codex bootstrap checks, and remote code-server launch.
- Fixed Win11 terminal sessions receiving Unix interactive shell flags and falling back to `/bin/bash`; Windows terminals now use platform-appropriate shell args and `cmd.exe` fallback behavior.
- Fixed Windows `Path` casing issues in command lookup, terminal env creation, and worker update npm environments.
- Fixed Codex, Claude, and OpenCode runtime homes on Windows by exporting `USERPROFILE`, `APPDATA`, and `LOCALAPPDATA` into the worker-managed runtime home.
- Fixed Pi runtime skill path handling on Windows by using the platform path delimiter while retaining compatibility with legacy newline lists.
- Fixed workspace terminal local attach tickets losing the intended `cwd` before reaching the Win11 worker.

## [0.3.87] - 2026-07-05

### Fixed
- Fixed Windows current-user Mesh still attempting to create a TUN adapter after enabling `--use-smoltcp`; Windows workers now also pass `--no-tun` and skip the assigned `-i` address by default.
- Added `WEMUX_EASYTIER_NO_TUN` as an operator override for forcing or disabling no-TUN EasyTier startup.

## [0.3.86] - 2026-07-05

### Fixed
- Fixed Windows current-user Mesh startup failing with `tun device error Failed to create adapter` by enabling EasyTier's `--use-smoltcp` userspace stack by default on Windows workers.
- Added `WEMUX_EASYTIER_USE_SMOLTCP` as an override for operators who explicitly want to force or disable the userspace EasyTier stack.
- Fixed preview worker update checks getting stuck when npm registry metadata is unavailable or missing a dist-tag by falling back to the installer manifest served by the Wemux install endpoint.

## [0.3.85] - 2026-07-05

### Fixed
- Fixed worker-managed EasyTier Mesh startup by keeping `easytier-core` in the worker-owned foreground process instead of daemonizing it, preventing Windows nodes from reporting `127.0.0.1:15888` RPC connection refused after startup.
- Added Mesh RPC refusal detection and automatic worker-side Mesh restart so nodes can recover from a dead local EasyTier management endpoint without staying in `Mesh 异常`.
- Fixed service-managed worker auto-update defaults so Linux, macOS, and Windows installer-managed workers can apply idle updates through their service supervisor.
- Prevented manually-run workers from applying background auto-updates without a supervisor, avoiding the macOS case where the worker exits for an update and nothing restarts it.

## [0.3.84] - 2026-07-05

### Fixed
- Fixed Windows worker project terminal commands using `sh`, which caused `spawn sh ENOENT` during automatic install commands such as `npm install`.
- Fixed stdio MCP runtime config on Windows by wrapping commands with `cmd.exe /d /s /c` instead of `sh -lc`.

## [0.3.83] - 2026-07-05

### Fixed
- Fixed Windows Mesh EasyTier extraction passing empty PowerShell `$args` to `Expand-Archive`; archive and destination paths are now embedded as PowerShell literal strings.

## [0.3.82] - 2026-07-05

### Fixed
- Fixed Windows current-user worker self-update failing with `EPERM` when the running service still held files in the npm install prefix.
- Changed npm-prefix updates on Windows/service-managed workers to stage the new package, exit, stop the managed service from an external apply process, swap the install prefix, and then start the service again.

## [0.3.81] - 2026-07-05

### Fixed
- Fixed Windows worker Mesh auto-download requiring Linux `unzip`; Win11 workers now extract EasyTier release zips with PowerShell `Expand-Archive`.
- Updated Mesh remediation copy for Windows nodes so stale unzip errors explain the Windows restart/update path instead of showing Linux package-manager commands.

## [0.3.80] - 2026-07-05

### Fixed
- Fixed service-managed workers staying paired but offline when every local console port candidate is busy; daemon mode now keeps connecting to the control plane with the local console disabled instead of exiting.
- Added runtime state and terminal-direct guards for disabled local console mode so the worker does not advertise an unavailable local WebSocket endpoint.
- Hardened preview ingress config sync so local-console failures are logged and skipped instead of surfacing as unhandled startup work.

## [0.3.79] - 2026-07-05

### Changed
- Clarified Windows installation as current-user mode by default: it runs as the current Windows user, does not require administrator privileges, and starts when that user logs in.
- Updated Windows service status output to show mode, runs-as user, and whether admin privileges are required.

## [0.3.78] - 2026-07-05

### Changed
- Replaced the Windows Startup fallback long-running PowerShell supervisor with a Node-based service supervisor command (`service supervisor`) that launches and restarts the worker daemon directly.

### Fixed
- Fixed Windows fallback service startup depending on `worker-supervisor.ps1`, which could create a PowerShell process and then exit before the supervisor script wrote logs or started the daemon.

## [0.3.77] - 2026-07-05

### Fixed
- Fixed Windows Startup fallback service installs being marked failed before the supervisor script could write its own PID by recording the spawned PowerShell supervisor PID immediately.
- Increased Windows supervisor startup confirmation from 5 seconds to 15 seconds and applied the same running check to scheduled-task starts.

## [0.3.76] - 2026-07-05

### Fixed
- Added a Windows `supervisor-launch.log` layer that captures PowerShell startup output before the worker supervisor script itself begins running.
- Updated scheduled-task and Startup shortcut launches to invoke the supervisor through a PowerShell command wrapper that redirects launch-stage output into the service logs.

## [0.3.75] - 2026-07-05

### Fixed
- Improved Windows worker service diagnostics by rotating stale service logs before each startup attempt, writing supervisor lifecycle events to `supervisor.log`, and including recent service log tails directly in startup failure errors.
- Fixed npm worker self-update prefix detection to prefer the explicit `WEMUX_WORKER_INSTALL_PREFIX` set by the service environment, instead of relying only on executable-path inference.

## [0.3.74] - 2026-07-05

### Fixed
- Fixed Windows worker service startup by running `node.exe <worker-package>/bin/cli.mjs daemon` directly instead of launching the npm-generated `.cmd` shim from the service supervisor.
- Kept `WEMUX_WORKER_EXECUTABLE_PATH` pointed at the installed worker shim so updater and install-prefix detection continue to work while the service process uses the direct Node entrypoint.

## [0.3.73] - 2026-07-05

### Fixed
- Fixed Windows Startup fallback supervisor failing to keep the worker running when launching the npm `.cmd` shim; `.cmd/.bat` workers now run through `cmd.exe /d /s /c`.
- Added supervisor-side error logging for worker exit codes and startup failures so `service logs` shows why fallback startup failed.

## [0.3.72] - 2026-07-05

### Fixed
- Fixed Windows worker installer upgrades failing during `npm install` when the existing worker service still had files open; the installer now stops the old service and cleans stale worker/supervisor PIDs before installing.
- Improved Windows installer diagnostics by preserving npm output and including the npm exit code on package install failure.

## [0.3.71] - 2026-07-05

### Fixed
- Fixed Windows preview workers paired from a local hybrid control plane being redirected to `https://wemux.xyz`, which caused `executor token 无效` and kept the node offline.
- Fixed Windows Startup fallback service installs so non-admin worker installs start the supervisor immediately and report/control the fallback process through `service status/start/stop`.

## [0.3.70] - 2026-07-04

### Fixed
- Fixed hybrid dev environment Docker container startup — `dev-ensure-deps.sh` had CRLF line endings causing `/bin/sh: not found` in Linux containers.
- Fixed codex protocol compatibility — added version detection to support both old `app-server` and new `proto` subcommands across codex versions.

## [0.3.69] - 2026-07-04

### Fixed
- Fixed Windows worker codex auth probe timeout — codex 0.41.0 renamed `app-server` to `proto` and changed the JSON-RPC response format. Updated auth probe to detect `session_configured` message.

## [0.3.68] - 2026-07-04

### Fixed
- Fixed GA detection on the Dokploy-hosted production app by placing the Google tag directly in the base Vite/TanStack HTML template used by the Docker control-plane image.

## [0.3.67] - 2026-07-04

### Fixed
- Fixed GA detection on `www.wemux.com` by injecting the Google tag directly into exported Cloudflare static HTML immediately after `<head>`, while keeping SPA route-change page views in the client bundle.

## [0.3.66] - 2026-07-04

### Fixed
- Fixed Windows worker crash on startup — `spawn('codex.cmd')` and `spawn('opencode.cmd')` fail with EINVAL on Windows. Added `shell: true` for `.cmd` file spawn calls.

## [0.3.65] - 2026-07-04

### Fixed
- Fixed GA release builds by passing `VITE_GA_MEASUREMENT_ID` into both Cloudflare Pages and Docker control-plane build environments, ensuring deployed `www.wemux.com` HTML includes the Google tag.

## [0.3.64] - 2026-07-04

### Added
- Added Google Analytics 4 tracking for the Wemux web app using `VITE_GA_MEASUREMENT_ID=G-KHSGWBC0DV`, with root-level Google tag injection and SPA route-change page views.

### Changed
- Documented the GA measurement ID in local, hybrid, Cloudflare Pages, and production environment configuration examples.

### Fixed
- Fixed GA route-change tracking to use TanStack Router's string search representation, preventing the root app shell from crashing when the router search object is present.
- Fixed Windows service install failing with "Access Denied" for non-admin users — now falls back to a Startup folder shortcut when scheduled task creation requires elevation.

## [0.3.63] - 2026-07-04

### Fixed
- Fixed Windows service install failing with "Invalid XML format" — replaced `schtasks.exe /Create /XML` with PowerShell `Register-ScheduledTask` to avoid XML encoding issues on non-English Windows locales.

## [0.3.62] - 2026-07-04

### Fixed
- Fixed Windows `shell: true` breaking `node -e` arg quoting — cmd.exe strips embedded double quotes. Changed to retry-with-shell pattern: try without shell first, only retry on ENOENT/EINVAL.

## [0.3.61] - 2026-07-03

### Fixed
- Fixed Windows worker bootstrap failing to detect opencode runtime — `spawnSync` cannot execute `.cmd` files without `shell: true` on Windows.
- Fixed Windows worker auto-update failing to run `npm.cmd` — same `spawnSync` shell issue.
- Fixed Windows installer build failing — `npm pack` via `spawnSync` needs `shell: true` on Windows.
- Fixed Windows installer build intermittent EBUSY errors on temp directory cleanup — added retry logic.

## [0.3.60] - 2026-07-03

### Fixed
- Fixed Windows worker installation failing with "binary not found" — `npm install -g --prefix` places `.cmd` shims in the prefix root, not the `bin/` subdirectory; installer script and node-wrapper now check both locations.

## [0.3.59] - 2026-07-02

### Added
- Added skill version management with automatic version snapshots on content change and version history API.
- Added skill categories (tags) with normalized storage and up to 24 categories per skill.
- Added skill security audit scanning for dangerous shell commands, script patterns, and oversized files during import.
- Added MCP server validation and `POST /api/mcp/test` endpoint for connection testing.
- Added custom agent `defaultExecutorId` field so agents can specify a preferred executor node.
- Added executor selector (ExecutorSelect) to the main chat panel for runtime executor switching.
- Added CodexDesktop adapter with RPC transport support.
- Added workspace owner name and avatar display in the workspace table overview.
- Added per-workspace environment start/stop controls in the workspace table panel.

### Changed
- Executor disconnect now immediately aborts pending prompts instead of preserving them for reconnection.
- Removed local fallback reply logic from main chat (project creation, task management shortcuts) — all interactions go through the executor agent.
- Runtime settings types now carry `_runtime` discriminator field for type-safe runtime identification.
- Deprecated `RuntimeId` in favor of unified `AgentType`.
- Extracted shared utilities (`isRecord`, `createStableId`, `inferMcpTransport`) to `packages/shared/src/utils.ts`.
- Main chat executor reply now has a 5-minute server-side timeout.
- Workspace table status pills simplified (removed dot indicator, pure color blocks).
- PR badges in workspace table now use shared `TaskPullRequestBadge` component.
- Model profile runtime settings normalization uses type guards instead of `as` casts.

### Fixed
- Fixed workspace table environment actions to operate per-workspace instead of globally.
- Fixed workspace mobile back navigation to use state update instead of `window.history.back()`.

## [0.3.58] - 2026-07-02

### Added
- Added Docker full-stack dev environment with `docker-compose.dev-full.yml` for one-command local development.
- Added dev-only auto-pair endpoint (`POST /api/control-plane/executors/auto-pair`) so Docker workers connect automatically on startup.
- Added `WEMUX_WORKER_SKIP_RUNTIME_GUARD` environment variable to skip runtime checks in Docker dev containers.
- Added paired executor count display in sidebar navigation with amber indicator.

### Fixed
- Fixed team-scoped executor visibility so executors with empty workspace IDs are visible to all team members.

### Changed
- Updated competitor analysis and marketing playbook documentation.

## [0.3.57] - 2026-06-29

### Added
- Added a public terminal gateway transport for public-ingress executors, allowing terminal WebSockets to connect through the worker public ingress with one-time attach tickets instead of always falling back to the control-plane Tunnel.

### Changed
- Renamed workspace Preview transport labels to distinguish `公网预览域名` from `隧道预览域名`, and made public-IP direct Preview an external-open path with a clear explanation instead of embedding unsafe HTTP IP pages inside the HTTPS console.
- Changed terminal transport selection to expose `公网终端入口` separately from `本地连接` and `控制面 Tunnel`, with latency probing and manual selection in the terminal transport menu.

### Fixed
- Fixed terminal auto transport selection so failed or still-probing local/Mesh routes no longer get repeatedly reselected after falling back to Tunnel.
- Fixed worker WebSocket proxy close handling so invalid close codes from upstream sockets are normalized before being forwarded.

## [0.3.56] - 2026-06-29

### Changed
- Changed Preview domains to use short stable six-character hashes, reducing generated hostnames such as `test-preview--0cd54989-1394-4fbe-aaab-f1416d7d01f2.wemux.xyz` to compact names like `test-preview--6g3ove.wemux.xyz`.
- Split workspace Preview transports into explicit `公网 IP 直连`, `Public Access`, `Mesh Bridge`, and `Tunnel` choices so public nodes expose both direct IP access and Wemux-domain public ingress clearly.

### Fixed
- Fixed public-ingress executors so opening Preview replaces stale Tunnel sessions with Public Access sessions instead of continuing to reuse the old tunnel path.

## [0.3.55] - 2026-06-29

### Fixed
- Fixed workspace Preview after executor switching so the preview cache and current-preview lookup are scoped to the selected executor, preventing the UI from continuing to show an old node's preview after switching to a new node that has not started Preview yet.

## [0.3.54] - 2026-06-29

### Fixed
- Fixed workspace-only preview/worktree sessions so switching executors records the node-switch system message and starts the new executor workdir preparation flow, matching original-directory workspace behavior.
- Fixed workspace-only executor switching to resolve only explicit `workspace-session:<sessionId>` virtual task keys, while preserving normal errors for unknown real task ids.

## [0.3.53] - 2026-06-29

### Added

### Changed
- Changed `/workspaces` system timeline rendering so workspace history system messages and executor-switch events share one timestamped compact rail, keeping node switches and worktree preparation logs in order.
- Changed worker worktree preparation to reuse an existing matching workspace worktree when possible, preserving `node_modules`, local caches, and untracked files across executor switches.

### Fixed
- Fixed scoped workspace task log stripping so executor-switch system logs are preserved for workspace-session display.
- Fixed workspace session system log filtering so logs are scoped by both workspace and workspace session, preventing cross-session noise.

## [0.3.52] - 2026-06-29

### Fixed
- Fixed newly created workspace-only sessions so their queued first prompt resumes automatically after worktree preparation instead of getting stuck after the user message is persisted.

### Changed
- Updated the competitor watch library and 2026-06-29 daily note to add `NewMax` as a new local-first AI workbench sample for ongoing tracking.

## [0.3.51] - 2026-06-29

### Fixed
- Fixed worker daemon startup self-check to auto-install all missing agent runtimes (Codex CLI, Claude Code CLI, Pi runtime) instead of only checking base dependencies (git, unzip, opencode).

## [0.3.50] - 2026-06-29

### Fixed
- Fixed worker update staging directory leak that caused disk exhaustion: failed or interrupted updates left ~557MB staging/backup directories behind, accumulating up to 75GB over time. Added cleanup on failure and automatic stale directory removal before each update.

## [0.3.49] - 2026-06-29

### Fixed
- Fixed worker auto-update so the staging install, prefix swap, and service restart all complete synchronously before process exit, preventing systemd cgroup cleanup from killing the background update child process before it finishes.
- Fixed `curl`-installed preview worker auto-update by checking the installer manifest on the connected server when npm dist-tag checks are disabled.

### Added
- Added macOS launchd service test coverage for keepalive and environment variable injection.

## [0.3.48] - 2026-06-28

### Fixed
- Fixed newly created workspace sessions so the first prompt submitted from `/workspace` is persisted into the workspace session transcript while the worktree is still preparing.
- Fixed preview worker update discovery to use the installer manifest fallback when npm package update metadata is disabled or unavailable.

### Added
- Added coverage for deferred workspace initial prompt transcript persistence and preview worker installer-manifest update checks.

## [0.3.47] - 2026-06-28

### Changed
- Workspace creation without a `taskId` no longer persists a throwaway task record; a virtual workspace-session task key is used instead.
- Project settings sync now overwrites the stored `.env` runtime environment with the latest local file content instead of only importing when empty.
- Moved the preview panel cookie access warning from a full-width banner to a compact dropdown icon in the toolbar.

### Added
- Added test coverage for sync-triggered runtime environment overwrite.

## [0.3.46] - 2026-06-28

### Fixed
- Fixed `curl`-installed worker auto-updates so replacing the npm install prefix preserves the generated service node wrapper used by systemd.
- Added a packaged `*-node-wrapper` fallback bin so older workers updating into this release still leave the service `ExecStart` path available after the prefix swap.

## [0.3.45] - 2026-06-28

### Changed
- Simplified the worker pairing and executor network-type helper copy so the add-executor flow is less cluttered while keeping the required network and pairing choices visible.

## [0.3.44] - 2026-06-28

### Fixed
- Fixed preview worker release publishing so the npm package and bundled `curl` installer use the same `0.3.x-preview.<sha>` version suffix, preventing freshly installed workers from reporting a false `待更新` state for the same build.

## [0.3.43] - 2026-06-28

### Fixed
- Fixed manual and automatic npm worker updates from `curl`-installed nodes whose shell does not have the nvm Node directory on `PATH`, preventing `spawnSync npm ENOENT`.
- Changed the Unix worker installer wrapper to prepend the resolved Node.js bin directory to `PATH` before launching the worker command.

## [0.3.42] - 2026-06-28

### Fixed
- Fixed preview worker daemon startup so `curl`-installed workers do not attempt an automatic npm self-update before their first successful control-plane connection.
- Fixed idle auto-update scheduling so the default auto-update policy stays enabled, but only runs after the worker is both cloud-connected and fully idle.

## [0.3.41] - 2026-06-28

### Fixed
- Fixed service-managed worker auto-update to explicitly restart the configured system service after the staged npm package swap, so `curl`-installed preview workers actually switch to the newly detected preview version instead of remaining stuck on `待更新`.

## [0.3.40] - 2026-06-28

### Changed
- Changed the Unix worker installer to verify the local worker health endpoint reports `connected: true` after service installation before printing the final connected success summary.
- Changed installer failures after service startup to clearly report that the worker was installed but not confirmed connected, including service status, service logs, and local health diagnostic commands.

## [0.3.39] - 2026-06-27

### Fixed
- Fixed manual `wemux-worker-preview update` from an interactive shell so npm-installed workers can infer their install prefix from the installed package layout instead of requiring service-only environment variables.
- Fixed manual worker updates to restart the configured system service after applying the staged package, so the running process switches to the updated worker version.
- Changed the Unix installer wrapper to export the worker executable path and install prefix, giving future CLI commands the same install context as the service process.

## [0.3.38] - 2026-06-27

### Changed
- Changed the Unix worker installer to create a global `/usr/local/bin/<worker>` command shim when running as root or with passwordless sudo, while still keeping the per-user `~/.local/bin` shim as a fallback.
- Changed the Unix installer success output to show the global command path when available and include both `update` and `update --check` commands so operators can distinguish applying an update from only checking for one.

## [0.3.37] - 2026-06-27

### Fixed
- Fixed Linux worker reinstalls and updates so service installation restarts an already-running user systemd worker service after writing the unit, ensuring the running process switches to the newly installed worker version instead of staying one release behind.

## [0.3.36] - 2026-06-27

### Fixed
- Fixed Unix worker installs on fresh Linux hosts by checking and installing `unzip` in the public installer before worker runtime bootstrap starts, with clear package-manager commands and captured failure output when automatic installation cannot complete.
- Fixed command failure reporting so failed bootstrap commands prefer stderr over harmless stdout, preventing apt failures from being hidden behind messages like `Reading package lists...`.

## [0.3.35] - 2026-06-27

### Fixed
- Fixed Unix worker installs on nvm-provisioned hosts so the service and command shim use a generated Node wrapper with the resolved Node.js executable, preventing `service logs` and `service status` from failing with `/usr/bin/env: 'node': No such file or directory`.
- Added a clearer Unix installer success summary that states the worker is installed, paired to the cloud URL, and starting as a system service.

## [0.3.34] - 2026-06-27

### Changed
- Changed executor Mesh error displays to show actionable remediation guidance for missing `unzip`, including a copyable Linux package-manager command and the advanced EasyTier binary environment-variable fallback.
- Changed Linux worker runtime bootstrap to treat `unzip` as a base dependency, so fresh Linux workers can install it before Wemux Mesh attempts automatic EasyTier downloads.

## [0.3.33] - 2026-06-27

### Changed
- Changed the worker installer deployment checks to verify the generated manifest and bootstrap path before release.

## [0.3.32] - 2026-06-27

### Changed
- Changed the Unix worker installer to automatically install and load `nvm` when Node.js 22 is missing, allowing fresh Linux hosts to continue through Node.js 22 setup without manual pre-install steps.

## [0.3.31] - 2026-06-27

### Changed
- Changed the public worker install entrypoints to print the current worker package version at startup, including the Unix `/install` bootstrap alias, the Unix `/install/worker.sh` installer, and the Windows PowerShell installer.
- Changed installer startup output to include the installer commit SHA when the packaged manifest provides it.

## [0.3.30] - 2026-06-27

### Changed
- Changed the public Unix worker install alias to download and execute `/install/worker.sh` from a temporary file before running the real installer, instead of streaming the full installer body through the original `curl | bash` pipeline.

### Fixed
- Fixed Unix worker install failures on fresh machines so a missing Node.js 22 runtime no longer leaves the misleading `curl: (23) Failed writing body` noise after the installer exits with the intended recovery guidance.

## [0.3.29] - 2026-06-27

### Changed
- Changed the main web app update toast to render in the bottom-right corner with a slightly narrower max width so persistent refresh prompts stay less intrusive on smaller screens.
- Changed Docker worker installer preflight failures on Linux hosts to recommend starting the Docker daemon instead of always pointing users at OrbStack or Docker Desktop recovery steps.

### Fixed
- Fixed the local worker installer Node.js recovery output so missing-Node failures no longer crash while printing the `nvm` quick-fix commands under `set -u`.
- Fixed Docker worker installer failures on fresh hosts to report a missing Docker CLI before trying to inspect the current daemon context.

## [0.3.28] - 2026-06-26

### Added
- Added compact `/workspaces` node-switch timeline hints so executor changes are visible before the follow-up worktree preparation messages without overwhelming the chat.
- Added missing-command diagnostics for workspace install/start commands, including explicit guidance when a Docker Worker or node is missing `pnpm`.
- Added worker console port helpers and development port profiles for local, hybrid, and preview worker runs.

### Changed
- Changed managed Docker Worker runtime images to include the base runtime toolchain with `pnpm`, matching the project templates generated by workspace demos.
- Changed `/workspaces` preview state handling so preview panels stay cached per task/workspace and iframe reloads ignore transient viewer-token and transport query changes.
- Changed workspace worktree preparation flows to write timeline events from ensure-worktree, branch-switch, and environment-start preparation paths.
- Refined workspace session chat, terminal, settings, and list presentation for denser operational workflows.

### Fixed
- Fixed executor switching and environment startup paths so target-node worktree preparation is visible and reused before running workspace commands.
- Fixed workspace preview refresh behavior that could repeatedly reload tunnel previews after transport metadata changed.
- Fixed old or incomplete tool-call rows so interrupted workspace replies no longer remain displayed as actively running.
- Fixed project/workspace settings sync so `.wemux.yml` and workspace runtime environment files can be re-imported from the active workspace directory.

## [0.3.27] - 2026-06-21

### Changed
- Compressed the mobile `/workspaces` list header and card layout so workspace sessions use less fixed vertical space on phone-sized screens while keeping session metadata visible.

### Fixed
- Fixed initial workspace chat launches so the first prompt is removed from the queue once it has been persisted to the workspace conversation.
- Fixed workspace chat queue display so queued messages already rendered as user turns no longer remain visible as stale "pending send" items.

## [0.3.26] - 2026-06-20

### Changed
- Changed `/workspaces` list cards to keep the active session preview, branch/worktree labels, executor badge, summary text, and default click target aligned around the same representative workspace session.

### Fixed
- Fixed `/workspaces` pull request badges so workspace-scoped and workspace-session-scoped PRs stay visible even when list focus changes or a different session branch becomes the card's fallback context.

## [0.3.25] - 2026-06-20

### Added
- Added image-aware workspace title suggestion requests so workspace creation can send prompt text plus an uploaded image to the OpenRouter title helper before the workspace is created.
- Added OpenCode runtime skill materialization into each workspace `.opencode/skills` directory so built-in skills are immediately available inside OpenCode runs without relying on temporary prompt roots.

### Changed
- Changed project and workspace settings shells to use a compact full-height drawer layout on constrained screens while preserving the desktop split-panel dialog layout.
- Changed `/workspaces` drag-and-drop ordering so project and workspace drop preview slots accept direct drops and merge partial workspace reorder payloads back into the full project ordering safely.
- Changed workspace session feeds to interleave system logs and transcript turns by timestamp while keeping the active running turn pinned after newer preparation logs.
- Changed workspace session defaults to enable the built-in Wemux MCP server automatically when a new workspace session is created.

### Fixed
- Fixed `.wemux.yml` reimport so Wemux can import service-based templates that define runtime commands under `services.*.command`, `services.*.port`, and `services.*.healthCheck.path`, instead of only recognizing the older `environment:` schema.
- Fixed workspace auto-title generation so AI naming only runs for system-titled workspace creation flows, carries image context through the API, and falls back with a visible notice when OpenRouter naming is unavailable.
- Fixed `/workspaces` list rows and chat helpers so project identity dots, Skill Mention helper copy, and default MCP selection stay aligned with the current workspace session behavior.

## [0.3.24] - 2026-06-20

### Added
- Added workspace-session pull request delivery summaries so workspace sessions can persist GitHub PR state and branch metadata alongside runtime state.

### Changed
- Updated `/workspaces` delivery aggregation to include workspace-session delivery summaries when building workspace-level pull request badges and review entries.
- Updated workspace-session delivery cards and list rows to surface created pull requests directly from session delivery metadata or agent output, including PR state, number, branch, and open-link affordances.

### Fixed
- Fixed workspace-session result handling so agent-created GitHub pull request URLs are promoted into structured delivery results instead of being left as plain assistant text.

## [0.3.23] - 2026-06-19

### Fixed
- Fixed workspace-session history persistence so `workspace_session_history_turns` schema creation and upgrade both add the `usage_json` column required by workspace chat turn writes, preventing immediate send failures against partially upgraded Postgres databases.

## [0.3.22] - 2026-06-19

### Added
- Added a Windows-specific worker install path across worker install APIs, onboarding, execution surfaces, and worker docs so Windows nodes receive the correct setup command and guidance.

### Fixed
- Fixed `/workspaces` workspace-session chat so user messages are persisted before workspace directory preparation and executor dispatch, allowing retries to keep the failed turn in handoff history instead of dropping it from later workspace replies.
- Fixed workspace-session history persistence so a running user turn can merge later assistant and status events into the same persisted turn without duplicating transcript records.

## [0.3.21] - 2026-06-18

### Fixed
- Fixed `/workspaces` workspace-session chat hydration so empty persisted history no longer leaves the transcript surface hidden after the history request completes.
- Kept workspace-session chat history loading on the workspace-session history API path instead of falling back to task conversation history.
- Fixed worker auto-update shutdown so update-triggered exits are retained until the daemon shutdown hook is ready and the process exits after update shutdown completes.

## [0.3.20] - 2026-06-18

### Fixed
- Fixed `/workspace` mobile back navigation so returning from a workspace session preserves the workspace list context instead of dropping users into the wrong selection state.
- Fixed the `/workspace` chat executor selector so expanding the node menu still shows offline executors, making the current assigned offline node visible instead of hiding it behind an online-only list.

## [0.3.19] - 2026-06-17

### Changed
- Reworked `/workspace` transcript loading so persisted `workspace_session_history_events` are the single history source for workspace session hydration, refresh, pagination, and websocket replay.
- Split workspace transcript pagination from legacy conversation pagination in the workspace chat client, making load-more, outline navigation, and scroll restoration use separate mode-specific paths.

### Fixed
- Fixed workspace history visibility handling so transcript chat feeds no longer surface diagnostic lifecycle events that belong to preparation and cleanup internals.
- Fixed workspace transcript rendering so persisted user turns keep their recorded authors without relying on legacy conversation backfill logic.

## [0.3.18] - 2026-06-17

### Fixed
- Fixed `/workspace` queued-message removal so WebSocket acknowledgement failures fall back through HTTP and stale runtime snapshots can still remove queue items without rolling back newer running-state metadata.

## [0.3.17] - 2026-06-17

### Added
- Added a new pure black-and-white Wemux logo and favicon set, plus simplified branding variants for comparing small-size icon readability.

## [0.3.16] - 2026-06-17

### Added
- Added template-driven additional preview ports through `.wemux.yml` `environment.ports`, allowing API, docs, Storybook, and other local services to receive separate Preview/Public Networking domains without authoring localhost URLs.

### Changed
- Changed environment templates to use `start`, `stop`, `logs`, `appPort`, and `healthPath` as the primary project runtime model, with `healthPath` resolved on the primary app port.
- Updated project and workspace environment template editors, MCP input, server normalization, and the built-in Wemux YML authoring guidance around the new port-oriented model.
- Removed the separate workspace terminal `dev` quick command so start/stop/logs use one consistent environment control path.
- Simplified the project clone status badge loading indicator to use the standard spinner styling.

### Fixed
- Fixed workspace environment template save and reimport flows so toolbar actions immediately use the newly saved command and port metadata.
- Fixed workspace history fallback so system-only runtime history no longer hides legacy conversation messages.

## [0.3.15] - 2026-06-17

### Changed
- Changed `/workspace` chat mention insertion so selecting `@项目` or a project/file context suggestion keeps the token inline at the current caret position instead of moving the reference into a separate composer prefix row.

### Fixed
- Fixed workspace chat message sending so selected project and file context refs survive the actual submit path and are still attached when the message is dispatched.
- Fixed workspace chat project mentions so inline `@项目` and named project mentions remain visible in the sent message while still being resolved into context refs for prompt enrichment.

## [0.3.14] - 2026-06-16

### Changed
- Refined the `/workspace` terminal transport dropdown with a cleaner status summary, calmer compact trigger styling, clearer current-route highlighting, and a dedicated unavailable section that is easier to scan.
- Replaced full raw terminal transport WebSocket URLs in the dropdown body with compact readable endpoint summaries so long local-direct and remote transport addresses no longer dominate the menu layout.

## [0.3.13] - 2026-06-16

### Added
- Added task attachment uploads for workspace conversations, including task-scoped storage, sanitized filenames, non-image attachment chips in the composer, and downloadable file rows in message transcripts.
- Added quick `全选` / `反选` project-filter controls in the `/workspaces` project visibility popover.

### Changed
- Refined the workspace session composer so selected context stays inline with the input while queued state, mentions, and attachments only render their extra rows when needed.

### Fixed
- Fixed the new sidebar and `/workspaces` drag-preview interactions so native drag-and-drop still starts reliably before the dragged row collapses into its animated placeholder slot.

## [0.3.12] - 2026-06-16

### Changed
- Refined app sidebar and `/workspaces` drag-and-drop interactions with before/after project placement, animated drop previews, and no-op reorder detection.
- Moved selected workspace chat context chips into the composer input line so selected project and file context stays visible without taking extra composer height.
- Added preview cookie-access warnings for loopback, raw IP, `nip.io`, and external preview origins that can break hosted preview cookie access.

### Fixed
- Fixed workspace executor switching so worktree readiness is verified on the target node before chat or environment startup trusts a prepared directory.
- Fixed derived workspace provisioning so workspace-level environment templates and runtime environment variables are copied alongside model profiles, skills, and MCP settings.
- Fixed workspace environment startup so missing original-dir and worktree directories on the selected executor are prepared before running the start command.

## [0.3.11] - 2026-06-16

### Fixed
- Fixed workspace terminals opened through Local Direct so stale “terminal was open before restart” workspaces now recreate the worker-side terminal session before issuing a new local attach ticket, instead of failing with `终端会话不存在。`.

## [0.3.10] - 2026-06-16

### Changed
- Refined the workspace terminal close-confirm popover buttons so cancel and destructive actions share a calmer terminal-panel visual treatment while keeping the close intent obvious.

### Fixed
- Fixed workspace terminal reconnects so stale control-plane terminal-session cache entries are recreated automatically when the worker has already dropped the underlying session, instead of failing with `终端会话不存在。`.

## [0.3.9] - 2026-06-16

### Changed
- Expanded `/workspaces` conversation hydration and workspace session history paging so recent chat context loads in larger pages and backward pagination keeps complete turns together instead of cutting into partial assistant replies.
- Refined the workspace session composer layout by moving selected project and file context chips into the composer shell header area for a tighter input region.

### Fixed
- Fixed workspace conversation and persisted workspace-session history pagination so loading older records includes the full leading turn on backward pages.
- Fixed preview panels so stale preview connection errors are hidden after the iframe and connection have recovered successfully.
- Fixed OpenCode session inactivity detection so long-running sessions with ongoing streamed or snapshotted activity no longer fail after a fixed 120-second wall-clock timeout.

## [0.3.8] - 2026-06-16

### Changed
- Changed manual workspace environment start, stop, and logs actions to always open the workspace terminal and send the configured command there, matching the existing `pnpm dev` terminal-first behavior for long-running processes.
- Kept install commands as the background-friendly path while making runtime lifecycle commands visible and controllable from the terminal.

### Fixed
- Fixed configured Docker Compose-style environment templates so clicking the workspace run button no longer executes start/stop/logs through the background environment action path.

## [0.3.7] - 2026-06-15

### Added
- Added `{{environment.slug}}` as a stable command-safe environment template variable for naming external runtime resources such as Docker Compose projects without making Wemux own Docker-specific behavior.
- Added a transport architecture state document covering Local Direct, Mesh Direct/Relayed, Public Gateway, Tunnel, Control-plane WS, terminal routing, preview routing, AI realtime, and Desktop Sandbox boundaries.

### Changed
- Updated environment template authoring guidance and the template editor helper copy to recommend `{{environment.slug}}` for external resource names while keeping Docker Compose naming in user-provided commands.

### Fixed
- Fixed workspace environment template inheritance so empty workspace override fields fall back to project template values instead of masking start/stop/logs/preview settings.

## [0.3.6] - 2026-06-15

### Added
- Added syntax highlighting and invalid-line coloring for runtime environment variable editors so `.env` input is easier to scan and fix.

### Changed
- Aligned project-level and workspace-level environment template settings around the simpler project template fields, including install/start/stop/logs/health commands and Public Networking bindings.

### Fixed
- Fixed workspace environment template import so workspace-scoped imports read from the selected workspace session worktree instead of only checking the original repository path.
- Fixed Public Networking editor contrast in dark surfaces so field text and helper copy stay readable.

## [0.3.5] - 2026-06-15

### Fixed
- Fixed Agent 工作区消息排队 so messages sent while a coding agent is already running stay visible in the queue instead of briefly appearing in the transcript and then disappearing after optimistic state is rolled back.
- Fixed workspace-session chat snapshot merging so a stale runtime snapshot can no longer discard newly queued messages for the same workspace session.

## [0.3.4] - 2026-06-15

### Added
- Added worker mesh diagnostics for stale macOS helper enrollment so nodes can report when EasyTier is still using an old Mesh IP after the control plane assigned a new workspace subnet.
- Added a node-management `Mesh 配置待应用` state with the helper refresh command for macOS nodes that need to apply the latest backend mesh enrollment.

### Fixed
- Hardened macOS `mesh install-service` by clearing plist extended attributes, validating ownership and permissions, removing stale launchd registrations, and returning detailed bootstrap diagnostics when launchd rejects the service.

## [0.3.3] - 2026-06-15

### Added
- Added a macOS EasyTier mesh supervisor so the root helper automatically restarts EasyTier when the backend sends a new mesh enrollment, allowing Mesh IP changes to converge after the initial helper install.

### Fixed
- Fixed API error extraction so Cloudflare and generic HTML gateway pages show concise service-unavailable messages instead of raw HTML.

## [0.3.2] - 2026-06-15

### Fixed
- Fixed macOS EasyTier helper reinstall so `mesh install-service` unloads the existing LaunchDaemon label before bootstrapping the rewritten plist, allowing changed Mesh IP enrollment to take effect.

## [0.3.1] - 2026-06-15

### Fixed
- Fixed EasyTier worker enrollment so nodes bound to the same workspace receive addresses in the same mesh `/24`, regardless of whether their preview path is public or private.
- Fixed mesh route eligibility so workers that share a workspace can use direct or relayed mesh routes even when they belong to different owners.

## [0.3.0] - 2026-06-15

### Changed
- Refined the node-management Mesh UI so topology lines stay connected on wide layouts, implementation details are hidden behind Wemux Mesh wording, and remediation prompts give clearer terminal-command guidance.

## [0.2.82] - 2026-06-15

### Added
- Added a build-id backed web version manifest and client-side preview update detection so deployed users can be prompted to refresh when a newer build is available.

### Changed
- Refined the executor mesh visualization and detail surfaces to share one EasyTier display model, hide local self peers from remote peer counts, and show a clearer joined-without-peers state.

### Fixed
- Fixed executor removal so deleting a worker from the control plane can clear local pairing and request the worker process to shut down instead of reconnecting with stale credentials.

## [0.2.81] - 2026-06-15

### Fixed
- Fixed EasyTier mesh status parsing so workers report Mesh IP, hostname, NAT type, and peer id from EasyTier's node identity table output.

## [0.2.80] - 2026-06-15

### Fixed
- Fixed macOS mesh helper installs so the unprivileged worker reuses an existing matching EasyTier runtime through the RPC portal instead of spawning a duplicate process that collides on the same port.

## [0.2.79] - 2026-06-15

### Fixed
- Fixed the embedded and sidecar EasyTier public node startup so preview and production relays run as shared public nodes without worker network credentials, matching EasyTier's public-node model and allowing per-user worker meshes to connect through the relay.
- Updated EasyTier deployment docs to clarify that `WEMUX_EASYTIER_NETWORK_PREFIX` and `WEMUX_EASYTIER_NETWORK_SECRET` are used for worker enrollment, not for placing the shared relay into a user network.

## [0.2.78] - 2026-06-15

### Added
- Added a worker `mesh` command for macOS EasyTier helper installation, status checks, and uninstall so only the mesh helper needs elevated TUN access instead of running the whole worker with `sudo`.
- Added node-management remediation hints and copyable helper-install commands when a macOS worker reports EasyTier TUN permission failures.

### Fixed
- Fixed worker mesh startup diagnostics so the original EasyTier process failure is preserved instead of being replaced by a later RPC connection error.

## [0.2.77] - 2026-06-15

### Changed
- Changed generated Docker worker commands to preflight Docker daemon availability and print OrbStack / Docker Desktop recovery hints before running container commands.

## [0.2.76] - 2026-06-15

### Changed
- Changed the curl worker installer to create a user-level `~/.local/bin` command shim and print shorter follow-up commands when available.

## [0.2.75] - 2026-06-15

### Changed
- Changed the curl worker installer to print a welcome and first-run duration hint immediately when the Bash script starts.

## [0.2.74] - 2026-06-15

### Fixed
- Fixed the curl worker installer on macOS Bash so installs without `--name` no longer fail with an unbound `NAME_ARGS` variable.
- Added visible installer progress output for runtime checks, downloads, npm install, bootstrap, pairing, and service installation.

## [0.2.73] - 2026-06-15

### Fixed
- Fixed preview and production control-plane images so the curl worker installer endpoints include the generated installer manifest and package artifacts after deployment.

## [0.2.72] - 2026-06-14

### Fixed
- Fixed `/workspaces` workspace-session chat so the Coding Agent "working" bubble stays visible immediately after a user sends a message, instead of being removed by stale session snapshots until the final reply arrives.
- Fixed workspace-session realtime, REST, and cached session hydration to preserve a newer optimistic running runtime over older completed snapshots while still accepting the real completed snapshot for the current turn.

## [0.2.71] - 2026-06-14

### Added
- Added worker service-management commands for install, uninstall, start, stop, restart, status, and logs, backed by macOS LaunchAgent and Linux user-systemd implementations.
- Added a curl-based worker installer route with manifest and package download endpoints so preview and production installs can register a service from one generated command.
- Added a generic worker-installer build script and wired preview / production deployment workflows to build worker installer artifacts.
- Added installer route, worker command, and CLI flag tests covering service install script generation and Docker/local connect commands.

### Changed
- Changed local and Docker worker connection commands to use the unified curl installer path instead of exposing `npx` as the official runtime entry.
- Changed worker auto-update so service-managed installs stage the new npm package, exit the old daemon, atomically replace the install prefix, and rely on launchd/systemd or Docker restart policy to start the new version.
- Updated execution, onboarding, worker install docs, and static SEO copy to describe service-backed install, automatic restart, and automatic updates.

### Fixed
- Fixed worker CLI short-flag parsing so commands such as `service logs -f -n 500` treat adjacent short flags correctly.
- Fixed updater behavior so unmanaged npm workers no longer spawn a replacement daemon through `npx`; automatic update now requires a service or supervisor restart strategy.

## [0.2.70] - 2026-06-13

### Added
- Added EasyTier mesh enrollment and runtime status reporting so the control plane can provision worker mesh settings, the worker doctor can validate EasyTier readiness, and the worker console plus `/admin/executors` can display live mesh health.
- Added preview access-route metadata so workspace previews can report whether the current route is `Gateway`, `Mesh Direct`, or `Mesh Relay`.
- Added EasyTier preview-deployment documentation and a `start:easytier:public-node` script for bootstrapping a server-side public relay node.

### Changed
- Changed workspace preview entry behavior so localhost local-direct sessions open immediately from the top-right `Preview` action instead of requiring an extra in-panel “启动 Preview” step.
- Changed preview session opening and refresh requests to include the local worker executor as the mesh source when available, allowing the server to resolve mesh-aware preview routes.

### Fixed
- Fixed workspace preview startup so local-direct localhost sessions no longer auto-start the remote tunnel path unless the user explicitly switches to `Tunnel` or local-direct falls back after a timeout.

## [0.2.69] - 2026-06-13

### Fixed
- Fixed `/workspaces` creation-panel executor status drift so a branch-read failure caused by an offline executor immediately marks the selected executor offline instead of leaving the UI showing an online state.
- Fixed `/workspaces` branch-load error messaging to explain executor connection loss explicitly, reducing the mismatch between the executor badge and the branch picker hint.

## [0.2.68] - 2026-06-12

### Added
- Added a workspaces-page UI-store regression test suite that covers clearing remembered `taskId` and `workspaceSessionId` state during workspace-session navigation.

### Fixed
- Fixed `/workspaces` route state so workspace-only sessions no longer keep synthetic `workspace-session:<id>` task keys in remembered tab state or route search after the session scope should have taken over.
- Fixed workspaces tab-memory updates so explicitly clearing `taskId` and `workspaceSessionId` removes stale task/session context instead of silently retaining an older route target.

## [0.2.67] - 2026-06-12

### Changed
- Changed browser-side local worker discovery to choose the console port appropriate for the current page environment.
- Changed Local Direct preview, terminal transport probing, settings LNA checks, and workspace environment diagnostics to share the same environment-aware local worker endpoint resolution.
- Documented the development, preview, and production worker port matrix for Local Direct and LNA diagnostics.

### Fixed
- Fixed preview-environment Local Direct detection so the preview worker is preferred before falling back to other local worker ports.
- Fixed legacy local worker executor reads so direct helper calls no longer default to the production `48100` port on preview pages.

## [0.2.66] - 2026-06-12

### Added
- Added experimental terminal Local Direct transport with one-time local attach tickets, worker-local terminal WebSocket attach, and automatic fallback to the existing Gateway / Tunnel terminal path.
- Added terminal transport probing so the terminal header can show `Local Direct` or `Gateway/Tunnel` availability with measured latency and an Auto / Local Direct / Gateway-Tunnel selector.
- Added local worker diagnostics and local environment health probes for workspace environment status surfaces, including executor-scope checks before attempting localhost reads.
- Added bilingual preview gateway diagnostic pages with source URL, session details, and actionable hints when preview auth, tunnel readiness, or source-app proxying fails.
- Added a code-size analysis document capturing the largest files and recommended split targets for future maintenance work.

### Changed
- Changed workspace preview transport UI to expose probe latency and per-link availability for Local Direct, Gateway, and Tunnel while preserving fallback behavior.
- Changed workspace terminal headers to show the active node, connection method, workspace name, and measured transport latency beside the new-terminal button.
- Expanded worker local API CORS allowlisting for safe read-only local diagnostics while keeping write/control endpoints out of the browser probe path.

### Fixed
- Fixed terminal Local Direct behavior so failed, blocked, or timed-out local attempts fall back to the existing Gateway / Tunnel transport when Auto is selected.
- Fixed local-direct eligibility checks so localhost terminal and preview experiments only run when the workspace executor matches the local worker executor.

## [0.2.65] - 2026-06-12

### Added
- Added experimental local-direct workspace preview transport that prefers `127.0.0.1` when the hosted page is talking to the same machine as the active workspace worker.
- Added worker-local read-only CORS support for `/health`, `/api/health`, and `/api/status` so Wemux preview and diagnostics pages can safely read local worker status from allowed origins.

### Changed
- Changed workspace preview transport selection to verify local worker `executorId` ownership before using localhost direct preview, while preserving the existing Gateway / Tunnel path as fallback.

### Fixed
- Fixed preview fallback behavior so localhost direct preview timeouts drop back to the existing preview transport instead of leaving the iframe stuck on a failed local attempt.

## [0.2.64] - 2026-06-12

### Added
- Added removable structured context chips for `/workspace` session chat so selected project and workspace-file references stay visible and editable separately from the composer text.
- Added richer active-project prompt metadata for workspace chat context references, including project name, `projectId`, `gitUrl`, `defaultBranch`, and the current workspace path when available.

### Changed
- Changed workspace-session draft, retry, and optimistic-send handling to persist explicitly selected context refs while de-duplicating them against inline `@...` context parsing.

### Fixed
- Fixed `/workspaces` list runtime badges so `Dev 运行中` is only shown for the terminal-managed start flow instead of lingering from environment runtime probe state alone.

## [0.2.63] - 2026-06-12

### Added
- Added a workspace chat context mention picker so workspace sessions can insert structured context references from the composer.
- Added a `/settings` Local Network Access experiment panel with browser LNA status, local worker health probing, site-settings guidance, and direct local health links for diagnosing localhost access.

### Changed
- Changed `/settings?section=localNetworkAccess` routing to use a pure route-search helper so the new settings section can be validated without loading the full app runtime.

### Fixed
- Fixed the denied Local Network Access guidance so users are told when Chrome requires a full Wemux page reload after changing site permissions manually.

## [0.2.62] - 2026-06-11

### Added
- Added Railway-style Preview Networking domain bindings so project and workspace runtime templates can expose `domain -> Port` mappings with generated platform domains, custom-domain placeholders, and notes.
- Added preview DTO metadata for domain bindings, including port, note, domain type, and viewer bootstrap access for additional preview domains.

### Changed
- Changed project and workspace preview settings from App URL / extra URL fields to a Public Networking card list while preserving legacy URL template compatibility.
- Changed preview gateway routing so requests to additional domain bindings resolve by Host to the configured workspace port, including multiple domains pointing at the same port.

### Fixed
- Fixed additional preview-domain copy actions to prefer viewer bootstrap URLs when available, keeping copied domain links usable from the Preview menu.

## [0.2.61] - 2026-06-11

### Added
- Added executor LAN IP detection and persistence so workspace previews can expose copyable public and LAN source URLs for node-level debugging.

### Changed
- Changed workspace preview public networking to use an authenticated platform gateway that reverse-proxies to the worker ingress API.
- Removed direct node ingress host routing from the worker preview ingress registry and protocol so workers no longer serve arbitrary preview traffic by public Host.

### Fixed
- Fixed workspace initial-message queue calls so `deferUntilWorkspaceReady` is sent as queue options instead of being misread as runtime config.
- Fixed task chat context typing to use the current `WorkspaceSession` shared type.

## [0.2.60] - 2026-06-10

### Added
- Added workspace-level code state for base branch, workspace code branch, remote head SHA, and sync time, including Postgres persistence and historical session backfill.
- Added an explicit worktree start-point mode so worker preparation can distinguish restoring an existing workspace branch from rebuilding from a selected base branch.

### Changed
- Changed workspace chat, `/workspace`, and `/workspaces` branch displays to prefer workspace-level code state instead of per-session branch fields.
- Changed manual workspace branch switching to create a new workspace code branch from the selected base branch, preserving old remote workspace branches as history without reusing them.

### Fixed
- Fixed workspace restoration so existing remote workspace branches are restored instead of being reset to the base branch.
- Fixed migration ordering for workspace code-state backfill so older databases have the referenced workspace-session columns before the backfill query runs.

## [0.2.59] - 2026-06-09

### Changed
- Added project color markers and a heavier checkbox treatment to the `/workspaces` project-visibility filter so project selection is easier to scan in the dark sidebar.
- Tightened `/workspaces` workspace-row footer spacing so cards without terminal, runtime, pull-request, or attention badges no longer reserve an empty status area.

## [0.2.58] - 2026-06-09

### Added
- Added a dedicated onboarding runtime step so first-run users can detect local coding agents and models from a connected node or add a model manually before entering the workspace.
- Added development seed data for the expanded dev-login accounts, including fresh onboarding users and legacy users with seeded projects, tasks, and workspace-session history.
- Added GitHub App connection-state surfaces for GitHub-centric views so review and actions pages can explain how to unlock those sections when the app is not connected.

### Changed
- Redesigned onboarding into a five-step AI-first flow with lighter visuals, animated background treatment, refined progress labels, node connection animation, GitHub project entry, and an embedded “start chat” workspace-creation experience.
- Updated onboarding step five so users can launch their first AI workspace directly from the onboarding page, with prompt suggestion chips, direct control-panel escape, and tighter model / executor controls.
- Tightened the app sidebar and workspace list visual density, including the new collapsible GitHub section and more consistent active-state styling.

### Fixed
- Fixed onboarding workspace creation flow so the first prompt, selected runtime, branch, and workspace session all carry through into the redirected `/workspace` session.
- Fixed dev-login defaults to expose both onboarding-focused and legacy seeded accounts with stable IDs for testing.

## [0.2.57] - 2026-06-09

### Added
- Added a project visibility filter to the `/workspaces` list so users can switch between showing all projects and only projects that already have workspaces.

### Changed
- Reduced `/workspaces` first-load payloads and duplicate polling by introducing workspaces-scoped bootstrap and state-stream summaries, lighter pull-request list responses, and short-lived request caching for supporting sidebar and collaboration data.

### Fixed
- Fixed workspace-session switching in the `/workspaces` sidebar so the selected session stays stable while the shell updates around it.
- Fixed duplicate unread-state and workspace-session bootstrap synchronization on `/workspaces`, reducing redundant first-load requests and repeated state hydration.

## [0.2.56] - 2026-06-09

### Added
- Added a Docker worker connection flow across execution settings, onboarding, and worker install docs so users can copy the correct Docker pairing command and worker runtime configuration.

### Changed
- Changed workspace deletion so the control plane removes workspace records first and runs node resource cleanup in the background, keeping the UI from waiting on local branch or directory cleanup.

### Fixed
- Fixed workspace-session runtime selection so task-bound and standalone workspace sessions stay bound to the intended workspace executor instead of falling back to the wrong runtime context.
- Fixed `/workspaces` history loading so opening an existing workspace session no longer visibly jumps upward and then downward on slow devices or throttled networks.
- Reduced duplicate workspace-session history hydration, deduped repeated WebSocket history snapshots, and switched live streaming follow-scroll to instant positioning.
- Added regression coverage for workspace-session transcript readiness, initial scroll resolution, post-initial auto-scroll suppression, and streaming scroll mode selection.

## [0.2.55] - 2026-06-08

### Added
- Added paginated loading for Review Center pull requests, GitHub Issues, and GitHub Actions so large GitHub App installations can be browsed in smaller batches.
- Added workspace environment inheritance visibility in workspace settings so new execution workspaces can show project-level configuration without copying it into the workspace.

### Fixed
- Fixed workspace-session message sending so the composer clears immediately with an optimistic turn, restores the draft on failure, and falls back to the queued send path when the realtime socket is unavailable.

## [0.2.54] - 2026-06-08

### Fixed
- Switched workspace title suggestion to OpenRouter so `/workspaces` naming no longer depends on worker OpenCode prompt setup.
- Fixed workspace creation so missing OpenRouter configuration or request failures fall back to the existing prompt-derived title without blocking workspace creation.

## [0.2.53] - 2026-06-08

### Added
- Added an OpenRouter-backed `/workspaces` title suggestion flow that tries a configured OpenRouter model before creating a workspace.
- Added shared workspace-title fallback helpers and focused tests so workspace and first-session naming stay aligned.

### Fixed
- Fixed fallback workspace-session creation so explicit `title` and `titleOrigin` are actually sent to the server when the create-workspace response does not already include the first session.

## [0.2.52] - 2026-06-07

### Added
- Added a shared compact workspace creation composer so task-bound and `/workspaces` creation flows use the same dense AI-first input surface.
- Added a workspace directory readiness probe before workspace chat marks worktree preparation complete or drains the first queued AI message.

### Changed
- Simplified the model center runtime panel by removing local runtime config import/sync controls from the main editing surface.
- Widened the `/workspaces` list panel and tightened project/workspace row spacing for denser scanning.

### Fixed
- Fixed `/workspaces` lifecycle timelines so worktree preparation system messages remain visible while orphaned lifecycle noise is still filtered.
- Fixed new workspace initial messages so worktree sessions wait for verified directory readiness before OpenCode/Pi/Codex execution starts.
- Fixed OpenCode prompt startup failures so worker-side `promptAsync` errors immediately surface as `session.error` events instead of lingering at "starting".

## [0.2.51] - 2026-06-07

### Changed
- Updated the `/workspaces` creation form to reuse the same compact workspace branch picker used below the AI composer, keeping base-branch selection visually consistent with active workspace sessions.

### Fixed
- Fixed `/workspaces` creation so project-level "new workspace" actions open the create panel on the first click even when the route already carries `create=1`.
- Fixed new workspace creation to pick a usable executor by default, send the initial prompt through the workspace chat queue after the session is created, support image-only initial messages, and keep the workspace-session title aligned with the workspace name.
- Fixed hybrid development login/API requests so browser-origin checks accept the local hybrid app host and Vite proxy paths route control-plane requests without being blocked.

## [0.2.50] - 2026-06-07

### Changed
- Updated public marketing, privacy, and terms pages to render the support contact as reusable segmented text instead of direct mailto/email literals across visible page surfaces.

## [0.2.49] - 2026-06-07

### Changed
- Tightened the `/workspaces` AI creation panel so the first-prompt composer, runtime selectors, branch controls, and auto-commit toggle fit better on mobile.

### Fixed
- Fixed mobile `/workspaces` row selection so tapping a workspace with existing sessions opens the default workspace session immediately instead of briefly showing the empty workspace detail state.

## [0.2.48] - 2026-06-07

### Fixed
- Fixed `/workspaces` route rendering so TanStack route matches, lazy boundaries, and SSR fallback rendering stay inside the app/auth/dialog providers before `WorkspacesPage` calls `useApp`.

## [0.2.47] - 2026-06-07

### Added
- Added compact main chat bootstrap and state-stream modes with on-demand full session loading, reducing initial `/chat` payloads while keeping selected session history recoverable.
- Added a batched `/api/workspaces/directory` endpoint for `/workspaces` so project workspace data can load through one scoped directory request.
- Added Fly.io and Railway deployment descriptors for the control-plane runtime.

### Changed
- Enabled API response compression and expanded API timing logs with response byte counts and route-specific payload detail.
- Simplified `/workspaces` directory loading to one batched query while preserving executor runtime polling separately.

### Fixed
- Fixed `/workspaces` session routing so workspace-only sessions keep synthetic workspace-session task keys and bound sessions resolve back to their real task ids.
- Fixed state streaming to skip replaying the initial snapshot when the client already applied the same bootstrap state.

## [0.2.46] - 2026-06-07

### Added
- Added an AI-first `/workspaces` creation flow that starts from the first prompt, carries agent/model selection into the new workspace session, auto-generates a workspace name from the prompt, and restores that prompt in the new session composer.
- Added workspace-scoped session snapshot, history, runtime, turn deletion, and history WebSocket endpoints so standalone workspace sessions no longer depend on task-scoped history routes.
- Added public pricing, privacy, and terms pages to the static export metadata.

### Changed
- Split `/workspaces` directory loading into executor, runtime, and per-project queries with priority project ordering and hidden-tab polling suppression.
- Stopped synthesizing unreferenced `workspace-root` entries in workspace lists and added a migration cleanup for orphaned generated workspace roots.

### Fixed
- Fixed workspace-session diagnostics and history cache keys to use real `workspaceId` scope instead of task IDs.
- Fixed workspace-session creation so the selected agent model is persisted for both the workspace default task and the first created session.

## [0.2.45] - 2026-06-06

### Added
- Added API timing observability for project workspace and workspace-session history routes, including `Server-Timing`/`X-Request-Id` response headers and structured `api_timing` logs for request tracing.

### Changed
- Reduced `/workspaces` background polling while the browser tab is hidden so idle pages stop refreshing directory data until the page becomes visible again.

## [0.2.44] - 2026-06-06

### Changed
- Reduced `/workspaces` first-load work by pinning deep-linked projects, narrowing PR/model-usage/Git polling fan-out, and lazy-loading chat, testing/preview orchestration, create-panel control state, project edit, and workspace delete dialogs.
- Added Postgres indexes for high-traffic workspace, task, log, Git credential, and workspace-session history query paths.

### Fixed
- Fixed `/workspaces` deep-link reloads so the route-selected project remains visible while collaboration workspace scope is still resolving.
- Added a decorative default `alt=""` for shared avatar images to reduce missing-alt Lighthouse findings.

## [0.2.43] - 2026-06-05

### Changed
- Reduced `/workspaces` initial bundle weight by lazy-loading Git, Files, Preview, Terminal, Test Records, Desktop Sandbox, browser-inspection, local-session preview, and settings dialog panels only when the active view needs them.
- Split the `/dashboard` route into lazy-loaded page and section chunks, and simplified the delivery heatmap accessibility tree to a single chart summary instead of one label per visual cell.

## [0.2.42] - 2026-06-05

### Added

### Changed
- Redesigned the `/execution` node Mesh into a cleaner control-core topology with lane-based worker cards, clearer status-aware connection lines, and animated flow particles for online or pairing executors.

## [0.2.41] - 2026-06-05

### Changed
- Standardized the public-facing support contact across the landing, marketing layout, and legal pages to `support@wemux.com`.

## [0.2.40] - 2026-06-05

### Changed
- Kept the public account and settings surfaces available while optional integrations remain disabled by default.

## [0.2.39] - 2026-06-05

### Changed
- Hardened the multi-node control-plane and worker routing foundation with explicit node identity, shared-secret backed token handling, route assignment, and cross-node relay support for terminal and preview traffic.
- Switched hosted development object storage defaults to Cloudflare R2 so dev and preview-style environments follow the same external object-storage model instead of relying on bundled object storage.

## [0.2.38] - 2026-06-04

### Changed
- Added preview worker connection-route assignment so each worker startup asks the control plane for the current realtime entry instead of persisting a stale endpoint in local config.
- Updated preview routing and deployment docs around the regional realtime split.

### Fixed
- Fixed preview tunnel and preview-session host generation so executors receive the correct realtime tunnel base URL during preview, remote-code preview, and desktop-sandbox preview flows.
- Fixed worker-side cloud endpoint propagation so browser inspection, MCP materialization, runtime context export, artifact uploads, and prompt execution all follow the current in-memory assigned realtime route for the active process.

## [0.2.37] - 2026-06-04

### Changed
- Reworked `/workspaces` session navigation so workspace rows now preview recent sessions with state badges, the shell switcher surfaces both workspace and node-local sessions, and mobile selection flows open directly into the active detail view.

### Fixed
- Fixed workspace-session renaming from `/workspaces` so list/switcher rename actions can update task-bound sessions through the binding route and standalone workspace sessions through the direct workspace-session API.

## [0.2.36] - 2026-06-03

### Fixed
- Hardened workspace Git commit identity handling so PAT-bound projects commit with the configured user identity, GitHub App-bound projects commit with the configured App bot identity, and worker auto-commits no longer fall back to a node's global Git name/email.

## [0.2.35] - 2026-06-03

### Fixed
- Fixed workspace lifecycle operation messages so runtime events stay attached to the active user turn instead of remaining pinned at the bottom of the session timeline.
- Reverted the GitHub App task identity isolation change from PR #38 after it blocked project clone and branch loading during workspace creation, restoring the previous Git credential behavior while the identity model is redesigned.

## [0.2.34] - 2026-06-03

### Fixed
- Fixed worker task execution runtime environment merging so preview builds no longer fail when Git auth environment variables include optional undefined values.

## [0.2.33] - 2026-06-03

### Fixed
- Fixed `/workspace` and `/workspaces` session deletion to target the real workspace-session scope instead of relying on a task-scoped delete path, which now also blocks deleting the last session, dependent fork/shared-worktree sessions, active runs, or queued messages.

## [0.2.32] - 2026-06-03

### Changed
- Clarified the top-level console version label in both English and Chinese so the UI now shows the Wemux product name alongside the version number instead of a bare `vX.Y.Z`.

## [0.2.31] - 2026-06-02

### Fixed
- Fixed the `/kanban` task detail side panel so clicking outside now closes it instead of trapping the rest of the board behind a modal overlay.
- Fixed kanban task switching while the detail panel is open by allowing users to click another task card directly and open the new detail view in one step.

## [0.2.30] - 2026-06-02

### Changed
- Added clearer `/workspaces` creation progress so the UI now surfaces separate workspace and default-session steps before opening the new workspace tab.
- Refined project clone status badges with elapsed-time feedback for active clones and stronger failure affordances when a repository is not ready yet.

### Fixed
- Fixed `/workspaces` creation so projects with cloning or failed repositories are blocked up front with explicit guidance rather than failing later in the workspace bootstrap flow.
- Fixed worker non-interactive terminal commands to run without login-shell side effects and to time out cleanly when background preparation commands hang.

## [0.2.29] - 2026-06-02

### Changed
- Refined the Model Center provider bindings table with denser token-state indicators, base URL summaries, and expandable model tag previews so large provider sets stay easier to scan.

### Fixed
- Fixed GitHub App installation callbacks so the signed callback state can complete installation sync after the GitHub redirect even when the browser no longer sends a bearer token, while still rejecting mismatched authenticated users.
- Fixed project deletion so Wemux only attempts directory removal for managed workspace-owned paths, preserving user-owned original directories while still removing the project record and reporting partial deletion warnings clearly.
- Fixed managed workspace path detection across shared, server, and web runtime helpers so custom workspace roots, legacy `.wemux-*` paths, and home-expanded managed directories resolve consistently during deletion and runtime path remapping.
- Fixed workspace-session history hydration to enrich collaborator timeline authors from the latest conversation snapshot instead of a stale closure during refresh.

## [0.2.28] - 2026-06-02

### Added
- Added a Model Center runtime panel that manages default models and runtime settings for OpenCode, Codex, Claude Code, and Pi, with direct worker config import support.
- Added a built-in `Wemux YML` system skill that is auto-seeded into the primary agent and the skill catalog for repo-root `.wemux.yml` authoring.

### Changed
- Moved runtime default configuration out of `/settings` and into the Model Center, and simplified workspace open-behavior copy.
- Normalized model provider base URLs across model discovery, persistence, matching, and runtime option rendering so custom provider endpoints resolve consistently.
- Reworked `/workspaces` creation and selection flows so workspace-level AI chats can exist without an explicit task binding while keeping URL, tab, and deletion state aligned.

### Fixed
- Fixed non-default and worker-imported model profiles so owner ids survive create, update, and discovery-refresh flows instead of being dropped.
- Fixed workspace-only session execution flows so chat, git, preview, remote code, and desktop tooling can resolve a synthetic task context without persisting fake task records.
- Fixed managed system skills so official built-ins cannot be directly edited or deleted through the normal skill management routes.

## [0.2.27] - 2026-06-02

### Added
- Added workspace-level session creation so `/workspace` and `/workspaces` can create a default AI chat even when the workspace is not yet linked to an explicit task.
- Added node update settings that sync from the control plane to workers, allowing operators to choose manual or idle auto-exit update behavior.
- Added multi-node workspace repo preparation user stories and regression coverage documentation.

### Changed
- Changed PWA update handling so new service workers wait for explicit user refresh instead of immediately taking over the page.
- Improved workspace empty-state flows so users can create an AI chat directly from workspace surfaces.
- Scoped shared worktree resolution to the active executor so `worktreeStatus=created` is treated as an executor-local hint rather than a multi-node global truth.

### Fixed
- Fixed multi-node remote workspace preparation so Preview, Remote Code, environment start, branch switching, and workspace chat verify the current executor cwd before skipping worktree ensure.
- Fixed managed worker repo caches so invalid `workspace/repos/*` directories can be repaired before branch snapshots or worktree creation.
- Fixed cross-node `git-local` and `none` project errors to show source node, target node, and source path instead of a vague repository failure.

## [0.2.26] - 2026-06-02

### Added
- Added workspace member lookups for collaboration workspaces so `/workspace` and `/workspaces` session transcripts can render other members' turns with the correct names and avatars.

### Changed
- Refactored `/workspaces` desktop sandbox, remote-code, and archive-control actions into a dedicated hook while tightening route and remembered-tab selection so archived workspaces and workspace-session tabs stay aligned more reliably.
- Updated task and workspace pull request badges to open directly from list/detail surfaces, and made `/workspaces` prefer the freshest linked-task PR state over stale workspace delivery summaries.

### Fixed
- Fixed main `/chat` stop handling so active main-chat executor replies abort cleanly and the session runtime state returns to idle immediately.
- Fixed workspace terminal close handling so browser terminal clients and persisted terminal runtime summaries are refreshed as soon as a workspace terminal exits.
- Fixed worker-side pull request creation so GitHub PR requests are blocked when the remote compare branch is ahead of or diverged from the local workspace branch.

## [0.2.25] - 2026-06-01

### Added
- Added workspace runtime summaries so `/workspaces` can show terminal, environment, and active-agent status from persisted workspace-session runtime data.
- Added workspace delivery summaries so pull request badges can stay attached to the correct workspace even when delivery data comes from execution history.

### Changed
- Reworked workspace-session executor resolution around `runtimeOwnerExecutorId`, keeping preview, desktop sandbox, Git, worktree, and agent routes scoped to the actual session runtime owner.
- Improved workspace chat image attachments with upload progress, failure states, local previews, and image-only send support.
- Persisted workspace system timeline messages so stopped, interrupted, or timed-out agent turns render as explicit system events instead of assistant fallback output.

### Fixed
- Fixed workspace archive/delete cleanup so Preview sessions, Desktop Sandbox sessions, Code Server, terminal sessions, and worker-owned worktrees are cleaned up before the workspace is finalized.
- Fixed closed preview sessions so viewer/share/bootstrap tokens are revoked and cannot be reused after the session is closed.
- Fixed workspace PR result attribution so pull request metadata keeps workspace and workspace-session ids when applying delivery results.

## [0.2.24] - 2026-06-01

### Added
- Added workspace list drag-and-drop helpers plus tests so `/workspaces` can reorder sessions with more predictable drop targeting.

### Changed
- Exposed workspace session token summaries directly inside the `/workspaces` session chat surface so compact session layouts still show current usage context.

### Fixed
- Fixed OpenCode workspace-session output handling so `message.part.delta` text updates are merged correctly across worker, server, and chat UI flows instead of degrading into empty-output placeholder replies.
- Fixed workspace chat persistence and rendering so OpenCode empty-output fallback text no longer gets stored or shown as a normal assistant reply in `/workspace` and `/workspaces`.

## [0.2.23] - 2026-05-31

### Added
- Added executor node visibility to the `/workspaces` list so workspace-level execution bindings are easier to inspect without leaving the workspace surface.

### Changed
- Refined the `/workspaces` list layout so archived workspaces collapse into a footer section, keeping active workspace browsing focused while preserving access to archived entries.
- Extended workspace executor sharing and delivery history flows so executors can stay bound across multiple workspaces while workspace sessions surface delivery-result metadata and token usage more consistently.
- Tuned desktop sandbox streaming profiles across web, server, worker, and preview tunnel layers to improve preview-environment desktop quality and reduce mismatched display settings between the client and worker runtime.

### Fixed
- Fixed the `/execution` executor edit dialog so in-progress form changes are no longer reset unexpectedly while editing shared workspace bindings or node metadata.

## [0.2.22] - 2026-05-31

### Added
- Added workspace archive and restore actions on `/workspaces`, plus delete-time options to remove managed local and remote branches when cleaning up a workspace.

### Changed
- Extended workspace cleanup orchestration so worker-owned worktree teardown can also prune managed `wemux/*` branches without moving Git execution back into the control plane.
- Enabled the desktop sandbox integration for preview workspace debugging.

## [0.2.21] - 2026-05-31

### Added
- Added a dev-only desktop sandbox flow for `/workspace`, including the server routes, shared contracts, worker runtime client, and workspace-side panel wiring needed to launch desktop debugging from the existing workspace session model.
- Added task pull request status surfacing across workspace task detail and related list views so code review state is visible without leaving the workspace flow.

### Changed
- Moved workspace dependency installation back onto the worker background execution path so repo setup stays worker-owned instead of blocking through the control plane.
- Extended workspace completion handling so worker-side git operations can automatically commit AI-generated workspace changes after execution finishes.

### Fixed
- Fixed OpenCode assistant error propagation so runtime failures surface explicit assistant-side errors instead of degrading into blank or unclear responses.
- Tightened preview session and preview gateway handling around the new desktop sandbox path so dev preview access remains attached to the correct workspace session flow.

## [0.2.20] - 2026-05-29

### Changed
- Simplified preview transport handling so the preview gateway now always proxies through the tunnel instead of keeping a separate direct transport path.
- Simplified the workspace Preview panel by removing preview source mode switching and normalizing visible preview addresses to hide bootstrap-only query params.
- Improved Preview address-bar navigation so same-origin full URLs resolve back into workspace preview paths while external URLs can still be opened directly.

### Fixed
- Fixed preview open-in-browser behavior so users are only sent to the preview page after the tunnel is actually connected.
- Fixed preview error messaging to make tunnel-connected but source-app-unavailable failures clearer.

## [0.2.19] - 2026-05-29

### Added
- Added optimistic kanban drag updates so task status changes feel immediate while the server mutation completes.
- Added reusable custom agent delegation runtime helpers for deriving delegate defaults and building agent invocation envelopes.

### Changed
- Added a Preview source mode switch so workspace previews can choose the appropriate preview target more explicitly.
- Standardized remote Git workspace directory resolution so remote projects consistently use executor-managed workspace paths instead of stale node binding overrides.
- Lazy-loaded heavier workspace, agent, sidebar, and selector surfaces to reduce initial route work and avoid rendering closed panels.
- Optimized conversation rendering, workspace unread-state syncing, sidebar data loading, and pull request refresh passes to cut redundant UI and API work.

### Fixed
- Fixed collaboration workspace project scoping so project lists stay isolated to the active workspace.
- Fixed pull request refresh persistence so unchanged refreshed snapshots no longer rewrite task/session state repeatedly.
- Fixed project directory display and workspace settings copy to reflect the project-level repository path model instead of per-workspace node path bindings.

## [0.2.18] - 2026-05-29

### Added
- Added runtime environment file materialization so project environment data can be written out for executor-side consumption.
- Added iframe navigation syncing in the Preview panel so the path bar follows in-page SPA routing.

### Changed
- Extended the project environment and executor plumbing to carry runtime environment file writes through the control plane.
- Tightened preview shell state synchronization so the displayed preview URL stays aligned with the loaded iframe route.

### Fixed
- Fixed preview tunnel POST forwarding so login and form submissions no longer fail with 502 through the worker proxy.
- Fixed preview navigation state so the path input no longer gets stuck on the initial URL after in-iframe route changes.

## [0.2.17] - 2026-05-28

### Added
- Added richer task creation defaults, including status selection, parent-aware subtask drafts, and shared image upload handling for subtasks.
- Added a reusable task status icon set across kanban columns and compact task controls.
- Added the 2026-05-28 competitor watch note for ongoing multi-agent workspace tracking.

### Changed
- Refined the kanban task detail and creation surfaces into a tighter Linear-style layout with compact chips for status, priority, assignee, and date controls.
- Reworked the settings workspace admin surface so list/detail management keeps a steadier full-height layout on desktop and a clearer back path on mobile.
- Kept scoped project lists sorted by display order after state filtering and project saves.

### Fixed
- Fixed project environment template editing so start/stop commands and preview URLs persist correctly instead of being dropped on save.
- Fixed project settings save behavior so the editor stays open after saving and refreshes from the latest server state.

## [0.2.16] - 2026-05-27

### Added
- Added a persistent global page tab bar in the desktop header so visited pages and workspace sessions can be reopened from one place.
- Added keep-alive caching for `/workspaces` detail panes so switching between different workspaces preserves heavy panel state instead of remounting the workspace shell.

### Changed
- Moved workspace session tabs from the `/workspaces` detail surface into the shared page tab bar.
- Made stored workspace page tab IDs route-scoped and migrated stale legacy tab records to reduce duplicate or invalid workspace tabs.

### Fixed
- Fixed `/workspaces` tab switching so stale workspace session effects no longer rewrite the URL back and forth after clicking a page tab.
- Fixed the Dashboard page tab so it can be closed like other page tabs instead of being permanently pinned.

## [0.2.15] - 2026-05-26

### Added
- Added workspace tabs on the `/workspaces` page so opening a workspace keeps it available in a user-managed tab strip.

### Changed
- Remembered each workspace tab's latest task, workspace session, primary panel, and terminal UI state so switching between open workspaces preserves more context.
- Changed the `/workspaces` detail area to remain empty after the final workspace tab is closed instead of automatically reopening the first workspace.

## [0.2.14] - 2026-05-26

### Changed
- Unified workspace worktree resolution across preview, task git, cluster pull request, worktree lifecycle, and workspace chat flows so shared worktree sessions resolve against the effective directory owner consistently.

### Fixed
- Fixed shared worktree workspace sessions repeatedly re-ensuring directories or reading stale cwd/branch state when preview, git, environment, PR, or workspace chat actions were launched from forked sessions.

## [0.2.13] - 2026-05-25

### Added
- Added task pull request badge component with auto-refresh logic for visible PR status on task cards and detail panels.

### Changed
- Refactored project environment service, runtime environment routes, and task git routes to share a common import/export service layer.
- Split the large `workspaces-page.tsx` into focused route helpers and view builders to reduce code concentration.
- Updated workspace management routes to surface runtime environment status and branch naming aligned with workspace name seeds.

### Fixed
- Improved task chat dispatch result utils so workspace prompt recovery is more robust across reconnect scenarios.

## [0.2.12] - 2026-05-25

### Added
- Added the 2026-05-25 competitor radar note and expanded the competitor library with Mux and Harnss as high-priority multi-agent workspace references.

### Changed
- Refactored the `/workspaces` page into focused workspace session controllers, header actions, status banner, and content panel modules to keep the workspace session surface easier to maintain.
- Moved workspace and executor runtime loading onto React Query-backed cache keys so `/workspace` and `/workspaces` reuse session, conversation, history, executor, and runtime data more consistently.
- Updated workspace session branch naming so newly created sessions can use the workspace name and shorter generated worktree keys.

### Fixed
- Fixed workspace session executor ownership so workspace chat dispatch follows the selected workspace executor instead of rebinding sessions through stale per-session executor fields.
- Improved workspace session chat history and conversation cache synchronization across websocket updates and paginated history loads.

## [0.2.11] - 2026-05-24

### Added

### Changed
- Renamed the local control-plane runtime override to `allowLocalControlPlaneRuntime` with backward compatibility for `allowLocalDocker`.

### Fixed
- Fixed task detail acceptance criteria editing and several existing typecheck blockers in workspace, settings, and API type surfaces.

## [0.2.10] - 2026-05-23

### Added
- Added public `docs/wiki/*` pages covering project concepts, architecture, naming boundaries, and hybrid development guidance.
- Added cached workspace page query and UI-store layers to reduce repeated `/workspaces` data fetches.

### Changed
- Improved `/workspaces` workspace session loading with lighter initial history fetches, more explicit outline state, and reduced background polling or socket work while tabs are hidden.
- Improved workspace terminal bootstrap and default terminal selection to make workspace detail loading feel more direct and stable.
- Refined kanban page visual density for a tighter task board layout.

### Fixed
- Fixed workspace session streaming so realtime assistant updates publish against the effective persisted `workspaceSessionId` instead of stale request keys.
- Fixed local workspace project path and worktree handling across server and worker flows, reducing local project attach and runtime edge-case failures.
- Fixed workspace session history persistence so tool call previews remain visible in prior conversation turns.

## [0.2.9] - 2026-05-20

### Added
- Added workspace session unread state and model menu preference coverage for workspace session chat.
- Added Cloudflare Pages export and deploy configuration for the web app.

### Changed
- Expanded runtime provider setup, environment configuration, and workspace executor dispatch behavior.
- Refined workspace session chat layout, derived model state, outline handling, and persistent terminal integration.
- Improved settings, execution, changelog, and navigation UI wiring for the current runtime and deployment options.

### Fixed
- Fixed workspace session runtime and model derivation edge cases covered by targeted tests.

## [0.2.8] - 2026-05-19

### Added
- Added `workspace-preview-panel.test.ts` unit test for workspace preview panel components.
- Added persistent terminal session support integrated into workspace shell with multi-pane layout.

### Changed
- Refactored `workspace-preview-panel.tsx` to unify preview rendering with persistent terminal session, removing legacy preview logic.
- Updated `persistent-workspace-terminal.tsx` to handle terminal session rendering and state sync within workspace shell.
- Extended `workspace-shell.tsx` to support executor-level persistent terminal tab switching and session state management.
- Improved `workspace-terminal-panel.tsx` to integrate with persistent session for synchronized panel and shell state.
- Updated `workspaces-page.tsx` with linked loading logic for workspace session and terminal session.
- Extended `preview-gateway-routes.test.ts` coverage for `GET /api/preview-gateway/status` endpoint.

### Fixed
- Fixed `vibemux-release` skill documentation to match actual workflow.

## [0.2.7] - 2026-05-19

### Added
- Added an in-app `/changelog` page so users can review release history inside Wemux.
- Added persistent workspace and executor terminal sessions with reconnectable snapshots and session management APIs.
- Added release workflow guidance for release notes, changelog updates, and annotated tag management.

### Changed
- Expanded executor control-plane telemetry, worker doctor, and terminal session plumbing so workspace surfaces can inspect live node state without falling back to host-level access.
- Added bilingual Preview troubleshooting guidance for common tunnel, dev server binding, and upstream app failure modes.
- Standardized the Wemux release skill around a single `CHANGELOG.md` source of truth for user-facing release history.

### Fixed
- Fixed Preview gateway upstream failures so plain-text tunnel errors render as readable HTML fallback pages with the source app URL and failure detail.
- Fixed hybrid and Docker preview tunnel websocket resolution when `*.localtest.me` would loop back inside the worker container instead of reaching the configured control plane.
- Fixed workspace session completed-turn duration rendering so chat history uses real turn timeline bounds instead of overstating run time.

## [0.2.6] - 2026-05-19

### Added
- Established the first project-level changelog entry as the baseline for future releases.

### Changed
- Documented release history expectations for upcoming preview-to-master promotions.
