// [INPUT]: 功能开关与节点能力
// [OUTPUT]: 可用性判定
// [POS]: worker 实验性功能闸门
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ExecutorFeatureFlags, ExperimentalFeatureFlag } from '@shared/user-experimental-settings'

export interface ExperimentalFeatureAvailability {
  enabled: boolean
  reason?: string   // 未开启/不可用时的明确原因
}

// 用户开关 + 节点能力自检；各能力落地时在此接入真实能力探测
// flag 类型来自 shared 注册表，新增 flag 自动可用
// （browserUse / computerUse / openConnector 等 worker 侧消息族使用；railway / brain / meetingListening 为 web/端侧展示 flag）
export const resolveExperimentalFeatureAvailability = (params: {
  flag: ExperimentalFeatureFlag
  featureFlags?: ExecutorFeatureFlags
  capabilities?: string[]            // WorkerConfig.capabilities
  globalEnvEnabled?: boolean         // 全局 env 闸门（DESKTOP_SANDBOX_ENABLED 同款），Phase 1/2 接真实 env
}): ExperimentalFeatureAvailability => {
  const { flag, featureFlags, capabilities, globalEnvEnabled = true } = params
  if (!globalEnvEnabled) {
    return { enabled: false, reason: `experimental.${flag}.disabled_by_env` }
  }
  if (!featureFlags?.[flag]) {
    return { enabled: false, reason: `experimental.${flag}.disabled_by_user` }
  }
  // 节点能力占位：Phase 1/2 用真实 desktop sandbox / CDP 能力探测替换
  if (capabilities && !capabilities.includes(`experimental.${flag}`)) {
    return { enabled: false, reason: `experimental.${flag}.unsupported_by_node` }
  }
  return { enabled: true }
}

// 消息 handler 入口调用：未开启时返回结构化拒绝。
export const assertExperimentalFeatureEnabled = (
  params: Parameters<typeof resolveExperimentalFeatureAvailability>[0],
): { ok: true } | { ok: false; code: 'feature_disabled'; reason: string } => {
  const availability = resolveExperimentalFeatureAvailability(params)
  return availability.enabled
    ? { ok: true }
    : { ok: false, code: 'feature_disabled', reason: availability.reason! }
}
