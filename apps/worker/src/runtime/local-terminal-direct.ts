// [INPUT]: 本地终端直连请求
// [OUTPUT]: direct 终端
// [POS]: 本地终端直连（Local Direct）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { randomBytes } from 'node:crypto'
import type { WorkspaceTerminalSessionDescriptor, WorkspaceTerminalSessionScope } from '@shared/types'
import { buildWorkspaceTerminalSessionKey } from '@shared/types'
import type { PersistentTerminalSessionStore } from './persistent-terminal-session'

const DEFAULT_TICKET_TTL_MS = 60_000

type LocalTerminalAttachTicket = {
  ticket: string
  executorId: string
  scope: WorkspaceTerminalSessionScope
  terminalId: string
  workspaceId?: string
  expiresAt: number
}

let terminalSessions: PersistentTerminalSessionStore | null = null
const tickets = new Map<string, LocalTerminalAttachTicket>()

export const registerLocalTerminalDirectStore = (store: PersistentTerminalSessionStore) => {
  terminalSessions = store
}

const cleanupExpiredTickets = (now = Date.now()) => {
  for (const [ticket, record] of tickets.entries()) {
    if (record.expiresAt <= now) {
      tickets.delete(ticket)
    }
  }
}

export const createLocalTerminalAttachTicket = (params: {
  executorId: string
  scope: WorkspaceTerminalSessionScope
  terminalId: string
  workspaceId?: string
  ttlMs?: number
}) => {
  const store = terminalSessions
  if (!store) {
    return {
      ok: false,
      message: 'Local terminal direct store is not ready.',
    }
  }

  const terminalKey = buildWorkspaceTerminalSessionKey({
    executorId: params.executorId,
    scope: params.scope,
    terminalId: params.terminalId,
    workspaceId: params.workspaceId,
  })
  if (!store.getByKey(terminalKey)) {
    return {
      ok: false,
      message: 'Terminal session does not exist.',
    }
  }

  cleanupExpiredTickets()
  const ticket = randomBytes(32).toString('base64url')
  const expiresAt = Date.now() + (params.ttlMs ?? DEFAULT_TICKET_TTL_MS)
  tickets.set(ticket, {
    ticket,
    executorId: params.executorId,
    scope: params.scope,
    terminalId: params.terminalId,
    workspaceId: params.workspaceId,
    expiresAt,
  })

  return {
    ok: true,
    ticket,
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

export const hasLocalTerminalDirectSession = (params: {
  executorId: string
  scope: WorkspaceTerminalSessionScope
  terminalId: string
  workspaceId?: string
}) => {
  const store = terminalSessions
  if (!store) {
    return false
  }

  const terminalKey = buildWorkspaceTerminalSessionKey({
    executorId: params.executorId,
    scope: params.scope,
    terminalId: params.terminalId,
    workspaceId: params.workspaceId,
  })

  return Boolean(store.getByKey(terminalKey))
}

export const consumeLocalTerminalAttachTicket = (ticket: string) => {
  cleanupExpiredTickets()
  const record = tickets.get(ticket)
  if (!record) {
    return null
  }
  tickets.delete(ticket)
  return record
}

export const attachLocalTerminalDirectSession = (params: {
  ticket: string
  clientId: string
  onReady?: (descriptor: WorkspaceTerminalSessionDescriptor) => void
  onOutput?: (descriptor: WorkspaceTerminalSessionDescriptor, stream: 'stdout' | 'stderr' | 'system', chunk: string) => void
  onExit?: (descriptor: WorkspaceTerminalSessionDescriptor, exitCode: number) => void
}) => {
  const ticket = consumeLocalTerminalAttachTicket(params.ticket)
  const store = terminalSessions
  if (!ticket || !store) {
    return null
  }

  const attached = store.attach({
    executorId: ticket.executorId,
    scope: ticket.scope,
    terminalId: ticket.terminalId,
    workspaceId: ticket.workspaceId,
    clientId: params.clientId,
  })
  if (!attached) {
    return null
  }

  const unsubscribe = store.subscribe({
    executorId: ticket.executorId,
    scope: ticket.scope,
    terminalId: ticket.terminalId,
    workspaceId: ticket.workspaceId,
    listener: {
      onReady: params.onReady,
      onOutput: params.onOutput,
      onExit: params.onExit,
    },
  })

  return {
    ...attached,
    ticket,
    unsubscribe,
  }
}

export const detachLocalTerminalDirectSession = (params: {
  descriptor: WorkspaceTerminalSessionDescriptor
  clientId: string
}) => {
  terminalSessions?.detach({
    executorId: params.descriptor.executorId,
    scope: params.descriptor.scope,
    terminalId: params.descriptor.terminalId,
    workspaceId: params.descriptor.workspaceId,
    clientId: params.clientId,
  })
}

export const writeLocalTerminalDirectSession = (params: {
  descriptor: WorkspaceTerminalSessionDescriptor
  input: string
}) => terminalSessions?.write({
  executorId: params.descriptor.executorId,
  scope: params.descriptor.scope,
  terminalId: params.descriptor.terminalId,
  workspaceId: params.descriptor.workspaceId,
  input: params.input,
}) ?? false

export const resizeLocalTerminalDirectSession = (params: {
  descriptor: WorkspaceTerminalSessionDescriptor
  cols: number
  rows: number
}) => terminalSessions?.resize({
  executorId: params.descriptor.executorId,
  scope: params.descriptor.scope,
  terminalId: params.descriptor.terminalId,
  workspaceId: params.descriptor.workspaceId,
  cols: params.cols,
  rows: params.rows,
}) ?? false
