import assert from 'node:assert/strict'
import test from 'node:test'
import {
  WORKER_CONSOLE_PORT_BASES,
  buildWorkerConsolePortCandidates,
  resolveWorkerConsolePortEnvironment,
} from './worker-console-ports'

test('worker console port bases stay distinct per environment', () => {
  assert.equal(WORKER_CONSOLE_PORT_BASES.development, 48121)
  assert.equal(WORKER_CONSOLE_PORT_BASES.preview, 48123)
  assert.equal(WORKER_CONSOLE_PORT_BASES.production, 48100)
})

test('worker console port candidates include preferred port before the environment range', () => {
  assert.deepEqual(
    buildWorkerConsolePortCandidates({
      environment: 'development',
      preferredPort: 49000,
      rangeSize: 3,
    }),
    [49000, 48121, 48143, 48144],
  )
})

test('default worker console fallback ranges do not overlap', () => {
  const development = buildWorkerConsolePortCandidates({ environment: 'development' })
  const preview = buildWorkerConsolePortCandidates({ environment: 'preview' })
  const production = buildWorkerConsolePortCandidates({ environment: 'production' })

  assert.equal(new Set([...development, ...preview, ...production]).size, development.length + preview.length + production.length)
  assert.deepEqual(development.slice(0, 3), [48121, 48143, 48144])
  assert.deepEqual(preview.slice(0, 2), [48123, 48124])
  assert.deepEqual(production.slice(0, 2), [48100, 48101])
})

test('worker console port environment resolves from release channel and local development', () => {
  assert.equal(resolveWorkerConsolePortEnvironment({ releaseChannel: 'preview' }), 'preview')
  assert.equal(resolveWorkerConsolePortEnvironment({ releaseChannel: 'production' }), 'production')
  assert.equal(resolveWorkerConsolePortEnvironment({ nodeEnv: 'development' }), 'development')
})

test('worker console port environment resolves from new and legacy cloud URLs', () => {
  assert.equal(resolveWorkerConsolePortEnvironment({ cloudUrl: 'https://wemux.ai' }), 'production')
  assert.equal(resolveWorkerConsolePortEnvironment({ cloudUrl: 'https://wemux.xyz' }), 'preview')
  // 兼容窗口：旧域名仍然识别
  assert.equal(resolveWorkerConsolePortEnvironment({ cloudUrl: 'https://vibemux.com' }), 'production')
  assert.equal(resolveWorkerConsolePortEnvironment({ cloudUrl: 'https://vibemux.xyz' }), 'preview')
})
