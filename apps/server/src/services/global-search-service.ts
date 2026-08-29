// [INPUT]: 已鉴权用户 + 搜索词/类型过滤
// [OUTPUT]: 按类型分组的全局搜索结果（SQL ILIKE 跨实体）
// [POS]: 全局搜索业务层；全部查询走 getDrizzleDb()，用户作用域在 SQL 层收紧（本人可见优先）；
//       drive 类型复用 drive-store.searchDriveFiles；主对话会话 = conversations kind='main'（thread 化后 owner 在 createdBy）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { GlobalSearchResult, GlobalSearchType } from '@shared/types'
import { searchDriveFiles, type DriveScope } from '../repositories/drive-store'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import {
  agents,
  collabWorkspaceMembers,
  collabWorkspaces,
  conversationMembers,
  conversations,
  messages,
  projects,
  skills,
  tasks,
  teamMembers,
  userProjects,
  users,
  workspaceSessionHistoryEvents,
  workspaceSessions,
  workspaces,
} from '../storage/postgres/schema'

export type GlobalSearchParams = {
  query: string
  userId: string
  /** 缺省搜全部类型 */
  type?: GlobalSearchType
  /** 每类上限，默认 10，最大 20 */
  limit?: number
}

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 20

const escapeLikePattern = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`)
const toLikePattern = (value: string) => `%${escapeLikePattern(value)}%`

const truncateSnippet = (value: string | null | undefined, maxLength = 120) => {
  if (!value) {
    return ''
  }
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength).trimEnd()}…`
}

const NONE_ID = '__none__'
const inArrayOrNone = (column: AnyPgColumn, ids: string[]) =>
  ids.length > 0 ? inArray(column, ids) : eq(column, NONE_ID)

/** 可见会话集合上限（防全表扫描，个人可见会话通常远小于此）。 */
const VISIBLE_CONVERSATION_LIMIT = 500
const VISIBLE_SESSION_LIMIT = 500

/** 当前用户可访问的项目 id（user_projects owner/member）。 */
const listAccessibleProjectIds = async (userId: string): Promise<string[]> => {
  const db = getDrizzleDb()
  const rows = await db
    .select({ projectId: userProjects.projectId })
    .from(userProjects)
    .where(eq(userProjects.userId, userId))
  return rows.map((row) => row.projectId)
}

/** 当前用户所在的协作工作区（collab_workspace_members）。 */
const listCollabWorkspaceIds = async (userId: string): Promise<string[]> => {
  const db = getDrizzleDb()
  const rows = await db
    .select({ workspaceId: collabWorkspaceMembers.workspaceId })
    .from(collabWorkspaceMembers)
    .where(eq(collabWorkspaceMembers.userId, userId))
  return rows.map((row) => row.workspaceId)
}

/** 当前用户是成员的会话 id（conversation_members，未离开）。 */
const listMemberConversationIds = async (userId: string): Promise<string[]> => {
  const db = getDrizzleDb()
  const rows = await db
    .select({ conversationId: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(and(
      eq(conversationMembers.memberType, 'user'),
      eq(conversationMembers.memberId, userId),
      isNull(conversationMembers.leftAt),
    ))
  return rows.map((row) => row.conversationId)
}

// ── 各类型查询 ──────────────────────────────────────────────

type SearcherContext = {
  userId: string
  pattern: string
  rawQuery: string
  limit: number
}

/** 会话可见条件：主对话按 owner（createdBy）或成员；非主对话按成员或所在协作工作区的公共会话。 */
const buildVisibleConversationCondition = (memberConversationIds: string[], collabWorkspaceIds: string[], userId: string) =>
  or(
    and(
      eq(conversations.kind, 'main'),
      or(eq(conversations.createdBy, userId), inArrayOrNone(conversations.id, memberConversationIds)),
    ),
    and(
      ne(conversations.kind, 'main'),
      or(
        inArrayOrNone(conversations.id, memberConversationIds),
        and(
          eq(conversations.visibility, 'public'),
          inArrayOrNone(conversations.workspaceId, collabWorkspaceIds),
        ),
      ),
    ),
  )

/** 会话：标题/简介命中 + 消息正文命中（主对话/群聊/DM 均覆盖）。 */
const searchChats = async (context: SearcherContext): Promise<GlobalSearchResult[]> => {
  const db = getDrizzleDb()
  const memberConversationIds = await listMemberConversationIds(context.userId)
  const collabWorkspaceIds = await listCollabWorkspaceIds(context.userId)
  const visibleCondition = buildVisibleConversationCondition(memberConversationIds, collabWorkspaceIds, context.userId)

  // 可见会话全集（用于限定消息正文搜索范围）
  const visibleRows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(visibleCondition)
    .orderBy(desc(conversations.updatedAt))
    .limit(VISIBLE_CONVERSATION_LIMIT)
  const visibleConversationIds = visibleRows.map((row) => row.id)

  // 标题/简介命中
  const titleRows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      description: conversations.description,
    })
    .from(conversations)
    .where(and(
      or(ilike(conversations.title, context.pattern), ilike(conversations.description, context.pattern)),
      visibleCondition,
    ))
    .orderBy(desc(conversations.updatedAt))
    .limit(context.limit)

  // 消息正文命中（每个会话取第一条命中消息作 snippet）
  const messageRows = await db
    .select({ conversationId: messages.conversationId, content: messages.content })
    .from(messages)
    .where(and(
      ilike(messages.content, context.pattern),
      inArrayOrNone(messages.conversationId, visibleConversationIds),
    ))
    .orderBy(desc(messages.seq), desc(messages.createdAt))
    .limit(context.limit * 3)
  const messageSnippetByConversation = new Map<string, string>()
  const messageHitConversationIds: string[] = []
  for (const row of messageRows) {
    if (!messageSnippetByConversation.has(row.conversationId)) {
      messageSnippetByConversation.set(row.conversationId, truncateSnippet(row.content, 100))
      messageHitConversationIds.push(row.conversationId)
    }
  }

  // 消息命中但标题未命中的会话标题
  const titleByConversation = new Map<string, string>()
  for (const row of titleRows) {
    titleByConversation.set(row.id, row.title)
  }
  const titleHitIds = titleRows.map((row) => row.id)
  const messageOnlyIds = messageHitConversationIds.filter((id) => !titleHitIds.includes(id))
  if (messageOnlyIds.length > 0) {
    const messageOnlyRows = await db
      .select({ id: conversations.id, title: conversations.title })
      .from(conversations)
      .where(inArray(conversations.id, messageOnlyIds))
    for (const row of messageOnlyRows) {
      titleByConversation.set(row.id, row.title)
    }
  }

  const results: GlobalSearchResult[] = []
  const seen = new Set<string>()
  for (const row of titleRows) {
    if (seen.has(row.id)) {
      continue
    }
    seen.add(row.id)
    results.push({
      type: 'chat',
      id: row.id,
      title: row.title,
      snippet: messageSnippetByConversation.get(row.id) ?? truncateSnippet(row.description),
      route: '/chat',
    })
  }
  for (const conversationId of messageHitConversationIds) {
    if (seen.has(conversationId) || results.length >= context.limit) {
      continue
    }
    seen.add(conversationId)
    results.push({
      type: 'chat',
      id: conversationId,
      title: titleByConversation.get(conversationId) ?? '会话',
      snippet: messageSnippetByConversation.get(conversationId) ?? '',
      route: '/chat',
    })
  }
  return results
}

/** 工作区会话：标题/委托提示命中 + transcript 正文命中（workspace_session_history_events.payload_json->>'text'）。 */
const searchWorkspaceSessions = async (context: SearcherContext): Promise<GlobalSearchResult[]> => {
  const db = getDrizzleDb()
  const projectIds = await listAccessibleProjectIds(context.userId)
  const workspaceRows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(or(eq(workspaces.ownerUserId, context.userId), inArrayOrNone(workspaces.projectId, projectIds)))
  const workspaceIds = workspaceRows.map((row) => row.id)

  // 可见会话全集
  const visibleSessionRows = await db
    .select({ id: workspaceSessions.id })
    .from(workspaceSessions)
    .where(inArrayOrNone(workspaceSessions.workspaceId, workspaceIds))
    .orderBy(desc(workspaceSessions.updatedAt))
    .limit(VISIBLE_SESSION_LIMIT)
  const visibleSessionIds = visibleSessionRows.map((row) => row.id)

  // 标题/委托提示命中
  const titleRows = await db
    .select({ id: workspaceSessions.id, title: workspaceSessions.title, delegatedPrompt: workspaceSessions.delegatedPrompt })
    .from(workspaceSessions)
    .where(and(
      or(ilike(workspaceSessions.title, context.pattern), ilike(workspaceSessions.delegatedPrompt, context.pattern)),
      inArrayOrNone(workspaceSessions.workspaceId, workspaceIds),
    ))
    .orderBy(desc(workspaceSessions.updatedAt))
    .limit(context.limit)

  // transcript 正文命中
  const eventRows = await db
    .select({
      sessionId: workspaceSessionHistoryEvents.sessionId,
      text: sql<string>`${workspaceSessionHistoryEvents.payloadJson}->>'text'`,
    })
    .from(workspaceSessionHistoryEvents)
    .where(and(
      sql`${workspaceSessionHistoryEvents.payloadJson}->>'text' ilike ${context.pattern}`,
      inArrayOrNone(workspaceSessionHistoryEvents.sessionId, visibleSessionIds),
    ))
    .orderBy(desc(workspaceSessionHistoryEvents.createdAt))
    .limit(context.limit * 3)
  const snippetBySession = new Map<string, string>()
  const eventHitSessionIds: string[] = []
  for (const row of eventRows) {
    if (!snippetBySession.has(row.sessionId)) {
      snippetBySession.set(row.sessionId, truncateSnippet(row.text, 100))
      eventHitSessionIds.push(row.sessionId)
    }
  }

  const titleBySession = new Map<string, string>()
  for (const row of titleRows) {
    titleBySession.set(row.id, row.title)
  }
  const titleHitIds = titleRows.map((row) => row.id)
  const messageOnlyIds = eventHitSessionIds.filter((id) => !titleHitIds.includes(id))
  if (messageOnlyIds.length > 0) {
    const messageOnlyRows = await db
      .select({ id: workspaceSessions.id, title: workspaceSessions.title })
      .from(workspaceSessions)
      .where(inArray(workspaceSessions.id, messageOnlyIds))
    for (const row of messageOnlyRows) {
      titleBySession.set(row.id, row.title)
    }
  }

  const results: GlobalSearchResult[] = []
  const seen = new Set<string>()
  for (const row of titleRows) {
    if (seen.has(row.id)) {
      continue
    }
    seen.add(row.id)
    results.push({
      type: 'chat',
      id: row.id,
      title: row.title,
      snippet: snippetBySession.get(row.id) ?? truncateSnippet(row.delegatedPrompt),
      route: `/workspace?workspaceSessionId=${encodeURIComponent(row.id)}`,
    })
  }
  for (const sessionId of eventHitSessionIds) {
    if (seen.has(sessionId) || results.length >= context.limit) {
      continue
    }
    seen.add(sessionId)
    results.push({
      type: 'chat',
      id: sessionId,
      title: titleBySession.get(sessionId) ?? '工作区会话',
      snippet: snippetBySession.get(sessionId) ?? '',
      route: `/workspace?workspaceSessionId=${encodeURIComponent(sessionId)}`,
    })
  }
  return results
}

/** 工作区：执行工作区（workspaces）+ 协作工作区（collab_workspaces）。 */
const searchWorkspaces = async (context: SearcherContext): Promise<GlobalSearchResult[]> => {
  const db = getDrizzleDb()
  const projectIds = await listAccessibleProjectIds(context.userId)
  const [executionRows, collabRows] = await Promise.all([
    db
      .select({ id: workspaces.id, name: workspaces.name, status: workspaces.status, projectId: workspaces.projectId })
      .from(workspaces)
      .where(and(
        ilike(workspaces.name, context.pattern),
        or(eq(workspaces.ownerUserId, context.userId), inArrayOrNone(workspaces.projectId, projectIds)),
      ))
      .orderBy(desc(workspaces.updatedAt))
      .limit(context.limit),
    db
      .select({ id: collabWorkspaces.id, name: collabWorkspaces.name, description: collabWorkspaces.description })
      .from(collabWorkspaces)
      .innerJoin(collabWorkspaceMembers, eq(collabWorkspaceMembers.workspaceId, collabWorkspaces.id))
      .where(and(
        eq(collabWorkspaceMembers.userId, context.userId),
        or(ilike(collabWorkspaces.name, context.pattern), ilike(collabWorkspaces.description, context.pattern)),
      ))
      .orderBy(desc(collabWorkspaces.updatedAt))
      .limit(context.limit),
  ])

  const results: GlobalSearchResult[] = []
  for (const row of executionRows) {
    results.push({
      type: 'workspace',
      id: row.id,
      title: row.name,
      snippet: `执行工作区 · ${row.status}`,
      route: `/workspace?workspaceId=${encodeURIComponent(row.id)}`,
    })
  }
  for (const row of collabRows) {
    results.push({
      type: 'workspace',
      id: row.id,
      title: row.name,
      snippet: truncateSnippet(row.description) || '协作工作区',
      route: '/workspaces',
    })
  }
  return results
}

/** Agent：本人拥有的自定义 Agent。 */
const searchAgents = async (context: SearcherContext): Promise<GlobalSearchResult[]> => {
  const db = getDrizzleDb()
  const rows = await db
    .select({ id: agents.id, name: agents.name, type: agents.type, status: agents.status })
    .from(agents)
    .where(and(eq(agents.ownerUserId, context.userId), ilike(agents.name, context.pattern)))
    .orderBy(desc(agents.updatedAt))
    .limit(context.limit)
  return rows.map((row) => ({
    type: 'agent' as const,
    id: row.id,
    title: row.name,
    snippet: `${row.type} · ${row.status}`,
    route: `/agents?agentId=${encodeURIComponent(row.id)}`,
  }))
}

/** 与当前用户有关联的用户 id：自己 + 共同会话成员 + 共同协作工作区成员 + 团队成员 + 我的项目创建者。 */
const listRelatedUserIds = async (userId: string): Promise<string[]> => {
  const db = getDrizzleDb()
  const result = new Set<string>([userId])
  const [memberConversationIds, collabWorkspaceIds, projectIds] = await Promise.all([
    listMemberConversationIds(userId),
    listCollabWorkspaceIds(userId),
    listAccessibleProjectIds(userId),
  ])

  // 共同会话成员
  const conversationMemberRows = await db
    .select({ memberId: conversationMembers.memberId })
    .from(conversationMembers)
    .where(and(
      eq(conversationMembers.memberType, 'user'),
      inArrayOrNone(conversationMembers.conversationId, memberConversationIds),
    ))
  for (const row of conversationMemberRows) {
    result.add(row.memberId)
  }

  // 共同协作工作区成员
  const collabMemberRows = await db
    .select({ userId: collabWorkspaceMembers.userId })
    .from(collabWorkspaceMembers)
    .where(inArrayOrNone(collabWorkspaceMembers.workspaceId, collabWorkspaceIds))
  for (const row of collabMemberRows) {
    result.add(row.userId)
  }

  // 团队成员
  const myTeamRows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))
  const myTeamIds = myTeamRows.map((row) => row.teamId)
  if (myTeamIds.length > 0) {
    const teamMemberRows = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(inArray(teamMembers.teamId, myTeamIds))
    for (const row of teamMemberRows) {
      result.add(row.userId)
    }
  }

  // 我的项目创建者
  const creatorRows = await db
    .select({ createdBy: projects.createdBy })
    .from(projects)
    .where(and(inArrayOrNone(projects.id, projectIds), isNotNull(projects.createdBy)))
  for (const row of creatorRows) {
    if (row.createdBy) {
      result.add(row.createdBy)
    }
  }

  return [...result]
}

/** 联系人：仅返回与当前用户有关联的用户（避免全平台目录暴露）。 */
const searchContacts = async (context: SearcherContext): Promise<GlobalSearchResult[]> => {
  const db = getDrizzleDb()
  const relatedUserIds = await listRelatedUserIds(context.userId)
  const rows = await db
    .select({ id: users.id, name: users.name, username: users.username, email: users.email })
    .from(users)
    .where(and(
      eq(users.status, 'active'),
      or(
        ilike(users.name, context.pattern),
        ilike(users.email, context.pattern),
        ilike(users.username, context.pattern),
      ),
      inArrayOrNone(users.id, relatedUserIds),
    ))
    .orderBy(asc(users.name))
    .limit(context.limit)
  return rows.map((row) => ({
    type: 'contact' as const,
    id: row.id,
    title: row.name,
    snippet: row.username ? `@${row.username}` : row.email,
    route: `/profile/${encodeURIComponent(row.id)}`,
  }))
}

/** 项目：本人 owner/member（user_projects）或创建者。 */
const searchProjects = async (context: SearcherContext): Promise<GlobalSearchResult[]> => {
  const db = getDrizzleDb()
  const projectIds = await listAccessibleProjectIds(context.userId)
  const rows = await db
    .select({ id: projects.id, name: projects.name, gitUrl: projects.gitUrl })
    .from(projects)
    .where(and(
      or(ilike(projects.name, context.pattern), ilike(projects.gitUrl, context.pattern)),
      or(inArrayOrNone(projects.id, projectIds), eq(projects.createdBy, context.userId)),
    ))
    .orderBy(desc(projects.updatedAt))
    .limit(context.limit)
  return rows.map((row) => ({
    type: 'project' as const,
    id: row.id,
    title: row.name,
    snippet: truncateSnippet(row.gitUrl),
    route: `/kanban?projectId=${encodeURIComponent(row.id)}`,
  }))
}

/** 任务：所属项目对用户可访问。 */
const searchTasks = async (context: SearcherContext): Promise<GlobalSearchResult[]> => {
  const db = getDrizzleDb()
  const projectIds = await listAccessibleProjectIds(context.userId)
  const rows = await db
    .select({ id: tasks.id, title: tasks.title, description: tasks.description, projectId: tasks.projectId })
    .from(tasks)
    .where(and(
      or(ilike(tasks.title, context.pattern), ilike(tasks.description, context.pattern)),
      inArrayOrNone(tasks.projectId, projectIds),
    ))
    .orderBy(desc(tasks.updatedAt))
    .limit(context.limit)
  return rows.map((row) => ({
    type: 'task' as const,
    id: row.id,
    title: row.title,
    snippet: truncateSnippet(row.description),
    route: `/kanban?projectId=${encodeURIComponent(row.projectId)}&taskId=${encodeURIComponent(row.id)}`,
  }))
}

/** 云盘：个人文件 + 本人所在协作工作区团队文件（复用 searchDriveFiles）。 */
const searchDrive = async (context: SearcherContext): Promise<GlobalSearchResult[]> => {
  const collabWorkspaceIds = await listCollabWorkspaceIds(context.userId)
  const scopes: DriveScope[] = [{ workspaceId: null, userId: context.userId }]
  for (const workspaceId of collabWorkspaceIds) {
    scopes.push({ workspaceId, userId: context.userId })
  }

  const results: GlobalSearchResult[] = []
  for (const scope of scopes) {
    const hits = await searchDriveFiles(scope, context.rawQuery)
    for (const hit of hits) {
      results.push({
        type: 'drive',
        id: hit.id,
        title: hit.name,
        snippet: truncateSnippet(hit.snippet, 100) || (hit.fileType === 'folder' ? '文件夹' : '文件'),
        route: '/drive',
      })
      if (results.length >= context.limit) {
        return results
      }
    }
  }
  return results
}

/** 技能：本人拥有的个人技能。 */
const searchSkills = async (context: SearcherContext): Promise<GlobalSearchResult[]> => {
  const db = getDrizzleDb()
  const rows = await db
    .select({ id: skills.id, name: skills.name, description: skills.description })
    .from(skills)
    .where(and(
      eq(skills.ownerUserId, context.userId),
      or(ilike(skills.name, context.pattern), ilike(skills.description, context.pattern)),
    ))
    .orderBy(desc(skills.updatedAt))
    .limit(context.limit)
  return rows.map((row) => ({
    type: 'skill' as const,
    id: row.id,
    title: row.name,
    snippet: truncateSnippet(row.description),
    route: '/skills',
  }))
}

const SEARCHERS: Record<GlobalSearchType, (context: SearcherContext) => Promise<GlobalSearchResult[]>> = {
  chat: async (context) => {
    const [chatHits, sessionHits] = await Promise.all([searchChats(context), searchWorkspaceSessions(context)])
    return [...chatHits, ...sessionHits]
  },
  workspace: searchWorkspaces,
  agent: searchAgents,
  contact: searchContacts,
  project: searchProjects,
  task: searchTasks,
  drive: searchDrive,
  skill: searchSkills,
}

/** 全局搜索入口：按类型 fan-out，保持类型分组顺序返回。 */
export const globalSearch = async (params: GlobalSearchParams): Promise<GlobalSearchResult[]> => {
  const query = params.query.trim()
  if (!query) {
    return []
  }

  const limit = Math.max(1, Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT))
  const types: GlobalSearchType[] = params.type ? [params.type] : (Object.keys(SEARCHERS) as GlobalSearchType[])
  const context: SearcherContext = {
    userId: params.userId,
    pattern: toLikePattern(query),
    rawQuery: query,
    limit,
  }

  const results: GlobalSearchResult[] = []
  for (const type of types) {
    const hits = await SEARCHERS[type](context)
    results.push(...hits)
  }
  return results
}

// 供单测使用的纯函数导出
export const _test = {
  toLikePattern,
  truncateSnippet,
  escapeLikePattern,
}
