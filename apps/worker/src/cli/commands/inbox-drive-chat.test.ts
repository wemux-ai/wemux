import assert from 'node:assert/strict'
import test from 'node:test'

import type { VibemuxClient } from '../client'
import { runInboxCommand } from './inbox'
import { runDriveCommand } from './drive'
import { runChatCommand } from './chat'

const captureClient = () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client = {
    callTool: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      return 'ok'
    },
  } as VibemuxClient
  return { client, calls }
}

test('inbox list maps --unread and --limit to inbox.list', async () => {
  const { client, calls } = captureClient()

  await runInboxCommand(client, 'list', ['--unread', '--limit', '20', '--workspace', 'ws-1'])

  assert.deepEqual(calls[0], {
    name: 'inbox.list',
    args: { limit: 20, unreadOnly: true, workspaceId: 'ws-1' },
  })
})

test('inbox reply keeps flags out of the reply message', async () => {
  const { client, calls } = captureClient()

  await runInboxCommand(client, 'reply', ['item-1', '收到，我来看', '一下', '--json'])

  assert.deepEqual(calls[0], {
    name: 'inbox.reply',
    args: { itemId: 'item-1', content: '收到，我来看 一下' },
  })
})

test('drive list defaults to personal scope', async () => {
  const { client, calls } = captureClient()

  await runInboxCommand(client, 'read', ['item-2'])
  assert.deepEqual(calls[0], { name: 'inbox.read', args: { itemId: 'item-2' } })

  calls.length = 0
  await runDriveCommand(client, 'list', ['--personal'])
  assert.deepEqual(calls[0], { name: 'drive.list_files', args: { personal: true, parentId: undefined } })
})

test('drive write uses workspace scope when provided', async () => {
  const { client, calls } = captureClient()

  await runDriveCommand(client, 'write', ['report.md', 'hello', '--workspace', 'ws-9', '--parent=p1'])

  assert.deepEqual(calls[0], {
    name: 'drive.write_file',
    args: { personal: false, workspaceId: 'ws-9', parentId: 'p1', name: 'report.md', content: 'hello', fileId: undefined },
  })
})

test('chat conversations maps project/task filters to conversation.list', async () => {
  const { client, calls } = captureClient()

  await runChatCommand(client, 'conversations', ['--project', 'proj-1', '--task', 'task-1'])

  assert.deepEqual(calls[0], {
    name: 'conversation.list',
    args: { projectId: 'proj-1', taskId: 'task-1' },
  })
})

test('chat channel send passes agent id and message', async () => {
  const { client, calls } = captureClient()

  await runChatCommand(client, 'channel', ['send', 'agent-7', '构建完成', '--channel', 'feishu'])

  assert.deepEqual(calls[0], {
    name: 'channel.send',
    args: { agentId: 'agent-7', agentName: undefined, channel: 'feishu', message: '构建完成' },
  })
})
