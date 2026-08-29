import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TeamMember, WorkspaceChatAgentOption, WorkspaceChatGroupMember } from '../../lib/api'
import { filterGroupMembersByQuery, getMemberLabel, getMemberSearchText, memberKey } from './workspace-group-chat-members'

const members: TeamMember[] = [
  { id: 'u1', email: 'alice@example.com', name: 'Alice Zhang', createdAt: '', role: 'member' },
  { id: 'u2', email: 'bob@example.com', name: 'Bob Li', createdAt: '', role: 'admin' },
]

const agents: WorkspaceChatAgentOption[] = [
  { id: 'a1', name: 'Release Agent', role: '发布', avatarUrl: '/a1.png', status: 'online', kind: 'custom' },
]

const member = (memberType: 'user' | 'agent', memberId: string): WorkspaceChatGroupMember => ({
  id: `${memberType}:${memberId}`,
  conversationId: 'g1',
  memberType,
  memberId,
  role: 'member',
  joinedAt: '2026-08-13T00:00:00.000Z',
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
})

test('memberKey 用类型与 id 拼出稳定键', () => {
  assert.equal(memberKey('user', 'u1'), 'user:u1')
  assert.equal(memberKey('agent', 'a1'), 'agent:a1')
})

test('getMemberLabel 解析用户与 Agent 的名称/角色/头像回退', () => {
  assert.deepEqual(getMemberLabel('user', 'u1', members, agents), {
    name: 'Alice Zhang',
    role: 'member',
    avatarUrl: undefined,
    fallback: 'AZ',
  })
  assert.deepEqual(getMemberLabel('agent', 'a1', members, agents), {
    name: 'Release Agent',
    role: '发布',
    avatarUrl: '/a1.png',
    fallback: 'RA',
  })
  assert.equal(getMemberLabel('user', 'unknown', members, agents).name, 'unknown')
})

test('getMemberSearchText 覆盖名称/角色/邮箱', () => {
  const text = getMemberSearchText(member('user', 'u1'), members, agents)
  assert.ok(text.includes('alice'))
  assert.ok(text.includes('member'))
  assert.ok(text.includes('alice@example.com'))
})

test('filterGroupMembersByQuery 空查询返回全部、命中名称/邮箱/角色、大小写不敏感', () => {
  const all = [member('user', 'u1'), member('user', 'u2'), member('agent', 'a1')]
  assert.equal(filterGroupMembersByQuery(all, '', members, agents).length, 3)

  const byName = filterGroupMembersByQuery(all, 'bob', members, agents)
  assert.deepEqual(byName.map((item) => item.memberId), ['u2'])

  const byEmail = filterGroupMembersByQuery(all, 'alice@example', members, agents)
  assert.deepEqual(byEmail.map((item) => item.memberId), ['u1'])

  const byRole = filterGroupMembersByQuery(all, '发布', members, agents)
  assert.deepEqual(byRole.map((item) => item.memberId), ['a1'])

  const caseInsensitive = filterGroupMembersByQuery(all, 'ALICE', members, agents)
  assert.deepEqual(caseInsensitive.map((item) => item.memberId), ['u1'])

  const none = filterGroupMembersByQuery(all, '不存在的成员', members, agents)
  assert.equal(none.length, 0)
})
