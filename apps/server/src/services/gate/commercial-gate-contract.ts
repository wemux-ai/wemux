// [INPUT]: 无（纯类型契约模块）
// [OUTPUT]: 商业网关的契约类型（BillingGateAction / UserBillingAccess / BillingFeature* /
//           BillingPolicySnapshot / BillingQuota* / BillingExecutionSessionKind / TeamSeatAccess）
// [POS]: 核心契约层——gate 与商业服务共同依赖本文件，依赖方向为「商业服务 → 核心契约」，
//        核心不 import 任何商业服务文件。商业服务保持 re-export 以兼容既有 import 路径。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { TeamRole } from '@shared/types'

export type CreditAccountOwnerType = 'user' | 'workspace'

export type BillingGateAction = 'create_task' | 'execute_task'

export type BillingPlan = 'free' | 'pro' | 'team' | 'unknown'

export type UserBillingAccess = {
  action: BillingGateAction
  allowed: boolean
  enforcementEnabled: boolean
  requiresPaid: boolean
  hasActiveSubscription: boolean
  activeSubscriptionIds: string[]
  plan: BillingPlan
  status: 'active' | 'inactive' | 'not-required' | 'enforcement-disabled'
  message: string
}

export type BillingFeatureKey = 'create_task' | 'execute_task' | 'premium_models' | 'team_features' | 'workspace_brain'

export type BillingFeatureAccess = {
  feature: BillingFeatureKey
  allowed: boolean
  enforcementEnabled: boolean
  requiresPaid: boolean
  plan: BillingPlan
  requiredPlan: BillingPlan
  hasActiveSubscription: boolean
  activeSubscriptionIds: string[]
  message: string
}

export type BillingPolicySnapshot = {
  enforcementEnabled: boolean
  scopeType: 'user' | 'team'
  scopeId: string
  plan: BillingPlan
  hasActiveSubscription: boolean
  activeSubscriptionIds: string[]
  features: Record<BillingFeatureKey, BillingFeatureAccess>
}

export type BillingQuotaAccess = {
  allowed: boolean
  limit: number | null
  used: number
  remaining: number | null
  message: string
}

export type DriveQuotaAccess = BillingQuotaAccess & { maxFileSizeBytes: number }

export type FreeQuotaMetric = {
  limit: number | null
  used: number
  remaining: number | null
}

export type FreeQuotaSnapshot = {
  dailyExecutionSessions: FreeQuotaMetric
  concurrentExecutionSessions: FreeQuotaMetric
  activeWorkspaces: FreeQuotaMetric
  dailyWorkspaceCreations: FreeQuotaMetric
  privateExecutors: FreeQuotaMetric
}

export type BillingExecutionSessionKind =
  | 'main_chat'
  | 'custom_agent_chat'
  | 'task_chat'
  | 'workspace_group_chat'

export type TeamSeatAccess = {
  allowed: boolean
  enforcementEnabled: boolean
  teamId: string
  role: TeamRole
  includedSeats?: number
  occupiedSeats: number
  reservedSeats: number
  availableSeats?: number
  activeSubscriptionId?: string
  message: string
}

export type AdminUserSubscriptionView = {
  id: string
  productName: string | null
  status: string
  currentPeriodStartAt: string | null
  currentPeriodEndAt: string | null
  canceledAt: string | null
  amountPaid: number | null
  environment: 'live' | 'test'
  updatedAt: string
}

export type BillingPolicyConfig = {
  enforcementEnabled: boolean
  enabledFeatures?: Set<BillingFeatureKey>
  premiumModels?: string[] | Set<string>
}

export type DriveQuotaLimits = { maxFileSizeBytes: number; totalStorageBytes: number }
