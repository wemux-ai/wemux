// [INPUT]: 无项目自由工作区（playground）的共享标识与判定。
// [OUTPUT]: 系统保留虚拟项目常量 + 纯函数判定。
// [POS]: playground workspace 的 task 层兜底上下文；不承载 DB / 业务实现。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { generatePlaygroundSuffix } from './workspace-paths'

/**
 * 系统保留的「自由工作区」虚拟项目 id。
 *
 * 无项目 workspace 的 projectId 指向它（保持 workspaces.project_id NOT NULL，
 * 避免 task 层大规模可空改造）。它必须满足：
 * - versionControl: 'none'（git / worktree / 分支全部短路）
 * - gitUrl: ''（无远端）
 * - 不出现在用户可见项目列表，不可被用户选择
 * - 不参与 GitHub 资源绑定 / Drive 共享 / PR 关联
 */
export const PLAYGROUND_PROJECT_ID = '__playground__'

export const PLAYGROUND_PROJECT_NAME = '自由工作区'

export const PLAYGROUND_PROJECT_SLUG = 'playground'

export const isPlaygroundProjectId = (projectId?: string | null) => projectId === PLAYGROUND_PROJECT_ID

export const isPlaygroundProject = (project?: { id?: string | null } | null) => isPlaygroundProjectId(project?.id)
