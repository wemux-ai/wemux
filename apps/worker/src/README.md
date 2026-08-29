# Worker `src` 目录

`apps/worker/src` 现在按职责拆成 6 个子域，避免所有运行时逻辑平铺在顶层。

## 目录约定

- `core/`: 基础能力与共享状态，例如配置、路径解析、runtime bootstrap、workspace 布局。
- `control-plane/`: 云端控制面通信边界，按配对、WebSocket、产物上传进一步拆分。
- `execution/`: 任务执行链路，包括 Git 身份、OpenCode 调用、产物收集。
- `local-api/`: 本地 HTTP API 与 setup / console 静态资源服务。
- `runtime/`: Worker daemon、自检、终端会话、消息分发、本地仓库探测。
- `update/`: Worker 版本检查与自更新。

## 维护原则

- 新文件优先放进已有职责目录，不再往 `src/` 顶层平铺。
- `index.ts` 只做命令入口分发，不承载业务逻辑。
- `runtime/daemon.ts` 只保留主流程编排；可独立的逻辑继续下沉到子模块。

## 延伸阅读

- Worker agent 架构总览：`docs/WORKER-AGENT-ARCHITECTURE.md`
