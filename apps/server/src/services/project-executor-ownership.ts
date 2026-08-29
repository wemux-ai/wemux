// [INPUT]: 归属校验输入
// [OUTPUT]: 归属判定
// [POS]: 项目 executor 归属
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ExecutorRecord, Project, ProjectBinding } from '@shared/types'

const resolveVersionControl = (project: Project) => project.versionControl ?? (project.gitUrl.trim() ? 'git-remote' : 'none')

export const resolveProjectOwningExecutorId = (
  project: Project,
  bindings: ProjectBinding[],
) => {
  const preferredExecutorId = project.preferredExecutorId?.trim()
  if (preferredExecutorId) {
    return preferredExecutorId
  }

  return bindings.find((binding) => binding.projectId === project.id && binding.isActive)?.nodeId?.trim() || ''
}

const getExecutorDisplayName = (
  executorId: string,
  executors: ExecutorRecord[],
) => {
  const executor = executors.find((item) => item.executorId === executorId)
  return executor?.name?.trim() || executor?.machineName?.trim() || executorId
}

export const validateProjectExecutorPathAccess = (params: {
  project: Project
  executorId: string
  bindings: ProjectBinding[]
  executors: ExecutorRecord[]
}) => {
  const executorId = params.executorId.trim()
  if (!executorId) {
    return {
      ok: false as const,
      message: '当前操作缺少目标执行节点。',
    }
  }

  const versionControl = resolveVersionControl(params.project)
  if (versionControl === 'git-remote') {
    return { ok: true as const }
  }

  const ownerExecutorId = resolveProjectOwningExecutorId(params.project, params.bindings)
  if (!ownerExecutorId || ownerExecutorId === executorId) {
    return { ok: true as const }
  }

  const ownerName = getExecutorDisplayName(ownerExecutorId, params.executors)
  const targetName = getExecutorDisplayName(executorId, params.executors)
  const ownerBinding = params.bindings.find((binding) => (
    binding.projectId === params.project.id
    && binding.nodeId === ownerExecutorId
    && binding.isActive
  ))
  const sourcePath = ownerBinding?.pathHint?.trim() || params.project.rootPath?.trim()
  const sourcePathMessage = sourcePath ? `源路径：${sourcePath}。` : ''
  if (versionControl === 'git-local') {
    return {
      ok: false as const,
      message: `本地 Git 项目目前只存在于执行节点「${ownerName}」，不能直接在目标执行节点「${targetName}」自动复用。${sourcePathMessage}请先上传或绑定到 Git remote，再在目标节点上重新准备仓库。`,
    }
  }

  return {
    ok: false as const,
    message: `当前空项目 / 无 Git 项目目前只存在于执行节点「${ownerName}」，不能直接在目标执行节点「${targetName}」自动复用。${sourcePathMessage}请先推送到 Git remote，或执行明确的项目迁移 / 复制流程。`,
  }
}
