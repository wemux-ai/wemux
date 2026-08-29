// [INPUT]: 任务 worktree 状态与事件
// [OUTPUT]: worktree 观测 helper（operation event 去重/状态）
// [POS]: 任务 worktree 观测逻辑（去重/operation event）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { TaskSubagentObservation } from '@shared/subagent-role'
import { buildTaskChatSessionKey } from '@shared/task-chat-session'
import type { Project, Task, WorkspaceSession } from '@shared/types'
import { appendTaskConversationMessage } from '../control-plane/conversation-service'
import { publishTaskChatPart } from '../services/task-chat-broadcast-service'

export const buildEnvironmentObservationMessage = (params: {
  action: 'start' | 'stop' | 'logs'
  title: string
  output?: string
}) => {
  const prefix = params.action === 'logs'
    ? '测试观测 · 终端日志'
    : params.action === 'start'
      ? '测试观测 · 环境启动'
      : '测试观测 · 环境停止'

  return `${prefix}\n${params.title}${params.output ? `\n\n${params.output}` : ''}`.trim()
}

export const publishEnvironmentObservation = (params: {
  project: Project
  task: Task
  session?: WorkspaceSession | null
  workspaceId?: string
  action: 'start' | 'stop' | 'logs'
  message: string
  output?: string
  command: string
  exitCode: number
  cwd?: string
}) => {
  if (!params.session || !params.workspaceId) {
    return
  }

  const observation: TaskSubagentObservation = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    kind: 'terminal',
    level: params.exitCode === 0 ? 'success' : 'error',
    title: params.message,
    detail: params.output?.slice(0, 600),
    metadata: {
      action: params.action,
      command: params.command,
      cwd: params.cwd,
      exitCode: params.exitCode,
      sessionRole: params.session.sessionRole,
      sessionKind: params.session.sessionKind,
    },
  }
  const content = buildEnvironmentObservationMessage({
    action: params.action,
    title: params.message,
    output: params.output,
  })

  appendTaskConversationMessage({
    task: params.task,
    project: params.project,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.session.id,
    role: 'system',
    content,
    contentType: 'json',
    externalRef: { observation },
  })

  publishTaskChatPart(buildTaskChatSessionKey(params.task.id, params.workspaceId, params.session.id), {
    type: 'observation',
    data: observation,
  })
}
