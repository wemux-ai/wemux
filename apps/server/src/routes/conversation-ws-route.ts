/**
 * [INPUT]: Hono app + WS upgrade，会话实时订阅（群聊/任务会话消息、表情、删除）。
 * [OUTPUT]: /api/conversations/:id/ws 增量事件流（seq 游标回放）。
 * [POS]: 统一会话（Conversation）WS 实时协议层；对齐 main-chat-ws-route / workspace-session-history-ws-route 模式。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { Hono } from 'hono'
import { z } from 'zod'
import { parseTokenUserId } from '../repositories/auth'
import {
  registerConversationWsConnection,
  sendConversationWsMessage,
  unregisterConversationWsConnection,
} from '../services/conversation-ws-service'
import { resolveConversationAccess } from '../control-plane/conversation-access'
import { jsonError } from './shared'

const querySchema = z.object({
  lastSeq: z.coerce.number().int().min(0).optional(),
})

export const registerConversationWsRoute = (app: Hono, upgradeWebSocket: any) => {
  app.get(
    '/api/conversations/:id/ws',
    async (c, next) => {
      const token = c.req.query('token') || c.req.header('Authorization')?.replace(/^Bearer\s+/, '')
      const userId = token ? parseTokenUserId(token) : null
      if (!userId) {
        return c.json({ message: '未登录' }, 401)
      }

      const conversationId = c.req.param('id')
      const query = querySchema.parse(c.req.query())

      const access = await resolveConversationAccess({
        conversationId,
        viewer: { type: 'user', id: userId },
      })
      if (!access.ok) {
        return jsonError(c, access.message, access.status)
      }

      ;(c as any).set('conversationWsId', conversationId)
      ;(c as any).set('conversationWsLastSeq', query.lastSeq)
      await next()
    },
    upgradeWebSocket((c: any) => {
      const conversationId = c.get('conversationWsId') as string
      const lastSeq = c.get('conversationWsLastSeq') as number | undefined
      let subscriberId = ''

      const sendError = (ws: any, message: string) => {
        sendConversationWsMessage(ws, {
          type: 'conversation.error',
          message,
        })
      }

      return {
        onOpen(_: Event, ws: any) {
          try {
            subscriberId = registerConversationWsConnection({
              conversationId,
              socket: ws,
              lastSeq,
            })
          } catch (error) {
            sendError(ws, error instanceof Error ? error.message : '会话订阅失败。')
            ws.close(1011, 'conversation subscribe failed')
          }
        },
        onMessage(event: MessageEvent<string>, ws: any) {
          const raw = String(event.data ?? '').trim()
          if (raw === 'ping') {
            ws.send('pong')
          }
        },
        onClose() {
          if (subscriberId) {
            unregisterConversationWsConnection(conversationId, subscriberId)
          }
        },
      }
    }),
  )
}
