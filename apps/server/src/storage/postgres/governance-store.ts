import { desc, eq } from 'drizzle-orm'

import type { Task } from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { cloneJson, schedulePersistence } from './helpers'
import { agentActions, agentSessions, approvalRequests, auditLogs } from './schema'

export type AgentMode = 'assist' | 'coordinate' | 'managed'
export type AgentSessionStatus = 'running' | 'waiting' | 'completed' | 'failed'
export type RiskLevel = 'low' | 'medium' | 'high'
export type AgentActionStatus = 'started' | 'completed' | 'failed' | 'waiting_approval'
export type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected'
export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired'
export type AuditActorType = 'user' | 'agent' | 'system' | 'channel'

export type AgentSessionRecord = {
  id: string
  workspaceId?: string
  projectId?: string
  taskId?: string
  runtime: Task['agentType']
  mode: AgentMode
  status: AgentSessionStatus
  agentSessionId?: string
  contextSnapshot?: Record<string, unknown>
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export type AgentActionRecord = {
  id: string
  agentSessionId: string
  actionType: string
  capabilityName?: string
  input?: Record<string, unknown>
  result?: Record<string, unknown>
  status: AgentActionStatus
  approvalStatus: ApprovalStatus
  riskLevel: RiskLevel
  errorMessage?: string
  startedAt: string
  finishedAt?: string
}

export type ApprovalRequestRecord = {
  id: string
  workspaceId?: string
  agentActionId: string
  requestedByAgentSessionId: string
  approverUserId?: string
  title: string
  detail?: string
  status: ApprovalRequestStatus
  riskLevel: RiskLevel
  expiresAt?: string
  createdAt: string
  updatedAt: string
}

export type AuditLogRecord = {
  id: string
  workspaceId?: string
  projectId?: string
  taskId?: string
  conversationId?: string
  agentSessionId?: string
  approvalRequestId?: string
  channelBindingId?: string
  eventType: string
  actorType: AuditActorType
  actorId?: string
  payload?: Record<string, unknown>
  createdAt: string
}

type AgentSessionRow = typeof agentSessions.$inferSelect
type AgentActionRow = typeof agentActions.$inferSelect
type ApprovalRequestRow = typeof approvalRequests.$inferSelect
type AuditLogRow = typeof auditLogs.$inferSelect

const cache = {
  agentSessions: [] as AgentSessionRecord[],
  agentActions: [] as AgentActionRecord[],
  approvalRequests: [] as ApprovalRequestRecord[],
  auditLogs: [] as AuditLogRecord[],
}

const BOOTSTRAP_AGENT_ACTION_LIMIT = 500
const BOOTSTRAP_AUDIT_LOG_LIMIT = 200

const mapAgentSessionRow = (row: AgentSessionRow): AgentSessionRecord => ({
  id: row.id,
  workspaceId: row.workspaceId ?? undefined,
  projectId: row.projectId ?? undefined,
  taskId: row.taskId ?? undefined,
  runtime: row.runtime,
  mode: row.mode,
  status: row.status,
  agentSessionId: row.agentSessionId ?? undefined,
  contextSnapshot: row.contextSnapshotJson ?? undefined,
  createdBy: row.createdBy ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const mapAgentActionRow = (row: AgentActionRow): AgentActionRecord => ({
  id: row.id,
  agentSessionId: row.agentSessionId,
  actionType: row.actionType,
  capabilityName: row.capabilityName ?? undefined,
  input: row.inputJson ?? undefined,
  result: row.resultJson ?? undefined,
  status: row.status,
  approvalStatus: row.approvalStatus,
  riskLevel: row.riskLevel,
  errorMessage: row.errorMessage ?? undefined,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt ?? undefined,
})

const mapApprovalRequestRow = (row: ApprovalRequestRow): ApprovalRequestRecord => ({
  id: row.id,
  workspaceId: row.workspaceId ?? undefined,
  agentActionId: row.agentActionId,
  requestedByAgentSessionId: row.requestedByAgentSessionId,
  approverUserId: row.approverUserId ?? undefined,
  title: row.title,
  detail: row.detail ?? undefined,
  status: row.status,
  riskLevel: row.riskLevel,
  expiresAt: row.expiresAt ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const mapAuditLogRow = (row: AuditLogRow): AuditLogRecord => ({
  id: row.id,
  workspaceId: row.workspaceId ?? undefined,
  projectId: row.projectId ?? undefined,
  taskId: row.taskId ?? undefined,
  conversationId: row.conversationId ?? undefined,
  agentSessionId: row.agentSessionId ?? undefined,
  approvalRequestId: row.approvalRequestId ?? undefined,
  channelBindingId: row.channelBindingId ?? undefined,
  eventType: row.eventType,
  actorType: row.actorType,
  actorId: row.actorId ?? undefined,
  payload: row.payloadJson ?? undefined,
  createdAt: row.createdAt,
})

export const initGovernanceStore = async () => {
  await ensurePostgresReady()
  const db = getDrizzleDb()
  const [sessionRows, actionRows, approvalRows, auditRows] = await Promise.all([
    db.select().from(agentSessions).orderBy(desc(agentSessions.updatedAt)),
    db.select().from(agentActions).orderBy(desc(agentActions.startedAt)).limit(BOOTSTRAP_AGENT_ACTION_LIMIT),
    db.select().from(approvalRequests).where(eq(approvalRequests.status, 'pending')).orderBy(desc(approvalRequests.createdAt)),
    db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(BOOTSTRAP_AUDIT_LOG_LIMIT),
  ])

  cache.agentSessions = sessionRows.map(mapAgentSessionRow)
  cache.agentActions = actionRows.map(mapAgentActionRow)
  cache.approvalRequests = approvalRows.map(mapApprovalRequestRow)
  cache.auditLogs = auditRows.map(mapAuditLogRow)
}

export const getAgentSessionByTaskAndRuntimeSession = (taskId: string, workspaceId?: string, agentSessionId?: string) => {
  return cloneJson(
    cache.agentSessions.find((session) => (
      (workspaceId ? session.workspaceId === workspaceId : session.taskId === taskId)
      && (session.agentSessionId ?? '') === (agentSessionId ?? '')
    )) ?? null,
  )
}

export const saveAgentSession = (session: AgentSessionRecord) => {
  const nextSession = cloneJson(session)
  const index = cache.agentSessions.findIndex((item) => item.id === nextSession.id)

  if (index >= 0) {
    cache.agentSessions[index] = nextSession
  } else {
    cache.agentSessions.unshift(nextSession)
  }

  schedulePersistence(
    `save-agent-session:${nextSession.id}`,
    getDrizzleDb()
      .insert(agentSessions)
      .values({
        id: nextSession.id,
        workspaceId: nextSession.workspaceId ?? null,
        projectId: nextSession.projectId ?? null,
        taskId: nextSession.taskId ?? null,
        runtime: nextSession.runtime,
        mode: nextSession.mode,
        status: nextSession.status,
        agentSessionId: nextSession.agentSessionId ?? null,
        contextSnapshotJson: nextSession.contextSnapshot ?? {},
        createdBy: nextSession.createdBy ?? null,
        createdAt: nextSession.createdAt,
        updatedAt: nextSession.updatedAt,
      })
      .onConflictDoUpdate({
        target: agentSessions.id,
        set: {
          workspaceId: nextSession.workspaceId ?? null,
          projectId: nextSession.projectId ?? null,
          taskId: nextSession.taskId ?? null,
          runtime: nextSession.runtime,
          mode: nextSession.mode,
          status: nextSession.status,
          agentSessionId: nextSession.agentSessionId ?? null,
          contextSnapshotJson: nextSession.contextSnapshot ?? {},
          createdBy: nextSession.createdBy ?? null,
          updatedAt: nextSession.updatedAt,
        },
      }),
  )
}

export const saveAgentAction = (action: AgentActionRecord) => {
  const nextAction = cloneJson(action)
  const index = cache.agentActions.findIndex((item) => item.id === nextAction.id)

  if (index >= 0) {
    cache.agentActions[index] = nextAction
  } else {
    cache.agentActions.unshift(nextAction)
  }

  schedulePersistence(
    `save-agent-action:${nextAction.id}`,
    getDrizzleDb()
      .insert(agentActions)
      .values({
        id: nextAction.id,
        agentSessionId: nextAction.agentSessionId,
        actionType: nextAction.actionType,
        capabilityName: nextAction.capabilityName ?? null,
        inputJson: nextAction.input ?? {},
        resultJson: nextAction.result ?? {},
        status: nextAction.status,
        approvalStatus: nextAction.approvalStatus,
        riskLevel: nextAction.riskLevel,
        errorMessage: nextAction.errorMessage ?? null,
        startedAt: nextAction.startedAt,
        finishedAt: nextAction.finishedAt ?? null,
      })
      .onConflictDoUpdate({
        target: agentActions.id,
        set: {
          agentSessionId: nextAction.agentSessionId,
          actionType: nextAction.actionType,
          capabilityName: nextAction.capabilityName ?? null,
          inputJson: nextAction.input ?? {},
          resultJson: nextAction.result ?? {},
          status: nextAction.status,
          approvalStatus: nextAction.approvalStatus,
          riskLevel: nextAction.riskLevel,
          errorMessage: nextAction.errorMessage ?? null,
          startedAt: nextAction.startedAt,
          finishedAt: nextAction.finishedAt ?? null,
        },
      }),
  )
}

export const saveApprovalRequest = (approval: ApprovalRequestRecord) => {
  const nextApproval = cloneJson(approval)
  const index = cache.approvalRequests.findIndex((item) => item.id === nextApproval.id)

  if (index >= 0) {
    cache.approvalRequests[index] = nextApproval
  } else {
    cache.approvalRequests.unshift(nextApproval)
  }

  schedulePersistence(
    `save-approval-request:${nextApproval.id}`,
    getDrizzleDb()
      .insert(approvalRequests)
      .values({
        id: nextApproval.id,
        workspaceId: nextApproval.workspaceId ?? null,
        agentActionId: nextApproval.agentActionId,
        requestedByAgentSessionId: nextApproval.requestedByAgentSessionId,
        approverUserId: nextApproval.approverUserId ?? null,
        title: nextApproval.title,
        detail: nextApproval.detail ?? null,
        status: nextApproval.status,
        riskLevel: nextApproval.riskLevel,
        expiresAt: nextApproval.expiresAt ?? null,
        createdAt: nextApproval.createdAt,
        updatedAt: nextApproval.updatedAt,
      })
      .onConflictDoUpdate({
        target: approvalRequests.id,
        set: {
          workspaceId: nextApproval.workspaceId ?? null,
          agentActionId: nextApproval.agentActionId,
          requestedByAgentSessionId: nextApproval.requestedByAgentSessionId,
          approverUserId: nextApproval.approverUserId ?? null,
          title: nextApproval.title,
          detail: nextApproval.detail ?? null,
          status: nextApproval.status,
          riskLevel: nextApproval.riskLevel,
          expiresAt: nextApproval.expiresAt ?? null,
          updatedAt: nextApproval.updatedAt,
        },
      }),
  )
}

export const listPendingApprovalRequests = () => {
  return cloneJson(cache.approvalRequests.filter((approval) => approval.status === 'pending'))
}

export const listRecentAuditLogs = (limit = 50) => {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 50
  return cloneJson(cache.auditLogs.slice(0, normalizedLimit))
}

export const saveAuditLog = (auditLog: AuditLogRecord) => {
  const nextAuditLog = cloneJson(auditLog)
  cache.auditLogs.unshift(nextAuditLog)

  schedulePersistence(
    `save-audit-log:${nextAuditLog.id}`,
    getDrizzleDb()
      .insert(auditLogs)
      .values({
        id: nextAuditLog.id,
        workspaceId: nextAuditLog.workspaceId ?? null,
        projectId: nextAuditLog.projectId ?? null,
        taskId: nextAuditLog.taskId ?? null,
        conversationId: nextAuditLog.conversationId ?? null,
        agentSessionId: nextAuditLog.agentSessionId ?? null,
        approvalRequestId: nextAuditLog.approvalRequestId ?? null,
        channelBindingId: nextAuditLog.channelBindingId ?? null,
        eventType: nextAuditLog.eventType,
        actorType: nextAuditLog.actorType,
        actorId: nextAuditLog.actorId ?? null,
        payloadJson: nextAuditLog.payload ?? {},
        createdAt: nextAuditLog.createdAt,
      }),
  )
}
