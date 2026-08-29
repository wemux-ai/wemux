/**
 * [INPUT]: Quick-create HTTP payloads, persisted Agent event envelopes, and Task records.
 * [OUTPUT]: Validated quick-create contracts, event payload readers, prompts, and origin lookup helpers.
 * [POS]: Pure lifecycle contract shared by the HTTP route, MCP task creation, and Agent event runtime.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { z } from 'zod'

import {
  TASK_DESCRIPTION_MAX_LENGTH,
} from '@shared/task-input-limits'
import type { Task } from '@shared/types'
import type { AgentTask } from '../repositories/agent'

export const TASK_QUICK_CREATE_EVENT_TYPE = 'task.quick_create.requested'

const projectSelectionSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('fixed'),
    projectId: z.string().trim().min(1),
  }),
  z.object({
    mode: z.literal('agent'),
  }),
])

export const taskQuickCreateRequestSchema = z.object({
  creatorAgentId: z.string().trim().min(1),
  request: z.string().trim().min(1).max(TASK_DESCRIPTION_MAX_LENGTH),
  projectSelection: projectSelectionSchema,
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).optional().default('none'),
  status: z.enum(['backlog', 'todo']).optional().default('todo'),
  assignmentStartMode: z.enum(['now', 'parked']).optional().default('now'),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
})

export type TaskQuickCreateRequest = z.infer<typeof taskQuickCreateRequestSchema>

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
)

export const readTaskQuickCreateRequest = (task: AgentTask) => {
  if (task.type !== TASK_QUICK_CREATE_EVENT_TYPE) return null
  const envelope = asRecord(task.payload)
  const payload = asRecord(envelope.payload)
  const result = taskQuickCreateRequestSchema.safeParse(payload.quickCreate)
  return result.success ? result.data : null
}

export const resolveTaskQuickCreateOriginId = (task: AgentTask) => {
  const persistedOriginId = typeof task.payload.quickCreateOriginId === 'string'
    ? task.payload.quickCreateOriginId.trim()
    : ''
  return persistedOriginId || task.id
}

export const findQuickCreatedTask = (tasks: Task[], originId: string) => (
  tasks.find((task) => task.originType === 'agent_quick_create' && task.originId === originId) ?? null
)

export const buildTaskQuickCreatePrompt = (params: {
  eventId: string
  agentId: string
  request: TaskQuickCreateRequest
  authorizedProjects: Array<{ id: string; name: string }>
}) => {
  const fixedProjectId = params.request.projectSelection.mode === 'fixed'
    ? params.request.projectSelection.projectId
    : undefined
  const fixedProject = params.request.projectSelection.mode === 'fixed'
    ? params.authorizedProjects.find((project) => project.id === fixedProjectId)
    : undefined
  return [
    '[Agent Quick Create]',
    `creationRunId: ${params.eventId}`,
    `creatorAgentId: ${params.agentId}`,
    `projectSelection: ${JSON.stringify(params.request.projectSelection)}`,
    `authorizedProjects: ${JSON.stringify(params.authorizedProjects)}`,
    `request: ${params.request.request}`,
    '',
    '本轮只负责把用户请求整理成且仅创建一个 Task。不要创建 Workspace，不要调用 task.execute，不要执行代码或 Git 操作。',
    '必须调用一次 task.create，并把 creationRunId 原样传入。任务创建成功后立即结束本轮。',
    fixedProject
      ? `项目已经由用户固定为 ${fixedProject.name} (${fixedProject.id})，不得改到其他项目。`
      : '项目由你选择。先用 project.list，必要时用 project.get，在 authorizedProjects 中选择最匹配的一个项目，再把它的 projectId 传给 task.create。',
    '标题和描述应忠实整理用户原意；不要虚构验收条件、技术方案或用户没有提出的要求。',
    `priority 必须使用 ${params.request.priority}，status 必须使用 ${params.request.status}。`,
    `默认负责人是当前创建 Agent ${params.agentId}，task.create 会由服务端强制校验并写入。`,
  ].join('\n')
}
