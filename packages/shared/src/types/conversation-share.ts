// [INPUT]: 无（纯类型定义）
// [OUTPUT]: 会话分享与 @ 记录领域类型（ConversationShare / ConversationMention）
// [POS]: 会话分享与 @ 机制共享契约；分享 = 链接/转发，@ = 记录 + 状态机（pending/acknowledged/acted）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type ConversationShareType = 'link' | 'forward'

export type ConversationShareAccessScope = 'members' | 'link' | 'public'

export interface ConversationShareRecord {
  id: string
  conversationId: string
  /** 分享的具体消息（可为空 = 分享整个会话） */
  messageId: string | null
  sharedBy: string
  sharedByType: 'user' | 'agent'
  shareType: ConversationShareType
  /** 转发到的目标会话（forward 类型） */
  targetConversationId: string | null
  accessScope: ConversationShareAccessScope
  /** 访问令牌（link 类型用） */
  shareToken: string | null
  expiresAt: string | null
  metadataJson: unknown | null
  createdAt: string
}

export type ConversationMentionType = 'user' | 'agent' | 'conversation' | 'doc' | 'workspace'

export type ConversationMentionScope = 'agent_in_chat' | 'share_conversation' | 'reference_doc' | 'share_workspace'

export type ConversationMentionStatus = 'pending' | 'acknowledged' | 'acted'

export interface ConversationMentionRecord {
  id: string
  conversationId: string
  messageId: string | null
  mentionerId: string
  mentionerType: 'user' | 'agent'
  mentionedId: string
  mentionedType: ConversationMentionType
  mentionScope: ConversationMentionScope
  contextJson: unknown | null
  status: ConversationMentionStatus
  createdAt: string
}
