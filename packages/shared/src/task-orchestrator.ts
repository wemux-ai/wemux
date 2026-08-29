// [INPUT]: 编排输入
// [OUTPUT]: 步骤契约
// [POS]: 任务编排类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { DEFAULT_AGENT_TYPE } from './agent-type'
import { mergeOpenCodeExecutionConfig, resolveOpenCodeExecutionModel } from './opencode-execution-config'
import type { AgentAdapter, AgentConfig, ChatMessage, ExecutionCenter, ExecutionLog, OrchestrationStep, Project, Task, TaskDifficulty, TaskStatus, ValidationCheck } from './types'

const buildTaskTitle = (description: string): string => {
  const firstLine = description.split('\n')[0].trim()
  return firstLine.length > 50 ? `${firstLine.slice(0, 47)}...` : firstLine
}

const pickAgent = (_description: string, _difficulty: TaskDifficulty) => DEFAULT_AGENT_TYPE

const stepDefinitions: Array<Pick<OrchestrationStep, 'key' | 'title' | 'detail'>> = [
  { key: 'understand', title: '需求理解', detail: '解析自然语言需求并补齐项目上下文。' },
  { key: 'worktree', title: 'Worktree 准备', detail: '创建 feature 分支和独立 worktree。' },
  { key: 'select_agent', title: 'Agent 选择', detail: '根据任务难度与本地依赖确认合适的 Coding Agent 执行链路。' },
  { key: 'dispatch', title: '需求裁剪下发', detail: '将需求转成子 Agent 更容易执行的指令。' },
  { key: 'verify', title: '结果验证', detail: '检查变更结果并准备运行验证。' },
  { key: 'handoff', title: '人工确认', detail: '校验通过后等待人工最终确认。' },
]

const validationTemplates = ['代码已生成', '需求覆盖完整', '验证日志已记录']

export const createExecutionLog = (
  role: ExecutionLog['role'],
  content: string,
  workspaceId?: string,
  workspaceSessionId?: string,
): ExecutionLog => ({
  id: crypto.randomUUID(),
  role,
  content,
  createdAt: new Date().toISOString(),
  workspaceId,
  workspaceSessionId,
})

export const createOrchestration = (): OrchestrationStep[] =>
  stepDefinitions.map((step, index) => ({
    ...step,
    id: crypto.randomUUID(),
    status: index === 0 ? 'running' : 'pending',
  }))

export const createValidationChecks = (): ValidationCheck[] =>
  validationTemplates.map((label) => ({
    id: crypto.randomUUID(),
    label,
    passed: false,
  }))

export const createAdapters = (): AgentAdapter[] => {
  const timestamp = new Date().toISOString()
  return [
    {
      id: 'OpenCode',
      name: 'OpenCode',
      runtimeId: 'OpenCode',
      transport: 'SDK',
      status: 'offline',
      heartbeatAt: timestamp,
      strengths: ['本地文件操作', 'Git / worktree 管理', '复杂多步骤开发'],
      limitations: ['仅支持通过 worker 执行节点运行'],
    },
    {
      id: 'Codex',
      name: 'Codex',
      runtimeId: 'Codex',
      transport: 'STDIO',
      status: 'offline',
      heartbeatAt: timestamp,
      strengths: ['命令行编码代理', '多步规划与工具调用', '权限策略较完整'],
      limitations: ['仅支持通过 worker 执行节点运行'],
    },
    {
      id: 'ClaudeCode',
      name: 'ClaudeCode',
      runtimeId: 'ClaudeCode',
      transport: 'STDIO',
      status: 'offline',
      heartbeatAt: timestamp,
      strengths: ['长链路代码修改', 'Plan / Supervised 模式', '本地 CLI 工作流'],
      limitations: ['仅支持通过 worker 执行节点运行'],
    },
    {
      id: 'Pi',
      name: 'Pi',
      runtimeId: 'Pi',
      transport: 'SDK',
      status: 'offline',
      heartbeatAt: timestamp,
      strengths: ['规范化 provider/model 标识', '适合统一模型目录与 SDK 型接入', '便于与工作区级 runtime 设置协同'],
      limitations: ['依赖 worker 执行节点与 Pi runtime runner 配置'],
    },
  ]
}

export const createExecutionCenter = (tasks: Task[]): ExecutionCenter => ({
  activeTaskId: tasks.find((task) => task.status === 'in_progress')?.id ?? '',
  queuedTaskIds: tasks.filter((task) => task.status === 'todo').map((task) => task.id),
  lastReviewAt: new Date().toISOString(),
})

export const createTaskFromRequirement = (
  project: Project,
  description: string,
  _difficulty: TaskDifficulty,
  title?: string,
  agentManaged?: Task['agentManaged'],
  agentType?: Task['agentType'],
  executionModel?: Task['executionModel'],
  baseBranch?: string,
  _config?: Pick<AgentConfig, 'workspaceRoot'>,
  opencodeConfig?: Task['opencodeConfig'],
): Task => {
  const timestamp = new Date().toISOString()
  const trimmedDescription = description.trim()
  const taskTitle = title?.trim() || buildTaskTitle(description)
  const taskId = crypto.randomUUID()
  const selectedAgentType = agentType ?? pickAgent(description, _difficulty)
  const normalizedOpencodeConfig = mergeOpenCodeExecutionConfig(undefined, opencodeConfig, executionModel)

  return {
    id: taskId,
    projectId: project.id,
    parentTaskId: undefined,
    title: taskTitle,
    description: trimmedDescription,
    requirementType: 'task',
    status: 'todo',
    agentType: selectedAgentType,
    executionModel: resolveOpenCodeExecutionModel({ opencodeConfig: normalizedOpencodeConfig, executionModel }),
    opencodeConfig: normalizedOpencodeConfig,
    executionMode: 'auto',
    agentManaged: agentManaged ?? 'none',
    priority: 'none',
    retryCount: 0,
    createdAt: timestamp,
    startedAt: undefined,
    dueAt: undefined,
    updatedAt: timestamp,
    baseBranch: baseBranch?.trim() || project.defaultBranch || 'main',
    needsHumanConfirm: false,
    agentRunningStatus: 'idle',
    currentStep: '',
    executionHistory: [],
    comments: [],
    toolCalls: [],
    logs: [
      createExecutionLog('user', trimmedDescription),
      createExecutionLog('system', '协调 Agent 已接收需求，正在做需求理解与技术栈分析。'),
    ],
    history: [{ id: crypto.randomUUID(), label: '待处理', at: timestamp }],
    orchestration: createOrchestration(),
    validationChecks: createValidationChecks(),
  }
}

const updateStepsForStatus = (task: Task, nextStatus: TaskStatus): OrchestrationStep[] => {
  const doneKeys: Record<TaskStatus, OrchestrationStep['key'][]> = {
    backlog: [],
    todo: [],
    in_progress: ['understand', 'worktree', 'select_agent', 'dispatch'],
    in_review: ['understand', 'worktree', 'select_agent', 'dispatch', 'verify'],
    done: ['understand', 'worktree', 'select_agent', 'dispatch', 'verify', 'handoff'],
    blocked: [],
    cancelled: [],
  }
  const runningKey: Record<TaskStatus, OrchestrationStep['key'] | null> = {
    backlog: null,
    todo: 'understand',
    in_progress: 'verify',
    in_review: 'handoff',
    done: null,
    blocked: null,
    cancelled: null,
  }

  return task.orchestration.map((step) => ({
    ...step,
    status: doneKeys[nextStatus].includes(step.key) ? 'done' : runningKey[nextStatus] === step.key ? 'running' : 'pending',
  }))
}

const updateChecksForStatus = (task: Task, nextStatus: TaskStatus): ValidationCheck[] => {
  if (nextStatus === 'todo' || nextStatus === 'in_progress') return task.validationChecks
  if (nextStatus === 'in_review') {
    return task.validationChecks.map((check, index) => ({
      ...check,
      passed: index < 2,
    }))
  }

  return task.validationChecks.map((check) => ({ ...check, passed: true }))
}

export const startTaskAdvance = (task: Task): Task => {
  const timestamp = new Date().toISOString()

  if (task.status === 'todo') {
    return {
      ...task,
      status: 'in_progress',
      updatedAt: timestamp,
      agentRunningStatus: 'thinking',
      currentStep: '正在理解需求并准备执行环境',
      orchestration: task.orchestration.map((step) => ({
        ...step,
        status: step.key === 'understand' ? 'running' : 'pending',
      })),
    }
  }

  if (task.status === 'in_progress') {
    return {
      ...task,
      updatedAt: timestamp,
      agentRunningStatus: 'executing',
      currentStep: '正在校验变更并整理结果',
      orchestration: task.orchestration.map((step) => ({
        ...step,
        status: ['understand', 'worktree', 'select_agent', 'dispatch'].includes(step.key)
          ? 'done'
          : step.key === 'verify'
            ? 'running'
            : 'pending',
      })),
    }
  }

  return {
    ...task,
    updatedAt: timestamp,
    agentRunningStatus: 'waiting',
    currentStep: '正在等待人工确认并准备收尾',
    orchestration: task.orchestration.map((step) => ({
      ...step,
      status: step.key === 'handoff' ? 'running' : 'done',
    })),
  }
}

export const advanceTask = (task: Task, config: AgentConfig): Task => {
  const timestamp = new Date().toISOString()
  const nextStatus: TaskStatus = task.status === 'todo' ? 'in_progress' : task.status === 'in_progress' ? 'in_review' : 'done'
  const nextLogRole = nextStatus === 'in_progress' ? 'system' : nextStatus === 'done' ? 'review' : 'agent'

  const nextLog =
    nextStatus === 'in_progress'
      ? `${task.agentType} 已收到裁剪需求，正在准备执行环境。`
      : nextStatus === 'in_review'
        ? `执行 Agent 已返回结果，协调 Agent 开始验证。当前最大重试次数为 ${config.maxRetries}。`
        : '协调 Agent 已完成结果验证，任务进入人工确认阶段。'

  return {
    ...task,
    status: nextStatus,
    updatedAt: timestamp,
    needsHumanConfirm: nextStatus === 'in_review',
    logs: [...task.logs, createExecutionLog(nextLogRole, nextLog)],
    history: [...task.history, { id: crypto.randomUUID(), label: nextStatus === 'in_progress' ? '开发中' : nextStatus === 'in_review' ? '审核中' : '已完成', at: timestamp }],
    orchestration: updateStepsForStatus(task, nextStatus),
    validationChecks: updateChecksForStatus(task, nextStatus),
  }
}

export const retryTask = (task: Task): Task => {
  const timestamp = new Date().toISOString()
  return {
    ...task,
    status: 'in_progress',
    retryCount: task.retryCount + 1,
    updatedAt: timestamp,
    needsHumanConfirm: false,
    logs: [...task.logs, createExecutionLog('review', '协调 Agent 发起重试：补充失败上下文并要求执行 Agent 修复后重新提交。')],
    history: [...task.history, { id: crypto.randomUUID(), label: '开发中', at: timestamp }],
    orchestration: task.orchestration.map((step) => ({
      ...step,
      status: ['understand', 'worktree', 'select_agent', 'dispatch'].includes(step.key) ? 'done' : step.key === 'verify' ? 'running' : 'pending',
    })),
  }
}

export const cleanupTaskWorktree = (task: Task, config: AgentConfig): Task => {
  const timestamp = new Date().toISOString()
  return {
    ...task,
    updatedAt: timestamp,
    logs: [
      ...task.logs,
      createExecutionLog('system', config.autoCleanupWorktree ? '已按配置自动清理 worktree。' : '已手动触发 worktree 清理。'),
    ],
  }
}

export const buildAssistantReply = (task: Task): ChatMessage => ({
  id: crypto.randomUUID(),
  role: 'assistant',
  content: task.requirementType === 'requirement'
    ? `我已记录新需求“${task.title}”。它会先停留在 Backlog，等待进一步排期或转成可执行任务。`
    : `我已创建任务“${task.title}”。接下来请在任务详情里选择工作区、执行 Agent 和起始分支，再启动执行。`,
  createdAt: new Date().toISOString(),
})

export const refreshAdapters = (adapters: AgentAdapter[]): AgentAdapter[] =>
  adapters.map((adapter) => ({
    ...adapter,
    heartbeatAt: new Date().toISOString(),
    status: adapter.status,
  }))

export const deriveExecutionCenter = (tasks: Task[], previous?: ExecutionCenter): ExecutionCenter => ({
  activeTaskId: tasks.find((task) => task.status === 'in_progress')?.id ?? previous?.activeTaskId ?? '',
  queuedTaskIds: tasks.filter((task) => task.status === 'todo').map((task) => task.id),
  lastReviewAt: tasks.find((task) => task.status === 'in_review' || task.status === 'done')?.updatedAt ?? previous?.lastReviewAt ?? '',
})
