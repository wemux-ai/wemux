import { useEffect, useRef, useState } from 'react'
import type { AgentRunningStatus, WorkspaceSession } from '@shared/types'
import {
  compareWorkspaceSessionUnreadStoreSnapshotUpdatedAt,
  createWorkspaceSessionUnreadStoreSnapshot,
  hasWorkspaceSessionUnreadStoreStateChanged,
  normalizeWorkspaceSessionUnreadStoreSnapshot,
  type WorkspaceSessionUnreadStoreSnapshot,
  type WorkspaceSessionUnreadStoreState,
} from '@shared/workspace-session-unread'
import { api } from './api'
import {
  getWorkspaceSessionAttentionSignature,
  getWorkspaceSessionAttentionTone,
  readWorkspaceSessionUnreadStoreSnapshot,
  subscribeWorkspaceSessionAttentionSync,
  writeWorkspaceSessionUnreadStoreSnapshot,
} from './workspace-session-attention'
import { isWorkspaceSessionBusy } from './workspace-session-status'

type UseWorkspaceSessionUnreadStateParams = {
  workspaceSessions: WorkspaceSession[]
  selectedWorkspaceSessionId?: string
}

const WORKSPACE_SESSION_UNREAD_REMOTE_SYNC_INTERVAL_MS = 60_000
const WORKSPACE_SESSION_UNREAD_REMOTE_FOCUS_COOLDOWN_MS = 10_000
const WORKSPACE_SESSION_UNREAD_REMOTE_PULL_COOLDOWN_MS = WORKSPACE_SESSION_UNREAD_REMOTE_FOCUS_COOLDOWN_MS
const WORKSPACE_SESSION_UNREAD_REMOTE_RELEASE_DELAY_MS = 250
// 选中会话的「待确认/已完成」延迟 ack：turn 刚结束时让列表/卡片先稳定展示「待关注」，
// 用户确实在看该会话时稍后静默已读，避免「运行中 → 瞬间空白」的闪烁观感。
const WORKSPACE_SESSION_UNREAD_ACK_DELAY_MS = 2_500

let workspaceSessionUnreadRemoteSyncRetainCount = 0
let workspaceSessionUnreadRemoteSyncStop: (() => void) | null = null
let workspaceSessionUnreadRemoteSyncReleaseTimer: number | null = null
let workspaceSessionUnreadRemoteSyncReady = false
let workspaceSessionUnreadLastRemoteUpdatedAt = ''
let workspaceSessionUnreadLastRemoteStateKey = ''
let workspaceSessionUnreadLastRemotePullAt = 0
let workspaceSessionUnreadPendingPullRequest: Promise<void> | null = null
let workspaceSessionUnreadPendingPushTimer: number | null = null
let workspaceSessionUnreadPendingPushStateKey = ''
let workspaceSessionUnreadRemotePullRequestId = 0
let workspaceSessionUnreadRemotePushRequestId = 0

const sortWorkspaceSessionUnreadRecord = (record: Record<string, string>) => Object.fromEntries(
  Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
)

export const buildWorkspaceSessionUnreadStateKey = (state: WorkspaceSessionUnreadStoreState) => JSON.stringify({
  sessionAttentionById: sortWorkspaceSessionUnreadRecord(state.sessionAttentionById),
  acknowledgedSessionAttentionById: sortWorkspaceSessionUnreadRecord(state.acknowledgedSessionAttentionById),
  manuallyUnreadSessionAttentionById: sortWorkspaceSessionUnreadRecord(state.manuallyUnreadSessionAttentionById),
})

export const shouldPushWorkspaceSessionUnreadRemoteSnapshot = (params: {
  ready: boolean
  snapshot: WorkspaceSessionUnreadStoreSnapshot
  lastRemoteUpdatedAt: string
  lastRemoteStateKey: string
  pendingPushStateKey?: string
}) => {
  if (!params.ready || !params.snapshot.updatedAt) {
    return false
  }

  const snapshotStateKey = buildWorkspaceSessionUnreadStateKey(params.snapshot)
  return (
    params.snapshot.updatedAt !== params.lastRemoteUpdatedAt
    && snapshotStateKey !== params.lastRemoteStateKey
    && snapshotStateKey !== params.pendingPushStateKey
  )
}

const applyWorkspaceSessionUnreadRemoteSnapshot = (snapshot: WorkspaceSessionUnreadStoreSnapshot) => {
  const normalizedSnapshot = normalizeWorkspaceSessionUnreadStoreSnapshot(snapshot)
  workspaceSessionUnreadLastRemoteUpdatedAt = normalizedSnapshot.updatedAt
  workspaceSessionUnreadLastRemoteStateKey = buildWorkspaceSessionUnreadStateKey(normalizedSnapshot)
  if (workspaceSessionUnreadPendingPushStateKey === workspaceSessionUnreadLastRemoteStateKey) {
    workspaceSessionUnreadPendingPushStateKey = ''
  }
  writeWorkspaceSessionUnreadStoreSnapshot(normalizedSnapshot)
}

export const applyWorkspaceSessionUnreadBootstrapSnapshot = (snapshot: WorkspaceSessionUnreadStoreSnapshot) => {
  applyWorkspaceSessionUnreadRemoteSnapshot(snapshot)
  workspaceSessionUnreadLastRemotePullAt = Date.now()
  workspaceSessionUnreadRemoteSyncReady = true
}

const pushWorkspaceSessionUnreadSnapshotToServer = async (snapshot: WorkspaceSessionUnreadStoreSnapshot) => {
  const normalizedSnapshot = normalizeWorkspaceSessionUnreadStoreSnapshot(snapshot)
  const snapshotStateKey = buildWorkspaceSessionUnreadStateKey(normalizedSnapshot)
  if (snapshotStateKey === workspaceSessionUnreadLastRemoteStateKey) {
    workspaceSessionUnreadPendingPushStateKey = ''
    return
  }

  workspaceSessionUnreadPendingPushStateKey = snapshotStateKey
  const requestId = ++workspaceSessionUnreadRemotePushRequestId

  try {
    await api.saveWorkspaceSessionUnreadState(normalizedSnapshot)
    if (requestId !== workspaceSessionUnreadRemotePushRequestId) {
      return
    }

    workspaceSessionUnreadLastRemotePullAt = Date.now()
    applyWorkspaceSessionUnreadRemoteSnapshot(normalizedSnapshot)
  } catch {
    // Keep local state authoritative until the next successful sync attempt.
  } finally {
    if (
      requestId === workspaceSessionUnreadRemotePushRequestId
      && workspaceSessionUnreadPendingPushStateKey === snapshotStateKey
      && snapshotStateKey !== workspaceSessionUnreadLastRemoteStateKey
    ) {
      workspaceSessionUnreadPendingPushStateKey = ''
    }
  }
}

const scheduleWorkspaceSessionUnreadRemotePush = (snapshot = readWorkspaceSessionUnreadStoreSnapshot()) => {
  if (typeof window === 'undefined' || !shouldPushWorkspaceSessionUnreadRemoteSnapshot({
    ready: workspaceSessionUnreadRemoteSyncReady,
    snapshot,
    lastRemoteUpdatedAt: workspaceSessionUnreadLastRemoteUpdatedAt,
    lastRemoteStateKey: workspaceSessionUnreadLastRemoteStateKey,
    pendingPushStateKey: workspaceSessionUnreadPendingPushStateKey,
  })) {
    return
  }

  if (workspaceSessionUnreadPendingPushTimer !== null) {
    window.clearTimeout(workspaceSessionUnreadPendingPushTimer)
  }

  workspaceSessionUnreadPendingPushTimer = window.setTimeout(() => {
    workspaceSessionUnreadPendingPushTimer = null
    void pushWorkspaceSessionUnreadSnapshotToServer(readWorkspaceSessionUnreadStoreSnapshot())
  }, 300)
}

export const shouldPullWorkspaceSessionUnreadRemoteSnapshot = (params: {
  now: number
  lastPullAt: number
  cooldownMs: number
  force?: boolean
  pending?: boolean
}) => {
  if (params.pending) {
    return false
  }

  return Boolean(params.force || params.now - params.lastPullAt >= params.cooldownMs)
}

const pullWorkspaceSessionUnreadSnapshotFromServer = async (options: { force?: boolean } = {}) => {
  const now = Date.now()
  if (!shouldPullWorkspaceSessionUnreadRemoteSnapshot({
    now,
    lastPullAt: workspaceSessionUnreadLastRemotePullAt,
    cooldownMs: WORKSPACE_SESSION_UNREAD_REMOTE_PULL_COOLDOWN_MS,
    force: options.force,
    pending: Boolean(workspaceSessionUnreadPendingPullRequest),
  })) {
    return workspaceSessionUnreadPendingPullRequest ?? Promise.resolve()
  }

  workspaceSessionUnreadLastRemotePullAt = now
  const requestId = ++workspaceSessionUnreadRemotePullRequestId

  workspaceSessionUnreadPendingPullRequest = (async () => {
    const response = await api.getWorkspaceSessionUnreadState()
    if (requestId !== workspaceSessionUnreadRemotePullRequestId) {
      return
    }

    const remoteSnapshot = normalizeWorkspaceSessionUnreadStoreSnapshot(response.snapshot)
    const currentSnapshot = readWorkspaceSessionUnreadStoreSnapshot()
    const recency = compareWorkspaceSessionUnreadStoreSnapshotUpdatedAt(remoteSnapshot, currentSnapshot)

    if (recency > 0 || (recency === 0 && hasWorkspaceSessionUnreadStoreStateChanged(currentSnapshot, remoteSnapshot))) {
      applyWorkspaceSessionUnreadRemoteSnapshot(remoteSnapshot)
    } else if (recency < 0 && currentSnapshot.updatedAt) {
      await pushWorkspaceSessionUnreadSnapshotToServer(currentSnapshot)
    } else {
      workspaceSessionUnreadLastRemoteUpdatedAt = remoteSnapshot.updatedAt
      workspaceSessionUnreadLastRemoteStateKey = buildWorkspaceSessionUnreadStateKey(remoteSnapshot)
    }
  })()
    .catch(() => {
      // Ignore network failures and keep local state until the next sync attempt.
    })
    .finally(() => {
      if (requestId === workspaceSessionUnreadRemotePullRequestId) {
        workspaceSessionUnreadPendingPullRequest = null
      }
      workspaceSessionUnreadRemoteSyncReady = true
    })

  return workspaceSessionUnreadPendingPullRequest
}

const startWorkspaceSessionUnreadRemoteSync = () => {
  if (typeof window === 'undefined') {
    return () => {}
  }

  let lastFocusPullAt = Date.now()

  const pullWhenVisible = () => {
    if (document.visibilityState !== 'visible') {
      return
    }

    const now = Date.now()
    if (now - lastFocusPullAt < WORKSPACE_SESSION_UNREAD_REMOTE_FOCUS_COOLDOWN_MS) {
      return
    }

    lastFocusPullAt = now
    void pullWorkspaceSessionUnreadSnapshotFromServer()
  }

  void pullWorkspaceSessionUnreadSnapshotFromServer()

  const intervalId = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void pullWorkspaceSessionUnreadSnapshotFromServer()
    }
  }, WORKSPACE_SESSION_UNREAD_REMOTE_SYNC_INTERVAL_MS)
  const stopLocalChangeSubscription = subscribeWorkspaceSessionAttentionSync(() => {
    scheduleWorkspaceSessionUnreadRemotePush()
  })

  window.addEventListener('focus', pullWhenVisible)
  document.addEventListener('visibilitychange', pullWhenVisible)

  return () => {
    window.clearInterval(intervalId)
    if (workspaceSessionUnreadPendingPushTimer !== null) {
      window.clearTimeout(workspaceSessionUnreadPendingPushTimer)
      workspaceSessionUnreadPendingPushTimer = null
    }
    stopLocalChangeSubscription()
    window.removeEventListener('focus', pullWhenVisible)
    document.removeEventListener('visibilitychange', pullWhenVisible)
    workspaceSessionUnreadRemoteSyncReady = false
  }
}

const retainWorkspaceSessionUnreadRemoteSync = () => {
  if (typeof window !== 'undefined' && workspaceSessionUnreadRemoteSyncReleaseTimer !== null) {
    window.clearTimeout(workspaceSessionUnreadRemoteSyncReleaseTimer)
    workspaceSessionUnreadRemoteSyncReleaseTimer = null
  }

  workspaceSessionUnreadRemoteSyncRetainCount += 1
  if (workspaceSessionUnreadRemoteSyncRetainCount === 1 && !workspaceSessionUnreadRemoteSyncStop) {
    workspaceSessionUnreadRemoteSyncStop = startWorkspaceSessionUnreadRemoteSync()
  }

  return () => {
    workspaceSessionUnreadRemoteSyncRetainCount = Math.max(0, workspaceSessionUnreadRemoteSyncRetainCount - 1)
    if (workspaceSessionUnreadRemoteSyncRetainCount === 0) {
      if (typeof window === 'undefined') {
        workspaceSessionUnreadRemoteSyncStop?.()
        workspaceSessionUnreadRemoteSyncStop = null
        return
      }

      workspaceSessionUnreadRemoteSyncReleaseTimer = window.setTimeout(() => {
        workspaceSessionUnreadRemoteSyncReleaseTimer = null
        if (workspaceSessionUnreadRemoteSyncRetainCount === 0) {
          workspaceSessionUnreadRemoteSyncStop?.()
          workspaceSessionUnreadRemoteSyncStop = null
        }
      }, WORKSPACE_SESSION_UNREAD_REMOTE_RELEASE_DELAY_MS)
    }
  }
}

const hasRecordChanged = (
  current: Record<string, string>,
  next: Record<string, string>,
) => {
  const currentKeys = Object.keys(current)
  const nextKeys = Object.keys(next)

  return currentKeys.length !== nextKeys.length || nextKeys.some((key) => current[key] !== next[key])
}

const areSnapshotsEqual = (
  current: WorkspaceSessionUnreadStoreSnapshot,
  next: WorkspaceSessionUnreadStoreSnapshot,
) => {
  return (
    current.updatedAt === next.updatedAt
    && !hasWorkspaceSessionUnreadStoreStateChanged(current, next)
  )
}

const shouldReplaceSnapshot = (
  current: WorkspaceSessionUnreadStoreSnapshot,
  next: WorkspaceSessionUnreadStoreSnapshot,
) => {
  const recency = compareWorkspaceSessionUnreadStoreSnapshotUpdatedAt(next, current)
  if (recency > 0) {
    return true
  }

  if (recency < 0) {
    return false
  }

  return hasWorkspaceSessionUnreadStoreStateChanged(current, next)
}

export const shouldClearSelectedWorkspaceSessionManualUnread = (params: {
  previousSelectedWorkspaceSessionId: string | null
  selectedWorkspaceSessionId: string
  attentionSignature: string | null
  manuallyUnreadSessionAttentionById: WorkspaceSessionUnreadStoreState['manuallyUnreadSessionAttentionById']
}) => {
  const attentionSignature = params.attentionSignature?.trim() || ''

  return Boolean(
    attentionSignature
    && params.previousSelectedWorkspaceSessionId !== params.selectedWorkspaceSessionId
    && params.manuallyUnreadSessionAttentionById[params.selectedWorkspaceSessionId] === attentionSignature
  )
}

export const useWorkspaceSessionUnreadState = ({
  workspaceSessions,
  selectedWorkspaceSessionId,
}: UseWorkspaceSessionUnreadStateParams): WorkspaceSessionUnreadStoreState => {
  const previousSessionStatusesRef = useRef<Record<string, AgentRunningStatus>>({})
  const previousSelectedWorkspaceSessionIdRef = useRef<string | null>(null)
  const [storeSnapshot, setStoreSnapshot] = useState<WorkspaceSessionUnreadStoreSnapshot>(() => readWorkspaceSessionUnreadStoreSnapshot())

  const selectedWorkspaceSession = selectedWorkspaceSessionId
    ? workspaceSessions.find((session) => session.id === selectedWorkspaceSessionId) ?? null
    : null

  const applyExternalSnapshot = (nextSnapshot: WorkspaceSessionUnreadStoreSnapshot) => {
    const normalizedSnapshot = normalizeWorkspaceSessionUnreadStoreSnapshot(nextSnapshot)
    setStoreSnapshot((current) => {
      if (!shouldReplaceSnapshot(current, normalizedSnapshot)) {
        return current
      }

      return normalizedSnapshot
    })
  }

  const updateStoreState = (
    updater: (current: WorkspaceSessionUnreadStoreState) => WorkspaceSessionUnreadStoreState,
  ) => {
    setStoreSnapshot((current) => {
      const nextState = updater(current)
      if (!hasWorkspaceSessionUnreadStoreStateChanged(current, nextState)) {
        return current
      }

      return createWorkspaceSessionUnreadStoreSnapshot(nextState, new Date().toISOString())
    })
  }

  useEffect(() => {
    if (!selectedWorkspaceSession) {
      previousSelectedWorkspaceSessionIdRef.current = null
      return
    }

    const previousSelectedWorkspaceSessionId = previousSelectedWorkspaceSessionIdRef.current
    previousSelectedWorkspaceSessionIdRef.current = selectedWorkspaceSession.id
    const attentionSignature = getWorkspaceSessionAttentionSignature(selectedWorkspaceSession)
    // 会话处于运行中（无 attention 签名）时不 ack、也不清除旧 ack，
    // 避免每轮 turn 之间把「待确认」痕迹提前清掉。
    if (!attentionSignature) {
      return
    }

    // 延迟 ack：只有用户持续查看该会话（2.5s 内状态未继续变化）才静默已读。
    // 若期间会话状态再次变化（新 turn 开始 / 新签名），effect 重跑会重置计时器。
    const ackTimer = window.setTimeout(() => {
      updateStoreState((current) => {
        let changed = false
        const nextSessionAttentionById = { ...current.sessionAttentionById }
        const nextAcknowledgedSessionAttentionById = { ...current.acknowledgedSessionAttentionById }
        const nextManuallyUnreadSessionAttentionById = { ...current.manuallyUnreadSessionAttentionById }

        if (nextAcknowledgedSessionAttentionById[selectedWorkspaceSession.id] !== attentionSignature) {
          nextAcknowledgedSessionAttentionById[selectedWorkspaceSession.id] = attentionSignature
          changed = true
        }

        if (nextSessionAttentionById[selectedWorkspaceSession.id]) {
          delete nextSessionAttentionById[selectedWorkspaceSession.id]
          changed = true
        }

        if (shouldClearSelectedWorkspaceSessionManualUnread({
          previousSelectedWorkspaceSessionId,
          selectedWorkspaceSessionId: selectedWorkspaceSession.id,
          attentionSignature,
          manuallyUnreadSessionAttentionById: nextManuallyUnreadSessionAttentionById,
        })) {
          delete nextManuallyUnreadSessionAttentionById[selectedWorkspaceSession.id]
          changed = true
        }

        return changed
          ? {
              sessionAttentionById: nextSessionAttentionById,
              acknowledgedSessionAttentionById: nextAcknowledgedSessionAttentionById,
              manuallyUnreadSessionAttentionById: nextManuallyUnreadSessionAttentionById,
            }
          : current
      })
    }, WORKSPACE_SESSION_UNREAD_ACK_DELAY_MS)

    return () => window.clearTimeout(ackTimer)
  }, [selectedWorkspaceSession])

  useEffect(() => {
    updateStoreState((current) => {
      const nextSessionAttentionById = { ...current.sessionAttentionById }
      const nextAcknowledgedSessionAttentionById = { ...current.acknowledgedSessionAttentionById }
      const nextManuallyUnreadSessionAttentionById = { ...current.manuallyUnreadSessionAttentionById }
      const sessionIds = new Set(workspaceSessions.map((session) => session.id))

      for (const sessionId of Object.keys(nextSessionAttentionById)) {
        if (!sessionIds.has(sessionId)) {
          delete nextSessionAttentionById[sessionId]
        }
      }

      for (const sessionId of Object.keys(nextAcknowledgedSessionAttentionById)) {
        if (!sessionIds.has(sessionId)) {
          delete nextAcknowledgedSessionAttentionById[sessionId]
        }
      }

      for (const sessionId of Object.keys(nextManuallyUnreadSessionAttentionById)) {
        if (!sessionIds.has(sessionId)) {
          delete nextManuallyUnreadSessionAttentionById[sessionId]
        }
      }

      for (const session of workspaceSessions) {
        const previousStatus = previousSessionStatusesRef.current[session.id]
        const attentionSignature = getWorkspaceSessionAttentionSignature(session)

        if (previousStatus && isWorkspaceSessionBusy(previousStatus) && attentionSignature) {
          nextSessionAttentionById[session.id] = attentionSignature
        }

        if (isWorkspaceSessionBusy(session) || !attentionSignature) {
          delete nextSessionAttentionById[session.id]
        }

        if (isWorkspaceSessionBusy(session) || !attentionSignature) {
          delete nextAcknowledgedSessionAttentionById[session.id]
        }

        if (
          isWorkspaceSessionBusy(session)
          || !attentionSignature
          || nextManuallyUnreadSessionAttentionById[session.id] !== attentionSignature
        ) {
          delete nextManuallyUnreadSessionAttentionById[session.id]
        }
      }

      const sessionAttentionChanged = hasRecordChanged(current.sessionAttentionById, nextSessionAttentionById)
      const acknowledgedChanged = hasRecordChanged(current.acknowledgedSessionAttentionById, nextAcknowledgedSessionAttentionById)
      const manuallyUnreadChanged = hasRecordChanged(current.manuallyUnreadSessionAttentionById, nextManuallyUnreadSessionAttentionById)

      return sessionAttentionChanged || acknowledgedChanged || manuallyUnreadChanged
        ? {
            sessionAttentionById: nextSessionAttentionById,
            acknowledgedSessionAttentionById: nextAcknowledgedSessionAttentionById,
            manuallyUnreadSessionAttentionById: nextManuallyUnreadSessionAttentionById,
          }
        : current
    })

    previousSessionStatusesRef.current = Object.fromEntries(
      workspaceSessions.map((session) => [session.id, session.agentRunningStatus]),
    )
  }, [workspaceSessions])

  useEffect(() => {
    writeWorkspaceSessionUnreadStoreSnapshot(storeSnapshot)
  }, [storeSnapshot])

  useEffect(() => {
    return subscribeWorkspaceSessionAttentionSync(() => {
      const nextSnapshot = readWorkspaceSessionUnreadStoreSnapshot()
      applyExternalSnapshot(nextSnapshot)
    })
  }, [])

  useEffect(() => {
    return retainWorkspaceSessionUnreadRemoteSync()
  }, [])

  return storeSnapshot
}

export const useWorkspaceSessionUnreadSnapshot = (): WorkspaceSessionUnreadStoreState => {
  const [storeSnapshot, setStoreSnapshot] = useState<WorkspaceSessionUnreadStoreSnapshot>(() => readWorkspaceSessionUnreadStoreSnapshot())

  useEffect(() => {
    return subscribeWorkspaceSessionAttentionSync(() => {
      const nextSnapshot = readWorkspaceSessionUnreadStoreSnapshot()
      setStoreSnapshot((current) => areSnapshotsEqual(current, nextSnapshot) ? current : nextSnapshot)
    })
  }, [])

  return storeSnapshot
}
