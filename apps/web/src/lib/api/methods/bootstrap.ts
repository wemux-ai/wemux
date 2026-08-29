import type { ApiResponse, WorkspaceSessionUnreadStateResponse, WorkspaceSessionUnreadStateSaveResponse } from '../types'
import type { UserNotificationSettings } from '@shared/user-notification-settings'
import type { UserExperimentalSettings } from '@shared/user-experimental-settings'
import type { UserAppearanceSettings } from '@shared/user-appearance-settings'
import { request } from '../client'

export const bootstrapMethods = {
  bootstrap: (options?: {
    mainChat?: 'full' | 'summary'
    scope?: 'default' | 'workspaces' | 'kanban'
    taskId?: string
    workspaceId?: string
    workspaceSessionId?: string
    signal?: AbortSignal
  }) => {
    const search = new URLSearchParams()
    if (options?.mainChat) {
      search.set('mainChat', options.mainChat)
    }
    if (options?.scope && options.scope !== 'default') {
      search.set('scope', options.scope)
    }
    if (options?.taskId?.trim()) {
      search.set('taskId', options.taskId.trim())
    }
    if (options?.workspaceId?.trim()) {
      search.set('workspaceId', options.workspaceId.trim())
    }
    if (options?.workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', options.workspaceSessionId.trim())
    }

    const queryString = search.toString()
    return request<ApiResponse>(`/api/bootstrap${queryString ? `?${queryString}` : ''}`, {
      signal: options?.signal,
    })
  },
  getWorkspaceSessionUnreadState: () =>
    request<WorkspaceSessionUnreadStateResponse>('/api/workspace-session-unread-state'),
  saveWorkspaceSessionUnreadState: (snapshot: WorkspaceSessionUnreadStateResponse['snapshot']) =>
    request<WorkspaceSessionUnreadStateSaveResponse>('/api/workspace-session-unread-state', {
      method: 'PUT',
      body: JSON.stringify(snapshot),
    }),
  getMyNotificationSettings: () =>
    request<{ settings: UserNotificationSettings }>('/api/auth/me/notification-settings'),
  saveMyNotificationSettings: (settings: UserNotificationSettings) =>
    request<{ settings: UserNotificationSettings }>('/api/auth/me/notification-settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  getMyExperimentalSettings: () =>
    request<{ settings: UserExperimentalSettings }>('/api/auth/me/experimental-settings'),
  saveMyExperimentalSettings: (settings: UserExperimentalSettings) =>
    request<{ settings: UserExperimentalSettings }>('/api/auth/me/experimental-settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  getMyAppearanceSettings: () => request<{ settings: UserAppearanceSettings }>('/api/auth/me/appearance-settings'),
  saveMyAppearanceSettings: (settings: UserAppearanceSettings) => request<{ settings: UserAppearanceSettings }>('/api/auth/me/appearance-settings', {
    method: 'PUT', body: JSON.stringify(settings),
  }),
  testMyFeishuNotification: (settings: UserNotificationSettings) =>
    request<{ ok: boolean; message: string }>('/api/auth/me/notification-settings/feishu/test', {
      method: 'POST',
      body: JSON.stringify(settings),
    }),
  // ---- Web Push（feature P3）----
  getMyPushVapidKey: () =>
    request<{ publicKey: string }>('/api/auth/me/push-vapid-key'),
  listMyPushSubscriptions: () =>
    request<{ subscriptions: Array<{ id: string; endpoint: string; userAgent?: string; lastUsedAt?: string; createdAt: string }> }>('/api/auth/me/push-subscriptions'),
  saveMyPushSubscription: (subscription: { endpoint: string; p256dh: string; auth: string; userAgent?: string }) =>
    request<{ subscription: { id: string; endpoint: string } }>('/api/auth/me/push-subscriptions', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }),
  deleteMyPushSubscriptionById: (id: string) =>
    request<{ ok: boolean }>(`/api/auth/me/push-subscriptions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  deleteMyPushSubscriptionByEndpoint: (subscription: { endpoint: string }) =>
    request<{ ok: boolean }>('/api/auth/me/push-subscriptions', {
      method: 'DELETE',
      body: JSON.stringify(subscription),
    }),
  testMyPushSubscription: () =>
    request<{ message: string }>('/api/auth/me/push-subscriptions/test', {
      method: 'POST',
    }),
}
