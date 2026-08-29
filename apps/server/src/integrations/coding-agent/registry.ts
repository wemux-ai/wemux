import type { WorkspaceTaskExecutionView } from '@shared/task-workspace'
import { normalizeAgentConfig } from '@shared/agent-config'
import { DEFAULT_AGENT_TYPE } from '@shared/agent-type'
import type { AgentAdapter, AgentConfig, ExecutionModelOption, Project, Task, TaskRuntimeGitIdentity } from '@shared/types'
import {
  listAvailableModels as listOpenCodeModels,
} from '../opencode/service'
import {
  getServerAgentDefaultModel,
  getServerAgentLabel,
  listServerBundledAgentModels,
  type ServerAgentType,
} from '../../services/server-agent'
import type { AgentMessageResult, TaskChatStreamWriter } from '../opencode/task-chat-stream'

type AgentModelListResult = {
  ok: boolean
  models: ExecutionModelOption[]
  defaultModel?: string
  message?: string
}

type SendTaskMessageParams = {
  task: Task | WorkspaceTaskExecutionView
  project: Project
  config: AgentConfig
  message: string
  signal?: AbortSignal
  gitIdentity?: TaskRuntimeGitIdentity
  turnId?: string
}

type StreamTaskMessageParams = SendTaskMessageParams & {
  writer: TaskChatStreamWriter
}

type CodingAgentRunner = {
  checkAdapter: (config: AgentConfig, adapter: AgentAdapter) => Promise<AgentAdapter>
  listAvailableModels: (config: AgentConfig) => Promise<AgentModelListResult>
  sendTaskMessage: (params: SendTaskMessageParams) => Promise<AgentMessageResult>
  streamTaskMessageToUi: (params: StreamTaskMessageParams) => Promise<{ task: Task; result: AgentMessageResult }>
}

const workerOnlyMessage = (agentType: ServerAgentType) => {
  const label = getServerAgentLabel(agentType)
  return `${label} 已改为仅通过 worker 执行节点运行；请先绑定执行节点 / 工作区，再从工作区对话或执行任务进入该链路。`
}

const buildWorkerOnlyResult = (agentType: ServerAgentType): AgentMessageResult => ({
  ok: false,
  output: workerOnlyMessage(agentType),
  agentRunningStatus: 'error',
  currentStep: '请改用工作区对话',
})

const buildWorkerOnlyStreamResult = (params: StreamTaskMessageParams): { task: Task; result: AgentMessageResult } => {
  const result = buildWorkerOnlyResult(params.task.agentType)
  params.writer.write({
    type: 'data-notice',
    data: { level: 'warning', message: result.output },
    transient: true,
  })
  return {
    task: params.task as Task,
    result,
  }
}

const createWorkerOnlyRunner = (
  agentType: Exclude<ServerAgentType, 'OpenCode'>,
  params: {
    defaultModel: string
  },
): CodingAgentRunner => ({
  async checkAdapter(_config, adapter) {
    return {
      ...adapter,
      heartbeatAt: new Date().toISOString(),
      status: 'degraded',
      limitations: [
        ...adapter.limitations.filter((item) => !item.includes('worker')),
        'server 不再直连该 CLI，仅支持 worker 执行节点。',
      ],
    }
  },
  async listAvailableModels() {
    const preferredDefaultModel = params.defaultModel
    return {
      ok: true,
      models: listServerBundledAgentModels(agentType, preferredDefaultModel),
      defaultModel: preferredDefaultModel,
      message: `${getServerAgentLabel(agentType)} 模型列表由前置静态目录提供，真实可用性以 worker 节点安装结果为准。`,
    }
  },
  async sendTaskMessage() {
    return buildWorkerOnlyResult(agentType)
  },
  async streamTaskMessageToUi(params) {
    return buildWorkerOnlyStreamResult(params)
  },
})

const codexRunner = createWorkerOnlyRunner('Codex', {
  defaultModel: 'gpt-5.4',
})

const claudeCodeRunner = createWorkerOnlyRunner('ClaudeCode', {
  defaultModel: 'sonnet',
})

const piRunner = createWorkerOnlyRunner('Pi', {
  defaultModel: '',
})

const openCodeRunner: CodingAgentRunner = {
  async checkAdapter(config, adapter) {
    return {
      ...adapter,
      heartbeatAt: new Date().toISOString(),
      status: config.opencodeConfigContent?.trim() ? 'online' : 'degraded',
      limitations: [
        ...adapter.limitations.filter((item) => !item.includes('worker')),
        '仅支持通过 worker 执行节点运行',
      ],
    }
  },
  async listAvailableModels(config) {
    return listOpenCodeModels(config.opencodeConfigContent)
  },
  async sendTaskMessage(params) {
    return buildWorkerOnlyResult(params.task.agentType)
  },
  async streamTaskMessageToUi(params) {
    return buildWorkerOnlyStreamResult(params)
  },
}

const runners: Record<ServerAgentType, CodingAgentRunner> = {
  OpenCode: openCodeRunner,
  Codex: codexRunner,
  ClaudeCode: claudeCodeRunner,
  Pi: piRunner,
}

const resolveRunner = (agentType?: ServerAgentType) => {
  return runners[agentType ?? DEFAULT_AGENT_TYPE]
}

export const checkAdapters = async (config: AgentConfig, adapters: AgentAdapter[]) => {
  return Promise.all(adapters.map((adapter) => resolveRunner(adapter.id).checkAdapter(config, adapter)))
}

export const listAvailableModels = async (
  config?: AgentConfig['opencodeConfigContent'] | AgentConfig,
  agentType: ServerAgentType = DEFAULT_AGENT_TYPE,
) => {
  const normalizedConfig = normalizeAgentConfig(typeof config === 'string'
    ? {
        opencodeCommand: '',
        opencodeConfigContent: config,
        heartbeatSeconds: 30,
        maxRetries: 3,
        autoCleanupWorktree: false,
        defaultModel: '',
        workspaceRoot: '',
      }
    : config ?? {})

  const result = await resolveRunner(agentType).listAvailableModels(normalizedConfig)
  const preferredDefaultModel = getServerAgentDefaultModel(normalizedConfig, agentType)
  if (!preferredDefaultModel) {
    return result
  }

  const models = result.models.map((model) => ({
    ...model,
    isDefault: model.id === preferredDefaultModel,
  }))

  return {
    ...result,
    models,
    defaultModel: preferredDefaultModel,
  }
}

export const sendTaskMessageToAgent = async (
  task: Task | WorkspaceTaskExecutionView,
  project: Project,
  config: AgentConfig,
  message: string,
  signal?: AbortSignal,
  gitIdentity?: TaskRuntimeGitIdentity,
  turnId?: string,
) => {
  return resolveRunner(task.agentType).sendTaskMessage({
    task,
    project,
    config,
    message,
    signal,
    gitIdentity,
    turnId,
  })
}

export const streamTaskMessageToUi = async (
  task: Task | WorkspaceTaskExecutionView,
  project: Project,
  config: AgentConfig,
  message: string,
  writer: TaskChatStreamWriter,
  signal?: AbortSignal,
  gitIdentity?: TaskRuntimeGitIdentity,
  turnId?: string,
) => {
  return resolveRunner(task.agentType).streamTaskMessageToUi({
    task,
    project,
    config,
    message,
    writer,
    signal,
    gitIdentity,
    turnId,
  })
}
