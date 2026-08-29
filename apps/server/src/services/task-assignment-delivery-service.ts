/**
 * [INPUT]: A task whose assignee just changed, the acting user or runtime Agent identity, and the requested start mode.
 * [OUTPUT]: Inbox delivery for a human assignee, or one Agent dispatch decision plus its inbox record — woken (directive, via publishAgentEventWithOutcome) or registered only (observe).
 * [POS]: Single side-effect boundary for task assignment notification and dispatch, shared by all four assignment entry points.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { InboxActorType } from '@shared/inbox'
import type { Task } from '@shared/types'
import { getAgent } from '../repositories/agent'
import { getUserById } from '../repositories/auth'
import { publishAgentEventWithOutcome, resolveAgentDispatchReadiness } from './agent-event-runtime'
import { isSelfDelivery, publishInboxItem } from './inbox-service'
import { buildTaskAssignmentAgentObserveItem, buildTaskAssignmentInboxItem } from './task-assignment-inbox'
import {
  resolveTaskAssignmentDispatch,
  type TaskAssignmentDecision,
  type TaskAssignmentStartMode,
} from './task-assignment-policy'
import { setTaskSubscriber } from './task-subscriber-service'

export type TaskAssignmentActor = { type: InboxActorType; id?: string; name?: string }

/**
 * Agent 代表用户操作时 actor 是 Agent，不是用户。这个区分决定自投守卫的结果：
 * Agent 把任务指派给它的所有者时，actor 与收件人不是同一主体，该投。
 */
export const resolveTaskAssignmentActor = (params: {
  userId: string
  runtimeAgentId?: string
}): TaskAssignmentActor => {
  const runtimeAgentId = params.runtimeAgentId?.trim()
  if (runtimeAgentId) {
    return { type: 'agent', id: runtimeAgentId, name: getAgent(runtimeAgentId)?.name }
  }
  return { type: 'user', id: params.userId, name: getUserById(params.userId)?.name }
}

/**
 * 指派给人的唯一投递入口。指派即关注：被指派的人加入 subscriberIds，
 * 后续该任务未 @ 到他的讨论也能进他的收件箱。
 *
 * 返回的 task 可能带上了新的 subscriberIds，调用方负责持久化。
 */
export const deliverHumanTaskAssignment = async (params: {
  task: Task
  assigneeUserId: string
  actor: TaskAssignmentActor
  at?: string
}): Promise<{ task: Task; delivered: boolean }> => {
  if (isSelfDelivery({
    recipientType: 'user',
    recipientId: params.assigneeUserId,
    actor: params.actor,
  })) {
    return { task: params.task, delivered: false }
  }

  // 先投递再改 subscriberIds：dedupeKey 含 task.updatedAt，关注写入会推进它。
  await publishInboxItem(buildTaskAssignmentInboxItem({
    task: params.task,
    assigneeUserId: params.assigneeUserId,
    actor: params.actor,
    at: params.at,
  }))

  return {
    task: setTaskSubscriber({ task: params.task, userId: params.assigneeUserId, subscribed: true }),
    delivered: true,
  }
}

export type TaskAssignmentDeliveryResult = {
  decision: TaskAssignmentDecision
  /** 是否真的给 Agent 排了执行事件。去重命中时为 false。 */
  dispatched: boolean
  /** Agent 收件箱里是否留下了这次指派的记录（唤醒态的 directive 或未唤醒的 observe）。 */
  recorded: boolean
  /** 无法启动的原因（Agent 离线等）；决策允许派发但 readiness 拦下时才有值。 */
  notReadyMessage?: string
}

/**
 * 一次 Agent 指派的唯一出口。四个入口（建任务、建子任务、改负责人、MCP task.assign）
 * 全部走这里，所以「指派会不会启动 Agent」只有一处判定。
 *
 * 唤醒仍然由 `publishAgentEventWithOutcome` 显式触发 —— 投递本身不唤醒，这是既有架构的方向。
 * 这个函数做的是让两种结果都在 Agent 收件箱里留痕：
 *
 *   - 唤醒了：事件入队时内部产出 `directive`，这里不额外投，否则双记录
 *   - 没唤醒（Backlog / parked）：这里投 `observe`，补上原先的静默
 *
 * `unchanged` 和 `self` 不投：前者没发生事，后者是 Agent 自己干的，它已经知道。
 */
export const deliverTaskAssignment = async (params: {
  task: Task
  actor: TaskAssignmentActor
  startMode: TaskAssignmentStartMode
  previousAssigneeAgentId?: string
  previousAssigneeAgentGroupId?: string
  /** 当前正在运行的 Agent，用于判定自指派。 */
  runtimeAgentId?: string
  actingUserId: string
  handoffPrompt?: string
  assigneeAgentGroupTitle?: string
  at?: string
}): Promise<TaskAssignmentDeliveryResult> => {
  const { task } = params
  const decision = resolveTaskAssignmentDispatch({
    assigneeAgentId: task.assigneeAgentId,
    previousAssigneeAgentId: params.previousAssigneeAgentId,
    assigneeAgentGroupId: task.assigneeAgentGroupId,
    previousAssigneeAgentGroupId: params.previousAssigneeAgentGroupId,
    status: task.status,
    startMode: params.startMode,
    runtimeAgentId: params.runtimeAgentId,
  })

  if (!decision.dispatch) {
    // 只有「登记了但没启动」需要留痕。unassigned 没有收件人，unchanged 没有新信息，
    // self 是这个 Agent 自己干的 —— 它已经知道，投给它等于自己给自己发通知。
    const shouldRecord = task.assigneeAgentId
      && !decision.selfAssigned
      && (decision.reason === 'backlog' || decision.reason === 'parked')
    if (!shouldRecord) return { decision, dispatched: false, recorded: false }

    await publishInboxItem(buildTaskAssignmentAgentObserveItem({
      task,
      assigneeAgentId: task.assigneeAgentId!,
      actor: params.actor,
      reason: decision.message,
      at: params.at,
    }))
    return { decision, dispatched: false, recorded: true }
  }

  const assigneeAgentId = task.assigneeAgentId!
  const readiness = resolveAgentDispatchReadiness(assigneeAgentId, params.actingUserId)
  if (!readiness.ok) {
    // 想启动但启动不了：也留一条 observe，否则这次指派同样无声无息。
    await publishInboxItem(buildTaskAssignmentAgentObserveItem({
      task,
      assigneeAgentId,
      actor: params.actor,
      reason: `负责人已记录，但暂时无法启动：${readiness.message}`,
      at: params.at,
    }))
    return { decision, dispatched: false, recorded: true, notReadyMessage: readiness.message }
  }

  // 用 WithOutcome 而不是 publishAgentEvent：去重命中时不会有新事件也不会有新 inbox item，
  // 这种情况报 dispatched: true 就是在骗调用方。
  const dispatches = publishAgentEventWithOutcome({
    type: 'task.assigned',
    targetAgentId: assigneeAgentId,
    actingUserId: params.actingUserId,
    actor: params.actor.type === 'agent' && params.actor.id
      ? { type: 'agent', id: params.actor.id }
      : { type: 'user', id: params.actingUserId },
    scope: { projectId: task.projectId, taskId: task.id },
    payload: {
      title: task.title,
      description: task.description,
      status: task.status,
      handoffPrompt: params.handoffPrompt,
      assigneeAgentGroupId: task.assigneeAgentGroupId,
      assigneeAgentGroupTitle: params.assigneeAgentGroupTitle,
    },
    conversationKey: `task:${task.id}`,
    // 四处入口共用同一格式：含 updatedAt，所以 HTTP 与 MCP 对同一次指派会互相去重。
    idempotencyKey: `task-assigned:${task.id}:${task.assigneeAgentGroupId || assigneeAgentId}:${task.updatedAt}`,
  })
  const queued = dispatches.some((dispatch) => dispatch.status === 'queued')

  return { decision, dispatched: queued, recorded: queued }
}
