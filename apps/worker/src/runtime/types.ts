// [INPUT]: worker 运行时类型输入
// [OUTPUT]: 类型定义
// [POS]: worker 运行时类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ExecutorToControlPlaneMessage } from '@shared/types'

export type WorkerDoctorItem = {
  id: string
  category: 'tooling' | 'filesystem' | 'config' | 'network'
  label: string
  ok: boolean
  detail: string
  hint?: string
}

export type WorkerConnection = {
  socket?: WebSocket
  send: (message: ExecutorToControlPlaneMessage) => boolean
}
