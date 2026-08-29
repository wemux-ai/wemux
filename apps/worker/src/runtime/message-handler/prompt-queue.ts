/**
 * [INPUT]: Agent prompt requests, worker concurrency state, update drain state, and runtime execution callbacks.
 * [OUTPUT]: Queued prompt execution, streamed control-plane events, cancellation, and drain-time rejection.
 * [POS]: Worker-side prompt admission and execution queue for main chat and workspace chat turns.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { ensureAgentWorkdirLayout, touchAgentWorkdirSession } from '@shared/agent-workdir'
import { loadWorkerRuntimeConfig } from '../../core/runtime-cloud-url'
import { runWorkerAgentPrompt } from '../../execution/agent-runner'
import { remapManagedProjectPath } from '../managed-workspace-path'
import { buildPromptExecutionId } from './shared'
import type { ExecutorAgentPromptAbortReason } from '@shared/types'
import type { AgentPromptRequestMessage, ControlPlaneMessageHandlerParams } from './types'

export const createPromptQueue = (params: ControlPlaneMessageHandlerParams) => {
  const state = params.promptQueueState ?? createPromptQueueState()
  const { pendingPromptRequests, pendingPromptAborts, queuedPromptRequestIds } = state

  const emitPromptStatus = (message: AgentPromptRequestMessage, statusMessage: string) => {
    const config = params.getConfig()
    params.send({
      type: 'executor.agent.prompt.event',
      executorId: config.executorId!,
      requestId: message.requestId,
      event: {
        agentType: message.agentType,
        type: 'session.status',
        properties: {
          status: {
            type: 'busy',
            message: statusMessage,
          },
        },
      },
      at: new Date().toISOString(),
    })
  }

  const dequeuePromptRequestId = (requestId: string) => {
    const queueIndex = queuedPromptRequestIds.indexOf(requestId)
    if (queueIndex !== -1) {
      queuedPromptRequestIds.splice(queueIndex, 1)
    }
    params.setQueuedTaskIds(params.getQueuedTaskIds().filter((item) => item !== buildPromptExecutionId(requestId)))
  }

  const finishPromptExecution = (requestId: string) => {
    pendingPromptRequests.delete(requestId)
    pendingPromptAborts.delete(requestId)
    params.setRunningTaskIds(params.getRunningTaskIds().filter((item) => item !== buildPromptExecutionId(requestId)))
    params.syncRuntimeState()
    params.drainExecutionQueue()
  }

  const startPromptExecution = (message: AgentPromptRequestMessage) => {
    let config = loadWorkerRuntimeConfig()
    params.setConfig(config)
    dequeuePromptRequestId(message.requestId)
    params.setRunningTaskIds([...params.getRunningTaskIds(), buildPromptExecutionId(message.requestId)])
    params.syncRuntimeState()

    console.log('[worker-agent] prompt request', JSON.stringify({
      requestId: message.requestId,
      agentType: message.agentType,
      cwd: message.cwd,
      agentWorkdir: message.agentWorkdir?.agentId ?? null,
      title: message.title,
      executionModel: message.executionModel ?? 'default',
      attachmentCount: message.attachments?.length ?? 0,
      promptPreview: message.prompt.slice(0, 160),
    }))

    const effectiveCwd = message.agentWorkdir?.agentId
      ? (() => {
          const workspaceId = message.agentWorkdir?.workspaceId?.trim() || undefined
          const ensured = ensureAgentWorkdirLayout(message.agentWorkdir.agentId, undefined, workspaceId)
          touchAgentWorkdirSession(
            message.agentWorkdir.agentId,
            message.agentWorkdir.sessionId?.trim() || message.requestId,
            undefined,
            workspaceId,
          )
          return ensured.summary.workDirPath
        })()
      : message.cwd
    const resolvedCwd = remapManagedProjectPath(config.workspaceRoot, effectiveCwd) || effectiveCwd

    const abortController = new AbortController()
    pendingPromptAborts.set(message.requestId, abortController)

    void runWorkerAgentPrompt({
      agentType: message.agentType,
      actingUserId: message.actingUserId,
      runtimeAgentId: message.runtimeAgentId,
      resumeSessionId: message.resumeSessionId,
      workspaceId: message.agentWorkdir?.workspaceId?.trim() || undefined,
      cwd: resolvedCwd,
      title: message.title,
      prompt: message.prompt,
      attachments: message.attachments,
      cloudUrl: config.cloudUrl,
      executionModel: message.executionModel,
      agentSettings: message.agentSettings ?? config.agentSettings[message.agentType],
      opencodeConfig: message.opencodeConfig,
      mcpServers: message.mcpServers,
      runtimeSkillPackages: message.runtimeSkillPackages,
      runtimeEnv: message.runtimeEnv,
      runtimeEnvironment: message.runtimeEnvironment,
      signal: abortController.signal,
      onEvent: (event) => {
        config = params.getConfig()
        params.send({
          type: 'executor.agent.prompt.event',
          executorId: config.executorId!,
          requestId: message.requestId,
          event,
          at: new Date().toISOString(),
        })
      },
    }).then((result) => {
      config = params.getConfig()
      console.log('[worker-agent] prompt response', JSON.stringify({
        requestId: message.requestId,
        ok: true,
        sessionId: result.sessionId,
        outputPreview: result.output.slice(0, 200),
      }))
      params.send({
        type: 'executor.agent.prompt.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result: {
          ok: true,
          output: result.output,
          sessionId: result.sessionId,
          usage: result.usage,
        },
        at: new Date().toISOString(),
      })
    }).catch((error) => {
      config = params.getConfig()
      const abortReason = error instanceof Error
        ? (error as Error & { abortReason?: ExecutorAgentPromptAbortReason }).abortReason
        : undefined
      console.log('[worker-agent] prompt response', JSON.stringify({
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : `${message.agentType} 执行失败。`,
        abortReason: abortReason ?? null,
      }))
      params.send({
        type: 'executor.agent.prompt.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result: {
          ok: false,
          output: error instanceof Error ? error.message : `${message.agentType} 执行失败。`,
          ...(abortReason ? { aborted: true, abortReason } : {}),
        },
        at: new Date().toISOString(),
      })
    }).finally(() => {
      finishPromptExecution(message.requestId)
    })
  }

  const drainPromptQueue = () => {
    let config = loadWorkerRuntimeConfig()
    params.setConfig(config)

    while (params.getRunningTaskIds().length < Math.max(1, config.maxConcurrency) && queuedPromptRequestIds.length > 0) {
      const nextRequestId = queuedPromptRequestIds[0]
      if (!nextRequestId) {
        break
      }

      const nextRequest = pendingPromptRequests.get(nextRequestId)
      if (!nextRequest) {
        dequeuePromptRequestId(nextRequestId)
        continue
      }

      startPromptExecution(nextRequest)
      config = params.getConfig()
    }
  }

  const handlePromptMessage = (message: AgentPromptRequestMessage | {
    type: 'executor.agent.prompt.cancel'
    requestId: string
    reason?: ExecutorAgentPromptAbortReason
    message?: string
  }) => {
    if (message.type === 'executor.agent.prompt.request') {
      if (params.isDrainingForUpdate?.()) {
        const config = params.getConfig()
        params.send({
          type: 'executor.agent.prompt.response',
          executorId: config.executorId!,
          requestId: message.requestId,
          result: {
            ok: false,
            output: 'Worker 正在等待当前任务完成并更新，请稍后重试。',
          },
          at: new Date().toISOString(),
        })
        return true
      }

      if (!pendingPromptRequests.has(message.requestId)) {
        pendingPromptRequests.set(message.requestId, message)
        queuedPromptRequestIds.push(message.requestId)
        params.setQueuedTaskIds([...params.getQueuedTaskIds(), buildPromptExecutionId(message.requestId)])
        params.syncRuntimeState()
        const config = params.getConfig()
        if (params.getRunningTaskIds().length >= Math.max(1, config.maxConcurrency)) {
          emitPromptStatus(message, '当前节点正在处理其他请求，已进入排队，稍后会自动开始。')
        }
      }
      drainPromptQueue()
      return true
    }

    dequeuePromptRequestId(message.requestId)
    const activeAbortController = pendingPromptAborts.get(message.requestId)
    if (!activeAbortController) {
      pendingPromptRequests.delete(message.requestId)
      finishPromptExecution(message.requestId)
      return true
    }

    activeAbortController.abort({
      reason: message.reason ?? 'unknown',
      message: message.message,
    })
    return true
  }

  const abortActivePrompts = () => {
    const requestIds = [...pendingPromptRequests.keys()]
    if (requestIds.length === 0) {
      return
    }

    for (const requestId of requestIds) {
      dequeuePromptRequestId(requestId)
      pendingPromptRequests.delete(requestId)
      pendingPromptAborts.get(requestId)?.abort({
        reason: 'control_plane_disconnect',
        message: '执行器与控制面连接已断开，本次回复已中止。',
      })
      pendingPromptAborts.delete(requestId)
    }

    params.syncRuntimeState()
  }

  return {
    abortActivePrompts,
    drainPromptQueue,
    handlePromptMessage,
  }
}

export type PromptQueueState = {
  pendingPromptRequests: Map<string, AgentPromptRequestMessage>
  pendingPromptAborts: Map<string, AbortController>
  queuedPromptRequestIds: string[]
}

export const createPromptQueueState = (): PromptQueueState => ({
  pendingPromptRequests: new Map(),
  pendingPromptAborts: new Map(),
  queuedPromptRequestIds: [],
})
