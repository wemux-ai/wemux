// [INPUT]: 观测请求
// [OUTPUT]: 遥测上报
// [POS]: 观测客户端
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { TaskSubagentObservation } from '@shared/subagent-role'
import { trimTrailingSlash } from './cloud-url'
import { requestJson } from './request-json'

export const recordExecutorTaskObservation = async (params: {
  cloudUrl: string
  executorToken: string
  taskId: string
  workspaceId: string
  workspaceSessionId: string
  kind: TaskSubagentObservation['kind']
  level?: TaskSubagentObservation['level']
  title: string
  detail?: string
  url?: string
  attachments?: TaskChatAttachment[]
  metadata?: Record<string, unknown>
}) => {
  return requestJson<{ ok?: boolean; message?: string }>({
    url: `${trimTrailingSlash(params.cloudUrl)}/api/control-plane/executors/observations`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.executorToken}`,
    },
    body: {
      taskId: params.taskId,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId,
      kind: params.kind,
      level: params.level,
      title: params.title,
      detail: params.detail,
      url: params.url,
      attachments: params.attachments,
      metadata: params.metadata,
    },
    errorMessage: 'Executor observation upload failed.',
  })
}

export const uploadExecutorTaskImage = async (params: {
  cloudUrl: string
  executorToken: string
  taskId: string
  filename?: string
  image: string
}) => {
  return requestJson<{ ok: boolean; executorId: string; id: string; url: string }>({
    url: `${trimTrailingSlash(params.cloudUrl)}/api/control-plane/executors/images`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.executorToken}`,
    },
    body: {
      taskId: params.taskId,
      filename: params.filename,
      image: params.image,
    },
    errorMessage: 'Executor image upload failed.',
  })
}
