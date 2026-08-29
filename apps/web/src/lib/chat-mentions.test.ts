import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildConversationMentionOptions,
  buildPersonMentionOptions,
  buildPersonMentionTargets,
  buildWorkspaceMentionOptions,
  findActiveMentionRange,
  replaceMentionRange,
  type MentionablePerson,
} from './chat-mentions'

test('findActiveMentionRange 识别中文 @ 文档名', () => {
  assert.deepEqual(
    findActiveMentionRange('看一下 @需求文', 8),
    { start: 4, end: 8, query: '需求文' },
  )
})

test('findActiveMentionRange 英文 @ 名', () => {
  assert.deepEqual(
    findActiveMentionRange('hello @spec', 10),
    { start: 6, end: 11, query: 'spec' },
  )
})

test('findActiveMentionRange 无 @ 返回 null', () => {
  assert.equal(findActiveMentionRange('普通文本', 2), null)
})

test('findActiveMentionRange @ 后跟空格不匹配', () => {
  assert.equal(findActiveMentionRange('@ ', 2), null)
})

test('findActiveMentionRange 单词中 @ 不匹配', () => {
  assert.equal(findActiveMentionRange('foo@bar', 6), null)
})

test('replaceMentionRange 替换为 @文档名 并补空格', () => {
  const range = findActiveMentionRange('看一下 @需求文', 8)!
  const result = replaceMentionRange('看一下 @需求文', range, '需求文档.md')
  assert.equal(result.value, '看一下 @需求文档.md ')
  assert.equal(result.caret, '看一下 @需求文档.md '.length)
})

test('replaceMentionRange 句尾不重复补空格', () => {
  const range = findActiveMentionRange('@spec', 5)!
  const result = replaceMentionRange('@spec', range, 'spec-v2')
  assert.equal(result.value, '@spec-v2 ')
})

test('buildPersonMentionOptions 用户成员选项', () => {
  const people: MentionablePerson[] = [
    { id: 'u1', name: '张三', avatarUrl: ' /a.png ', description: '成员', keywords: ['zs'] },
    { id: 'u2', name: '李四' },
    { id: '', name: '空 id 被过滤' },
    { id: 'u3', name: '  ' },
  ]
  const options = buildPersonMentionOptions(people, '成员')
  assert.equal(options.length, 2)
  assert.deepEqual(options[0], {
    id: 'member:u1',
    kind: 'member',
    label: '张三',
    description: '成员',
    avatarUrl: '/a.png',
    kindLabel: '成员',
    keywords: ['张三', 'zs'],
  })
  assert.equal(options[1]!.id, 'member:u2')
})

test('buildPersonMentionOptions Agent 选项用 agent 前缀', () => {
  const options = buildPersonMentionOptions([{ id: 'a1', name: 'Vibemux', kind: 'agent' }], '成员')
  assert.equal(options[0]!.id, 'agent:a1')
  assert.equal(options[0]!.kind, 'agent')
})

test('buildPersonMentionTargets 只保留真实用户且 trim 头像', () => {
  const targets = buildPersonMentionTargets([
    { id: 'u1', name: '张三', avatarUrl: ' /b.png ' },
    { id: 'a1', name: 'Vibemux', kind: 'agent' },
  ])
  assert.deepEqual(targets, [{ id: 'u1', name: '张三', avatarUrl: '/b.png' }])
})

test('buildConversationMentionOptions 按标题生成 @会话 候选并过滤无标题', () => {
  const options = buildConversationMentionOptions([
    { id: 'c1', title: '需求讨论' },
    { id: 'c2', title: '  ' },
    { id: 'c3' },
  ], '会话')
  assert.equal(options.length, 1)
  assert.deepEqual(options[0], {
    id: 'conversation:c1',
    kind: 'conversation',
    label: '需求讨论',
    description: '会话',
    kindLabel: '会话',
    keywords: ['需求讨论'],
  })
})

test('buildWorkspaceMentionOptions 生成 @工作区 候选', () => {
  const options = buildWorkspaceMentionOptions([
    { id: 'w1', name: '产品研发部', avatarUrl: ' /a.png ', description: '核心团队' },
    { id: 'w2', name: '' },
  ], '工作区')
  assert.equal(options.length, 1)
  assert.equal(options[0]!.id, 'workspace:w1')
  assert.equal(options[0]!.kind, 'workspace')
  assert.equal(options[0]!.label, '产品研发部')
  assert.equal(options[0]!.avatarUrl, '/a.png')
})
