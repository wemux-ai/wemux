// [INPUT]: 用户 token 配额策略（meta 存储）与 usage_events 周期消耗。
// [OUTPUT]: 配额快照 + 执行前检查（warn 只告警，block 阻断）。
// [POS]: Token 用量控制服务；执行入口（main chat / workspace turn / task）调用 ensureTokenQuotaAccess。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { getMeta, saveMeta } from '../storage/app-state-store'
import { listUsageEvents } from './usage-event-service'

export type TokenQuotaPeriod = 'day' | 'month'
export type TokenQuotaAction = 'warn' | 'block'

/** 配额来源：self=用户自设；team_admin=协作区管理员设置；platform_admin=平台管理员设置 */
export type TokenQuotaSetBy = 'self' | 'team_admin' | 'platform_admin'

export type TokenQuotaPolicy = {
  userId: string
  period: TokenQuotaPeriod
  limitTokens: number
  action: TokenQuotaAction
  enabled: boolean
  /** 配额设置来源；旧数据（无此字段）视为 self */
  setBy?: TokenQuotaSetBy
  updatedAt: string
}

export type TokenQuotaSnapshot = {
  policy: TokenQuotaPolicy | null
  usedTokens: number
  limitTokens: number | null
  remainingTokens: number | null
  usagePercent: number | null
  allowed: boolean
  message: string
  periodStart: string | null
}

const TOKEN_QUOTA_POLICIES_META_KEY = 'billing:token-quota-policies'

const readPolicies = (): TokenQuotaPolicy[] => getMeta<TokenQuotaPolicy[]>(TOKEN_QUOTA_POLICIES_META_KEY, [])

const writePolicies = (policies: TokenQuotaPolicy[]) => saveMeta(TOKEN_QUOTA_POLICIES_META_KEY, policies)

export const getTokenQuotaPolicy = (userId: string): TokenQuotaPolicy | null => {
  const policy = readPolicies().find((policy) => policy.userId === userId)
  if (!policy) {
    return null
  }
  // 旧数据无 setBy 字段时兜底为 self（不锁定用户自设入口）
  return policy.setBy ? policy : { ...policy, setBy: 'self' }
}

export const isQuotaManagedByAdmin = (policy: TokenQuotaPolicy | null): boolean => {
  return policy?.setBy === 'team_admin' || policy?.setBy === 'platform_admin'
}

export const setTokenQuotaPolicy = (params: {
  userId: string
  period: TokenQuotaPeriod
  limitTokens: number
  action: TokenQuotaAction
  enabled?: boolean
  setBy?: TokenQuotaSetBy
}) => {
  const limitTokens = Math.round(params.limitTokens)
  if (!Number.isFinite(limitTokens) || limitTokens < 0) {
    throw new Error('配额上限必须是非负整数。')
  }
  const policies = readPolicies().filter((policy) => policy.userId !== params.userId)
  if (limitTokens === 0) {
    // 0 视为关闭配额
    writePolicies(policies)
    return null
  }
  const policy: TokenQuotaPolicy = {
    userId: params.userId,
    period: params.period,
    limitTokens,
    action: params.action,
    enabled: params.enabled ?? true,
    setBy: params.setBy ?? 'self',
    updatedAt: new Date().toISOString(),
  }
  writePolicies([...policies, policy])
  return policy
}

export const clearTokenQuotaPolicy = (userId: string) => {
  const policies = readPolicies().filter((policy) => policy.userId !== userId)
  writePolicies(policies)
}

const resolvePeriodStart = (period: TokenQuotaPeriod, now: Date) => {
  if (period === 'day') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

export const resolveTokenQuotaPeriodStart = resolvePeriodStart

export const buildTokenQuotaSnapshot = async (userId: string, now = new Date()): Promise<TokenQuotaSnapshot> => {
  const policy = getTokenQuotaPolicy(userId)
  if (!policy || !policy.enabled) {
    return {
      policy: null,
      usedTokens: 0,
      limitTokens: null,
      remainingTokens: null,
      usagePercent: null,
      allowed: true,
      message: '未设置 token 配额。',
      periodStart: null,
    }
  }

  const periodStart = resolvePeriodStart(policy.period, now)
  const events = await listUsageEvents({ userId, since: periodStart })
  const usedTokens = events.reduce((sum, event) => sum + event.totalTokens, 0)
  const limitTokens = policy.limitTokens
  const remainingTokens = Math.max(0, limitTokens - usedTokens)
  const usagePercent = limitTokens > 0 ? Math.min(100, Math.round((usedTokens / limitTokens) * 100)) : 0
  const exceeded = usedTokens >= limitTokens
  const allowed = policy.action === 'warn' || !exceeded
  const periodLabel = policy.period === 'day' ? '今日' : '本月'
  const message = !exceeded
    ? `${periodLabel}已用 ${formatTokenCount(usedTokens)} / ${formatTokenCount(limitTokens)} tokens。`
    : policy.action === 'warn'
      ? `${periodLabel}已用 ${formatTokenCount(usedTokens)} / ${formatTokenCount(limitTokens)} tokens，已超限（warn 模式不阻断执行）。`
      : `${periodLabel}token 配额（${formatTokenCount(limitTokens)}）已用完，已暂停新的 Agent 执行。请调整配额或等待周期重置。`

  return {
    policy,
    usedTokens,
    limitTokens,
    remainingTokens,
    usagePercent,
    allowed,
    message,
    periodStart,
  }
}

export class TokenQuotaLimitError extends Error {
  readonly statusCode = 429
  readonly snapshot: TokenQuotaSnapshot

  constructor(snapshot: TokenQuotaSnapshot) {
    super(snapshot.message)
    this.name = 'TokenQuotaLimitError'
    this.snapshot = snapshot
  }
}

export const isTokenQuotaLimitError = (error: unknown): error is TokenQuotaLimitError => {
  return error instanceof TokenQuotaLimitError
}

/** 执行前配额检查：block 且超限时抛 TokenQuotaLimitError；warn 或未超限返回快照。 */
export const ensureTokenQuotaAccess = async (userId: string): Promise<TokenQuotaSnapshot> => {
  const snapshot = await buildTokenQuotaSnapshot(userId)
  if (!snapshot.allowed) {
    throw new TokenQuotaLimitError(snapshot)
  }
  return snapshot
}

const formatTokenCount = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}
