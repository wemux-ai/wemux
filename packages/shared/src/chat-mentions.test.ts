import assert from 'node:assert/strict'
import test from 'node:test'

import { hasAllMention, resolveChatMentionRanges, resolveChatMentionTargetIds } from './chat-mentions'

const targets = [
  { id: 'agent-1', name: 'Dev' },
  { id: 'agent-2', name: 'Dev Ops' },
  { id: 'user-1', name: 'Ada' },
]

test('resolves complete chat mentions by message order and only once per target', () => {
  assert.deepEqual(
    resolveChatMentionTargetIds('@Dev Ops please check this, then @Ada and @Dev.', targets),
    ['agent-2', 'user-1', 'agent-1'],
  )
  assert.deepEqual(resolveChatMentionTargetIds('@Ada @Ada', targets), ['user-1'])
})

test('does not treat name substrings or email fragments as chat mentions', () => {
  assert.deepEqual(resolveChatMentionTargetIds('@Developer and mail@Ada.example', targets), [])
})

test('resolveChatMentionRanges returns all occurrence ranges, deduped only by overlap', () => {
  assert.deepEqual(
    resolveChatMentionRanges('@Dev Ops please check this, then @Ada and @Dev.', targets),
    [
      { targetId: 'agent-2', start: 0, end: 8 },
      { targetId: 'user-1', start: 33, end: 37 },
      { targetId: 'agent-1', start: 42, end: 46 },
    ],
  )
  // 同一目标多次出现都保留（渲染要全部高亮）
  assert.deepEqual(resolveChatMentionRanges('@Ada @Ada', targets), [
    { targetId: 'user-1', start: 0, end: 4 },
    { targetId: 'user-1', start: 5, end: 9 },
  ])
})

test('resolveChatMentionRanges ignores substrings and emails', () => {
  assert.deepEqual(resolveChatMentionRanges('@Developer and mail@Ada.example', targets), [])
})

test('hasAllMention 识别 @所有人/@all/@everyone，忽略子串与邮箱', () => {
  assert.equal(hasAllMention('请 @所有人 关注这条消息'), true)
  assert.equal(hasAllMention('please check @all thanks'), true)
  assert.equal(hasAllMention('hello @everyone!'), true)
  assert.equal(hasAllMention('no mention here'), false)
  assert.equal(hasAllMention('mail@all.example 不是提及'), false)
  assert.equal(hasAllMention('@allHands 不是别名'), false)
})
