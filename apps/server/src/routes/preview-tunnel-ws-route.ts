// [INPUT]: Hono app + WS upgrade，preview tunnel 连接
// [OUTPUT]: preview tunnel WS 路由
// [POS]: 预览隧道 WS 协议层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono } from 'hono'
import {
  normalizePreviewTunnelChunkBytes,
  PREVIEW_TUNNEL_DEFAULT_CHUNK_BYTES,
  type PreviewBindAckFrame,
  type PreviewBindFrame,
  type PreviewTunnelFrame,
  type PreviewTunnelPingFrame,
} from '@shared/types'
import { decodePreviewTunnelBinaryFrame } from '@shared/types'
import { clusterConfig } from '../cluster/config'
import { previewSessionService } from '../services/preview-session-service'
import { previewTunnelService } from '../services/preview-tunnel-service'

const parseTunnelFrame = (raw: string) => {
  return JSON.parse(raw) as PreviewTunnelFrame
}

const readBinaryMessage = async (data: unknown): Promise<Uint8Array | null> => {
  if (typeof data === 'string') {
    return null
  }

  if (data instanceof Uint8Array) {
    return data
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer())
  }

  return null
}

const logPreviewTunnelWs = (message: string, details: Record<string, unknown>) => {
  console.log('[preview-tunnel-ws]', message, details)
}

export const registerPreviewTunnelWsRoute = (app: Hono, upgradeWebSocket: any) => {
  app.get(
    '/api/preview-tunnels/ws',
    async (c, next) => {
      const previewSessionId = c.req.query('preview_session_id')?.trim() || ''
      const token = c.req.query('token')?.trim() || ''
      if (!previewSessionId || !token) {
        logPreviewTunnelWs('missing auth params', {
          previewSessionId: previewSessionId || undefined,
          hasToken: Boolean(token),
        })
        return c.json({ message: '缺少 preview tunnel 鉴权参数。' }, 401)
      }

      const session = previewSessionService.validateTunnelToken(previewSessionId, token)
      if (!session) {
        logPreviewTunnelWs('invalid tunnel token', { previewSessionId })
        return c.json({ message: 'preview tunnel token 无效。' }, 401)
      }
      logPreviewTunnelWs('auth accepted', {
        previewSessionId,
        executorId: session.executorId,
        status: session.status,
        tunnelClientStatus: session.tunnelClientStatus,
      })

      ;(c as any).set('previewSessionId', previewSessionId)
      await next()
    },
    upgradeWebSocket((c: any) => {
      const previewSessionId = c.get('previewSessionId') as string
      const connectionId = crypto.randomUUID()
      let bound = false
      let binaryPayloadsAccepted = false

      return {
        async onMessage(event: MessageEvent<unknown>, ws: any) {
          const binaryMessage = await readBinaryMessage(event.data)
          if (binaryMessage) {
            if (!bound || !binaryPayloadsAccepted) {
              ws.close(4410, 'preview tunnel binary payloads not negotiated')
              return
            }

            const decoded = decodePreviewTunnelBinaryFrame(binaryMessage)
            if (!decoded || decoded.header.previewSessionId !== previewSessionId) {
              ws.close(4410, 'invalid preview tunnel binary frame')
              return
            }

            previewTunnelService.handleBinaryFrame(decoded.header, decoded.payload)
            return
          }

          let frame: PreviewTunnelFrame
          try {
            frame = parseTunnelFrame(String(event.data))
          } catch {
            ws.close(4410, 'invalid preview tunnel frame')
            return
          }

          if (frame.previewSessionId !== previewSessionId) {
            ws.close(4410, 'preview session mismatch')
            return
          }

          if (frame.type === 'preview.bind') {
            const bind = frame as PreviewBindFrame
            const session = previewSessionService.getSessionById(previewSessionId)
            const accepted = Boolean(
              session
              && session.executorId === bind.executorId
              && previewSessionService.markTunnelConnected(previewSessionId, connectionId, clusterConfig.nodeId),
            )
            const binaryPayloads = accepted && bind.binaryPayloads === true
            const negotiatedChunkBytes = accepted
              ? normalizePreviewTunnelChunkBytes(bind.preferredChunkBytes ?? PREVIEW_TUNNEL_DEFAULT_CHUNK_BYTES)
              : undefined
            const ack: PreviewBindAckFrame = {
              type: 'preview.bind.ack',
              previewSessionId,
              sentAt: new Date().toISOString(),
              accepted,
              reason: accepted ? 'ok' : 'executor_mismatch',
              connectionId,
              publicHost: session?.publicHost,
              idleTimeoutMs: 30_000,
              maxChunkBytes: negotiatedChunkBytes,
              binaryPayloads,
            }
            ws.send(JSON.stringify(ack))
            logPreviewTunnelWs(accepted ? 'bind accepted' : 'bind rejected', {
              previewSessionId,
              connectionId,
              executorId: bind.executorId,
              expectedExecutorId: session?.executorId,
              reason: ack.reason,
            })
            if (!accepted) {
              ws.close(4409, 'preview tunnel conflict')
              return
            }
            bound = true
            binaryPayloadsAccepted = binaryPayloads
            previewTunnelService.registerConnection(previewSessionId, connectionId, ws, {
              binaryPayloads,
              negotiatedChunkBytes,
            })
            return
          }

          previewTunnelService.handleFrame(frame)

          if (frame.type === 'preview.tunnel.ping') {
            const ping = frame as PreviewTunnelPingFrame
            ws.send(JSON.stringify({
              type: 'preview.tunnel.pong',
              previewSessionId,
              sentAt: new Date().toISOString(),
              pingId: ping.pingId,
            }))
            return
          }

          if (frame.type === 'preview.tunnel.pong') {
            return
          }
        },
        onClose() {
          logPreviewTunnelWs('websocket closed', {
            previewSessionId,
            connectionId,
          })
          previewTunnelService.unregisterConnection(previewSessionId, connectionId, 'preview tunnel websocket closed')
          previewSessionService.markTunnelDisconnected(previewSessionId, connectionId)
        },
      }
    }),
  )
}
