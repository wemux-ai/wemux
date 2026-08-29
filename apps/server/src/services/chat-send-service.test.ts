import assert from 'node:assert/strict'
import test from 'node:test'
import { validateChatSendParams } from './chat-send-service'

test('chat-send 参数校验：空消息返回 400', () => {
  const result = validateChatSendParams({ target: 'group', workspaceId: 'w', groupId: 'g', sessionId: 's', message: '   ' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.status, 400)
})

test('chat-send 参数校验：target=group 缺任一必填返回 400', () => {
  assert.equal(validateChatSendParams({ target: 'group', message: 'hi' }).ok, false)
  assert.equal(validateChatSendParams({ target: 'group', workspaceId: 'w', groupId: 'g', message: 'hi' }).ok, false)
  assert.equal(validateChatSendParams({ target: 'group', workspaceId: 'w', groupId: 'g', sessionId: 's', message: 'hi' }).ok, true)
})

test('chat-send 参数校验：target=user 缺 userId 返回 400', () => {
  assert.equal(validateChatSendParams({ target: 'user', message: 'hi' }).ok, false)
  assert.equal(validateChatSendParams({ target: 'user', targetUserId: '  ', message: 'hi' }).ok, false)
  assert.equal(validateChatSendParams({ target: 'user', targetUserId: 'u2', message: 'hi' }).ok, true)
})

test('chat-send 参数校验：target=agent 缺 agentId 返回 400', () => {
  assert.equal(validateChatSendParams({ target: 'agent', message: 'hi' }).ok, false)
  assert.equal(validateChatSendParams({ target: 'agent', targetAgentId: 'a2', message: 'hi' }).ok, true)
})
