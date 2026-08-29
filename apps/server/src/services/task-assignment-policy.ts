/**
 * [INPUT]: Task assignment intent (target Agent, task status, start mode) and the acting runtime Agent identity.
 * [OUTPUT]: A single dispatch decision per assignment plus the guidance text handed back to the calling Agent.
 * [POS]: Pure task-assignment policy shared by HTTP assign routes and MCP task tools; keeps "一个任务一个负责 Agent 一次派发" in one place.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { TaskStatus } from '@shared/types'

export type TaskAssignmentStartMode = 'now' | 'parked'

export type TaskAssignmentDispatchReason =
  | 'dispatch'
  | 'self'
  | 'unassigned'
  | 'backlog'
  | 'parked'
  | 'unchanged'

export type TaskAssignmentDecision = {
  /** 是否需要给负责 Agent 发一次 task.assigned 事件。 */
  dispatch: boolean
  reason: TaskAssignmentDispatchReason
  /** 负责人就是当前正在运行的 Agent：不再排队新事件，本轮直接继续执行。 */
  selfAssigned: boolean
  message: string
}

export const TASK_ASSIGNMENT_REQUIRED_MESSAGE = [
  '任务还没有负责 Agent。默认行为是先问用户指派给谁，不要自己接单执行。',
  '用 agent.list 读取候选 Agent，把候选列表给用户；用户选定后用 task.assign 指派，必要时带上 handoffPrompt。',
  '只有用户明确要求你自己做时，才把负责人指派给你自己并继续执行。',
].join('')

const messages: Record<TaskAssignmentDispatchReason, string> = {
  dispatch: '任务已指派给负责 Agent，并已加入执行队列。',
  self: '你就是这个任务的负责 Agent，不会再排队新的指派事件；本轮按工作区原则继续执行。',
  unassigned: TASK_ASSIGNMENT_REQUIRED_MESSAGE,
  backlog: 'Backlog 任务只登记负责人，不启动执行；任务离开 Backlog 后再启动。',
  // 不要再指向 task.assign(startMode="now")：负责人已登记，重复指派会命中 unchanged 而不派发。
  parked: '任务已登记负责人但未启动；需要执行时由用户在任务里启动 Agent。',
  unchanged: '负责人没有变化，不重复派发；需要重跑时由用户在任务里启动 Agent。',
}

/**
 * 判定一次指派是否应该触发执行。四个条件必须同时成立：有 Agent 负责人、指派发生变化
 * （agentId 或 Squad 的 groupId 任一变了都算）、任务不在 Backlog、startMode 为 now。
 * 负责人是当前运行 Agent 时不再排队事件，避免同一任务跑两轮。
 */
export const resolveTaskAssignmentDispatch = (params: {
  assigneeAgentId?: string
  previousAssigneeAgentId?: string
  /**
   * Squad 归属。换队但解析出的 leader 不变时，只比 agentId 会误判成「没变化」
   * 而静默跳过派发，所以这里要一起比。
   */
  assigneeAgentGroupId?: string
  previousAssigneeAgentGroupId?: string
  status: TaskStatus
  startMode: TaskAssignmentStartMode
  runtimeAgentId?: string
}): TaskAssignmentDecision => {
  const assigneeAgentId = params.assigneeAgentId?.trim() || undefined
  if (!assigneeAgentId) {
    return { dispatch: false, reason: 'unassigned', selfAssigned: false, message: messages.unassigned }
  }

  const selfAssigned = Boolean(params.runtimeAgentId && params.runtimeAgentId === assigneeAgentId)
  const sameAgent = assigneeAgentId === (params.previousAssigneeAgentId?.trim() || undefined)
  const sameGroup = (params.assigneeAgentGroupId?.trim() || undefined)
    === (params.previousAssigneeAgentGroupId?.trim() || undefined)
  if (sameAgent && sameGroup) {
    return { dispatch: false, reason: 'unchanged', selfAssigned, message: messages.unchanged }
  }
  if (params.status === 'backlog') {
    return { dispatch: false, reason: 'backlog', selfAssigned, message: messages.backlog }
  }
  if (params.startMode === 'parked') {
    return { dispatch: false, reason: 'parked', selfAssigned, message: messages.parked }
  }
  if (selfAssigned) {
    return { dispatch: false, reason: 'self', selfAssigned: true, message: messages.self }
  }

  return { dispatch: true, reason: 'dispatch', selfAssigned: false, message: messages.dispatch }
}
