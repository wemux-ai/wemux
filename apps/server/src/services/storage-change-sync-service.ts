/**
 * [INPUT]: Postgres storage-change notifications grouped by changed table.
 * [OUTPUT]: Refreshed in-memory repositories and realtime state/history broadcasts across control-plane instances.
 * [POS]: Cross-instance persistence invalidation coordinator, including independent AgentTaskRun caches.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { TaskChatPart } from '@shared/task-chat-part'
import type {
  WorkspaceSessionEventRecord,
  WorkspaceSessionRuntimeSnapshot,
} from '@shared/workspace-session-history'

import { broadcastState } from './state-stream'
import { previewSessionService } from './preview-session-service'
import { publishTaskChatWsPart } from './task-chat-ws-service'
import { publishConversationWsEvent, type ConversationWsEvent } from './conversation-ws-service'
import { publishLocalInboxChange, type InboxEventType } from './inbox-stream'
import type { InboxChangePayload } from './inbox-stream'
import {
  publishWorkspaceSessionHistoryEvent,
  publishWorkspaceSessionHistoryRuntime,
} from './workspace-session-history-ws-service'
import { clusterConfig } from '../cluster/config'
import { executorRegistry } from '../control-plane/executor-registry'
import { hydrateClusterState, initAppStateStore, loadState } from '../storage/app-state-store'
import { lt } from 'drizzle-orm'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { storageChangeEvents } from '../storage/postgres/schema'
import { refreshAgentStore } from '../storage/postgres/agent-store'
import { refreshAgentTaskRunStore } from '../storage/postgres/agent-task-run-store'
import { refreshAuthStore } from '../storage/postgres/auth-store'
import { initAutomationStore } from '../storage/postgres/automation-store'
import { initConversationStore } from '../storage/postgres/conversation-store'
import { initGovernanceStore } from '../storage/postgres/governance-store'
import { refreshDistributedTaskStore } from '../storage/postgres/distributed-task-store'
import { refreshSkillStore } from '../storage/postgres/skill-store'
import { initTelegramStore } from '../storage/postgres/telegram-store'
import { refreshTaskChatQueueMirror, TASK_CHAT_QUEUE_ITEMS_TABLE } from '../storage/postgres/task-chat-queue-store'
import {
  startStorageChangeListener,
  stopStorageChangeListener,
  type StorageChangeEvent,
} from '../storage/postgres/storage-change-listener'

const DISTRIBUTED_STATE_TABLES = new Set([
  'nodes',
  'node_capabilities',
  'project_bindings',
  'workspaces',
  'workspace_local_worktrees',
  'distributed_tasks',
])

const APP_STATE_TABLES = new Set([
  'projects',
  'tasks',
  'execution_logs',
  'app_meta',
  'task_runs',
  'task_collaboration',
  'task_workspace_bindings',
  'workspace_sessions',
  'workspace_session_history_projection',
])

const AUTH_TABLES = new Set([
  'users',
  'teams',
  'team_members',
  'team_invitations',
  'team_activities',
  'user_projects',
  'team_projects',
  'revoked_auth_tokens',
])

const CONVERSATION_TABLES = new Set([
  'conversations',
  'conversation_members',
  'messages',
  'channel_bindings',
])

const GOVERNANCE_TABLES = new Set([
  'agent_sessions',
  'agent_actions',
  'approval_requests',
  'audit_logs',
])

const AGENT_TABLES = new Set(['agents', 'agent_tasks', 'agent_crons', 'agent_heartbeats'])
const AGENT_TASK_RUN_TABLES = new Set(['agent_task_runs'])
const AUTOMATION_TABLES = new Set(['automations', 'automation_triggers', 'automation_runs'])
const EXECUTOR_TABLES = new Set(['executors'])
const SKILL_TABLES = new Set(['skills', 'skill_versions'])
const TELEGRAM_TABLES = new Set(['telegram_chats', 'telegram_sessions'])
const PREVIEW_TABLES = new Set(['preview_sessions'])
const TASK_CHAT_QUEUE_TABLES = new Set([TASK_CHAT_QUEUE_ITEMS_TABLE])

const includesTable = (tables: Set<string>, candidates: Set<string>) => (
  [...tables].some((table) => candidates.has(table))
)

const publishRemoteRealtimeEvent = (event: StorageChangeEvent) => {
  if (event.tableName !== 'realtime_events' || event.sourceNodeId === clusterConfig.nodeId) {
    return
  }

  const payload = event.payload
  if (!payload) {
    return
  }
  const topic = payload?.topic
  if (topic === 'inbox.changed') {
    if (
      (payload.recipientType === 'user' || payload.recipientType === 'agent')
      && typeof payload.recipientId === 'string'
      && typeof payload.eventType === 'string'
      && payload.change
    ) {
      publishLocalInboxChange({
        recipientType: payload.recipientType,
        recipientId: payload.recipientId,
        eventType: payload.eventType as InboxEventType,
        payload: payload.change as InboxChangePayload,
      })
    }
    return
  }
  if (topic === 'task-chat.part' && typeof payload.sessionKey === 'string' && payload.part) {
    publishTaskChatWsPart(payload.sessionKey, payload.part as TaskChatPart)
    return
  }
  if (topic === 'workspace-history.event' && typeof payload.sessionId === 'string' && payload.event) {
    publishWorkspaceSessionHistoryEvent(
      payload.sessionId,
      payload.event as WorkspaceSessionEventRecord,
    )
    return
  }
  if (topic === 'workspace-history.runtime' && typeof payload.sessionId === 'string' && payload.runtime) {
    publishWorkspaceSessionHistoryRuntime(
      payload.sessionId,
      payload.runtime as WorkspaceSessionRuntimeSnapshot,
    )
  }
  if (topic === 'conversation.event' && typeof payload.conversationId === 'string' && payload.event) {
    publishConversationWsEvent(
      payload.conversationId,
      payload.event as ConversationWsEvent,
    )
  }
}

let refreshPromise: Promise<void> | null = null
let pendingTables = new Set<string>()
let pendingRefreshTimer: ReturnType<typeof setTimeout> | null = null

// storage_change 事件风暴时合并刷新：事件持续涌入（心跳写库/executor upsert 等）
// 会反复触发 refreshChangedState，而每次刷新都要全量重读多张表。
// 入队后延迟 100ms 批量合并一次，把同窗口内的多个事件并成一轮刷新。
const REFRESH_DEBOUNCE_MS = 100

const refreshChangedState = async () => {
  if (refreshPromise) {
    return refreshPromise
  }

  refreshPromise = (async () => {
    while (pendingTables.size > 0) {
      const tables = pendingTables
      pendingTables = new Set<string>()
      const authChanged = includesTable(tables, AUTH_TABLES)
      const distributedChanged = includesTable(tables, DISTRIBUTED_STATE_TABLES)
      const appStateChanged = distributedChanged || includesTable(tables, APP_STATE_TABLES)
      const projectWorkspacesChanged = tables.has('workspaces') || tables.has('workspace_local_worktrees')

      if (authChanged) {
        await refreshAuthStore()
      }

      if (distributedChanged) {
        await refreshDistributedTaskStore()
      }
      if (includesTable(tables, EXECUTOR_TABLES)) {
        await executorRegistry.refreshPersistedState()
      }
      if (appStateChanged) {
        await initAppStateStore()
      }
      if (includesTable(tables, CONVERSATION_TABLES)) {
        await initConversationStore()
      }
      if (includesTable(tables, GOVERNANCE_TABLES)) {
        await initGovernanceStore()
      }
      if (includesTable(tables, AGENT_TABLES)) {
        await refreshAgentStore()
      }
      if (includesTable(tables, AGENT_TASK_RUN_TABLES)) {
        await refreshAgentTaskRunStore()
      }
      if (includesTable(tables, AUTOMATION_TABLES)) {
        await initAutomationStore()
      }
      if (includesTable(tables, SKILL_TABLES)) {
        await refreshSkillStore()
      }
      if (tables.has('app_meta') || includesTable(tables, TELEGRAM_TABLES)) {
        await initTelegramStore()
      }
      if (includesTable(tables, PREVIEW_TABLES)) {
        await previewSessionService.refreshPersistentSessions()
      }
      if (includesTable(tables, TASK_CHAT_QUEUE_TABLES)) {
        await refreshTaskChatQueueMirror()
      }

      if (authChanged || appStateChanged || includesTable(tables, EXECUTOR_TABLES)) {
        broadcastState(hydrateClusterState(loadState()), {
          invalidation: projectWorkspacesChanged ? 'project-workspaces' : undefined,
        })
      }
    }
  })().finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

const handleStorageChangeEvents = async (events: StorageChangeEvent[]) => {
  for (const event of events) {
    publishRemoteRealtimeEvent(event)
    pendingTables.add(event.tableName)
  }

  // debounce：把同窗口内多批事件合并成一轮刷新，避免每批都全量重读。
  if (pendingRefreshTimer !== null) {
    clearTimeout(pendingRefreshTimer)
  }
  pendingRefreshTimer = setTimeout(() => {
    pendingRefreshTimer = null
    void refreshChangedState()
  }, REFRESH_DEBOUNCE_MS)
}

export const startStorageChangeSync = () => {
  startStorageChangeListener({
    onEvents: handleStorageChangeEvents,
  })
  startStorageChangeRetentionSchedule()
}

export const stopStorageChangeSync = () => {
  if (pendingRefreshTimer !== null) {
    clearTimeout(pendingRefreshTimer)
    pendingRefreshTimer = null
  }
  stopStorageChangeListener()
}

// storage_change_events 是无界事件日志：即使没有异常循环，也会随每次业务写入持续增长。
// 事件被 drain 消费后只用于跨实例实时同步，历史行不再被回放（重启后从 MAX(id) 续读），
// 因此超过保留窗口的旧事件可以安全清理。
const STORAGE_CHANGE_RETENTION_DAYS = 7
const STORAGE_CHANGE_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000

let storageChangeRetentionTimer: ReturnType<typeof setInterval> | null = null

const sweepStorageChangeRetention = async () => {
  const cutoff = new Date(Date.now() - STORAGE_CHANGE_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const result = await getDrizzleDb()
    .delete(storageChangeEvents)
    .where(lt(storageChangeEvents.changedAt, cutoff))
  if ((result.rowCount ?? 0) > 0) {
    console.log(`[storage-change] retention swept ${result.rowCount} old events`)
  }
}

export const startStorageChangeRetentionSchedule = () => {
  if (storageChangeRetentionTimer !== null) {
    return
  }

  storageChangeRetentionTimer = setInterval(() => {
    void sweepStorageChangeRetention().catch((error) => {
      console.error('[storage-change] retention sweep failed', error)
    })
  }, STORAGE_CHANGE_SWEEP_INTERVAL_MS)
  storageChangeRetentionTimer.unref?.()
}

export const stopStorageChangeRetentionSchedule = () => {
  if (storageChangeRetentionTimer !== null) {
    clearInterval(storageChangeRetentionTimer)
    storageChangeRetentionTimer = null
  }
}
