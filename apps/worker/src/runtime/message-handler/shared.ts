// [INPUT]: 消息处理共享输入
// [OUTPUT]: 共享工具
// [POS]: 消息处理共享
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { getEnv } from '@shared/env'
import type { ControlPlaneToExecutorMessage, ExecutorToControlPlaneMessage } from '@shared/types'

const TERMINAL_DEBUG_PREFIX = '[worker][terminal]'
const TERMINAL_DEBUG_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  (getEnv('WEMUX_TERMINAL_DEBUG') ?? '').trim().toLowerCase(),
)

const previewCommand = (value?: unknown) => {
  if (typeof value !== 'string') {
    return value
  }

  return value.trim().replace(/\s+/g, ' ').slice(0, 160)
}

const normalizePayload = (payload?: Record<string, unknown>) => {
  if (!payload) {
    return undefined
  }

  return Object.fromEntries(Object.entries(payload).map(([key, value]) => {
    if (key === 'command' || key === 'preview') {
      return [key, previewCommand(value)]
    }

    if (key === 'stdout' || key === 'stderr') {
      return [key, previewCommand(value)]
    }

    return [key, value]
  }))
}

const logTerminalDebug = (message: string, payload?: Record<string, unknown>) => {
  if (!TERMINAL_DEBUG_ENABLED) {
    return
  }

  const normalizedPayload = normalizePayload(payload)
  if (normalizedPayload) {
    console.info(`${TERMINAL_DEBUG_PREFIX} ${message}`, normalizedPayload)
    return
  }

  console.info(`${TERMINAL_DEBUG_PREFIX} ${message}`)
}

export const buildPromptExecutionId = (requestId: string) => `prompt:${requestId}`

export const getWorkingDirectoryMode = (message: object) => {
  const value = (message as { workingDirectoryMode?: string }).workingDirectoryMode
  return value === 'original-dir' ? 'original-dir' : 'worktree'
}

export const logTerminalMessage = logTerminalDebug

export const isMessageOfType = <TType extends ControlPlaneToExecutorMessage['type']>(
  message: ControlPlaneToExecutorMessage,
  type: TType,
): message is Extract<ControlPlaneToExecutorMessage, { type: TType }> => {
  return message.type === type
}
