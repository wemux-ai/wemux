// [INPUT]: 实验性 flag 注册表（shared）
// [OUTPUT]: 面板渲染元信息
// [POS]: web 实验性功能面板 flag 元信息
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ExperimentalFeatureFlag } from '@shared/user-experimental-settings'

export interface ExperimentalFlagMeta {
  key: ExperimentalFeatureFlag
  /** i18n 前缀：settings.experimental.flags.<i18nKey>.title / .desc */
  i18nKey: string
  /** true = 能力面已接线（Phase 1/2 或分支合并后置 true）；false = 开关可保存但入口尚未接线 */
  wired: boolean
  risk: 'high' | 'medium' | 'low'
}

export const EXPERIMENTAL_FLAG_META: ExperimentalFlagMeta[] = [
  { key: 'browserUse', i18nKey: 'browserUse', wired: true, risk: 'high' },
  { key: 'computerUse', i18nKey: 'computerUse', wired: true, risk: 'high' },
  { key: 'openConnector', i18nKey: 'openConnector', wired: true, risk: 'medium' },
  { key: 'railway', i18nKey: 'railway', wired: true, risk: 'medium' },
  { key: 'brain', i18nKey: 'brain', wired: true, risk: 'medium' },
  { key: 'meetingListening', i18nKey: 'meetingListening', wired: true, risk: 'high' },
]
