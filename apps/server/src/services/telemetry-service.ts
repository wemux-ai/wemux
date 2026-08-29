// [INPUT]: server 侧业务事件与前端页面事件的统一埋点调用点
// [OUTPUT]: telemetry_events 唯一权威落点（自有 analytics，不外发第三方）
// [POS]: 产品一手 telemetry 服务；worker_paired / task_first_review / 前端漏斗事件全走 track()
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import type { TelemetryEventInput, TelemetryEventType } from '@shared/types'
import { persistTelemetryEvent } from '../storage/postgres/telemetry-store'

/**
 * 统一埋点入口。失败不抛错：埋点属于尽力而为的运营数据，
 * 不能因为打点失败拖垮主业务链路。
 */
export const track = async (input: TelemetryEventInput): Promise<void> => {
  try {
    await persistTelemetryEvent({
      id: `telemetry:${input.eventType}:${crypto.randomUUID()}`,
      eventType: input.eventType,
      userId: input.userId ?? undefined,
      teamId: input.teamId ?? undefined,
      projectId: input.projectId ?? undefined,
      workspaceId: input.workspaceId ?? undefined,
      taskId: input.taskId ?? undefined,
      executorNodeId: input.executorNodeId ?? undefined,
      payload: input.payload,
      createdAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[telemetry] failed to persist event', input.eventType, error)
  }
}

export type { TelemetryEventInput, TelemetryEventType }
