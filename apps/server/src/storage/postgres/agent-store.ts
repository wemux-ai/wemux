/**
 * [INPUT]: User-owned Agent definitions, one-time initial Agent provisioning, inbox task mutations, cron schedules, and heartbeat snapshots.
 * [OUTPUT]: Cached ordinary Agent records plus result-preserving task lifecycle mutations; no Agent remains system-managed after creation.
 * [POS]: Postgres-backed repository for custom Agent control-plane state.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { desc, eq, sql } from 'drizzle-orm'

import { BUILT_IN_AGENT_AVATAR_URLS } from '@shared/agent-avatars'
import { isCustomAgentEnabled, readCustomAgentConfig, writeCustomAgentConfig } from '@shared/custom-agent'
import type { AgentRecord as SharedAgentRecord } from '@shared/types'
import { nextCronTickInTimeZone, validateCron } from '../../services/automation-cron'
import { getAgentWorkdirSummary } from '../../services/agent-workdir-service'
import { ensurePostgresReady } from './db'
import { getDrizzleDb, withDrizzleTransaction } from './drizzle-db'
import { cloneJson, schedulePersistence } from './helpers'
import { agentCrons, agentHeartbeats, agents, agentTasks, users } from './schema'

export type Agent = SharedAgentRecord

export type AgentRecord = Agent

export type AgentTask = {
  id: string
  agentId: string
  type: string
  payload: Record<string, unknown>
  status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'canceled'
  result: Record<string, unknown> | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

export type AgentCron = {
  id: string
  agentId: string
  name: string
  cronExpression: string
  payload: Record<string, unknown>
  enabled: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  createdAt: string
}

const cache = {
  agents: [] as Agent[],
  tasks: [] as AgentTask[],
  crons: [] as AgentCron[],
  heartbeats: [] as Array<{ id: string; agentId: string; status: string; metrics: Record<string, unknown> | null; createdAt: string }>,
}

/** 心跳缓存上限（DB 有清理策略；内存缓存只保留最近这批，避免表增长时缓存膨胀）。 */
const AGENT_HEARTBEATS_CACHE_LIMIT = 5000

/** 每 agent 保留的心跳记录上限 / 最大保留天数（agent_heartbeats 保留策略）。 */
export const AGENT_HEARTBEATS_MAX_PER_AGENT = 200
export const AGENT_HEARTBEATS_MAX_AGE_DAYS = 30

/**
 * agent_heartbeats 保留策略清理：每 agent 保留最近 MAX_PER_AGENT 条 + 删除超过 MAX_AGE_DAYS 天的记录。
 * 由后台任务周期调用（withPostgresLease 单跑）。
 */
export const cleanupAgentHeartbeats = async (): Promise<{ removedPerAgent: number; removedByAge: number }> => {
  const db = getDrizzleDb()
  const perAgent = await db.execute(sql`DELETE FROM agent_heartbeats WHERE id IN (
    SELECT id FROM (
      SELECT id, row_number() OVER (PARTITION BY agent_id ORDER BY created_at DESC) AS rn
      FROM agent_heartbeats
    ) ranked WHERE rn > ${AGENT_HEARTBEATS_MAX_PER_AGENT}
  ) RETURNING id`)
  const cutoff = new Date(Date.now() - AGENT_HEARTBEATS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const byAge = await db.execute(sql`DELETE FROM agent_heartbeats WHERE created_at < ${cutoff} RETURNING id`)
  await refreshAgentStore()
  return {
    removedPerAgent: perAgent.rowCount ?? 0,
    removedByAge: byAge.rowCount ?? 0,
  }
}

const hydrateAgentWorkdirFields = <T extends Omit<Agent, 'workDir' | 'workDirStatus'>>(agent: T): Agent => {
  const workdir = getAgentWorkdirSummary(agent.id)
  return {
    ...agent,
    workDir: workdir.workDirPath,
    workDirStatus: workdir.status,
  }
}

const INITIAL_AGENT_NAME = 'CEO Agent'
const LEGACY_SYSTEM_AGENT_MARKER_KEY = 'systemAgentKey'
const LEGACY_SYSTEM_AGENT_MARKER = 'vibemux.system-default'

/**
 * 老版本初始 CEO 模板未写入 avatarUrl（界面退回首字母渐变占位）。
 * 仅当记录仍保持默认模板身份（名字与角色均为 CEO Agent）且头像为空时才需要回填，
 * 避免覆盖用户后续的个性化修改。
 */
export const isLegacyInitialAgentMissingAvatar = (agent: Pick<AgentRecord, 'name' | 'type' | 'config'>) => {
  if (agent.type.trim().toLowerCase() !== 'custom') return false
  const profile = readCustomAgentConfig(agent.config)
  if (profile.avatarUrl.trim()) return false
  return agent.name.trim() === INITIAL_AGENT_NAME && profile.role.trim() === INITIAL_AGENT_NAME
}

const removeLegacySystemAgentMarker = (config: Record<string, unknown>) => {
  if (config[LEGACY_SYSTEM_AGENT_MARKER_KEY] !== LEGACY_SYSTEM_AGENT_MARKER) return config
  const next = { ...config }
  delete next[LEGACY_SYSTEM_AGENT_MARKER_KEY]
  return next
}

const createInitialUserAgent = (userId: string): Agent => {
  const now = new Date().toISOString()
  return hydrateAgentWorkdirFields({
    id: crypto.randomUUID(),
    name: INITIAL_AGENT_NAME,
    type: 'custom',
    status: 'offline',
    endpoint: null,
    config: writeCustomAgentConfig({}, {
      role: 'CEO Agent',
      // 固定使用第一个内置头像（agent-01.png），避免随机渐变占位
      avatarUrl: BUILT_IN_AGENT_AVATAR_URLS[0],
      summary: '从目标、优先级、资源和风险角度做高层判断与协调。',
      instructions: '你是用户创建的第一个 Agent，默认采用 CEO 角色帮助用户理解目标、梳理优先级、识别风险并协调后续工作。你和用户之后创建的其他 Agent 属于同一套普通 Agent 体系；用户可以自由修改或删除你。先给结论，再给依据、风险与下一步。',
      preferredRuntime: 'Pi',
      preferredModel: '',
      allowedModes: ['mention', 'delegate'],
      workspaceIds: [],
      projectIds: [],
      visibility: 'workspace',
      tags: ['ceo', 'planning', 'coordination'],
      category: 'general',
      owner: '',
      notes: '新用户首个 Agent 的 CEO 示例模板；创建后与普通 Agent 完全相同。',
      enabled: true,
      archived: false,
      canWriteFiles: false,
      canRunCommands: false,
      delegatePreset: 'custom',
      defaultDelegateSessionRole: 'general',
      defaultDelegatePrompt: '请在独立子会话里协助处理这个问题，先确认目标和约束，再给出可执行结果或简短建议。',
      delegateSessionMode: 'new-session',
      delegateBaseBranchMode: 'task',
      delegateBaseBranch: '',
      delegateWorkingDirectoryMode: 'inherit',
      skills: [],
      mcpServers: [],
    }),
    ownerUserId: userId,
    createdAt: now,
    updatedAt: now,
    lastHeartbeatAt: null,
  })
}

export const resolveInitialUserAgentProvisionPlan = (
  catalog: Agent[],
  userId: string,
  alreadyProvisionedAt?: string | null,
  provisionedAt = new Date().toISOString(),
) => {
  const normalizedUserId = userId.trim()
  if (!normalizedUserId) throw new Error('创建初始 Agent 需要有效 userId。')
  const ownedAgents = catalog.filter((agent) => agent.ownerUserId === normalizedUserId)

  return {
    agent: alreadyProvisionedAt || ownedAgents.length > 0 ? null : createInitialUserAgent(normalizedUserId),
    provisionedAt: alreadyProvisionedAt || provisionedAt,
  }
}

const insertAgentRow = async (agent: Agent) => {
  await getDrizzleDb()
    .insert(agents)
    .values({
      id: agent.id,
      name: agent.name,
      type: agent.type,
      status: agent.status,
      endpoint: agent.endpoint,
      configJson: agent.config,
      ownerUserId: agent.ownerUserId ?? null,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      lastHeartbeatAt: agent.lastHeartbeatAt,
    })
}

const cleanupLegacySystemAgentMarkers = async () => {
  const legacyAgents = cache.agents.filter((agent) => {
    return removeLegacySystemAgentMarker(agent.config) !== agent.config
  })
  if (legacyAgents.length === 0) return

  await Promise.all(legacyAgents.map(async (agent) => {
    agent.config = removeLegacySystemAgentMarker(agent.config)
    agent.updatedAt = new Date().toISOString()
    await getDrizzleDb()
      .update(agents)
      .set({ configJson: agent.config, updatedAt: agent.updatedAt })
      .where(eq(agents.id, agent.id))
  }))
}

/**
 * 老版本初始 CEO 模板未写入 avatarUrl（界面退回首字母渐变占位）；
 * 按模板意图回填内置头像 agent-01.png。只回填仍保持默认模板身份（名字与角色均为 CEO Agent）的记录，
 * 避免覆盖用户后续的个性化修改。
 */
const backfillLegacyInitialAgentAvatars = async () => {
  const pending = cache.agents.filter((agent) => isLegacyInitialAgentMissingAvatar(agent))
  if (pending.length === 0) return

  await Promise.all(pending.map(async (agent) => {
    const profile = readCustomAgentConfig(agent.config)
    agent.config = writeCustomAgentConfig(agent.config, {
      ...profile,
      avatarUrl: BUILT_IN_AGENT_AVATAR_URLS[0],
    })
    agent.updatedAt = new Date().toISOString()
    await getDrizzleDb()
      .update(agents)
      .set({ configJson: agent.config, updatedAt: agent.updatedAt })
      .where(eq(agents.id, agent.id))
  }))
}

export const refreshAgentStore = async () => {
  await ensurePostgresReady()
  const db = getDrizzleDb()
  const [agentRows, taskRows, cronRows, heartbeatRows] = await Promise.all([
    db.select().from(agents).orderBy(desc(agents.createdAt)),
    db.select().from(agentTasks).orderBy(desc(agentTasks.createdAt)),
    db.select().from(agentCrons).orderBy(desc(agentCrons.createdAt)),
    // 只保留最近一批心跳进内存缓存（getAgentHeartbeats 按 agentId 过滤后截取；有界防缓存膨胀）
    db.select().from(agentHeartbeats).orderBy(desc(agentHeartbeats.createdAt)).limit(AGENT_HEARTBEATS_CACHE_LIMIT),
  ])

  cache.agents = agentRows.map((row) => hydrateAgentWorkdirFields({
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    endpoint: row.endpoint,
    config: row.configJson ?? {},
    ownerUserId: row.ownerUserId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastHeartbeatAt: row.lastHeartbeatAt,
  }))
  cache.tasks = taskRows.map((row) => ({
    id: row.id,
    agentId: row.agentId,
    type: row.type,
    payload: row.payloadJson ?? {},
    status: row.status,
    result: row.resultJson,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  }))
  cache.crons = cronRows.map((row) => ({
    id: row.id,
    agentId: row.agentId,
    name: row.name,
    cronExpression: row.cronExpression,
    payload: row.payloadJson ?? {},
    enabled: row.enabled,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    createdAt: row.createdAt,
  }))
  cache.heartbeats = heartbeatRows.map((row) => ({
    id: row.id,
    agentId: row.agentId,
    status: row.status,
    metrics: row.metricsJson,
    createdAt: row.createdAt,
  }))
}

export const initAgentStore = async () => {
  await refreshAgentStore()
  await cleanupLegacySystemAgentMarkers()
  await backfillLegacyInitialAgentAvatars()
}

/**
 * 只刷新 agent_crons 内存缓存（从 DB 重读）。调度器持有 lease 后调用，
 * 保证多实例下能识别其他实例新建的计划与已推进的 lastRunAt/nextRunAt，避免重复触发或漏触发。
 */
export const refreshAgentCronsStore = async () => {
  const db = getDrizzleDb()
  const cronRows = await db.select().from(agentCrons).orderBy(desc(agentCrons.createdAt))
  cache.crons = cronRows.map((row) => ({
    id: row.id,
    agentId: row.agentId,
    name: row.name,
    cronExpression: row.cronExpression,
    payload: row.payloadJson ?? {},
    enabled: row.enabled,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    createdAt: row.createdAt,
  }))
}

export const provisionInitialUserAgent = async (userId: string): Promise<Agent | null> => {
  const normalizedUserId = userId.trim()
  if (!normalizedUserId) throw new Error('创建初始 Agent 需要有效 userId。')

  const initialAgent = await withDrizzleTransaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`agent:initial:${normalizedUserId}`}))`)
    const [user] = await tx.select({
      initialAgentProvisionedAt: users.initialAgentProvisionedAt,
    }).from(users).where(eq(users.id, normalizedUserId))
    if (!user) throw new Error('用户不存在，无法创建初始 Agent。')

    const rows = await tx.select().from(agents).where(eq(agents.ownerUserId, normalizedUserId))
    const ownedAgents = rows.map((row) => hydrateAgentWorkdirFields({
      id: row.id,
      name: row.name,
      type: row.type,
      status: row.status,
      endpoint: row.endpoint,
      config: row.configJson ?? {},
      ownerUserId: row.ownerUserId ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastHeartbeatAt: row.lastHeartbeatAt,
    }))
    const plan = resolveInitialUserAgentProvisionPlan(
      ownedAgents,
      normalizedUserId,
      user.initialAgentProvisionedAt,
    )

    if (plan.agent) {
      await tx.insert(agents).values({
        id: plan.agent.id,
        name: plan.agent.name,
        type: plan.agent.type,
        status: plan.agent.status,
        endpoint: plan.agent.endpoint,
        configJson: plan.agent.config,
        ownerUserId: normalizedUserId,
        createdAt: plan.agent.createdAt,
        updatedAt: plan.agent.updatedAt,
        lastHeartbeatAt: plan.agent.lastHeartbeatAt,
      })
    }
    if (!user.initialAgentProvisionedAt) {
      await tx.update(users).set({
        initialAgentProvisionedAt: plan.provisionedAt,
      }).where(eq(users.id, normalizedUserId))
    }

    return plan.agent
  })

  if (initialAgent && !cache.agents.some((agent) => agent.id === initialAgent.id)) {
    cache.agents.unshift(initialAgent)
  }
  return cloneJson(initialAgent)
}

export const provisionInitialUserAgents = async (userIds: string[]) => {
  return Promise.all([...new Set(userIds.map((userId) => userId.trim()).filter(Boolean))].map(provisionInitialUserAgent))
}

export const registerAgent = (
  name: string,
  type: string,
  endpoint: string | null = null,
  config: Record<string, unknown> = {},
  ownerUserId?: string,
): Agent => {
  const now = new Date().toISOString()
  const agent: Agent = {
    id: crypto.randomUUID(),
    name,
    type,
    status: 'offline',
    endpoint,
    config,
    ownerUserId: ownerUserId?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    lastHeartbeatAt: null,
    workDir: '',
    workDirStatus: 'missing',
  }
  const hydrated = hydrateAgentWorkdirFields(agent)
  cache.agents.unshift(hydrated)
  schedulePersistence('register-agent', insertAgentRow(hydrated))
  return cloneJson(hydrated)
}

export const updateAgent = (
  id: string,
  payload: {
    name: string
    type: string
    endpoint: string | null
    config: Record<string, unknown>
    ownerUserId?: string
  },
): Agent | null => {
  const agent = cache.agents.find((item) => item.id === id)
  if (!agent) {
    return null
  }

  agent.name = payload.name
  agent.type = payload.type
  agent.endpoint = payload.endpoint
  agent.config = payload.config
  agent.ownerUserId = payload.ownerUserId?.trim() || agent.ownerUserId
  agent.updatedAt = new Date().toISOString()

  schedulePersistence(
    'update-agent',
    getDrizzleDb()
      .update(agents)
      .set({
        name: agent.name,
        type: agent.type,
        endpoint: agent.endpoint,
        configJson: agent.config,
        ownerUserId: agent.ownerUserId ?? null,
        updatedAt: agent.updatedAt,
      })
      .where(eq(agents.id, agent.id)),
  )

  return cloneJson(hydrateAgentWorkdirFields(agent))
}

export const updateAgentStatus = (id: string, status: Agent['status']): void => {
  const agent = cache.agents.find((item) => item.id === id)
  if (!agent) return
  agent.status = status
  agent.updatedAt = new Date().toISOString()
  schedulePersistence(
    'update-agent-status',
    getDrizzleDb()
      .update(agents)
      .set({ status, updatedAt: agent.updatedAt })
      .where(eq(agents.id, id)),
  )
}

export const agentHeartbeat = (agentId: string, status: 'online' | 'error' = 'online', metrics: Record<string, unknown> = {}): void => {
  const now = new Date().toISOString()
  const agent = cache.agents.find((item) => item.id === agentId)
  if (agent) {
    agent.status = status
    agent.lastHeartbeatAt = now
    agent.updatedAt = now
  }
  cache.heartbeats.unshift({ id: crypto.randomUUID(), agentId, status, metrics, createdAt: now })
  schedulePersistence('agent-heartbeat', Promise.all([
    getDrizzleDb()
      .update(agents)
      .set({ status, lastHeartbeatAt: now, updatedAt: now })
      .where(eq(agents.id, agentId)),
    getDrizzleDb()
      .insert(agentHeartbeats)
      .values({
        id: cache.heartbeats[0].id,
        agentId,
        status,
        metricsJson: metrics,
        createdAt: now,
      }),
  ]))
}

/** 统计某 agent 在 since（ISO）之后、source=schedule 的心跳投递次数（每日上限硬控用）。 */
export const countAgentHeartbeatDeliveriesSince = async (agentId: string, since: string): Promise<number> => {
  const db = getDrizzleDb()
  const rows = await db.execute(sql`
    SELECT count(*)::int AS count FROM agent_heartbeats
    WHERE agent_id = ${agentId} AND created_at >= ${since} AND metrics_json->>'source' = 'schedule'
  `)
  return Number((rows.rows?.[0] as { count?: number } | undefined)?.count ?? 0)
}

export const getAgent = (id: string): Agent | null => {
  const agent = cache.agents.find((item) => item.id === id)
  return cloneJson(agent ? hydrateAgentWorkdirFields(agent) : null)
}

export const getAllAgents = (): Agent[] => cloneJson(cache.agents.map((agent) => hydrateAgentWorkdirFields(agent)))

export const selectUserAgents = (catalog: Agent[], userId: string): Agent[] => {
  const normalizedUserId = userId.trim()
  return catalog.filter((agent) => agent.ownerUserId === normalizedUserId)
}

export const getUserAgents = (userId: string): Agent[] => {
  return selectUserAgents(getAllAgents(), userId)
}

export const getDefaultUserAgent = (userId: string): Agent | null => {
  const normalizedUserId = userId.trim()
  const agent = cache.agents
    .filter((item) => item.ownerUserId === normalizedUserId)
    .filter((item) => item.type.trim().toLowerCase() !== 'main')
    .filter((item) => isCustomAgentEnabled(readCustomAgentConfig(item.config)))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0]
  return cloneJson(agent ? hydrateAgentWorkdirFields(agent) : null)
}

export const deleteAgent = (id: string): boolean => {
  const before = cache.agents.length
  cache.agents = cache.agents.filter((item) => item.id !== id)
  cache.tasks = cache.tasks.filter((item) => item.agentId !== id)
  cache.crons = cache.crons.filter((item) => item.agentId !== id)
  cache.heartbeats = cache.heartbeats.filter((item) => item.agentId !== id)

  if (cache.agents.length === before) {
    return false
  }

  schedulePersistence(`delete-agent:${id}`, Promise.all([
    getDrizzleDb().delete(agents).where(eq(agents.id, id)),
    getDrizzleDb().delete(agentTasks).where(eq(agentTasks.agentId, id)),
    getDrizzleDb().delete(agentCrons).where(eq(agentCrons.agentId, id)),
    getDrizzleDb().delete(agentHeartbeats).where(eq(agentHeartbeats.agentId, id)),
  ]))
  return true
}

export const createAgentTask = (agentId: string, type: string, payload: Record<string, unknown> = {}): AgentTask => {
  const task: AgentTask = { id: crypto.randomUUID(), agentId, type, payload, status: 'pending', result: null, startedAt: null, completedAt: null, createdAt: new Date().toISOString() }
  cache.tasks.unshift(task)
  schedulePersistence(
    'create-agent-task',
    getDrizzleDb()
      .insert(agentTasks)
      .values({
        id: task.id,
        agentId: task.agentId,
        type: task.type,
        payloadJson: task.payload,
        status: task.status,
        resultJson: null,
        startedAt: null,
        completedAt: null,
        createdAt: task.createdAt,
      }),
  )
  return cloneJson(task)
}

export const getAgentTasks = (agentId: string, limit = 50): AgentTask[] => cloneJson(cache.tasks.filter((task) => task.agentId === agentId).slice(0, limit))

export const getAgentTask = (taskId: string): AgentTask | null => cloneJson(cache.tasks.find((task) => task.id === taskId) ?? null)

export const getAgentTasksByStatus = (status: AgentTask['status']): AgentTask[] => cloneJson(cache.tasks.filter((task) => task.status === status))

export const updatePendingAgentTaskPayload = (taskId: string, payload: Record<string, unknown>): AgentTask | null => {
  const task = cache.tasks.find((item) => item.id === taskId)
  if (!task || task.status !== 'pending') return null
  task.payload = payload
  schedulePersistence(
    'update-pending-agent-task-payload',
    getDrizzleDb()
      .update(agentTasks)
      .set({ payloadJson: task.payload })
      .where(eq(agentTasks.id, task.id)),
  )
  return cloneJson(task)
}

export const startAgentTask = (taskId: string): void => {
  const task = cache.tasks.find((item) => item.id === taskId)
  if (!task || task.status === 'canceled') return
  task.status = 'running'
  task.startedAt = new Date().toISOString()
  schedulePersistence(
    'start-agent-task',
    getDrizzleDb()
      .update(agentTasks)
      .set({ status: task.status, startedAt: task.startedAt })
      .where(eq(agentTasks.id, task.id)),
  )
}

export const waitAgentTask = (taskId: string, result: Record<string, unknown>): void => {
  const task = cache.tasks.find((item) => item.id === taskId)
  if (!task || task.status === 'canceled') return
  task.status = 'waiting'
  task.result = result
  schedulePersistence(
    'wait-agent-task',
    getDrizzleDb()
      .update(agentTasks)
      .set({ status: task.status, resultJson: result })
      .where(eq(agentTasks.id, task.id)),
  )
}

export const cancelAgentTask = (taskId: string, result: Record<string, unknown> = {}): boolean => {
  const task = cache.tasks.find((item) => item.id === taskId)
  if (!task || (task.status !== 'pending' && task.status !== 'running' && task.status !== 'waiting')) return false
  task.status = 'canceled'
  task.result = { ...(task.result ?? {}), ...result, message: '已由用户取消。' }
  task.completedAt = new Date().toISOString()
  schedulePersistence(
    'cancel-agent-task',
    getDrizzleDb()
      .update(agentTasks)
      .set({ status: task.status, resultJson: task.result, completedAt: task.completedAt })
      .where(eq(agentTasks.id, task.id)),
  )
  return true
}

export const completeAgentTask = (taskId: string, result: Record<string, unknown>): void => {
  const task = cache.tasks.find((item) => item.id === taskId)
  if (!task || task.status === 'canceled') return
  task.status = 'completed'
  task.result = result
  task.completedAt = new Date().toISOString()
  schedulePersistence(
    'complete-agent-task',
    getDrizzleDb()
      .update(agentTasks)
      .set({ status: task.status, resultJson: result, completedAt: task.completedAt })
      .where(eq(agentTasks.id, task.id)),
  )
}

export const failAgentTask = (taskId: string, error: string, result: Record<string, unknown> = {}): void => {
  const task = cache.tasks.find((item) => item.id === taskId)
  if (!task || task.status === 'canceled') return
  task.status = 'failed'
  task.result = { ...result, error }
  task.completedAt = new Date().toISOString()
  schedulePersistence(
    'fail-agent-task',
    getDrizzleDb()
      .update(agentTasks)
      .set({ status: task.status, resultJson: task.result, completedAt: task.completedAt })
      .where(eq(agentTasks.id, task.id)),
  )
}

/** 从 payload 读取 cron 时区（可选，默认 UTC）；非法时区由 nextCronTickInTimeZone 抛错并兜底。 */
const readCronTimezone = (payload: Record<string, unknown>): string | undefined => {
  const timezone = typeof payload.timezone === 'string' ? payload.timezone.trim() : ''
  return timezone || undefined
}

const calculateNextRunTime = (cronExpression: string, from = new Date(), timezone?: string) => {
  // validateCron 合法时返回 null，非法时返回错误消息；这里修掉了把 null 当 truthy 的历史反转判断。
  const validationError = validateCron(cronExpression)
  if (validationError) {
    return new Date(from.getTime() + 60 * 1000).toISOString()
  }

  try {
    return nextCronTickInTimeZone(cronExpression, timezone ?? 'UTC', from)?.toISOString()
      ?? new Date(from.getTime() + 60 * 1000).toISOString()
  } catch {
    return new Date(from.getTime() + 60 * 1000).toISOString()
  }
}

export const createAgentCron = (agentId: string, name: string, cronExpression: string, payload: Record<string, unknown> = {}): AgentCron => {
  const cron: AgentCron = { id: crypto.randomUUID(), agentId, name, cronExpression, payload, enabled: true, lastRunAt: null, nextRunAt: calculateNextRunTime(cronExpression, new Date(), readCronTimezone(payload)), createdAt: new Date().toISOString() }
  cache.crons.unshift(cron)
  schedulePersistence(
    'create-agent-cron',
    getDrizzleDb()
      .insert(agentCrons)
      .values({
        id: cron.id,
        agentId: cron.agentId,
        name: cron.name,
        cronExpression: cron.cronExpression,
        payloadJson: cron.payload,
        enabled: cron.enabled,
        lastRunAt: null,
        nextRunAt: cron.nextRunAt,
        createdAt: cron.createdAt,
      }),
  )
  return cloneJson(cron)
}

export const getAgentCrons = (agentId: string): AgentCron[] => cloneJson(cache.crons.filter((cron) => cron.agentId === agentId))

export const getDueCrons = (): AgentCron[] => {
  const now = new Date().toISOString()
  return cloneJson(cache.crons.filter((cron) => cron.enabled && cron.nextRunAt !== null && cron.nextRunAt <= now))
}

export const updateCronLastRun = (cronId: string): void => {
  const cron = cache.crons.find((item) => item.id === cronId)
  if (!cron) return
  cron.lastRunAt = new Date().toISOString()
  cron.nextRunAt = calculateNextRunTime(cron.cronExpression, new Date(), readCronTimezone(cron.payload))
  schedulePersistence(
    'update-cron-last-run',
    getDrizzleDb()
      .update(agentCrons)
      .set({ lastRunAt: cron.lastRunAt, nextRunAt: cron.nextRunAt })
      .where(eq(agentCrons.id, cron.id)),
  )
}

export const updateAgentCron = (
  cronId: string,
  payload: {
    name?: string
    cronExpression?: string
    payload?: Record<string, unknown>
    enabled?: boolean
  },
): AgentCron | null => {
  const cron = cache.crons.find((item) => item.id === cronId)
  if (!cron) return null

  if (payload.name !== undefined) {
    cron.name = payload.name
  }
  if (payload.cronExpression !== undefined) {
    cron.cronExpression = payload.cronExpression
    cron.nextRunAt = calculateNextRunTime(cron.cronExpression, new Date(), readCronTimezone(cron.payload))
  }
  if (payload.payload !== undefined) {
    cron.payload = payload.payload
    if (payload.cronExpression === undefined) {
      // 时区可能随 payload 变化（cronExpression 未变时也要重算 nextRunAt）
      cron.nextRunAt = calculateNextRunTime(cron.cronExpression, new Date(), readCronTimezone(cron.payload))
    }
  }
  if (payload.enabled !== undefined) {
    cron.enabled = payload.enabled
  }

  schedulePersistence(
    'update-agent-cron',
    getDrizzleDb()
      .update(agentCrons)
      .set({
        name: cron.name,
        cronExpression: cron.cronExpression,
        payloadJson: cron.payload,
        enabled: cron.enabled,
        nextRunAt: cron.nextRunAt,
      })
      .where(eq(agentCrons.id, cron.id)),
  )
  return cloneJson(cron)
}

export const toggleAgentCron = (cronId: string, enabled: boolean): void => {
  const cron = cache.crons.find((item) => item.id === cronId)
  if (!cron) return
  cron.enabled = enabled
  schedulePersistence(
    'toggle-agent-cron',
    getDrizzleDb()
      .update(agentCrons)
      .set({ enabled })
      .where(eq(agentCrons.id, cron.id)),
  )
}

export const deleteAgentCron = (cronId: string): void => {
  cache.crons = cache.crons.filter((cron) => cron.id !== cronId)
  schedulePersistence(
    'delete-agent-cron',
    getDrizzleDb().delete(agentCrons).where(eq(agentCrons.id, cronId)),
  )
}

export const getAgentHeartbeats = (agentId: string, limit = 100): Array<{ id: string; agentId: string; status: string; metrics: Record<string, unknown> | null; createdAt: string }> => {
  return cloneJson(cache.heartbeats.filter((heartbeat) => heartbeat.agentId === agentId).slice(0, limit))
}
