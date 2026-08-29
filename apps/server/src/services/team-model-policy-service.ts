// [INPUT]: 团队模型白名单策略（meta 存储）与执行模型 id。
// [OUTPUT]: 白名单查询/设置 + 执行前校验（不在白名单拒绝）。
// [POS]: 协作区管理员治理；校验点挂在 workspace turn 统一模型解析与 main chat 模型校验处。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { getMeta, saveMeta } from '../storage/app-state-store'

export type TeamModelPolicy = {
  teamId: string
  /** null = 未启用白名单（不限）；非空数组 = 本协作区允许使用的 executionModel id 列表 */
  allowedModelIds: string[] | null
  updatedAt: string
}

export type TeamModelPolicyView = {
  teamId: string
  enabled: boolean
  allowedModelIds: string[]
  updatedAt: string | null
}

const TEAM_MODEL_POLICIES_META_KEY = 'billing:team-model-policies'

const readPolicies = (): TeamModelPolicy[] => getMeta<TeamModelPolicy[]>(TEAM_MODEL_POLICIES_META_KEY, [])

const writePolicies = (policies: TeamModelPolicy[]) => saveMeta(TEAM_MODEL_POLICIES_META_KEY, policies)

export const getTeamModelPolicy = (teamId: string): TeamModelPolicy | null => {
  return readPolicies().find((policy) => policy.teamId === teamId) ?? null
}

export const getTeamModelPolicyView = (teamId: string): TeamModelPolicyView => {
  const policy = getTeamModelPolicy(teamId)
  if (!policy || !policy.allowedModelIds) {
    return { teamId, enabled: false, allowedModelIds: [], updatedAt: null }
  }
  return {
    teamId,
    enabled: true,
    allowedModelIds: policy.allowedModelIds,
    updatedAt: policy.updatedAt,
  }
}

/**
 * 设置团队模型白名单。
 * @param allowedModelIds null 或空数组 = 关闭白名单（不限）；非空数组 = 开启并限定这些模型。
 */
export const setTeamModelPolicy = (teamId: string, allowedModelIds: string[] | null) => {
  const normalizedTeamId = teamId.trim()
  if (!normalizedTeamId) {
    throw new Error('teamId 不能为空。')
  }
  const policies = readPolicies().filter((policy) => policy.teamId !== normalizedTeamId)
  const normalized = Array.isArray(allowedModelIds)
    ? [...new Set(allowedModelIds.map((id) => id.trim()).filter(Boolean))]
    : []
  if (normalized.length === 0) {
    writePolicies(policies)
    return getTeamModelPolicyView(normalizedTeamId)
  }
  const policy: TeamModelPolicy = {
    teamId: normalizedTeamId,
    allowedModelIds: normalized,
    updatedAt: new Date().toISOString(),
  }
  writePolicies([...policies, policy])
  return getTeamModelPolicyView(normalizedTeamId)
}

/**
 * 执行前校验：团队白名单未启用或模型在白名单内则放行；否则返回拒绝原因。
 * 白名单只约束协作区归属执行，个人私有会话（无 teamId）不受影响。
 */
export const checkTeamModelAllowed = (teamId: string | undefined | null, executionModel: string | undefined | null): string | null => {
  if (!teamId?.trim() || !executionModel?.trim()) {
    return null
  }
  const policy = getTeamModelPolicy(teamId.trim())
  if (!policy?.allowedModelIds || policy.allowedModelIds.length === 0) {
    return null
  }
  if (policy.allowedModelIds.includes(executionModel.trim())) {
    return null
  }
  return `模型 ${executionModel} 不在本协作区允许使用的模型白名单内。请联系协作区管理员调整白名单，或选择白名单内的模型。`
}
