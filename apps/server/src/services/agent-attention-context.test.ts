import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAgentAttentionContextCapsule } from './agent-attention-context'

test('claim-time context capsule keeps exact references and causal source', () => {
  const capsule = buildAgentAttentionContextCapsule({
    agentId: 'agent-1',
    eventId: 'event-completed',
    eventType: 'workspace.session.completed',
    event: {
      scope: {
        projectId: 'project-1',
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        workspaceSessionId: 'session-1',
        distributedTaskId: 'distributed-1',
        taskRunId: 'run-1',
      },
      payload: {
        sourceAgentEventId: 'event-assigned',
      },
      resumesEventId: 'event-waiting',
    },
  })

  assert.deepEqual(capsule.references, {
    projectId: 'project-1',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    distributedTaskId: 'distributed-1',
    taskRunId: 'run-1',
  })
  assert.equal(capsule.reason.sourceAgentEventId, 'event-assigned')
  assert.equal(capsule.reason.resumesEventId, 'event-waiting')
})
