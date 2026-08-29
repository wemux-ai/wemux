import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTaskCommentReplyDraft, insertTaskCommentMention, resolveEditedTaskCommentMentions, resolveTaskCommentDispatchPreviewMeta, resolveTaskCommentMentionQuery, resolveTaskCommentReplyMentionOption, toTaskCommentMentionCandidate } from './task-comment-mention'

test('mention query is detected only at a token boundary', () => {
  assert.deepEqual(resolveTaskCommentMentionQuery('请 @review', 9), {
    query: 'review',
    start: 2,
    cursor: 9,
  })
  assert.equal(resolveTaskCommentMentionQuery('mail@example.com', 16), null)
})

test('selected mention replaces the active query and preserves suffix text', () => {
  assert.deepEqual(insertTaskCommentMention({
    value: '请 @rev 处理',
    label: 'Reviewer',
    start: 2,
    cursor: 6,
  }), {
    value: '请 @Reviewer 处理',
    cursor: 11,
  })
})

test('mention options normalize user and Agent target ids', () => {
  assert.deepEqual(toTaskCommentMentionCandidate({ id: 'user-1', email: '', name: 'Alice', kind: 'user' }), {
    targetType: 'user',
    targetId: 'user-1',
  })
  assert.deepEqual(toTaskCommentMentionCandidate({ id: 'agent:agent-1', email: '', name: 'Agent', kind: 'agent' }), {
    targetType: 'agent',
    targetId: 'agent-1',
  })
})

test('reply mention resolves the exact human or Agent author option', () => {
  const options = [
    { id: 'user-1', email: 'alice@example.com', name: 'Alice', kind: 'user' as const },
    { id: 'agent:agent-1', email: '', name: 'CEO', kind: 'agent' as const },
  ]

  assert.equal(resolveTaskCommentReplyMentionOption({
    id: 'comment-user',
    authorType: 'user',
    authorId: 'user-1',
    content: '请看一下',
    createdAt: '2026-07-23T00:00:00.000Z',
  }, options)?.id, 'user-1')
  assert.equal(resolveTaskCommentReplyMentionOption({
    id: 'comment-agent',
    authorType: 'agent',
    authorId: 'agent-1',
    content: '需要补充',
    createdAt: '2026-07-23T00:00:00.000Z',
  }, options)?.id, 'agent:agent-1')
})

test('reply draft prepends the author mention and keeps its structured target', () => {
  const agent = { id: 'agent:agent-1', email: '', name: 'CEO', kind: 'agent' as const }
  const draft = buildTaskCommentReplyDraft({
    comment: {
      id: 'comment-agent',
      authorType: 'agent',
      authorId: 'agent-1',
      content: '需要补充',
      createdAt: '2026-07-23T00:00:00.000Z',
    },
    value: '你好',
    selectedMentions: [],
    mentionOptions: [agent],
  })

  assert.equal(draft.value, '@CEO 你好')
  assert.equal(draft.cursor, 5)
  assert.deepEqual(draft.selectedMentions, [agent])
  assert.equal(draft.mentionAdded, true)
})

test('reply mention ignores deleted and system comments', () => {
  const options = [{ id: 'agent:agent-1', email: '', name: 'CEO', kind: 'agent' as const }]

  assert.equal(resolveTaskCommentReplyMentionOption({
    id: 'comment-deleted',
    authorType: 'agent',
    authorId: 'agent-1',
    content: '',
    deletedAt: '2026-07-23T00:01:00.000Z',
    createdAt: '2026-07-23T00:00:00.000Z',
  }, options), undefined)
  assert.equal(resolveTaskCommentReplyMentionOption({
    id: 'comment-system',
    authorType: 'system',
    authorId: 'agent-1',
    content: '系统事件',
    createdAt: '2026-07-23T00:00:00.000Z',
  }, options), undefined)
})

test('edited comments keep only mentions still present in text and deduplicate resolved options', () => {
  const mentions = resolveEditedTaskCommentMentions({
    id: 'comment-1',
    authorType: 'user',
    authorId: 'user-1',
    content: '@Agent @Alice old request',
    mentions: [
      { targetType: 'agent', targetId: 'agent-1', targetName: 'Agent' },
      { targetType: 'user', targetId: 'user-1', targetName: 'Alice' },
    ],
    createdAt: '2026-07-22T00:00:00.000Z',
  }, '@Agent updated request', [
    { id: 'agent:agent-1', email: '', name: 'Agent', kind: 'agent' },
    { id: 'user-1', email: '', name: 'Alice', kind: 'user' },
  ])

  assert.deepEqual(mentions, [{ targetType: 'agent', targetId: 'agent-1' }])
})

test('server comment preview outcomes become explicit user-facing actions', () => {
  assert.deepEqual(resolveTaskCommentDispatchPreviewMeta({
    targetType: 'agent',
    targetId: 'agent-1',
    targetName: 'Reviewer',
    status: 'coalesced',
  }), {
    label: '将合并到 Reviewer 的待处理轮',
    tone: 'agent',
  })
  assert.deepEqual(resolveTaskCommentDispatchPreviewMeta({
    targetType: 'agent',
    targetId: 'agent-1',
    targetName: 'Reviewer',
    status: 'blocked',
    message: '执行节点离线。',
  }), {
    label: 'Reviewer 不会触发：执行节点离线。',
    tone: 'blocked',
  })
})
