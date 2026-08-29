// [INPUT]: 时间线、图谱装配服务的输入
// [OUTPUT]: 组织与时间线共享契约（今日时间线 / 会话参与时长 / 图谱节点边）
// [POS]: 组织（Organization）领域契约；消费方为 server 装配服务与 web 视图；可见性由路由层控制，本层只定义数据形态
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { WorkRecordTargetType, WorkRecordType } from './profile'

/** 今日时间线条目：可跳转的动作（任务/文件/文档/会话） */
export interface TimelineActivityItem {
  id: string
  recordType: WorkRecordType
  targetType: WorkRecordTargetType
  targetId: string | null
  title: string
  occurredAt: string
  metadataJson?: unknown
}

/** 会话参与时长（人 × 会话，活跃时长估算：turn 求和为主 + 消息跨度兜底） */
export interface SessionParticipation {
  conversationId: string
  /** 会话标题 */
  title: string
  /** conversations.kind：main / workspace / task / dm / external-thread */
  kind: string
  messageCount: number
  /** 活跃时长估算（分钟） */
  activeMinutes: number
}

/** 用户卡片摘要：基本资料 + 今日时间线摘要（Popover 卡片数据） */
export interface UserCardSummary {
  userId: string
  name: string
  /** 用户 ID（@username） */
  username: string | null
  avatarUrl: string | null
  title: string | null
  department: string | null
  /** 今日时间线条目（最多 N 条） */
  today: TimelineActivityItem[]
  /** 今日会话活跃时长合计（分钟） */
  todaySessionMinutes: number
}

/** 用户时间线详情（用户详情页） */
export interface UserTimelineDetail {
  userId: string
  /** 统计范围：today | 7d */
  range: 'today' | '7d'
  activities: TimelineActivityItem[]
  sessions: SessionParticipation[]
  totalSessionMinutes: number
}

/** Agent 时间线详情（与用户时间线同构：活动条目 + 会话参与时长） */
export interface AgentTimelineDetail {
  agentId: string
  /** 统计范围：today | 7d */
  range: 'today' | '7d'
  activities: TimelineActivityItem[]
  sessions: SessionParticipation[]
  totalSessionMinutes: number
}

/** 关系图谱节点 */
export interface OrgGraphNode {
  id: string
  type: 'user' | 'agent' | 'project' | 'conversation' | 'drive_file'
  label: string
  metadata?: {
    avatarUrl?: string | null
  }
}

/** 关系图谱边 */
export interface OrgGraphEdge {
  source: string
  target: string
  type: 'member' | 'owner' | 'participates' | 'produces' | 'references'
}

/** 关系图谱（按组织/部门过滤的轻量版） */
export interface OrgGraph {
  workspaceId: string
  nodes: OrgGraphNode[]
  edges: OrgGraphEdge[]
}
