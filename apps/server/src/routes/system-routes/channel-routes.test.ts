import assert from 'node:assert/strict'
import test from 'node:test'
import { isFeishuBotMentioned, isFeishuUserMessage } from '../../services/feishu-inbound-service'

test('only accepts mentions of the current Feishu bot', () => {
  assert.equal(isFeishuBotMentioned([
    { mentioned_type: 'user', id: { open_id: 'ou_user' } },
    { mentioned_type: 'bot', id: { open_id: 'ou_other_bot' } },
  ], 'ou_current_bot'), false)
  assert.equal(isFeishuBotMentioned([
    { mentioned_type: 'bot', id: { open_id: 'ou_current_bot' } },
  ], 'ou_current_bot'), true)
})

test('ignores messages sent by bots', () => {
  assert.equal(isFeishuUserMessage('user'), true)
  assert.equal(isFeishuUserMessage('bot'), false)
  assert.equal(isFeishuUserMessage(), false)
})
