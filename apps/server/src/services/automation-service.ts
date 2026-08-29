// [INPUT]: 自动化 CRUD/触发/运行请求
// [OUTPUT]: 自动化服务结果
// [POS]: 自动化服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createExecutionLog, createTaskFromRequirement } from '@shared/task-orchestrator'
import { buildWorkspaceTaskExecutionView } from '@shared/task-workspace'
import type {
  AutomationRecord,
  AutomationRunRecord,
  AutomationRunSource,
  AutomationTriggerRecord,
  Project,
  Task,
  WorkspaceSession,
} from '@shared/types'
import { executeTaskOnWorkspace } from './task-execution-service'
import { decryptSecret, encryptSecret } from './secret-crypto'
import { nextCronTickInTimeZone, validateCron } from './automation-cron'
import {
  claimAutomationTriggerSchedule,
  createAutomation,
  createAutomationRun,
  createAutomationTrigger,
  deleteAutomationTrigger,
  getAutomation,
  getAutomationRun,
  getAutomationTrigger,
  getAutomationTriggerByPublicId,
  initAutomationStore,
  listAutomationRuns,
  listAutomationsByProject,
  listAutomationTriggers,
  listDueAutomationTriggers,
  listIncompleteAutomationRuns,
  updateAutomation,
  updateAutomationRun,
  updateAutomationTrigger,
} from '../storage/postgres/automation-store'
import { withPostgresLease } from '../storage/postgres/db'
import { getWorkspaceSessionById, loadState } from '../storage/app-state-store'
import { getScopedWorkspaceForProject } from '../routes/task-route-support'

const OPEN_TASK_STATUSES = new Set(['todo', 'in_progress', 'in_review'])
const MAX_CATCH_UP_RUNS = 25

const nowIso = () => new Date().toISOString()

const getProjectById = (projectId: string) => {
  const state = loadState()
  return state.projects.find((project) => project.id === projectId) ?? null
}

const getTaskById = (taskId: string) => {
  const state = loadState()
  return state.tasks.find((task) => task.id === taskId) ?? null
}

const getWorkspaceSessionTemplate = (workspaceId: string, workspaceSessionId?: string) => {
  const normalizedSessionId = workspaceSessionId?.trim()
  if (!normalizedSessionId) {
    return null
  }

  const session = getWorkspaceSessionById(normalizedSessionId)
  if (!session) {
    throw new Error('工作区会话不存在。')
  }
  if (session.workspaceId !== workspaceId) {
    throw new Error('工作区会话不属于当前工作区。')
  }

  return session
}

const ensureAutomationExecutionContext = (
  project: Project,
  userId: string,
  workspaceId: string,
  workspaceSessionId?: string,
) => {
  const workspace = getScopedWorkspaceForProject(userId, project, workspaceId)
  if (!workspace) {
    throw new Error('工作区不存在或无权访问。')
  }

  return {
    workspace,
    sessionTemplate: getWorkspaceSessionTemplate(workspace.id, workspaceSessionId),
  }
}

const buildAutomationTask = (
  automation: AutomationRecord,
  project: Project,
  sessionTemplate?: WorkspaceSession | null,
) => {
  const state = loadState()
  const baseTask = createTaskFromRequirement(
    project,
    automation.description,
    automation.difficulty,
    automation.title,
    'ai',
    automation.agentType,
    automation.executionModel,
    automation.baseBranch,
    state.config,
    automation.opencodeConfig,
  )
  const seededTask = sessionTemplate
    ? buildWorkspaceTaskExecutionView(baseTask, sessionTemplate)
    : baseTask
  const initialChatMessage = automation.taskTemplate?.initialChatMessage?.trim() || undefined
  const baseLogs = initialChatMessage && initialChatMessage !== seededTask.description
    ? [
        createExecutionLog('user', initialChatMessage),
        ...seededTask.logs.filter((log) => log.role !== 'user'),
      ]
    : seededTask.logs

  const task: Task = {
    ...seededTask,
    agentType: automation.agentType,
    executionModel: baseTask.executionModel ?? seededTask.executionModel,
    opencodeConfig: automation.opencodeConfig ?? seededTask.opencodeConfig,
    gitIdentityMode: automation.gitIdentityMode,
    baseBranch: automation.baseBranch?.trim() || seededTask.baseBranch,
    priority: automation.priority,
    acceptanceCriteria: automation.taskTemplate?.acceptanceCriteria ?? undefined,
    logs: [
      ...baseLogs,
      createExecutionLog('system', `自动化「${automation.title}」已触发，准备排队执行。`),
    ],
  }

  return task
}

const resolveNextRunAt = (trigger: Pick<AutomationTriggerRecord, 'cronExpression' | 'timezone'>, after: Date) => {
  if (!trigger.cronExpression) {
    return undefined
  }

  return nextCronTickInTimeZone(trigger.cronExpression, trigger.timezone?.trim() || 'UTC', after)?.toISOString()
}

const getActiveAutomationRun = (automationId: string) => {
  for (const run of listAutomationRuns(automationId, 100)) {
    if (!run.linkedTaskId) {
      continue
    }
    const task = getTaskById(run.linkedTaskId)
    if (task && OPEN_TASK_STATUSES.has(task.status)) {
      return { run, task }
    }
  }
  return null
}

const touchAutomationAfterRun = (automation: AutomationRecord, params: { triggeredAt: string; enqueuedAt?: string }) => {
  return updateAutomation(automation.id, {
    lastTriggeredAt: params.triggeredAt,
    lastEnqueuedAt: params.enqueuedAt ?? automation.lastEnqueuedAt,
    updatedAt: nowIso(),
  })
}

const touchTriggerAfterRun = (trigger: AutomationTriggerRecord | null, params: { firedAt: string; result: string }) => {
  if (!trigger) {
    return null
  }

  return updateAutomationTrigger(trigger.id, {
    lastFiredAt: params.firedAt,
    lastResult: params.result,
    updatedAt: nowIso(),
  })
}

const verifyWebhookBearer = (secret: string, authorizationHeader: string | null) => {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return false
  }
  return authorizationHeader.slice(7) === secret
}

const verifyWebhookHmac = (secret: string, rawBody: string, signatureHeader: string | null, timestampHeader: string | null, replayWindowSec: number) => {
  if (!signatureHeader || !timestampHeader) {
    return false
  }

  const parsedTimestamp = Number(timestampHeader)
  if (!Number.isFinite(parsedTimestamp)) {
    return false
  }

  const timestampMs = parsedTimestamp > 1e12 ? parsedTimestamp : parsedTimestamp * 1000
  if (Math.abs(Date.now() - timestampMs) > replayWindowSec * 1000) {
    return false
  }

  const expected = createHmac('sha256', secret).update(`${timestampHeader}.${rawBody}`).digest('hex')
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(signatureHeader.trim().toLowerCase())
  if (expectedBytes.length !== actualBytes.length) {
    return false
  }

  return timingSafeEqual(expectedBytes, actualBytes)
}

const verifyWebhookTrigger = (trigger: AutomationTriggerRecord, rawBody: string, headers: Headers) => {
  const secretEncrypted = trigger.secretEncrypted?.trim()
  if (!secretEncrypted) {
    return false
  }

  const secret = decryptSecret(secretEncrypted)
  if (trigger.signingMode === 'hmac_sha256') {
    return verifyWebhookHmac(
      secret,
      rawBody,
      headers.get('x-automation-signature'),
      headers.get('x-automation-timestamp'),
      trigger.replayWindowSec ?? 300,
    )
  }

  return verifyWebhookBearer(secret, headers.get('authorization'))
}

const maybeReuseIdempotentRun = (automationId: string, idempotencyKey?: string | null) => {
  if (!idempotencyKey) {
    return null
  }

  return listAutomationRuns(automationId, 100).find((run) => run.idempotencyKey === idempotencyKey) ?? null
}

const dispatchAutomation = async (params: {
  automation: AutomationRecord
  trigger?: AutomationTriggerRecord | null
  source: AutomationRunSource
  payload?: Record<string, unknown>
  idempotencyKey?: string
}) => {
  const existing = maybeReuseIdempotentRun(params.automation.id, params.idempotencyKey)
  if (existing) {
    return existing
  }

  const automation = getAutomation(params.automation.id)
  if (!automation) {
    throw new Error('自动化不存在。')
  }

  const project = getProjectById(automation.projectId)
  if (!project) {
    throw new Error('自动化所属项目不存在。')
  }
  const { sessionTemplate } = ensureAutomationExecutionContext(
    project,
    automation.ownerUserId,
    automation.workspaceId,
    automation.workspaceSessionId,
  )

  const triggeredAt = nowIso()
  const active = getActiveAutomationRun(automation.id)
  if (active && automation.concurrencyPolicy !== 'always_enqueue') {
    const status = automation.concurrencyPolicy === 'skip_if_active' ? 'skipped' : 'coalesced'
    const coalescedRun: AutomationRunRecord = {
      id: crypto.randomUUID(),
      automationId: automation.id,
      triggerId: params.trigger?.id ?? null,
      source: params.source,
      status,
      triggerPayload: params.payload ?? null,
      linkedTaskId: active.run.linkedTaskId ?? null,
      linkedTaskRunId: active.run.linkedTaskRunId ?? null,
      linkedDistributedTaskId: active.run.linkedDistributedTaskId ?? null,
      coalescedIntoRunId: active.run.id,
      idempotencyKey: params.idempotencyKey ?? null,
      triggeredAt,
      completedAt: triggeredAt,
      createdAt: triggeredAt,
      updatedAt: triggeredAt,
    }
    createAutomationRun(coalescedRun)
    touchAutomationAfterRun(automation, { triggeredAt })
    touchTriggerAfterRun(params.trigger ?? null, {
      firedAt: triggeredAt,
      result: status === 'skipped' ? '已跳过，已有进行中的执行。' : '已合并到进行中的执行。',
    })
    return coalescedRun
  }

  const receivedRun: AutomationRunRecord = {
    id: crypto.randomUUID(),
    automationId: automation.id,
    triggerId: params.trigger?.id ?? null,
    source: params.source,
    status: 'received',
    triggerPayload: params.payload ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    triggeredAt,
    createdAt: triggeredAt,
    updatedAt: triggeredAt,
  }
  createAutomationRun(receivedRun)

  try {
    const task = buildAutomationTask(automation, project, sessionTemplate)
    const execution = await executeTaskOnWorkspace({
      state: loadState(),
      userId: automation.ownerUserId,
      task,
      project,
      workspaceId: automation.workspaceId,
      workingDirectoryMode: sessionTemplate?.workingDirectoryMode,
      baseBranch: automation.baseBranch,
      returnMode: automation.returnMode,
      syncBackStrategy: automation.syncBackStrategy,
      gitIdentityMode: automation.gitIdentityMode,
    })

    if (!execution.ok) {
      const failed = updateAutomationRun(receivedRun.id, {
        status: 'failed',
        failureReason: execution.message,
        completedAt: nowIso(),
        updatedAt: nowIso(),
      })
      touchAutomationAfterRun(automation, { triggeredAt })
      touchTriggerAfterRun(params.trigger ?? null, {
        firedAt: triggeredAt,
        result: `执行失败：${execution.message}`,
      })
      return failed ?? receivedRun
    }

    const taskRun = execution.taskRun
    const linkedRun = updateAutomationRun(receivedRun.id, {
      status: 'task_created',
      linkedTaskId: execution.task.id,
      linkedTaskRunId: taskRun.id,
      linkedDistributedTaskId: null,
      updatedAt: nowIso(),
    })
    touchAutomationAfterRun(automation, {
      triggeredAt,
      enqueuedAt: nowIso(),
    })
    touchTriggerAfterRun(params.trigger ?? null, {
      firedAt: triggeredAt,
      result: `已创建任务 ${execution.task.title}`,
    })
    return linkedRun ?? receivedRun
  } catch (error) {
    const message = error instanceof Error ? error.message : '自动化执行失败'
    const failed = updateAutomationRun(receivedRun.id, {
      status: 'failed',
      failureReason: message,
      completedAt: nowIso(),
      updatedAt: nowIso(),
    })
    touchAutomationAfterRun(automation, { triggeredAt })
    touchTriggerAfterRun(params.trigger ?? null, {
      firedAt: triggeredAt,
      result: `执行失败：${message}`,
    })
    return failed ?? receivedRun
  }
}

let automationSchedulerInterval: NodeJS.Timeout | null = null
let automationRecoveryInterval: NodeJS.Timeout | null = null

export const automationService = {
  init: initAutomationStore,

  listByProject(projectId: string) {
    return listAutomationsByProject(projectId).map((automation) => ({
      ...automation,
      triggers: listAutomationTriggers(automation.id),
      lastRun: listAutomationRuns(automation.id, 1)[0] ?? null,
    }))
  },

  getDetail(id: string) {
    const automation = getAutomation(id)
    if (!automation) {
      return null
    }

    return {
      ...automation,
      triggers: listAutomationTriggers(automation.id),
      runs: listAutomationRuns(automation.id, 50),
    }
  },

  getTrigger(id: string) {
    return getAutomationTrigger(id)
  },

  create(project: Project, ownerUserId: string, payload: Omit<AutomationRecord, 'id' | 'projectId' | 'ownerUserId' | 'createdAt' | 'updatedAt'>) {
    ensureAutomationExecutionContext(
      project,
      ownerUserId,
      payload.workspaceId,
      payload.workspaceSessionId?.trim() || undefined,
    )
    const timestamp = nowIso()
    const automation: AutomationRecord = {
      ...payload,
      id: crypto.randomUUID(),
      projectId: project.id,
      ownerUserId,
      executionModel: payload.executionModel?.trim() || undefined,
      workspaceSessionId: payload.workspaceSessionId?.trim() || undefined,
      baseBranch: payload.baseBranch?.trim() || undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    return createAutomation(automation)
  },

  update(id: string, patch: Partial<AutomationRecord>) {
    const existing = getAutomation(id)
    if (!existing) {
      return null
    }
    const project = getProjectById(existing.projectId)
    if (!project) {
      throw new Error('自动化所属项目不存在。')
    }
    const nextWorkspaceId = patch.workspaceId?.trim() || existing.workspaceId
    const nextWorkspaceSessionId = Object.prototype.hasOwnProperty.call(patch, 'workspaceSessionId')
      ? patch.workspaceSessionId?.trim() || undefined
      : existing.workspaceSessionId
    ensureAutomationExecutionContext(project, existing.ownerUserId, nextWorkspaceId, nextWorkspaceSessionId)

    return updateAutomation(id, {
      ...patch,
      executionModel: Object.prototype.hasOwnProperty.call(patch, 'executionModel')
        ? patch.executionModel?.trim() || undefined
        : patch.executionModel,
      workspaceId: nextWorkspaceId,
      workspaceSessionId: nextWorkspaceSessionId,
      baseBranch: Object.prototype.hasOwnProperty.call(patch, 'baseBranch')
        ? patch.baseBranch?.trim() || undefined
        : patch.baseBranch,
      updatedAt: nowIso(),
    })
  },

  createTrigger(automationId: string, payload: {
    kind: AutomationTriggerRecord['kind']
    label?: string
    cronExpression?: string
    timezone?: string
    signingMode?: AutomationTriggerRecord['signingMode']
    replayWindowSec?: number
    enabled?: boolean
  }) {
    const automation = getAutomation(automationId)
    if (!automation) {
      throw new Error('自动化不存在。')
    }

    if (payload.kind === 'schedule') {
      const validationError = validateCron(payload.cronExpression?.trim() || '')
      if (validationError) {
        throw new Error(validationError)
      }
    }

    const timestamp = nowIso()
    const secretValue = payload.kind === 'webhook' ? randomBytes(24).toString('hex') : undefined
    const trigger: AutomationTriggerRecord = {
      id: crypto.randomUUID(),
      automationId,
      kind: payload.kind,
      label: payload.label?.trim() || undefined,
      enabled: payload.enabled ?? true,
      cronExpression: payload.kind === 'schedule' ? payload.cronExpression?.trim() || undefined : undefined,
      timezone: payload.kind === 'schedule' ? payload.timezone?.trim() || 'UTC' : undefined,
      nextRunAt: payload.kind === 'schedule'
        ? resolveNextRunAt({
          cronExpression: payload.cronExpression?.trim() || undefined,
          timezone: payload.timezone?.trim() || 'UTC',
        }, new Date())
        : undefined,
      signingMode: payload.kind === 'webhook' ? payload.signingMode ?? 'bearer' : undefined,
      secretEncrypted: secretValue ? encryptSecret(secretValue) : undefined,
      publicId: payload.kind === 'webhook' ? randomBytes(12).toString('hex') : undefined,
      replayWindowSec: payload.kind === 'webhook' ? payload.replayWindowSec ?? 300 : undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const created = createAutomationTrigger(trigger)
    return {
      trigger: created,
      secret: secretValue,
    }
  },

  updateTrigger(id: string, patch: Partial<AutomationTriggerRecord>) {
    const existing = getAutomationTrigger(id)
    if (!existing) {
      return null
    }

    const cronExpression = patch.cronExpression ?? existing.cronExpression
    const timezone = patch.timezone ?? existing.timezone
    if ((patch.cronExpression !== undefined || patch.timezone !== undefined || patch.enabled !== undefined) && existing.kind === 'schedule') {
      const validationError = validateCron(cronExpression?.trim() || '')
      if (validationError) {
        throw new Error(validationError)
      }
    }

    return updateAutomationTrigger(id, {
      ...patch,
      nextRunAt: existing.kind === 'schedule' && (patch.enabled ?? existing.enabled)
        ? resolveNextRunAt({ cronExpression, timezone }, new Date())
        : patch.enabled === false
          ? null
          : patch.nextRunAt,
      updatedAt: nowIso(),
    })
  },

  rotateTriggerSecret(id: string) {
    const existing = getAutomationTrigger(id)
    if (!existing || existing.kind !== 'webhook') {
      return null
    }

    const secret = randomBytes(24).toString('hex')
    const updated = updateAutomationTrigger(id, {
      secretEncrypted: encryptSecret(secret),
      updatedAt: nowIso(),
    })
    return {
      trigger: updated,
      secret,
    }
  },

  deleteTrigger(id: string) {
    return deleteAutomationTrigger(id)
  },

  runNow(id: string, input?: { triggerId?: string; payload?: Record<string, unknown>; idempotencyKey?: string }) {
    const automation = getAutomation(id)
    if (!automation) {
      throw new Error('自动化不存在。')
    }

    const trigger = input?.triggerId ? getAutomationTrigger(input.triggerId) : null
    if (trigger && trigger.automationId !== automation.id) {
      throw new Error('Trigger 不属于当前自动化。')
    }
    return dispatchAutomation({
      automation,
      trigger,
      source: 'manual',
      payload: input?.payload,
      idempotencyKey: input?.idempotencyKey,
    })
  },

  async fireWebhook(publicId: string, rawBody: string, headers: Headers, payload?: Record<string, unknown>) {
    const trigger = getAutomationTriggerByPublicId(publicId)
    if (!trigger || trigger.kind !== 'webhook' || !trigger.enabled) {
      throw new Error('Webhook trigger 不存在。')
    }

    if (!verifyWebhookTrigger(trigger, rawBody, headers)) {
      throw new Error('Webhook 鉴权失败。')
    }

    const automation = getAutomation(trigger.automationId)
    if (!automation) {
      throw new Error('自动化不存在。')
    }

    return dispatchAutomation({
      automation,
      trigger,
      source: 'webhook',
      payload,
      idempotencyKey: headers.get('x-idempotency-key')?.trim() || undefined,
    })
  },

  async fireApiTrigger(
    triggerId: string,
    input?: { payload?: Record<string, unknown>; idempotencyKey?: string },
  ) {
    const trigger = getAutomationTrigger(triggerId)
    if (!trigger || trigger.kind !== 'api' || !trigger.enabled) {
      throw new Error('API trigger 不存在。')
    }

    const automation = getAutomation(trigger.automationId)
    if (!automation) {
      throw new Error('自动化不存在。')
    }

    return dispatchAutomation({
      automation,
      trigger,
      source: 'api',
      payload: input?.payload,
      idempotencyKey: input?.idempotencyKey?.trim() || undefined,
    })
  },

  async tickScheduledTriggers(now = new Date()) {
    const due = listDueAutomationTriggers(now.toISOString())
    let triggered = 0

    for (const trigger of due) {
      if (!trigger.nextRunAt || !trigger.cronExpression) {
        continue
      }

      const automation = getAutomation(trigger.automationId)
      if (!automation || automation.status !== 'active') {
        continue
      }

      let runCount = 1
      let claimedNextRunAt = resolveNextRunAt(trigger, now) ?? null

      if (automation.catchUpPolicy === 'enqueue_missed_with_cap') {
        let cursor = new Date(trigger.nextRunAt)
        runCount = 0
        while (cursor <= now && runCount < MAX_CATCH_UP_RUNS) {
          runCount += 1
          const next = resolveNextRunAt(trigger, cursor)
          if (!next) {
            break
          }
          claimedNextRunAt = next
          cursor = new Date(next)
        }
      }

      const claimed = await claimAutomationTriggerSchedule({
        id: trigger.id,
        expectedNextRunAt: trigger.nextRunAt,
        nextRunAt: claimedNextRunAt ?? undefined,
        updatedAt: nowIso(),
      })
      if (!claimed) {
        continue
      }

      for (let index = 0; index < runCount; index += 1) {
        await dispatchAutomation({
          automation,
          trigger: getAutomationTrigger(trigger.id),
          source: 'schedule',
        })
        triggered += 1
      }
    }

    return { triggered }
  },

  syncAutomationRunStatuses() {
    let updated = 0
    for (const run of listIncompleteAutomationRuns()) {
      if (!run.linkedTaskId) {
        continue
      }
      const task = getTaskById(run.linkedTaskId)
      if (!task) {
        continue
      }

      if (task.status === 'done') {
        updateAutomationRun(run.id, {
          status: 'completed',
          completedAt: nowIso(),
          updatedAt: nowIso(),
        })
        updated += 1
        continue
      }

      if (task.status === 'blocked' || task.status === 'cancelled') {
        updateAutomationRun(run.id, {
          status: 'failed',
          failureReason: `关联任务状态为 ${task.status}`,
          completedAt: nowIso(),
          updatedAt: nowIso(),
        })
        updated += 1
      }
    }

    return { updated }
  },

  startScheduler() {
    void withPostgresLease(
      'vibemux:scheduler:automation-trigger',
      () => this.tickScheduledTriggers(new Date()),
    ).catch((error) => {
      console.error('[automation] initial scheduler tick failed', error)
    })
    try {
      this.syncAutomationRunStatuses()
    } catch (error) {
      console.error('[automation] initial run status sync failed', error)
    }

    if (!automationSchedulerInterval) {
      automationSchedulerInterval = setInterval(() => {
        void withPostgresLease(
          'vibemux:scheduler:automation-trigger',
          () => this.tickScheduledTriggers(new Date()),
        ).catch((error) => {
          console.error('[automation] scheduler tick failed', error)
        })
      }, 30_000)
    }

    if (!automationRecoveryInterval) {
      automationRecoveryInterval = setInterval(() => {
        try {
          this.syncAutomationRunStatuses()
        } catch (error) {
          console.error('[automation] run status sync failed', error)
        }
      }, 15_000)
    }
  },

  stopScheduler() {
    if (automationSchedulerInterval) {
      clearInterval(automationSchedulerInterval)
      automationSchedulerInterval = null
    }
    if (automationRecoveryInterval) {
      clearInterval(automationRecoveryInterval)
      automationRecoveryInterval = null
    }
  },

  getRun(id: string) {
    return getAutomationRun(id)
  },
}
