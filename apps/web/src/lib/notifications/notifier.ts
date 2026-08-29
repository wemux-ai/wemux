/**
 * [INPUT]: 统一实时事件流（realtime-client）+ 应用状态（tasks/workspaceSessions）+ 用户通知设置。
 * [OUTPUT]: 浏览器通知矩阵：收件箱 @/指派、群聊 @你、群聊新消息、任务完成/失败、工作区会话完成/失败。
 * [POS]: 通知策略层。规则：设置开关 → 浏览器权限 → 焦点/会话视图（仅不在看时弹）→ 30s 类型限流 → 弹窗/提示音。
 *        任务/工作区完成做同趟去重：任务绑定的会话完成时合并为一条（优先任务措辞）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect, useRef } from 'react'
import { isInboxWakingKind, type InboxItem } from '@shared/inbox'
import { defaultUserNotificationSettings, hasAnyBrowserNotificationEnabled, type UserNotificationCategorySettings, type UserNotificationSettings } from '@shared/user-notification-settings'
import type { Task, WorkspaceSession } from '@shared/types'
import { realtimeClient } from '../realtime/realtime-client'
import { useRealtimeEvents } from '../realtime/useRealtime'
import { isNativeClient, showNativeNotification } from '../native-client'
import { ensurePushSubscription, removePushSubscription } from './push-subscription'
import {
  collectWorkspaceSessionCompletionNotifications,
  type TrackedWorkspaceSessionState,
  type WorkspaceSessionCompletionNotification,
  type WorkspaceSessionCompletionNotificationTone,
} from '../workspace-session-completion-notifications'

/** 通知矩阵类型（对应 user-notification-settings 的五个类别）。 */
export type RealtimeNotificationType =
  | 'inboxMention'
  | 'groupChatMention'
  | 'groupChatMessage'
  | 'taskCompletion'
  | 'workspaceSessionCompletion'

export const DM_INBOX_EVENT_TYPE = 'dm.message'
export const CONNECTION_REQUEST_EVENT_TYPE = 'user.connection.requested'
export const CONNECTION_ACCEPTED_EVENT_TYPE = 'user.connection.accepted'
export const TEAM_INVITATION_EVENT_TYPE = 'team.invitation.sent'

/** 收件箱中带任务作用域的终态事件（P2 服务端 task 事件落地后自动生效；当前客户端状态推导为主源）。 */
const TASK_TERMINAL_INBOX_REASONS = new Set(['workspace_completed', 'workspace_failed', 'status_changed'])

const RATE_LIMIT_WINDOW_MS = 30_000
const lastShownAtByType = new Map<RealtimeNotificationType, number>()

export const isNotificationRateLimited = (type: RealtimeNotificationType, now = Date.now()): boolean => {
  const lastShownAt = lastShownAtByType.get(type)
  if (lastShownAt !== undefined && now - lastShownAt < RATE_LIMIT_WINDOW_MS) {
    return true
  }
  lastShownAtByType.set(type, now)
  return false
}

export const resetNotificationRateLimits = () => {
  lastShownAtByType.clear()
}

export const resolveNotificationCategory = (
  type: RealtimeNotificationType,
  settings: UserNotificationSettings,
): UserNotificationCategorySettings => {
  switch (type) {
    case 'inboxMention':
      return settings.inboxMention
    case 'groupChatMention':
      return settings.groupChatMention
    case 'groupChatMessage':
      return settings.groupChatMessage
    case 'taskCompletion':
      return settings.taskCompletion
    case 'workspaceSessionCompletion':
      return settings.workspaceSessionCompletion
  }
}

const isBrowserPermissionGranted = () => {
  return typeof window !== 'undefined' && typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

const playNotificationSound = (tone: WorkspaceSessionCompletionNotificationTone = 'complete') => {
  if (typeof window === 'undefined') {
    return
  }

  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) {
    return
  }

  try {
    const context = new AudioContextCtor()
    const pattern = tone === 'error'
      ? [220, 160]
      : tone === 'attention'
        ? [660, 520]
        : [740, 880]

    pattern.forEach((frequency, index) => {
      const startAt = context.currentTime + index * 0.14
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, startAt)
      gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.12)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(startAt)
      oscillator.stop(startAt + 0.13)
    })

    const closeAt = context.currentTime + pattern.length * 0.16 + 0.1
    window.setTimeout(() => {
      void context.close().catch(() => undefined)
    }, Math.ceil(closeAt * 1000))
  } catch {
    // Ignore browser audio failures and keep the notification silent.
  }
}

export const showBrowserNotification = (params: { title: string; body: string; tag: string }): boolean => {
  // 原生客户端（WKWebView/WebView）无浏览器 Notification API，改走 Rust 系统通知
  if (isNativeClient()) {
    void showNativeNotification(params.title, params.body)
    return true
  }
  if (!isBrowserPermissionGranted()) {
    return false
  }
  try {
    new Notification(params.title, {
      body: params.body,
      tag: params.tag,
    })
    return true
  } catch {
    return false
  }
}

/** 焦点/会话视图规则：仅当前页面非聚焦、或不在该会话时弹。focused && inView → 抑制。 */
export const shouldSuppressForFocus = (context?: { conversationId?: string; workspaceSessionId?: string }): boolean => {
  if (typeof document === 'undefined') {
    return true
  }
  if (!document.hasFocus()) {
    return false
  }

  if (!context) {
    // 无会话上下文（收件箱类事件）：聚焦时页面内已有 toast/badge，抑制浏览器弹窗。
    return true
  }

  const view = realtimeClient.getActiveView()
  if (context.conversationId && view.conversationId === context.conversationId) {
    return true
  }
  if (context.workspaceSessionId && view.workspaceSessionId === context.workspaceSessionId) {
    return true
  }
  return false
}

export type DeliverBrowserNotificationParams = {
  type: RealtimeNotificationType
  settings: UserNotificationSettings
  title: string
  body: string
  tag: string
  tone?: WorkspaceSessionCompletionNotificationTone
  context?: { conversationId?: string; workspaceSessionId?: string }
}

/** 统一交付：设置开关 → 权限 → 焦点规则 → 限流 → 弹窗 + 提示音。 */
export const deliverBrowserNotification = (params: DeliverBrowserNotificationParams): boolean => {
  if (shouldSuppressForFocus(params.context)) {
    return false
  }
  if (isNotificationRateLimited(params.type)) {
    return false
  }

  const category = resolveNotificationCategory(params.type, params.settings)
  if (category.soundEnabled) {
    playNotificationSound(params.tone ?? 'complete')
  }
  if (!category.browserEnabled) {
    return false
  }

  return showBrowserNotification({
    title: params.title,
    body: params.body,
    tag: params.tag,
  })
}

// ---- 收件箱事件 → 通知映射 ----

const trimBody = (body: string, maxLength = 140) => {
  const trimmed = body.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= maxLength) {
    return trimmed
  }
  return `${trimmed.slice(0, maxLength - 1)}…`
}

export const buildInboxItemNotification = (item: InboxItem): Omit<DeliverBrowserNotificationParams, 'settings'> | null => {
  // P2-ready：收件箱带任务作用域的终态事件 → 任务完成/失败。
  if (item.scope.taskId && TASK_TERMINAL_INBOX_REASONS.has(item.reason)) {
    const failed = item.reason === 'workspace_failed'
    return {
      type: 'taskCompletion',
      title: failed ? '任务失败' : '任务已完成',
      body: trimBody(item.title),
      tag: `task-complete:${item.scope.taskId}`,
      tone: failed ? 'error' : 'complete',
    }
  }

  if (!isInboxWakingKind(item.kind)) {
    return null
  }

  // 私聊（DM）新消息：走收件箱条目通知（区别于群聊消息）。
  if (item.eventType === DM_INBOX_EVENT_TYPE) {
    return {
      type: 'inboxMention',
      title: `私聊：${item.title}`,
      body: trimBody(`${item.actorName}：${item.body}`),
      tag: `inbox:${item.id}`,
      tone: 'complete',
    }
  }

  // 好友请求 / 好友请求已接受：收件箱条目通知。
  if (item.eventType === CONNECTION_REQUEST_EVENT_TYPE || item.eventType === CONNECTION_ACCEPTED_EVENT_TYPE) {
    return {
      type: 'inboxMention',
      title: `好友请求：${item.title}`,
      body: trimBody(item.body),
      tag: `inbox:${item.id}`,
      tone: 'attention',
    }
  }

  // 协作空间加入邀请：收件箱条目通知。
  if (item.eventType === TEAM_INVITATION_EVENT_TYPE) {
    return {
      type: 'inboxMention',
      title: `加入邀请：${item.title}`,
      body: trimBody(`${item.actorName}：${item.body}`),
      tag: `inbox:${item.id}`,
      tone: 'attention',
    }
  }

  return {
    type: 'inboxMention',
    title: `收件箱：${item.title}`,
    body: trimBody(`${item.actorName}：${item.body}`),
    tag: `inbox:${item.id}`,
    tone: 'complete',
  }
}

// ---- 任务完成/失败：客户端状态推导（与工作区会话完成同源模式） ----

const TASK_BUSY_STATUSES = new Set<Task['agentRunningStatus']>(['thinking', 'executing', 'waiting'])

export type TrackedTaskState = Pick<
  Task,
  'id' | 'title' | 'agentRunningStatus' | 'updatedAt' | 'executionHistory' | 'result'
>

export type TaskCompletionNotification = {
  taskId: string
  taskTitle: string
  tone: 'complete' | 'error'
  /** 本次推导关联的工作区会话 id（用于与工作区会话完成通知去重）。 */
  boundWorkspaceSessionIds: string[]
}

const trackTaskState = (task: TrackedTaskState): TrackedTaskState => ({
  id: task.id,
  title: task.title,
  agentRunningStatus: task.agentRunningStatus,
  updatedAt: task.updatedAt,
  executionHistory: task.executionHistory,
  result: task.result,
})

/** 任务最近运行绑定到的工作区会话 id（用于与工作区会话完成通知去重；best-effort）。 */
const collectBoundWorkspaceSessionIds = (task: TrackedTaskState): string[] => {
  const ids = new Set<string>()
  if (task.result?.workspaceSessionId) ids.add(task.result.workspaceSessionId)
  for (const run of task.executionHistory ?? []) {
    if (run.workspaceSessionId) ids.add(run.workspaceSessionId)
  }
  return [...ids]
}

export const collectTaskCompletionNotifications = (params: {
  previousTasksById: Record<string, TrackedTaskState>
  tasks: TrackedTaskState[]
}): { notifications: TaskCompletionNotification[]; nextTasksById: Record<string, TrackedTaskState> } => {
  const notifications: TaskCompletionNotification[] = []
  const nextTasksById: Record<string, TrackedTaskState> = {}

  for (const task of params.tasks) {
    const trackedTask = trackTaskState(task)
    nextTasksById[task.id] = trackedTask

    const previousTask = params.previousTasksById[task.id]
    if (!previousTask) {
      continue
    }
    if (!TASK_BUSY_STATUSES.has(previousTask.agentRunningStatus)) {
      continue
    }

    if (trackedTask.agentRunningStatus === 'complete' || trackedTask.agentRunningStatus === 'error') {
      notifications.push({
        taskId: task.id,
        taskTitle: task.title,
        tone: trackedTask.agentRunningStatus === 'error' ? 'error' : 'complete',
        boundWorkspaceSessionIds: collectBoundWorkspaceSessionIds(trackedTask),
      })
    }
  }

  return {
    notifications,
    nextTasksById,
  }
}

// ---- 状态推导 → 通知（任务 + 工作区会话同趟去重） ----

const buildSessionNotificationTitle = (tone: WorkspaceSessionCompletionNotificationTone) => {
  if (tone === 'attention') {
    return '工作区会话待确认'
  }
  if (tone === 'error') {
    return '工作区会话执行出错'
  }
  return '工作区会话已完成'
}

export type CoalescedStateNotification = {
  type: 'taskCompletion' | 'workspaceSessionCompletion'
  title: string
  body: string
  tag: string
  tone: WorkspaceSessionCompletionNotificationTone
  context: { workspaceSessionId?: string }
}

/**
 * 同趟去重：任务绑定到「同趟完成的工作区会话」时合并为一条（优先任务措辞）；
 * 否则任务、会话各自独立成条。返回纯交付意图，展示由调用方执行。
 */
export const coalesceStateCompletionNotifications = (params: {
  settings: UserNotificationSettings
  sessionNotifications: WorkspaceSessionCompletionNotification[]
  taskNotifications: TaskCompletionNotification[]
}): CoalescedStateNotification[] => {
  const deliveries: CoalescedStateNotification[] = []
  const candidateSessionIds = new Set(params.sessionNotifications.map((notification) => notification.sessionId))

  // 任务绑定到同趟完成的会话 → 合并进会话条目（下面的 taskBoundSession 分支），这里跳过。
  const coalescedTaskIds = new Set(
    params.taskNotifications
      .filter((notification) => notification.boundWorkspaceSessionIds.some((sessionId) => candidateSessionIds.has(sessionId)))
      .map((notification) => notification.taskId),
  )

  for (const taskNotification of params.taskNotifications) {
    if (coalescedTaskIds.has(taskNotification.taskId)) {
      continue
    }
    const failed = taskNotification.tone === 'error'
    deliveries.push({
      type: 'taskCompletion',
      title: failed ? '任务执行失败' : '任务已完成',
      body: trimBody(taskNotification.taskTitle),
      tag: `task-complete:${taskNotification.taskId}`,
      tone: taskNotification.tone,
      context: { workspaceSessionId: taskNotification.boundWorkspaceSessionIds[0] },
    })
  }

  for (const sessionNotification of params.sessionNotifications) {
    const taskBoundSession = params.taskNotifications.find((taskNotification) => (
      taskNotification.boundWorkspaceSessionIds.includes(sessionNotification.sessionId)
    ))
    if (taskBoundSession) {
      // 任务绑定的会话完成：优先「任务完成」措辞（任务设置行控制），任务行整体关闭时回退会话措辞。
      const taskSettings = params.settings.taskCompletion
      if (taskSettings.browserEnabled || taskSettings.soundEnabled) {
        const failed = taskBoundSession.tone === 'error'
        deliveries.push({
          type: 'taskCompletion',
          title: failed ? '任务执行失败' : '任务已完成',
          body: trimBody(`${taskBoundSession.taskTitle}（${sessionNotification.sessionTitle}）`),
          tag: `task-complete:${taskBoundSession.taskId}`,
          tone: taskBoundSession.tone,
          context: { workspaceSessionId: sessionNotification.sessionId },
        })
        continue
      }
    }

    deliveries.push({
      type: 'workspaceSessionCompletion',
      title: buildSessionNotificationTitle(sessionNotification.tone),
      body: trimBody(sessionNotification.sessionTitle),
      tag: `workspace-session-complete:${sessionNotification.sessionId}`,
      tone: sessionNotification.tone,
      context: { workspaceSessionId: sessionNotification.sessionId },
    })
  }

  return deliveries
}

export const deliverStateCompletionNotifications = (params: {
  settings: UserNotificationSettings
  sessionNotifications: WorkspaceSessionCompletionNotification[]
  taskNotifications: TaskCompletionNotification[]
}) => {
  const deliveries = coalesceStateCompletionNotifications(params)
  for (const delivery of deliveries) {
    deliverBrowserNotification({
      type: delivery.type,
      settings: params.settings,
      title: delivery.title,
      body: delivery.body,
      tag: delivery.tag,
      tone: delivery.tone,
      context: delivery.context,
    })
  }
}

// ---- React hook（挂在全局 app shell） ----

export type UseRealtimeNotifierParams = {
  settings: UserNotificationSettings
  tasks: Task[]
  workspaceSessions: WorkspaceSession[]
}

export const useRealtimeNotifier = (params: UseRealtimeNotifierParams) => {
  const settingsRef = useRef(params.settings)
  settingsRef.current = params.settings
  const previousSessionsByIdRef = useRef<Record<string, TrackedWorkspaceSessionState>>({})
  const previousTasksByIdRef = useRef<Record<string, TrackedTaskState>>({})

  useEffect(() => {
    const { notifications: sessionNotifications, nextSessionsById } = collectWorkspaceSessionCompletionNotifications({
      previousSessionsById: previousSessionsByIdRef.current,
      workspaceSessions: params.workspaceSessions,
    })
    previousSessionsByIdRef.current = nextSessionsById

    const { notifications: taskNotifications, nextTasksById } = collectTaskCompletionNotifications({
      previousTasksById: previousTasksByIdRef.current,
      tasks: params.tasks,
    })
    previousTasksByIdRef.current = nextTasksById

    deliverStateCompletionNotifications({
      settings: settingsRef.current ?? defaultUserNotificationSettings(),
      sessionNotifications,
      taskNotifications,
    })
  }, [params.tasks, params.workspaceSessions])

  useRealtimeEvents((event) => {
    if (event.type === 'inbox.item.created') {
      const mapped = buildInboxItemNotification(event.item)
      if (mapped) {
        deliverBrowserNotification({
          ...mapped,
          settings: settingsRef.current,
        })
      }
      return
    }

    if (event.type === 'conversation.event' && event.event.type === 'message.created') {
      const message = event.event.payload.message as { id?: string; role?: string; content?: string; authorName?: string } | undefined
      if (!message?.id || typeof message.content !== 'string') {
        return
      }
      // 私聊消息的提醒走收件箱条目（dm.message inbox item），这里只处理群聊/任务会话，避免双重通知。
      if (event.event.payload.conversationKind === 'dm') {
        return
      }
      deliverBrowserNotification({
        type: 'groupChatMessage',
        settings: settingsRef.current,
        title: '群聊新消息',
        body: trimBody(`${message.authorName ?? ''}：${message.content}`),
        tag: `group-chat-message:${message.id}`,
        tone: 'complete',
        context: { conversationId: event.conversationId },
      })
    }
  })
}

/**
 * Web Push 自动订阅（feature P3）：任一浏览器通知类别开启且权限 granted → 订阅；
 * 全部关闭（或权限 denied）→ 退订。挂在 app shell，页面关闭也能收通知。
 */
export const useAutoPushSubscription = (settings: UserNotificationSettings) => {
  const lastDirectionRef = useRef<boolean | null>(null)

  useEffect(() => {
    const shouldEnable = hasAnyBrowserNotificationEnabled(settings)
    if (lastDirectionRef.current === shouldEnable) {
      return
    }
    lastDirectionRef.current = shouldEnable

    const run = async () => {
      if (!shouldEnable) {
        await removePushSubscription().catch(() => undefined)
        return
      }
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        await ensurePushSubscription().catch(() => undefined)
      }
    }

    void run()
  }, [
    settings.inboxMention.browserEnabled,
    settings.groupChatMention.browserEnabled,
    settings.groupChatMessage.browserEnabled,
    settings.taskCompletion.browserEnabled,
    settings.workspaceSessionCompletion.browserEnabled,
  ])
}
