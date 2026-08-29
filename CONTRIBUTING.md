# Contributing to Wemux

感谢你考虑为 Wemux 贡献代码！English summary below.

公开仓库接受基于最新 `main` 的社区贡献。部分兼容性占位模块由维护者负责维护，具体范围以 CODEOWNERS 和 PR review 结果为准。

## 贡献者署名

请使用独立、聚焦的提交，并保留已有作者信息。维护者会尽量通过常规 merge 或 squash merge 保留贡献者署名；不要在 PR 中提交生成产物、凭据或未经审查的内部材料。

## 贡献流程

1. Fork `wemux-ai/wemux` 并 clone
2. 创建分支：`git checkout -b fix/xxx`
3. 修改代码，**保持改动小而聚焦**（不接受大规模重构型 PR；大改动先在 Discussions 的 Ideas 分类讨论）
4. 运行验证：
   ```bash
   pnpm install
   pnpm typecheck
   pnpm exec tsx --test packages/shared/src/<your-module>.test.ts   # 相关单测
   ```
5. 提交（commit message 用 Conventional Commits：`feat:` / `fix:` / `refactor:` / `docs:`）
6. push 并开 PR 到 `main`，描述改动与验证结果
7. 维护者 review；如果 PR 触碰维护者专属路径，维护者会说明如何处理

## AI 贡献政策（AI Contribution Policy）

Wemux 本身就是一个大量由 Agent 参与开发的 AI 原生项目，因此我们**负责任地接受** AI 生成的贡献，质量门槛与纯人工贡献完全一致：

1. **必须披露**：PR 中包含 AI 生成或深度辅助的代码时，必须在 PR 模板中勾选披露项。
2. **每条 PR 必须有一个人类 sponsor**：你逐行 review 过、能在评审中为它辩护、并为它签署 DCO（`git commit -s`）。「是 AI 写的」不构成对任何评审问题的回应。
3. **同一质量门槛**：typecheck、测试、review 标准与人工贡献一致——不放宽，也不额外收紧。
4. **反滥用**：同一作者短时间批量提交机器生成的 PR 会被限流并直接关闭，不做 review。

维护者侧说明：核心团队大量功能经由 agent workspace session 开发，此类 PR 会打上 `agent-authored` label 并关联 session 记录以便追溯。

## Issue 与 Discussions 分流

入口规则和维护者处理节奏见 [社区治理](docs/COMMUNITY-GOVERNANCE.md)。请按下面的边界选择入口：

- 可复现的 bug → GitHub Issue 的 **Bug report** 表单
- 有明确范围和验收标准的工程任务 → GitHub Issue 的 **Engineering task** 表单
- 使用、安装、部署和排障问题 → GitHub Discussions 的 **Q&A** 分类
- 开放式想法、产品方向和方案比较 → GitHub Discussions 的 **Ideas** 分类
- 使用案例、项目展示和实践经验 → GitHub Discussions 的 **Show and tell** 分类
- 维护者发布的路线图和版本方向 → GitHub Discussions 的 **Roadmap** 分类
- 安全漏洞 → 按 [SECURITY.md](SECURITY.md) 私下报告，不要开公开 Issue 或 Discussion

不要把“想法”直接写成未经拆解的工程 Issue；维护者会将获得确认的想法转换为带验收标准的 Engineering task。Issue 和 Discussion 都应避免粘贴密钥、token、私有仓库内容或用户数据。

## 开发环境

```bash
pnpm install
pnpm dev:infra:up                       # Postgres + object storage (Docker)
cp .env.development.local.example .env.development.local
pnpm dev:server                         # API :8989
pnpm dev:client                         # web console
pnpm dev:worker                         # local worker daemon
```

- 测试：`pnpm typecheck`（必过）+ `pnpm exec tsx --test <file>`（单测）
- UI 变更请附截图（桌面端建议双端截图）
- 数据库变更：改 `apps/server/src/storage/postgres/schema*.ts` 后 `pnpm db:generate`，提交生成的 migration

## 代码约定

- 路径别名：`@shared/*`（packages/shared）、`@/*`（web）、`@server/*`（server）
- 类型优先放 `packages/shared`，禁止跨端复制类型
- 函数短小、单一职责；新文件接近 800 行时拆分
- 不要新增 `any`
- 页面/会话概念区分：`/chat`（主聊天）、`/workspace`（工作区详情）、`/workspaces`（工作区列表）不得混用

## 行为准则

参见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。尊重所有参与者，用友善和建设性的方式沟通。

## 法律

- 本项目以 **Apache-2.0** 开源（见 LICENSE）。提交即表示你同意以 Apache-2.0 授权你的贡献。
- 外部贡献若包含第三方代码，请确保其许可证与 Apache-2.0 兼容。

### DCO（Developer Certificate of Origin）

本仓库采用 **Developer Certificate of Origin** 流程。每个提交须包含：

```
Signed-off-by: Your Name <your@email.com>
```

提交时使用 `git commit -s` 自动添加。签名表示你确认该贡献由你创作（或你有权按 Apache-2.0 提交）。
