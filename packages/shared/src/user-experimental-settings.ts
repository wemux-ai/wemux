// [INPUT]: 实验性设置输入
// [OUTPUT]: 设置契约
// [POS]: 用户实验性功能设置
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type ExperimentalFeatureFlag =
  | 'browserUse'
  | 'computerUse'
  | 'openConnector'
  | 'railway'
  | 'brain'
  | 'meetingListening'

// 注册表：UI 渲染顺序 + normalize/默认值循环的唯一数据源
// 新增 flag 时：在这里加 key + 在 interface 加字段（两处同步）
export const EXPERIMENTAL_FEATURE_FLAG_KEYS: ExperimentalFeatureFlag[] = [
  'browserUse',
  'computerUse',
  'openConnector',
  'railway',
  'brain',
  'meetingListening',
]

export interface UserExperimentalSettings {
  browserUse: boolean
  computerUse: boolean
  openConnector: boolean
  railway: boolean
  brain: boolean
  meetingListening: boolean
}

export const defaultUserExperimentalSettings = (): UserExperimentalSettings =>
  Object.fromEntries(EXPERIMENTAL_FEATURE_FLAG_KEYS.map((key) => [key, false])) as unknown as UserExperimentalSettings

const toBoolean = (value: unknown, fallback: boolean) =>
  typeof value === 'boolean' ? value : fallback

export const normalizeUserExperimentalSettings = (
  value: unknown,
): UserExperimentalSettings => {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries(
    EXPERIMENTAL_FEATURE_FLAG_KEYS.map((key) => [key, toBoolean(record[key], false)]),
  ) as unknown as UserExperimentalSettings
}

// —— executor 下发快照：与用户设置同形，语义为「下发到 worker 的最终开关快照」——
// 单一数据源，避免三端各复制一份类型漂移。
export type ExecutorFeatureFlags = UserExperimentalSettings

export const defaultExecutorFeatureFlags = defaultUserExperimentalSettings

export const toExecutorFeatureFlags = (
  value: unknown,
): ExecutorFeatureFlags => normalizeUserExperimentalSettings(value)
