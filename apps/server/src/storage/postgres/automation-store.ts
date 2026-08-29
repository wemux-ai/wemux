import { and, asc, desc, eq } from 'drizzle-orm'

import { coerceAgentType } from '@shared/agent-type'
import type {
  AutomationRecord,
  AutomationRunRecord,
  AutomationTriggerRecord,
} from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { cloneJson, schedulePersistence } from './helpers'
import { automationRuns, automations, automationTriggers } from './schema'

type AutomationRow = typeof automations.$inferSelect
type AutomationTriggerRow = typeof automationTriggers.$inferSelect
type AutomationRunRow = typeof automationRuns.$inferSelect

const cache = {
  automations: [] as AutomationRecord[],
  triggers: [] as AutomationTriggerRecord[],
  runs: [] as AutomationRunRecord[],
}

const mapAutomationRow = (row: AutomationRow): AutomationRecord => ({
  id: row.id,
  projectId: row.projectId,
  ownerUserId: row.ownerUserId,
  title: row.title,
  description: row.description,
  status: row.status,
  priority: row.priority,
  difficulty: row.difficulty,
  agentType: coerceAgentType(row.agentType),
  executionModel: row.executionModel ?? undefined,
  opencodeConfig: row.opencodeConfigJson && typeof row.opencodeConfigJson === 'object'
    ? row.opencodeConfigJson as AutomationRecord['opencodeConfig']
    : undefined,
  workspaceId: row.workspaceId,
  workspaceSessionId: row.workspaceSessionId ?? undefined,
  baseBranch: row.baseBranch ?? undefined,
  returnMode: row.returnMode,
  syncBackStrategy: row.syncBackStrategy,
  gitIdentityMode: row.gitIdentityMode,
  concurrencyPolicy: row.concurrencyPolicy,
  catchUpPolicy: row.catchUpPolicy,
  taskTemplate: row.taskTemplateJson && typeof row.taskTemplateJson === 'object'
    ? row.taskTemplateJson as AutomationRecord['taskTemplate']
    : undefined,
  variables: Array.isArray(row.variablesJson) ? row.variablesJson as AutomationRecord['variables'] : [],
  lastTriggeredAt: row.lastTriggeredAt ?? undefined,
  lastEnqueuedAt: row.lastEnqueuedAt ?? undefined,
  legacyAgentId: row.legacyAgentId ?? undefined,
  legacyCronId: row.legacyCronId ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const mapAutomationTriggerRow = (row: AutomationTriggerRow): AutomationTriggerRecord => ({
  id: row.id,
  automationId: row.automationId,
  kind: row.kind,
  label: row.label ?? undefined,
  enabled: row.enabled,
  cronExpression: row.cronExpression ?? undefined,
  timezone: row.timezone ?? undefined,
  nextRunAt: row.nextRunAt ?? undefined,
  signingMode: row.signingMode ?? undefined,
  secretEncrypted: row.secretEncrypted ?? undefined,
  publicId: row.publicId ?? undefined,
  replayWindowSec: row.replayWindowSec ?? undefined,
  lastFiredAt: row.lastFiredAt ?? undefined,
  lastResult: row.lastResult ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const mapAutomationRunRow = (row: AutomationRunRow): AutomationRunRecord => ({
  id: row.id,
  automationId: row.automationId,
  triggerId: row.triggerId ?? undefined,
  source: row.source,
  status: row.status,
  triggerPayload: row.triggerPayloadJson && typeof row.triggerPayloadJson === 'object'
    ? row.triggerPayloadJson as Record<string, unknown>
    : undefined,
  resolvedVariables: row.resolvedVariablesJson && typeof row.resolvedVariablesJson === 'object'
    ? row.resolvedVariablesJson as Record<string, string | number | boolean>
    : undefined,
  linkedTaskId: row.linkedTaskId ?? undefined,
  linkedTaskRunId: row.linkedTaskRunId ?? undefined,
  linkedDistributedTaskId: row.linkedDistributedTaskId ?? undefined,
  coalescedIntoRunId: row.coalescedIntoRunId ?? undefined,
  failureReason: row.failureReason ?? undefined,
  idempotencyKey: row.idempotencyKey ?? undefined,
  triggeredAt: row.triggeredAt,
  completedAt: row.completedAt ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const automationInsertValues = (automation: AutomationRecord) => ({
  id: automation.id,
  projectId: automation.projectId,
  ownerUserId: automation.ownerUserId,
  title: automation.title,
  description: automation.description,
  status: automation.status,
  priority: automation.priority,
  difficulty: automation.difficulty,
  agentType: automation.agentType,
  executionModel: automation.executionModel ?? null,
  opencodeConfigJson: automation.opencodeConfig ?? null,
  workspaceId: automation.workspaceId,
  workspaceSessionId: automation.workspaceSessionId ?? null,
  baseBranch: automation.baseBranch ?? null,
  returnMode: automation.returnMode,
  syncBackStrategy: automation.syncBackStrategy,
  gitIdentityMode: automation.gitIdentityMode,
  concurrencyPolicy: automation.concurrencyPolicy,
  catchUpPolicy: automation.catchUpPolicy,
  taskTemplateJson: automation.taskTemplate ?? {},
  variablesJson: automation.variables ?? [],
  lastTriggeredAt: automation.lastTriggeredAt ?? null,
  lastEnqueuedAt: automation.lastEnqueuedAt ?? null,
  legacyAgentId: automation.legacyAgentId ?? null,
  legacyCronId: automation.legacyCronId ?? null,
  createdAt: automation.createdAt,
  updatedAt: automation.updatedAt,
})

const automationUpdateSet = (next: AutomationRecord) => ({
  title: next.title,
  description: next.description,
  status: next.status,
  priority: next.priority,
  difficulty: next.difficulty,
  agentType: next.agentType,
  executionModel: next.executionModel ?? null,
  opencodeConfigJson: next.opencodeConfig ?? null,
  workspaceId: next.workspaceId,
  workspaceSessionId: next.workspaceSessionId ?? null,
  baseBranch: next.baseBranch ?? null,
  returnMode: next.returnMode,
  syncBackStrategy: next.syncBackStrategy,
  gitIdentityMode: next.gitIdentityMode,
  concurrencyPolicy: next.concurrencyPolicy,
  catchUpPolicy: next.catchUpPolicy,
  taskTemplateJson: next.taskTemplate ?? {},
  variablesJson: next.variables ?? [],
  lastTriggeredAt: next.lastTriggeredAt ?? null,
  lastEnqueuedAt: next.lastEnqueuedAt ?? null,
  legacyAgentId: next.legacyAgentId ?? null,
  legacyCronId: next.legacyCronId ?? null,
  updatedAt: next.updatedAt,
})

const triggerInsertValues = (trigger: AutomationTriggerRecord) => ({
  id: trigger.id,
  automationId: trigger.automationId,
  kind: trigger.kind,
  label: trigger.label ?? null,
  enabled: trigger.enabled,
  cronExpression: trigger.cronExpression ?? null,
  timezone: trigger.timezone ?? null,
  nextRunAt: trigger.nextRunAt ?? null,
  signingMode: trigger.signingMode ?? null,
  secretEncrypted: trigger.secretEncrypted ?? null,
  publicId: trigger.publicId ?? null,
  replayWindowSec: trigger.replayWindowSec ?? null,
  lastFiredAt: trigger.lastFiredAt ?? null,
  lastResult: trigger.lastResult ?? null,
  createdAt: trigger.createdAt,
  updatedAt: trigger.updatedAt,
})

const runInsertValues = (run: AutomationRunRecord) => ({
  id: run.id,
  automationId: run.automationId,
  triggerId: run.triggerId ?? null,
  source: run.source,
  status: run.status,
  triggerPayloadJson: run.triggerPayload ?? null,
  resolvedVariablesJson: run.resolvedVariables ?? null,
  linkedTaskId: run.linkedTaskId ?? null,
  linkedTaskRunId: run.linkedTaskRunId ?? null,
  linkedDistributedTaskId: run.linkedDistributedTaskId ?? null,
  coalescedIntoRunId: run.coalescedIntoRunId ?? null,
  failureReason: run.failureReason ?? null,
  idempotencyKey: run.idempotencyKey ?? null,
  triggeredAt: run.triggeredAt,
  completedAt: run.completedAt ?? null,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
})

export const initAutomationStore = async () => {
  await ensurePostgresReady()
  const db = getDrizzleDb()
  const [automationRows, triggerRows, runRows] = await Promise.all([
    db.select().from(automations).orderBy(desc(automations.updatedAt), desc(automations.createdAt)),
    db.select().from(automationTriggers).orderBy(asc(automationTriggers.createdAt)),
    db.select().from(automationRuns).orderBy(desc(automationRuns.createdAt)),
  ])

  cache.automations = automationRows.map(mapAutomationRow)
  cache.triggers = triggerRows.map(mapAutomationTriggerRow)
  cache.runs = runRows.map(mapAutomationRunRow)
}

export const listAutomationsByProject = (projectId: string) => {
  return cloneJson(cache.automations.filter((automation) => automation.projectId === projectId))
}

export const getAutomation = (id: string) => {
  return cloneJson(cache.automations.find((automation) => automation.id === id) ?? null)
}

export const createAutomation = (automation: AutomationRecord) => {
  cache.automations.unshift(automation)
  schedulePersistence(
    'create-automation',
    getDrizzleDb().insert(automations).values(automationInsertValues(automation)),
  )
  return cloneJson(automation)
}

export const updateAutomation = (id: string, patch: Partial<AutomationRecord>) => {
  const automation = cache.automations.find((item) => item.id === id)
  if (!automation) {
    return null
  }

  const next: AutomationRecord = {
    ...automation,
    ...patch,
    id: automation.id,
    projectId: automation.projectId,
    ownerUserId: automation.ownerUserId,
  }
  Object.assign(automation, next)

  schedulePersistence(
    'update-automation',
    getDrizzleDb()
      .update(automations)
      .set(automationUpdateSet(next))
      .where(eq(automations.id, id)),
  )

  return cloneJson(next)
}

export const listAutomationTriggers = (automationId: string) => {
  return cloneJson(cache.triggers.filter((trigger) => trigger.automationId === automationId))
}

export const getAutomationTrigger = (id: string) => {
  return cloneJson(cache.triggers.find((trigger) => trigger.id === id) ?? null)
}

export const getAutomationTriggerByPublicId = (publicId: string) => {
  return cloneJson(cache.triggers.find((trigger) => trigger.publicId === publicId) ?? null)
}

export const createAutomationTrigger = (trigger: AutomationTriggerRecord) => {
  cache.triggers.push(trigger)
  schedulePersistence(
    'create-automation-trigger',
    getDrizzleDb().insert(automationTriggers).values(triggerInsertValues(trigger)),
  )
  return cloneJson(trigger)
}

export const updateAutomationTrigger = (id: string, patch: Partial<AutomationTriggerRecord>) => {
  const trigger = cache.triggers.find((item) => item.id === id)
  if (!trigger) {
    return null
  }

  const next: AutomationTriggerRecord = {
    ...trigger,
    ...patch,
    id: trigger.id,
    automationId: trigger.automationId,
  }
  Object.assign(trigger, next)

  schedulePersistence(
    'update-automation-trigger',
    getDrizzleDb()
      .update(automationTriggers)
      .set({
        label: next.label ?? null,
        enabled: next.enabled,
        cronExpression: next.cronExpression ?? null,
        timezone: next.timezone ?? null,
        nextRunAt: next.nextRunAt ?? null,
        signingMode: next.signingMode ?? null,
        secretEncrypted: next.secretEncrypted ?? null,
        publicId: next.publicId ?? null,
        replayWindowSec: next.replayWindowSec ?? null,
        lastFiredAt: next.lastFiredAt ?? null,
        lastResult: next.lastResult ?? null,
        updatedAt: next.updatedAt,
      })
      .where(eq(automationTriggers.id, id)),
  )

  return cloneJson(next)
}

export const deleteAutomationTrigger = (id: string) => {
  const before = cache.triggers.length
  cache.triggers = cache.triggers.filter((trigger) => trigger.id !== id)
  if (cache.triggers.length === before) {
    return false
  }

  schedulePersistence(
    'delete-automation-trigger',
    getDrizzleDb().delete(automationTriggers).where(eq(automationTriggers.id, id)),
  )
  return true
}

export const listAutomationRuns = (automationId: string, limit = 50) => {
  return cloneJson(cache.runs.filter((run) => run.automationId === automationId).slice(0, limit))
}

export const getAutomationRun = (id: string) => {
  return cloneJson(cache.runs.find((run) => run.id === id) ?? null)
}

export const listIncompleteAutomationRuns = () => {
  return cloneJson(cache.runs.filter((run) => run.status === 'task_created'))
}

export const createAutomationRun = (run: AutomationRunRecord) => {
  cache.runs.unshift(run)
  schedulePersistence(
    'create-automation-run',
    getDrizzleDb().insert(automationRuns).values(runInsertValues(run)),
  )
  return cloneJson(run)
}

export const updateAutomationRun = (id: string, patch: Partial<AutomationRunRecord>) => {
  const run = cache.runs.find((item) => item.id === id)
  if (!run) {
    return null
  }

  const next: AutomationRunRecord = {
    ...run,
    ...patch,
    id: run.id,
    automationId: run.automationId,
  }
  Object.assign(run, next)

  schedulePersistence(
    'update-automation-run',
    getDrizzleDb()
      .update(automationRuns)
      .set({
        triggerId: next.triggerId ?? null,
        source: next.source,
        status: next.status,
        triggerPayloadJson: next.triggerPayload ?? null,
        resolvedVariablesJson: next.resolvedVariables ?? null,
        linkedTaskId: next.linkedTaskId ?? null,
        linkedTaskRunId: next.linkedTaskRunId ?? null,
        linkedDistributedTaskId: next.linkedDistributedTaskId ?? null,
        coalescedIntoRunId: next.coalescedIntoRunId ?? null,
        failureReason: next.failureReason ?? null,
        idempotencyKey: next.idempotencyKey ?? null,
        triggeredAt: next.triggeredAt,
        completedAt: next.completedAt ?? null,
        updatedAt: next.updatedAt,
      })
      .where(eq(automationRuns.id, id)),
  )

  return cloneJson(next)
}

export const listDueAutomationTriggers = (nowIso: string) => {
  return cloneJson(
    cache.triggers
      .filter((trigger) => trigger.kind === 'schedule' && trigger.enabled && Boolean(trigger.nextRunAt) && trigger.nextRunAt! <= nowIso)
      .sort((left, right) => (left.nextRunAt ?? '').localeCompare(right.nextRunAt ?? '') || left.createdAt.localeCompare(right.createdAt)),
  )
}

export const claimAutomationTriggerSchedule = async (params: {
  id: string
  expectedNextRunAt: string
  nextRunAt?: string
  updatedAt: string
}) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .update(automationTriggers)
    .set({
      nextRunAt: params.nextRunAt ?? null,
      updatedAt: params.updatedAt,
    })
    .where(and(
      eq(automationTriggers.id, params.id),
      eq(automationTriggers.enabled, true),
      eq(automationTriggers.nextRunAt, params.expectedNextRunAt),
    ))
    .returning({ id: automationTriggers.id })

  if (rows.length !== 1) {
    return false
  }

  const trigger = cache.triggers.find((item) => item.id === params.id)
  if (trigger) {
    trigger.nextRunAt = params.nextRunAt
    trigger.updatedAt = params.updatedAt
  }

  return true
}
