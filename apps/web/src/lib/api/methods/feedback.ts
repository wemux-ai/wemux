// [INPUT]: 反馈表单 / admin 反馈管理 / 前端页面事件上报的请求契约
// [OUTPUT]: feedback 与 telemetry 的 web API 方法
// [POS]: Web 控制面对 feedback / telemetry 的客户端表面；校验在 server 侧
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { request } from '../client'
import type {
  AdminAnalyticsResponse,
  FeedbackDetailResponse,
  FeedbackItem,
  FeedbackListResponse,
  FeedbackMutationResponse,
  FeedbackSendMessagePayload,
  FeedbackSendMessageResponse,
  FeedbackStatusUpdatePayload,
  FeedbackSubmitPayload,
  TelemetryEventType,
} from '../types'

export const feedbackMethods = {
  // 用户提交反馈（bug / 功能建议）
  submitFeedback: (payload: FeedbackSubmitPayload) =>
    request<FeedbackMutationResponse>('/api/feedback', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // 用户查看自己提交的反馈
  getMyFeedback: () => request<FeedbackListResponse>('/api/feedback/mine'),

  // 用户打开单个反馈会话（与创始人直接沟通）
  getFeedbackDetail: (id: string) =>
    request<FeedbackDetailResponse>(`/api/feedback/${encodeURIComponent(id)}`),

  // 与创始人的长聊天会话（单一长上下文线程；无则 feedback=null）
  getChatThread: () => request<FeedbackDetailResponse & { feedback: FeedbackItem | null }>('/api/feedback/chat'),

  // 发送与创始人的聊天消息（自动确保单一 chat 会话）
  sendChatMessage: (payload: FeedbackSendMessagePayload) =>
    request<FeedbackSendMessageResponse>('/api/feedback/chat/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // 问号红点：未读创始人回复/升级提醒数
  getFeedbackUnreadCount: () => request<{ count: number }>('/api/feedback/unread-count'),

  // 打开问号弹窗后：标已读全部创始人回复/升级提醒
  markFeedbackRepliesRead: () =>
    request<{ ok: boolean }>('/api/feedback/read-replies', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  // 用户在旧聊天继续沟通
  sendFeedbackMessage: (id: string, payload: FeedbackSendMessagePayload) =>
    request<FeedbackSendMessageResponse>(`/api/feedback/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // 管理员打开单个反馈会话（工单 + 消息）
  adminGetFeedbackDetail: (id: string) =>
    request<FeedbackDetailResponse>(`/api/admin/feedback/${encodeURIComponent(id)}`),

  // 管理员回复用户
  // 管理员回复用户
  adminReplyFeedback: (id: string, payload: FeedbackSendMessagePayload & { reviewed?: boolean }) =>
    request<FeedbackSendMessageResponse>(`/api/admin/feedback/${encodeURIComponent(id)}/reply`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // 管理员反馈列表
  getAdminFeedback: (payload?: { type?: FeedbackItem['type']; status?: FeedbackItem['status'] }) => {
    const query = new URLSearchParams()
    if (payload?.type) query.set('type', payload.type)
    if (payload?.status) query.set('status', payload.status)
    const qs = query.toString()
    return request<FeedbackListResponse>(`/api/admin/feedback${qs ? `?${qs}` : ''}`)
  },

  // Admin 侧栏红点：当前超时且仍等待管理员回复的反馈数。
  getAdminFeedbackAttentionCount: () => request<{ count: number }>('/api/admin/feedback/attention-count'),

  // 管理员更新反馈状态
  updateAdminFeedback: (id: string, payload: FeedbackStatusUpdatePayload) =>
    request<FeedbackMutationResponse>(`/api/admin/feedback/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // 管理员把反馈 promote 成 GitHub issue（internal=受限维护队列 / community=公开仓）
  promoteAdminFeedback: (id: string, payload: { scope: 'internal' | 'community' }) =>
    request<{ feedback: FeedbackItem }>(`/api/admin/feedback/${encodeURIComponent(id)}/promote`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // 管理员触发 AI 规范化（规则兜底 + 可选 LLM 增强）
  normalizeAdminFeedback: (id: string, payload?: { forceLlm?: boolean }) =>
    request<{ feedback: FeedbackItem }>(`/api/admin/feedback/${encodeURIComponent(id)}/normalize`, {
      method: 'POST',
      body: payload ? JSON.stringify(payload) : '{}',
    }),

  // 管理员让 AI 起草回复草稿（无模型配置时 draft: null）
  draftAdminReply: (id: string) =>
    request<{ draft: string | null; model: boolean }>(`/api/admin/feedback/${encodeURIComponent(id)}/draft-reply`, {
      method: 'POST',
      body: '{}',
    }),

  // 前端页面事件上报（自有 telemetry，不外发第三方）
  trackEvent: (payload: { eventType: TelemetryEventType; payload?: Record<string, unknown> }) =>
    request<{ ok: boolean }>('/api/telemetry/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // 自有 analytics 看板
  getAdminAnalytics: (days?: number) => {
    const search = days && Number.isFinite(days) ? `?days=${days}` : ''
    return request<AdminAnalyticsResponse>(`/api/admin/analytics${search}`)
  },

  // 社区版匿名使用上报看板（collector 聚合）
  getAdminCommunityUsage: () =>
    request<import('@shared/types').AdminCommunityUsageSummary>('/api/admin/community-usage'),
}
