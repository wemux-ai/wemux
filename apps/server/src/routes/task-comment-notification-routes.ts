/**
 * [INPUT]: Authenticated notification list and read-state requests.
 * [OUTPUT]: User-scoped mention inbox responses for task comments and workspace group chat.
 * [POS]: HTTP boundary for the global mention notification inbox.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import type { InboxQueryScope } from '@shared/inbox'
import {
  archiveInboxGroup,
  archiveInboxItem,
  countUnreadGroups,
  listInboxGroupItems,
  listInboxGroups,
  markInboxGroupRead,
  markInboxItemRead,
  snoozeInboxGroup,
  snoozeInboxItem,
  unsnoozeInboxGroup,
  unsnoozeInboxItem,
} from '../services/inbox-service'
import {
  listUserMentionNotifications,
  markAllUserMentionNotificationsRead,
  markUserMentionNotificationRead,
} from '../services/user-mention-notification-service'
import { createInboxStream } from '../services/inbox-stream'
import { getUserIdFromHeader } from './shared'

const sectionSchema = z.enum(['all', 'action', 'following', 'snoozed', 'archived'])
const snoozeSchema = z.object({ until: z.string().datetime() })

const readSection = (value?: string): InboxQueryScope => {
  const parsed = sectionSchema.safeParse(value)
  return parsed.success ? parsed.data : 'action'
}

const streamResponse = (stream: ReadableStream<Uint8Array>) => new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  },
})

export const registerTaskCommentNotificationRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/inbox/groups', requireAuth, async (c) => {
    return c.json(await listInboxGroups({
      recipientId: getUserIdFromHeader(c)!,
      section: readSection(c.req.query('section')),
      cursor: c.req.query('cursor') || undefined,
      limit: Math.min(Math.max(Number(c.req.query('limit')) || 40, 1), 100),
    }))
  })

  app.get('/api/inbox/groups/:groupKey/items', requireAuth, async (c) => {
    return c.json(await listInboxGroupItems({
      recipientId: getUserIdFromHeader(c)!,
      groupKey: decodeURIComponent(c.req.param('groupKey')),
      section: readSection(c.req.query('section')),
      cursor: c.req.query('cursor') || undefined,
      limit: Math.min(Math.max(Number(c.req.query('limit')) || 100, 1), 200),
    }))
  })

  app.get('/api/inbox/badge', requireAuth, async (c) => c.json({
    unreadGroups: await countUnreadGroups(getUserIdFromHeader(c)!),
  }))

  app.get('/api/inbox/stream', requireAuth, (c) => streamResponse(createInboxStream(getUserIdFromHeader(c)!)))

  app.post('/api/inbox/groups/:groupKey/read', requireAuth, async (c) => c.json({
    ok: true,
    updated: await markInboxGroupRead({
      recipientId: getUserIdFromHeader(c)!,
      groupKey: decodeURIComponent(c.req.param('groupKey')),
    }),
  }))

  app.post('/api/inbox/groups/:groupKey/archive', requireAuth, async (c) => c.json({
    ok: true,
    updated: await archiveInboxGroup({
      recipientId: getUserIdFromHeader(c)!,
      groupKey: decodeURIComponent(c.req.param('groupKey')),
    }),
  }))

  app.post('/api/inbox/groups/:groupKey/snooze', requireAuth, async (c) => {
    const input = snoozeSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!input.success || new Date(input.data.until).getTime() <= Date.now()) {
      return c.json({ message: '稍后提醒时间必须是未来时间。' }, 400)
    }
    return c.json({
      ok: true,
      updated: await snoozeInboxGroup({
        recipientId: getUserIdFromHeader(c)!,
        groupKey: decodeURIComponent(c.req.param('groupKey')),
        until: input.data.until,
      }),
    })
  })

  app.post('/api/inbox/groups/:groupKey/unsnooze', requireAuth, async (c) => c.json({
    ok: true,
    updated: await unsnoozeInboxGroup({
      recipientId: getUserIdFromHeader(c)!,
      groupKey: decodeURIComponent(c.req.param('groupKey')),
    }),
  }))

  app.post('/api/inbox/items/:id/read', requireAuth, async (c) => {
    if (!await markInboxItemRead(getUserIdFromHeader(c)!, c.req.param('id'))) {
      return c.json({ message: '收件箱项目不存在。' }, 404)
    }
    return c.json({ ok: true })
  })

  app.post('/api/inbox/items/:id/archive', requireAuth, async (c) => {
    if (!await archiveInboxItem(getUserIdFromHeader(c)!, c.req.param('id'))) {
      return c.json({ message: '收件箱项目不存在。' }, 404)
    }
    return c.json({ ok: true })
  })

  app.post('/api/inbox/items/:id/snooze', requireAuth, async (c) => {
    const input = snoozeSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!input.success || new Date(input.data.until).getTime() <= Date.now()) {
      return c.json({ message: '稍后提醒时间必须是未来时间。' }, 400)
    }
    if (!await snoozeInboxItem({ recipientId: getUserIdFromHeader(c)!, itemId: c.req.param('id'), until: input.data.until })) {
      return c.json({ message: '收件箱项目不存在或已归档。' }, 404)
    }
    return c.json({ ok: true })
  })

  app.post('/api/inbox/items/:id/unsnooze', requireAuth, async (c) => {
    if (!await unsnoozeInboxItem(getUserIdFromHeader(c)!, c.req.param('id'))) {
      return c.json({ message: '收件箱项目不存在。' }, 404)
    }
    return c.json({ ok: true })
  })

  app.get('/api/notifications', requireAuth, async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit')) || 40, 1), 100)
    return c.json(await listUserMentionNotifications(getUserIdFromHeader(c)!, limit))
  })

  app.get('/api/notifications/stream', requireAuth, (c) => (
    streamResponse(createInboxStream(getUserIdFromHeader(c)!))
  ))

  app.post('/api/notifications/:id/read', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    if (!await markUserMentionNotificationRead(userId, c.req.param('id'))) {
      return c.json({ message: '通知不存在。' }, 404)
    }
    return c.json(await listUserMentionNotifications(userId))
  })

  app.post('/api/notifications/read-all', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    await markAllUserMentionNotificationsRead(userId)
    return c.json(await listUserMentionNotifications(userId))
  })
}
