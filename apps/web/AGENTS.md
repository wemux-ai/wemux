# apps/web - 前端控制台（L2）

> 职责边界、主要成员、对外接口与依赖方向。本文件是 L2 文档层级，变更时更新此头部，然后检查根 `AGENTS.md`。

## 定位

React + Vite + TanStack Start 前端控制台：UI、路由、交互状态、表单、展示与调用控制面 API。

## 职责边界

- **做**：页面路由、UI 组件、交互状态、客户端缓存回显、调用 server API / WS / SSE。
- **不做**：不发明本地执行逻辑；不假设本地文件系统可用；不暴露密钥/token/内部凭据；不 import Drizzle schema / DB 客户端。
- 路由相关逻辑靠近 `routes/` 与对应 `components/`；页面专属复杂逻辑拆到 `routes/-xxx-*`。

## 主要成员（src/）

| 成员 | 职责 |
|------|------|
| `routes/` | 页面路由：chat / workspace / workspaces / kanban / execution / inbox / agents / models / skills / mcp / teams / settings / admin / onboarding / automations / review / marketing（blog/faq/compare/use-cases…）/ docs（`/docs` 文档站，内容在 `content/docs`，由 `lib/docs/*` 驱动） |
| `components/` | UI 组件（按域分目录）：chat / kanban / workspace / execution / inbox / agents / skills / mcp / marketing / admin / settings / dashboard / terminal / github / onboarding / automations… |
| `lib/` | 客户端逻辑：API client、状态、工具函数、Electron/RN 原生桥适配 |
| `components/commercial-*-gate.ts` | 可选扩展 UI/路由注册边界；默认为空注册表，由独立扩展按需注入 |
| `content/` `data/` | 静态内容与数据（营销内容、`docs/` 文档站 MDX） |
| `lib/docs/*` | 文档站数据层（shared 纯函数 + import.meta.glob 装配）、渲染、布局、搜索、AI 问答（`docs-ai-handler` 仅供 dev 中间件） |

## 对外接口

- 消费 `apps/server` 的 REST / WS / SSE；仅通过服务端代理访问对象存储。
- 依赖 `packages/shared`（`@shared/*` 类型与契约）。
- 扩展组合构建可从被忽略的独立挂载加载实现；核心文件不能直接 import 扩展实现。

## 页面边界（禁止混用）

- `/chat` = 主聊天页（mainChatSession）
- `/workspace` = 单工作区详情页（workspaceSession）
- `/workspaces` = 工作区列表/入口页
- 三个页面职责独立；不把 `/chat` 当 workspace session、不把 `/workspaces` 当单工作区详情处理。

## 规范

- UI 遵循 `docs/LINEAR-STYLE-UI-GUIDE.md`（扁平布局、双栏、紧凑控件、统一色板、禁止 Card 嵌套）。

[PROTOCOL]: 路由结构或共享组件契约变化时，更新本文件"主要成员"，然后检查根 AGENTS.md 与 Code Wiki（docs/wiki/04-directory-structure.md）。
