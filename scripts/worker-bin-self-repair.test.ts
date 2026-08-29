import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  defaultCloudUrlForChannelSuffix,
  isRecoverableModuleLoadError,
  readCloudUrlFromWorkerHome,
  resolveChannelSuffixFromCliName,
  resolveWorkerHomeDir,
  shouldAttemptRepair,
} from './worker-bin-self-repair.mjs'

test('isRecoverableModuleLoadError only matches dependency-resolution failures', () => {
  assert.equal(isRecoverableModuleLoadError({ code: 'ERR_MODULE_NOT_FOUND' }), true)
  assert.equal(isRecoverableModuleLoadError({ code: 'MODULE_NOT_FOUND' }), true)
  assert.equal(isRecoverableModuleLoadError({ code: 'ERR_FILE_NOT_FOUND' }), true)
  assert.equal(isRecoverableModuleLoadError({ code: 'ERR_TYPE_ERROR', message: 'Cannot find module typebox' }), false)
  assert.equal(isRecoverableModuleLoadError(new Error('EACCES: permission denied')), false)
  assert.equal(isRecoverableModuleLoadError(undefined), false)
})

test('shouldAttemptRepair enforces the throttle window and first-run behavior', () => {
  const now = 1_000_000_000
  assert.equal(shouldAttemptRepair(null, now), true)
  assert.equal(shouldAttemptRepair({}, now), true)
  assert.equal(shouldAttemptRepair({ repairAt: now - 1 }, now), false)
  assert.equal(shouldAttemptRepair({ repairAt: now - 15 * 60 * 1000 - 1 }, now), true)
  assert.equal(shouldAttemptRepair({ repairAt: now }, now, 0), true)
})

test('channel suffix resolution covers preview, dev, and production package names', () => {
  assert.equal(resolveChannelSuffixFromCliName('wemux-worker-preview'), '-preview')
  assert.equal(resolveChannelSuffixFromCliName('vibemux-worker-preview'), '-preview')
  assert.equal(resolveChannelSuffixFromCliName('wemux-worker-dev'), '-dev')
  assert.equal(resolveChannelSuffixFromCliName('wemux-worker'), '')
  assert.equal(resolveChannelSuffixFromCliName(undefined), '')
})

test('resolveWorkerHomeDir prefers env override then wemux home with channel suffix', () => {
  const homedir = path.join(os.tmpdir(), 'self-repair-home-test')
  assert.equal(
    resolveWorkerHomeDir({ env: { VIBEMUX_WORKER_HOME: '/custom/worker-home' }, homedir, channelSuffix: '-preview' }),
    '/custom/worker-home',
  )
  assert.equal(
    resolveWorkerHomeDir({ env: {}, homedir, channelSuffix: '-preview' }),
    path.join(homedir, '.wemux-preview'),
  )
  assert.equal(
    resolveWorkerHomeDir({ env: {}, homedir, channelSuffix: '' }),
    path.join(homedir, '.wemux'),
  )
})

test('readCloudUrlFromWorkerHome reads node config before legacy config and tolerates missing files', () => {
  const workerHome = mkdtempSync(path.join(os.tmpdir(), 'self-repair-cloud-'))
  try {
    assert.equal(readCloudUrlFromWorkerHome(workerHome), '')

    writeFileSync(path.join(workerHome, 'config.json'), `${JSON.stringify({ cloudUrl: 'https://example.com/' })}\n`)
    assert.equal(readCloudUrlFromWorkerHome(workerHome), 'https://example.com')

    mkdirSync(path.join(workerHome, 'node'), { recursive: true })
    writeFileSync(path.join(workerHome, 'node', 'config.json'), `${JSON.stringify({ cloudUrl: 'https://wemux.xyz/' })}\n`)
    assert.equal(readCloudUrlFromWorkerHome(workerHome), 'https://wemux.xyz')
  } finally {
    rmSync(workerHome, { recursive: true, force: true })
  }
})

test('default cloud url maps preview channel to wemux.xyz', () => {
  assert.equal(defaultCloudUrlForChannelSuffix('-preview'), 'https://wemux.xyz')
  assert.equal(defaultCloudUrlForChannelSuffix(''), 'https://wemux.ai')
})
