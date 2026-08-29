import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type {
  InboxBadgeResponse,
  InboxGroupListResponse,
  InboxItemListResponse,
  InboxQueryScope,
  InboxSnoozeInput,
} from '@shared/inbox'
import type { UserMentionNotificationResponse } from '../types'
import { authFetch, extractErrorMessage, request, resolveApiUrl } from '../client'

export const miscMethods = {
  getUserMentionNotifications: (limit = 40) =>
    request<UserMentionNotificationResponse>(`/api/notifications?limit=${limit}`),
  markUserMentionNotificationRead: (notificationId: string) =>
    request<UserMentionNotificationResponse>(`/api/notifications/${notificationId}/read`, { method: 'POST' }),
  markAllUserMentionNotificationsRead: () =>
    request<UserMentionNotificationResponse>('/api/notifications/read-all', { method: 'POST' }),
  getInboxGroups: (section: InboxQueryScope, options: { cursor?: string; limit?: number } = {}) => {
    const search = new URLSearchParams({ section })
    if (options.cursor) search.set('cursor', options.cursor)
    if (options.limit) search.set('limit', String(options.limit))
    return request<InboxGroupListResponse>(`/api/inbox/groups?${search.toString()}`)
  },
  getInboxGroupItems: (groupKey: string, section: InboxQueryScope, options: { cursor?: string; limit?: number } = {}) => {
    const search = new URLSearchParams({ section })
    if (options.cursor) search.set('cursor', options.cursor)
    if (options.limit) search.set('limit', String(options.limit))
    return request<InboxItemListResponse>(`/api/inbox/groups/${encodeURIComponent(groupKey)}/items?${search.toString()}`)
  },
  getInboxBadge: () => request<InboxBadgeResponse>('/api/inbox/badge'),
  markInboxGroupRead: (groupKey: string) =>
    request<{ ok: boolean; updated: number }>(`/api/inbox/groups/${encodeURIComponent(groupKey)}/read`, { method: 'POST' }),
  archiveInboxGroup: (groupKey: string) =>
    request<{ ok: boolean; updated: number }>(`/api/inbox/groups/${encodeURIComponent(groupKey)}/archive`, { method: 'POST' }),
  snoozeInboxGroup: (groupKey: string, input: InboxSnoozeInput) =>
    request<{ ok: boolean; updated: number }>(`/api/inbox/groups/${encodeURIComponent(groupKey)}/snooze`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  unsnoozeInboxGroup: (groupKey: string) =>
    request<{ ok: boolean; updated: number }>(`/api/inbox/groups/${encodeURIComponent(groupKey)}/unsnooze`, { method: 'POST' }),
  markInboxItemRead: (itemId: string) =>
    request<{ ok: boolean }>(`/api/inbox/items/${encodeURIComponent(itemId)}/read`, { method: 'POST' }),
  archiveInboxItem: (itemId: string) =>
    request<{ ok: boolean }>(`/api/inbox/items/${encodeURIComponent(itemId)}/archive`, { method: 'POST' }),
  snoozeInboxItem: (itemId: string, input: InboxSnoozeInput) =>
    request<{ ok: boolean }>(`/api/inbox/items/${encodeURIComponent(itemId)}/snooze`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  unsnoozeInboxItem: (itemId: string) =>
    request<{ ok: boolean }>(`/api/inbox/items/${encodeURIComponent(itemId)}/unsnooze`, { method: 'POST' }),
  uploadImage: async (taskId: string, imageBase64: string, filename: string) => {
    const response = await authFetch(resolveApiUrl(`/api/tasks/${taskId}/images`), {
      method: 'POST',
      body: JSON.stringify({ image: imageBase64, filename }),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(text ? extractErrorMessage(text) : `Upload failed: ${response.status}`)
    }
    return response.json() as Promise<{ id: string; url: string }>
  },
  uploadTaskCommentAttachment: async (taskId: string, fileBase64: string, filename: string, contentType?: string) => {
    const response = await authFetch(resolveApiUrl(`/api/tasks/${taskId}/attachments`), {
      method: 'POST',
      body: JSON.stringify({ file: fileBase64, filename, contentType, purpose: 'comment' }),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(text ? extractErrorMessage(text) : `Upload failed: ${response.status}`)
    }
    return response.json() as Promise<TaskChatAttachment>
  },
  uploadMainChatImage: async (imageBase64: string, filename: string) => {
    const response = await authFetch(resolveApiUrl('/api/ai/images'), {
      method: 'POST',
      body: JSON.stringify({ image: imageBase64, filename }),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(text ? extractErrorMessage(text) : `Upload failed: ${response.status}`)
    }
    return response.json() as Promise<{ id: string; url: string; contentType?: string }>
  },
}
