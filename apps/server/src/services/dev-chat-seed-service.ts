// [INPUT]: 无（幂等 seed 调用）
// [OUTPUT]: 聊天 E2E 测试数据：组织 + 群聊 G/G2 + Agent X/Y + Drive 文件 + 会话
// [POS]: dev 聊天 E2E seed；幂等（重复调用不重复创建），配合 dev 登录账号 chat-test-a/b/c
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md 与 docs/TESTING-STRATEGY.md

import { addConversationMember, createWorkspaceGroupConversation, createWorkspaceGroupSession } from '../control-plane/conversation-service'
import { addTeamMember, createTeam } from '../storage/postgres/auth-store'
import { ensurePasswordUserProfile } from '../repositories/auth'
import { getUserAgents, registerAgent } from '../storage/postgres/agent-store'
import { registerDriveFile } from '../repositories/drive-store'
import { listUserWorkspaces } from '../repositories/workspace'
import { listConversationMembers, listGroupSessions, listWorkspaceGroupConversations } from '../storage/postgres/conversation-store'

const SEED_PREFIX = 'e2e-chat'

const TEST_ACCOUNTS = [
  { accountId: 'chat-test-a', name: 'Chat Test Alice', email: 'chat-test-a@test.com' },
  { accountId: 'chat-test-b', name: 'Chat Test Bob', email: 'chat-test-b@test.com' },
  { accountId: 'chat-test-c', name: 'Chat Test Carol', email: 'chat-test-c@test.com' },
] as const

const resolveTestUsers = async () => {
  const users: Record<'alice' | 'bob' | 'carol', { id: string; name: string }> = { alice: { id: '', name: '' }, bob: { id: '', name: '' }, carol: { id: '', name: '' } }
  for (const account of TEST_ACCOUNTS) {
    const profile = await ensurePasswordUserProfile({
      email: account.email,
      password: '123456',
      name: account.name,
      isInternal: true,
      onboardingCompletedAt: new Date().toISOString(),
      onboardingDismissedAt: null,
      onboardingPath: 'quickstart',
    })
    if (account.accountId === 'chat-test-a') users.alice = { id: profile.id, name: profile.name }
    if (account.accountId === 'chat-test-b') users.bob = { id: profile.id, name: profile.name }
    if (account.accountId === 'chat-test-c') users.carol = { id: profile.id, name: profile.name }
  }
  return users
}

/**
 * 幂等创建聊天 E2E 测试数据（按固定名称/标题探测，重复调用不重复创建）。
 * 返回各账号 userId / workspace / 群聊 / 会话 / Agent id，供 spec 与手动测试使用。
 */
export const seedChatE2EData = async () => {
  const users = await resolveTestUsers()
  const aliceId = users.alice.id

  // ---------- 组织 W（owner=Alice，成员 A/B/C） ----------
  let workspaceId = ''
  const existingWorkspaces = await listUserWorkspaces(aliceId)
  const existingW = existingWorkspaces.find((workspace) => workspace.name === 'E2E 聊天组织')
  if (existingW) {
    workspaceId = existingW.id
  } else {
    const team = createTeam('E2E 聊天组织', aliceId)
    addTeamMember(team.id, users.bob.id, 'member')
    addTeamMember(team.id, users.carol.id, 'member')
    workspaceId = team.id
  }

  // ---------- 群聊 G「E2E 发布群」（成员 A/B/C + Agent X）+ 会话 ----------
  let groupId = ''
  const existingGroups = (await Promise.all(
    (await listUserWorkspaces(aliceId)).map((workspace) => listWorkspaceGroupConversations(workspace.id)),
  )).flat()
  const existingGroup = existingGroups.find((group) => group.title === 'E2E 发布群')
  if (existingGroup) {
    groupId = existingGroup.id
  } else {
    const group = createWorkspaceGroupConversation({
      workspaceId,
      title: 'E2E 发布群',
      createdBy: aliceId,
      description: '聊天 E2E 测试群聊（含 Agent X 成员）',
    })
    groupId = group.id
    addConversationMember({ conversationId: groupId, memberType: 'user', memberId: aliceId, role: 'owner' })
    addConversationMember({ conversationId: groupId, memberType: 'user', memberId: users.bob.id })
    addConversationMember({ conversationId: groupId, memberType: 'user', memberId: users.carol.id })
  }

  // 群聊会话（消息落点）
  let sessionId = ''
  const existingSessions = listGroupSessions(groupId)
  const mainSession = existingSessions.find((session) => session.title === '主会话')
  if (mainSession) {
    sessionId = mainSession.id
  } else {
    sessionId = createWorkspaceGroupSession({
      workspaceId,
      groupId,
      title: '主会话',
      createdBy: aliceId,
    }).id
  }

  // ---------- 群聊 G2「E2E 独立群」（仅 A，不含 Agent X） ----------
  let group2Id = ''
  const existingGroup2 = existingGroups.find((group) => group.title === 'E2E 独立群')
  if (existingGroup2) {
    group2Id = existingGroup2.id
  } else {
    const group2 = createWorkspaceGroupConversation({
      workspaceId,
      title: 'E2E 独立群',
      createdBy: aliceId,
      description: '聊天 E2E 独立群（不含 Agent X，验证非成员拒绝）',
    })
    group2Id = group2.id
    addConversationMember({ conversationId: group2Id, memberType: 'user', memberId: aliceId, role: 'owner' })
  }

  // ---------- Agent X（owner A，群 G 成员）/ Agent Y（owner A，不在任何群） ----------
  let agentXId = ''
  let agentYId = ''
  const ownedAgents = getUserAgents(aliceId)
  agentXId = ownedAgents.find((agent) => agent.name === 'E2E Agent X')?.id ?? ''
  if (!agentXId) {
    agentXId = registerAgent('E2E Agent X', 'custom', null, {}, aliceId).id
  }
  agentYId = ownedAgents.find((agent) => agent.name === 'E2E Agent Y')?.id ?? ''
  if (!agentYId) {
    agentYId = registerAgent('E2E Agent Y', 'custom', null, {}, aliceId).id
  }

  // 确保 Agent X 是群 G 成员（幂等）
  const gMembers = listConversationMembers(groupId)
  if (!gMembers.some((member) => member.memberType === 'agent' && member.memberId === agentXId)) {
    addConversationMember({ conversationId: groupId, memberType: 'agent', memberId: agentXId })
  }

  // ---------- Drive 文件（个人域 + 团队域，含同名） ----------
  await registerDriveFile(aliceId, { workspaceId: null, name: '需求文档.md', mimeType: 'text/markdown', s3Key: `${SEED_PREFIX}/personal/requirement.md`, contentType: 'document', searchText: '聊天 E2E 需求文档', visibility: 'private' })
  await registerDriveFile(aliceId, { workspaceId: null, name: '设计稿.png', mimeType: 'image/png', s3Key: `${SEED_PREFIX}/personal/design.png`, contentType: 'image', visibility: 'private' })
  await registerDriveFile(aliceId, { workspaceId, name: '发布计划.md', mimeType: 'text/markdown', s3Key: `${SEED_PREFIX}/team/release.md`, contentType: 'document', searchText: 'E2E 发布计划', visibility: 'team' })
  await registerDriveFile(aliceId, { workspaceId, name: '需求文档.md', mimeType: 'text/markdown', s3Key: `${SEED_PREFIX}/team/requirement.md`, contentType: 'document', searchText: '团队同名需求文档', visibility: 'team' })

  return {
    userIds: { alice: aliceId, bob: users.bob.id, carol: users.carol.id },
    workspaceId,
    groupId,
    sessionId,
    group2Id,
    agentIds: { agentX: agentXId, agentY: agentYId },
  }
}
