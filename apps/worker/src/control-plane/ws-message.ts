// [INPUT]: WS 消息输入
// [OUTPUT]: 消息类型
// [POS]: WS 消息契约
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ControlPlaneToExecutorMessage } from '@shared/types'

const readSocketMessage = async (data: unknown) => {
  if (typeof data === 'string') {
    return data
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8')
  }

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return await data.text()
  }

  if (data && typeof (data as { toString?: () => string }).toString === 'function') {
    return (data as { toString: () => string }).toString()
  }

  return ''
}

export const parseControlPlaneMessage = async (data: unknown) => {
  const raw = await readSocketMessage(data)
  return JSON.parse(raw) as ControlPlaneToExecutorMessage
}
