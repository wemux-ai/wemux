// [INPUT]: 任务观测事件
// [OUTPUT]: 状态更新
// [POS]: 任务观测服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { buildTaskChatSessionKey } from '@shared/task-chat-session'
import type { TaskSubagentObservation } from '@shared/subagent-role'
import type { Project, Task } from '@shared/types'
import { appendTaskConversationMessage } from '../control-plane/conversation-service'
import { publishTaskChatPart } from './task-chat-broadcast-service'

const getObservationKindLabel = (kind: TaskSubagentObservation['kind']) => {
  if (kind === 'action') return '页面动作'
  if (kind === 'terminal') return '终端日志'
  if (kind === 'browser-console') return '浏览器 Console'
  if (kind === 'network') return '网络请求'
  return '页面截图'
}

const getObservationLevelLabel = (level: TaskSubagentObservation['level']) => {
  if (level === 'error') return '错误'
  if (level === 'warning') return '警告'
  if (level === 'success') return '成功'
  return '信息'
}

export const buildObservationConversationContent = (observation: TaskSubagentObservation) => {
  const attachmentLines = (observation.attachments ?? []).map((attachment) => {
    const isImage = attachment.contentType?.startsWith('image/')
    return isImage
      ? `![${attachment.filename}](${attachment.url})`
      : `- [${attachment.filename}](${attachment.url})`
  })

  return [
    `**测试观测** · ${getObservationKindLabel(observation.kind)} · ${getObservationLevelLabel(observation.level)}`,
    '',
    `**标题**: ${observation.title}`,
    observation.url ? `**链接**: ${observation.url}` : '',
    observation.detail ? `**详情**:\n${observation.detail}` : '',
    attachmentLines.length > 0 ? `**附件**:\n${attachmentLines.join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

export const recordTaskObservation = (params: {
  task: Task
  project: Project
  workspaceId?: string
  workspaceSessionId?: string
  observation: TaskSubagentObservation
}) => {
  appendTaskConversationMessage({
    task: params.task,
    project: params.project,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
    role: 'system',
    content: buildObservationConversationContent(params.observation),
    contentType: 'json',
    externalRef: { observation: params.observation },
  })

  if (!params.workspaceId || !params.workspaceSessionId) {
    return
  }

  publishTaskChatPart(buildTaskChatSessionKey(params.task.id, params.workspaceId, params.workspaceSessionId), {
    type: 'observation',
    data: params.observation,
  })
}
