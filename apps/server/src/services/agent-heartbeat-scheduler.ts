/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: agent_crons 心跳计划（复用表结构）、Agent 目录、Agent Event Runtime。
 * [OUTPUT]: 到点的定时心跳事件投递、心跳留痕（agent_heartbeats / lastHeartbeatAt）、幂等与防重叠。
 * [POS]: Agent 时间驱动的调度面；只发事件不执行，执行权保持在 worker 的 Agent runtime。
 */
import { readCustomAgentConfig } from '@shared/custom-agent'
import { nextCronTick, validateCron } from './automation-cron'
import { agentHeartbeat, countAgentHeartbeatDeliveriesSince, getAllAgents, getAgentTasks, getDueCrons, refreshAgentCronsStore, updateCronLastRun, type AgentCron } from '../repositories/agent'
import { publishAgentEvent, AGENT_HEARTBEAT_EVENT_TYPE } from './agent-event-runtime'
import { withPostgresLease } from '../storage/postgres/db'

const ACTIVE_EVENT_STATUSES = new Set(['pending', 'running', 'waiting'])

export const getAgentActiveHeartbeatTaskIds = (agentId: string) => {
  return getAgentTasks(agentId, Number.MAX_SAFE_INTEGER)
    .filter((task) => task.type === AGENT_HEARTBEAT_EVENT_TYPE && ACTIVE_EVENT_STATUSES.has(task.status))
    .map((task) => task.id)
}

/**
 * 过滤出本轮真正需要投递的到点心跳计划：
 * - agent 存在、自定义且未停用/未归档；
 * - 该 agent 没有进行中的心跳事件（防重叠，避免长任务堆积）；
 * - 幂等：同一计划同一槽位（nextRunAt 即到点 tick 时间）只投递一次。
 */
export const selectDueHeartbeatSchedules = (
  crons: AgentCron[],
  agents: Array<{ id: string; type: string; config: Record<string, unknown> }>,
  hasActiveHeartbeat: (agentId: string) => boolean,
  publishedKeys = new Set<string>(),
): Array<{ cron: AgentCron; slot: string }> => {
  const agentById = new Map(agents.map((agent) => [agent.id, agent]))
  const selected: Array<{ cron: AgentCron; slot: string }> = []

  for (const cron of crons) {
    const agent = agentById.get(cron.agentId)
    if (!agent) continue
    const profile = readCustomAgentConfig(agent.config)
    if (!profile.enabled || profile.archived) continue
    if (hasActiveHeartbeat(cron.agentId)) continue

    const slot = cron.nextRunAt
    if (!slot) continue
    const idempotencyKey = buildHeartbeatIdempotencyKey(cron.id, slot)
    if (publishedKeys.has(idempotencyKey)) continue
    publishedKeys.add(idempotencyKey)

    selected.push({ cron, slot })
  }

  return selected
}

export const buildHeartbeatIdempotencyKey = (scheduleId: string, slot: string) => {
  return `agent-heartbeat:${scheduleId}:${slot}`
}

/** 心跳活跃时段配置（payload.activeWindow，可选）：只在 [start, end) 内投递。 */
export type HeartbeatActiveWindow = {
  start: string
  end: string
  timezone: string
}

const TIME_ZONES = new Set(['UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Europe/Berlin', 'America/Los_Angeles', 'America/New_York'])

/** 读取计划 payload 中的活跃时段；非法结构返回 null。 */
export const readHeartbeatActiveWindow = (payload: Record<string, unknown>): HeartbeatActiveWindow | null => {
  const raw = payload.activeWindow
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const window = raw as Record<string, unknown>
  const start = typeof window.start === 'string' ? window.start.trim() : ''
  const end = typeof window.end === 'string' ? window.end.trim() : ''
  const timezone = typeof window.timezone === 'string' && TIME_ZONES.has(window.timezone) ? window.timezone : 'UTC'
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || start >= end) return null
  return { start, end, timezone }
}

/** 把 ISO 时刻转换到指定时区的 HH:mm（用于活跃时段判断）。 */
export const resolveTimeInZone = (iso: string, timeZone: string): string => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  const map = Object.fromEntries(formatter.formatToParts(new Date(iso)).map((part) => [part.type, part.value]))
  return `${map.hour}:${map.minute}`
}

/** 槽位是否落在活跃时段 [start, end) 内（HH:mm 字符串比较）。 */
export const isHeartbeatInActiveWindow = (slot: string, window: HeartbeatActiveWindow): boolean => {
  const local = resolveTimeInZone(slot, window.timezone)
  return local >= window.start && local < window.end
}

/** 读取计划 payload 的每日投递上限；非法返回 null（不限制）。 */
export const readHeartbeatDailyLimit = (payload: Record<string, unknown>): number | null => {
  const raw = payload.dailyLimit
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) return null
  return Math.min(raw, 1000)
}

/** 按槽位日期生成会话 day key（UTC YYYY-MM-DD）：同一天心跳共享会话，跨天开新会话防膨胀。 */
export const buildHeartbeatConversationDayKey = (slot: string, now = Date.now()) => {
  const parsed = Date.parse(slot)
  const date = Number.isFinite(parsed) && parsed <= now ? new Date(parsed) : new Date(now)
  return date.toISOString().slice(0, 10)
}

/** 心跳最低触发间隔（分钟）：控制 token 成本，防止 `* * * * *` 之类的滥用频率。 */
export const HEARTBEAT_MIN_INTERVAL_MINUTES = 5

/** 到点槽位超过该时长视为过期：跳过投递并推进 lastRunAt，避免长时间离线后的堆积 catch-up。 */
export const HEARTBEAT_STALE_SLOT_MS = 10 * 60 * 1000

/**
 * 校验 cron 表达式可解析且相邻两次触发间隔 >= 最低间隔；返回错误消息或 null。
 */
export const validateHeartbeatCronFrequency = (cronExpression: string): string | null => {
  const validationError = validateCron(cronExpression)
  if (validationError) return validationError

  const firstTick = nextCronTick(cronExpression, new Date())
  if (!firstTick) return '无法计算下一次触发时间。'
  const secondTick = nextCronTick(cronExpression, firstTick)
  if (!secondTick) return null
  const gapMinutes = (secondTick.getTime() - firstTick.getTime()) / 60_000
  if (gapMinutes < HEARTBEAT_MIN_INTERVAL_MINUTES) {
    return `心跳频率过高：相邻两次触发间隔 ${gapMinutes} 分钟，不能低于 ${HEARTBEAT_MIN_INTERVAL_MINUTES} 分钟。`
  }
  return null
}

export const startUtcDayIso = (now = Date.now()) => new Date(new Date(now).setUTCHours(0, 0, 0, 0)).toISOString()

/**
 * 处理一批到点心跳计划：发布 agent.heartbeat.tick 事件 + 心跳留痕 + 推进 lastRunAt/nextRunAt。
 * 单个计划失败不阻塞其余计划。
 */
export const dispatchDueHeartbeatSchedules = async (
  dueSchedules: Array<{ cron: AgentCron; slot: string }>,
  options: { bypassCostGuards?: boolean } = {},
): Promise<Array<{ scheduleId: string; eventId?: string; skipped?: boolean; reason?: string }>> => {
  const outcomes: Array<{ scheduleId: string; eventId?: string; skipped?: boolean; reason?: string }> = []
  const agents = getAllAgents()
  const agentById = new Map(agents.map((agent) => [agent.id, agent]))
  const todayIso = startUtcDayIso()

  for (const { cron, slot } of dueSchedules) {
    try {
      // 槽位过期（长任务阻塞 / 离线恢复）：不补投历史心跳，推进 lastRunAt 交给下一槽。
      if (Date.now() - Date.parse(slot) > HEARTBEAT_STALE_SLOT_MS) {
        updateCronLastRun(cron.id)
        outcomes.push({ scheduleId: cron.id, skipped: true, reason: 'stale-slot' })
        continue
      }

      // 活跃时段限制（payload.activeWindow）：不在 [start, end) 内则跳过并推进。手动触发绕过。
      const activeWindow = options.bypassCostGuards ? null : readHeartbeatActiveWindow(cron.payload)
      if (activeWindow && !isHeartbeatInActiveWindow(slot, activeWindow)) {
        updateCronLastRun(cron.id)
        outcomes.push({ scheduleId: cron.id, skipped: true, reason: 'outside-active-window' })
        continue
      }

      // 每日投递上限硬控（payload.dailyLimit）：当天已投递达到上限则跳过并推进。手动触发绕过。
      const dailyLimit = options.bypassCostGuards ? null : readHeartbeatDailyLimit(cron.payload)
      if (dailyLimit !== null && (await countAgentHeartbeatDeliveriesSince(cron.agentId, todayIso)) >= dailyLimit) {
        updateCronLastRun(cron.id)
        outcomes.push({ scheduleId: cron.id, skipped: true, reason: 'daily-limit-reached' })
        continue
      }

      const agent = agentById.get(cron.agentId)
      if (!agent) {
        outcomes.push({ scheduleId: cron.id, skipped: true, reason: 'agent-missing' })
        updateCronLastRun(cron.id)
        continue
      }

      const profile = readCustomAgentConfig(agent.config)
      const instruction = typeof cron.payload.instructions === 'string' ? cron.payload.instructions.trim() : ''
      const dayKey = buildHeartbeatConversationDayKey(slot)
      const events = publishAgentEvent({
        type: AGENT_HEARTBEAT_EVENT_TYPE,
        targetAgentId: cron.agentId,
        actingUserId: agent.ownerUserId || undefined,
        actor: { type: 'system' },
        scope: { scheduleId: cron.id },
        payload: {
          name: cron.name,
          cronExpression: cron.cronExpression,
          ...(instruction ? { instructions: instruction } : {}),
        },
        // 按天轮换会话 key：当天心跳共享一个 runtime session（有上下文），跨天自动开新会话，
        // 防止固定 key 导致会话无限膨胀（token 成本 + context 超限）。记忆靠 MEMORY.md 跨天延续。
        conversationKey: `agent-heartbeat:${cron.agentId}:${dayKey}`,
        idempotencyKey: buildHeartbeatIdempotencyKey(cron.id, slot),
      })

      const eventId = events.find((event) => event.type === AGENT_HEARTBEAT_EVENT_TYPE)?.id
      agentHeartbeat(cron.agentId, 'online', {
        source: 'schedule',
        scheduleId: cron.id,
        scheduleName: cron.name,
        tickAt: slot,
        ...(eventId ? { eventId } : {}),
      })
      updateCronLastRun(cron.id)
      outcomes.push({ scheduleId: cron.id, eventId })
    } catch (error) {
      console.error(`[agent-heartbeat] dispatch failed for schedule ${cron.id}:`, error)
      outcomes.push({ scheduleId: cron.id, skipped: true, reason: 'dispatch-error' })
    }
  }

  return outcomes
}

export const processDueAgentHeartbeats = async (): Promise<Array<{ scheduleId: string; eventId?: string; skipped?: boolean; reason?: string }>> => {
  // 跨实例一致性：持有 lease 后先从 DB 刷新 crons 缓存，识别其他实例的新计划与已推进状态。
  await refreshAgentCronsStore()
  const dueCrons = getDueCrons()
  if (dueCrons.length === 0) return []

  const agents = getAllAgents()
  const dueSchedules = selectDueHeartbeatSchedules(dueCrons, agents, (agentId) => {
    return getAgentActiveHeartbeatTaskIds(agentId).length > 0
  })
  return dispatchDueHeartbeatSchedules(dueSchedules)
}

/**
 * 手动立即触发一条心跳计划（设置页/测试用）：以当前时间为槽位投递，仍受防重叠约束。
 */
export const triggerHeartbeatScheduleNow = async (cron: AgentCron): Promise<{ scheduleId: string; eventId?: string; skipped?: boolean; reason?: string }> => {
  if (getAgentActiveHeartbeatTaskIds(cron.agentId).length > 0) {
    return { scheduleId: cron.id, skipped: true, reason: 'active-heartbeat-in-flight' }
  }
  const outcomes = await dispatchDueHeartbeatSchedules([{ cron, slot: new Date().toISOString() }], { bypassCostGuards: true })
  return outcomes[0] ?? { scheduleId: cron.id, skipped: true, reason: 'no-outcome' }
}

let scheduler: NodeJS.Timeout | null = null
let draining = false

export const startAgentHeartbeatScheduler = () => {
  if (scheduler) return
  console.log('[Agent] Starting heartbeat scheduler...')
  scheduler = setInterval(() => {
    if (draining) return
    draining = true
    void withPostgresLease('vibemux:scheduler:agent-heartbeats', processDueAgentHeartbeats)
      .then((lease) => {
        if (lease.acquired && lease.value.length > 0) {
          console.log('[agent-heartbeat] dispatched', JSON.stringify(lease.value))
        }
      })
      .catch((error) => console.error('[agent-heartbeat] scheduler error:', error))
      .finally(() => { draining = false })
  }, 30_000)
}

export const stopAgentHeartbeatScheduler = () => {
  if (scheduler) clearInterval(scheduler)
  scheduler = null
}
