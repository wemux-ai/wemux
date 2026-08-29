import assert from 'node:assert/strict'
import test from 'node:test'

import type { AgentTask } from '../repositories/agent'
import {
  buildTaskQuickCreatePrompt,
  readTaskQuickCreateRequest,
  resolveTaskQuickCreateOriginId,
  TASK_QUICK_CREATE_EVENT_TYPE,
} from './task-quick-create-service'

const createEvent = (projectSelection: { mode: 'agent' } | { mode: 'fixed'; projectId: string }) => ({
  id: 'event-1',
  agentId: 'agent-1',
  type: TASK_QUICK_CREATE_EVENT_TYPE,
  payload: {
    kind: 'agent_event',
    actingUserId: 'user-1',
    payload: {
      quickCreate: {
        creatorAgentId: 'agent-1',
        request: 'Fix the inbox loading latency',
        projectSelection,
        priority: 'high',
        status: 'todo',
        assignmentStartMode: 'now',
      },
    },
  },
  status: 'running',
  result: null,
  startedAt: '2026-07-24T00:00:00.000Z',
  completedAt: null,
  createdAt: '2026-07-24T00:00:00.000Z',
}) as AgentTask

test('quick-create event payload is validated and retains the initial origin across retries', () => {
  const event = createEvent({ mode: 'agent' })
  assert.equal(readTaskQuickCreateRequest(event)?.request, 'Fix the inbox loading latency')
  assert.equal(resolveTaskQuickCreateOriginId(event), event.id)
  assert.equal(resolveTaskQuickCreateOriginId({
    ...event,
    id: 'event-2',
    payload: { ...event.payload, quickCreateOriginId: event.id },
  }), event.id)
})

test('agent-selected project prompt requires exactly one task and forbids execution', () => {
  const request = readTaskQuickCreateRequest(createEvent({ mode: 'agent' }))
  assert.ok(request)
  const prompt = buildTaskQuickCreatePrompt({
    eventId: 'event-1',
    agentId: 'agent-1',
    request,
    authorizedProjects: [
      { id: 'project-web', name: 'Web' },
      { id: 'project-server', name: 'Server' },
    ],
  })

  assert.match(prompt, /project\.list/)
  assert.match(prompt, /且仅创建一个 Task/)
  assert.match(prompt, /不要调用 task\.execute/)
  assert.match(prompt, /creationRunId 原样传入/)
})

test('fixed project prompt prevents the Agent from changing projects', () => {
  const request = readTaskQuickCreateRequest(createEvent({ mode: 'fixed', projectId: 'project-web' }))
  assert.ok(request)
  const prompt = buildTaskQuickCreatePrompt({
    eventId: 'event-1',
    agentId: 'agent-1',
    request,
    authorizedProjects: [{ id: 'project-web', name: 'Web' }],
  })

  assert.match(prompt, /已经由用户固定为 Web/)
  assert.match(prompt, /不得改到其他项目/)
})
