import assert from 'node:assert/strict'
import test from 'node:test'

import type { VibemuxClient } from '../client'
import { runTaskCommand } from './task'

test('task send keeps flags out of the message', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client = {
    callTool: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      return 'sent'
    },
  } as VibemuxClient

  await runTaskCommand(client, 'send', [
    'task-1',
    'fix',
    'the',
    'overflow',
    '--workspace',
    'workspace-1',
    '--session=session-1',
  ])

  assert.deepEqual(calls, [{
    name: 'task.send',
    args: {
      taskId: 'task-1',
      message: 'fix the overflow',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
    },
  }])
})

test('task create accepts an unquoted multi-word description', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client = {
    callTool: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      return 'created'
    },
  } as VibemuxClient

  await runTaskCommand(client, 'create', ['project-1', 'fix', 'login', 'flow', '--title=Login'])

  assert.deepEqual(calls[0], {
    name: 'task.create',
    args: {
      projectId: 'project-1',
      description: 'fix login flow',
      title: 'Login',
    },
  })
})

test('task run maps workspace execution flags to task.execute', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client = {
    callTool: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      return 'queued'
    },
  } as VibemuxClient

  await runTaskCommand(client, 'run', ['task-1', '--workspace', 'workspace-1', '--new-session', '--branch=dev'])

  assert.deepEqual(calls[0], {
    name: 'task.execute',
    args: {
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      workspaceSessionId: undefined,
      createNewSession: true,
      baseBranch: 'dev',
      returnMode: undefined,
      syncBackStrategy: undefined,
    },
  })
})
