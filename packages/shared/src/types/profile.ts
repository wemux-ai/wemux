// [INPUT]: 无（纯类型定义）
// [OUTPUT]: 画像系统领域类型（UserProfile / AgentProfile / WorkRecord）及 API 载荷
// [POS]: 画像共享契约；消费方是 Agent（决策上下文）与人类（概览页）；可见性由 visibility + 共同组织控制
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type ProfileVisibility = 'private' | 'team' | 'public'

export interface UserProfileRecord {
  userId: string
  /** 职位/角色，如「前端工程师」 */
  title: string | null
  /** 所属部门/团队（自由文本标签，仅展示） */
  department: string | null
  /** 技能标签 */
  skills: string[] | null
  /** 当前周期 OKR：{ period, objectives: [{ id, title, keyResults }] } */
  okrJson: unknown | null
  /** 最近工作摘要（由 Agent 定期生成） */
  workSummaryJson: unknown | null
  visibility: ProfileVisibility
  createdAt: string
  updatedAt: string
}

export interface AgentProfileRecord {
  /** custom agent id */
  agentId: string
  /** 身份描述：{ role, summary, expertise, communicationStyle, workingHours } */
  identityJson: unknown | null
  /** Agent OKR（与 user_profiles 同结构） */
  okrJson: unknown | null
  /** 活动日志摘要 */
  activityLogJson: unknown | null
  /** 健康评分 0-1，由系统计算 */
  healthScore: number | null
  lastActiveAt: string | null
  createdAt: string
  updatedAt: string
}

export type WorkRecordType = 'task_completed' | 'task_dispatched' | 'drive_file_created' | 'drive_file_updated' | 'conversation'

export type WorkRecordTargetType = 'task' | 'drive_file' | 'conversation' | 'workspace'

export interface WorkRecord {
  id: string
  actorType: 'user' | 'agent'
  actorId: string
  recordType: WorkRecordType
  targetType: WorkRecordTargetType
  targetId: string | null
  title: string
  summary: string | null
  metadataJson: unknown | null
  occurredAt: string
  createdAt: string
}

export interface UpdateUserProfileInput {
  title?: string | null
  department?: string | null
  skills?: string[] | null
  okrJson?: unknown | null
  workSummaryJson?: unknown | null
  visibility?: ProfileVisibility
}

export interface UpdateAgentProfileInput {
  identityJson?: unknown | null
  okrJson?: unknown | null
  activityLogJson?: unknown | null
  healthScore?: number | null
  lastActiveAt?: string | null
}
