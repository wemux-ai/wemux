import { Activity, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import type { AdminAuditLogRecord } from '@/lib/api'
import { cn } from '@/lib/utils'

export type AuditEventTone = 'success' | 'error' | 'warning' | 'neutral'

/**
 * 审计事件分类（dashboard 与 audit 页共用）。
 * - payload.ok 是权威信号：agent 回合失败时即使事件类型仍是旧数据
 *   `agent.turn.completed`，也按失败展示。
 * - 否则按事件类型名兜底：fail/error → error，warning/pending/wait → warning，
 *   success/complete/approve → success，其余 neutral。
 */
export function classifyAuditEvent(
  log: Pick<AdminAuditLogRecord, 'eventType' | 'payload'>,
): AuditEventTone {
  const { eventType, payload } = log
  // 事件类型本身已表达语义时优先：waiting 是等待决策，不是失败。
  if (eventType === 'agent.turn.waiting') return 'warning'
  // payload.ok 是权威信号：旧数据中 agent.turn.completed 但 ok=false 也按失败展示。
  const payloadOk = payload?.ok
  if (typeof payloadOk === 'boolean') {
    return payloadOk ? 'success' : 'error'
  }
  if (/fail|error|reject|denied|blocked|suspended|banned/i.test(eventType)) return 'error'
  if (/warning|pending|wait/i.test(eventType)) return 'warning'
  if (/success|complete|approve/i.test(eventType)) return 'success'
  return 'neutral'
}

export function AuditEventIcon({
  log,
  className,
}: {
  log: Pick<AdminAuditLogRecord, 'eventType' | 'payload'>
  className?: string
}) {
  const tone = classifyAuditEvent(log)
  if (tone === 'error') return <XCircle className={cn('text-destructive', className)} />
  if (tone === 'success') return <CheckCircle2 className={cn('text-success', className)} />
  if (tone === 'warning') return <AlertTriangle className={cn('text-warning', className)} />
  return <Activity className={cn('text-muted-foreground', className)} />
}

export function getAuditEventBadgeVariant(
  log: Pick<AdminAuditLogRecord, 'eventType' | 'payload'>,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  const tone = classifyAuditEvent(log)
  if (tone === 'error') return 'destructive'
  if (tone === 'success') return 'default'
  if (tone === 'warning') return 'secondary'
  return 'outline'
}

/** 事件详情摘要：优先展示对管理员最有用的信息（失败原因、状态流转、审批标题等）。
 * t 可选：传入后工具调用/审批/渠道等片段会按当前语言翻译。 */
export function getAuditEventSummary(
  log: AdminAuditLogRecord,
  t?: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const p = log.payload ?? {}
  const translate = (key: string, options?: Record<string, unknown>) => t ? t(key, options) : ''
  switch (log.eventType) {
    case 'agent.turn.completed':
    case 'agent.turn.failed':
    case 'agent.turn.waiting': {
      const parts: string[] = []
      if (log.eventType === 'agent.turn.failed') {
        const preview = typeof p.outputPreview === 'string' ? p.outputPreview.trim() : ''
        if (preview) parts.push(preview.slice(0, 160))
      }
      if (typeof p.toolCallCount === 'number' && p.toolCallCount > 0) {
        const count = p.toolCallCount
        parts.push(t
          ? t('admin.audit.toolCalls', { count })
          : `${count} tool call${count === 1 ? '' : 's'}`)
      }
      if (typeof p.approvalRequestCount === 'number' && p.approvalRequestCount > 0) {
        const count = p.approvalRequestCount
        parts.push(t
          ? t('admin.audit.approvals', { count })
          : `${count} approval${count === 1 ? '' : 's'}`)
      }
      if (log.eventType !== 'agent.turn.failed' && typeof p.currentStep === 'string' && p.currentStep) {
        parts.push(p.currentStep.slice(0, 160))
      }
      return parts.length > 0 ? parts.join(' · ') : null
    }
    case 'task.status.changed': {
      const from = p.fromStatus
      const to = p.toStatus
      return from && to ? `${String(from)} → ${String(to)}` : null
    }
    case 'approval.requested':
      return typeof p.title === 'string' ? p.title.slice(0, 160) : null
    default:
      if (log.eventType.startsWith('channel.message.')) {
        return typeof p.channelType === 'string'
          ? t
            ? `${t('admin.audit.channelLabel')}: ${p.channelType}`
            : `Channel: ${p.channelType}`
          : null
      }
      return null
  }
}
