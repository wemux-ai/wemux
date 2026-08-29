/**
 * [INPUT]: WebSocket upgrade requests for main chat thread subscriptions.
 * [OUTPUT]: Per-thread incremental event stream with seq-based cursor replay.
 * [POS]: Main chat WebSocket route; mirrors workspace-session-history-ws-route pattern.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { Hono } from 'hono'
import { z } from 'zod'
import { parseTokenUserId } from '../repositories/auth'
import {
  registerMainChatWsConnection,
  sendMainChatWsMessage,
  unregisterMainChatWsConnection,
} from '../services/main-chat-ws-service'
import { loadState } from '../storage/app-state-store'

const querySchema = z.object({
  lastSeq: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

export const registerMainChatWsRoute = (app: Hono, upgradeWebSocket: any) => {
  app.get(
    '/api/ai/sessions/:id/ws',
    async (c, next) => {
      const token = c.req.query('token') || c.req.header('Authorization')?.replace(/^Bearer\s+/, '')
      const userId = token ? parseTokenUserId(token) : null
      if (!userId) {
        return c.json({ message: '未登录' }, 401)
      }

      const sessionId = c.req.param('id')
      const query = querySchema.parse(c.req.query())

      // 确认会话存在（无 ACL 校验，对齐 GET /api/ai/sessions/:id 行为）
      const state = loadState()
      const session = state.mainChatSessions.find((item) => item.id === sessionId)
      if (!session) {
        return c.json({ message: '会话不存在。' }, 404)
      }

      ;(c as any).set('mainChatThreadId', sessionId)
      ;(c as any).set('mainChatLastSeq', query.lastSeq)
      ;(c as any).set('mainChatLimit', query.limit)
      await next()
    },
    upgradeWebSocket((c: any) => {
      const threadId = c.get('mainChatThreadId') as string
      const lastSeq = c.get('mainChatLastSeq') as number | undefined
      let subscriberId = ''

      const sendError = (ws: any, message: string) => {
        sendMainChatWsMessage(ws, {
          type: 'main_chat.error',
          message,
        })
      }

      return {
        onOpen(_: Event, ws: any) {
          try {
            subscriberId = registerMainChatWsConnection({
              threadId,
              socket: ws,
              lastSeq,
            })
            console.info('[main-chat-ws] subscribed', JSON.stringify({
              threadId,
              subscriberId,
              lastSeq: lastSeq ?? null,
            }))
          } catch (error) {
            sendError(ws, error instanceof Error ? error.message : '主对话订阅失败。')
            ws.close(1011, 'main chat subscribe failed')
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
            unregisterMainChatWsConnection(threadId, subscriberId)
          }
        },
      }
    }),
  )
}
