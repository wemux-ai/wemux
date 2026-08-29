import './conversation-service.test-env'
import test from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

import { createTaskFromRequirement } from '@shared/task-orchestrator'
import type { Project } from '@shared/types'

import {
  appendTaskConversationMessage,
  copyTaskConversationScope,
  createDmConversation,
  createWorkspaceGroupConversation,
  deleteWorkspaceGroup,
  ensureDmConversation,
  findDmConversation,
  getTaskConversationWithMessages,
  getWorkspaceGroupConversationDetail,
  leaveWorkspaceGroup,
  listDmConversationsForUser,
  updateWorkspaceGroupAnnouncement,
  updateWorkspaceGroupConversationTitle,
  updateWorkspaceGroupProfile,
} from './conversation-service'
import { addConversationMember } from './conversation-service'
import { resolveConversationAccess } from './conversation-access'
import { initConversationStore } from '../storage/conversation-store'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'

const createProject = (): Project => ({
  id: 'project-1',
  name: 'Project One',
  gitUrl: 'https://example.com/repo.git',
  environmentTemplate: undefined,
  defaultBranch: 'main',
  recentBaseBranches: ['main'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

let dbAvailable: boolean | null = null
const isDbAvailable = async (): Promise<boolean> => {
  if (dbAvailable !== null) {
    return dbAvailable
  }
  try {
    await getDrizzleDb().execute(sql`select 1`)
    dbAvailable = true
  } catch {
    dbAvailable = false
  }
  return dbAvailable
}

const dbSkip = async () => (await isDbAvailable()) ? false : '本地 Postgres 不可用，跳过 DB 集成用例'


test('copyTaskConversationScope copies root task attachments into workspace session conversation', async () => {
  await initConversationStore().catch(() => {})

  const project = createProject()
  const task = createTaskFromRequirement(
    project,
    'Describe the issue from screenshots.',
    'medium',
    'Investigate screenshot issue',
    'none',
    'Codex',
    undefined,
    undefined,
    { workspaceRoot: '' },
    undefined,
  )

  appendTaskConversationMessage({
    task,
    project,
    role: 'user',
    senderId: 'user-1',
    content: '',
    contentType: 'json',
    externalRef: {
      attachments: [{
        id: 'image-1',
        url: '/uploads/images/example.png',
        filename: 'example.png',
        contentType: 'image/png',
      }],
    },
  })

  copyTaskConversationScope({
    task,
    project,
    targetWorkspaceId: 'workspace-1',
    targetWorkspaceSessionId: 'workspace-session-1',
  })

  const payload = getTaskConversationWithMessages(task, project, 'workspace-1', 'workspace-session-1')
  assert.equal(payload.messages.length, 1)
  assert.deepEqual(payload.messages[0]?.externalRef, {
    attachments: [{
      id: 'image-1',
      url: '/uploads/images/example.png',
      filename: 'example.png',
      contentType: 'image/png',
    }],
  })
})

test('getTaskConversationWithMessages expands backward pages to include the full leading turn', async () => {
  await initConversationStore().catch(() => {})

  const project = createProject()
  const task = createTaskFromRequirement(
    project,
    'Load complete workspace turns.',
    'medium',
    'Workspace conversation pagination',
    'none',
    'Codex',
    undefined,
    undefined,
    { workspaceRoot: '' },
    undefined,
  )

  const appendUserTurn = (turnId: string, userText: string, assistantTexts: string[]) => {
    appendTaskConversationMessage({
      task,
      project,
      role: 'user',
      senderId: 'user-1',
      content: userText,
      externalRef: {
        timelineEvent: {
          turnId,
          messageId: `${turnId}-user`,
        },
      },
    })

    for (const [index, assistantText] of assistantTexts.entries()) {
      appendTaskConversationMessage({
        task,
        project,
        role: 'assistant',
        senderId: 'agent-1',
        content: assistantText,
        externalRef: {
          timelineEvent: {
            turnId,
            messageId: `${turnId}-assistant-${index + 1}`,
          },
        },
      })
    }
  }

  appendUserTurn('turn-1', 'user 1', ['assistant 1'])
  appendUserTurn('turn-2', 'user 2', ['assistant 2a', 'assistant 2b'])
  appendUserTurn('turn-3', 'user 3', ['assistant 3'])

  const latestPayload = getTaskConversationWithMessages(task, project, undefined, undefined, {
    limit: 3,
  })
  assert.deepEqual(
    latestPayload.messages.map((message) => message.content),
    ['user 2', 'assistant 2a', 'assistant 2b', 'user 3', 'assistant 3'],
  )
  assert.equal(latestPayload.hasMoreBefore, true)

  const olderPayload = getTaskConversationWithMessages(task, project, undefined, undefined, {
    beforeMessageId: latestPayload.messages[0]?.id,
    limit: 1,
  })
  assert.deepEqual(
    olderPayload.messages.map((message) => message.content),
    ['user 1', 'assistant 1'],
  )
  assert.equal(olderPayload.hasMoreBefore, false)
})

test('updateWorkspaceGroupConversationTitle persists the normalized group name', async () => {
  await initConversationStore().catch(() => {})

  const workspaceId = `workspace-${crypto.randomUUID()}`
  const conversation = createWorkspaceGroupConversation({
    workspaceId,
    title: 'Original group',
    createdBy: 'user-1',
  })

  const updated = updateWorkspaceGroupConversationTitle(workspaceId, conversation.id, '  Release group  ')

  assert.equal(updated?.conversation.title, 'Release group')
  assert.equal(getWorkspaceGroupConversationDetail(workspaceId, conversation.id)?.conversation.title, 'Release group')
  assert.equal(updateWorkspaceGroupConversationTitle(workspaceId, conversation.id, '   '), null)
})

test('updateWorkspaceGroupProfile persists description and clears it when blank', async () => {
  await initConversationStore().catch(() => {})

  const workspaceId = `workspace-${crypto.randomUUID()}`
  const conversation = createWorkspaceGroupConversation({
    workspaceId,
    title: 'Release group',
    createdBy: 'user-1',
    description: '  Initial intro  ',
  })

  assert.equal(conversation.description, 'Initial intro')

  const updated = updateWorkspaceGroupProfile(workspaceId, conversation.id, { description: '  新的简介  ' })
  assert.equal(updated?.conversation.description, '新的简介')

  const cleared = updateWorkspaceGroupProfile(workspaceId, conversation.id, { description: '   ' })
  assert.equal(cleared?.conversation.description, undefined)
})

test('updateWorkspaceGroupAnnouncement records author/time and clears them on empty', async () => {
  await initConversationStore().catch(() => {})

  const workspaceId = `workspace-${crypto.randomUUID()}`
  const conversation = createWorkspaceGroupConversation({
    workspaceId,
    title: 'Release group',
    createdBy: 'user-1',
  })

  const updated = updateWorkspaceGroupAnnouncement(workspaceId, conversation.id, '  发布公告  ', 'user-1')
  assert.equal(updated?.conversation.announcement, '发布公告')
  assert.equal(updated?.conversation.announcementUpdatedBy, 'user-1')
  assert.ok(updated?.conversation.announcementUpdatedAt)

  const cleared = updateWorkspaceGroupAnnouncement(workspaceId, conversation.id, '   ', 'user-1')
  assert.equal(cleared?.conversation.announcement, undefined)
  assert.equal(cleared?.conversation.announcementUpdatedBy, undefined)
  assert.equal(cleared?.conversation.announcementUpdatedAt, undefined)
})

test('updateWorkspaceGroupProfile rejects empty payload without changes', async () => {
  await initConversationStore().catch(() => {})

  const workspaceId = `workspace-${crypto.randomUUID()}`
  const conversation = createWorkspaceGroupConversation({
    workspaceId,
    title: 'Release group',
    createdBy: 'user-1',
  })

  assert.equal(updateWorkspaceGroupProfile(workspaceId, conversation.id, {}), null)
  assert.equal(updateWorkspaceGroupProfile(workspaceId, 'missing-workspace', { title: 'x' }), null)
})

test('leaveWorkspaceGroup lets a non-owner member leave but blocks the owner', async () => {
  await initConversationStore().catch(() => {})

  const workspaceId = `workspace-${crypto.randomUUID()}`
  const conversation = createWorkspaceGroupConversation({
    workspaceId,
    title: 'Release group',
    createdBy: 'owner-1',
  })
  addConversationMember({ conversationId: conversation.id, memberType: 'user', memberId: 'member-1', role: 'member' })

  const left = leaveWorkspaceGroup(workspaceId, conversation.id, 'member-1')
  assert.ok(left)
  assert.ok(!left.members.some((member) => member.memberType === 'user' && member.memberId === 'member-1' && !member.leftAt))

  // 创建者不能直接退出
  assert.equal(leaveWorkspaceGroup(workspaceId, conversation.id, 'owner-1'), null)
})

test('deleteWorkspaceGroup removes the group and its sessions', async () => {
  await initConversationStore().catch(() => {})

  const workspaceId = `workspace-${crypto.randomUUID()}`
  const conversation = createWorkspaceGroupConversation({
    workspaceId,
    title: 'Release group',
    createdBy: 'owner-1',
  })
  addConversationMember({ conversationId: conversation.id, memberType: 'user', memberId: 'owner-1', role: 'owner' })

  assert.ok(getWorkspaceGroupConversationDetail(workspaceId, conversation.id))
  const result = deleteWorkspaceGroup(workspaceId, conversation.id)
  assert.deepEqual(result, { ok: true })
  assert.equal(getWorkspaceGroupConversationDetail(workspaceId, conversation.id), null)

  // 重复解散返回 null
  assert.equal(deleteWorkspaceGroup(workspaceId, conversation.id), null)
})

test('ensureDmConversation is idempotent and isolates by workspace scope', { skip: await dbSkip() }, async () => {
  await initConversationStore().catch(() => {})
  const suffix = Date.now()
  const userA = `dm-test-a-${suffix}`
  const userB = `dm-test-b-${suffix}`

  const first = ensureDmConversation({
    ownerUserId: userA,
    peerUserId: userB,
  })
  assert.equal(first.created, true)
  assert.equal(first.conversation.kind, 'dm')
  assert.equal(first.conversation.visibility, 'private')

  // 幂等：同一对用户复用同一会话
  const second = ensureDmConversation({
    ownerUserId: userA,
    peerUserId: userB,
  })
  assert.equal(second.created, false)
  assert.equal(second.conversation.id, first.conversation.id)
  assert.ok(findDmConversation({ ownerUserId: userA, peerUserId: userB }))

  // 方向无关：换发起方仍命中同一会话
  const reversed = ensureDmConversation({
    ownerUserId: userB,
    peerUserId: userA,
  })
  assert.equal(reversed.created, false)
  assert.equal(reversed.conversation.id, first.conversation.id)

  // 不同 workspace 作用域 → 独立会话
  const scoped = ensureDmConversation({
    ownerUserId: userA,
    peerUserId: userB,
    workspaceId: 'workspace-x',
  })
  assert.equal(scoped.created, true)
  assert.notEqual(scoped.conversation.id, first.conversation.id)

  // 允许自己和自己私聊（个人备忘会话，幂等 get-or-create）
  const selfFirst = ensureDmConversation({ ownerUserId: userA, peerUserId: userA })
  assert.equal(selfFirst.created, true)
  const selfAgain = ensureDmConversation({ ownerUserId: userA, peerUserId: userA })
  assert.equal(selfAgain.created, false)
  assert.equal(selfAgain.conversation.id, selfFirst.conversation.id)

  // createDmConversation：不查重直接新建（同一私聊对象可开多个会话），标题可自定义
  const newSession = createDmConversation({
    ownerUserId: userA,
    peerUserId: userB,
    title: '与 B 的私聊 2',
  })
  assert.equal(newSession.conversation.title, '与 B 的私聊 2')
  assert.notEqual(newSession.conversation.id, first.conversation.id)
  const listForA = listDmConversationsForUser(userA)
  const peerBSessions = listForA.filter((item) => (
    !item.conversation.workspaceId
    && item.members.some((member) => member.memberId === userB)
  ))
  assert.equal(peerBSessions.length, 2)
})

test('DM 权限：仅会话双方可见，第三方 403', { skip: await dbSkip() }, async () => {
  await initConversationStore().catch(() => {})
  const suffix = Date.now()
  const userA = `dm-perm-a-${suffix}`
  const userB = `dm-perm-b-${suffix}`
  const userC = `dm-perm-c-${suffix}`
  const { conversation } = ensureDmConversation({ ownerUserId: userA, peerUserId: userB })

  const accessA = await resolveConversationAccess({ conversationId: conversation.id, viewer: { type: 'user', id: userA } })
  assert.equal(accessA.ok, true)
  const accessB = await resolveConversationAccess({ conversationId: conversation.id, viewer: { type: 'user', id: userB } })
  assert.equal(accessB.ok, true)
  const accessC = await resolveConversationAccess({ conversationId: conversation.id, viewer: { type: 'user', id: userC } })
  assert.equal(accessC.ok, false)
})

test('listDmConversationsForUser returns only the conversations the user participates in', { skip: await dbSkip() }, async () => {
  await initConversationStore().catch(() => {})
  const suffix = Date.now()
  const userA = `dm-list-a-${suffix}`
  const userB = `dm-list-b-${suffix}`
  const userC = `dm-list-c-${suffix}`
  const userD = `dm-list-d-${suffix}`

  ensureDmConversation({ ownerUserId: userA, peerUserId: userB })
  ensureDmConversation({ ownerUserId: userC, peerUserId: userD })

  const forA = listDmConversationsForUser(userA)
  assert.equal(forA.length, 1)
  assert.equal(forA[0]?.conversation.kind, 'dm')
  assert.equal(forA[0]?.members.length, 2)

  const forC = listDmConversationsForUser(userC)
  assert.equal(forC.length, 1)
  assert.equal(listDmConversationsForUser(`dm-z-${suffix}`).length, 0)
})
