import { existsSync } from 'node:fs'
import { simpleGit } from 'simple-git'
import { attachTaskResultDelivery } from '@shared/distributed-task-result'
import { unwrapOpenCodeEvent } from '@shared/opencode-event'
import { buildTaskChatSessionKey } from '@shared/task-chat-session'
import { resolveWorkspaceAutoCommitEnabled } from '@shared/task-workspace'
import type { WorkspaceTaskExecutionView } from '@shared/task-workspace'
import type { ChatTimelineEvent } from '@shared/timeline'
import type { AgentAdapter, AgentConfig, ExecutionLog, ExecutionModelOption, Project, Task, TaskRun, TaskRuntimeGitIdentity } from '@shared/types'
import { createSession, ensureSession, isAbortError, runPersistentOpenCodePrompt, withOpencodeSessionLock } from './session'
import {
  findExecutable,
  getErrorText,
  getOpencodeClient,
  getRootOpencodeClient,
  logOpenCodeDebug,
  logPrompt,
  normalizeModelResponse,
  parseExecutionModel,
} from './core'
import { finalizeTaskWorktreeGit } from '../git/service'
import { publishTaskChatPart } from '../../services/task-chat-broadcast-service'
import { buildToolCall } from '../../services/agent-tool-call'
import { listTaskRuns } from '../../storage/app-state-store'
import { getWorkspace } from '../../storage/distributed-task-store'
import { buildTaskAgentSystemPrompt } from './prompts'
import {
  applyAgentMessageResultToTask,
  createAssistantMessageEvent,
  createErrorEvent,
  createInteractionEvent,
  createStatusEvent,
  createThinkingEvent,
  createTimelineCollector,
  createToolCallEvent,
  emitTextDelta,
  extractAssistantText,
  extractStreamingText,
  finishActiveParts,
  resetStreamingPartState,
  type TaskChatStreamWriter,
  type AgentMessageResult,
  writeFinalTextResult,
  writeTimelineEvent,
} from './task-chat-stream'
import {
  hasWorkspaceRuntime,
  isInteractiveQuestionTool,
  resolveTaskWorkingDirectory,
  throwIfAborted,
} from './service-helpers'

export type { AgentMessageResult } from './task-chat-stream'

const readPendingInteraction = (properties: Record<string, unknown>, fallbackId: string) => {
  const interaction = properties.interaction
  if (!interaction || typeof interaction !== 'object') {
    return null
  }

  const record = interaction as Record<string, unknown>
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  if (!title) {
    return null
  }

  const type: 'question' | 'approval' | 'permission' = record.type === 'approval' || record.type === 'permission' ? record.type : 'question'
  return {
    id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : fallbackId,
    type,
    status: 'pending' as const,
    title,
    prompt: typeof record.prompt === 'string' && record.prompt.trim() ? record.prompt.trim() : undefined,
    provider: typeof record.provider === 'string' && record.provider.trim() ? record.provider.trim() : undefined,
    toolName: typeof record.toolName === 'string' && record.toolName.trim() ? record.toolName.trim() : undefined,
  }
}

export const checkAdapters = async (config: AgentConfig, adapters: AgentAdapter[]): Promise<AgentAdapter[]> => {
  const now = new Date().toISOString()
  return adapters
    .filter((adapter) => adapter.id === 'OpenCode')
    .map((adapter) => ({
      ...adapter,
      heartbeatAt: now,
      status: findExecutable(config.opencodeCommand) ? 'online' : 'offline',
    }))
}

export const listAvailableModels = async (configContent?: string): Promise<{ ok: boolean; models: ExecutionModelOption[]; defaultModel?: string; message?: string }> => {
  const normalizedConfig = configContent?.trim() ?? ''

  if (!normalizedConfig) {
    return {
      ok: true,
      models: [],
      message: '尚未配置 OpenCode 提供商，暂时没有可用模型。',
    }
  }

  try {
    const client = await getRootOpencodeClient(configContent)
    const response = await client.config.providers()
    const raw = 'data' in response ? response.data : response
    const defaultEntry = Object.entries((raw as { default?: Record<string, string> } | undefined)?.default ?? {}).find(([, modelId]) => Boolean(modelId))
    const defaultModelId = defaultEntry ? `${defaultEntry[0]}/${defaultEntry[1]}` : undefined
    const models = normalizeModelResponse(raw, defaultModelId)

    return {
      ok: true,
      models,
      defaultModel: defaultModelId,
      message: models.length > 0 ? '模型列表加载成功。' : '未读取到可用模型，请检查 OpenCode 提供商配置。',
    }
  } catch (error) {
    return {
      ok: true,
      models: [],
      message: getErrorText(error),
    }
  }
}

const runAgentPrompt = async (task: Task, project: Project, config: AgentConfig, prompt: string, signal?: AbortSignal): Promise<AgentPromptResult> => {
  const workingDirectory = await resolveTaskWorkingDirectory(task, project, config)

  if (!existsSync(workingDirectory)) {
    logOpenCodeDebug('task-cwd:missing', {
      taskId: task.id,
      projectId: project.id,
      workingDirectory,
      configuredWorkspaceRoot: config.workspaceRoot,
    })
    return {
      ok: false,
      output: `启动失败: 工作目录不存在 \`${workingDirectory}\`。`,
    }
  }

  logOpenCodeDebug('dispatch:branch', {
    mode: 'sdk',
    projectPath: workingDirectory,
    opencodeCommand: config.opencodeCommand,
  })

  return runPersistentOpenCodePrompt(task, project, prompt, undefined, signal)
}

interface AgentPromptResult {
  ok: boolean
  output: string
  agentSessionId?: string
  opencodeSessionId?: string
  taskRunId?: string
  aborted?: boolean
}

const resolveWorkspaceSessionTaskCarrier = (task: Task | WorkspaceTaskExecutionView): TaskRun | null => {
  const runs = listTaskRuns(task.id)
    .filter((run) => !hasWorkspaceRuntime(task) || run.workspaceId === task.workspaceId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))

  return runs[0] ?? null
}

export const sendTaskMessageToAgent = async (
  task: Task,
  project: Project,
  config: AgentConfig,
  message: string,
  signal?: AbortSignal,
  gitIdentity?: TaskRuntimeGitIdentity,
  turnId?: string,
): Promise<AgentMessageResult> => {
  return runOpenCodeTaskMessage(task, project, config, message, undefined, signal, gitIdentity, turnId)
}

const runOpenCodeTaskMessage = async (
  task: Task | WorkspaceTaskExecutionView,
  project: Project,
  config: AgentConfig,
  message: string,
  writer?: TaskChatStreamWriter,
  signal?: AbortSignal,
  gitIdentity?: TaskRuntimeGitIdentity,
  turnId?: string,
): Promise<AgentMessageResult> => {
  const timeline = createTimelineCollector(turnId ?? crypto.randomUUID())
  const cwd = await resolveTaskWorkingDirectory(task, project, config, gitIdentity)
  const systemPrompt = buildTaskAgentSystemPrompt(task, project)
  if (!existsSync(cwd)) {
    logOpenCodeDebug('task-chat:missing-cwd', {
      taskId: task.id,
      projectId: project.id,
      cwd,
      configuredWorkspaceRoot: config.workspaceRoot,
      opencodeSessionId: hasWorkspaceRuntime(task) ? task.opencodeSessionId : undefined,
    })
    return {
      ok: false,
      output: `启动失败: 工作目录不存在 \`${cwd}\`。`,
      turnId: timeline.turnId,
      agentSessionId: hasWorkspaceRuntime(task) ? (task.agentSessionId ?? task.opencodeSessionId) : undefined,
      opencodeSessionId: hasWorkspaceRuntime(task) ? task.opencodeSessionId : undefined,
      toolCalls: task.toolCalls,
      agentRunningStatus: 'error',
      currentStep: '任务详情对话失败',
      conversationTimeline: [createErrorEvent(timeline, `启动失败: 工作目录不存在 \`${cwd}\`。`, new Date().toISOString())],
    }
  }

  const client = await getOpencodeClient(cwd)
  const textState = new Map<string, string>()
  const reasoningState = new Map<string, string>()
  const textStateByMessageId = new Map<string, Map<string, string>>()
  const reasoningStateByMessageId = new Map<string, Map<string, string>>()
  const activeTextParts = new Set<string>()
  const activeReasoningParts = new Set<string>()
  const toolCallMap = new Map(task.toolCalls.map((tool) => [tool.id, tool]))
  const approvalRequests: string[] = []
  const taskChatSessionKey = buildTaskChatSessionKey(task.id, hasWorkspaceRuntime(task) ? task.workspaceId : undefined)

  const getMessagePartState = (state: Map<string, Map<string, string>>, messageId: string) => {
    const existing = state.get(messageId)
    if (existing) {
      return existing
    }

    const next = new Map<string, string>()
    state.set(messageId, next)
    return next
  }

  const flushBufferedParts = (messageId: string, type: 'text' | 'reasoning') => {
    if (!writer) {
      return
    }

    const stateByMessageId = type === 'text' ? textStateByMessageId : reasoningStateByMessageId
    const state = type === 'text' ? textState : reasoningState
    const active = type === 'text' ? activeTextParts : activeReasoningParts
    const bufferedParts = stateByMessageId.get(messageId)
    if (!bufferedParts) {
      return
    }

    for (const [partId, fullText] of bufferedParts.entries()) {
      emitTextDelta(writer, state, active, partId, fullText, undefined, type)
    }
  }

  const writeTaskTimelineEvent = (event: ChatTimelineEvent) => {
    writeTimelineEvent(writer, event)
    publishTaskChatPart(taskChatSessionKey, {
      type: 'timeline_event',
      data: event,
    })
  }

  const assistantSegmentIndexByMessageId = new Map<string, number>()
  const assistantSegmentStartLengthByMessageId = new Map<string, number>()
  const assistantLastFullTextByMessageId = new Map<string, string>()
  const splitAssistantSegmentOnNextText = new Set<string>()

  const syncAssistantTimeline = (messageId: string) => {
    const currentText = extractStreamingText(textState, message)
    if (!currentText) {
      return
    }

    const previousFullText = assistantLastFullTextByMessageId.get(messageId) ?? ''
    const shouldSplitSegment = splitAssistantSegmentOnNextText.has(messageId) && currentText.length > previousFullText.length
    if (shouldSplitSegment) {
      const nextIndex = (assistantSegmentIndexByMessageId.get(messageId) ?? 0) + 1
      assistantSegmentIndexByMessageId.set(messageId, nextIndex)
      assistantSegmentStartLengthByMessageId.set(messageId, previousFullText.length)
      splitAssistantSegmentOnNextText.delete(messageId)
    }

    const segmentIndex = assistantSegmentIndexByMessageId.get(messageId) ?? 0
    const segmentStartLength = assistantSegmentStartLengthByMessageId.get(messageId) ?? 0
    const segmentText = currentText.slice(segmentStartLength)
    if (!segmentText) {
      return
    }

    writeTaskTimelineEvent(
      createAssistantMessageEvent(
        timeline,
        messageId,
        segmentText,
        new Date().toISOString(),
        `${messageId}:segment:${segmentIndex}`,
      ),
    )
    assistantLastFullTextByMessageId.set(messageId, currentText)
  }

  const sessionCarrier = resolveWorkspaceSessionTaskCarrier(task)
  let sessionId = sessionCarrier?.agentSessionId ?? sessionCarrier?.opencodeSessionId ?? (hasWorkspaceRuntime(task) ? (task.agentSessionId ?? task.opencodeSessionId) : undefined)
  let currentStatus: Task['agentRunningStatus'] = 'thinking'
  let currentStep = '正在连接 OpenCode 会话'
  let assistantMessageId = ''

  logOpenCodeDebug('task-chat:start', {
    taskId: task.id,
    projectId: project.id,
    cwd,
    existingSessionId: sessionId,
    messagePreview: message.slice(0, 200),
  })

  try {
    throwIfAborted(signal)

    if (!sessionId) {
      sessionId = await createSession(client, cwd, `Task: ${task.title}`)
    } else {
      sessionId = await ensureSession(client, cwd, sessionId, `Task: ${task.title}`)
    }

    logOpenCodeDebug('task-chat:session-ready', {
      taskId: task.id,
      projectId: project.id,
      cwd,
      sessionId,
    })

    if (!sessionId) {
      throw new Error('OpenCode 会话初始化失败')
    }

    const activeSessionId = sessionId

    await withOpencodeSessionLock(activeSessionId, async ({ waited }) => {
      if (waited) {
        currentStatus = 'waiting'
        currentStep = '等待同一会话中的上一轮消息完成'
        writeTaskTimelineEvent(createStatusEvent(timeline, currentStatus, currentStep, new Date().toISOString()))
      }

      currentStatus = 'thinking'
      currentStep = 'OpenCode 会话已就绪，准备发送消息'
      writeTaskTimelineEvent(createStatusEvent(timeline, currentStatus, currentStep, new Date().toISOString()))

      const abortController = new AbortController()
      const handleAbort = () => {
        abortController.abort()
      }

      signal?.addEventListener('abort', handleAbort, { once: true })

      try {
        const subscription = await client.event.subscribe({ signal: abortController.signal })
        let sawRelevantActivity = false
        let promptError: Error | null = null

        logPrompt('[opencode-sdk] task-chat user:', message)

        const promptPromise = client.session.promptAsync({
          path: { id: activeSessionId },
          query: { directory: cwd },
          body: {
            model: parseExecutionModel(task.executionModel),
            system: systemPrompt,
            parts: [{ type: 'text', text: message }],
          },
        }).catch((error) => {
          if (signal?.aborted) {
            return undefined
          }

          promptError = error instanceof Error ? error : new Error(getErrorText(error))
          return undefined
        })

        currentStatus = 'executing'
        currentStep = 'OpenCode 正在处理消息'
        writeTaskTimelineEvent(createStatusEvent(timeline, currentStatus, currentStep, new Date().toISOString()))

        for await (const rawEvent of subscription.stream as AsyncIterable<Record<string, unknown>>) {
          throwIfAborted(signal)

          const event = unwrapOpenCodeEvent(rawEvent)
          if (!event) {
            continue
          }

          if (event.type === 'session.status') {
            const currentSessionId = event.properties.sessionID
            if (currentSessionId !== sessionId) {
              continue
            }

            const status = event.properties.status as { type?: string; message?: string }
            if (status?.type === 'busy') {
              sawRelevantActivity = true
              currentStatus = 'executing'
              currentStep = 'OpenCode 正在执行工具与生成回复'
              writeTaskTimelineEvent(createStatusEvent(timeline, currentStatus, currentStep, new Date().toISOString()))
            } else if (status?.type === 'retry') {
              currentStatus = 'thinking'
              currentStep = status.message ?? 'OpenCode 正在重试'
              writeTaskTimelineEvent(createStatusEvent(timeline, currentStatus, currentStep, new Date().toISOString()))
            }

            continue
          }

          if (event.type === 'message.updated') {
            const info = event.properties.info as { id?: string; sessionID?: string; role?: string }
            if (info.sessionID !== sessionId || info.role !== 'assistant' || !info.id) {
              continue
            }

            if (assistantMessageId && assistantMessageId !== info.id) {
              resetStreamingPartState(writer, textState, activeTextParts, 'text')
              resetStreamingPartState(writer, reasoningState, activeReasoningParts, 'reasoning')
            }
            assistantMessageId = info.id
            sawRelevantActivity = true
            flushBufferedParts(assistantMessageId, 'text')
            flushBufferedParts(assistantMessageId, 'reasoning')
            syncAssistantTimeline(assistantMessageId)
            continue
          }

          if (event.type === 'message.part.delta') {
            const properties = event.properties as {
              sessionID?: string
              messageID?: string
              partID?: string
              field?: string
              delta?: string
            }
            if (properties.sessionID !== sessionId || properties.field !== 'text' || !properties.messageID || !properties.partID || !properties.delta) {
              continue
            }

            const partState = getMessagePartState(textStateByMessageId, properties.messageID)
            const nextText = `${partState.get(properties.partID) ?? ''}${properties.delta}`
            partState.set(properties.partID, nextText)
            if (assistantMessageId && properties.messageID !== assistantMessageId) {
              continue
            }

            sawRelevantActivity = true
            if (writer) {
              emitTextDelta(writer, textState, activeTextParts, properties.partID, nextText, properties.delta, 'text')
            } else {
              textState.set(properties.partID, nextText)
            }
            syncAssistantTimeline(properties.messageID)
            continue
          }

          if (event.type === 'message.part.updated') {
            const part = event.properties.part as {
              id: string
              sessionID?: string
              messageID?: string
              type: string
              text?: string
              tool?: string
              state?: {
                status: 'pending' | 'running' | 'completed' | 'error'
                input?: Record<string, unknown>
                output?: string
                error?: string
                raw?: string
                time?: {
                  start?: number
                  end?: number
                }
              }
            }
            const delta = typeof event.properties.delta === 'string' ? event.properties.delta : undefined

            if (part.sessionID !== sessionId) {
              continue
            }

            if (assistantMessageId && part.messageID !== assistantMessageId) {
              continue
            }

            sawRelevantActivity = true

            if (part.type === 'text' && part.messageID) {
              getMessagePartState(textStateByMessageId, part.messageID).set(part.id, part.text ?? '')
              if (assistantMessageId !== part.messageID) {
                continue
              }

              if (writer) {
                emitTextDelta(writer, textState, activeTextParts, part.id, part.text ?? '', delta, 'text')
              } else {
                textState.set(part.id, part.text ?? '')
              }
              syncAssistantTimeline(part.messageID)
              continue
            }

            if (part.type === 'reasoning' && part.messageID) {
              getMessagePartState(reasoningStateByMessageId, part.messageID).set(part.id, part.text ?? '')
              if (assistantMessageId !== part.messageID) {
                continue
              }

              if (writer) {
                emitTextDelta(writer, reasoningState, activeReasoningParts, part.id, part.text ?? '', delta, 'reasoning')
              }
              splitAssistantSegmentOnNextText.add(part.messageID)
              writeTaskTimelineEvent(createThinkingEvent(timeline, part.id, part.text ?? '', new Date().toISOString(), part.messageID))
              continue
            }

            if (part.type === 'tool' && part.state && part.tool) {
              const toolCall = buildToolCall(
                {
                  id: part.id,
                  tool: part.tool,
                  state: part.state,
                },
                toolCallMap.get(part.id),
              )

              toolCallMap.set(part.id, toolCall)
              const waitingForUserInput = isInteractiveQuestionTool(part.tool) && (part.state.status === 'pending' || part.state.status === 'running')
              if (waitingForUserInput) {
                currentStatus = 'waiting'
                currentStep = '等待用户回答问题'
                writeTaskTimelineEvent(createInteractionEvent(timeline, {
                  id: part.id,
                  type: 'question',
                  status: 'pending',
                  title: '等待用户回答',
                  prompt: typeof part.state.input?.question === 'string'
                    ? part.state.input.question
                    : typeof part.state.input?.prompt === 'string'
                      ? part.state.input.prompt
                      : undefined,
                  provider: 'OpenCode',
                  toolName: part.tool,
                }, new Date().toISOString()))
              } else {
                if (part.state.status === 'pending' || part.state.status === 'running') {
                  currentStatus = 'executing'
                }
                currentStep = `正在执行工具：${part.tool}`
              }

              if (assistantMessageId) {
                splitAssistantSegmentOnNextText.add(assistantMessageId)
              }
              writeTaskTimelineEvent(createToolCallEvent(timeline, toolCall, toolCall.startedAt))
              writeTaskTimelineEvent(createStatusEvent(timeline, currentStatus, currentStep, new Date().toISOString()))
              if (waitingForUserInput) {
                writer?.write({
                  type: 'data-notice',
                  data: {
                    level: 'warning',
                    message: currentStep,
                  },
                  transient: true,
                })
              }
            }

            continue
          }

          if (event.type === 'interaction.pending') {
            const interaction = readPendingInteraction(event.properties, crypto.randomUUID())
            if (!interaction) {
              continue
            }

            currentStatus = 'waiting'
            currentStep = interaction.type === 'question' ? '等待用户回答问题' : `等待确认：${interaction.title}`
            writeTaskTimelineEvent(createInteractionEvent(timeline, interaction, new Date().toISOString()))
            writeTaskTimelineEvent(createStatusEvent(timeline, currentStatus, currentStep, new Date().toISOString()))
            writer?.write({
              type: 'data-notice',
              data: {
                level: 'warning',
                message: currentStep,
              },
              transient: true,
            })
            continue
          }

          if (event.type === 'permission.updated') {
            const permission = event.properties as { sessionID?: string; title?: string }
            if (permission.sessionID !== sessionId) {
              continue
            }

            currentStatus = 'waiting'
            currentStep = permission.title ? `等待权限：${permission.title}` : '等待权限确认'
            if (permission.title && !approvalRequests.includes(permission.title)) {
              approvalRequests.push(permission.title)
            }

            writeTaskTimelineEvent(createStatusEvent(timeline, currentStatus, currentStep, new Date().toISOString()))
            writer?.write({
              type: 'data-notice',
              data: {
                level: 'warning',
                message: currentStep,
              },
              transient: true,
            })
            continue
          }

          if (event.type === 'session.error') {
            const properties = event.properties as { sessionID?: string; error?: unknown }
            if (properties.sessionID !== sessionId) {
              continue
            }

            throw new Error(getErrorText(properties.error))
          }

          if (event.type === 'session.idle') {
            const properties = event.properties as { sessionID?: string }
            if (properties.sessionID !== sessionId || !sawRelevantActivity) {
              continue
            }

            break
          }
        }

        abortController.abort()
        await promptPromise
        if (promptError) {
          throw promptError
        }
      } finally {
        abortController.abort()
        signal?.removeEventListener('abort', handleAbort)
      }
    })

    if (writer) {
      finishActiveParts(writer, activeTextParts, 'text')
      finishActiveParts(writer, activeReasoningParts, 'reasoning')
    }

    const streamedOutput = extractStreamingText(textState, message)
    let finalOutput = streamedOutput

    if (!finalOutput) {
      const messages = await client.session.messages({
        path: { id: sessionId },
        query: { directory: cwd, limit: 20 },
      })

      const latestAssistant = [...(messages.data ?? [])]
        .reverse()
        .find((item) => item.info.role === 'assistant')

      finalOutput = latestAssistant
        ? extractAssistantText(latestAssistant.parts as Array<{ type: string; text?: string }>, message)
        : ''
    }

    let filesChanged: string[] | undefined
    let commitShas: string[] | undefined
    let remoteBranchName: string | undefined
    let delivery: AgentMessageResult['delivery']
    let gitMessage = ''

    if (hasWorkspaceRuntime(task)) {
      const workspace = task.workspaceId ? getWorkspace(task.workspaceId) : null
      const autoCommitEnabled = resolveWorkspaceAutoCommitEnabled({
        workingDirectoryMode: task.workingDirectoryMode,
        autoCommitEnabled: project.versionControl === 'none' ? false : workspace?.autoCommitEnabled,
      })

      if (autoCommitEnabled) {
        const identity = gitIdentity
        const gitOutcome = await finalizeTaskWorktreeGit({
          project,
          task,
          worktreePath: cwd,
          identity,
          commitMessage: finalOutput || 'OpenCode 已处理完成，但没有返回文本输出。',
        })
        filesChanged = gitOutcome.changedFiles
        commitShas = gitOutcome.commitShas
        remoteBranchName = gitOutcome.remoteBranchName
        gitMessage = gitOutcome.pushMessage
      } else if (project.versionControl === 'none') {
        filesChanged = []
        gitMessage = '当前项目未启用 Git，改动已保留在项目目录。'
      } else {
        const status = await simpleGit(cwd).status()
        filesChanged = Array.from(new Set(status.files.map((file) => file.path))).sort()
        gitMessage = filesChanged.length > 0 ? '当前工作区已关闭自动提交 / 推送，改动保留在本地目录。' : ''
      }

      if (sessionCarrier?.returnMode) {
        delivery = attachTaskResultDelivery({
          taskId: task.id,
          status: 'completed',
          returnMode: sessionCarrier.returnMode,
          summary: finalOutput || 'OpenCode 已处理完成，但没有返回文本输出。',
          output: finalOutput || 'OpenCode 已处理完成，但没有返回文本输出。',
          filesChanged: filesChanged ?? [],
          remoteBranchName,
          commitShas,
          startedAt: sessionCarrier.createdAt,
          completedAt: new Date().toISOString(),
          durationSec: Math.max(0, Math.round((Date.now() - new Date(sessionCarrier.createdAt).getTime()) / 1000)),
          executorNodeId: task.executorNodeId ?? sessionCarrier.executorNodeId ?? '',
          agentSessionId: sessionId,
          opencodeSessionId: sessionId,
        }, {
          repoUrl: project.gitUrl,
          baseBranch: task.baseBranch || sessionCarrier.baseBranch || project.defaultBranch || 'main',
          taskTitle: task.title,
          taskDescription: task.description,
        }).delivery
      }
    }

    currentStatus = 'complete'
    currentStep = '任务详情对话已完成'
    writeTaskTimelineEvent(createStatusEvent(timeline, currentStatus, currentStep, new Date().toISOString()))

    finalOutput = [finalOutput || 'OpenCode 已处理完成，但没有返回文本输出。', gitMessage].filter(Boolean).join('\n\n')
    const fallbackMessageId = assistantMessageId || (sessionId ? `${sessionId}:assistant` : crypto.randomUUID())
    const latestFullText = assistantLastFullTextByMessageId.get(fallbackMessageId) ?? ''
    if (!latestFullText) {
      writeTaskTimelineEvent(
        createAssistantMessageEvent(timeline, fallbackMessageId, finalOutput, new Date().toISOString()),
      )
    } else if (finalOutput.startsWith(latestFullText) && finalOutput.length > latestFullText.length) {
      const nextSegmentIndex = (assistantSegmentIndexByMessageId.get(fallbackMessageId) ?? 0) + 1
      writeTaskTimelineEvent(
        createAssistantMessageEvent(
          timeline,
          fallbackMessageId,
          finalOutput.slice(latestFullText.length),
          new Date().toISOString(),
          `${fallbackMessageId}:segment:${nextSegmentIndex}`,
        ),
      )
    }

    if (delivery) {
      delivery = attachTaskResultDelivery({
        taskId: task.id,
        status: 'completed',
        returnMode: delivery.mode,
        summary: finalOutput,
        output: finalOutput,
        filesChanged: filesChanged ?? [],
        remoteBranchName,
        commitShas,
        startedAt: sessionCarrier?.createdAt ?? new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationSec: sessionCarrier?.createdAt ? Math.max(0, Math.round((Date.now() - new Date(sessionCarrier.createdAt).getTime()) / 1000)) : 0,
        executorNodeId: hasWorkspaceRuntime(task) ? task.executorNodeId ?? sessionCarrier?.executorNodeId ?? '' : sessionCarrier?.executorNodeId ?? '',
        agentSessionId: sessionId,
        opencodeSessionId: sessionId,
      }, {
        repoUrl: project.gitUrl,
        baseBranch: task.baseBranch || sessionCarrier?.baseBranch || project.defaultBranch || 'main',
        taskTitle: task.title,
        taskDescription: task.description,
      }).delivery
    }
    return {
      ok: true,
      output: finalOutput,
      turnId: timeline.turnId,
      agentSessionId: sessionId,
      opencodeSessionId: sessionId,
      taskRunId: sessionCarrier?.id,
      toolCalls: [...toolCallMap.values()],
      approvalRequests,
      agentRunningStatus: currentStatus,
      currentStep,
      conversationTimeline: timeline.values(),
      filesChanged,
      commitShas,
      remoteBranchName,
      delivery,
    }
  } catch (error) {
    logOpenCodeDebug('task-chat:error', {
      taskId: task.id,
      projectId: project.id,
      cwd,
      sessionId,
      error: getErrorText(error),
    })
    if (isAbortError(error)) {
      if (writer) {
        finishActiveParts(writer, activeTextParts, 'text')
        finishActiveParts(writer, activeReasoningParts, 'reasoning')
      }

      const idleOutput = extractStreamingText(textState) || '已停止当前回复'
      return {
        ok: true,
        output: idleOutput,
        turnId: timeline.turnId,
        agentSessionId: sessionId,
        opencodeSessionId: sessionId,
        taskRunId: sessionCarrier?.id,
        toolCalls: [...toolCallMap.values()],
        approvalRequests,
        agentRunningStatus: 'idle',
        currentStep: '已停止当前回复',
        conversationTimeline: timeline.values(),
      }
    }

    if (writer) {
      finishActiveParts(writer, activeTextParts, 'text')
      finishActiveParts(writer, activeReasoningParts, 'reasoning')
    }

    currentStatus = 'error'
    currentStep = '任务详情对话失败'
    writeTaskTimelineEvent(createStatusEvent(timeline, currentStatus, currentStep, new Date().toISOString()))

    const errorOutput = getErrorText(error)
    writeTaskTimelineEvent(createErrorEvent(timeline, errorOutput, new Date().toISOString()))
    return {
      ok: false,
      output: errorOutput,
      turnId: timeline.turnId,
      agentSessionId: sessionId,
      opencodeSessionId: sessionId,
      taskRunId: sessionCarrier?.id,
      toolCalls: [...toolCallMap.values()],
      approvalRequests,
      agentRunningStatus: currentStatus,
      currentStep,
      conversationTimeline: timeline.values(),
    }
  }

  const noResultOutput = 'OpenCode 会话未返回结果'
  return {
    ok: false,
    output: noResultOutput,
    turnId: timeline.turnId,
    agentSessionId: sessionId,
    opencodeSessionId: sessionId,
    taskRunId: sessionCarrier?.id,
    toolCalls: [...toolCallMap.values()],
    approvalRequests,
    agentRunningStatus: 'error',
    currentStep: '任务详情对话失败',
    conversationTimeline: [...timeline.values(), createErrorEvent(timeline, noResultOutput, new Date().toISOString())],
  }
}

const buildLegacyStreamTaskResult = async (
  task: Task,
  project: Project,
  config: AgentConfig,
  message: string,
  writer: TaskChatStreamWriter,
  gitIdentity?: TaskRuntimeGitIdentity,
  turnId?: string,
): Promise<{ task: Task; result: AgentMessageResult }> => {
  const result = await sendTaskMessageToAgent(task, project, config, message, undefined, gitIdentity, turnId)
  writeFinalTextResult(writer, result)

  return {
    task: applyAgentMessageResultToTask(task, result),
    result,
  }
}

export const streamTaskMessageToUi = async (
  task: Task,
  project: Project,
  config: AgentConfig,
  message: string,
  writer: TaskChatStreamWriter,
  signal?: AbortSignal,
  gitIdentity?: TaskRuntimeGitIdentity,
  turnId?: string,
): Promise<{ task: Task; result: AgentMessageResult }> => {
  const result = await runOpenCodeTaskMessage(task, project, config, message, writer, signal, gitIdentity, turnId)
  return {
    task: applyAgentMessageResultToTask(task, result),
    result,
  }
}
