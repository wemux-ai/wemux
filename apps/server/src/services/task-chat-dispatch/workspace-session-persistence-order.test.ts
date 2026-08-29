import assert from 'node:assert/strict'
import test from 'node:test'

import { persistWorkspaceSessionStateBeforeHistory } from './workspace-session-persistence-order'

test('workspace history cannot publish before the final session is persisted', async () => {
  const steps: string[] = []
  let releaseSessionPersistence = () => {}
  const sessionPersistence = new Promise<void>((resolve) => {
    releaseSessionPersistence = resolve
  })

  const result = persistWorkspaceSessionStateBeforeHistory(
    async () => {
      steps.push('session:start')
      await sessionPersistence
      steps.push('session:committed')
    },
    async () => {
      steps.push('history:published')
    },
  )

  await Promise.resolve()
  assert.deepEqual(steps, ['session:start'])
  releaseSessionPersistence()
  await result
  assert.deepEqual(steps, ['session:start', 'session:committed', 'history:published'])
})

test('workspace session persistence failure prevents history publication', async () => {
  let historyPublished = false

  await assert.rejects(
    persistWorkspaceSessionStateBeforeHistory(
      async () => Promise.reject(new Error('session write failed')),
      async () => {
        historyPublished = true
      },
    ),
    /session write failed/,
  )
  assert.equal(historyPublished, false)
})
