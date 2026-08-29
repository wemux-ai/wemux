// [INPUT]: web 反馈表单、server 反馈存储与 admin 管理共用的类型
// [OUTPUT]: TelemetryEventInput / FeedbackItem / 多源反馈契约（source/originRef/normalized/routing/githubRef/consentPublic）等跨端契约
// [POS]: 产品一手 telemetry 与用户反馈（bug / 功能建议）的统一类型；全渠道反馈收件箱的共享契约层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type FeedbackType = 'bug' | 'feature' | 'chat'

export type FeedbackStatus = 'open' | 'triaged' | 'closed'

/** 反馈来源渠道：产品内表单、飞书、Discord、GitHub 反向同步。 */
export type FeedbackSource = 'product' | 'feishu' | 'discord' | 'github'

/** 分诊去向：internal=受限维护队列，community=公开社区仓，none=仅客服闭环不建卡；缺省=尚未分诊。 */
export type FeedbackRoutingTarget = 'none' | 'internal' | 'community'

/** 渠道消息锚点：用于向原渠道回帖/回执（飞书话题、Discord thread 等）。 */
export type FeedbackOriginRef = {
  /** 渠道内侧标识，如飞书 chat_id / Discord channel id。 */
  channel: string
  /** 触发消息 id。 */
  messageId?: string
  /** 话题/thread id（如有）。 */
  threadId?: string
  /** 触发用户在渠道侧的展示名（可能匿名）。 */
  senderName?: string
}

/** AI 规范化产物（附加层；原始原文永远保留在 body，不覆盖）。 */
export type FeedbackNormalized = {
  /** 规范化完成时间（ISO）。 */
  at: string
  /** 生成方式：rule=纯规则分类（无模型），llm=大模型增强。 */
  method: 'rule' | 'llm'
  /** 结构化迷你 PRD 草稿：背景 / 场景 / 期望 / 验收标准。 */
  draft: {
    background?: string
    scenario?: string
    expectation?: string
    acceptance?: string[]
  }
  /** 语义查重命中的既有反馈 id（合并去重用）。 */
  duplicateOfId?: string
}

/** promote 到公开社区或受限维护队列后的引用。 */
export type FeedbackGithubRef = {
  kind: 'discussion' | 'issue'
  /** 落点范围：community=公开仓，internal=由部署环境配置的受限队列。 */
  scope: 'community' | 'internal'
  url: string
  number: number
  promotedAt: string
}

/** 反馈/聊天消息附件：复用个人 Drive 文件，仅存引用，渲染时按需下载预览。 */
export type FeedbackAttachment = {
  kind: 'drive'
  driveFileId: string
  name: string
  mimeType?: string
  sizeBytes?: number
}

export interface FeedbackItem {
  id: string
  type: FeedbackType
  title: string
  body: string
  status: FeedbackStatus
  userId?: string | null
  userEmail?: string | null
  createdAt: string
  updatedAt: string
  /** 客服会话（统一 conversation 模型）id；历史数据可能缺失。 */
  conversationId?: string
  /** 创始人/客服最近一次回复时间与正文预览（供「我的反馈」未读提示）。 */
  lastReplyAt?: string
  lastReplyPreview?: string
  /** 来源渠道；历史数据/产品内表单为 'product'。 */
  source?: FeedbackSource
  /** 渠道消息锚点（原路回复用）；产品内来源为空。 */
  originRef?: FeedbackOriginRef
  /** AI 规范化产物（分类/查重/结构化草稿）；未运行为空。 */
  normalized?: FeedbackNormalized
  /** 分诊去向决定：维护者判断是否进入公开社区；缺省=尚未分诊。 */
  routing?: FeedbackRoutingTarget
  /** 已 promote 到 GitHub 的引用；未公开为空。 */
  githubRef?: FeedbackGithubRef
  /** 用户同意脱敏后公开到社区提案；默认 false，未同意的内容不出实例。 */
  consentPublic?: boolean
}

/** 客服会话消息角色：user=用户侧，assistant=创始人/客服侧，system=系统通知。 */
export type FeedbackMessageRole = 'user' | 'assistant' | 'system'

/** 客服会话里的单条消息。 */
export interface FeedbackMessage {
  id: string
  feedbackId: string
  role: FeedbackMessageRole
  senderId?: string
  senderName?: string
  content: string
  createdAt: string
  /** 消息附件（图片等），引用个人 Drive 文件。 */
  attachments?: FeedbackAttachment[]
}

export type FeedbackSendMessagePayload = {
  content: string
  attachments?: FeedbackAttachment[]
}

export type FeedbackDetailResponse = {
  feedback: FeedbackItem
  messages: FeedbackMessage[]
}

export type FeedbackSubmitPayload = {
  type: FeedbackType
  title: string
  body: string
  attachments?: FeedbackAttachment[]
  /** 同意将本条反馈脱敏后公开为社区提案（默认 false）。 */
  consentPublic?: boolean
}

/** 产品一手 telemetry 事件类型（自有 analytics 数据源，不外发第三方） */
export type TelemetryEventType =
  | 'signup_completed'
  | 'invite_used'
  | 'onboarding_completed'
  | 'worker_paired'
  | 'task_created'
  | 'task_first_review'
  | 'feedback_submitted'

export interface TelemetryEventInput {
  eventType: TelemetryEventType
  userId?: string | null
  teamId?: string | null
  projectId?: string | null
  workspaceId?: string | null
  taskId?: string | null
  executorNodeId?: string | null
  payload?: Record<string, unknown>
}

export interface TelemetryEventRecord extends TelemetryEventInput {
  id: string
  createdAt: string
}
