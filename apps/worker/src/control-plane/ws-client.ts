// [INPUT]: WSS 连接输入
// [OUTPUT]: 连接管理
// [POS]: WebSocket 客户端
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  ControlPlaneToExecutorMessage,
  ExecutorToControlPlaneMessage,
  WorkerConfig,
} from '@shared/types'
import { toExecutorWsUrl } from './cloud-url'
import { parseControlPlaneMessage } from './ws-message'

const isSocketOpen = (socket: WebSocket) => socket.readyState === WebSocket.OPEN

export const connectWorkerWebSocket = (
  config: WorkerConfig,
  handlers: {
    onOpen?: () => void
    onMessage?: (message: ControlPlaneToExecutorMessage) => void
    onClose?: (event: CloseEvent) => void
    onError?: (message: string) => void
  },
) => {
  if (!config.executorToken) {
    throw new Error('Worker is not paired yet.')
  }

  const url = `${toExecutorWsUrl(config.cloudUrl)}?token=${encodeURIComponent(config.executorToken)}`
  const socket = new WebSocket(url)

  socket.addEventListener('open', () => {
    handlers.onOpen?.()
  })

  socket.addEventListener('message', async (event) => {
    try {
      const message = await parseControlPlaneMessage(event.data)
      try {
        handlers.onMessage?.(message)
      } catch (error) {
        handlers.onError?.(
          `Failed to process a control-plane message.${error instanceof Error ? ` ${error.message}` : ''}`,
        )
      }
    } catch (error) {
      handlers.onError?.(
        `The control plane returned a message that could not be parsed.${error instanceof Error ? ` ${error.message}` : ''}`,
      )
    }
  })

  socket.addEventListener('error', () => {
    handlers.onError?.(`Failed to connect to the control-plane WebSocket: ${url}`)
  })

  socket.addEventListener('close', (event) => {
    handlers.onClose?.(event)
  })

  return {
    socket,
    send(message: ExecutorToControlPlaneMessage) {
      if (!isSocketOpen(socket)) {
        return false
      }

      try {
        socket.send(JSON.stringify(message))
        return true
      } catch (error) {
        handlers.onError?.(
          `Failed to send a control-plane WebSocket message.${error instanceof Error ? ` ${error.message}` : ''}`,
        )
        return false
      }
    },
  }
}
