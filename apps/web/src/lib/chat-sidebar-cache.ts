/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: /chat 目标侧栏的三类数据源：Agent 目录、私聊列表、协作工作区与群聊列表
 * [OUTPUT]: 各自独立的模块级内存缓存（跨 /chat 路由挂载存活）
 * [POS]: 路由重挂载时先渲染缓存内容、后台静默刷新，消除侧栏「空一下再弹出」的加载感；
 *        不承担数据权威，Agent 目录由 AGENT_SIDEBAR_REFRESH_EVENT 强制刷新绕过缓存
 */
import type { AgentRecord } from './api'
import type { DmConversationListItem } from './api/methods/collaboration'
import type { CollaborationWorkspace, WorkspaceChatGroupSummary } from './api/types'
import {
  invalidateTtlCache,
  readTtlCache,
  writeTtlCache,
  type TtlCache,
} from './ttl-cache'

export const AGENT_CATALOG_CACHE_TTL_MS = 60_000
export const SIDEBAR_LIST_CACHE_TTL_MS = 30_000

/** Agent 目录：key = workspaceId（'' 表示未绑定工作区）。 */
export type AgentCatalogCache = TtlCache<AgentRecord[]>
export const agentCatalogCache: AgentCatalogCache = new Map()

export const readAgentCatalogCache = (cache: AgentCatalogCache, workspaceId: string, now = Date.now()) => {
  return readTtlCache(cache, workspaceId, AGENT_CATALOG_CACHE_TTL_MS, now)
}

export const writeAgentCatalogCache = (
  cache: AgentCatalogCache,
  workspaceId: string,
  agents: AgentRecord[],
  now = Date.now(),
) => {
  writeTtlCache(cache, workspaceId, agents, now)
}

export const invalidateAgentCatalogCache = (cache: AgentCatalogCache, workspaceId: string) => {
  invalidateTtlCache(cache, workspaceId)
}

/** 私聊列表：单 key。 */
export type DmConversationCache = TtlCache<DmConversationListItem[]>
export const dmConversationCache: DmConversationCache = new Map()
export const DM_CONVERSATION_CACHE_KEY = 'default'

export const readDmConversationCache = (cache: DmConversationCache, now = Date.now()) => {
  return readTtlCache(cache, DM_CONVERSATION_CACHE_KEY, SIDEBAR_LIST_CACHE_TTL_MS, now)
}

export const writeDmConversationCache = (
  cache: DmConversationCache,
  conversations: DmConversationListItem[],
  now = Date.now(),
) => {
  writeTtlCache(cache, DM_CONVERSATION_CACHE_KEY, conversations, now)
}

export const invalidateDmConversationCache = (cache: DmConversationCache) => {
  invalidateTtlCache(cache, DM_CONVERSATION_CACHE_KEY)
}

/** 协作工作区列表：单 key。 */
export type CollaborationWorkspacesCache = TtlCache<CollaborationWorkspace[]>
export const collaborationWorkspacesCache: CollaborationWorkspacesCache = new Map()
export const COLLABORATION_WORKSPACES_CACHE_KEY = 'default'

export const readCollaborationWorkspacesCache = (cache: CollaborationWorkspacesCache, now = Date.now()) => {
  return readTtlCache(cache, COLLABORATION_WORKSPACES_CACHE_KEY, SIDEBAR_LIST_CACHE_TTL_MS, now)
}

export const writeCollaborationWorkspacesCache = (
  cache: CollaborationWorkspacesCache,
  workspaces: CollaborationWorkspace[],
  now = Date.now(),
) => {
  writeTtlCache(cache, COLLABORATION_WORKSPACES_CACHE_KEY, workspaces, now)
}

export const invalidateCollaborationWorkspacesCache = (cache: CollaborationWorkspacesCache) => {
  invalidateTtlCache(cache, COLLABORATION_WORKSPACES_CACHE_KEY)
}

/** 工作区群聊列表：key = workspaceId。 */
export type WorkspaceChatGroupsCache = TtlCache<WorkspaceChatGroupSummary[]>
export const workspaceChatGroupsCache: WorkspaceChatGroupsCache = new Map()

export const readWorkspaceChatGroupsCache = (
  cache: WorkspaceChatGroupsCache,
  workspaceId: string,
  now = Date.now(),
) => {
  return readTtlCache(cache, workspaceId, SIDEBAR_LIST_CACHE_TTL_MS, now)
}

export const writeWorkspaceChatGroupsCache = (
  cache: WorkspaceChatGroupsCache,
  workspaceId: string,
  groups: WorkspaceChatGroupSummary[],
  now = Date.now(),
) => {
  writeTtlCache(cache, workspaceId, groups, now)
}

export const invalidateWorkspaceChatGroupsCache = (
  cache: WorkspaceChatGroupsCache,
  workspaceId: string,
) => {
  invalidateTtlCache(cache, workspaceId)
}
