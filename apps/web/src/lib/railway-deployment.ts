// [INPUT]: Railway 部署事实 + 绑定 + workspace/session/branch 匹配参数。
// [OUTPUT]: Railway 部署 badge 显示对象与工作区索引解析。
// [POS]: Web 侧 Railway 部署展示解析（与 task-pull-request 同构，badge tone/icon 在此层）。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import {
  buildRailwayResourceId,
  isActiveRailwayResourceBinding,
  isRailwayDeploymentActive,
  resolveRailwayDeploymentStatusGroup,
  type RailwayDeploymentStatusGroup,
  type RailwayDeploymentSummary,
  type RailwayResourceBinding,
} from '@shared/types'

export type RailwayDeploymentDisplay = {
  url?: string
  prNumber?: number
  environmentName: string
  status: RailwayDeploymentSummary['status']
  label: string
  compactLabel: string
  toneClassName: string
  icon: 'success' | 'building' | 'failed' | 'sleeping'
}

const normalizeBranch = (value?: string | null) => value?.trim() || ''

const statusGroupRank = (group: RailwayDeploymentStatusGroup) => {
  if (group === 'success') return 4
  if (group === 'building') return 3
  if (group === 'failed') return 2
  if (group === 'sleeping') return 1
  return 0
}

const compareRailwayDeploymentsDesc = (
  left: RailwayDeploymentSummary,
  right: RailwayDeploymentSummary,
) => {
  const rankDiff = statusGroupRank(resolveRailwayDeploymentStatusGroup(right.status))
    - statusGroupRank(resolveRailwayDeploymentStatusGroup(left.status))
  if (rankDiff !== 0) {
    return rankDiff
  }

  return (right.updatedAt || '').localeCompare(left.updatedAt || '')
}

const buildRailwayDeploymentDisplay = (
  deployment: RailwayDeploymentSummary,
): RailwayDeploymentDisplay => {
  const group = resolveRailwayDeploymentStatusGroup(deployment.status)
  const url = deployment.url?.trim() || deployment.staticUrl?.trim() || undefined
  const environmentName = deployment.environmentName?.trim() || 'environment'

  if (group === 'failed') {
    return {
      url,
      prNumber: deployment.prNumber,
      environmentName,
      status: deployment.status,
      label: '部署失败',
      compactLabel: '失败',
      toneClassName: 'bg-red-500/10 text-red-300',
      icon: 'failed',
    }
  }

  if (group === 'building') {
    return {
      url,
      prNumber: deployment.prNumber,
      environmentName,
      status: deployment.status,
      label: '构建中',
      compactLabel: '构建中',
      toneClassName: 'bg-amber-500/10 text-amber-300',
      icon: 'building',
    }
  }

  if (group === 'sleeping') {
    return {
      url,
      prNumber: deployment.prNumber,
      environmentName,
      status: deployment.status,
      label: '已休眠',
      compactLabel: '休眠',
      toneClassName: 'bg-zinc-500/10 text-zinc-300',
      icon: 'sleeping',
    }
  }

  return {
    url,
    prNumber: deployment.prNumber,
    environmentName,
    status: deployment.status,
    label: '已部署',
    compactLabel: '已部署',
    toneClassName: 'bg-emerald-500/10 text-emerald-300',
    icon: 'success',
  }
}

export const resolveRailwayDeploymentDisplay = (
  deployment?: RailwayDeploymentSummary | null,
): RailwayDeploymentDisplay | null => {
  if (!deployment || !isRailwayDeploymentActive(deployment.status)) {
    return null
  }

  return buildRailwayDeploymentDisplay(deployment)
}

export const resolveWorkspaceIndexedRailwayDeploymentDisplay = (params: {
  deployments: RailwayDeploymentSummary[]
  bindings?: RailwayResourceBinding[]
  projectId?: string
  workspaceId?: string
  workspaceSessionIds?: string[]
  compareBranch?: string
}): RailwayDeploymentDisplay | null => {
  const workspaceId = params.workspaceId?.trim() || ''
  const workspaceSessionIds = new Set(
    (params.workspaceSessionIds ?? [])
      .map((workspaceSessionId) => workspaceSessionId.trim())
      .filter(Boolean),
  )
  const compareBranch = normalizeBranch(params.compareBranch)
  const deployments = params.deployments
    .filter((deployment) => isRailwayDeploymentActive(deployment.status))
    .sort(compareRailwayDeploymentsDesc)

  if (params.bindings) {
    const resourceIds = new Set(
      params.bindings
        .filter(isActiveRailwayResourceBinding)
        .filter((binding) => (
          binding.resourceType === 'deployment'
          && (
            (workspaceId && binding.workspaceId === workspaceId)
            || (
              binding.workspaceSessionId
              && workspaceSessionIds.has(binding.workspaceSessionId)
            )
          )
        ))
        .map((binding) => binding.resourceId),
    )
    const matched = deployments.find((deployment) => resourceIds.has(buildRailwayResourceId({
      railwayProjectId: deployment.railwayProjectId,
      environmentId: deployment.environmentId,
      deploymentId: deployment.id,
    })))
    if (matched) {
      return resolveRailwayDeploymentDisplay(matched)
    }
  }

  if (compareBranch) {
    const matched = deployments.find((deployment) => (
      normalizeBranch(deployment.branch) === compareBranch
    ))
    if (matched) {
      return resolveRailwayDeploymentDisplay(matched)
    }
  }

  return null
}
