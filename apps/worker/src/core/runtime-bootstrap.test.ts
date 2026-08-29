import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveWorkerRuntimeBootstrapMode } from './runtime-bootstrap'

test('runtime bootstrap prompts by default in interactive terminals', () => {
  assert.equal(
    resolveWorkerRuntimeBootstrapMode({
      interactiveTerminal: true,
    }),
    'prompt',
  )
})

test('runtime bootstrap auto-installs by default in non-interactive terminals', () => {
  assert.equal(
    resolveWorkerRuntimeBootstrapMode({
      interactiveTerminal: false,
    }),
    'auto',
  )
})

test('runtime bootstrap respects explicit auto-install opt-in', () => {
  assert.equal(
    resolveWorkerRuntimeBootstrapMode({
      interactiveTerminal: true,
      autoInstallSetting: 'true',
    }),
    'auto',
  )
})

test('runtime bootstrap blocks unattended installs when auto-install is disabled', () => {
  assert.equal(
    resolveWorkerRuntimeBootstrapMode({
      interactiveTerminal: false,
      autoInstallSetting: 'off',
    }),
    'block',
  )
})
