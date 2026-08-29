/**
 * [INPUT]: Terminal open requests and runtime callbacks from the worker terminal backend.
 * [OUTPUT]: Persistent terminal descriptors, output snapshots, and attach lifecycle operations.
 * [POS]: Worker-owned in-memory source of truth for active terminal session runtime state.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import type { WorkspaceTerminalSessionDescriptor, WorkspaceTerminalSessionSnapshot, WorkspaceTerminalSnapshotChunk } from '@shared/types'
import { buildWorkspaceTerminalSessionKey } from '@shared/types'
import { openTerminalSession, type TerminalSession } from './terminal-session'

const DEFAULT_RING_BUFFER_CHUNKS = 4000

type TerminalOutputStream = 'stdout' | 'stderr' | 'system'

type TerminalSessionListener = {
  onReady?: (descriptor: WorkspaceTerminalSessionDescriptor) => void
  onOutput?: (descriptor: WorkspaceTerminalSessionDescriptor, stream: TerminalOutputStream, chunk: string) => void
  onExit?: (descriptor: WorkspaceTerminalSessionDescriptor, exitCode: number) => void
}

export type PersistentTerminalSessionRecord = {
  session: TerminalSession
  descriptor: WorkspaceTerminalSessionDescriptor
  snapshot: WorkspaceTerminalSessionSnapshot
  clientIds: Set<string>
  closing: boolean
}

export type OpenPersistentTerminalSessionParams = {
  executorId: string
  scope: WorkspaceTerminalSessionDescriptor['scope']
  terminalId: string
  workspaceId?: string
  title: string
  cwd: string
  ownerUserId?: string
  cols?: number
  rows?: number
  workspaceRoot?: string
  runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
  onPersistentReady?: (descriptor: WorkspaceTerminalSessionDescriptor) => void
  onReady?: (descriptor: WorkspaceTerminalSessionDescriptor, clientId?: string) => void
  onOutput?: (descriptor: WorkspaceTerminalSessionDescriptor, stream: TerminalOutputStream, chunk: string, clientId?: string) => void
  onExit?: (descriptor: WorkspaceTerminalSessionDescriptor, exitCode: number) => void
}

type OpenTerminalSessionFactory = (params: Parameters<typeof openTerminalSession>[0]) => TerminalSession

const cloneDescriptor = (descriptor: WorkspaceTerminalSessionDescriptor): WorkspaceTerminalSessionDescriptor => ({
  ...descriptor,
  clientIds: [...descriptor.clientIds],
})

const cloneSnapshot = (snapshot: WorkspaceTerminalSessionSnapshot): WorkspaceTerminalSessionSnapshot => ({
  session: cloneDescriptor(snapshot.session),
  chunks: snapshot.chunks.map((chunk) => ({ ...chunk })),
})

const touchDescriptor = (descriptor: WorkspaceTerminalSessionDescriptor, patch?: Partial<WorkspaceTerminalSessionDescriptor>) => {
  const now = new Date().toISOString()
  return {
    ...descriptor,
    ...patch,
    lastActiveAt: patch?.lastActiveAt ?? now,
  }
}

const resolveSessionRuntimePatch = (session: TerminalSession): Pick<WorkspaceTerminalSessionDescriptor, 'backend' | 'mode' | 'persistent'> => ({
  backend: session.backend,
  mode: session.mode,
  persistent: Boolean(session.isPersistent?.()),
})

export class PersistentTerminalSessionStore {
  private readonly sessions = new Map<string, PersistentTerminalSessionRecord>()
  private readonly closingSessions = new Map<string, PersistentTerminalSessionRecord>()
  private readonly listenersByTerminalKey = new Map<string, Set<TerminalSessionListener>>()

  constructor(
    private readonly openSession: OpenTerminalSessionFactory = openTerminalSession,
  ) {}

  private finalizeExit(record: PersistentTerminalSessionRecord, exitCode: number, onExit?: OpenPersistentTerminalSessionParams['onExit']) {
    const terminalKey = record.descriptor.terminalKey
    const activeRecord = this.sessions.get(terminalKey)
    const closingRecord = this.closingSessions.get(terminalKey)
    if (activeRecord !== record && closingRecord !== record) {
      return null
    }

    const exitedAt = record.descriptor.exitedAt || new Date().toISOString()
    record.closing = true
    record.descriptor = touchDescriptor(record.descriptor, {
      exitCode,
      exitedAt,
    })
    record.snapshot.session = cloneDescriptor(record.descriptor)
    const descriptor = cloneDescriptor(record.descriptor)
    onExit?.(descriptor, exitCode)
    const listeners = this.listenersByTerminalKey.get(terminalKey)
    if (listeners) {
      for (const listener of listeners) {
        listener.onExit?.(descriptor, exitCode)
      }
      this.listenersByTerminalKey.delete(terminalKey)
    }
    if (activeRecord === record) {
      this.sessions.delete(terminalKey)
    }
    if (closingRecord === record) {
      this.closingSessions.delete(terminalKey)
    }
    return descriptor
  }

  list(params?: {
    executorId?: string
    scope?: WorkspaceTerminalSessionDescriptor['scope']
    workspaceId?: string
    includeClosing?: boolean
  }) {
    const records = params?.includeClosing
      ? [...this.sessions.values(), ...this.closingSessions.values()]
      : Array.from(this.sessions.values())

    return records
      .map((entry) => cloneDescriptor(entry.descriptor))
      .filter((descriptor) => {
        if (params?.executorId && descriptor.executorId !== params.executorId) {
          return false
        }
        if (params?.scope && descriptor.scope !== params.scope) {
          return false
        }
        if (typeof params?.workspaceId === 'string' && descriptor.workspaceId !== params.workspaceId) {
          return false
        }
        return true
      })
  }

  getByKey(terminalKey: string) {
    const entry = this.sessions.get(terminalKey)
    if (!entry) {
      return null
    }
    return {
      descriptor: cloneDescriptor(entry.descriptor),
      snapshot: cloneSnapshot(entry.snapshot),
    }
  }

  ensure(params: OpenPersistentTerminalSessionParams) {
    const terminalKey = buildWorkspaceTerminalSessionKey({
      scope: params.scope,
      executorId: params.executorId,
      workspaceId: params.workspaceId,
      terminalId: params.terminalId,
    })

    const existing = this.sessions.get(terminalKey)
    if (existing) {
      return {
        created: false,
        descriptor: cloneDescriptor(existing.descriptor),
      }
    }

    const createdAt = new Date().toISOString()
    const descriptor: WorkspaceTerminalSessionDescriptor = {
      terminalId: params.terminalId,
      terminalKey,
      scope: params.scope,
      executorId: params.executorId,
      workspaceId: params.workspaceId,
      cwd: params.cwd,
      title: params.title,
      ownerUserId: params.ownerUserId,
      createdAt,
      lastActiveAt: createdAt,
      attachCount: 0,
      clientIds: [],
    }
    const snapshot: WorkspaceTerminalSessionSnapshot = {
      session: cloneDescriptor(descriptor),
      chunks: [],
    }

    const record: PersistentTerminalSessionRecord = {
      session: null as unknown as TerminalSession,
      descriptor,
      snapshot,
      clientIds: new Set<string>(),
      closing: false,
    }

    const session = this.openSession({
      terminalKey,
      cwd: params.cwd,
      cols: params.cols,
      rows: params.rows,
      workspaceRoot: params.workspaceRoot,
      runtimeEnvironment: params.runtimeEnvironment,
      onPersistentReady: () => {
        params.onPersistentReady?.(cloneDescriptor(record.descriptor))
      },
      onExit: (exitCode) => {
        this.finalizeExit(record, exitCode, params.onExit)
      },
      onLog: () => {},
      onOutput: (stream, chunk) => {
        const current = this.sessions.get(terminalKey)
        if (!current) {
          return
        }
        const outputChunk: WorkspaceTerminalSnapshotChunk = {
          stream,
          chunk,
          at: new Date().toISOString(),
        }
        current.descriptor = touchDescriptor(current.descriptor)
        current.snapshot.session = cloneDescriptor(current.descriptor)
        current.snapshot.chunks.push(outputChunk)
        if (current.snapshot.chunks.length > DEFAULT_RING_BUFFER_CHUNKS) {
          current.snapshot.chunks.splice(0, current.snapshot.chunks.length - DEFAULT_RING_BUFFER_CHUNKS)
        }
        params.onOutput?.(cloneDescriptor(current.descriptor), stream, chunk)
        const listeners = this.listenersByTerminalKey.get(terminalKey)
        if (listeners) {
          const descriptor = cloneDescriptor(current.descriptor)
          for (const listener of listeners) {
            listener.onOutput?.(descriptor, stream, chunk)
          }
        }
      },
      onReady: (mode, backend) => {
        const current = this.sessions.get(terminalKey)
        if (!current) {
          return
        }
        current.descriptor = touchDescriptor(current.descriptor, {
          ...resolveSessionRuntimePatch(current.session),
          backend,
          mode,
        })
        current.snapshot.session = cloneDescriptor(current.descriptor)
        const descriptor = cloneDescriptor(current.descriptor)
        params.onReady?.(descriptor)
        const listeners = this.listenersByTerminalKey.get(terminalKey)
        if (listeners) {
          for (const listener of listeners) {
            listener.onReady?.(descriptor)
          }
        }
      },
    })

    record.session = session
    record.descriptor = touchDescriptor(record.descriptor, resolveSessionRuntimePatch(session))
    record.snapshot.session = cloneDescriptor(record.descriptor)
    this.sessions.set(terminalKey, record)

    return {
      created: true,
      descriptor: cloneDescriptor(record.descriptor),
    }
  }

  attach(params: {
    executorId: string
    scope: WorkspaceTerminalSessionDescriptor['scope']
    terminalId: string
    workspaceId?: string
    clientId: string
  }) {
    const terminalKey = buildWorkspaceTerminalSessionKey({
      scope: params.scope,
      executorId: params.executorId,
      workspaceId: params.workspaceId,
      terminalId: params.terminalId,
    })
    const entry = this.sessions.get(terminalKey)
    if (!entry) {
      return null
    }

    entry.clientIds.add(params.clientId)
    entry.descriptor = touchDescriptor(entry.descriptor, {
      attachCount: entry.clientIds.size,
      clientIds: Array.from(entry.clientIds),
      lastAttachAt: new Date().toISOString(),
    })
    entry.snapshot.session = cloneDescriptor(entry.descriptor)
    return {
      descriptor: cloneDescriptor(entry.descriptor),
      snapshot: cloneSnapshot(entry.snapshot),
    }
  }

  subscribe(params: {
    executorId: string
    scope: WorkspaceTerminalSessionDescriptor['scope']
    terminalId: string
    workspaceId?: string
    listener: TerminalSessionListener
  }) {
    const terminalKey = buildWorkspaceTerminalSessionKey({
      scope: params.scope,
      executorId: params.executorId,
      workspaceId: params.workspaceId,
      terminalId: params.terminalId,
    })
    if (!this.sessions.has(terminalKey)) {
      return () => {}
    }

    const listeners = this.listenersByTerminalKey.get(terminalKey) ?? new Set<TerminalSessionListener>()
    listeners.add(params.listener)
    this.listenersByTerminalKey.set(terminalKey, listeners)

    return () => {
      const current = this.listenersByTerminalKey.get(terminalKey)
      if (!current) {
        return
      }
      current.delete(params.listener)
      if (current.size === 0) {
        this.listenersByTerminalKey.delete(terminalKey)
      }
    }
  }

  detach(params: {
    executorId: string
    scope: WorkspaceTerminalSessionDescriptor['scope']
    terminalId: string
    workspaceId?: string
    clientId: string
  }) {
    const terminalKey = buildWorkspaceTerminalSessionKey({
      scope: params.scope,
      executorId: params.executorId,
      workspaceId: params.workspaceId,
      terminalId: params.terminalId,
    })
    const entry = this.sessions.get(terminalKey)
    if (!entry) {
      return null
    }

    entry.clientIds.delete(params.clientId)
    entry.descriptor = touchDescriptor(entry.descriptor, {
      attachCount: entry.clientIds.size,
      clientIds: Array.from(entry.clientIds),
      lastDetachAt: new Date().toISOString(),
    })
    entry.snapshot.session = cloneDescriptor(entry.descriptor)
    return cloneDescriptor(entry.descriptor)
  }

  clearClientAttachments(params?: {
    executorId?: string
  }) {
    const now = new Date().toISOString()

    for (const entry of [...this.sessions.values(), ...this.closingSessions.values()]) {
      if (params?.executorId && entry.descriptor.executorId !== params.executorId) {
        continue
      }
      if (entry.clientIds.size === 0 && entry.descriptor.attachCount === 0 && entry.descriptor.clientIds.length === 0) {
        continue
      }

      entry.clientIds.clear()
      entry.descriptor = touchDescriptor(entry.descriptor, {
        attachCount: 0,
        clientIds: [],
        lastDetachAt: now,
      })
      entry.snapshot.session = cloneDescriptor(entry.descriptor)
    }
  }

  write(params: {
    executorId: string
    scope: WorkspaceTerminalSessionDescriptor['scope']
    terminalId: string
    workspaceId?: string
    input: string
  }) {
    const entry = this.resolve(params)
    if (!entry) {
      return false
    }
    entry.descriptor = touchDescriptor(entry.descriptor)
    entry.snapshot.session = cloneDescriptor(entry.descriptor)
    entry.session.write(params.input)
    return true
  }

  resize(params: {
    executorId: string
    scope: WorkspaceTerminalSessionDescriptor['scope']
    terminalId: string
    workspaceId?: string
    cols: number
    rows: number
  }) {
    const entry = this.resolve(params)
    if (!entry) {
      return false
    }
    entry.descriptor = touchDescriptor(entry.descriptor)
    entry.snapshot.session = cloneDescriptor(entry.descriptor)
    entry.session.resize(params.cols, params.rows)
    return true
  }

  close(params: {
    executorId: string
    scope: WorkspaceTerminalSessionDescriptor['scope']
    terminalId: string
    workspaceId?: string
  }) {
    const terminalKey = buildWorkspaceTerminalSessionKey({
      scope: params.scope,
      executorId: params.executorId,
      workspaceId: params.workspaceId,
      terminalId: params.terminalId,
    })
    const entry = this.sessions.get(terminalKey)
    if (!entry) {
      const closingEntry = this.closingSessions.get(terminalKey)
      return closingEntry ? cloneDescriptor(closingEntry.descriptor) : null
    }
    if (entry.closing) {
      return cloneDescriptor(entry.descriptor)
    }
    entry.closing = true
    this.sessions.delete(terminalKey)
    this.closingSessions.set(terminalKey, entry)
    entry.session.kill()
    return cloneDescriptor(entry.descriptor)
  }

  closeAll() {
    for (const [terminalKey, entry] of this.sessions.entries()) {
      entry.closing = true
      this.sessions.delete(terminalKey)
      this.closingSessions.set(terminalKey, entry)
      entry.session.kill()
    }
  }

  detachPersistentAndCloseOthers() {
    for (const entry of this.sessions.values()) {
      if (entry.session.isPersistent?.()) {
        entry.session.detach?.()
      } else {
        entry.session.kill()
      }
    }
  }

  private resolve(params: {
    executorId: string
    scope: WorkspaceTerminalSessionDescriptor['scope']
    terminalId: string
    workspaceId?: string
  }) {
    const terminalKey = buildWorkspaceTerminalSessionKey({
      scope: params.scope,
      executorId: params.executorId,
      workspaceId: params.workspaceId,
      terminalId: params.terminalId,
    })
    return this.sessions.get(terminalKey) ?? null
  }
}
