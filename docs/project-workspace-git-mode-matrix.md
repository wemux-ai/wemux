# 项目创建、工作区模式与 Git 处理矩阵

> 这份文档是 Wemux 当前与目标行为的统一说明，重点回答：
> 1. 项目怎么创建
> 2. 工作区什么时候用托管 worktree，什么时候复用原始目录
> 3. 无 Git、本地 Git、有远程 Git 在不同场景下分别怎么处理

## 1. 先分清两条维度

Wemux 里有两条经常被混淆的维度，必须拆开看。

### 1.1 项目创建方式

项目创建方式描述的是：**项目目录最初是怎么进入 Wemux 的**。

当前主路径已经收敛为两种：

- `空项目`
- `Git Clone`

这两种主路径都应该落在 worker 的托管目录下，由 Wemux 管理，而不是让用户在主流程里手选本地目录。

### 1.2 工作区运行方式

工作区运行方式描述的是：**任务执行时，Agent 在哪个目录工作**。

当前系统支持两种：

- `worktree`
- `original-dir`

这和“项目是空项目还是 clone 来的”不是同一个概念。

一个项目可以是 Git Clone 创建的，但某个工作区仍然配置成 `original-dir`。
一个项目也可以是空项目创建的，但后面初始化 Git 之后再切成 `worktree`。

## 2. 当前主路径约定

### 2.1 空项目

- 用户选择节点
- Wemux 在该节点的托管目录下创建项目目录
- 初始状态通常为：
  - `versionControl = 'none'`
  - `gitUrl = ''`
- 这代表“目录已被 Wemux 托管，但尚未初始化 Git”

### 2.2 Git Clone 项目

- 用户选择节点
- 用户提供 Git URL
- Wemux 在该节点的托管目录下 clone 仓库
- 初始状态通常为：
  - `versionControl = 'git-remote'`
  - `gitUrl` 有值

### 2.3 不再推荐作为主路径的能力

以下能力不适合继续作为主创建入口：

- 选择本地目录接入项目
- 让用户指定 clone 到任意自定义路径

原因：

- 会破坏 worker 托管目录的一致性
- 会让 `repoPath`、`bindingPathHint`、`rootPath` 语义漂移
- 会让工作区模式和 Git 能力判断变得不稳定

这类能力如果保留，应该作为“导入已有项目”或“兼容模式”，而不是默认主路径。

## 3. Git 能力状态

项目当前的 Git 能力只看 `versionControl`：

- `none`
- `git-local`
- `git-remote`

含义如下。

### 3.1 `none`

表示当前目录还不是可用 Git 仓库。

常见来源：

- 新建空项目，还没 `git init`
- 历史上的目录项目
- 目录里有 `.git` 但还没有首个提交时，当前实现也仍可能按 `none` 处理

能力特征：

- 不支持 branch / diff / rebase / PR
- 不应该走标准 Git worktree 流程
- 任务结果更适合走本地改动保留或 summary

### 3.2 `git-local`

表示当前目录已经是本地 Git 仓库，但没有可用远端仓库。

能力特征：

- 支持本地 branch、diff、graph、rebase
- 不直接支持远端 PR
- 可以做本地 Git 级隔离，但不应强依赖 `origin`

### 3.3 `git-remote`

表示当前目录是可用 Git 仓库，并带有远端。

能力特征：

- 支持 branch、worktree、push、PR
- 是当前最完整、最稳定的 Git 工作流

## 4. 工作区运行模式

### 4.1 `worktree`

表示任务在隔离目录里执行。

理想语义：

- 每个任务有独立工作目录
- 每个任务有独立分支
- 适合并行、多会话、安全试验

对 Git 项目最友好：

- `git-remote` 最适合
- `git-local` 也可以支持，但不应该依赖远端

### 4.2 `original-dir`

表示任务直接复用项目当前目录。

特点：

- 没有独立隔离层
- 更容易踩到共享目录状态
- cleanup 很难做成和 worktree 一样安全

它更像兼容模式，不适合做长期主路径。

## 5. 当前实现矩阵

下面是当前系统里“项目 Git 状态”与“工作区模式”的实际组合语义。

| 项目状态 | 工作区模式 | 当前是否允许 | 当前语义 |
|---|---|---:|---|
| `none` | `original-dir` | 是 | 当前默认路径。直接在目录里工作，不走 Git worktree。 |
| `none` | `worktree` | 基本不走 | 当前创建工作区时会被改写回 `original-dir`。 |
| `git-local` | `original-dir` | 是 | 直接复用本地 Git 仓库目录。 |
| `git-local` | `worktree` | 是 | 目标应该是本地 Git 隔离工作流，但实现上仍有一些远端 Git 心智残留。 |
| `git-remote` | `original-dir` | 是 | 可工作，但不是推荐主路径。 |
| `git-remote` | `worktree` | 是 | 当前最完整、最稳定的标准路径。 |

## 6. 当前自动提交 / worktree 行为

### 6.1 自动提交默认值当前怎么判

当前自动提交默认值不是按“空项目 / clone 项目”区分，也不是按“托管空项目 / 用户原目录”区分。

它只看 `workingDirectoryMode`：

- `worktree` 默认开启
- `original-dir` 默认关闭

也就是说，当前系统**没有单独识别“托管空项目但未初始化 Git”**这一类。

### 6.2 当前无 Git 项目的实际行为

只要 `project.versionControl === 'none'`：

- 创建工作区时会强制走 `original-dir`
- 分支相关 UI 会降级
- cleanup 会跳过 Git worktree 清理
- 自动提交默认关闭

这意味着当前代码里：

- “新建的托管空项目”
- “历史上的非 Git 目录项目”

在工作区和自动提交链路里，本质上被当成了同一类。

## 7. 推荐规则

这是后续应该逐步收敛到的规则。

### 7.1 项目创建规则

主路径只保留：

- `空项目`
- `Git Clone`

两者都放在 Wemux 托管目录下。

### 7.2 对无 Git 项目的规则

无 Git 项目要再细分语义：

#### A. 托管空项目

表示：

- 项目目录由 Wemux 创建
- 当前未初始化 Git

推荐行为：

- 仍然视为“托管目录”
- Git 能力禁用
- 自动提交默认关闭
- 不再把它误标成“原始目录模式”

#### B. 兼容目录项目

表示：

- 历史项目
- 或兼容接入的非 Git 目录

推荐行为：

- 允许继续按兼容路径运行
- 但不应作为默认主路径继续扩散

### 7.3 对 `git-local` 的规则

推荐：

- 把 `git-local` 作为一等状态支持
- 不把“没有 origin”当错误
- 允许本地 Git 分支和本地隔离目录
- PR 能力关闭，但本地 Git 能力开启

### 7.4 对 `git-remote` 的规则

推荐：

- 默认使用 `worktree`
- 默认开启自动提交
- 有凭证时允许自动推送与 PR

## 8. 推荐矩阵

下面是建议长期收敛的行为。

| 项目来源 | Git 状态 | 推荐工作区模式 | 自动提交默认值 | 说明 |
|---|---|---|---|---|
| 空项目 | `none` | 托管目录语义，非 Git 模式 | 关闭 | 不支持 Git 能力，但不应借用“原始目录”概念。 |
| 空项目初始化 Git 后 | `git-local` | `worktree` 或本地 Git 隔离 | 开启 | 不需要远端也能正常做本地 Git 流程。 |
| 空项目绑定远端后 | `git-remote` | `worktree` | 开启 | 进入完整 Git 工作流。 |
| Git Clone | `git-remote` | `worktree` | 开启 | 标准主路径。 |
| 导入已有本地 Git | `git-local` | `worktree` 优先 | 开启 | 作为兼容能力，不作为默认入口。 |
| 导入已有远端 Git | `git-remote` | `worktree` 优先 | 开启 | 作为兼容能力，不作为默认入口。 |

## 9. 实现判定顺序

代码里必须按下面顺序判定，避免把几个概念重新混在一起。

### 9.1 项目来源与 Git 能力分开

`versionControl` 只表示 Git 能力，不表示项目来源。

- `versionControl = 'none'` 只能说明当前目录还不能走 Git 工作流。
- 它不能说明该项目是“用户原始目录”。
- 托管空项目和兼容目录项目都可能是 `none`，但产品语义不同。

当前代码还没有独立的项目来源字段时，必须保守处理：

- 新建空项目的 `rootPath` 在 worker 托管 projects 目录下，按“托管非 Git 项目”理解。
- 兼容导入或历史目录项目按“兼容原始目录项目”理解。
- UI 文案不要把所有 `none` 都叫做“原始目录”。

后续如果要彻底收敛，应补一个稳定字段，例如：

- `projectSource = 'managed-empty' | 'managed-clone' | 'imported-local' | 'legacy'`
- 或 `storageMode = 'managed' | 'external'`

### 9.2 工作目录模式只描述运行目录

`workingDirectoryMode` 只允许表达：

- `worktree`：运行在隔离目录。
- `original-dir`：运行在项目目录或兼容原目录。

它不应该被拿来表达“无 Git 托管目录”。在现阶段因为类型还没有第三种模式，`none` 项目会落到 `original-dir` 执行，但代码和文案都要避免把它当成用户原始目录。

### 9.3 执行目录解析规则

运行时选择 cwd 时，必须先看显式模式，再看路径是否存在。

推荐顺序：

1. 如果 session/workspace 是 `original-dir`，返回 `resolveWorkspaceRepoPath(...)` 或托管项目 root。
2. 如果项目 `versionControl = 'none'`，返回托管项目 root，不创建 Git worktree。
3. 如果 session/workspace 是 `worktree`，返回 session worktree path。
4. 只有在没有 workspace runtime 时，才回退到项目执行目录。

禁止用“历史 worktree 目录存在”覆盖当前 session 的 `workingDirectoryMode`。否则会出现数据库显示 `original-dir`，Agent 实际跑到旧 worktree 的状态漂移。

### 9.4 跨 worker / executor 项目路径规则

项目路径是 executor 本地事实，不是全局事实。`/path/to/project` 只说明某个 worker 上可能存在该目录，不能推导出其他 worker 也有同一路径或同一份文件。

当用户在一个没有该项目路径的 worker 上操作项目时，必须按项目 Git 能力和项目来源分开处理：

- `git-remote`：允许在目标 worker 的托管目录下重新 clone / prepare 仓库。准备成功后写入该 worker 的 `ProjectBinding.pathHint`，后续该 worker 可以创建 workspace 或 worktree。
- `git-local`：明确不能跨 worker 复用。它只属于记录中的原始 worker 节点，因为本地 Git 仓库没有可被其他 worker 拉取的远端事实。用户在其他 worker 上操作时，应阻塞并提示：该项目目前只存在于 worker `<executorName>`，如需跨 worker 复用，请先上传或绑定到 Git remote，再用 `git-remote` 工作流重新准备仓库。
- `none` 托管空项目：明确不能跨 worker 复用。它只属于创建该空项目的 worker 节点；没有 Git remote、artifact 同步或显式迁移时，其他 worker 没有同一份文件内容。目标 worker 不应静默创建一个空目录并当作原项目运行；应阻塞并提示：该空项目目前只存在于 worker `<executorName>`，如需在其他 worker 使用，请先推送到 Git remote，或执行明确的项目迁移 / 复制流程。
- `none` 兼容目录项目 / `original-dir`：明确不能跨 worker 复用。original-dir 的语义是“复用记录中的 worker 上的现有目录”，不是“在任何 worker 上生成一个同名目录”。用户换 worker 时，应提示先把项目上传到 Git remote 或显式导入 / 迁移到目标 worker。
- `worktree`：必须基于目标 worker 上已经准备好的 Git 仓库创建。目标 worker 没有 repo 时，只有 `git-remote` 可以先 clone；`git-local` 和 `none` 都不允许跨 worker 创建 Git worktree。

因此，跨 worker 创建 workspace 时推荐的产品行为是：

1. 先 resolve 最终 executor。
2. 在最终 executor 上 probe 项目目录或 binding。
3. 如果是 `git-remote` 且缺目录，显示“可在该 worker 准备仓库”，并由 worker 执行 clone。
4. 如果是 `git-local` / `original-dir` / `none` 且目标 worker 不是项目记录的 worker，显示明确阻塞，说明项目当前所在 worker，并引导用户先上传到 Git remote 或执行显式迁移。
5. 准备成功后刷新 `Project.versionControl`、`ProjectBinding.pathHint`、workspace `repoPath`，再允许 branch/worktree/auto commit 判断。

禁止行为：

- server/web 不能因为自己能看到某个 `rootPath` 就假设 worker 也能访问。
- 不能把 worker A 的 `ProjectBinding.pathHint` 当作 worker B 的路径使用。
- 不能在目标 worker 缺目录时静默回退到 server 本地执行。
- 不能用自动创建的空目录代表另一个 worker 上已有内容的 no-Git 项目。
- 不能把 `git-local` 或 no-Git 空项目展示成“可切换到任意 worker 继续工作”的项目；UI 必须显示它所属的 worker 节点。

### 9.5 Git 状态刷新闭环

创建工作区、打开工作区列表、准备工作目录、切换分支前，都可以 probe worker 目录并刷新 `Project.versionControl`。

刷新后必须同步考虑三件事：

- 新 workspace 创建时应使用刷新后的 project。
- 已有 workspace 不应被查询接口静默固化成旧模式。
- `none -> git-local/git-remote` 后，UI 应允许用户选择 worktree；是否自动迁移已有 workspace 要有明确规则。

当前过渡规则：

- 新建工作区前必须 refresh project。
- 如果刷新后还是 `none`，server 强制 `original-dir`，auto commit 强制关闭。
- 如果刷新后变成 `git-local` 或 `git-remote`，新建工作区可用 worktree。
- 已有 original-dir workspace 暂不自动迁移，避免把正在运行的共享目录改成隔离目录。

## 10. 自动提交、推送与 PR 规则

自动提交和自动推送必须分开判定。

### 10.1 自动提交

- `none`：不做 Git commit；结果以 summary、文件保留、产物等非 Git 方式表达。
- `git-local`：可以做本地 commit。
- `git-remote`：可以做本地 commit。
- `original-dir`：默认关闭；用户显式开启时也必须确认目录是 Git 仓库。
- `worktree`：Git 项目默认开启。

### 10.2 自动推送

- 只有 `git-remote` 才能自动 push。
- `git-local` 即使用户有 Git 凭证，也不能默认 push，因为没有稳定远端语义。
- `none` 永远不能 push。
- `original-dir + git-remote` 可以 push，但要当作兼容路径，风险提示应比 worktree 更明显。

### 10.3 PR

- 只有 `git-remote` 支持 PR。
- `git-local` 明确提示“不支持远端 PR”，但本地 diff、graph、rebase 应可用。
- `none` 不展示 PR 操作。

## 11. 路径字段职责

路径字段必须有清晰边界：

- `Project.rootPath`：项目的主目录。托管空项目通常在 `workspace/projects/<repo>`。
- `ProjectBinding.pathHint`：某个 executor 上已经准备好的项目目录或 clone 目录。
- `Workspace.repoPath`：工作区视角的项目目录缓存，不应该成为唯一权威来源。
- `worktreePath`：某个 workspace session 的隔离执行目录。

推荐读取顺序：

- Git remote clone 项目：优先 binding path，其次 worker 默认 repos path。
- 托管空项目：优先 project root。
- imported/local 项目：优先 project root 或 binding path。
- session worktree：只在 `workingDirectoryMode = 'worktree'` 时使用。

如果代码需要跨 server、worker、web 共同理解这些路径，应把路径解析规则沉到 shared 纯函数，避免三端各写一套分叉逻辑。

## 12. 当前代码里的关键判断点

如果后续要继续改实现，重点看这些位置：

- 项目版本控制类型：
  - `packages/shared/src/types/core.ts`
- 工作区自动提交默认值：
  - `packages/shared/src/task-workspace.ts`
- 创建工作区时如何根据项目类型决定 `workingDirectoryMode`：
  - `apps/server/src/routes/workspace-management-routes.ts`
  - `apps/web/src/components/workspaces/workspaces-page.tsx`
- 运行时是否准备 worktree：
  - `apps/server/src/services/task-chat-dispatch/workspace-executor.ts`
- 自动提交最终是否执行：
  - `apps/server/src/integrations/opencode/service.ts`

## 13. 一句话结论

当前系统已经把“项目创建主路径”收敛到托管模式，但“工作区运行方式”和“无 Git 项目语义”还没有完全同步收敛。

最核心的未完成项是：

- 还没有把“托管空项目但未初始化 Git”建模成独立语义
- 当前它仍然被工作区层当成 `versionControl = 'none' + original-dir` 处理

后续如果要继续统一体系，应该优先改这里，而不是继续扩展更多“目录兼容分支”。
