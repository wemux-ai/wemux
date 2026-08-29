import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveTaskAssignmentDispatch,
  TASK_ASSIGNMENT_REQUIRED_MESSAGE,
} from './task-assignment-policy'

test('未指派负责人时要求先问用户，不派发执行', () => {
  const decision = resolveTaskAssignmentDispatch({
    status: 'todo',
    startMode: 'now',
    runtimeAgentId: 'agent-creator',
  })

  assert.equal(decision.dispatch, false)
  assert.equal(decision.reason, 'unassigned')
  assert.equal(decision.selfAssigned, false)
  assert.equal(decision.message, TASK_ASSIGNMENT_REQUIRED_MESSAGE)
})

test('指派给新 Agent 且 startMode=now 时派发一次执行', () => {
  const decision = resolveTaskAssignmentDispatch({
    assigneeAgentId: 'agent-worker',
    status: 'todo',
    startMode: 'now',
    runtimeAgentId: 'agent-creator',
  })

  assert.equal(decision.dispatch, true)
  assert.equal(decision.reason, 'dispatch')
  assert.equal(decision.selfAssigned, false)
})

test('负责人是当前运行 Agent 时不再排队新事件，本轮直接继续执行', () => {
  const decision = resolveTaskAssignmentDispatch({
    assigneeAgentId: 'agent-creator',
    status: 'todo',
    startMode: 'now',
    runtimeAgentId: 'agent-creator',
  })

  assert.equal(decision.dispatch, false)
  assert.equal(decision.reason, 'self')
  assert.equal(decision.selfAssigned, true)
})

test('Backlog 任务只登记负责人，不启动执行', () => {
  const decision = resolveTaskAssignmentDispatch({
    assigneeAgentId: 'agent-worker',
    status: 'backlog',
    startMode: 'now',
  })

  assert.equal(decision.dispatch, false)
  assert.equal(decision.reason, 'backlog')
})

test('startMode=parked 只登记负责人', () => {
  const decision = resolveTaskAssignmentDispatch({
    assigneeAgentId: 'agent-worker',
    status: 'todo',
    startMode: 'parked',
  })

  assert.equal(decision.dispatch, false)
  assert.equal(decision.reason, 'parked')
})

test('负责人没有变化时不重复派发', () => {
  const decision = resolveTaskAssignmentDispatch({
    assigneeAgentId: 'agent-worker',
    previousAssigneeAgentId: 'agent-worker',
    status: 'in_progress',
    startMode: 'now',
  })

  assert.equal(decision.dispatch, false)
  assert.equal(decision.reason, 'unchanged')
})

test('换 Squad 但解析出的 leader 不变时仍要派发', () => {
  // 只比 agentId 会把换队误判成 unchanged，导致整次换队静默：
  // 既不唤醒新队伍，也不在收件箱留任何痕迹。
  const decision = resolveTaskAssignmentDispatch({
    assigneeAgentId: 'agent-worker',
    previousAssigneeAgentId: 'agent-worker',
    assigneeAgentGroupId: 'squad-2',
    previousAssigneeAgentGroupId: 'squad-1',
    status: 'in_progress',
    startMode: 'now',
  })

  assert.equal(decision.dispatch, true)
  assert.equal(decision.reason, 'dispatch')
})

test('Squad 与 leader 都没变时仍然不派发', () => {
  const decision = resolveTaskAssignmentDispatch({
    assigneeAgentId: 'agent-worker',
    previousAssigneeAgentId: 'agent-worker',
    assigneeAgentGroupId: 'squad-1',
    previousAssigneeAgentGroupId: 'squad-1',
    status: 'in_progress',
    startMode: 'now',
  })

  assert.equal(decision.dispatch, false)
  assert.equal(decision.reason, 'unchanged')
})

test('从 Squad 改成直接指派同一个 Agent 算变化', () => {
  const decision = resolveTaskAssignmentDispatch({
    assigneeAgentId: 'agent-worker',
    previousAssigneeAgentId: 'agent-worker',
    previousAssigneeAgentGroupId: 'squad-1',
    status: 'in_progress',
    startMode: 'now',
  })

  assert.equal(decision.dispatch, true)
})

test('Backlog 判定早于 self，但 selfAssigned 仍要为真', () => {
  // deliverTaskAssignment 靠 selfAssigned 决定不投 observe。
  // 这里漏掉的话，Agent 把 Backlog 任务指派给自己会收到自己发的通知。
  const decision = resolveTaskAssignmentDispatch({
    assigneeAgentId: 'agent-creator',
    status: 'backlog',
    startMode: 'now',
    runtimeAgentId: 'agent-creator',
  })

  assert.equal(decision.reason, 'backlog')
  assert.equal(decision.selfAssigned, true)
})
