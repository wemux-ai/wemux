// [INPUT]: Workspace chat turns, scoped project/session state, runtime settings, and worker executor services.
// [OUTPUT]: Prepared workspace execution, streamed agent responses, persisted runtime/session state, Git outcomes,
//   and agent model lists (catalog/hosted first, worker runtime models merged in the background via grace export).
// [POS]: Worker-first workspace chat orchestration, including directory preparation and missing-CWD recovery.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { mergeAgentRuntimeSettings } from '@shared/agent-config'
import {
  buildAgentExecutionModelId,
  findMatchingAgentExecutionModelOption,
  normalizeModelProviderBaseUrl,
  parseClaudeCodeConfigModel,
  parseCodexConfigModel,
  resolveMatchingAgentExecutionModelOptionId,
} from '@shared/model-profile'
import { isOpenCodeMissingTextOutput } from '@shared/opencode-message-output'
import { parseOpencodeConfigContent } from '@shared/opencode-config'
import { mergeOpenCodeExecutionConfig } from '@shared/opencode-execution-config'
import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { TaskChatContextRef } from '@shared/task-chat-context'
import { buildTaskGitChangeSummary, type ExecutorGitCommitResult, type ExecutorGitWorkingTreeDiffResult, type TaskGitChangeSummary } from '@shared/task-git-ops'
import {
  buildWorkspaceTaskExecutionView,
  applyWorkspaceCodeStateToSession,
  clearWorkspaceRuntimeSessionId,
  getWorkspaceRuntimeSessionId,
  mergeWorkspaceSession,
  resolveWorkspaceCodeBaseBranch,
  resolveWorkspaceCodeBranchName,
  resolveWorkspaceSessionExecutorId,
  resolveWorkspaceAutoCommitEnabled,
  setWorkspaceRuntimeSessionId,
} from '@shared/task-workspace'
import type { AppState, ExecutionModelOption, ExecutorAgentPromptAbortReason, ExecutorAgentPromptEvent, ExecutorAgentPromptResult, ExecutorWorkspaceOperationEvent, OpenCodeExecutionConfig, Project, ResolvedModelImportBinding, Task, Workspace, WorkspaceSession } from '@shared/types'
import { getTaskConversationWithMessages } from '../../control-plane/conversation-service'
import { listAvailableModels as listAgentModels } from '../../integrations/coding-agent/registry'
import { normalizeModelResponse } from '../../integrations/opencode/core'
import {
  createAssistantMessageEvent,
  createErrorEvent,
  createInteractionEvent,
  createStatusEvent,
  createSystemMessageEvent,
  createThinkingEvent,
  createTimelineCollector,
  createToolCallEvent,
  emitTextDelta,
  extractStreamingText,
  finishActiveParts,
  resetStreamingPartState,
  type TaskChatStreamWriter,
  writeFinalTextResult,
  writeTimelineEvent,
} from '../../integrations/opencode/task-chat-stream'
import { listVisibleExecutorsForUser } from '../../control-plane/collaboration'
import { executorRegistry } from '../../control-plane/executor-registry'
import { resolveUserProjectGitIdentity } from '../../control-plane/task-git-identity'
import { executorWsService } from '../../control-plane/executor-ws-service'
import { refreshProjectVersionControlFromExecutor } from '../../control-plane/executor-repo-service'
import {
  ensureTaskWorkspaceBindingState,
  ensureWorkspaceSessionRecord,
  getScopedWorkspaceForProject,
  getWorkspaceSessionRecordForTaskContext,
  hydrateWorkspaceSessionWithLocalWorktree,
  resolveEffectiveWorkspaceWorktreeSession,
  resolveWorkspaceDirectoryCwd,
  resolveWorkspaceSessionDirectoryView,
  resolveWorkspaceWorkingDirectoryMode,
  saveWorkspaceDirectorySessions,
} from '../../routes/task-route-support'
import { resolveWorkspaceRepoPath } from '../workspace-repo-path'
import { loadState, saveWorkspaceSession } from '../../storage/app-state-store'
import { saveWorkspace } from '../../storage/distributed-task-store'
import { buildToolCall } from '../agent-tool-call'
import { checkTeamModelAllowed } from '../team-model-policy-service'
import {
  buildConversationHandoffPromptSection,
  buildUserMessagePromptWithHandoff,
  buildTaskConversationHandoffSnapshot,
} from '../conversation-handoff'
import {
  resolveBoundCustomAgent,
  resolveExecutionMcpServersForSession,
  resolveExecutionMcpServerNamesForSession,
  resolveExecutionSkillsForSession,
  resolveTaskRuntimeCapabilitySnapshot,
} from '../custom-agent-runtime'
import { getPrimaryAgentMcpServers } from '../primary-agent-mcp'
import { resolveWorkspaceRuntimeEnvironment } from '../runtime-environment-service'
import { listAgentModelProfileOptions, resolveModelProfileRuntime } from '../model-profile-service'
import { buildFailedWorkspaceMessageResult } from './result-utils'
import { createWorkspaceOperationTimelineWriter, recordWorkspaceSessionSystemMessage } from '../workspace-session-operation-timeline'
import {
  buildExecutionDescriptionWithSkills,
  buildMessageWithRuntimeSkillMentions,
  buildRuntimeSkillPackagesFromSkills,
  dedupeRuntimeSkills,
  resolveRuntimeSkills,
} from '../skill-service'
import {
  getServerAgentDefaultModel,
  getServerAgentLabel,
  getServerAgentSettings,
  type ServerAgentType,
} from '../server-agent'
import { publishTaskChatTimelineEvent } from './runtime-state'
import type { TaskMessageResult } from './types'
import {
  buildWorkspacePreparationRetryStep,
  buildWorkspacePreparationStartStep,
  buildWorkspacePreparationSuccessStep,
} from './workspace-preparation-status'
import { shouldEnsureWorkspaceDirectoryOnExecutor, verifyWorkspaceDirectoryReady } from './workspace-directory-ready'
import { validateProjectExecutorPathAccess } from '../project-executor-ownership'
import type { ChatTimelineWorkspaceExecutor } from '@shared/timeline'
import { buildTaskChatContextPromptPrefix } from './context-ref-prompt'
import { getManagedCloudGate } from '../gate/managed-cloud-gate'

const isInteractiveQuestionTool = (toolName: string) => toolName === 'question' || toolName === 'AskUserQuestion'

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

const toAgentExecutionModelOptions = (
  agentType: ServerAgentType,
  bindings: ResolvedModelImportBinding[],
  defaultModel?: string,
) => {
  return bindings.map<ExecutionModelOption>((binding) => {
    const executionModel = buildAgentExecutionModelId(agentType as Task['agentType'], binding)
    return {
      id: executionModel,
      label: binding.label,
      providerId: binding.providerId,
      modelId: binding.modelId,
      baseUrl: normalizeModelProviderBaseUrl(binding.baseUrl) || undefined,
      isDefault: executionModel === defaultModel,
      source: 'runtime',
    }
  })
}

type ModelOptionSource = NonNullable<ExecutionModelOption['source']>
type RuntimeConfigExport = Awaited<ReturnType<typeof executorWsService.requestConfigExport>>

const MODEL_EXPORT_CACHE_TTL_MS = 30_000
const RUNTIME_MODEL_EXPORT_GRACE_MS = 1_000
const runtimeModelExportCache = new Map<string, { exported: RuntimeConfigExport; expiresAt: number }>()
const inflightRuntimeModelExports = new Map<string, Promise<RuntimeConfigExport>>()

const shouldRetryWorkspaceResume = (message: string) => {
  const normalizedMessage = message.trim().toLowerCase()
  if (!normalizedMessage) {
    return false
  }

  return normalizedMessage.includes('no rollout found for thread id')
    || normalizedMessage.includes('no thread found for id')
    || (normalizedMessage.includes('thread/resume') && normalizedMessage.includes('not found'))
    || normalizedMessage.includes('session not found')
    || normalizedMessage.includes('resume') && normalizedMessage.includes('not found')
}

const isMissingWorkspaceCwdError = (message: string) => {
  const normalizedMessage = message.trim()
  if (!normalizedMessage) {
    return false
  }

  return normalizedMessage.includes('工作目录不存在:')
    || normalizedMessage.includes('当前工作目录不存在：')
    || normalizedMessage.includes('当前工作目录不存在:')
}

const buildRuntimeModelExportCacheKey = (userId: string, executorId: string, agentType: ServerAgentType) => {
  return `${userId}:${executorId}:${agentType}`
}

const readCachedRuntimeModelExport = (key: string): RuntimeConfigExport | null => {
  const cached = runtimeModelExportCache.get(key)
  return cached && cached.expiresAt > Date.now() ? cached.exported : null
}

/**
 * 同一个 userId/executorId/agentType 的运行时模型导出只允许一个在途请求，
 * 完成后写入 30s 缓存；UI 快速路径与派发阻塞路径共享，避免重复打 worker。
 */
const performRuntimeModelExport = (params: {
  userId: string
  executorId: string
  agentType: ServerAgentType
}) => {
  const key = buildRuntimeModelExportCacheKey(params.userId, params.executorId, params.agentType)
  const existing = inflightRuntimeModelExports.get(key)
  if (existing) {
    return existing
  }

  const promise = executorWsService.requestConfigExport(params.executorId, {
    agentType: params.agentType as Task['agentType'],
    includeResolvedModelBindings: true,
  }).then((exported) => {
    runtimeModelExportCache.set(key, {
      exported,
      expiresAt: Date.now() + MODEL_EXPORT_CACHE_TTL_MS,
    })
    return exported
  }).finally(() => {
    inflightRuntimeModelExports.delete(key)
  })
  inflightRuntimeModelExports.set(key, promise)
  return promise
}

/**
 * 读取执行节点运行时模型导出。
 * - graceMs 为 0：阻塞等待导出完成（派发/校验路径，保留旧语义）。
 * - graceMs > 0：只等最多 graceMs，超时返回 { exported: null, pending: true }，
 *   导出仍在后台继续并写入缓存，调用方可先返回模型库内容再补拉。
 */
export const requestRuntimeModelExport = async (
  params: {
    userId: string
    executorId: string
    agentType: ServerAgentType
  },
  options: { graceMs?: number } = {},
): Promise<{ exported: RuntimeConfigExport | null; pending: boolean }> => {
  const cached = readCachedRuntimeModelExport(buildRuntimeModelExportCacheKey(params.userId, params.executorId, params.agentType))
  if (cached) {
    return { exported: cached, pending: false }
  }

  const exportPromise = performRuntimeModelExport(params)
  if (!options.graceMs) {
    return { exported: await exportPromise, pending: false }
  }

  let graceTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const raced = await Promise.race([
      exportPromise.then((exported) => ({ exported, timedOut: false as const })),
      new Promise<{ exported: null; timedOut: true }>((resolve) => {
        graceTimer = setTimeout(() => resolve({ exported: null, timedOut: true }), options.graceMs)
      }),
    ])
    return raced.timedOut ? { exported: null, pending: true } : { exported: raced.exported, pending: false }
  } finally {
    if (graceTimer) {
      clearTimeout(graceTimer)
    }
  }
}

const MODEL_SOURCE_LABELS: Record<ModelOptionSource, string> = {
  catalog: '系统模型库',
  hosted: '官方模型目录',
  runtime: '执行节点运行时配置',
  bundled: '内置模型目录',
}

const logWorkspacePreparation = (phase: string, payload: Record<string, unknown>) => {
  console.log('[workspace-chat][prepare]', JSON.stringify({
    phase,
    ...payload,
  }))
}

const warnWorkspacePreparation = (phase: string, payload: Record<string, unknown>) => {
  console.warn('[workspace-chat][prepare]', JSON.stringify({
    phase,
    ...payload,
  }))
}

const resolveWorkspaceSessionExecutor = (params: {
  task: Task
  workspaceExecutorId?: string
  workspaceId: string
  workspaceSessionId?: string
}) => {
  const workspaceSession = getWorkspaceSessionRecordForTaskContext(
    params.task.id,
    params.workspaceId,
    params.workspaceSessionId,
  )

  return {
    workspaceSession,
    executorId: resolveWorkspaceSessionExecutorId(workspaceSession, params.workspaceExecutorId),
  }
}

const buildOpenCodeProviderOverlay = (binding?: {
  providerId: string
  modelId: string
  baseUrl?: string
  apiToken?: string
}): OpenCodeExecutionConfig | undefined => {
  if (!binding?.providerId.trim() || !binding.modelId.trim()) {
    return undefined
  }

  const baseURL = normalizeModelProviderBaseUrl(binding.baseUrl) || undefined
  const apiKey = binding.apiToken?.trim() || undefined
  return {
    model: `${binding.providerId.trim()}/${binding.modelId.trim()}`,
    provider: {
      [binding.providerId.trim()]: {
        npm: '@ai-sdk/openai-compatible',
        models: {
          [binding.modelId.trim()]: {
            name: binding.modelId.trim(),
          },
        },
        ...(baseURL || apiKey
          ? {
              options: {
                ...(baseURL ? { baseURL } : {}),
                ...(apiKey ? { apiKey } : {}),
              },
            }
          : {}),
      },
    },
  }
}

const applyModelSource = (
  models: ExecutionModelOption[],
  source: ModelOptionSource,
) => {
  return models
    .map<ExecutionModelOption | null>((model) => {
      const id = model.id.trim()
      const providerId = model.providerId.trim()
      const modelId = model.modelId.trim()
      if (!id || !providerId || !modelId) {
        return null
      }

      return {
        ...model,
        id,
        label: model.label.trim() || id,
        providerId,
        modelId,
        baseUrl: normalizeModelProviderBaseUrl(model.baseUrl) || undefined,
        source: model.source ?? source,
      }
    })
    .filter((model): model is ExecutionModelOption => Boolean(model))
}

export const isNonCodingPreviewModel = (model: ExecutionModelOption) => {
  const identifier = `${model.id} ${model.modelId} ${model.label}`.toLowerCase()
  return /image[-_ ]?(preview|generation|gen)|imagen[-_ ]|dall[·-]?e/.test(identifier)
}

const mergeExecutionModelOptions = (lists: ExecutionModelOption[][]) => {
  const merged = new Map<string, ExecutionModelOption>()

  for (const list of lists) {
    for (const model of list) {
      if (merged.has(model.id)) {
        continue
      }

      merged.set(model.id, model)
    }
  }

  return Array.from(merged.values())
}

const pickDefaultExecutionModel = (
  agentType: ServerAgentType,
  models: ExecutionModelOption[],
  candidates: Array<string | undefined>,
) => {
  for (const candidate of candidates) {
    const matchedId = resolveMatchingAgentExecutionModelOptionId(agentType, models, candidate)
    if (matchedId) {
      return matchedId
    }
  }

  return models.find((model) => model.isDefault)?.id ?? ''
}

const markDefaultExecutionModel = (
  models: ExecutionModelOption[],
  defaultModel: string,
) => {
  const normalizedDefaultModel = defaultModel.trim()
  return models.map((model) => ({
    ...model,
    isDefault: Boolean(normalizedDefaultModel) && model.id === normalizedDefaultModel,
  }))
}

const buildModelListMessage = (params: {
  catalogModels: ExecutionModelOption[]
  hostedModels: ExecutionModelOption[]
  runtimeModels: ExecutionModelOption[]
  fallbackModels: ExecutionModelOption[]
  fallbackSource?: ModelOptionSource
  runtimeMessage?: string
  fallbackMessage?: string
  runtimeErrorMessage?: string
}) => {
  const hasRuntimeFallback = params.fallbackSource === 'runtime' && params.fallbackModels.length > 0
  const hasBundledFallback = params.fallbackSource === 'bundled' && params.fallbackModels.length > 0
  const activeSources = (['catalog', 'hosted', 'runtime', 'bundled'] as const).filter((source) => {
    if (source === 'catalog') {
      return params.catalogModels.length > 0
    }

    if (source === 'hosted') {
      return params.hostedModels.length > 0
    }

    if (source === 'runtime') {
      return params.runtimeModels.length > 0 || hasRuntimeFallback
    }

    return hasBundledFallback
  })

  if (activeSources.length === 0) {
    return params.runtimeErrorMessage
      || params.fallbackMessage
      || params.runtimeMessage
      || '未读取到可用模型。'
  }

  if (activeSources.length === 1) {
    const [source] = activeSources
    if (source === 'catalog') {
      return '已从系统模型库加载模型列表。'
    }

    if (source === 'hosted') {
      return '已从官方模型目录加载模型列表。'
    }

    if (source === 'runtime') {
      return params.runtimeMessage || params.fallbackMessage || '已从执行节点读取运行时模型配置。'
    }

    return params.fallbackMessage || '已从内置模型目录加载模型列表。'
  }

  const mergedMessage = `已合并${activeSources.map((source) => MODEL_SOURCE_LABELS[source]).join('、')}的模型列表。`
  if (params.runtimeErrorMessage) {
    return `${mergedMessage} 执行节点读取失败：${params.runtimeErrorMessage}`
  }

  return mergedMessage
}

export type LoadAgentModelOptionsOptions = {
  /** 允许在 worker 运行时模型导出未完成时先返回模型库内容（UI 快速路径）。 */
  allowRuntimePending?: boolean
}

export const loadAgentModelOptionsFromExecutor = async (
  userId: string,
  agentType: ServerAgentType,
  preferredExecutorId?: string,
  workspaceId?: string,
  options: LoadAgentModelOptionsOptions = {},
) => {
  const state = loadState()
  const configuredDefaultModel = getServerAgentDefaultModel(state.config, agentType)
  const catalogModels = applyModelSource(
    await listAgentModelProfileOptions(userId, agentType, workspaceId),
    'catalog',
  )
  const hostedModels = await getManagedCloudGate().listExecutionModelOptions()

  const executorId = preferredExecutorId?.trim()
  if (agentType === 'OpenCode' && !executorId) {
    if (catalogModels.length === 0) {
      return {
        ok: false as const,
        status: 400 as const,
        message: '请先为任务选择执行节点。',
      }
    }
  }

  if (executorId) {
    const visibleExecutorIds = new Set(listVisibleExecutorsForUser(userId, workspaceId).map((executor) => executor.executorId))
    if (!visibleExecutorIds.has(executorId)) {
      return {
        ok: false as const,
        status: 403 as const,
        message: '当前工作区会话的执行节点不可见或无权限访问。',
      }
    }
  }

  let runtimeModels: ExecutionModelOption[] = []
  let runtimeDefaultModel = ''
  let runtimeMessage = ''
  let runtimeErrorMessage = ''
  let runtimePending = false

  if (executorId) {
    try {
      const runtimeExport = await requestRuntimeModelExport(
        {
          userId,
          executorId,
          agentType,
        },
        options.allowRuntimePending ? { graceMs: RUNTIME_MODEL_EXPORT_GRACE_MS } : undefined,
      )
      runtimePending = runtimeExport.pending

      const exported = runtimeExport.exported
      if (exported) {
        if (agentType === 'OpenCode') {
          runtimeDefaultModel = exported.defaultModel?.trim() || ''
          runtimeModels = applyModelSource(
            exported.availableModels ?? normalizeModelResponse(parseOpencodeConfigContent(exported.opencodeConfigContent), exported.defaultModel),
            'runtime',
          )
          runtimeMessage = exported.modelsMessage || '已从执行节点读取运行时模型配置。'
        } else {
          runtimeDefaultModel = agentType === 'Codex'
            ? parseCodexConfigModel(exported.codexConfigContent)
            : agentType === 'ClaudeCode'
              ? parseClaudeCodeConfigModel(exported.claudeCodeConfigContent)
              : (exported.defaultModel?.trim() || '')
          runtimeModels = applyModelSource(
            toAgentExecutionModelOptions(agentType, exported.resolvedModelBindings ?? [], runtimeDefaultModel),
            'runtime',
          )
          runtimeMessage = '已从执行节点读取运行时模型配置。'
        }
      }
    } catch (error) {
      runtimeErrorMessage = error instanceof Error ? error.message : '从执行节点读取模型列表失败。'
      if (agentType === 'OpenCode' && catalogModels.length === 0) {
        return {
          ok: false as const,
          status: 503 as const,
          message: runtimeErrorMessage,
        }
      }
    }
  }

  const result = await listAgentModels(state.config, agentType)
  const fallbackSource: ModelOptionSource = agentType === 'OpenCode' ? 'runtime' : 'bundled'
  const fallbackModels = agentType !== 'OpenCode' || runtimeModels.length === 0
    ? applyModelSource(result.models, fallbackSource)
    : []
  const mergedModels = mergeExecutionModelOptions([
    catalogModels,
    hostedModels,
    runtimeModels,
    fallbackModels,
  ]).filter((model) => !isNonCodingPreviewModel(model))
  const defaultModel = pickDefaultExecutionModel(agentType, mergedModels, [
    runtimeDefaultModel,
    catalogModels.find((model) => model.isDefault)?.id,
    result.defaultModel,
    configuredDefaultModel,
  ])

  const builtMessage = buildModelListMessage({
    catalogModels,
    hostedModels,
    runtimeModels,
    fallbackModels,
    fallbackSource,
    runtimeMessage,
    fallbackMessage: result.message,
    runtimeErrorMessage,
  })

  return {
    ok: true as const,
    models: markDefaultExecutionModel(mergedModels, defaultModel),
    defaultModel,
    message: runtimePending ? `${builtMessage} 执行节点模型配置加载中，稍后自动补全。` : builtMessage,
    ...(runtimePending ? { runtimePending: true as const } : {}),
  }
}

export const loadTaskModelOptionsFromExecutor = async (
  userId: string,
  task: Task,
  preferredExecutorId?: string,
  agentTypeOverride?: ServerAgentType,
  workspaceId?: string,
) => {
  const effectiveAgentType = agentTypeOverride ?? task.agentType
  return loadAgentModelOptionsFromExecutor(userId, effectiveAgentType, preferredExecutorId, workspaceId)
}

const resolveWorkspaceExecutionModel = async (params: {
  userId: string
  task: Task
  executorId: string
  agentType: ServerAgentType
  workspaceId?: string
  executionModel?: string
  fallbackExecutionModel?: string
}) => {
  const result = await resolveWorkspaceExecutionModelInner(params)
  // 协作区模型白名单硬约束：workspace 归属执行最终生效模型必须在白名单内。
  const finalModel = result.executionModel ?? result.actualExecutionModel
  if (finalModel) {
    const blockedReason = checkTeamModelAllowed(params.workspaceId, finalModel)
    if (blockedReason) {
      throw new Error(blockedReason)
    }
  }
  return result
}

const resolveWorkspaceExecutionModelInner = async (params: {
  userId: string
  task: Task
  executorId: string
  agentType: ServerAgentType
  workspaceId?: string
  executionModel?: string
  fallbackExecutionModel?: string
}) => {
  const requestedExecutionModel = params.executionModel?.trim() || params.task.executionModel?.trim() || undefined
  const resolvedProfileRuntime = await resolveModelProfileRuntime({
    userId: params.userId,
    agentType: params.agentType,
    executionModel: requestedExecutionModel,
    fallbackExecutionModel: params.fallbackExecutionModel,
    workspaceId: params.workspaceId,
  })
  if (!requestedExecutionModel) {
    return {
      executionModel: undefined,
      actualExecutionModel: params.fallbackExecutionModel?.trim() || undefined,
      requestedExecutionModel: undefined,
      fallbackReason: undefined,
      runtimeSettings: resolvedProfileRuntime.runtimeSettings,
      runtimeEnv: resolvedProfileRuntime.runtimeEnv,
      binding: resolvedProfileRuntime.binding,
    }
  }

  const modelsResult = await loadTaskModelOptionsFromExecutor(
    params.userId,
    params.task,
    params.executorId,
    params.agentType,
    params.workspaceId?.trim() || undefined,
  )
  if (!modelsResult.ok) {
    return {
      executionModel: resolvedProfileRuntime.executionModel ?? requestedExecutionModel,
      actualExecutionModel: resolvedProfileRuntime.executionModel ?? requestedExecutionModel,
      requestedExecutionModel,
      fallbackReason: undefined,
      runtimeSettings: resolvedProfileRuntime.runtimeSettings,
      runtimeEnv: resolvedProfileRuntime.runtimeEnv,
      binding: resolvedProfileRuntime.binding,
    }
  }

  const effectiveRequestedModel = resolvedProfileRuntime.executionModel ?? requestedExecutionModel
  const matchedModel = findMatchingAgentExecutionModelOption(
    params.agentType,
    modelsResult.models,
    effectiveRequestedModel,
  )
  if (matchedModel) {
    return {
      executionModel: matchedModel.id,
      actualExecutionModel: matchedModel.id,
      requestedExecutionModel,
      fallbackReason: undefined,
      runtimeSettings: resolvedProfileRuntime.runtimeSettings,
      runtimeEnv: resolvedProfileRuntime.runtimeEnv,
      binding: resolvedProfileRuntime.binding,
    }
  }

  if (modelsResult.models.length === 0 && !modelsResult.defaultModel?.trim()) {
    return {
      executionModel: effectiveRequestedModel,
      actualExecutionModel: effectiveRequestedModel,
      requestedExecutionModel,
      fallbackReason: undefined,
      runtimeSettings: resolvedProfileRuntime.runtimeSettings,
      runtimeEnv: resolvedProfileRuntime.runtimeEnv,
    }
  }

  return {
    executionModel: undefined,
    actualExecutionModel: modelsResult.defaultModel?.trim() || undefined,
    requestedExecutionModel,
    fallbackReason: `模型 ${requestedExecutionModel} 在当前执行节点不可用，已回退到默认模型。`,
    runtimeSettings: resolvedProfileRuntime.runtimeSettings,
    runtimeEnv: resolvedProfileRuntime.runtimeEnv,
    binding: resolvedProfileRuntime.binding,
  }
}

const resolveWorkspaceChatWorkingDirectory = (params: {
  state: AppState
  taskId: string
  project: Project
  session: WorkspaceSession
  executorId: string
  workspace?: { id: string; ownerUserId?: string; repoPath?: string; executorNodeId?: string | null; workingDirectoryMode?: WorkspaceSession['workingDirectoryMode'] } | null
}) => {
  const executorWorkspaceRoot = executorRegistry.getExecutor(params.executorId)?.workspaceRoot?.trim()
  const workspaceRoot = executorWorkspaceRoot || params.state.config.workspaceRoot
  const effectiveWorktreeSession = resolveEffectiveWorkspaceWorktreeSession(params.taskId, params.session, params.workspace?.executorNodeId)
  const { directory } = resolveWorkspaceSessionDirectoryView(
    params.session,
    params.workspace,
    params.workspace?.executorNodeId,
    effectiveWorktreeSession,
    params.project.id,
  )

  return resolveWorkspaceDirectoryCwd(workspaceRoot, params.project, directory, params.workspace)
}

const resolveTaskGitIdentitySafely = async (userId: string, project: Project) => {
  try {
    return await resolveUserProjectGitIdentity({
      userId,
      projectId: project.id,
      mode: 'personal',
      repoUrl: project.gitUrl,
    })
  } catch {
    return undefined
  }
}

type WorkspaceExecutorPromptResult = ExecutorAgentPromptResult & {
  filesChanged?: string[]
  changeSummary?: TaskGitChangeSummary
  commitShas?: string[]
  remoteBranchName?: string
  currentStep?: string
}

export type WorkspaceExecutorGitOutcome = ExecutorGitCommitResult | {
  ok: false
  message: string
  branchName: string
  changedFiles: string[]
  commitSha?: undefined
  remoteBranchName?: undefined
}

const getRenderableWorkspaceAssistantOutput = (output?: string) => {
  const normalized = output?.trim() ?? ''
  if (!normalized) {
    return ''
  }

  return isOpenCodeMissingTextOutput(normalized) ? '' : normalized
}

const getWorkspacePromptInterruptionMessage = (
  result: Pick<ExecutorAgentPromptResult, 'aborted' | 'abortReason' | 'output'>,
) => {
  if (!result.aborted && !result.abortReason) {
    return ''
  }

  return result.output.trim() || (result.abortReason === 'user_stop' ? '已停止' : '本次回复已中止')
}

const getAbortErrorReason = (error: unknown): ExecutorAgentPromptAbortReason | undefined => {
  return error instanceof Error
    ? (error as Error & { abortReason?: ExecutorAgentPromptAbortReason }).abortReason
    : undefined
}

export const shouldEmitWorkspaceAutoCommitStartMessage = (
  gitWorkingTreeDiff?: Pick<ExecutorGitWorkingTreeDiffResult, 'ok' | 'files'> | null,
) => gitWorkingTreeDiff?.ok === true && gitWorkingTreeDiff.files.length > 0

export const readWorkspaceExecutorGitWorkingTreeDiff = async (params: {
  project: Project
  executorId: string
  cwd: string
}) => executorWsService.requestGitWorkingTreeDiff(params.executorId, {
  worktreePath: params.cwd,
  repoUrl: params.project.gitUrl?.trim() || undefined,
}).catch(() => null)

const readWorkspaceExecutorGitBaselineSnapshot = async (params: {
  project: Project
  executorId: string
  cwd: string
}) => executorWsService.requestGitBaselineSnapshot(params.executorId, {
  worktreePath: params.cwd,
  repoUrl: params.project.gitUrl?.trim() || undefined,
}).catch(() => null)

const readWorkspaceExecutorGitBaselineDiff = async (params: {
  project: Project
  executorId: string
  cwd: string
  baselineTreeSha: string
  targetCommitSha?: string
}) => executorWsService.requestGitBaselineDiff(params.executorId, {
  worktreePath: params.cwd,
  repoUrl: params.project.gitUrl?.trim() || undefined,
  baselineTreeSha: params.baselineTreeSha,
  targetCommitSha: params.targetCommitSha,
}).catch(() => null)

export const finalizeWorkspaceExecutorGit = async (params: {
  userId: string
  project: Project
  executorId: string
  cwd: string
  branchName?: string
  commitMessage: string
}): Promise<WorkspaceExecutorGitOutcome> => {
  const gitIdentity = await resolveTaskGitIdentitySafely(params.userId, params.project)
  return executorWsService.requestGitCommit(params.executorId, {
    worktreePath: params.cwd,
    repoUrl: params.project.gitUrl?.trim() || undefined,
    branchName: params.branchName,
    commitMessage: params.commitMessage,
    push: params.project.versionControl === 'git-remote',
    gitIdentity,
  }).catch((error) => ({
    ok: false as const,
    message: error instanceof Error ? error.message : '自动提交失败。',
    branchName: params.branchName?.trim() || '',
    changedFiles: [],
  }))
}

const ensureWorkspaceDirectoryReady = async (params: {
  userId: string
  project: Project
  workspace: Workspace
  session: WorkspaceSession
  executorId: string
  cwd: string
  preferredBranch?: string
  branchName: string
  workingDirectoryMode: Workspace['workingDirectoryMode']
  onOperationEvent?: (event: ExecutorWorkspaceOperationEvent) => void
  onBeforeEnsure?: (context: { repoPath?: string; runtimeEnvironment?: RuntimeEnvironmentExecutionPayload }) => void
}) => {
  const repoPath = params.project.versionControl === 'none'
    ? undefined
    : resolveWorkspaceRepoPath({
        project: params.project,
        workspaceRoot: executorRegistry.getExecutor(params.executorId)?.workspaceRoot,
        workspace: params.workspace,
        session: params.session,
      })
  const runtimeEnvironment = await resolveWorkspaceRuntimeEnvironment(params.workspace.id)
    .then((result) => result?.payload)
    .catch(() => undefined)
  params.onBeforeEnsure?.({ repoPath, runtimeEnvironment })
  const ensureResult = await executorWsService.requestWorktreeEnsure(params.executorId, {
    workspaceId: params.workspace.id,
    ownerUserId: params.workspace.ownerUserId ?? params.userId,
    repoPath,
    repoUrl: params.project.versionControl === 'none' ? undefined : (params.project.gitUrl?.trim() || undefined),
    preferredBranch: params.preferredBranch,
    branchName: params.branchName,
    worktreePath: params.cwd,
    workingDirectoryMode: params.workingDirectoryMode,
    gitIdentity: await resolveTaskGitIdentitySafely(params.userId, params.project),
    runtimeEnvironment,
    onOperationEvent: params.onOperationEvent,
  }).catch((error) => ({
    ok: false as const,
    message: error instanceof Error ? error.message : String(error),
  }))
  const cwd = ensureResult.ok ? ensureResult.worktreePath?.trim() || params.cwd : params.cwd
  const directoryReady = ensureResult.ok
    ? await verifyWorkspaceDirectoryReady({
        executorId: params.executorId,
        cwd,
        browseDirectory: executorWsService.requestDirectoryBrowse,
      })
    : undefined

  return { ensureResult, directoryReady, cwd, repoPath, runtimeEnvironment }
}

export const buildWorkerOnlyTaskDetailResult = (agentType: ServerAgentType): TaskMessageResult => {
  const runtimeLabel = getServerAgentLabel(agentType)
  return {
    ok: false,
    output: `${runtimeLabel} 已切到 worker-only 架构。请先绑定执行节点 / 工作区，然后在工作区聊天里继续对话。`,
    agentRunningStatus: 'error',
    currentStep: '请改用工作区对话',
  }
}

export const OFFLINE_TASK_CHAT_QUEUE_WAIT_MESSAGE = '执行器当前离线，消息已保留在队列中，等待恢复后自动发送。'
export const MANAGED_CLOUD_TASK_CHAT_QUEUE_WAIT_MESSAGE = '官方云节点正在启动，消息已进入队列，准备完成后会自动发送。'

export const resolveWorkspaceChatDispatchAvailability = (params: {
  state: AppState
  userId: string
  task: Task
  project: Project
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  if (!params.workspaceId) {
    return {
      ready: true as const,
      shouldQueue: false as const,
      message: undefined,
    }
  }

  const workspace = getScopedWorkspaceForProject(params.userId, params.project, params.workspaceId)
  if (!workspace) {
    return {
      ready: false as const,
      shouldQueue: false as const,
      message: '工作区不存在或无权访问。',
    }
  }

  const sessionExecutor = resolveWorkspaceSessionExecutor({
    task: params.task,
    workspaceExecutorId: workspace.executorNodeId,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
  })
  const executorId = sessionExecutor.executorId
  if (!executorId) {
    return {
      ready: false as const,
      shouldQueue: false as const,
      message: '当前工作区尚未绑定执行节点。',
    }
  }

  console.info('[workspace-chat][dispatch-availability]', JSON.stringify({
    taskId: params.task.id,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId ?? sessionExecutor.workspaceSession?.id ?? null,
    resolvedExecutorId: executorId,
    sessionExecutorNodeId: sessionExecutor.workspaceSession?.executorNodeId ?? '',
    sessionRuntimeOwnerExecutorId: sessionExecutor.workspaceSession?.runtimeOwnerExecutorId ?? '',
    workspaceExecutorNodeId: workspace.executorNodeId ?? '',
  }))

  const executor = executorRegistry.getExecutor(executorId)
  if (executor?.status !== 'online' || !executorRegistry.getSocket(executorId)) {
    const queueMessage = getManagedCloudGate().isManagedExecutor(executor)
      ? MANAGED_CLOUD_TASK_CHAT_QUEUE_WAIT_MESSAGE
      : OFFLINE_TASK_CHAT_QUEUE_WAIT_MESSAGE
    return {
      ready: false as const,
      shouldQueue: true as const,
      message: queueMessage,
    }
  }

  return {
    ready: true as const,
    shouldQueue: false as const,
    message: undefined,
  }
}

export const resolveWorkspaceChatDispatchAvailabilityAsync = async (params: {
  state: AppState
  userId: string
  task: Task
  project: Project
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const availability = resolveWorkspaceChatDispatchAvailability(params)
  if (availability.ready || !params.workspaceId) {
    return availability
  }

  const workspace = getScopedWorkspaceForProject(params.userId, params.project, params.workspaceId)
  const sessionExecutor = resolveWorkspaceSessionExecutor({
    task: params.task,
    workspaceExecutorId: workspace?.executorNodeId,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
  })
  const executorId = sessionExecutor.executorId
  const executor = executorId ? executorRegistry.getExecutor(executorId) : null
  if (!availability.shouldQueue || !executorId || !getManagedCloudGate().isManagedExecutor(executor)) {
    return availability
  }

  try {
    await getManagedCloudGate().ensureUsageAccess({
      state: params.state,
      userId: params.userId,
    })
    console.info('[workspace-chat][managed-cloud-start]', JSON.stringify({
      taskId: params.task.id,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId ?? sessionExecutor.workspaceSession?.id ?? null,
      executorId,
    }))
    const startedExecutor = await getManagedCloudGate().startExecutor({
      config: params.state.config,
      executorId,
      projects: params.state.projects,
    })
    console.info('[workspace-chat][managed-cloud-started]', JSON.stringify({
      taskId: params.task.id,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId ?? sessionExecutor.workspaceSession?.id ?? null,
      executorId,
      status: startedExecutor.status,
      hasSocket: Boolean(executorRegistry.getSocket(executorId)),
    }))
  } catch (error) {
    if (getManagedCloudGate().isUsageLimitError(error) && error instanceof Error) {
      return {
        ready: false as const,
        shouldQueue: false as const,
        message: error.message,
      }
    }

    console.warn('[workspace-chat][managed-cloud-start-failed]', JSON.stringify({
      taskId: params.task.id,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId ?? sessionExecutor.workspaceSession?.id ?? null,
      executorId,
      error: error instanceof Error ? error.message : String(error),
    }))
    return availability
  }

  return resolveWorkspaceChatDispatchAvailability(params)
}

export const ensureWorkspaceChatTaskReady = async (params: {
  state: AppState
  userId: string
  task: Task
  project: Project
  workspaceId: string
  workspaceSessionId?: string
  createNewSession?: boolean
  turnId?: string
}): Promise<{ task: Task; session?: WorkspaceSession; cwd?: string; error?: TaskMessageResult }> => {
  const workspace = getScopedWorkspaceForProject(params.userId, params.project, params.workspaceId)
  if (!workspace) {
    const error = buildFailedWorkspaceMessageResult('工作区不存在或无权访问。', params.turnId)
    return {
      task: params.task,
      error,
    }
  }

  const sessionExecutor = resolveWorkspaceSessionExecutor({
    task: params.task,
    workspaceExecutorId: workspace.executorNodeId,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
  })
  const executorId = sessionExecutor.executorId
  if (!executorId) {
    const error = buildFailedWorkspaceMessageResult('当前工作区尚未绑定执行节点。', params.turnId)
    return {
      task: params.task,
      error,
    }
  }

  console.info('[workspace-chat][executor-resolve][prepare]', JSON.stringify({
    taskId: params.task.id,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId ?? sessionExecutor.workspaceSession?.id ?? null,
    resolvedExecutorId: executorId,
    sessionExecutorNodeId: sessionExecutor.workspaceSession?.executorNodeId ?? '',
    sessionRuntimeOwnerExecutorId: sessionExecutor.workspaceSession?.runtimeOwnerExecutorId ?? '',
    workspaceExecutorNodeId: workspace.executorNodeId ?? '',
    turnId: params.turnId ?? null,
  }))

  const effectiveProject = await refreshProjectVersionControlFromExecutor(params.userId, params.project, executorId)
  const pathAccess = validateProjectExecutorPathAccess({
    project: effectiveProject,
    executorId,
    bindings: params.state.projectBindings,
    executors: listVisibleExecutorsForUser(params.userId, params.workspaceId),
  })
  if (!pathAccess.ok) {
    const error = buildFailedWorkspaceMessageResult(pathAccess.message, params.turnId)
    return {
      task: params.task,
      error,
    }
  }

  const bindingState = params.state.tasks.some((task) => task.id === params.task.id)
    ? ensureTaskWorkspaceBindingState({
        task: params.task,
        workspaceId: params.workspaceId,
        updatedAt: new Date().toISOString(),
      })
    : null
  const boundTask = bindingState?.task ?? params.task
  const baseSession = ensureWorkspaceSessionRecord({
    task: boundTask,
    workspaceId: params.workspaceId,
    executorNodeId: executorId,
    workspace,
    workspaceSessionId: params.workspaceSessionId,
    createNewSession: params.createNewSession,
  })

  let cwd = resolveWorkspaceChatWorkingDirectory({
    state: params.state,
    taskId: boundTask.id,
    project: effectiveProject,
    session: baseSession,
    executorId,
    workspace,
  })
  if (!cwd) {
    warnWorkspacePreparation('cwd-missing', {
      taskId: params.task.id,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId ?? baseSession.id,
      executorId,
      projectId: effectiveProject.id,
      projectVersionControl: effectiveProject.versionControl,
      requestedTurnId: params.turnId ?? null,
    })
    const error = buildFailedWorkspaceMessageResult('当前工作区还没有可用的项目目录。', params.turnId)
    return {
      task: boundTask,
      session: baseSession,
      error,
    }
  }
  let session = hydrateWorkspaceSessionWithLocalWorktree(
    applyWorkspaceCodeStateToSession(mergeWorkspaceSession(boundTask, baseSession, {
      executorNodeId: executorId,
      agentType: baseSession.agentType ?? workspace.agentType,
      updatedAt: new Date().toISOString(),
    }), workspace),
    workspace,
  )

  const publishPreparationStatus = (status: 'thinking' | 'executing', step: string) => {
    logWorkspacePreparation('status', {
      taskId: params.task.id,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId ?? session.id,
      executorId,
      turnId: params.turnId ?? null,
      status,
      step,
      cwd,
    })
    if (!params.turnId?.trim()) {
      return
    }

    publishTaskChatTimelineEvent(params.task.id, params.workspaceId, params.workspaceSessionId ?? session.id, {
      id: `turn:${params.turnId}:status:${status}:${step}`,
      ts: new Date().toISOString(),
      turnId: params.turnId,
      seq: 2,
      kind: 'status',
      status,
      step,
    })
  }

  const effectiveWorktreeSession = hydrateWorkspaceSessionWithLocalWorktree(
    resolveEffectiveWorkspaceWorktreeSession(boundTask.id, session, workspace.executorNodeId),
    workspace,
  )
  const workingDirectoryMode = resolveWorkspaceWorkingDirectoryMode(workspace, effectiveWorktreeSession)
  const workspaceCodeBaseBranch = resolveWorkspaceCodeBaseBranch(workspace, effectiveWorktreeSession.baseBranch || boundTask.baseBranchHint || effectiveProject.defaultBranch)
  const workspaceCodeBranchName = resolveWorkspaceCodeBranchName({
    workspace,
    fallbackSession: effectiveWorktreeSession,
    fallbackBaseBranch: workspaceCodeBaseBranch,
  })
  const directoryProbe = await shouldEnsureWorkspaceDirectoryOnExecutor({
    executorId,
    cwd,
    workingDirectoryMode,
    worktreeStatus: effectiveWorktreeSession.worktreeStatus,
    browseDirectory: executorWsService.requestDirectoryBrowse,
  })
  const shouldEnsureWorkspaceDirectory = directoryProbe.shouldEnsure

  if (shouldEnsureWorkspaceDirectory) {
    const preferredBranch = workspaceCodeBaseBranch || effectiveWorktreeSession.baseBranch?.trim() || boundTask.baseBranchHint?.trim() || workspace.suggestedBaseBranch?.trim() || workspace.defaultBranch?.trim() || effectiveProject.defaultBranch
    const timelineScope = {
      taskId: boundTask.id,
      workspaceId: workspace.id,
      workspaceSessionId: params.workspaceSessionId ?? session.id,
      turnId: params.turnId,
    }
    const directoryPreparation = await ensureWorkspaceDirectoryReady({
      userId: params.userId,
      project: effectiveProject,
      workspace,
      session: effectiveWorktreeSession,
      executorId,
      cwd,
      preferredBranch,
      branchName: workspaceCodeBranchName,
      workingDirectoryMode,
      onOperationEvent: createWorkspaceOperationTimelineWriter(timelineScope),
      onBeforeEnsure: ({ repoPath, runtimeEnvironment }) => {
        logWorkspacePreparation('ensure-start', {
          taskId: params.task.id,
          workspaceId: params.workspaceId,
          workspaceSessionId: params.workspaceSessionId ?? session.id,
          executorId,
          projectId: effectiveProject.id,
          repoPath: repoPath ?? null,
          repoUrl: effectiveProject.versionControl === 'none' ? null : (effectiveProject.gitUrl?.trim() || null),
          preferredBranch,
          branchName: workspaceCodeBranchName,
          worktreePath: cwd,
          workingDirectoryMode,
          currentWorktreeStatus: effectiveWorktreeSession.worktreeStatus,
          ensureReason: directoryProbe.reason,
          probeMessage: directoryProbe.probe.ready ? null : directoryProbe.probe.message ?? null,
          runtimeEnvironmentFiles: runtimeEnvironment?.fileName ? [runtimeEnvironment.fileName] : [],
        })
        publishPreparationStatus('executing', buildWorkspacePreparationStartStep({
          workingDirectoryMode,
          repoUrl: effectiveProject.versionControl === 'none' ? undefined : (effectiveProject.gitUrl?.trim() || undefined),
          preferredBranch,
        }))
      },
    })
    const { ensureResult: createResult, directoryReady: maybeDirectoryReady, repoPath } = directoryPreparation

    logWorkspacePreparation('ensure-result', {
      taskId: params.task.id,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId ?? session.id,
      executorId,
      ok: createResult.ok,
      message: createResult.message,
      resolvedWorktreePath: 'worktreePath' in createResult ? createResult.worktreePath ?? null : null,
      currentBranch: 'currentBranch' in createResult ? createResult.currentBranch ?? null : null,
    })
    if (!createResult.ok) {
      recordWorkspaceSessionSystemMessage(
        timelineScope,
        `工作区目录准备失败：${createResult.message}`,
      )
      warnWorkspacePreparation('ensure-failed', {
        taskId: params.task.id,
        workspaceId: params.workspaceId,
        workspaceSessionId: params.workspaceSessionId ?? session.id,
        executorId,
        repoPath: repoPath ?? null,
        worktreePath: cwd,
        preferredBranch,
        branchName: effectiveWorktreeSession.branchName,
        workingDirectoryMode,
        message: createResult.message,
      })
      session = mergeWorkspaceSession(boundTask, session, {
        agentRunningStatus: 'error',
        currentStep: '工作区对话失败',
        updatedAt: new Date().toISOString(),
      })
      saveWorkspaceSession(session)

      const error = buildFailedWorkspaceMessageResult(createResult.message, params.turnId)
      return {
        task: boundTask,
        session,
        cwd,
        error,
      }
    }

    const ensuredCwd = directoryPreparation.cwd
    const directoryReady = maybeDirectoryReady!
    if (!directoryReady.ok) {
      recordWorkspaceSessionSystemMessage(
        timelineScope,
        directoryReady.message,
      )
      warnWorkspacePreparation('ensure-directory-not-ready', {
        taskId: params.task.id,
        workspaceId: params.workspaceId,
        workspaceSessionId: params.workspaceSessionId ?? session.id,
        executorId,
        repoPath: repoPath ?? null,
        worktreePath: ensuredCwd,
        preferredBranch,
        branchName: effectiveWorktreeSession.branchName,
        workingDirectoryMode,
        message: directoryReady.message,
      })
      session = mergeWorkspaceSession(boundTask, session, {
        agentRunningStatus: 'error',
        currentStep: '工作区对话失败',
        updatedAt: new Date().toISOString(),
      })
      saveWorkspaceSession(session)

      const error = buildFailedWorkspaceMessageResult(directoryReady.message, params.turnId)
      return {
        task: boundTask,
        session,
        cwd: ensuredCwd,
        error,
      }
    }

    publishPreparationStatus('thinking', buildWorkspacePreparationSuccessStep(createResult))
    if (ensuredCwd !== cwd) {
      logWorkspacePreparation('cwd-updated', {
        taskId: params.task.id,
        workspaceId: params.workspaceId,
        workspaceSessionId: params.workspaceSessionId ?? session.id,
        executorId,
        previousCwd: cwd,
        ensuredCwd,
      })
      cwd = ensuredCwd
    }
    logWorkspacePreparation('ensure-saved', {
      taskId: params.task.id,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId ?? session.id,
      executorId,
      nextWorktreeStatus: 'created',
      worktreePath: cwd,
      currentBranch: createResult.currentBranch ?? null,
    })

    session = saveWorkspaceDirectorySessions({
      task: boundTask,
      currentSession: session,
      effectiveSession: effectiveWorktreeSession,
      patch: {
        worktreeStatus: 'created',
        baseBranch: workspaceCodeBaseBranch,
        branchName: workspaceCodeBranchName,
        updatedAt: new Date().toISOString(),
      },
    })
  } else {
    logWorkspacePreparation('ensure-skipped', {
      taskId: params.task.id,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId ?? session.id,
      executorId,
      reason: 'worktree-already-created',
      cwd,
      branchName: session.branchName,
      worktreeStatus: session.worktreeStatus,
      probeReason: directoryProbe.reason,
    })
  }

  saveWorkspaceSession(session)
  logWorkspacePreparation('ready', {
    taskId: params.task.id,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId ?? session.id,
    executorId,
    cwd,
    worktreeStatus: session.worktreeStatus,
    branchName: session.branchName,
  })

  return { task: buildWorkspaceTaskExecutionView(boundTask, session), session, cwd }
}

export const runWorkspaceMessageViaExecutor = async (params: {
  state: AppState
  userId: string
  task: Task
  project: Project
  workspaceId: string
  workspaceSessionId?: string
  session: WorkspaceSession
  cwd: string
  message: string
  attachments?: TaskChatAttachment[]
  contextRefs?: TaskChatContextRef[]
  turnId: string
  writer?: TaskChatStreamWriter
  signal?: AbortSignal
}): Promise<TaskMessageResult> => {
  const workspace = getScopedWorkspaceForProject(params.userId, params.project, params.workspaceId)
  if (!workspace) {
    return buildFailedWorkspaceMessageResult('工作区不存在或无权访问。', params.turnId)
  }

  const executorId = resolveWorkspaceSessionExecutorId(params.session, workspace.executorNodeId)
  if (!executorId) {
    return buildFailedWorkspaceMessageResult('当前工作区尚未绑定执行节点。', params.turnId)
  }
  console.info('[workspace-chat][executor-resolve][run]', JSON.stringify({
    taskId: params.task.id,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId ?? params.session.id,
    resolvedExecutorId: executorId,
    sessionExecutorNodeId: params.session.executorNodeId ?? '',
    sessionRuntimeOwnerExecutorId: params.session.runtimeOwnerExecutorId ?? '',
    workspaceExecutorNodeId: workspace.executorNodeId ?? '',
    cwd: params.cwd,
    turnId: params.turnId,
  }))
  const effectiveProject = await refreshProjectVersionControlFromExecutor(params.userId, params.project, executorId)

  const writer = params.writer
  const resolvedExecutor = executorRegistry.getExecutor(executorId)
  const workspaceExecutorMetadata: ChatTimelineWorkspaceExecutor = {
    executorId,
    ...(resolvedExecutor?.name ? { name: resolvedExecutor.name } : {}),
    ...(resolvedExecutor?.executorSource ? { executorSource: resolvedExecutor.executorSource } : {}),
    ...(resolvedExecutor?.managedBy ? { managedBy: resolvedExecutor.managedBy } : {}),
    ...(resolvedExecutor?.runtimeClass ? { runtimeClass: resolvedExecutor.runtimeClass } : {}),
    ...(resolvedExecutor?.status ? { status: resolvedExecutor.status } : {}),
  }
  const assistantAuthorName = getServerAgentLabel((params.session.agentType ?? params.task.agentType) as ServerAgentType)
  const workspaceAutoCommitEnabled = resolveWorkspaceAutoCommitEnabled({
    workingDirectoryMode: params.session.workingDirectoryMode ?? workspace.workingDirectoryMode,
    autoCommitEnabled: effectiveProject.versionControl === 'none' ? false : workspace.autoCommitEnabled,
  })
  const textState = new Map<string, string>()
  const reasoningState = new Map<string, string>()
  const textStateByMessageId = new Map<string, Map<string, string>>()
  const reasoningStateByMessageId = new Map<string, Map<string, string>>()
  const activeTextParts = new Set<string>()
  const activeReasoningParts = new Set<string>()
  const toolCallMap = new Map((buildWorkspaceTaskExecutionView(params.task, params.session).toolCalls ?? []).map((tool) => [tool.id, tool]))
  const approvalRequests: string[] = []
  let assistantMessageId = ''
  let currentStatus: Task['agentRunningStatus'] = 'thinking'
  let currentStep = '正在连接工作区执行节点'
  let turnExecutionModel: string | undefined
  const timeline = createTimelineCollector(params.turnId)
  const contextPromptPrefix = await buildTaskChatContextPromptPrefix({
    contextRefs: params.contextRefs,
    userId: params.userId,
    project: effectiveProject,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
    session: params.session,
    cwd: params.cwd,
  })
  const effectiveUserMessage = `${contextPromptPrefix}${params.message}`.trim()

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

  const writeWorkspaceTimelineEvent = (event: Parameters<typeof writeTimelineEvent>[1]) => {
    writeTimelineEvent(writer, event)
    publishTaskChatTimelineEvent(params.task.id, params.workspaceId, params.workspaceSessionId, event)
  }

  const createWorkspaceStatusEvent = (
    status: Task['agentRunningStatus'],
    step: string,
    ts: string,
  ) => createStatusEvent(timeline, status, step, ts, workspaceExecutorMetadata)

  const assistantSegmentIndexByMessageId = new Map<string, number>()
  const assistantSegmentStartLengthByMessageId = new Map<string, number>()
  const assistantLastFullTextByMessageId = new Map<string, string>()
  const splitAssistantSegmentOnNextText = new Set<string>()

  const syncAssistantTimeline = (messageId: string) => {
    const currentText = extractStreamingText(textState, params.message)
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

    writeWorkspaceTimelineEvent(
      createAssistantMessageEvent(
        timeline,
        messageId,
        segmentText,
        new Date().toISOString(),
        `${messageId}:segment:${segmentIndex}`,
        assistantAuthorName,
        turnExecutionModel,
      ),
    )
    assistantLastFullTextByMessageId.set(messageId, currentText)
  }

  const writeFinalAssistantTimelineOutput = (renderableResultOutput: string, ts: string, fallbackMessageIdOverride?: string) => {
    if (!renderableResultOutput) {
      return false
    }

    const fallbackMessageId = assistantMessageId || fallbackMessageIdOverride || crypto.randomUUID()
    const latestFullText = assistantLastFullTextByMessageId.get(fallbackMessageId) ?? ''
    if (!latestFullText) {
      writeWorkspaceTimelineEvent(
        createAssistantMessageEvent(
          timeline,
          fallbackMessageId,
          renderableResultOutput,
          ts,
          undefined,
          assistantAuthorName,
          turnExecutionModel,
        ),
      )
      assistantLastFullTextByMessageId.set(fallbackMessageId, renderableResultOutput)
      return true
    }

    if (renderableResultOutput.startsWith(latestFullText) && renderableResultOutput.length > latestFullText.length) {
      const nextSegmentIndex = (assistantSegmentIndexByMessageId.get(fallbackMessageId) ?? 0) + 1
      const nextSegmentText = renderableResultOutput.slice(latestFullText.length)
      writeWorkspaceTimelineEvent(
        createAssistantMessageEvent(
          timeline,
          fallbackMessageId,
          nextSegmentText,
          ts,
          `${fallbackMessageId}:segment:${nextSegmentIndex}`,
          assistantAuthorName,
          turnExecutionModel,
        ),
      )
      assistantSegmentIndexByMessageId.set(fallbackMessageId, nextSegmentIndex)
      assistantLastFullTextByMessageId.set(fallbackMessageId, renderableResultOutput)
      return true
    }

    return false
  }

  const applyExecutorEvent = (event: ExecutorAgentPromptEvent) => {
    if (params.signal?.aborted) {
      return
    }

    const runtimeLabel = getServerAgentLabel(event.agentType as ServerAgentType)

    if (event.type === 'session.status') {
      const status = event.properties.status as { type?: string; message?: string }
      if (status?.type === 'busy') {
        currentStatus = 'executing'
        currentStep = status.message?.trim() || `${runtimeLabel} 正在执行工具与生成回复`
      } else if (status?.type === 'retry') {
        currentStatus = 'thinking'
        currentStep = status.message ?? `${runtimeLabel} 正在重试`
      } else if (status?.type === 'idle') {
        currentStatus = 'complete'
        currentStep = '工作区对话已完成'
        return
      } else {
        return
      }

      writeWorkspaceTimelineEvent(createWorkspaceStatusEvent(currentStatus, currentStep, new Date().toISOString()))
      return
    }

    if (event.type === 'session.idle') {
      currentStatus = 'complete'
      currentStep = '工作区对话已完成'
      return
    }

    if (event.type === 'session.error') {
      const errorMessage = typeof event.properties.error === 'string'
        ? event.properties.error
        : typeof event.properties.message === 'string'
          ? event.properties.message
          : `${runtimeLabel} 执行失败`
      currentStatus = 'error'
      currentStep = '工作区对话失败'
      createWorkspaceStatusEvent(currentStatus, currentStep, new Date().toISOString())
      createErrorEvent(timeline, errorMessage, new Date().toISOString())
      writer?.write({ type: 'data-notice', data: { level: 'error', message: errorMessage }, transient: true })
      return
    }

    if (event.type === 'message.updated') {
      const info = event.properties.info as { id?: string; role?: string }
      if (info.role !== 'assistant' || !info.id) {
        return
      }

      if (assistantMessageId && assistantMessageId !== info.id) {
        resetStreamingPartState(writer, textState, activeTextParts, 'text')
        resetStreamingPartState(writer, reasoningState, activeReasoningParts, 'reasoning')
      }
      assistantMessageId = info.id
      flushBufferedParts(assistantMessageId, 'text')
      flushBufferedParts(assistantMessageId, 'reasoning')
      syncAssistantTimeline(assistantMessageId)
      return
    }

    if (event.type === 'message.part.delta') {
      const messageID = typeof event.properties.messageID === 'string' ? event.properties.messageID : ''
      const partID = typeof event.properties.partID === 'string' ? event.properties.partID : ''
      const delta = typeof event.properties.delta === 'string' ? event.properties.delta : ''
      if (event.properties.field !== 'text' || !messageID || !partID || !delta) {
        return
      }

      const partState = getMessagePartState(textStateByMessageId, messageID)
      const nextText = `${partState.get(partID) ?? ''}${delta}`
      partState.set(partID, nextText)
      if (assistantMessageId && assistantMessageId !== messageID) {
        return
      }

      if (writer) {
        emitTextDelta(writer, textState, activeTextParts, partID, nextText, delta, 'text')
      } else {
        textState.set(partID, nextText)
      }
      syncAssistantTimeline(messageID)
      return
    }

    if (event.type === 'message.part.updated') {
      const part = event.properties.part as {
        id: string
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
          time?: { start?: number; end?: number }
        }
      }
      const delta = typeof event.properties.delta === 'string' ? event.properties.delta : undefined

      if (part.type === 'text' && part.messageID) {
        getMessagePartState(textStateByMessageId, part.messageID).set(part.id, part.text ?? '')
        if (assistantMessageId !== part.messageID) {
          return
        }

        if (writer) {
          emitTextDelta(writer, textState, activeTextParts, part.id, part.text ?? '', delta, 'text')
        } else {
          textState.set(part.id, part.text ?? '')
        }
        syncAssistantTimeline(part.messageID)
        return
      }

      if (part.type === 'reasoning' && part.messageID) {
        getMessagePartState(reasoningStateByMessageId, part.messageID).set(part.id, part.text ?? '')
        if (assistantMessageId !== part.messageID) {
          return
        }

        if (writer) {
          emitTextDelta(writer, reasoningState, activeReasoningParts, part.id, part.text ?? '', delta, 'reasoning')
        }
        splitAssistantSegmentOnNextText.add(part.messageID)
        writeWorkspaceTimelineEvent(createThinkingEvent(timeline, part.id, part.text ?? '', new Date().toISOString(), part.messageID))
        return
      }

      if (part.type === 'tool' && part.state && part.tool) {
        const toolCall = buildToolCall({ id: part.id, tool: part.tool, state: part.state }, toolCallMap.get(part.id))
        toolCallMap.set(part.id, toolCall)

        const waitingForUserInput = isInteractiveQuestionTool(part.tool) && (part.state.status === 'pending' || part.state.status === 'running')
        if (waitingForUserInput) {
          currentStatus = 'waiting'
          currentStep = '等待用户回答问题'
          writeWorkspaceTimelineEvent(createInteractionEvent(timeline, {
            id: part.id,
            type: 'question',
            status: 'pending',
            title: '等待用户回答',
            prompt: typeof part.state.input?.question === 'string'
              ? part.state.input.question
              : typeof part.state.input?.prompt === 'string'
                ? part.state.input.prompt
                : undefined,
            provider: event.agentType,
            toolName: part.tool,
          }, new Date().toISOString()))
        } else {
          currentStatus = part.state.status === 'pending' || part.state.status === 'running' ? 'executing' : currentStatus
          currentStep = `正在执行工具：${part.tool}`
        }

        if (assistantMessageId) {
          splitAssistantSegmentOnNextText.add(assistantMessageId)
        }
        writeWorkspaceTimelineEvent(createToolCallEvent(timeline, toolCall, toolCall.startedAt))
        writeWorkspaceTimelineEvent(createWorkspaceStatusEvent(currentStatus, currentStep, new Date().toISOString()))
      }
      return
    }

    if (event.type === 'interaction.pending') {
      const interaction = readPendingInteraction(event.properties, crypto.randomUUID())
      if (!interaction) {
        return
      }

      currentStatus = 'waiting'
      currentStep = interaction.type === 'question' ? '等待用户回答问题' : `等待确认：${interaction.title}`
      writeWorkspaceTimelineEvent(createInteractionEvent(timeline, interaction, new Date().toISOString()))
      writeWorkspaceTimelineEvent(createWorkspaceStatusEvent(currentStatus, currentStep, new Date().toISOString()))
      writer?.write({ type: 'data-notice', data: { level: 'warning', message: currentStep }, transient: true })
      return
    }

    if (event.type === 'permission.updated') {
      const permission = event.properties as { title?: string }
      currentStatus = 'waiting'
      currentStep = permission.title ? `等待权限：${permission.title}` : '等待权限确认'
      if (permission.title && !approvalRequests.includes(permission.title)) {
        approvalRequests.push(permission.title)
      }
      writeWorkspaceTimelineEvent(createWorkspaceStatusEvent(currentStatus, currentStep, new Date().toISOString()))
      writer?.write({ type: 'data-notice', data: { level: 'warning', message: currentStep }, transient: true })
    }
  }

  try {
    const effectiveAgentType = params.session.agentType ?? params.task.agentType
    const boundCustomAgent = resolveBoundCustomAgent(params.session, params.userId)
    const executionSkills = resolveExecutionSkillsForSession({
      projectId: params.project.id,
      workspaceId: params.workspaceId,
      userId: params.userId,
      session: params.session,
    })
    const runtimeSkills = resolveRuntimeSkills({
      projectId: params.project.id,
      workspaceId: params.workspaceId,
      userId: params.userId,
    })
    const mergedExecutionSkills = dedupeRuntimeSkills([...executionSkills, ...runtimeSkills], {
      projectId: params.project.id,
      workspaceId: params.workspaceId,
      preferredSkillIds: new Set(executionSkills.map((skill) => skill.id)),
    })
    const visiblePrimaryMcpServers = getPrimaryAgentMcpServers(params.state.config, params.userId, params.workspaceId)
    const executionMcpServers = resolveExecutionMcpServersForSession({
      userId: params.userId,
      session: params.session,
      primaryMcpServers: visiblePrimaryMcpServers,
    })
    const mountedMcpServerNames = resolveExecutionMcpServerNamesForSession({
      userId: params.userId,
      session: params.session,
      primaryMcpServers: visiblePrimaryMcpServers,
    })
    const runtimeSession = mergeWorkspaceSession(params.task, params.session, {
      mountedSkillNames: mergedExecutionSkills.map((skill) => skill.name),
      mountedMcpServerNames,
      updatedAt: new Date().toISOString(),
    })
    saveWorkspaceSession(runtimeSession)
    const effectiveOpencodeConfig = runtimeSession.opencodeConfig ?? params.task.opencodeConfig
    const sessionDefaultModel = typeof params.session.agentSettings?.defaultModel === 'string'
      ? params.session.agentSettings.defaultModel.trim()
      : ''
    const modelResolution = await resolveWorkspaceExecutionModel({
      userId: params.userId,
      task: params.task,
      executorId,
      agentType: effectiveAgentType,
      workspaceId: params.workspaceId,
      executionModel: runtimeSession.executionModel ?? params.task.executionModel,
      fallbackExecutionModel: sessionDefaultModel || getServerAgentDefaultModel(params.state.config, effectiveAgentType),
    })
    turnExecutionModel = modelResolution.actualExecutionModel
    const profileAgentSettings = modelResolution.runtimeSettings
      ? mergeAgentRuntimeSettings(
          effectiveAgentType,
          getServerAgentSettings(params.state.config, effectiveAgentType),
          modelResolution.runtimeSettings,
        )
      : getServerAgentSettings(params.state.config, effectiveAgentType)
    const agentSettings = mergeAgentRuntimeSettings(
      effectiveAgentType,
      profileAgentSettings,
      params.session.agentSettings,
    )

    if (modelResolution.fallbackReason) {
      console.warn('[workspace-chat] model-fallback', JSON.stringify({
        taskId: params.task.id,
        workspaceId: params.workspaceId,
        executorId,
        requestedExecutionModel: modelResolution.requestedExecutionModel,
        effectiveExecutionModel: modelResolution.executionModel ?? 'default',
        reason: modelResolution.fallbackReason,
      }))
    }

    const promptMessage = buildMessageWithRuntimeSkillMentions(effectiveUserMessage, {
      projectId: params.project.id,
      workspaceId: params.workspaceId,
      userId: params.userId,
    })
    const runtimeOpencodeConfig = effectiveAgentType === 'OpenCode'
      ? mergeOpenCodeExecutionConfig(
          effectiveOpencodeConfig,
          buildOpenCodeProviderOverlay(modelResolution.binding),
          modelResolution.executionModel,
        )
      : effectiveOpencodeConfig
    const capabilitySnapshot = resolveTaskRuntimeCapabilitySnapshot({
      projectId: params.project.id,
      workspaceId: params.workspaceId,
      userId: params.userId,
      runtimeSkillPackages: buildRuntimeSkillPackagesFromSkills(mergedExecutionSkills),
      mcpServers: executionMcpServers,
      runtimeEnv: modelResolution.runtimeEnv,
      opencodeConfig: runtimeOpencodeConfig,
    })
    const continuationScope = {
      runtimeId: effectiveAgentType,
      executorId,
      customAgentId: runtimeSession.customAgentId,
      executionModel: modelResolution.executionModel,
      cwd: params.cwd,
    } as const
    const resumeSessionId = getWorkspaceRuntimeSessionId(runtimeSession, continuationScope)
    const resolveHandoffSnapshot = () => {
      if (runtimeSession.handoffSnapshot) {
        return runtimeSession.handoffSnapshot
      }

      const conversationPayload = getTaskConversationWithMessages(
        params.task,
        params.project,
        params.workspaceId,
        params.workspaceSessionId,
      )
      return buildTaskConversationHandoffSnapshot(conversationPayload.messages)
    }
    const buildPromptForAttempt = (resumeId?: string, messageOverride = promptMessage) => {
      if (resumeId) {
        return boundCustomAgent
          ? buildExecutionDescriptionWithSkills(messageOverride, mergedExecutionSkills)
          : messageOverride
      }

      const promptWithHandoff = buildUserMessagePromptWithHandoff(
        messageOverride,
        resolveHandoffSnapshot(),
      )

      return boundCustomAgent
        ? buildExecutionDescriptionWithSkills(promptWithHandoff, mergedExecutionSkills)
        : promptWithHandoff
    }
    const requestPrompt = async (resumeId?: string) => {
      const prompt = buildPromptForAttempt(resumeId)

      let promptCwd = params.cwd

      console.log('[workspace-chat] request', JSON.stringify({
        taskId: params.task.id,
        projectId: params.project.id,
        workspaceId: params.workspaceId,
        executorId,
        resumeSessionId: resumeId ?? null,
        cwd: promptCwd,
        requestedExecutionModel: modelResolution.requestedExecutionModel ?? 'default',
        executionModel: modelResolution.executionModel ?? 'default',
        mountedMcpCount: executionMcpServers.length,
        attachmentCount: params.attachments?.length ?? 0,
        promptPreview: prompt.slice(0, 160),
      }))

      let response = await executorWsService.requestAgentPrompt(executorId, {
        agentType: effectiveAgentType,
        actingUserId: params.userId,
        resumeSessionId: resumeId,
        cwd: promptCwd,
        title: `Workspace Chat: ${params.task.title}`,
        prompt,
        attachments: params.attachments,
        executionModel: modelResolution.executionModel,
        agentSettings,
        opencodeConfig: capabilitySnapshot.opencodeConfig,
        mcpServers: capabilitySnapshot.mcpServers,
        runtimeSkillPackages: capabilitySnapshot.runtimeSkillPackages,
        runtimeEnv: capabilitySnapshot.runtimeEnv,
        runtimeEnvironment: await resolveWorkspaceRuntimeEnvironment(workspace.id).then((result) => result?.payload).catch(() => undefined),
        recovery: {
          taskId: params.task.id,
          workspaceId: params.workspaceId,
          workspaceSessionId: params.workspaceSessionId ?? params.session.id,
          userId: params.userId,
          userMessage: effectiveUserMessage,
          attachments: params.attachments,
          turnId: params.turnId,
          expectedRuntimeSequence: runtimeSession.runtimeSequence,
        },
        onEvent: applyExecutorEvent,
        signal: params.signal,
      })

      if (!response.ok && isMissingWorkspaceCwdError(response.output)) {
        const retryWorktreeSession = hydrateWorkspaceSessionWithLocalWorktree(
          resolveEffectiveWorkspaceWorktreeSession(params.task.id, params.session, workspace.executorNodeId),
          workspace,
        )
        warnWorkspacePreparation('prompt-missing-cwd', {
          taskId: params.task.id,
          workspaceId: params.workspaceId,
          workspaceSessionId: params.workspaceSessionId ?? params.session.id,
          executorId,
          cwd: promptCwd,
          responsePreview: response.output.slice(0, 200),
        })
        const retryPreferredBranch = retryWorktreeSession.baseBranch?.trim() || params.task.baseBranchHint?.trim() || workspace.suggestedBaseBranch?.trim() || workspace.defaultBranch?.trim() || effectiveProject.defaultBranch
        const retryWorkingDirectoryMode = resolveWorkspaceWorkingDirectoryMode(workspace, retryWorktreeSession)
        const directoryPreparation = await ensureWorkspaceDirectoryReady({
          userId: params.userId,
          project: effectiveProject,
          workspace,
          session: retryWorktreeSession,
          executorId,
          cwd: promptCwd,
          preferredBranch: retryPreferredBranch,
          branchName: retryWorktreeSession.branchName,
          workingDirectoryMode: retryWorkingDirectoryMode,
          onOperationEvent: createWorkspaceOperationTimelineWriter({
            taskId: params.task.id,
            workspaceId: params.workspaceId,
            workspaceSessionId: params.workspaceSessionId ?? params.session.id,
            turnId: params.turnId,
          }),
          onBeforeEnsure: ({ repoPath }) => {
            writeWorkspaceTimelineEvent(createWorkspaceStatusEvent(
              'executing',
              buildWorkspacePreparationRetryStep({
                workingDirectoryMode: retryWorkingDirectoryMode,
                preferredBranch: retryPreferredBranch,
              }),
              new Date().toISOString(),
            ))
            logWorkspacePreparation('retry-start', {
              taskId: params.task.id,
              workspaceId: params.workspaceId,
              workspaceSessionId: params.workspaceSessionId ?? params.session.id,
              executorId,
              cwd: promptCwd,
              repoPath: repoPath ?? null,
              repoUrl: effectiveProject.versionControl === 'none' ? null : (effectiveProject.gitUrl?.trim() || null),
              preferredBranch: retryPreferredBranch,
              branchName: retryWorktreeSession.branchName,
              workingDirectoryMode: retryWorkingDirectoryMode,
            })
          },
        })
        const { ensureResult: createResult, repoPath: retryRepoPath } = directoryPreparation

        logWorkspacePreparation('retry-result', {
          taskId: params.task.id,
          workspaceId: params.workspaceId,
          workspaceSessionId: params.workspaceSessionId ?? params.session.id,
          executorId,
          ok: createResult.ok,
          message: createResult.message,
          resolvedWorktreePath: 'worktreePath' in createResult ? createResult.worktreePath ?? null : null,
          currentBranch: 'currentBranch' in createResult ? createResult.currentBranch ?? null : null,
        })

        if (createResult.ok) {
          const ensuredPromptCwd = directoryPreparation.cwd
          const directoryReady = directoryPreparation.directoryReady!
          if (!directoryReady.ok) {
            warnWorkspacePreparation('retry-directory-not-ready', {
              taskId: params.task.id,
              workspaceId: params.workspaceId,
              workspaceSessionId: params.workspaceSessionId ?? params.session.id,
              executorId,
              cwd: ensuredPromptCwd,
              repoPath: retryRepoPath ?? null,
              preferredBranch: retryPreferredBranch,
              branchName: retryWorktreeSession.branchName,
              workingDirectoryMode: retryWorkingDirectoryMode,
              message: directoryReady.message,
            })
            response = {
              ok: false,
              output: directoryReady.message,
            }
          } else {
            if (ensuredPromptCwd !== promptCwd) {
              logWorkspacePreparation('retry-cwd-updated', {
                taskId: params.task.id,
                workspaceId: params.workspaceId,
                workspaceSessionId: params.workspaceSessionId ?? params.session.id,
                executorId,
                previousCwd: promptCwd,
                ensuredCwd: ensuredPromptCwd,
              })
              promptCwd = ensuredPromptCwd
            }
            saveWorkspaceDirectorySessions({
              task: params.task,
              currentSession: params.session,
              effectiveSession: retryWorktreeSession,
              patch: {
                worktreeStatus: 'created',
                updatedAt: new Date().toISOString(),
              },
            })
            writeWorkspaceTimelineEvent(createWorkspaceStatusEvent(
              'thinking',
              buildWorkspacePreparationSuccessStep(createResult),
              new Date().toISOString(),
            ))
            logWorkspacePreparation('retry-prompt', {
              taskId: params.task.id,
              workspaceId: params.workspaceId,
              workspaceSessionId: params.workspaceSessionId ?? params.session.id,
              executorId,
              cwd: promptCwd,
              resumeSessionId: resumeId ?? null,
              branchName: retryWorktreeSession.branchName,
            })
            response = await executorWsService.requestAgentPrompt(executorId, {
              agentType: effectiveAgentType,
              actingUserId: params.userId,
              resumeSessionId: resumeId,
              cwd: promptCwd,
              title: `Workspace Chat: ${params.task.title}`,
              prompt,
              attachments: params.attachments,
              executionModel: modelResolution.executionModel,
              agentSettings,
              opencodeConfig: capabilitySnapshot.opencodeConfig,
              mcpServers: capabilitySnapshot.mcpServers,
              runtimeSkillPackages: capabilitySnapshot.runtimeSkillPackages,
              runtimeEnv: capabilitySnapshot.runtimeEnv,
              runtimeEnvironment: await resolveWorkspaceRuntimeEnvironment(workspace.id).then((result) => result?.payload).catch(() => undefined),
              recovery: {
                taskId: params.task.id,
                workspaceId: params.workspaceId,
                workspaceSessionId: params.workspaceSessionId ?? params.session.id,
                userId: params.userId,
                userMessage: effectiveUserMessage,
                attachments: params.attachments,
                turnId: params.turnId,
                expectedRuntimeSequence: runtimeSession.runtimeSequence,
                executionModel: turnExecutionModel,
              },
              onEvent: applyExecutorEvent,
              signal: params.signal,
            })
          }
        } else {
          warnWorkspacePreparation('retry-failed', {
            taskId: params.task.id,
            workspaceId: params.workspaceId,
            workspaceSessionId: params.workspaceSessionId ?? params.session.id,
            executorId,
            cwd: promptCwd,
            repoPath: retryRepoPath ?? null,
            preferredBranch: retryPreferredBranch,
            branchName: retryWorktreeSession.branchName,
            workingDirectoryMode: retryWorkingDirectoryMode,
            message: createResult.message,
          })
        }
      }

      return response
    }

    const baselineSnapshot = await readWorkspaceExecutorGitBaselineSnapshot({
      project: effectiveProject,
      executorId,
      cwd: params.cwd,
    })

    const executorResult = await requestPrompt(resumeSessionId)
    let result: WorkspaceExecutorPromptResult = {
      ...executorResult,
      currentStep: executorResult.ok ? '工作区对话已完成' : '工作区对话失败',
    }
    let persistedRuntimeContinuations = runtimeSession.runtimeContinuations

    if (!result.ok && resumeSessionId && shouldRetryWorkspaceResume(result.output)) {
      persistedRuntimeContinuations = clearWorkspaceRuntimeSessionId(runtimeSession, continuationScope)
      saveWorkspaceSession(mergeWorkspaceSession(params.task, runtimeSession, {
        runtimeContinuations: persistedRuntimeContinuations,
        updatedAt: new Date().toISOString(),
      }))
      const retriedExecutorResult = await requestPrompt(undefined)
      result = {
        ...retriedExecutorResult,
        currentStep: retriedExecutorResult.ok ? '工作区对话已完成' : '工作区对话失败',
      }
    }

    console.log('[workspace-chat] result', JSON.stringify({
      taskId: params.task.id,
      workspaceId: params.workspaceId,
      executorId,
      ok: result.ok,
      sessionId: result.sessionId,
      outputPreview: (result.output ?? '').slice(0, 200),
    }))

    const gitWorkingTreeDiff = result.ok
      ? await readWorkspaceExecutorGitWorkingTreeDiff({
          project: effectiveProject,
          executorId,
          cwd: params.cwd,
        })
      : null
    const baselineTreeSha = baselineSnapshot?.ok ? baselineSnapshot.treeSha?.trim() || '' : ''
    const baselineWorkingTreeDiff = result.ok && baselineTreeSha
      ? await readWorkspaceExecutorGitBaselineDiff({
          project: effectiveProject,
          executorId,
          cwd: params.cwd,
          baselineTreeSha,
        })
      : null
    const initialChangeSummary = baselineWorkingTreeDiff?.ok
      ? buildTaskGitChangeSummary(baselineWorkingTreeDiff.files, baselineWorkingTreeDiff.patch)
      : undefined
    if (initialChangeSummary) {
      result = {
        ...result,
        filesChanged: initialChangeSummary.files.map((file) => file.path),
        changeSummary: initialChangeSummary,
      }
    }

    if (result.ok && workspaceAutoCommitEnabled) {
      const assistantOutput = getRenderableWorkspaceAssistantOutput(result.output)
      const commitMessage = assistantOutput || `${assistantAuthorName} 已处理完成。`
      writeFinalAssistantTimelineOutput(
        assistantOutput,
        new Date().toISOString(),
        result.sessionId ? `${result.sessionId}:assistant` : undefined,
      )
      if (shouldEmitWorkspaceAutoCommitStartMessage(gitWorkingTreeDiff)) {
        writeWorkspaceTimelineEvent(
          createSystemMessageEvent(
            timeline,
            effectiveProject.versionControl === 'git-remote'
              ? `正在提交改动并推送分支：${workspace.codeBranchName || params.session.branchName || '当前分支'}`
              : `正在提交本地改动：${workspace.codeBranchName || params.session.branchName || '当前分支'}`,
            new Date().toISOString(),
            'auto-commit-start',
          ),
        )
      }
      const workspaceCodeBaseBranch = resolveWorkspaceCodeBaseBranch(workspace, params.session.baseBranch || params.task.baseBranchHint || effectiveProject.defaultBranch)
      const workspaceCodeBranchName = resolveWorkspaceCodeBranchName({
        workspace,
        fallbackSession: params.session,
        fallbackBaseBranch: workspaceCodeBaseBranch,
      })
      const gitOutcome = await finalizeWorkspaceExecutorGit({
        userId: params.userId,
        project: effectiveProject,
        executorId,
        cwd: params.cwd,
        branchName: workspaceCodeBranchName,
        commitMessage,
      })
      if (gitOutcome.ok && gitOutcome.remoteBranchName && gitOutcome.commitSha) {
        const syncedAt = new Date().toISOString()
        saveWorkspace({
          ...workspace,
          codeBaseBranch: workspaceCodeBaseBranch,
          codeBranchName: gitOutcome.remoteBranchName,
          codeRemoteHeadSha: gitOutcome.commitSha,
          codeSyncedAt: syncedAt,
          updatedAt: syncedAt,
        })
      }
      writeWorkspaceTimelineEvent(
        createSystemMessageEvent(
          timeline,
          gitOutcome.ok
            ? gitOutcome.message
            : `自动提交 / 推送失败：${gitOutcome.message}`,
          new Date().toISOString(),
          'auto-commit-result',
        ),
      )
      const committedChangeSummary = gitOutcome.ok
        ? initialChangeSummary
        : undefined
      result = {
        ...result,
        ok: gitOutcome.ok ? result.ok : false,
        output: assistantOutput,
        filesChanged: committedChangeSummary?.files.map((file) => file.path) ?? gitOutcome.changedFiles,
        changeSummary: committedChangeSummary,
        commitShas: gitOutcome.commitSha ? [gitOutcome.commitSha] : undefined,
        remoteBranchName: gitOutcome.remoteBranchName,
        currentStep: gitOutcome.ok ? result.currentStep : '工作区对话已完成（自动提交失败）',
      }
    }

    const completedAt = new Date().toISOString()
    createWorkspaceStatusEvent(
      result.ok ? 'complete' : 'error',
      result.currentStep ?? (result.ok ? '工作区对话已完成' : '工作区对话失败'),
      completedAt,
    )

    const interruptionMessage = getWorkspacePromptInterruptionMessage(result)
    if (interruptionMessage) {
      createSystemMessageEvent(
        timeline,
        interruptionMessage,
        completedAt,
        result.abortReason ?? 'interrupted',
      )
    }

    const renderableResultOutput = interruptionMessage ? '' : getRenderableWorkspaceAssistantOutput(result.output)
    writeFinalAssistantTimelineOutput(
      renderableResultOutput,
      completedAt,
      result.sessionId ? `${result.sessionId}:assistant` : undefined,
    )

    if (writer) {
      finishActiveParts(writer, activeTextParts, 'text')
      finishActiveParts(writer, activeReasoningParts, 'reasoning')
      if (!extractStreamingText(textState) && renderableResultOutput) {
        writeFinalTextResult(writer, {
          ok: result.ok,
          output: renderableResultOutput,
          agentSessionId: result.sessionId,
          opencodeSessionId: result.sessionId,
          toolCalls: [...toolCallMap.values()],
          approvalRequests,
          agentRunningStatus: result.ok ? 'complete' : 'error',
          currentStep: result.currentStep ?? (result.ok ? '工作区对话已完成' : '工作区对话失败'),
        })
      }
    }

    persistedRuntimeContinuations = result.sessionId
      ? setWorkspaceRuntimeSessionId(runtimeSession, continuationScope, result.sessionId)
      : persistedRuntimeContinuations
    saveWorkspaceSession(mergeWorkspaceSession(params.task, runtimeSession, {
      agentSessionId: result.sessionId ?? runtimeSession.agentSessionId,
      opencodeSessionId: result.sessionId ?? runtimeSession.opencodeSessionId,
      runtimeContinuations: persistedRuntimeContinuations,
      updatedAt: completedAt,
      lastActiveAt: completedAt,
    }))

    return {
      ok: result.ok,
      output: result.output,
      turnId: params.turnId,
      executionModel: turnExecutionModel,
      usage: result.usage,
      agentSessionId: result.sessionId,
      opencodeSessionId: result.sessionId,
      runtimeContinuations: persistedRuntimeContinuations,
      toolCalls: [...toolCallMap.values()],
      approvalRequests,
      filesChanged: result.filesChanged,
      changeSummary: result.changeSummary,
      commitShas: result.commitShas,
      remoteBranchName: result.remoteBranchName,
      conversationTimeline: timeline.values(),
      agentRunningStatus: result.ok ? 'complete' as const : 'error' as const,
      currentStep: result.currentStep ?? (result.ok ? '工作区对话已完成' : '工作区对话失败'),
    }
  } catch (error) {
    if (writer) {
      finishActiveParts(writer, activeTextParts, 'text')
      finishActiveParts(writer, activeReasoningParts, 'reasoning')
    }
    const executorName = executorRegistry.getExecutor(executorId)?.name || workspace.executorName || executorId
    console.warn('[workspace-chat] error', JSON.stringify({
      taskId: params.task.id,
      workspaceId: params.workspaceId,
      executorId,
      executorName,
      cwd: params.cwd,
      error: error instanceof Error ? error.message : String(error),
    }))
    const rawErrorMessage = error instanceof Error ? error.message : String(error)
    const abortReason = getAbortErrorReason(error)
    const interruptionMessage = abortReason
      ? rawErrorMessage.trim() || (abortReason === 'user_stop' ? '已停止' : '本次回复已中止')
      : ''
    const stoppedByUser = abortReason === 'user_stop'
    if (interruptionMessage) {
      createSystemMessageEvent(timeline, interruptionMessage, new Date().toISOString(), abortReason)
    } else {
      createErrorEvent(timeline, rawErrorMessage, new Date().toISOString())
    }
    return {
      ok: false as const,
      output: rawErrorMessage,
      turnId: params.turnId,
      executionModel: turnExecutionModel,
      toolCalls: [...toolCallMap.values()],
      approvalRequests,
      conversationTimeline: timeline.values(),
      agentRunningStatus: stoppedByUser ? 'idle' as const : 'error' as const,
      currentStep: stoppedByUser ? '已停止' : '工作区对话失败',
    }
  }
}
