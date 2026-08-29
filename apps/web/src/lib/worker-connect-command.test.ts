import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWorkerDockerConnectCommand,
  buildWorkerInstallerConnectCommand,
  buildWorkerInstallerPowerShellConnectCommand,
  buildWorkerRunCommand,
} from './worker-connect-command'

const installWindowOrigin = (origin: string) => {
  const previousWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: new URL(origin),
    },
  })

  return () => {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      })
    } else {
      delete (globalThis as { window?: Window }).window
    }
  }
}

test('buildWorkerInstallerConnectCommand uses the service installer endpoint', () => {
  const command = buildWorkerInstallerConnectCommand('ABC 123')

  assert.match(command, /^curl -fsSL /)
  assert.match(command, /\/install/)
  assert.match(command, /bash -s -- --pairing-code 'ABC 123'/)
})

test('buildWorkerRunCommand prefers the local service installer in Node test fallback environment', () => {
  const command = buildWorkerRunCommand('<PAIRING_CODE>', 'local')

  assert.match(command, /\/install/)
  assert.match(command, /--pairing-code '<PAIRING_CODE>'/)
})

test('buildWorkerInstallerPowerShellConnectCommand uses the PowerShell installer endpoint', () => {
  const command = buildWorkerInstallerPowerShellConnectCommand('ABC 123', { displayName: 'Office Worker' })

  assert.match(command, /^powershell -NoProfile -ExecutionPolicy Bypass/)
  assert.match(command, /\/install\.ps1/)
  assert.match(command, /-PairingCode 'ABC 123'/)
  assert.match(command, /-WorkerName 'Office Worker'/)
})

test('buildWorkerRunCommand can target Windows for local install', () => {
  const command = buildWorkerRunCommand('WIN123', 'local', { installTarget: 'windows' })

  assert.match(command, /^powershell -NoProfile -ExecutionPolicy Bypass/)
  assert.match(command, /\/install\.ps1/)
  assert.match(command, /-PairingCode 'WIN123'/)
})

test('buildWorkerRunCommand keeps docker mode on the container path', () => {
  const command = buildWorkerRunCommand('ABC123', 'docker', { displayName: 'Office Worker' })

  assert.match(command, /^curl -fsSL /)
  assert.match(command, /\/install\/docker/)
  assert.match(command, /bash -s -- --pairing-code ABC123/)
  assert.match(command, /--name 'Office Worker'/)
  assert.doesNotMatch(command, /pnpm worker:docker:dev/)
  assert.doesNotMatch(command, /docker run -d/)
  assert.doesNotMatch(command, /npx -y vibemux-worker connect/)
})

test('buildWorkerDockerConnectCommand uses a curl installer that can run from any directory', () => {
  const command = buildWorkerDockerConnectCommand('abc-123')

  assert.match(command, /^curl -fsSL /)
  assert.match(command, /\/install\/docker/)
  assert.match(command, /--pairing-code abc-123/)
  assert.doesNotMatch(command, /pnpm /)
})

test('buildWorkerDockerConnectCommand sends localtest curl to the server port', () => {
  const restore = installWindowOrigin('http://app.wemux.localtest.me:15173')

  try {
    const command = buildWorkerDockerConnectCommand('LOCAL123')

    assert.match(command, /^curl -fsSL http:\/\/127\.0\.0\.1:18989\/install\/docker/)
    assert.match(command, /--server-url http:\/\/host\.docker\.internal:18989/)
    assert.doesNotMatch(command, /app\.vibemux\.localtest\.me:15173\/install\/docker/)
  } finally {
    restore()
  }
})
