import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGroupSchema, isAgentVisibleInWorkspaceChatPicker, resolveMentionedConversationIds, resolveMentionedGroupIds, updateGroupSchema } from './workspace-group-chat-routes'
import { resolveMentionedWorkspaceIds } from '../control-plane/conversation-service'

test('群聊选择器只列自己的 Agent 或已归属该组织的共享 Agent', () => {
  // 自己的 Agent（未绑定任何组织）可见
  assert.equal(isAgentVisibleInWorkspaceChatPicker('owner-1', [], { userId: 'owner-1', workspaceId: 'workspace-1' }), true)
  // 其他用户的未绑定 Agent（如各自自动创建的 CEO Agent）不可见
  assert.equal(isAgentVisibleInWorkspaceChatPicker('owner-1', [], { userId: 'member-2', workspaceId: 'workspace-1' }), false)
  // 已归属该组织的共享 Agent 对其他成员可见
  assert.equal(isAgentVisibleInWorkspaceChatPicker('owner-1', ['workspace-1'], { userId: 'member-2', workspaceId: 'workspace-1' }), true)
  // 归属其他组织的 Agent 不可见
  assert.equal(isAgentVisibleInWorkspaceChatPicker('owner-1', ['workspace-2'], { userId: 'member-2', workspaceId: 'workspace-1' }), false)
})

test('resolveMentionedConversationIds 按会话标题解析 @会话', () => {
  const conversations = [
    { id: 'c1', title: '主会话' },
    { id: 'c2', title: '需求讨论' },
    { id: 'c3', title: '发布计划' },
  ]
  const mentioned = resolveMentionedConversationIds('请参考 @需求讨论 的结论，也看下 @发布计划', conversations)
  assert.deepEqual([...mentioned].sort(), ['c2', 'c3'])
})

test('resolveMentionedConversationIds 忽略无标题会话与未提及项', () => {
  const conversations = [
    { id: 'c1', title: '主会话' },
    { id: 'c2', title: '' },
  ]
  const mentioned = resolveMentionedConversationIds('hello @主会话 world', conversations)
  assert.deepEqual([...mentioned], ['c1'])
  const none = resolveMentionedConversationIds('没有提及任何会话', conversations)
  assert.equal(none.size, 0)
})

test('resolveMentionedGroupIds 按空间内分组名解析 @组名', () => {
  const groups = [
    { id: 'g1', name: '市场营销组' },
    { id: 'g2', name: '开发研发组' },
  ]
  const mentioned = resolveMentionedGroupIds('请 @开发研发组 的同学看下这个需求', groups)
  assert.deepEqual([...mentioned], ['g2'])
  const none = resolveMentionedGroupIds('没有提到任何组', groups)
  assert.equal(none.size, 0)
  const partial = resolveMentionedGroupIds('@营销 提到半截不算', groups)
  assert.equal(partial.size, 0)
})

test('resolveMentionedWorkspaceIds 按用户可见工作区名解析 @工作区', () => {
  const workspaces = [
    { id: 'w1', name: '产品研发部' },
    { id: 'w2', name: '市场运营中心' },
    { id: 'w3', name: '' },
  ]
  const mentioned = resolveMentionedWorkspaceIds('同步给 @产品研发部 和 @市场运营中心', workspaces)
  assert.deepEqual([...mentioned].sort(), ['w1', 'w2'])
  const none = resolveMentionedWorkspaceIds('没有提工作区', workspaces)
  assert.equal(none.size, 0)
  const partial = resolveMentionedWorkspaceIds('@研发 不算完整匹配', workspaces)
  assert.equal(partial.size, 0)
})

test('updateGroupSchema 接受 title/description/announcement 的单独或组合变更', () => {
  assert.deepEqual(updateGroupSchema.parse({ title: '新名字' }), { title: '新名字' })
  assert.deepEqual(updateGroupSchema.parse({ description: '  简介  ' }), { description: '简介' })
  assert.deepEqual(updateGroupSchema.parse({ announcement: '  公告  ' }), { announcement: '公告' })
  const combined = updateGroupSchema.parse({ description: '简介', announcement: '公告' })
  assert.equal(combined.description, '简介')
  assert.equal(combined.announcement, '公告')
})

test('updateGroupSchema 允许清空群简介与群公告（空串）', () => {
  assert.equal(updateGroupSchema.parse({ description: '' }).description, '')
  assert.equal(updateGroupSchema.parse({ announcement: '' }).announcement, '')
})

test('updateGroupSchema 拒绝空变更与超长内容', () => {
  assert.throws(() => updateGroupSchema.parse({}), /至少需要一个群聊设置变更/)
  assert.throws(() => updateGroupSchema.parse({ title: '   ' }))
  assert.throws(() => updateGroupSchema.parse({ description: 'x'.repeat(501) }))
  assert.throws(() => updateGroupSchema.parse({ announcement: 'x'.repeat(2001) }))
  assert.throws(() => updateGroupSchema.parse({ title: 'x'.repeat(81) }))
})

test('createGroupSchema 接受可选群简介并裁剪', () => {
  const payload = createGroupSchema.parse({
    title: '  发布群  ',
    description: '  简介  ',
    userMemberIds: ['u1'],
    agentMemberIds: ['a1'],
  })
  assert.equal(payload.title, '发布群')
  assert.equal(payload.description, '简介')
  assert.deepEqual(payload.userMemberIds, ['u1'])
  assert.deepEqual(payload.agentMemberIds, ['a1'])

  const withoutDescription = createGroupSchema.parse({ title: '发布群' })
  assert.equal(withoutDescription.description, undefined)
})
