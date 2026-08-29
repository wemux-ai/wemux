import { syncTaskStatusFromReviewReady, touchTaskStatus } from '@shared/task-status-flow'
import { isOpenCodeMissingTextOutput } from '@shared/opencode-message-output'
import { createAssistantMessageEvent, createSystemMessageEvent, createTimelineCollector, createUserMessageEvent } from '../../integrations/opencode/task-chat-stream'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { ExecutorAgentPromptResult, Project, Task, WorkspaceSession } from '@shared/types'
import { appendTaskConversationMessage, getTaskConversationWithMessages } from '../../control-plane/conversation-service'
import { getMeta, loadState, saveMeta, saveTask, saveWorkspaceSession } from '../../storage/app-state-store'
import { ensurePostgresReady } from '../../storage/postgres/db'
import { getDrizzleDb } from '../../storage/postgres/drizzle-db'
import { appMeta } from '../../storage/postgres/schema'
import { getWorkspaceSessionRecordForTaskContext, upsertWorkspaceSessionInState } from '../../routes/task-route-support'
import { withState } from '../../routes/shared'
import { applyWorkspaceMessageResult } from './result-utils'
import { publishTaskChatSessionUpdate, publishTaskChatTaskUpdate, publishTaskChatTimelineEvent } from './runtime-state'

const PENDING_WORKSPACE_PROMPT_META_KEY = 'pendingWorkspacePromptRequests'
const STALE_TASK_CHAT_RUNTIME_MESSAGE = '控制面已重启，上一次工作区对话没有完成回传。请重新发送消息。'

type PendingWorkspacePromptRecord = {
  requestId: string
  executorId: string
  taskId: string
  workspaceId: string
  workspaceSessionId: string
  userId: string
  userMessage: string
  attachments: TaskChatAttachment[]
  turnId: string
  expectedRuntimeSequence: number
  executionModel?: string
  createdAt: string
}

const promptRecoveryStateLock = (() => {
  let current = Promise.resolve()

  return async <T>(runner: () => T | Promise<T>) => {
    const previous = current
    let release!: () => void
    current = new Promise<void>((resolve) => {
      release = resolve
    })

    await previous.catch(() => undefined)

    try {
      return await runner()
    } finally {
      release()
    }
  }
})()

const normalizePendingWorkspacePromptRecord = (value: unknown): PendingWorkspacePromptRecord | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const requestId = typeof record.requestId === 'string' ? record.requestId.trim() : ''
  const executorId = typeof record.executorId === 'string' ? record.executorId.trim() : ''
  const taskId = typeof record.taskId === 'string' ? record.taskId.trim() : ''
  const workspaceId = typeof record.workspaceId === 'string' ? record.workspaceId.trim() : ''
  const workspaceSessionId = typeof record.workspaceSessionId === 'string' ? record.workspaceSessionId.trim() : ''
  const userId = typeof record.userId === 'string' ? record.userId.trim() : ''
  const userMessage = typeof record.userMessage === 'string' ? record.userMessage : ''
  const turnId = typeof record.turnId === 'string' ? record.turnId.trim() : ''
  const expectedRuntimeSequence = typeof record.expectedRuntimeSequence === 'number'
    ? record.expectedRuntimeSequence
    : Number(record.expectedRuntimeSequence)
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : ''
  const executionModel = typeof record.executionModel === 'string' && record.executionModel.trim()
    ? record.executionModel.trim()
    : undefined
  if (
    !requestId
    || !executorId
    || !taskId
    || !workspaceId
    || !workspaceSessionId
    || !userId
    || !turnId
    || !Number.isFinite(expectedRuntimeSequence)
    || !createdAt
  ) {
    return null
  }

  return {
    requestId,
    executorId,
    taskId,
    workspaceId,
    workspaceSessionId,
    userId,
    userMessage,
    attachments: Array.isArray(record.attachments) ? record.attachments as TaskChatAttachment[] : [],
    turnId,
    expectedRuntimeSequence,
    executionModel,
    createdAt,
  }
}

const listPendingWorkspacePromptRecords = () => {
  const stored = getMeta<unknown>(PENDING_WORKSPACE_PROMPT_META_KEY, [])
  if (!Array.isArray(stored)) {
    return []
  }

  return stored
    .map((item) => normalizePendingWorkspacePromptRecord(item))
    .filter((item): item is PendingWorkspacePromptRecord => Boolean(item))
}

const persistPendingWorkspacePromptRecords = async (records: PendingWorkspacePromptRecord[]) => {
  saveMeta(PENDING_WORKSPACE_PROMPT_META_KEY, records)
  await ensurePostgresReady()
  await getDrizzleDb()
    .insert(appMeta)
    .values({ key: PENDING_WORKSPACE_PROMPT_META_KEY, value: records })
    .onConflictDoUpdate({
      target: appMeta.key,
      set: { value: records },
    })
}

const buildRecoveredTimeline = (record: PendingWorkspacePromptRecord, result: ExecutorAgentPromptResult, ts: string) => {
  const timeline = createTimelineCollector(record.turnId)
  const replyText = (result.output || '').trim()
  const events = [
    createUserMessageEvent(
      timeline,
      `user:${record.requestId}`,
      record.userMessage,
      ts,
      record.attachments,
      {
        authorId: record.userId,
      },
    ),
  ]

  if (result.aborted || result.abortReason) {
    return [
      ...events,
      createSystemMessageEvent(
        timeline,
        replyText || (result.abortReason === 'user_stop' ? '已停止' : '本次回复已中止'),
        ts,
        result.abortReason ?? 'interrupted',
      ),
    ]
  }

  if (!replyText || isOpenCodeMissingTextOutput(replyText)) {
    return events
  }

  return [
    ...events,
    createAssistantMessageEvent(
      timeline,
      result.sessionId ? `${result.sessionId}:assistant` : `${record.requestId}:assistant`,
      replyText,
      ts,
      undefined,
      undefined,
      record.executionModel,
    ),
  ]
}

const shouldApplyRecoveredResponse = (session: WorkspaceSession, expectedRuntimeSequence: number) => {
  if (session.runtimeSequence < expectedRuntimeSequence) {
    return false
  }

  if (session.runtimeSequence === expectedRuntimeSequence) {
    return true
  }

  return session.runtimeSequence === expectedRuntimeSequence + 1
    && (session.runtimeStatus === 'lost' || session.runtimeStatus === 'error')
    && session.currentStep === STALE_TASK_CHAT_RUNTIME_MESSAGE
}

const loadWorkspacePromptRecoveryContext = (record: PendingWorkspacePromptRecord): {
  task: Task
  project: Project
  session: WorkspaceSession
} | null => {
  const state = loadState()
  const task = state.tasks.find((item) => item.id === record.taskId)
  if (!task) {
    return null
  }

  const project = state.projects.find((item) => item.id === task.projectId)
  if (!project) {
    return null
  }

  const session = getWorkspaceSessionRecordForTaskContext(task.id, record.workspaceId, record.workspaceSessionId)
  if (!session || session.status === 'archived') {
    return null
  }

  return {
    task,
    project,
    session,
  }
}

export const registerPendingWorkspacePrompt = async (record: PendingWorkspacePromptRecord) => {
  await promptRecoveryStateLock(async () => {
    const current = listPendingWorkspacePromptRecords()
    const nextRecords = [
      ...current.filter((item) => item.requestId !== record.requestId),
      record,
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.requestId.localeCompare(right.requestId))
    await persistPendingWorkspacePromptRecords(nextRecords)
  })
}

export const clearPendingWorkspacePrompt = async (requestId: string) => {
  await promptRecoveryStateLock(async () => {
    const current = listPendingWorkspacePromptRecords()
    const nextRecords = current.filter((item) => item.requestId !== requestId)
    if (nextRecords.length === current.length) {
      return
    }

    await persistPendingWorkspacePromptRecords(nextRecords)
  })
}

export const recoverPendingWorkspacePromptResponse = async (params: {
  requestId: string
  executorId: string
  result: ExecutorAgentPromptResult
  at: string
}) => {
  const record = listPendingWorkspacePromptRecords().find((item) => item.requestId === params.requestId)
  if (!record || record.executorId !== params.executorId) {
    return false
  }

  const context = loadWorkspacePromptRecoveryContext(record)
  if (!context) {
    await clearPendingWorkspacePrompt(record.requestId)
    return false
  }

  if (!shouldApplyRecoveredResponse(context.session, record.expectedRuntimeSequence)) {
    await clearPendingWorkspacePrompt(record.requestId)
    return false
  }

  const conversationTimeline = buildRecoveredTimeline(record, params.result, params.at)
  const result = {
    ok: params.result.ok,
    output: params.result.output,
    turnId: record.turnId,
    executionModel: record.executionModel,
    agentSessionId: params.result.sessionId,
    opencodeSessionId: params.result.sessionId,
    conversationTimeline,
    agentRunningStatus: params.result.ok ? 'complete' as const : 'error' as const,
    currentStep: params.result.ok ? '工作区对话已完成' : '工作区对话失败',
  }

  const nextTask: Task = {
    ...(result.ok ? syncTaskStatusFromReviewReady(context.task, params.at) : touchTaskStatus(context.task, params.at)),
    needsHumanConfirm: result.ok,
    agentRunningStatus: result.agentRunningStatus,
    currentStep: result.currentStep,
  }
  const nextSession = applyWorkspaceMessageResult(context.task, context.session, result)

  saveTask(nextTask)
  saveWorkspaceSession(nextSession)

  appendTaskConversationMessage({
    task: context.task,
    project: context.project,
    workspaceId: record.workspaceId,
    workspaceSessionId: record.workspaceSessionId,
    role: 'user',
    senderId: record.userId,
    content: record.userMessage,
    contentType: 'json',
    externalRef: record.attachments.length > 0 ? { attachments: record.attachments } : undefined,
  })

  const recoveredSystemMessage = conversationTimeline.find((event) => event.kind === 'system_message')
  if (recoveredSystemMessage?.kind === 'system_message') {
    appendTaskConversationMessage({
      task: nextTask,
      project: context.project,
      workspaceId: record.workspaceId,
      workspaceSessionId: record.workspaceSessionId,
      role: 'system',
      content: recoveredSystemMessage.message,
      contentType: 'json',
      externalRef: { timelineEvent: recoveredSystemMessage },
    })
  } else if (result.output.trim() && !isOpenCodeMissingTextOutput(result.output)) {
    appendTaskConversationMessage({
      task: nextTask,
      project: context.project,
      workspaceId: record.workspaceId,
      workspaceSessionId: record.workspaceSessionId,
      role: 'assistant',
      content: result.output,
      contentType: 'json',
      externalRef: result.executionModel ? { executionModel: result.executionModel } : undefined,
    })
  }

  const conversationPayload = getTaskConversationWithMessages(
    nextTask,
    context.project,
    record.workspaceId,
    record.workspaceSessionId,
  )
  const finalizedSession = conversationPayload.messages.length > 0
    ? {
        ...nextSession,
        lastActiveAt: conversationPayload.messages.at(-1)?.createdAt ?? nextSession.lastActiveAt,
        updatedAt: new Date().toISOString(),
      }
    : nextSession
  if (finalizedSession !== nextSession) {
    saveWorkspaceSession(finalizedSession)
  }

  publishTaskChatTaskUpdate(nextTask.id, record.workspaceId, record.workspaceSessionId, {
    id: nextTask.id,
    agentRunningStatus: nextTask.agentRunningStatus,
    currentStep: nextTask.currentStep,
    toolCalls: nextTask.toolCalls,
    logs: nextTask.logs,
  })
  publishTaskChatSessionUpdate(nextTask.id, record.workspaceId, record.workspaceSessionId, nextTask, context.project)
  for (const event of result.conversationTimeline ?? []) {
    publishTaskChatTimelineEvent(nextTask.id, record.workspaceId, record.workspaceSessionId, event)
  }

  const finalStateSource = loadState()
  const nextTasks = finalStateSource.tasks.map((item) => (item.id === nextTask.id ? nextTask : item))
  const nextState = upsertWorkspaceSessionInState({ ...finalStateSource, tasks: nextTasks }, finalizedSession)
  await withState(nextState, undefined, record.userId)
  await clearPendingWorkspacePrompt(record.requestId)
  return true
}
