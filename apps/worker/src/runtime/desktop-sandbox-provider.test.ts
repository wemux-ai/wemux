import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeDesktopSandboxProvider,
  resolveDesktopSandboxProvider,
} from './desktop-sandbox-provider'

test('normalizeDesktopSandboxProvider defaults to opensandbox', () => {
  assert.equal(normalizeDesktopSandboxProvider(), 'opensandbox')
  assert.equal(normalizeDesktopSandboxProvider(''), 'opensandbox')
  assert.equal(normalizeDesktopSandboxProvider('unknown'), 'opensandbox')
})

test('normalizeDesktopSandboxProvider accepts aio aliases', () => {
  assert.equal(normalizeDesktopSandboxProvider('aio'), 'aio')
  assert.equal(normalizeDesktopSandboxProvider('AIO-Sandbox'), 'aio')
  assert.equal(normalizeDesktopSandboxProvider('agent-infra'), 'aio')
})

test('resolveDesktopSandboxProvider reads Vibemux env override', () => {
  const previous = process.env.VIBEMUX_DESKTOP_SANDBOX_PROVIDER
  try {
    process.env.VIBEMUX_DESKTOP_SANDBOX_PROVIDER = 'aio'
    assert.equal(resolveDesktopSandboxProvider(), 'aio')
  } finally {
    if (previous === undefined) {
      delete process.env.VIBEMUX_DESKTOP_SANDBOX_PROVIDER
    } else {
      process.env.VIBEMUX_DESKTOP_SANDBOX_PROVIDER = previous
    }
  }
})
