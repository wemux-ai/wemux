// [INPUT]: Authenticated task MCP requests, scoped state, and workspace execution services.
// [OUTPUT]: Creator-attributed task lifecycle with execution, polling, cancellation, and result tools.
// [POS]: MCP task adapter; execution validates the selected worker Agent/model before queueing.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { z } from 'zod'
import { VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS } from '@shared/mcp'
import { normalizeTaskChatAttachments } from '@shared/task-chat-attachment'
import { createTaskFromRequirement, deriveExecutionCenter, retryTask } from '@shared/task-orchestrator'
import {
  TASK_ACCEPTANCE_CRITERIA_MAX_LENGTH,
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_HANDOFF_PROMPT_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from '@shared/task-input-limits'
import type { Project, Task, TaskRun } from '@shared/types'
import { chooseExecutorNode } from '../../cluster/scheduler'
import {
  listTaskCustomFieldValuesByKey,
  listTaskFieldDefinitions,
  resolveTaskFieldIdsByKey,
  upsertTaskCustomFieldValues,
} from '../../repositories/task-field-store'
import { canUserUseExecutorForProject } from '../../control-plane/collaboration'
import { getConversationDetail } from '../../control-plane/conversation-service'
import { recordTaskStatusChange } from '../../control-plane/governance-service'
import { removeTaskChatQueueEntry } from '../../control-plane/task-chat-service'
import { chooseControlPlaneExecutorForTask } from '../../control-plane/scheduler'
import { reconcileControlPlaneTaskQueue, requestExecutorTaskCancellation } from '../../control-plane/task-dispatch'
import { getAgentTask, getUserAgents } from '../../repositories/agent'
import { getUserById, isProjectAccessible } from '../../repositories/auth'
import { resetDistributedTask } from '../../routes/shared'
import { executeTaskOnWorkspace } from '../../services/task-execution-service'
import { markTaskChatRuntimeStopped, stopTaskChatExecutionAcrossNodes } from '../../services/task-chat-dispatch/runtime-state'
import { resolveTaskAgentAssignment } from '../../services/task-agent-assignment-service'
import type { TaskAssignmentStartMode } from '../../services/task-assignment-policy'
import { recordTaskAssignmentHistory } from '../../services/task-assignment-history-service'
import {
  deliverHumanTaskAssignment,
  deliverTaskAssignment,
  resolveTaskAssignmentActor,
} from '../../services/task-assignment-delivery-service'
import { createTaskRecord, findTaskByOrigin } from '../../services/task-creation-service'
import {
  readTaskQuickCreateRequest,
  resolveTaskQuickCreateOriginId,
} from '../../services/task-quick-create-service'
import { deleteTask, listTaskRuns, saveStateMeta, saveTask, saveTaskAndWait, saveTaskRun } from '../../storage/app-state-store'
import { getDistributedTask } from '../../storage/distributed-task-store'
import { updateAgentTaskRun } from '../../storage/postgres/agent-task-run-store'
import { findRunningAgentEventId } from '../../services/agent-event-runtime'
import { SERVER_AGENT_TYPES } from '../../services/server-agent'
import { ErrorCode, McpError, type McpServer } from './sdk'
import {
  requireProject,
  requireProjectForMcpActor,
  requireTask,
  resolveMcpCreatorIdentity,
  summarizeConversation,
  summarizeProject,
  summarizeTask,
  summarizeTaskRun,
  toToolResult,
  type VibemuxMcpContext,
} from './vibemux-mcp-context'

const taskListStatusSchema = z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled'])
const serverAgentTypeSchema = z.enum(SERVER_AGENT_TYPES)

/** 任务级附件（对齐 TaskChatAttachment；kind 缺省为 file）。 */
const taskAttachmentSchema = z.object({
  id: z.string().min(1).describe('附件唯一标识'),
  url: z.string().min(1).describe('附件访问地址'),
  filename: z.string().min(1).describe('文件名'),
  contentType: z.string().trim().optional().describe('MIME 类型，可选'),
  kind: z.enum(['file', 'drive']).optional().describe('file=上传副本（默认）；drive=Drive 文件引用'),
  driveFileId: z.string().trim().optional().describe('kind=drive 时的 Drive 文件记录 id'),
  driveWorkspaceId: z.string().trim().nullable().optional().describe('kind=drive 时的归属组织；null=个人文件'),
})

/** 任务自定义字段条目（key 为字段定义稳定 key，value 类型取决于字段 type）。 */
const taskCustomFieldEntrySchema = z.object({
  key: z.string().trim().min(1).describe('项目自定义字段定义的 key（工时= duration 类、标签= select/multi_select 类等）'),
  value: z.unknown().describe('字段值，类型取决于字段 type：text/url 传字符串，number/duration 传数字，select 传选项 value 字符串，multi_select 传字符串数组，date 传 ISO 日期字符串，user 传用户 id 字符串，checkbox 传布尔值'),
})

const taskUpdateSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().trim().min(1).max(TASK_TITLE_MAX_LENGTH).optional(),
  description: z.string().trim().min(1).max(TASK_DESCRIPTION_MAX_LENGTH).optional(),
  acceptanceCriteria: z.string().trim().max(TASK_ACCEPTANCE_CRITERIA_MAX_LENGTH).nullable().optional(),
  assigneeId: z.string().trim().nullable().optional(),
  assigneeAgentId: z.string().trim().nullable().optional(),
  agentManaged: z.enum(['ai', 'none']).optional(),
  customFields: z.array(taskCustomFieldEntrySchema).optional().describe('自定义字段值，按 key 写入（如工时、标签）；不传则不修改'),
  attachments: z.array(taskAttachmentSchema).optional().describe('任务级附件；传入则整体替换'),
  completedAt: z.string().trim().optional().describe('完成时间（ISO 时间戳），通常由状态流转到 done 时写入'),
}).refine((value) => {
  return value.title !== undefined
    || value.description !== undefined
    || value.acceptanceCriteria !== undefined
    || value.assigneeId !== undefined
    || value.assigneeAgentId !== undefined
    || value.agentManaged !== undefined
    || value.customFields !== undefined
    || value.attachments !== undefined
    || value.completedAt !== undefined
}, {
  message: '至少提供一个可更新字段。',
})

const taskExecuteSchema = z.object({
  taskId: z.string().min(1),
  workspaceId: z.string().min(1),
  baseBranch: z.string().trim().optional(),
  returnMode: z.enum(['summary', 'branch', 'commit']).optional(),
  syncBackStrategy: z.enum(['none', 'pull-branch']).optional(),
  gitIdentityMode: z.enum(['personal']).optional(),
  workspaceSessionId: z.string().trim().optional(),
  createNewSession: z.boolean().optional(),
  delegatedPrompt: z.string().trim().min(1).max(TASK_DESCRIPTION_MAX_LENGTH).optional()
    .describe('可选。由当前 Agent 自行撰写并发送给 Coding Agent 的执行指令；省略时才使用任务描述。'),
  agentType: serverAgentTypeSchema.optional().describe('可选，覆盖任务当前的 Coding Agent'),
  executionModel: z.string().trim().optional().describe('可选，覆盖任务当前模型；必须是该执行节点已发现的 Coding 模型'),
})

const taskRunsSchema = z.object({
  taskId: z.string().min(1),
})

const taskExecutionSchema = z.object({
  taskId: z.string().min(1),
  taskRunId: z.string().trim().optional(),
})

const taskAssignSchema = z.object({
  taskId: z.string().min(1).describe('任务 ID'),
  assigneeAgentId: z.string().trim().min(1).describe('负责并执行该任务的 Agent ID；用 agent.list 获取候选'),
  handoffPrompt: z.string().trim().max(TASK_HANDOFF_PROMPT_MAX_LENGTH).optional()
    .describe('可选，给负责 Agent 的补充执行指令；只在 startMode="now" 时随指派事件下发'),
  startMode: z.enum(['now', 'parked']).optional().default('now')
    .describe('now：指派并立即启动负责 Agent；parked：只登记负责人，不启动'),
})

const getLatestTaskRun = (taskId: string) => listTaskRuns(taskId)[0] ?? null

const listAssignableAgents = (userId: string, runtimeAgentId?: string) => (
  getUserAgents(userId)
    .filter((agent) => agent.type.trim().toLowerCase() !== 'main')
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      type: agent.type,
      isSelf: Boolean(runtimeAgentId && agent.id === runtimeAgentId),
    }))
)

/**
 * 任务负责人就是执行者：一次指派最多派发一次 task.assigned。未指派时返回候选 Agent，
 * 让调用方先问用户指派给谁，而不是自己接单执行。
 */
/** 判定与投递都在 deliverTaskAssignment 里；这里只把结果翻译成 MCP 返回值。 */
const applyTaskAssignment = async (params: {
  ctx: VibemuxMcpContext
  task: Task
  previousAssigneeAgentId?: string
  /** 换 Squad 但 leader 不变时也算指派变化，所以前任的 group 也要传。 */
  previousAssigneeAgentGroupId?: string
  startMode: TaskAssignmentStartMode
  handoffPrompt?: string
  assigneeAgentGroupTitle?: string
}) => {
  const { ctx, task } = params
  const result = await deliverTaskAssignment({
    task,
    actor: resolveTaskAssignmentActor({ userId: ctx.userId, runtimeAgentId: ctx.runtimeAgentId }),
    startMode: params.startMode,
    previousAssigneeAgentGroupId: params.previousAssigneeAgentGroupId,
    previousAssigneeAgentId: params.previousAssigneeAgentId,
    runtimeAgentId: ctx.runtimeAgentId,
    actingUserId: ctx.userId,
    handoffPrompt: params.handoffPrompt,
    assigneeAgentGroupTitle: params.assigneeAgentGroupTitle,
  })
  const { decision } = result

  if (result.notReadyMessage) {
    return {
      assignment: {
        assigneeAgentId: task.assigneeAgentId,
        assignmentRequired: false,
        dispatched: false,
        selfAssigned: false,
        reason: 'not_ready' as const,
        message: `负责人已记录，但暂时无法启动：${result.notReadyMessage}`,
      },
    }
  }

  // 判定要派发但去重命中：不能沿用「已加入执行队列」那句，否则调用方会以为排上了。
  const deduplicated = decision.dispatch && !result.dispatched
  return {
    assignment: {
      assigneeAgentId: task.assigneeAgentId,
      assignmentRequired: decision.reason === 'unassigned',
      dispatched: result.dispatched,
      selfAssigned: decision.selfAssigned,
      reason: deduplicated ? ('deduplicated' as const) : decision.reason,
      message: deduplicated
        ? '这次指派与已在队列中的一次完全相同，没有重复排队；等那次执行结果即可。'
        : decision.message,
      ...(decision.reason === 'unassigned'
        ? { assignableAgents: listAssignableAgents(ctx.userId, ctx.runtimeAgentId) }
        : {}),
    },
  }
}

const resolveTaskRun = (taskId: string, taskRunId?: string) => {
  const runs = listTaskRuns(taskId)
  if (runs.length === 0) {
    throw new McpError(ErrorCode.InvalidParams, '任务还没有执行记录。')
  }

  if (!taskRunId) {
    return runs[0]
  }

  const taskRun = runs.find((item) => item.id === taskRunId)
  if (!taskRun) {
    throw new McpError(ErrorCode.InvalidParams, '执行记录不存在。')
  }

  return taskRun
}

const buildTaskExecutionPayload = (task: Task, taskRun: TaskRun) => ({
  run: summarizeTaskRun(taskRun),
  distributedTask: taskRun.distributedTaskId ? getDistributedTask(taskRun.distributedTaskId) : null,
  latestTaskState: summarizeTask(task),
})

/** 解析并写入任务自定义字段（key → fieldId），返回写后的 key→value 全量值。 */
const writeTaskCustomFields = async (
  taskId: string,
  projectId: string,
  entries: Array<{ key: string; value?: unknown }>,
): Promise<Record<string, unknown>> => {
  const definitions = await listTaskFieldDefinitions(projectId)
  const { fieldIdByKey, unknownKeys } = resolveTaskFieldIdsByKey(
    definitions,
    entries.map((entry) => entry.key),
  )
  if (unknownKeys.length > 0) {
    const available = definitions.map((field) => field.key).join('、') || '(无)'
    throw new McpError(
      ErrorCode.InvalidParams,
      `未知的任务自定义字段 key：${unknownKeys.join('、')}。当前项目可用 key：${available}。`,
    )
  }
  const values: Record<string, unknown> = {}
  for (const entry of entries) {
    values[fieldIdByKey[entry.key]] = entry.value === undefined ? null : entry.value
  }
  await upsertTaskCustomFieldValues({ taskId, values })
  return listTaskCustomFieldValuesByKey(taskId, projectId)
}

export const registerVibemuxMcpTaskTools = (server: McpServer, ctx: VibemuxMcpContext) => {
  server.registerTool('task.list', {
    title: 'Task List',
    description: '按项目或状态筛选任务列表',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      projectId: z.string().optional().describe('可选，项目 ID'),
      status: taskListStatusSchema.optional().describe('可选，任务状态'),
    },
  }, async ({ projectId, status }) => {
    const state = ctx.getState()
    const tasks = state.tasks
      .filter((task) => !projectId || task.projectId === projectId)
      .filter((task) => !status || task.status === status)
    return toToolResult({
      total: tasks.length,
      tasks: tasks.map((task) => summarizeTask(task, state.projects.find((project) => project.id === task.projectId))),
    })
  })

  server.registerTool('task.get', {
    title: 'Task Detail',
    description: '读取单个任务的详情和关联上下文',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      taskId: z.string().min(1).describe('任务 ID'),
    },
  }, async ({ taskId }) => {
    const state = ctx.getState()
    const conversations = ctx.getConversations()
    const task = requireTask(state, taskId)
    const project = requireProject(state, task.projectId)
    const taskConversation = conversations.find((item) => item.conversation.taskId === task.id)
    const customFields = await listTaskCustomFieldValuesByKey(task.id, project.id)
    return toToolResult({
      task: summarizeTask(task, project),
      customFields,
      project: summarizeProject(project, state.tasks.filter((item) => item.projectId === project.id)),
      latestRun: getLatestTaskRun(task.id),
      conversation: taskConversation ? summarizeConversation(taskConversation) : null,
    })
  })

  server.registerTool('task.create', {
    title: 'Create Task',
    description: '创建任务。除非用户已明确指定负责 Agent，否则任务保持未指派，必须先问用户指派给谁，不要自己接单执行。',
    inputSchema: {
      projectId: z.string().min(1).describe('项目 ID'),
      description: z.string().min(1).describe('任务描述'),
      title: z.string().optional().describe('任务标题'),
      priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).optional().describe('任务优先级'),
      status: z.enum(['backlog', 'todo']).optional().describe('初始状态'),
      acceptanceCriteria: z.string().trim().max(TASK_ACCEPTANCE_CRITERIA_MAX_LENGTH).optional().describe('验收标准'),
      assigneeAgentId: z.string().trim().min(1).optional()
        .describe('负责并执行该任务的 Agent ID。只在用户已经明确指定执行者时传；不确定时省略，先用 agent.list 给候选并询问用户'),
      handoffPrompt: z.string().trim().max(TASK_HANDOFF_PROMPT_MAX_LENGTH).optional()
        .describe('可选，给负责 Agent 的补充执行指令；只在实际启动时下发'),
      assignmentStartMode: z.enum(['now', 'parked']).optional().default('now')
        .describe('now：指派后立即启动负责 Agent；parked：只登记负责人，不启动'),
      agentManaged: z.enum(['ai', 'none']).optional().describe('是否 AI 托管'),
      agentType: serverAgentTypeSchema.optional().describe('可选，指定 Coding Agent'),
      executionModel: z.string().trim().optional().describe('可选，指定该 Agent 的模型'),
      creationRunId: z.string().trim().optional().describe('仅用于 Agent quick-create，必须传事件中的 creationRunId'),
      customFields: z.array(taskCustomFieldEntrySchema).optional().describe('自定义字段值，按 key 写入（如工时、标签）'),
      attachments: z.array(taskAttachmentSchema).optional().describe('任务级附件'),
      completedAt: z.string().trim().optional().describe('完成时间（ISO 时间戳），新建任务通常不传'),
    },
  }, async ({
    projectId,
    description,
    title,
    priority,
    status,
    acceptanceCriteria,
    assigneeAgentId,
    handoffPrompt,
    assignmentStartMode,
    agentManaged,
    agentType,
    executionModel,
    creationRunId,
    customFields,
    attachments,
    completedAt,
  }) => {
    const state = ctx.getState()
    const quickCreateEvent = creationRunId ? getAgentTask(creationRunId) : null
    const quickCreateRequest = quickCreateEvent ? readTaskQuickCreateRequest(quickCreateEvent) : null
    if (creationRunId) {
      if (
        !quickCreateEvent
        || !quickCreateRequest
        || quickCreateEvent.status !== 'running'
        || !ctx.runtimeAgentId
        || quickCreateEvent.agentId !== ctx.runtimeAgentId
        || quickCreateEvent.payload.actingUserId !== ctx.userId
      ) {
        throw new McpError(ErrorCode.InvalidParams, 'creationRunId 不是当前 Agent 正在处理的 quick-create 事件。')
      }
      if (
        quickCreateRequest.projectSelection.mode === 'fixed'
        && quickCreateRequest.projectSelection.projectId !== projectId
      ) {
        throw new McpError(ErrorCode.InvalidParams, '该 quick-create 请求已经固定项目，不能改到其他项目。')
      }
    }

    const project = requireProjectForMcpActor(ctx, state, projectId)
    const creator = resolveMcpCreatorIdentity(ctx)
    const quickCreateOriginId = quickCreateEvent
      ? resolveTaskQuickCreateOriginId(quickCreateEvent)
      : undefined
    const existingTask = quickCreateOriginId
      ? findTaskByOrigin(state.tasks, 'agent_quick_create', quickCreateOriginId)
      : null
    if (existingTask) {
      updateAgentTaskRun(creationRunId!, {
        taskId: existingTask.id,
        projectId: existingTask.projectId,
      })
      return toToolResult({
        ok: true,
        idempotent: true,
        task: summarizeTask(existingTask, state.projects.find((item) => item.id === existingTask.projectId)),
      })
    }

    // quick-create 由用户在界面上选定创建 Agent，负责人强制为它自己；其余情况由调用方显式指派。
    const requestedAssigneeAgentId = quickCreateEvent ? ctx.runtimeAgentId : assigneeAgentId?.trim() || undefined
    const assignment = resolveTaskAgentAssignment({
      project,
      userId: ctx.userId,
      assigneeAgentId: requestedAssigneeAgentId,
    })
    if (!assignment.ok) {
      throw new McpError(ErrorCode.InvalidParams, assignment.message)
    }
    const task = createTaskRecord({
      project,
      config: state.config,
      actingUserId: ctx.userId,
      creator,
      description,
      title,
      priority: quickCreateRequest?.priority ?? priority,
      status: quickCreateRequest?.status ?? status,
      acceptanceCriteria,
      assigneeAgentId: assignment.agentId,
      agentManaged,
      agentType,
      executionModel,
      originType: quickCreateEvent ? 'agent_quick_create' : undefined,
      originId: quickCreateOriginId,
    })
    if (attachments !== undefined) {
      task.attachments = normalizeTaskChatAttachments(attachments)
    }
    if (completedAt !== undefined) {
      task.completedAt = completedAt.trim() || undefined
    }
    if (quickCreateEvent) {
      task.id = `quick-task:${quickCreateOriginId}`
      task.currentStep = task.status === 'backlog'
        ? '任务已由 Agent 创建并加入 Backlog。'
        : '任务已由 Agent 创建，等待创建流程结束后派发。'
    } else if (!assignment.agentId && task.status !== 'backlog') {
      task.currentStep = '任务已创建，等待指派负责 Agent。'
    }
    await saveTaskAndWait(task)
    if (quickCreateEvent) {
      updateAgentTaskRun(creationRunId!, {
        taskId: task.id,
        projectId: task.projectId,
      })
    }
    const taskCustomFields = customFields !== undefined && customFields.length > 0
      ? await writeTaskCustomFields(task.id, project.id, customFields)
      : {}
    saveStateMeta({
      ...state,
      selectedProjectId: project.id,
      selectedTaskId: task.id,
      executionCenter: deriveExecutionCenter([task, ...state.tasks], state.executionCenter),
    })
    // quick-create 的派发由 Agent event runtime 在创建流程结束后统一处理。
    const assignmentResult = quickCreateEvent
      ? null
      : await applyTaskAssignment({
          ctx,
          task,
          startMode: assignmentStartMode,
          handoffPrompt,
          assigneeAgentGroupTitle: assignment.agentGroupTitle,
        })
    return toToolResult({
      ok: true,
      task: summarizeTask(task, project),
      customFields: taskCustomFields,
      ...(assignmentResult ?? {}),
    })
  })

  server.registerTool('task.assign', {
    title: 'Assign Task',
    description: '把任务指派给唯一的负责 Agent。startMode="now" 时指派即启动该 Agent 执行，可带 handoffPrompt 补充执行指令。',
    inputSchema: taskAssignSchema,
  }, async ({ taskId, assigneeAgentId, handoffPrompt, startMode }) => {
    const state = ctx.getState()
    const task = requireTask(state, taskId)
    const project = requireProject(state, task.projectId)
    const assignment = resolveTaskAgentAssignment({
      project,
      userId: ctx.userId,
      assigneeAgentId,
    })
    if (!assignment.ok) throw new McpError(ErrorCode.InvalidParams, assignment.message)

    const previousAssigneeAgentId = task.assigneeAgentId
    const updatedAt = new Date().toISOString()
    const nextTask = recordTaskAssignmentHistory({
      task: {
        ...task,
        assigneeId: undefined,
        assigneeAgentId: assignment.agentId,
        assigneeAgentGroupId: undefined,
        updatedAt,
      },
      actorUserId: ctx.userId,
      assigneeId: undefined,
      assigneeAgentId: assignment.agentId,
      at: updatedAt,
    })
    saveTask(nextTask)

    const assignmentResult = await applyTaskAssignment({
      ctx,
      task: nextTask,
      previousAssigneeAgentId,
      // task.assign 会把 group 清成 undefined：原来属于某个 Squad 就是一次真实变化。
      previousAssigneeAgentGroupId: task.assigneeAgentGroupId,
      startMode,
      handoffPrompt,
      assigneeAgentGroupTitle: assignment.agentGroupTitle,
    })
    return toToolResult({
      ok: true,
      task: summarizeTask(nextTask, project),
      ...assignmentResult,
    })
  })

  server.registerTool('task.update', {
    title: 'Update Task',
    description: '更新任务内容、负责人或托管方式',
    inputSchema: taskUpdateSchema,
  }, async (input) => {
    const state = ctx.getState()
    const task = requireTask(state, input.taskId)
    const project = requireProject(state, task.projectId)
    const assignmentChanged = input.assigneeId !== undefined
      || input.assigneeAgentId !== undefined
    const requestedAssigneeId = input.assigneeId?.trim() || undefined
    const requestedAssigneeAgentId = input.assigneeAgentId?.trim() || undefined
    if (requestedAssigneeId && requestedAssigneeAgentId) {
      throw new McpError(ErrorCode.InvalidParams, '人类与 Agent 负责人只能设置一个。')
    }
    const agentAssignment = assignmentChanged
      ? resolveTaskAgentAssignment({
          project,
          userId: ctx.userId,
          assigneeAgentId: requestedAssigneeAgentId,
        })
      : { ok: true as const, agentId: task.assigneeAgentId, agentGroupId: task.assigneeAgentGroupId, agentGroupTitle: undefined }
    if (!agentAssignment.ok) throw new McpError(ErrorCode.InvalidParams, agentAssignment.message)
    const nextAssigneeAgentId = agentAssignment.agentId
    const nextAssigneeAgentGroupId = assignmentChanged ? undefined : task.assigneeAgentGroupId
    const nextAssigneeId = assignmentChanged ? requestedAssigneeId : task.assigneeId
    if (nextAssigneeId) {
      const assignee = getUserById(nextAssigneeId)
      if (!assignee) {
        throw new McpError(ErrorCode.InvalidParams, '负责人不存在。')
      }
      if (!isProjectAccessible(nextAssigneeId, project.id)) {
        throw new McpError(ErrorCode.InvalidParams, '该负责人当前无权访问此项目。')
      }
    }
    const updatedAt = new Date().toISOString()
    const assigneeChanged = nextAssigneeId !== task.assigneeId
      || nextAssigneeAgentId !== task.assigneeAgentId
      || nextAssigneeAgentGroupId !== task.assigneeAgentGroupId
    const updatedTask: Task = {
      ...task,
      title: input.title?.trim() || task.title,
      description: input.description?.trim() || task.description,
      acceptanceCriteria: input.acceptanceCriteria !== undefined ? input.acceptanceCriteria?.trim() || undefined : task.acceptanceCriteria,
      assigneeId: nextAssigneeId,
      assigneeAgentId: nextAssigneeAgentId,
      assigneeAgentGroupId: nextAssigneeAgentGroupId,
      agentManaged: input.agentManaged ?? task.agentManaged,
      attachments: input.attachments !== undefined ? normalizeTaskChatAttachments(input.attachments) : task.attachments,
      completedAt: input.completedAt !== undefined ? input.completedAt.trim() || undefined : task.completedAt,
      updatedAt,
    }
    const nextTask = assigneeChanged
      ? recordTaskAssignmentHistory({
          task: updatedTask,
          actorUserId: ctx.userId,
          assigneeId: nextAssigneeId,
          assigneeAgentId: nextAssigneeAgentId,
          at: updatedAt,
        })
      : updatedTask
    // 指派给人：Agent 侧走 applyTaskAssignment 的事件队列，人只有 deliverHumanTaskAssignment 这一条。
    const assignmentDelivery = nextAssigneeId && nextAssigneeId !== task.assigneeId
      ? await deliverHumanTaskAssignment({
          task: nextTask,
          assigneeUserId: nextAssigneeId,
          actor: resolveTaskAssignmentActor({ userId: ctx.userId, runtimeAgentId: ctx.runtimeAgentId }),
          at: updatedAt,
        })
      : null
    const persistedTask = assignmentDelivery?.task ?? nextTask
    saveTask(persistedTask)
    const taskCustomFields = input.customFields !== undefined
      ? await writeTaskCustomFields(persistedTask.id, project.id, input.customFields)
      : await listTaskCustomFieldValuesByKey(persistedTask.id, project.id)
    const assignmentResult = assignmentChanged && !nextAssigneeId
      ? await applyTaskAssignment({
          ctx,
          task: persistedTask,
          previousAssigneeAgentId: task.assigneeAgentId,
          previousAssigneeAgentGroupId: task.assigneeAgentGroupId,
          startMode: 'now',
          assigneeAgentGroupTitle: agentAssignment.agentGroupTitle,
        })
      : null
    return toToolResult({
      ok: true,
      task: summarizeTask(persistedTask, project),
      customFields: taskCustomFields,
      ...(assignmentResult ?? {}),
      ...(assignmentDelivery
        ? { assigneeNotified: assignmentDelivery.delivered }
        : {}),
    })
  })

  server.registerTool('task.update_status', {
    title: 'Update Task Status',
    description: '更新任务状态',
    inputSchema: {
      taskId: z.string().min(1).describe('任务 ID'),
      status: taskListStatusSchema.describe('目标状态'),
    },
  }, async ({ taskId, status }) => {
    const state = ctx.getState()
    const task = requireTask(state, taskId)
    const previousStatus = task.status
    const nextTask = { ...task, status, updatedAt: new Date().toISOString() } satisfies Task
    saveTask(nextTask)
    const project = state.projects.find((item) => item.id === nextTask.projectId)
    // 统一状态变更审计 + 调度大脑上报（feature P0-2：MCP 入口不再漏事件）
    if (project && previousStatus !== status) {
      recordTaskStatusChange({
        task: nextTask,
        project,
        fromStatus: previousStatus,
        toStatus: status,
        actorUserId: ctx.userId,
      })
    }
    return toToolResult({ ok: true, task: summarizeTask(nextTask, project) })
  })

  server.registerTool('task.delete', {
    title: 'Delete Task',
    description: '删除任务',
    inputSchema: {
      taskId: z.string().min(1).describe('任务 ID'),
    },
  }, async ({ taskId }) => {
    const task = requireTask(ctx.getState(), taskId)
    deleteTask(task.id)
    return toToolResult({ ok: true, taskId: task.id, title: task.title })
  })

  server.registerTool('task.retry', {
    title: 'Retry Task',
    description: '重置任务到可再次处理状态',
    inputSchema: {
      taskId: z.string().min(1).describe('任务 ID'),
    },
  }, async ({ taskId }) => {
    const state = ctx.getState()
    const task = requireTask(state, taskId)
    const previousStatus = task.status
    const nextTask = retryTask(task)
    saveTask(nextTask)
    const project = state.projects.find((item) => item.id === nextTask.projectId)
    if (project && previousStatus !== nextTask.status) {
      recordTaskStatusChange({
        task: nextTask,
        project,
        fromStatus: previousStatus,
        toStatus: nextTask.status,
        actorUserId: ctx.userId,
      })
    }
    return toToolResult({ ok: true, task: summarizeTask(nextTask, project) })
  })

  server.registerTool('task.execute', {
    title: 'Execute Task',
    description: '像用户在工作区中发送消息一样，在指定工作区会话启动一次执行。当前 Agent 可用 delegatedPrompt 自行决定发送给 Coding Agent 的执行指令；过程、工具调用和最终输出进入同一会话历史。',
    inputSchema: taskExecuteSchema,
  }, async (input) => {
    const state = ctx.getState()
    const task = requireTask(state, input.taskId)
    const project = requireProject(state, task.projectId)
    const sourceAgentEventId = ctx.runtimeAgentId
      ? findRunningAgentEventId(ctx.runtimeAgentId, task.id)
      : undefined
    const messageAuthor = resolveMcpCreatorIdentity(ctx)
    const result = await executeTaskOnWorkspace({
      state,
      userId: ctx.userId,
      requestedByAgentId: ctx.runtimeAgentId,
      sourceAgentEventId,
      messageAuthor,
      task,
      project,
      workspaceId: input.workspaceId,
      workspaceSessionId: input.workspaceSessionId,
      createNewSession: input.createNewSession,
      delegatedPrompt: input.delegatedPrompt,
      baseBranch: input.baseBranch,
      returnMode: input.returnMode,
      syncBackStrategy: input.syncBackStrategy,
      gitIdentityMode: input.gitIdentityMode,
      agentType: input.agentType,
      executionModel: input.executionModel,
    })
    if (!result.ok) {
      throw new McpError(ErrorCode.InvalidParams, result.message)
    }

    saveStateMeta({
      ...state,
      selectedProjectId: result.project.id,
      selectedTaskId: result.task.id,
    })
    return toToolResult({
      ok: true,
      message: result.message,
      task: summarizeTask(result.task, result.project),
      workspace: result.workspace,
      workspaceSession: {
        id: result.session.id,
        workspaceId: result.session.workspaceId,
        title: result.session.title,
        status: result.session.status,
        sessionKind: result.session.sessionKind,
        sessionRole: result.session.sessionRole,
        agentType: result.session.agentType,
        customAgentId: result.session.customAgentId,
        executionModel: result.session.executionModel,
        runtimeStatus: result.session.runtimeStatus,
        runtimeSequence: result.session.runtimeSequence,
        currentStep: result.session.currentStep,
      },
      run: summarizeTaskRun(result.taskRun),
      distributedTask: null,
      queueEntry: {
        id: result.queueEntry.id,
        sessionKey: result.queueEntry.sessionKey,
        createdAt: result.queueEntry.createdAt,
      },
      attention: ctx.runtimeAgentId
        ? {
            requestedByAgentId: ctx.runtimeAgentId,
            sourceAgentEventId,
            waitFor: {
              eventTypes: [
                'workspace.session.completed',
                'workspace.session.waiting',
                'workspace.session.failed',
              ],
              match: {
                taskId: result.task.id,
                workspaceId: result.workspace.id,
                workspaceSessionId: result.session.id,
                taskRunId: result.taskRun.id,
              },
            },
          }
        : null,
    })
  })

  server.registerTool('task.runs', {
    title: 'Task Runs',
    description: '读取任务的执行记录',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: taskRunsSchema,
  }, async ({ taskId }) => {
    requireTask(ctx.getState(), taskId)
    return toToolResult({
      taskId,
      runs: listTaskRuns(taskId).map(summarizeTaskRun),
    })
  })

  server.registerTool('task.execution.get', {
    title: 'Task Execution Detail',
    description: '读取某个任务最近一次或指定一次执行的详细状态',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: taskExecutionSchema,
  }, async ({ taskId, taskRunId }) => {
    const state = ctx.getState()
    const task = requireTask(state, taskId)
    const taskRun = resolveTaskRun(taskId, taskRunId)
    return toToolResult(buildTaskExecutionPayload(task, taskRun))
  })

  server.registerTool('task.cancel_execution', {
    title: 'Cancel Task Execution',
    description: '取消任务最近一次或指定一次正在进行的远程执行',
    inputSchema: taskExecutionSchema,
  }, async ({ taskId, taskRunId }) => {
    const task = requireTask(ctx.getState(), taskId)
    const taskRun = resolveTaskRun(taskId, taskRunId)
    if (!taskRun.distributedTaskId) {
      if (['completed', 'failed', 'cancelled', 'timed_out', 'lost'].includes(taskRun.status)) {
        throw new McpError(ErrorCode.InvalidParams, '当前执行已经结束。')
      }
      if (!taskRun.workspaceId || !taskRun.workspaceSessionId) {
        throw new McpError(ErrorCode.InvalidParams, '该执行记录缺少工作区会话，无法取消。')
      }

      await removeTaskChatQueueEntry({
        taskId,
        workspaceId: taskRun.workspaceId,
        workspaceSessionId: taskRun.workspaceSessionId,
        queueId: taskRun.id,
      })
      await stopTaskChatExecutionAcrossNodes({
        taskId,
        workspaceId: taskRun.workspaceId,
        workspaceSessionId: taskRun.workspaceSessionId,
      })
      markTaskChatRuntimeStopped({
        task,
        workspaceId: taskRun.workspaceId,
        workspaceSessionId: taskRun.workspaceSessionId,
      })
      const updatedAt = new Date().toISOString()
      const cancelledRun: TaskRun = {
        ...taskRun,
        status: 'cancelled',
        summary: 'MCP 请求取消工作区执行',
        updatedAt,
      }
      saveTaskRun(cancelledRun)
      return toToolResult({
        ok: true,
        task: summarizeTask(task, ctx.getState().projects.find((project) => project.id === task.projectId)),
        run: summarizeTaskRun(cancelledRun),
        message: '已取消工作区会话中的排队或运行执行。',
      })
    }

    const distributedTask = getDistributedTask(taskRun.distributedTaskId)
    if (!distributedTask) {
      throw new McpError(ErrorCode.InvalidParams, '关联的分布式任务不存在。')
    }
    if (distributedTask.status === 'executing' || distributedTask.status === 'syncing_back') {
      const accepted = requestExecutorTaskCancellation(distributedTask, 'MCP 请求取消任务')
      if (!accepted) {
        throw new McpError(ErrorCode.InvalidParams, '执行节点当前不可达，无法发送取消请求。')
      }
      return toToolResult({
        ok: true,
        task: summarizeTask(task, ctx.getState().projects.find((project) => project.id === task.projectId)),
        run: summarizeTaskRun(taskRun),
        message: '已向执行节点发送取消请求。',
      })
    }
    if (distributedTask.status === 'completed' || distributedTask.status === 'failed' || distributedTask.status === 'cancelled' || distributedTask.status === 'timed_out' || distributedTask.status === 'lost') {
      throw new McpError(ErrorCode.InvalidParams, '当前执行已经结束。')
    }

    throw new McpError(ErrorCode.InvalidParams, '当前执行阶段不支持通过 MCP 取消。')
  })

  server.registerTool('task.retry_execution', {
    title: 'Retry Task Execution',
    description: '将最近一次或指定一次已结束执行重新排队',
    inputSchema: taskExecutionSchema,
  }, async ({ taskId, taskRunId }) => {
    const task = requireTask(ctx.getState(), taskId)
    const taskRun = resolveTaskRun(taskId, taskRunId)
    if (!taskRun.distributedTaskId) {
      if (!['completed', 'failed', 'cancelled', 'timed_out', 'lost'].includes(taskRun.status)) {
        throw new McpError(ErrorCode.InvalidParams, '只有已结束的执行才能重试。')
      }
      if (!taskRun.workspaceId) {
        throw new McpError(ErrorCode.InvalidParams, '该执行记录缺少工作区，无法重试。')
      }
      const state = ctx.getState()
      const project = requireProject(state, task.projectId)
      const sourceAgentEventId = ctx.runtimeAgentId
        ? findRunningAgentEventId(ctx.runtimeAgentId, task.id)
        : undefined
      const messageAuthor = resolveMcpCreatorIdentity(ctx)
      const execution = await executeTaskOnWorkspace({
        state,
        userId: ctx.userId,
        requestedByAgentId: ctx.runtimeAgentId,
        sourceAgentEventId,
        messageAuthor,
        task,
        project,
        workspaceId: taskRun.workspaceId,
        workspaceSessionId: taskRun.workspaceSessionId,
        baseBranch: taskRun.baseBranch,
        returnMode: taskRun.returnMode,
        gitIdentityMode: taskRun.gitIdentityMode,
      })
      if (!execution.ok) {
        throw new McpError(ErrorCode.InvalidParams, execution.message)
      }
      return toToolResult({
        ok: true,
        task: summarizeTask(execution.task, execution.project),
        run: summarizeTaskRun(execution.taskRun),
        workspace: execution.workspace,
        workspaceSessionId: execution.session.id,
        message: '已通过工作区会话消息队列重新执行。',
      })
    }

    const distributedTask = getDistributedTask(taskRun.distributedTaskId)
    if (!distributedTask) {
      throw new McpError(ErrorCode.InvalidParams, '关联的分布式任务不存在。')
    }
    if (!['completed', 'failed', 'cancelled', 'timed_out', 'lost'].includes(distributedTask.status)) {
      throw new McpError(ErrorCode.InvalidParams, '只有已结束的执行才能重试。')
    }

    const preferredExecutor = distributedTask.executorNodeId
      ? canUserUseExecutorForProject({
          userId: ctx.userId,
          projectId: distributedTask.projectId,
          executorId: distributedTask.executorNodeId,
        })
      : null
    const scheduling = preferredExecutor?.ok
      ? { candidate: { executor: preferredExecutor.executor } }
      : chooseControlPlaneExecutorForTask({
          currentExecutorId: distributedTask.executorNodeId,
          projectId: distributedTask.projectId,
          userId: ctx.userId,
        })
    const nextExecutorNodeId = scheduling.candidate?.executor.executorId
      ?? chooseExecutorNode(distributedTask.projectId, 'auto', distributedTask.executorNodeId ? [distributedTask.executorNodeId] : [])
    const resolvedExecutorId = nextExecutorNodeId ?? distributedTask.executorNodeId
    if (!resolvedExecutorId) {
      throw new McpError(ErrorCode.InvalidParams, '没有可用的执行节点可用于重试。')
    }

    const nextDistributedTask = resetDistributedTask(distributedTask, resolvedExecutorId, 'MCP 已重试该分布式任务')
    const nextTask: Task = {
      ...task,
      status: 'todo',
      executionMode: 'remote',
      updatedAt: nextDistributedTask.updatedAt,
    }
    saveTask(nextTask)
    reconcileControlPlaneTaskQueue()
    return toToolResult({
      ok: true,
      task: summarizeTask(nextTask, ctx.getState().projects.find((project) => project.id === nextTask.projectId)),
      run: summarizeTaskRun(taskRun),
      distributedTask: nextDistributedTask,
      message: '执行已重新排队。',
    })
  })

  server.registerTool('conversation.get_task_conversation', {
    title: 'Task Conversation',
    description: '读取任务对应的统一会话和消息明细',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      taskId: z.string().min(1).describe('任务 ID'),
    },
  }, async ({ taskId }) => {
    requireTask(ctx.getState(), taskId)
    const taskConversation = ctx.getConversations().find((item) => item.conversation.taskId === taskId)
    const detail = taskConversation ? getConversationDetail(taskConversation.conversation.id) : null
    return toToolResult({
      taskId,
      conversation: detail?.conversation ?? null,
      messages: detail?.messages ?? [],
      channelBindings: detail?.channelBindings ?? [],
    })
  })
}
