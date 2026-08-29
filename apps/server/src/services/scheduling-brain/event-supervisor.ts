/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: 工作区事件（任务状态变更 / 任务评论 / 新会话）+ 事件上下文。
 * [OUTPUT]: 无主判定 + 发布 brain.event.review 到工作区大脑（群负责人 Agent）。
 * [POS]: feature 调度大脑——异步事件监督；只对「无主事件」产生 review 事件，
 *        有主事件一律不碰（不覆盖指派、不抢活、零开销）。
 */
import type { AgentEventActor } from '../agent-event-runtime'
import { listTaskAgentActivities, publishAgentEvent } from '../agent-event-runtime'
import { listExecutionEvents } from '../../storage/postgres/execution-event-store'
import { loadState } from '../../storage/app-state-store'
import { classifyWorkspaceMessageIntent } from './intent-classifier'
import { buildWorkspaceBrainContextSnapshot, refreshStaleBrainFileDigests, resolveWorkspaceBrainAgentForEvent } from '../workspace-brain-service'

export type WorkspaceBrainEventKind = 'task.status.changed' | 'task.comment.created' | 'workspace.session.created'

export type WorkspaceBrainReviewContext = {
  kind: WorkspaceBrainEventKind
  /** 直接的工作区 id（会话事件用）。 */
  workspaceId?: string
  /** 项目 id（任务事件用）；任务经 project.workspaceId 映射到工作区。 */
  projectId?: string
  actingUserId?: string
  actor: AgentEventActor
  /** 事件去重键：同一事件只产生一次 review（幂等）。 */
  eventKey: string
  task?: {
    id: string
    title: string
    status: string
    projectId?: string
    assigneeId?: string
    assigneeAgentId?: string
    assigneeAgentGroupId?: string
  }
  session?: {
    id: string
    title?: string
    status?: string
    customAgentId?: string
  }
  comment?: {
    id: string
    content: string
    authorType: string
  }
}

/** 任务 → 工作区映射：project.workspaceId（Task 本身没有 workspaceId）。 */
export const resolveProjectWorkspaceId = (projectId?: string): string => {
  const id = projectId?.trim()
  if (!id) return ''
  return loadState().projects.find((project) => project.id === id)?.workspaceId?.trim() || ''
}

export const resolveBrainReviewWorkspaceId = (context: WorkspaceBrainReviewContext): string => {
  return context.workspaceId?.trim() || resolveProjectWorkspaceId(context.projectId ?? context.task?.projectId)
}

/**
 * 无主判定（纯函数）：
 * - 任务事件：assigneeId（人类负责人）/ assigneeAgentId / assigneeAgentGroupId 任一存在 → 有主；
 *   三者皆空 → 无主（Squad 负责人会处理的不算无主）。
 * - 会话事件：会话没有 customAgentId（没有 Agent 认领）→ 无主。
 * 有主事件返回 false，调用方直接跳过，不产生任何大脑事件。
 */
export const isWorkspaceEventOrphan = (context: Pick<WorkspaceBrainReviewContext, 'kind' | 'task' | 'session'>): boolean => {
  if (context.kind === 'task.status.changed' || context.kind === 'task.comment.created') {
    const task = context.task
    if (!task) return false
    if (task.assigneeId?.trim()) return false
    if (task.assigneeAgentId?.trim()) return false
    if (task.assigneeAgentGroupId?.trim()) return false
    return true
  }
  if (context.kind === 'workspace.session.created') {
    return !context.session?.customAgentId?.trim()
  }
  return false
}

const truncate = (value: string, max: number) => {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized
}

export const buildWorkspaceBrainReviewOneLiner = (context: WorkspaceBrainReviewContext): string => {
  if (context.kind === 'task.status.changed' && context.task) {
    return `任务「${truncate(context.task.title, 60)}」状态变更为 ${context.task.status}（无负责人）`
  }
  if (context.kind === 'task.comment.created' && context.task) {
    return `任务「${truncate(context.task.title, 60)}」收到新评论（无负责人）：${truncate(context.comment?.content ?? '', 60)}`
  }
  if (context.kind === 'workspace.session.created' && context.session) {
    return `新建工作区会话「${truncate(context.session.title ?? context.session.id, 60)}」（无 Agent 认领）`
  }
  return `工作区事件 ${context.kind}`
}

export type WorkspaceEventHistoryActivity = {
  agentName: string
  eventType: string
  status: string
  summaryPreview?: string
  updatedAt?: string
}

export type WorkspaceEventHistoryExecutionEvent = {
  eventType: string
  message?: string
  occurredAt?: string
}

/**
 * 事件历史快照（纯函数，可单测）：把近期 Agent 活动 + 执行事件 + 工作区维度事件压缩成大脑可读文本。
 */
export const buildWorkspaceEventHistorySnapshot = (params: {
  recentActivities?: readonly WorkspaceEventHistoryActivity[]
  recentExecutionEvents?: readonly WorkspaceEventHistoryExecutionEvent[]
  recentWorkspaceEvents?: readonly WorkspaceEventHistoryExecutionEvent[]
  limit?: number
}): string => {
  const limit = params.limit ?? 6
  const lines: string[] = []
  const workspaceEvents = (params.recentWorkspaceEvents ?? []).slice(0, limit)
  if (workspaceEvents.length > 0) {
    lines.push('--- 工作区近期事件 ---')
    for (const event of workspaceEvents) {
      lines.push(`- ${event.occurredAt ?? ''} | ${event.eventType}${event.message ? ` | ${truncate(event.message, 100)}` : ''}`)
    }
  }
  const activities = (params.recentActivities ?? []).slice(0, limit)
  if (activities.length > 0) {
    lines.push('--- 近期 Agent 活动 ---')
    for (const activity of activities) {
      lines.push(`- ${activity.agentName} | ${activity.eventType} | ${activity.status}${activity.summaryPreview ? ` | ${truncate(activity.summaryPreview, 80)}` : ''}`)
    }
  }
  const events = (params.recentExecutionEvents ?? []).slice(0, limit)
  if (events.length > 0) {
    lines.push('--- 近期执行事件 ---')
    for (const event of events) {
      lines.push(`- ${event.occurredAt ?? ''} | ${event.eventType}${event.message ? ` | ${truncate(event.message, 100)}` : ''}`)
    }
  }
  if (lines.length === 0) {
    lines.push('（暂无近期事件）')
  }
  return lines.join('\n')
}

const buildReviewPayload = async (context: WorkspaceBrainReviewContext) => {
  const recentActivities: WorkspaceEventHistoryActivity[] = []
  const recentExecutionEvents: WorkspaceEventHistoryExecutionEvent[] = []
  const recentWorkspaceEvents: WorkspaceEventHistoryExecutionEvent[] = []
  // P1-2 工作区维度：解析 workspace → 项目集合 → 近期执行事件（大脑能看到工作区全貌）
  const workspaceId = resolveBrainReviewWorkspaceId(context)
  if (workspaceId) {
    const workspaceProjectIds = loadState().projects
      .filter((project) => project.workspaceId === workspaceId)
      .map((project) => project.id)
      .slice(0, 20)
    if (workspaceProjectIds.length > 0) {
      try {
        const result = await listExecutionEvents({ projectIds: workspaceProjectIds, limit: 6 })
        recentWorkspaceEvents.push(...result.events.map((event) => ({
          eventType: event.eventType,
          message: event.message,
          occurredAt: event.occurredAt,
        })))
      } catch {
        // Postgres 未就绪等场景不阻塞
      }
    }
  }
  if (context.task?.id) {
    recentActivities.push(...listTaskAgentActivities(context.task.id).slice(0, 5).map((activity) => ({
      agentName: activity.agentName,
      eventType: activity.eventType,
      status: activity.status,
      summaryPreview: activity.summaryPreview,
      updatedAt: activity.updatedAt,
    })))
    try {
      const result = await listExecutionEvents({ taskId: context.task.id, limit: 10 })
      recentExecutionEvents.push(...result.events.map((event) => ({
        eventType: event.eventType,
        message: event.message,
        occurredAt: event.occurredAt,
      })))
    } catch {
      // Postgres 未就绪等场景：快照缺执行事件不阻塞 review 发布
    }
  }

  return {
    eventType: context.kind,
    eventKey: context.eventKey,
    summary: buildWorkspaceBrainReviewOneLiner(context),
    workspaceId: resolveBrainReviewWorkspaceId(context),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.task ? { task: context.task } : {}),
    ...(context.session ? { session: context.session } : {}),
    ...(context.comment ? { comment: context.comment } : {}),
    workspaceContextSnapshot: buildWorkspaceBrainContextSnapshot(resolveBrainReviewWorkspaceId(context)),
    eventHistorySnapshot: buildWorkspaceEventHistorySnapshot({ recentActivities, recentExecutionEvents, recentWorkspaceEvents }),
  }
}

/**
 * 发布决策纯函数（可单测）：任一条件不满足即 skip，保证有主事件/未开启/无大脑时不产生任何事件。
 */
export const decideBrainReviewPublish = (params: {
  workspaceId: string
  orphan: boolean
  brainEnabled: boolean
  brainAgentId: string | null
}): 'published' | 'skipped' => {
  if (!params.workspaceId.trim()) return 'skipped'
  if (!params.orphan) return 'skipped'
  if (!params.brainEnabled) return 'skipped'
  if (!params.brainAgentId) return 'skipped'
  return 'published'
}

/**
 * 工作区事件监督入口（协作空间级配置，feature v2）：
 * 1. 工作区未开启大脑（collab_workspaces.brain_enabled）→ skip。
 * 2. 事件有主（有 assignee / Squad / 会话有 Agent）→ skip（有主不碰）。
 * 3. 工作区没有大脑 Agent（未显式配置且无群负责人）→ skip。
 * 4. 否则发布 brain.event.review 事件（幂等键去重），大脑按工作区提示词审查与分发。
 * 调用方用 void 旁路，不阻塞主流程。
 */
export const publishWorkspaceBrainReview = async (
  context: WorkspaceBrainReviewContext,
): Promise<'published' | 'skipped' | 'noise'> => {
  const workspaceId = resolveBrainReviewWorkspaceId(context)
  if (!isWorkspaceEventOrphan(context)) {
    return 'skipped'
  }

  // P1-1 噪音预筛：纯闲聊/无意义评论不唤醒大脑（省 Agent 轮）；question/task 类仍唤醒（大脑配便宜模型，成本已控）
  if (context.kind === 'task.comment.created' && context.comment?.content.trim()) {
    const commentIntent = await classifyWorkspaceMessageIntent({
      message: context.comment.content,
      agents: [],
      enabled: true,
    }).catch(() => null)
    if (commentIntent && (commentIntent.intent === 'chat' || commentIntent.intent === 'none')) {
      return 'noise'
    }
  }

  const brain = await resolveWorkspaceBrainAgentForEvent(workspaceId, context.task?.assigneeAgentGroupId)
  const decision = decideBrainReviewPublish({
    workspaceId,
    orphan: true,
    brainEnabled: Boolean(brain),
    brainAgentId: brain?.brainAgentId ?? null,
  })
  if (decision === 'skipped') {
    return 'skipped'
  }

  const payload = await buildReviewPayload(context)
  // P2-2：文件更新后重新整理 digest（旁路，不阻塞分发）
  void refreshStaleBrainFileDigests(workspaceId).catch(() => undefined)
  publishAgentEvent({
    type: 'brain.event.review',
    targetAgentId: brain?.brainAgentId as string,
    actingUserId: context.actingUserId,
    actor: context.actor,
    scope: {
      workspaceId,
      ...(context.projectId ? { projectId: context.projectId } : {}),
      ...(context.task ? { taskId: context.task.id } : {}),
      ...(context.session ? { sessionId: context.session.id } : {}),
    },
    payload: {
      ...payload,
      brainInstructions: brain?.instructions,
    },
    conversationKey: `brain:${workspaceId}`,
    idempotencyKey: `brain-review:${workspaceId}:${context.eventKey}`,
  })
  return 'published'
}
