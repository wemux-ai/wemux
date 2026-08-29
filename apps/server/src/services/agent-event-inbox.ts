/**
 * [INPUT]: Product Agent events with actor, task/workspace scope and optional causal Inbox metadata.
 * [OUTPUT]: Pure Inbox publish intents and bounded A2A loop-guard decisions.
 * [POS]: Product-event-to-Inbox adapter; agent-event-runtime owns queueing, this module owns notification semantics.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { buildTaskInboxGroupKey, type InboxItemKind, type InboxItemReason } from '@shared/inbox'
import type { InboxPublishInput } from './inbox-service'
import type { AgentEventInput } from './agent-event-runtime'

export const INBOX_MAX_HOPS = 8
export const INBOX_MAX_FANOUT_PER_RUN = 4
export const INBOX_MAX_CHAIN_AGE_MS = 30 * 60_000

const eventSemantics = (type: string): { kind: InboxItemKind; reason: InboxItemReason } => {
  if (type === 'task.assigned') return { kind: 'directive', reason: 'assigned' }
  if (type === 'task.started') return { kind: 'directive', reason: 'started' }
  if (type === 'task.status.changed') return { kind: 'directive', reason: 'status_changed' }
  if (type.startsWith('task.comment.')) return { kind: 'mention', reason: 'mentioned' }
  if (type === 'workspace.session.completed') return { kind: 'handoff', reason: 'workspace_completed' }
  if (type === 'workspace.session.failed') return { kind: 'handoff', reason: 'workspace_failed' }
  if (type === 'workspace.session.waiting') return { kind: 'handoff', reason: 'workspace_needs_input' }
  if (type === 'agent.handoff.requested') return { kind: 'directive', reason: 'handoff_requested' }
  if (type === 'agent.handoff.returned') return { kind: 'handoff', reason: 'handoff_returned' }
  if (type === 'task.quick_create.requested') return { kind: 'directive', reason: 'quick_create' }
  return { kind: 'directive', reason: 'generic_event' }
}

const titleFromEvent = (event: AgentEventInput) => (
  typeof event.payload?.title === 'string' && event.payload.title.trim()
    ? event.payload.title.trim()
    : typeof event.payload?.taskTitle === 'string' && event.payload.taskTitle.trim()
      ? event.payload.taskTitle.trim()
      : event.type
)

const bodyFromEvent = (event: AgentEventInput) => {
  for (const candidate of [event.payload?.handoffPrompt, event.payload?.comment, event.payload?.description, event.payload?.request]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return titleFromEvent(event)
}

export const buildAgentEventInboxItem = (params: {
  agentId: string
  actorName?: string
  event: AgentEventInput
  itemId?: string
}): InboxPublishInput & { itemId: string } => {
  const { event } = params
  const scope = event.scope ?? {}
  const semantics = eventSemantics(event.type)
  const taskId = scope.taskId
  const conversationKey = event.conversationKey?.trim() || `agent:${params.agentId}`
  const itemId = params.itemId ?? crypto.randomUUID()
  const sourceInboxItemId = event.sourceInboxItemId?.trim() || undefined
  const traceId = event.traceId?.trim() || itemId
  const chainStartedAt = event.chainStartedAt?.trim() || new Date().toISOString()
  return {
    itemId,
    recipientType: 'agent',
    recipientId: params.agentId,
    kind: semantics.kind,
    reason: semantics.reason,
    eventType: event.type,
    actor: { ...event.actor, name: params.actorName },
    title: titleFromEvent(event),
    body: bodyFromEvent(event),
    scope,
    groupKey: taskId ? buildTaskInboxGroupKey(taskId) : conversationKey,
    replyTo: event.replyTo ?? (taskId
      ? {
          kind: 'task_comment',
          taskId,
          ...(scope.commentId ? { parentCommentId: scope.commentId } : {}),
        }
      : { kind: 'none' }),
    traceId,
    chainStartedAt,
    sourceInboxItemId,
    hopCount: event.hopCount ?? (sourceInboxItemId ? 1 : 0),
    // dedupeKey 必须只由 itemId 决定：itemId 是同一 inbox item 的稳定身份，
    // 而 idempotencyKey 会在 retry/resume 时被剥离或合并，导致 reconciliation
    // 里 dedupeKey 漂移、进而与主键 id 冲突。跨事件的幂等去重已在 task 层完成。
    dedupeKey: `agent-event:${itemId}`,
  }
}

export type InboxLoopGuardResult =
  | { ok: true }
  | { ok: false; reason: 'max_hops' | 'max_fanout' | 'max_chain_age'; message: string }

export const checkInboxLoopGuard = (params: {
  hopCount: number
  fanoutCount: number
  chainStartedAt: string
  now?: number
}): InboxLoopGuardResult => {
  if (params.hopCount >= INBOX_MAX_HOPS) {
    return { ok: false, reason: 'max_hops', message: `A2A 链已达到 ${INBOX_MAX_HOPS} 跳上限。` }
  }
  if (params.fanoutCount >= INBOX_MAX_FANOUT_PER_RUN) {
    return { ok: false, reason: 'max_fanout', message: `本轮 A2A 已达到 ${INBOX_MAX_FANOUT_PER_RUN} 个目标上限。` }
  }
  const startedAt = Date.parse(params.chainStartedAt)
  if (!Number.isFinite(startedAt) || (params.now ?? Date.now()) - startedAt > INBOX_MAX_CHAIN_AGE_MS) {
    return { ok: false, reason: 'max_chain_age', message: 'A2A 链已超过 30 分钟有效期。' }
  }
  return { ok: true }
}
