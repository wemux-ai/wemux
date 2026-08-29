import assert from 'node:assert/strict'
import test from 'node:test'
import type { TerminalSession } from './terminal-session'
import { PersistentTerminalSessionStore } from './persistent-terminal-session'

type OpenSessionParams = Parameters<typeof import('./terminal-session').openTerminalSession>[0]

const createTestStore = () => {
  const controllers = new Map<string, {
    params: OpenSessionParams
    session: TerminalSession
    writes: string[]
    resizeEvents: Array<{ cols: number; rows: number }>
    killCount: number
    emitReady: (mode?: TerminalSession['mode']) => void
    emitOutput: (stream: 'stdout' | 'stderr' | 'system', chunk: string) => void
    emitExit: (exitCode: number) => void
  }>()

  const store = new PersistentTerminalSessionStore((params) => {
    const writes: string[] = []
    const resizeEvents: Array<{ cols: number; rows: number }> = []
    let killCount = 0

    const session: TerminalSession = {
      backend: 'pipe',
      mode: 'pipe',
      kill: () => {
        killCount += 1
      },
      resize: (cols, rows) => {
        resizeEvents.push({ cols, rows })
      },
      write: (input) => {
        writes.push(input)
      },
    }

    const controller = {
      params,
      session,
      writes,
      resizeEvents,
      get killCount() {
        return killCount
      },
      emitReady: (mode: TerminalSession['mode'] = 'pipe') => {
        params.onReady(mode, session.backend, params.cwd)
      },
      emitOutput: (stream: 'stdout' | 'stderr' | 'system', chunk: string) => {
        params.onOutput(stream, chunk)
      },
      emitExit: (exitCode: number) => {
        params.onExit(exitCode)
      },
    }

    controllers.set(params.cwd, controller)
    return session
  })

  return { store, controllers }
}

test('closing terminal sessions keeps them in includeClosing snapshots until exit finalizes', () => {
  const { store, controllers } = createTestStore()

  store.ensure({
    executorId: 'executor-1',
    scope: 'workspace',
    workspaceId: 'workspace-1',
    terminalId: 'default',
    title: 'Terminal',
    cwd: '/tmp/workspace-terminal-close',
  })

  const controller = controllers.get('/tmp/workspace-terminal-close')
  assert.ok(controller)

  assert.equal(store.list({ executorId: 'executor-1' }).length, 1)
  assert.equal(store.list({ executorId: 'executor-1', includeClosing: true }).length, 1)

  const closed = store.close({
    executorId: 'executor-1',
    scope: 'workspace',
    workspaceId: 'workspace-1',
    terminalId: 'default',
  })

  assert.ok(closed)
  assert.equal(controller.killCount, 1)
  assert.equal(store.list({ executorId: 'executor-1' }).length, 0)
  assert.equal(store.list({ executorId: 'executor-1', includeClosing: true }).length, 1)

  controller.emitExit(0)

  assert.equal(store.list({ executorId: 'executor-1' }).length, 0)
  assert.equal(store.list({ executorId: 'executor-1', includeClosing: true }).length, 0)
})

test('clearClientAttachments resets persistent attach metadata without removing sessions', () => {
  const { store } = createTestStore()

  store.ensure({
    executorId: 'executor-1',
    scope: 'workspace',
    workspaceId: 'workspace-1',
    terminalId: 'default',
    title: 'Terminal',
    cwd: '/tmp/workspace-terminal-attachments',
  })

  store.attach({
    executorId: 'executor-1',
    scope: 'workspace',
    workspaceId: 'workspace-1',
    terminalId: 'default',
    clientId: 'client-a',
  })
  store.attach({
    executorId: 'executor-1',
    scope: 'workspace',
    workspaceId: 'workspace-1',
    terminalId: 'default',
    clientId: 'client-b',
  })

  const attached = store.list({ executorId: 'executor-1' })[0]
  assert.equal(attached?.attachCount, 2)
  assert.deepEqual(attached?.clientIds.sort(), ['client-a', 'client-b'])

  store.clearClientAttachments({ executorId: 'executor-1' })

  const cleared = store.list({ executorId: 'executor-1' })[0]
  assert.equal(cleared?.attachCount, 0)
  assert.deepEqual(cleared?.clientIds, [])
  assert.ok(cleared?.lastDetachAt)
})

test('re-attaching returns buffered terminal output snapshot', () => {
  const { store, controllers } = createTestStore()

  store.ensure({
    executorId: 'executor-1',
    scope: 'workspace',
    workspaceId: 'workspace-1',
    terminalId: 'default',
    title: 'Terminal',
    cwd: '/tmp/workspace-terminal-snapshot',
  })

  const controller = controllers.get('/tmp/workspace-terminal-snapshot')
  assert.ok(controller)
  controller.emitReady('pipe')
  controller.emitOutput('stdout', 'hello')
  controller.emitOutput('stderr', ' world')

  const attached = store.attach({
    executorId: 'executor-1',
    scope: 'workspace',
    workspaceId: 'workspace-1',
    terminalId: 'default',
    clientId: 'client-reconnect',
  })

  assert.ok(attached)
  assert.equal(attached?.snapshot.chunks.length, 2)
  assert.deepEqual(
    attached?.snapshot.chunks.map((chunk) => ({ stream: chunk.stream, chunk: chunk.chunk })),
    [
      { stream: 'stdout', chunk: 'hello' },
      { stream: 'stderr', chunk: ' world' },
    ],
  )
})

test('subscribers receive live terminal output and exit events', () => {
  const { store, controllers } = createTestStore()
  const events: string[] = []

  store.ensure({
    executorId: 'executor-1',
    scope: 'workspace',
    workspaceId: 'workspace-1',
    terminalId: 'default',
    title: 'Terminal',
    cwd: '/tmp/workspace-terminal-subscribe',
  })

  const unsubscribe = store.subscribe({
    executorId: 'executor-1',
    scope: 'workspace',
    workspaceId: 'workspace-1',
    terminalId: 'default',
    listener: {
      onReady: (descriptor) => events.push(`ready:${descriptor.mode}`),
      onOutput: (_descriptor, stream, chunk) => events.push(`${stream}:${chunk}`),
      onExit: (_descriptor, exitCode) => events.push(`exit:${exitCode}`),
    },
  })
  const controller = controllers.get('/tmp/workspace-terminal-subscribe')
  assert.ok(controller)

  controller.emitReady('pipe')
  controller.emitOutput('stdout', 'hello')
  controller.emitExit(0)
  unsubscribe()

  assert.deepEqual(events, ['ready:pipe', 'stdout:hello', 'exit:0'])
})

test('session descriptors expose terminal backend and persistence state', () => {
  const store = new PersistentTerminalSessionStore((params) => ({
    backend: 'zellij',
    mode: 'pty',
    isPersistent: () => true,
    kill: () => {},
    detach: () => {},
    resize: () => {},
    write: () => {},
  }))

  const created = store.ensure({
    executorId: 'executor-1',
    scope: 'workspace',
    workspaceId: 'workspace-1',
    terminalId: 'default',
    title: 'Terminal',
    cwd: '/tmp/workspace-terminal-runtime',
  })

  assert.equal(created.descriptor.backend, 'zellij')
  assert.equal(created.descriptor.mode, 'pty')
  assert.equal(created.descriptor.persistent, true)

  const listed = store.list({ executorId: 'executor-1' })[0]
  assert.equal(listed?.backend, 'zellij')
  assert.equal(listed?.persistent, true)
})

test('ready callbacks replace the requested zellij backend with the effective fallback backend', () => {
  let emitReady: OpenSessionParams['onReady'] | undefined
  let persistent = true
  const store = new PersistentTerminalSessionStore((params) => {
    emitReady = params.onReady
    return {
      backend: 'zellij',
      mode: 'pty',
      isPersistent: () => persistent,
      kill: () => {},
      detach: () => {},
      resize: () => {},
      write: () => {},
    }
  })

  const created = store.ensure({
    executorId: 'executor-1',
    scope: 'workspace',
    workspaceId: 'workspace-1',
    terminalId: 'default',
    title: 'Terminal',
    cwd: '/tmp/workspace-terminal-fallback',
  })
  assert.equal(created.descriptor.backend, 'zellij')

  persistent = false
  assert.ok(emitReady)
  emitReady('pty', 'node-pty', '/tmp/workspace-terminal-fallback')

  const fallback = store.list({ executorId: 'executor-1' })[0]
  assert.equal(fallback?.backend, 'node-pty')
  assert.equal(fallback?.persistent, false)
})

test('detachPersistentAndCloseOthers detaches persistent sessions and kills regular sessions', () => {
  let persistentKillCount = 0
  let persistentDetachCount = 0
  let pipeKillCount = 0

  const store = new PersistentTerminalSessionStore((params) => {
    const isPersistent = params.cwd.includes('persistent')
    return {
      backend: isPersistent ? 'zellij' : 'pipe',
      mode: isPersistent ? 'pty' : 'pipe',
      isPersistent: () => isPersistent,
      kill: () => {
        if (isPersistent) {
          persistentKillCount += 1
        } else {
          pipeKillCount += 1
        }
      },
      detach: () => {
        if (isPersistent) {
          persistentDetachCount += 1
        }
      },
      resize: () => {},
      write: () => {},
    }
  })

  store.ensure({
    executorId: 'executor-1',
    scope: 'workspace',
    workspaceId: 'workspace-1',
    terminalId: 'persistent',
    title: 'Persistent',
    cwd: '/tmp/persistent-terminal',
  })
  store.ensure({
    executorId: 'executor-1',
    scope: 'workspace',
    workspaceId: 'workspace-1',
    terminalId: 'pipe',
    title: 'Pipe',
    cwd: '/tmp/pipe-terminal',
  })

  store.detachPersistentAndCloseOthers()

  assert.equal(persistentDetachCount, 1)
  assert.equal(persistentKillCount, 0)
  assert.equal(pipeKillCount, 1)
})
