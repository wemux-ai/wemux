// [INPUT]: 商业能力调用请求
// [OUTPUT]: 计费/席位准入结果（CommercialGate 接口）
// [POS]: 商业能力网关——核心链路只依赖本模块的稳定接口，不直接 import 商业服务。
//        公开版：默认实现恒放行/恒空（禁止抛错，避免误伤 BYOK 链路）。
//        私有版：商业实现在启动时通过 registerCommercialGate 注入。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  BillingExecutionSessionKind,
  BillingFeatureAccess,
  BillingFeatureKey,
  BillingGateAction,
  BillingPolicySnapshot,
  BillingQuotaAccess,
  CreditAccountOwnerType,
  TeamSeatAccess,
  UserBillingAccess,
  AdminUserSubscriptionView,
  BillingPolicyConfig,
  DriveQuotaAccess,
  DriveQuotaLimits,
} from './commercial-gate-contract'

export type { DriveQuotaAccess } from './commercial-gate-contract'

export type {
  BillingGateAction,
  UserBillingAccess,
  BillingFeatureAccess,
  BillingFeatureKey,
  BillingPolicySnapshot,
  BillingQuotaAccess,
  BillingExecutionSessionKind,
  TeamSeatAccess,
}

/** 计费/席位准入结果的最小形状（公开版默认实现的返回值）。 */
export interface CommercialGateAccessResult {
  allowed: boolean
  enforcementEnabled: boolean
  requiresPaid: boolean
  hasActiveSubscription?: boolean
  activeSubscriptionIds?: string[]
  plan?: string
  status?: string
  message: string
}

export interface StartFreeExecutionSessionParams {
  userId: string
  sessionKey: string
  kind: BillingExecutionSessionKind
  token?: string
  [key: string]: unknown
}

export interface FinishFreeExecutionSessionParams {
  token: string
  userId?: string
  sessionKey?: string
  kind?: BillingExecutionSessionKind
  completed?: boolean
  eventId?: string
  completedAt?: string
}

/**
 * 商业能力网关接口。签名与私有仓商业服务保持一致；
 * 公开版默认实现为恒放行/空操作。
 */
export interface CommercialGate {
  /** 用户订阅列表（admin 用户详情展示；公开版恒空数组）。 */
  listUserSubscriptions(userId: string): Promise<AdminUserSubscriptionView[]>
  resolveUserBillingAccess(
    userId: string,
    action: BillingGateAction,
    options?: { environment?: string },
  ): Promise<UserBillingAccess>

  resolveBillingPolicySnapshot(
    scope: string | { teamId: string },
    options?: { environment?: string },
  ): Promise<BillingPolicySnapshot>

  resolveBillingFeatureAccess(
    userId: string,
    feature: BillingFeatureKey,
    options?: { environment?: string; teamId?: string },
  ): Promise<BillingFeatureAccess>

  isPremiumExecutionModel(executionModel: string | undefined): boolean

  getBillingPolicyConfig(): BillingPolicyConfig

  resolveTeamSeatAccess(
    teamId: string,
    role: import('@shared/types').TeamRole | string,
    options?: { excludeInvitationId?: string },
  ): Promise<TeamSeatAccess>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  startFreeExecutionSession(params: StartFreeExecutionSessionParams): Promise<any>

  finishFreeExecutionSession(params: FinishFreeExecutionSessionParams): Promise<unknown>

  resolveFreeExecutionQuotaAccess(userId: string): Promise<BillingQuotaAccess>

  recordFreeWorkspaceCreation(userId: string, workspaceId: string, createdAt?: string): void

  resolveFreeWorkspaceQuotaAccess(userId: string): Promise<BillingQuotaAccess>

  buildFreePrivateExecutorQuotaAccess(...args: unknown[]): BillingQuotaAccess

  resolveDriveQuotaLimits(plan: string | undefined): DriveQuotaLimits

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildDriveQuotaAccess(params: any): DriveQuotaAccess

  resolvePlanQuotaSnapshot(...args: unknown[]): Promise<unknown>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ensureSufficientBalance(ownerType: CreditAccountOwnerType, ownerId: string): Promise<any>

  // admin 积分查询（公开版返回空页/空对象；私有版由 credit-account-service 实现）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listAllAccounts(...args: unknown[]): Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAccountByOwner(ownerType: CreditAccountOwnerType, ownerId: string): Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listTransactions(...args: unknown[]): Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enrichAccountsWithOwner(items: Array<{ ownerType: 'user' | 'workspace'; ownerId: string }>): Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adjustBalance(params: unknown): Promise<any>
}

const accessAllowed = (message = '计费限制未启用。'): CommercialGateAccessResult => ({
  allowed: true,
  enforcementEnabled: false,
  requiresPaid: false,
  hasActiveSubscription: false,
  activeSubscriptionIds: [],
  plan: 'free',
  status: 'enforcement-disabled',
  message,
})

/** 公开版默认实现：恒放行 / 空操作（与既有 stub 语义一致）。 */
export const openSourceCommercialGate: CommercialGate = {
  async listUserSubscriptions() {
    return []
  },
  async resolveUserBillingAccess(userId, action, _options) {
    return accessAllowed(action) as unknown as UserBillingAccess
  },
  async resolveBillingPolicySnapshot() {
    return {
      scopeType: 'user',
      scopeId: '',
      plan: 'free',
      hasActiveSubscription: false,
      activeSubscriptionIds: [],
      features: {},
      enforcementEnabled: false,
    } as unknown as BillingPolicySnapshot
  },
  async resolveBillingFeatureAccess() {
    return {
      allowed: true,
      enforcementEnabled: false,
      requiresPaid: false,
      hasActiveSubscription: false,
      activeSubscriptionIds: [],
      message: '计费限制未启用。',
    } as unknown as BillingFeatureAccess
  },
  isPremiumExecutionModel: () => false,
  getBillingPolicyConfig: () => ({}) as BillingPolicyConfig,
  async resolveTeamSeatAccess() {
    return { allowed: true, message: '' } as unknown as TeamSeatAccess
  },
  async startFreeExecutionSession() {
    // 消费方校验 billingSession.allowed && billingSession.token 后放行；
    // 公开版无配额跟踪，返回占位 token 使主链路放行（finish 收到占位 token 为空操作）
    return { allowed: true, token: 'open-source-no-quota' }
  },
  async finishFreeExecutionSession() {
    return null
  },
  async resolveFreeExecutionQuotaAccess() {
    // 字段对齐 stubs/billing-quota-service（limit/used/remaining），避免新消费方读到 undefined
    return {
      allowed: true,
      enforcementEnabled: false,
      requiresPaid: false,
      hasActiveSubscription: false,
      limit: null,
      used: 0,
      remaining: null,
      message: '计费限制未启用。',
      status: 'enforcement-disabled',
    } as unknown as BillingQuotaAccess
  },
  recordFreeWorkspaceCreation: () => {},
  async resolveFreeWorkspaceQuotaAccess() {
    return {
      allowed: true,
      enforcementEnabled: false,
      requiresPaid: false,
      hasActiveSubscription: false,
      limit: null,
      used: 0,
      remaining: null,
      message: '计费限制未启用。',
      status: 'enforcement-disabled',
    } as unknown as BillingQuotaAccess
  },
  buildFreePrivateExecutorQuotaAccess: () => ({ allowed: true, enforcementEnabled: false, requiresPaid: false, message: '计费限制未启用。' }) as unknown as BillingQuotaAccess,
  resolveDriveQuotaLimits: (_plan) => {
    // 对齐 stub DRIVE_QUOTA_BY_PLAN.free（10GB 口径）
    const totalStorageBytes = 10 * 1024 * 1024 * 1024
    return { maxFileSizeBytes: 512 * 1024 * 1024, totalStorageBytes }
  },
  buildDriveQuotaAccess: () => {
    // 对齐 stub：10GB 额度口径
    const totalStorageBytes = 10 * 1024 * 1024 * 1024
    return {
      allowed: true,
      enforcementEnabled: false,
      requiresPaid: false,
      hasActiveSubscription: false,
      message: '计费限制未启用。',
      maxFileSizeBytes: Math.min(512 * 1024 * 1024, totalStorageBytes),
      totalStorageBytes,
      usedStorageBytes: 0,
      remainingStorageBytes: totalStorageBytes,
    } as unknown as DriveQuotaAccess
  },
  async resolvePlanQuotaSnapshot() {
    return null
  },
  async ensureSufficientBalance() {},
  async listAllAccounts() {
    return { items: [], hasMore: false }
  },
  async getAccountByOwner() {
    // 开源版无积分账户；消费方（MCP admin credits 工具）在公开版被剥离，私有版由注册实现覆盖
    return { id: '', ownerType: 'user', ownerId: '', balanceCredits: 0 }
  },
  async listTransactions() {
    return []
  },
  async enrichAccountsWithOwner(items) {
    return items.map((item) => ({ ...item, ownerName: '', ownerEmail: '' }))
  },
  async adjustBalance() {
    throw new Error('credits are not available in the open-source edition')
  },
}

let currentGate: CommercialGate = openSourceCommercialGate

/** 私有仓启动时注入商业实现；公开版不调用（保持默认恒放行）。 */
export const registerCommercialGate = (impl: CommercialGate): void => {
  currentGate = impl
}

/** 核心链路统一从这里获取商业能力网关。 */
export const getCommercialGate = (): CommercialGate => currentGate

/** CreditInsufficientError 公开版占位（私有版由 credit-account-service 注册真实错误类）。 */
let creditInsufficientErrorCtor: (new (message?: string) => Error) | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const registerCreditInsufficientError = (ctor: any): void => {
  creditInsufficientErrorCtor = ctor
}

export const createCreditInsufficientError = (message: string): Error => {
  if (creditInsufficientErrorCtor) {
    return new creditInsufficientErrorCtor(message)
  }
  const error = new Error(message)
  error.name = 'CreditInsufficientError'
  return error
}

export const isCreditInsufficientError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'CreditInsufficientError'
