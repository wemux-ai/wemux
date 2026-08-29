// [INPUT]: skill 服务类型输入
// [OUTPUT]: 类型定义
// [POS]: skill 服务类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { SkillRecord } from '@shared/skill'

export type SkillScanScope = 'project' | 'global'

export type SkillScanSkipped = {
  subjectId: string
  subjectName: string
  subjectType: 'project' | 'executor'
  attemptedPaths?: string[]
  executorId?: string | null
  executorName?: string | null
  path: string | null
  reason: string
}

export type SkillScanResult = {
  scope: SkillScanScope
  scannedProjects: number
  scannedExecutors: number
  discovered: number
  imported: SkillRecord[]
  updated: SkillRecord[]
  skipped: SkillScanSkipped[]
  warnings: string[]
}
