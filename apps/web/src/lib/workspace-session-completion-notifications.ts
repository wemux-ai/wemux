/**
 * [INPUT]: 工作区会话状态快照（前一帧 vs 当前帧）。
 * [OUTPUT]: 忙碌 → 终态（complete/attention/error）的纯推导集合。
 * [POS]: 工作区会话完成通知的纯推导层；展示/限流/权限/提示音统一由 notifications/notifier 交付。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { WorkspaceSession } from '@shared/types'
import { getWorkspaceSessionDisplayStatus, isWorkspaceSessionBusy } from './workspace-session-status'

export type WorkspaceSessionCompletionNotificationTone = 'complete' | 'attention' | 'error'

type TrackedWorkspaceSessionState = Pick<
  WorkspaceSession,
  'id' | 'title' | 'agentRunningStatus' | 'runtimeStatus' | 'needsHumanConfirm' | 'runtimeSequence' | 'lastRuntimeEventAt' | 'updatedAt' | 'createdAt'
>

export type { TrackedWorkspaceSessionState }

export type WorkspaceSessionCompletionNotification = {
  sessionId: string
  sessionTitle: string
  tone: WorkspaceSessionCompletionNotificationTone
}

export const getWorkspaceSessionCompletionNotificationTone = (
  session: TrackedWorkspaceSessionState,
): WorkspaceSessionCompletionNotificationTone | null => {
  const displayStatus = getWorkspaceSessionDisplayStatus(session)
  if (displayStatus === 'attention' || displayStatus === 'complete' || displayStatus === 'error') {
    return displayStatus
  }

  return null
}

export const getWorkspaceSessionCompletionNotificationSignature = (
  session: TrackedWorkspaceSessionState,
) => {
  const tone = getWorkspaceSessionCompletionNotificationTone(session)
  if (!tone) {
    return null
  }

  return `${tone}:${session.runtimeSequence}:${session.lastRuntimeEventAt || session.updatedAt || session.createdAt}`
}

export const collectWorkspaceSessionCompletionNotifications = (params: {
  previousSessionsById: Record<string, TrackedWorkspaceSessionState>
  workspaceSessions: WorkspaceSession[]
}) => {
  const notifications: WorkspaceSessionCompletionNotification[] = []
  const nextSessionsById: Record<string, TrackedWorkspaceSessionState> = {}

  for (const session of params.workspaceSessions) {
    const trackedSession: TrackedWorkspaceSessionState = {
      id: session.id,
      title: session.title,
      agentRunningStatus: session.agentRunningStatus,
      runtimeStatus: session.runtimeStatus,
      needsHumanConfirm: session.needsHumanConfirm,
      runtimeSequence: session.runtimeSequence,
      lastRuntimeEventAt: session.lastRuntimeEventAt,
      updatedAt: session.updatedAt,
      createdAt: session.createdAt,
    }
    nextSessionsById[session.id] = trackedSession

    const previousSession = params.previousSessionsById[session.id]
    const previousSignature = previousSession
      ? getWorkspaceSessionCompletionNotificationSignature(previousSession)
      : null
    const nextTone = getWorkspaceSessionCompletionNotificationTone(trackedSession)
    const nextSignature = getWorkspaceSessionCompletionNotificationSignature(trackedSession)

    if (!previousSession || !isWorkspaceSessionBusy(previousSession) || !nextTone || !nextSignature || previousSignature === nextSignature) {
      continue
    }

    notifications.push({
      sessionId: session.id,
      sessionTitle: session.title,
      tone: nextTone,
    })
  }

  return {
    notifications,
    nextSessionsById,
  }
}
