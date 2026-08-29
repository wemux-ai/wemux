// [INPUT]: 子会话角色输入
// [OUTPUT]: 角色契约
// [POS]: 子会话角色类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { TaskChatAttachment } from './task-chat-attachment'
import type { Task, WorkspaceSessionRole } from './types'

export type TaskSubagentObservationKind = 'action' | 'terminal' | 'browser-console' | 'network' | 'screenshot'
export type TaskSubagentObservationLevel = 'info' | 'success' | 'warning' | 'error'

export interface TaskSubagentObservation {
  id: string
  ts: string
  kind: TaskSubagentObservationKind
  level: TaskSubagentObservationLevel
  title: string
  detail?: string
  url?: string
  attachments?: TaskChatAttachment[]
  metadata?: Record<string, unknown>
}

export type TestReportSnapshotStatus = 'running' | 'completed' | 'failed'

export interface TestReportSnapshot {
  id: string
  createdAt: string
  workspaceSessionId: string
  runId?: string
  startedAt?: string
  endedAt?: string
  goal?: string
  runStatus: TestReportSnapshotStatus
  summary: string
  passed: string[]
  failed: string[]
  blocked: string[]
  next: string[]
  observationsCount: number
  errorCount: number
  warningCount: number
  screenshotCount: number
  branchName?: string
  baseBranch?: string
  commitSha?: string
  commitShortSha?: string
  commitTitle?: string
  finalUrl?: string
  sourceObservationIds?: string[]
}

export interface SubagentEnvironmentContext {
  cwd?: string
  installCommand?: string
  startCommand?: string
  stopCommand?: string
  healthUrl?: string
  appUrl?: string
  logsCommand?: string
}

const buildRoleChecklist = (role: WorkspaceSessionRole) => {
  if (role === 'tester') {
    return [
      '先理解当前改动、任务目标和用户指定重点，再规划测试路径。',
      '以纯 AI 点击 / 页面操作为主，优先覆盖用户明确指定的模块、入口和回归路径。',
      '如果环境未启动、页面打不开或接口异常，先基于可用环境信息做自检，并记录排查过程。',
      '测试时持续关注终端日志、浏览器 console、network、页面状态和截图线索。',
      '发现问题先给复现步骤、错误现象、最可能原因，再补修复建议或复测建议。',
      '每轮测试结束都要输出测试结论：通过项、失败项、阻塞项、下一步建议。',
    ]
  }

  if (role === 'doc-writer') {
    return [
      '先理解当前改动，再整理应该同步更新的文档范围。',
      '优先补齐用户可见变化、使用方式、配置项和限制条件。',
      '输出先给结论，再给建议更新点和文档结构。',
    ]
  }

  if (role === 'reviewer') {
    return [
      '先识别改动范围和核心风险，再做针对性审查。',
      '优先关注兼容性、边界条件、错误处理和可维护性。',
      '输出要明确区分高优先级问题、一般建议和可选优化。',
    ]
  }

  if (role === 'researcher') {
    return [
      '先明确要调研或排查的问题，再给信息收集计划。',
      '输出要区分事实、推断和待验证点。',
      '结尾给出面向主会话的结论摘要和下一步建议。',
    ]
  }

  return [
    '这是一个独立子会话，优先在本会话内完成专项任务，不污染主会话上下文。',
    '先输出结论，再补必要过程和可执行建议。',
    '完成后给父会话一个可直接消费的摘要。',
  ]
}

const buildEnvironmentLines = (environment?: SubagentEnvironmentContext | null) => {
  if (!environment) {
    return ['- 当前没有附带项目环境模板，请先自行判断是否需要启动环境或读取日志。']
  }

  const lines = [
    environment.cwd ? `- 工作目录: ${environment.cwd}` : '',
    environment.installCommand ? `- 安装命令: ${environment.installCommand}` : '',
    environment.startCommand ? `- 启动命令: ${environment.startCommand}` : '',
    environment.stopCommand ? `- 停止命令: ${environment.stopCommand}` : '',
    environment.healthUrl ? `- 健康检查: ${environment.healthUrl}` : '',
    environment.appUrl ? `- 应用地址: ${environment.appUrl}` : '',
    environment.logsCommand ? `- 日志命令: ${environment.logsCommand}` : '',
  ].filter(Boolean)

  return lines.length > 0
    ? lines
    : ['- 当前没有可用环境线索，请先根据仓库上下文自行确认启动方式。']
}

export const getSubagentRolePromptPlaceholder = (role: WorkspaceSessionRole) => {
  if (role === 'tester') {
    return '例如：重点测试登录、支付和设置页；先检查环境能否启动，再用纯 AI 点击走主流程，遇到问题先看终端日志、浏览器 console 和 network。'
  }

  if (role === 'doc-writer') {
    return '例如：请根据当前改动补充 README 和发布说明，重点写清新增能力、配置方式和使用示例。'
  }

  if (role === 'reviewer') {
    return '例如：请审查当前改动的兼容性、错误处理和潜在风险，给出按优先级排序的问题列表。'
  }

  if (role === 'researcher') {
    return '例如：请调研当前报错链路和相关上下文，整理可能原因、证据和建议排查顺序。'
  }

  return '例如：请在独立子会话里处理这个专项任务，完成后给主会话一个清晰摘要。'
}

export const getSubagentRolePromptHint = (role: WorkspaceSessionRole) => {
  if (role === 'tester') {
    return '建议写清重点测试模块、入口、账号/数据前提，以及是否要优先查看日志、console、network。'
  }

  return '建议写清这次委派的目标、边界和你最关心的产出。'
}

export const buildSubagentDelegatePrompt = (params: {
  role: WorkspaceSessionRole
  task: Pick<Task, 'title' | 'description'>
  message: string
  environment?: SubagentEnvironmentContext | null
}) => {
  return [
    '你现在运行在一个独立子会话中，完成后结果会自动回抛父会话。',
    '请在这个子会话里独立规划、执行并沉淀结论，不要反过来要求主会话替你组织上下文。',
    '',
    '[子会话角色]',
    params.role,
    '',
    '[任务背景]',
    `任务标题: ${params.task.title}`,
    `任务描述: ${params.task.description || '无额外描述'}`,
    '',
    '[执行要求]',
    ...buildRoleChecklist(params.role).map((line) => `- ${line}`),
    '',
    '[环境线索]',
    ...buildEnvironmentLines(params.environment),
    '',
    '[本次委派重点]',
    params.message.trim(),
  ].join('\n')
}
