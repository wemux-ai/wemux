// [INPUT]: 全局搜索服务输入
// [OUTPUT]: 纯函数 + 可选 DB 集成行为断言
// [POS]: global-search-service 测试：snippet/pattern 纯函数恒跑；DB 用例在本地 Postgres 可用时执行，否则跳过
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'
// 必须先于任何 store 导入（db.ts 模块加载期解析连接串）
import './global-search-service.test-env'
import { inArray, sql } from 'drizzle-orm'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { globalSearch, _test } from './global-search-service'
import {
  agents,
  conversations,
  conversationMembers,
  driveFiles,
  messages,
  projects,
  skills,
  tasks,
  userProjects,
  users,
  workspaceSessionHistoryEvents,
  workspaceSessions,
  workspaces,
} from '../storage/postgres/schema'

// ── 纯函数（恒跑）──────────────────────────────────────────

test('toLikePattern 转义 LIKE 通配符', () => {
  assert.equal(_test.toLikePattern('abc'), '%abc%')
  assert.equal(_test.toLikePattern('50%'), '%50\\%%')
  assert.equal(_test.toLikePattern('a_b'), '%a\\_b%')
  assert.equal(_test.toLikePattern('a\\b'), '%a\\\\b%')
})

test('truncateSnippet 归一化空白并截断', () => {
  assert.equal(_test.truncateSnippet('  hello   world  '), 'hello world')
  assert.equal(_test.truncateSnippet(null), '')
  assert.equal(_test.truncateSnippet(undefined), '')
  const long = 'x'.repeat(300)
  const snippet = _test.truncateSnippet(long, 120)
  assert.ok(snippet.length <= 121)
  assert.ok(snippet.endsWith('…'))
})

test('globalSearch 空查询返回空数组', async () => {
  const results = await globalSearch({ query: '   ', userId: 'any-user' })
  assert.deepEqual(results, [])
})

// ── DB 集成（本地 Postgres 可用时执行）──────────────────────

const resolveDbUrl = () => process.env.DATABASE_URL?.trim()
  || process.env.POSTGRES_URL?.trim()
  || 'postgres://vibemux:vibemux@127.0.0.1:5434/vibemux'

let dbAvailable: boolean | null = null
const isDbAvailable = async (): Promise<boolean> => {
  if (dbAvailable !== null) {
    return dbAvailable
  }
  try {
    process.env.DATABASE_URL = resolveDbUrl()
    await getDrizzleDb().execute(sql`select 1`)
    dbAvailable = true
  } catch {
    dbAvailable = false
  }
  return dbAvailable
}

const dbSkip = async () => (await isDbAvailable()) ? false : '本地 Postgres 不可用，跳过 DB 集成用例'

const testUserId = `gs-test-user-${Date.now()}`
const otherUserId = `gs-test-other-${Date.now()}`
const cleanupIds: Record<string, string[]> = { users: [], projects: [], tasks: [], conversations: [], agents: [], skills: [], drives: [], workspaces: [], sessions: [], events: [] }

const cleanUp = async () => {
  const db = getDrizzleDb()
  if (cleanupIds.drives.length) await db.delete(driveFiles).where(inArray(driveFiles.id, cleanupIds.drives))
  if (cleanupIds.events.length) await db.delete(workspaceSessionHistoryEvents).where(inArray(workspaceSessionHistoryEvents.id, cleanupIds.events))
  if (cleanupIds.sessions.length) await db.delete(workspaceSessions).where(inArray(workspaceSessions.id, cleanupIds.sessions))
  if (cleanupIds.workspaces.length) await db.delete(workspaces).where(inArray(workspaces.id, cleanupIds.workspaces))
  if (cleanupIds.conversations.length) {
    await db.delete(conversationMembers).where(inArray(conversationMembers.conversationId, cleanupIds.conversations))
    await db.delete(messages).where(inArray(messages.conversationId, cleanupIds.conversations))
    await db.delete(conversations).where(inArray(conversations.id, cleanupIds.conversations))
  }
  if (cleanupIds.tasks.length) await db.delete(tasks).where(inArray(tasks.id, cleanupIds.tasks))
  if (cleanupIds.projects.length) {
    await db.delete(userProjects).where(inArray(userProjects.projectId, cleanupIds.projects))
    await db.delete(projects).where(inArray(projects.id, cleanupIds.projects))
  }
  if (cleanupIds.agents.length) await db.delete(agents).where(inArray(agents.id, cleanupIds.agents))
  if (cleanupIds.skills.length) await db.delete(skills).where(inArray(skills.id, cleanupIds.skills))
  if (cleanupIds.users.length) await db.delete(users).where(inArray(users.id, cleanupIds.users))
}

const insertUser = async (id: string, name: string, email: string) => {
  await getDrizzleDb().insert(users).values({
    id,
    email,
    passwordHash: 'x',
    name,
    authProvider: 'password',
    isInternal: false,
    status: 'active',
    createdAt: new Date().toISOString(),
  })
  cleanupIds.users.push(id)
}

const insertProject = async (id: string, name: string, ownerId: string) => {
  const now = new Date().toISOString()
  await getDrizzleDb().insert(projects).values({
    id,
    name,
    visibility: 'workspace',
    gitUrl: `https://example.com/${id}.git`,
    localPath: `/tmp/${id}`,
    versionControl: 'git-remote',
    defaultBranch: 'main',
    commandPresetsJson: [],
    recentBaseBranchesJson: [],
    createdBy: ownerId,
    createdAt: now,
    updatedAt: now,
  })
  cleanupIds.projects.push(id)
}

const insertTask = async (id: string, projectId: string, title: string, description: string) => {
  const now = new Date().toISOString()
  await getDrizzleDb().insert(tasks).values({
    id,
    projectId,
    title,
    description,
    status: 'todo',
    agentType: 'OpenCode',
    executionMode: 'auto',
    agentManaged: 'none',
    priority: 'medium',
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
    baseBranch: 'main',
    requirementType: 'task',
    needsHumanConfirm: false,
    agentRunningStatus: 'idle',
    currentStep: '',
  })
  cleanupIds.tasks.push(id)
}

const insertConversation = async (params: {
  id: string
  kind: 'main' | 'dm' | 'workspace'
  title: string
  createdBy?: string
  visibility?: 'public' | 'private'
  workspaceId?: string
  memberIds?: string[]
  messageContent?: string
}) => {
  const now = new Date().toISOString()
  await getDrizzleDb().insert(conversations).values({
    id: params.id,
    title: params.title,
    kind: params.kind,
    chatMode: params.kind === 'workspace' ? 'group' : 'direct',
    status: 'active',
    externalSyncMode: 'internal',
    visibility: params.visibility ?? 'private',
    workspaceId: params.workspaceId,
    createdBy: params.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  })
  cleanupIds.conversations.push(params.id)
  for (const memberId of params.memberIds ?? []) {
    await getDrizzleDb().insert(conversationMembers).values({
      id: `gs-cm-${params.id}-${memberId}`,
      conversationId: params.id,
      memberType: 'user',
      memberId,
      role: 'member',
      createdAt: now,
      updatedAt: now,
    })
  }
  if (params.messageContent) {
    await getDrizzleDb().insert(messages).values({
      id: `gs-msg-${params.id}`,
      conversationId: params.id,
      senderId: params.createdBy,
      content: params.messageContent,
      contentType: 'text',
      role: 'user',
      seq: 1,
      createdAt: now,
    })
  }
}

const insertWorkspaceAndSession = async (workspaceId: string, sessionId: string, name: string, sessionTitle: string, ownerId: string, projectId: string) => {
  const now = new Date().toISOString()
  await getDrizzleDb().insert(workspaces).values({
    id: workspaceId,
    projectId,
    executorNodeId: 'node-test',
    agentType: 'OpenCode',
    name,
    status: 'ready',
    repoReady: true,
    source: 'manual',
    workingDirectoryMode: 'worktree',
    ownerUserId: ownerId,
    createdAt: now,
    updatedAt: now,
  })
  cleanupIds.workspaces.push(workspaceId)
  await getDrizzleDb().insert(workspaceSessions).values({
    id: sessionId,
    workspaceId,
    title: sessionTitle,
    titleOrigin: 'manual',
    status: 'active',
    sessionKind: 'primary',
    sessionRole: 'general',
    sessionOrigin: 'manual',
    publishPolicy: 'none',
    gitAuthPreference: 'project-default',
    worktreeId: 'wt-test',
    branchName: 'main',
    worktreeStatus: 'cleaned',
    workingDirectoryMode: 'worktree',
    needsHumanConfirm: false,
    agentRunningStatus: 'idle',
    runtimeStatus: 'completed',
    runtimeSequence: 0,
    currentStep: '',
    lastActiveAt: now,
    createdAt: now,
    updatedAt: now,
  })
  cleanupIds.sessions.push(sessionId)
}

test('chat：主对话按 owner 可见，他人会话不可见', { skip: await dbSkip() }, async (t) => {
  await insertUser(testUserId, 'GS 测试用户', `gs-${testUserId}@example.com`)
  const myId = `gs-chat-main-${Date.now()}`
  const otherId = `gs-chat-main-other-${Date.now()}`
  await insertConversation({ id: myId, kind: 'main', title: 'Pegasus 发布讨论', createdBy: testUserId, messageContent: '关于 pegasus 的发布安排' })
  await insertConversation({ id: otherId, kind: 'main', title: 'Pegasus 机密计划', createdBy: otherUserId })

  t.after(cleanUp)
  const results = await globalSearch({ query: 'pegasus', userId: testUserId, type: 'chat' })
  const ids = results.map((result) => result.id)
  assert.ok(ids.includes(myId), '应命中本人主对话')
  assert.ok(!ids.includes(otherId), '不应命中他人主对话')
  const myHit = results.find((result) => result.id === myId)
  assert.ok(myHit?.route === '/chat')
  assert.ok(myHit?.snippet.includes('pegasus'))
})

test('project/task：仅可访问项目内的任务可见', { skip: await dbSkip() }, async (t) => {
  await insertUser(testUserId, 'GS 项目用户', `gs-p-${testUserId}@example.com`)
  const projectId = `gs-project-${Date.now()}`
  const otherProjectId = `gs-project-other-${Date.now()}`
  await insertProject(projectId, 'Wemux 移动端', testUserId)
  await insertProject(otherProjectId, 'Wemux 移动端竞品', otherUserId)
  await getDrizzleDb().insert(userProjects).values({ userId: testUserId, projectId, accessType: 'owner' })
  await insertTask(`gs-task-${Date.now()}`, projectId, '实现全局搜索', 'Cmd+K 唤起命令面板，方向键导航')
  await insertTask(`gs-task-other-${Date.now()}`, otherProjectId, '实现全局搜索竞品', 'secret')

  t.after(cleanUp)
  const projectResults = await globalSearch({ query: '移动端', userId: testUserId, type: 'project' })
  assert.ok(projectResults.some((result) => result.id === projectId))
  assert.ok(!projectResults.some((result) => result.id === otherProjectId))

  const taskResults = await globalSearch({ query: '全局搜索', userId: testUserId, type: 'task' })
  assert.ok(taskResults.some((result) => result.title === '实现全局搜索'))
  assert.ok(!taskResults.some((result) => result.title === '实现全局搜索竞品'))
  const task = taskResults.find((result) => result.title === '实现全局搜索')
  assert.ok(task?.route.includes(`projectId=${projectId}`))
})

test('agent/contact/skill：按 owner 与目录搜索', { skip: await dbSkip() }, async (t) => {
  await insertUser(testUserId, 'GS Agent 用户', `gs-a-${testUserId}@example.com`)
  const now = new Date().toISOString()
  await getDrizzleDb().insert(agents).values({
    id: `gs-agent-${Date.now()}`,
    name: '运营小助手',
    type: 'custom',
    status: 'offline',
    configJson: {},
    ownerUserId: testUserId,
    createdAt: now,
    updatedAt: now,
  })
  cleanupIds.agents.push(`gs-agent-${Date.now()}`)
  await getDrizzleDb().insert(skills).values({
    id: `gs-skill-${Date.now()}`,
    slug: `gs-skill-${Date.now()}`,
    name: '竞品雷达',
    description: '定时扫描竞品动态',
    markdown: '# 竞品雷达',
    sourceType: 'manual',
    enabled: true,
    visibility: 'private',
    ownerUserId: testUserId,
    trustLevel: 'markdown_only',
    compatibility: 'compatible',
    fileInventoryJson: [],
    filesJson: {},
    categoriesJson: [],
    createdAt: now,
    updatedAt: now,
  })
  cleanupIds.skills.push(`gs-skill-${Date.now()}`)

  t.after(cleanUp)
  const agentResults = await globalSearch({ query: '运营小助手', userId: testUserId, type: 'agent' })
  assert.equal(agentResults.length, 1)
  assert.ok(agentResults[0]?.route.includes('/agents?agentId='))

  const skillResults = await globalSearch({ query: '竞品雷达', userId: testUserId, type: 'skill' })
  assert.equal(skillResults.length, 1)

  const contactResults = await globalSearch({ query: 'GS Agent 用户', userId: testUserId, type: 'contact' })
  assert.ok(contactResults.some((result) => result.id === testUserId))
})

test('workspace/session：本人工作区与会话可见', { skip: await dbSkip() }, async (t) => {
  await insertUser(testUserId, 'GS 工作区用户', `gs-w-${testUserId}@example.com`)
  const projectId = `gs-project-ws-${Date.now()}`
  await insertProject(projectId, 'GS 工作区项目', testUserId)
  const workspaceId = `gs-workspace-${Date.now()}`
  const sessionId = `gs-session-${Date.now()}`
  await insertWorkspaceAndSession(workspaceId, sessionId, '支付重构工作区', '支付重构第 2 轮', testUserId, projectId)

  t.after(cleanUp)
  const sessionResults = await globalSearch({ query: '支付重构', userId: testUserId, type: 'chat' })
  assert.ok(sessionResults.some((result) => result.id === sessionId && result.route.includes('workspaceSessionId')))
  const workspaceResults = await globalSearch({ query: '支付重构', userId: testUserId, type: 'workspace' })
  assert.ok(workspaceResults.some((result) => result.id === workspaceId && result.route.includes('workspaceId')))
})

test('drive：个人文件命中 name', { skip: await dbSkip() }, async (t) => {
  await insertUser(testUserId, 'GS Drive 用户', `gs-d-${testUserId}@example.com`)
  const now = new Date().toISOString()
  await getDrizzleDb().insert(driveFiles).values({
    id: `gs-drive-${Date.now()}`,
    name: '季度复盘报告.md',
    fileType: 'file',
    contentType: 'document',
    mimeType: 'text/markdown',
    searchText: '本季度核心数据与复盘结论',
    createdBy: testUserId,
    createdAt: now,
    updatedAt: now,
  })
  cleanupIds.drives.push(`gs-drive-${Date.now()}`)

  t.after(cleanUp)
  const results = await globalSearch({ query: '季度复盘', userId: testUserId, type: 'drive' })
  assert.equal(results.length, 1)
  assert.equal(results[0]?.route, '/drive')
})

test('type 过滤：仅返回指定类型', { skip: await dbSkip() }, async (t) => {
  await insertUser(testUserId, 'GS 过滤用户', `gs-f-${testUserId}@example.com`)
  const projectId = `gs-project-filter-${Date.now()}`
  await insertProject(projectId, 'Alpha 过滤项目', testUserId)
  await getDrizzleDb().insert(userProjects).values({ userId: testUserId, projectId, accessType: 'owner' })

  t.after(cleanUp)
  const results = await globalSearch({ query: 'alpha', userId: testUserId, type: 'project' })
  assert.ok(results.length > 0)
  assert.ok(results.every((result) => result.type === 'project'))
})

test('chat：消息正文命中（标题不含关键词），snippet 含命中文本', { skip: await dbSkip() }, async (t) => {
  await insertUser(testUserId, 'GS 正文用户', `gs-m-${testUserId}@example.com`)
  const conversationId = `gs-conv-content-${Date.now()}`
  await insertConversation({
    id: conversationId,
    kind: 'dm',
    title: '日常闲聊',
    createdBy: testUserId,
    memberIds: [testUserId],
    messageContent: '这个季度的预算数字还没对齐，周五前确认',
  })

  t.after(cleanUp)
  const results = await globalSearch({ query: '预算数字', userId: testUserId, type: 'chat' })
  const hit = results.find((result) => result.id === conversationId)
  assert.ok(hit, '应通过消息正文命中会话')
  assert.equal(hit?.title, '日常闲聊')
  assert.ok(hit?.snippet.includes('预算数字'), 'snippet 应为命中消息内容')
})

test('chat：他人会话的消息正文不可见（作用域隔离）', { skip: await dbSkip() }, async (t) => {
  await insertUser(testUserId, 'GS 隔离用户', `gs-i-${testUserId}@example.com`)
  await insertUser(otherUserId, 'GS 他人', `gs-io-${otherUserId}@example.com`)
  const conversationId = `gs-conv-isolated-${Date.now()}`
  await insertConversation({
    id: conversationId,
    kind: 'dm',
    title: '机密讨论',
    createdBy: otherUserId,
    memberIds: [otherUserId],
    messageContent: '绝密预算方案只给我看',
  })

  t.after(cleanUp)
  const results = await globalSearch({ query: '绝密预算', userId: testUserId, type: 'chat' })
  assert.ok(!results.some((result) => result.id === conversationId), '不应命中他人会话正文')
})

test('workspace session：transcript 正文命中', { skip: await dbSkip() }, async (t) => {
  await insertUser(testUserId, 'GS Transcript 用户', `gs-t-${testUserId}@example.com`)
  const projectId = `gs-project-transcript-${Date.now()}`
  await insertProject(projectId, 'GS Transcript 项目', testUserId)
  const workspaceId = `gs-ws-transcript-${Date.now()}`
  const sessionId = `gs-session-transcript-${Date.now()}`
  await insertWorkspaceAndSession(workspaceId, sessionId, 'Transcript 工作区', '第 1 轮', testUserId, projectId)
  const now = new Date().toISOString()
  await getDrizzleDb().insert(workspaceSessionHistoryEvents).values({
    id: `gs-event-transcript-${Date.now()}`,
    sessionId,
    workspaceId,
    turnId: `gs-turn-${Date.now()}`,
    sessionSeq: 1,
    turnSeq: 1,
    kind: 'user_message',
    visibility: 'public',
    payloadJson: { messageId: `gs-msg-transcript-${Date.now()}`, text: '帮我处理 Stripe 订阅退款流程' },
    createdAt: now,
  })
  cleanupIds.events.push(`gs-event-transcript-${Date.now()}`)

  t.after(cleanUp)
  const results = await globalSearch({ query: 'Stripe 订阅退款', userId: testUserId, type: 'chat' })
  const hit = results.find((result) => result.id === sessionId)
  assert.ok(hit, '应通过 transcript 正文命中工作区会话')
  assert.ok(hit?.route.includes('workspaceSessionId'))
  assert.ok(hit?.snippet.includes('Stripe'), 'snippet 应为命中 transcript 文本')
})

test('contact：无关联用户不可见（隐私隔离）', { skip: await dbSkip() }, async (t) => {
  await insertUser(testUserId, 'GS 关联用户', `gs-r-${testUserId}@example.com`)
  await insertUser(otherUserId, 'GS 无关用户', `gs-ru-${otherUserId}@example.com`)

  t.after(cleanUp)
  const results = await globalSearch({ query: 'GS 无关用户', userId: testUserId, type: 'contact' })
  assert.equal(results.length, 0, '不应搜到无关联用户')
  const selfResults = await globalSearch({ query: 'GS 关联用户', userId: testUserId, type: 'contact' })
  assert.equal(selfResults.length, 1, '应能搜到自己')
})
