import assert from 'node:assert/strict'
import { accessSync, chmodSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildInteractiveShellArgs,
  buildNonInteractiveShellArgs,
  buildZellijAttachShellCommand,
  buildZellijSessionName,
  buildZellijSocketPath,
  createTerminalCommandEnv,
  createZellijTerminalEnv,
  ensureNodePtySpawnHelperExecutable,
  ensureZellijSocketDir,
  isZellijSocketPathWithinLimit,
  resolveInteractiveTerminalShell,
  resolveNonInteractiveTerminalShell,
  resolveTerminalLaunchCwd,
  resolveZellijSocketDir,
  runTerminalCommand,
  shouldUseZellijTerminalBackend,
  terminateAllBackgroundTerminalCommands,
} from './terminal-session'

const createNodeCommandScript = (prefix: string, content: string) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix))
  const scriptPath = path.join(directory, 'command.cjs')
  writeFileSync(scriptPath, content)
  const windowsScriptPath = scriptPath.replace(/\\/g, '/')
  return {
    command: process.platform === 'win32' ? `node ${windowsScriptPath}` : `node ${JSON.stringify(scriptPath)}`,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  }
}

test('createTerminalCommandEnv strips Vibemux web/app base env from spawned project commands', () => {
  const env = createTerminalCommandEnv({
    PATH: '/usr/bin:/bin',
    HOME: '/tmp/home',
    PORT: '8989',
    VITE_API_BASE_URL: 'http://app.wemux.localtest.me:18989',
    VITE_APP_BASE_URL: 'http://app.wemux.localtest.me:15173',
    VITE_BETTER_AUTH_URL: 'http://app.wemux.localtest.me:18989',
    NEXT_PUBLIC_API_URL: 'https://example.com',
    PUBLIC_API_BASE: 'https://example.com',
    APP_URL: 'http://127.0.0.1:18989',
    APP_BASE_URL: 'http://app.wemux.localtest.me:15173',
    BETTER_AUTH_URL: 'http://app.wemux.localtest.me:18989',
    BETTER_AUTH_TRUSTED_ORIGINS: 'http://app.wemux.localtest.me:15173',
    VIBEMUX_PUBLIC_BASE_URL: 'http://app.wemux.localtest.me:15173',
    VIBEMUX_CLOUD_URL: 'http://127.0.0.1:18989',
    SSH_AUTH_SOCK: '/tmp/ssh.sock',
  })

  assert.equal(env.PATH, '/usr/bin:/bin')
  assert.equal(env.HOME, '/tmp/home')
  assert.equal(env.SSH_AUTH_SOCK, '/tmp/ssh.sock')
  assert.equal(env.VIBEMUX_CLOUD_URL, 'http://127.0.0.1:18989')
  assert.equal('VITE_API_BASE_URL' in env, false)
  assert.equal('VITE_APP_BASE_URL' in env, false)
  assert.equal('VITE_BETTER_AUTH_URL' in env, false)
  assert.equal('NEXT_PUBLIC_API_URL' in env, false)
  assert.equal('PUBLIC_API_BASE' in env, false)
  assert.equal('APP_URL' in env, false)
  assert.equal('APP_BASE_URL' in env, false)
  assert.equal('BETTER_AUTH_URL' in env, false)
  assert.equal('BETTER_AUTH_TRUSTED_ORIGINS' in env, false)
  assert.equal('PORT' in env, false)
  assert.equal('VIBEMUX_PUBLIC_BASE_URL' in env, false)
})

test('runTerminalCommand lets runtime environment override stripped host PORT', async () => {
  const script = createNodeCommandScript('vibemux-terminal-port-', "process.stdout.write(process.env.PORT || '')\n")
  try {
    const result = await runTerminalCommand(script.command, process.cwd(), {
      runtimeEnvironment: {
        mode: 'process-env',
        variables: {
          PORT: '3000',
        },
      },
    })

    assert.equal(result.exitCode, 0)
    assert.equal(result.stdout, '3000')
  } finally {
    script.cleanup()
  }
})

test('createZellijTerminalEnv preserves runtime process environment variables', () => {
  const env = createZellijTerminalEnv({
    shell: '/bin/bash',
    socketDir: '/tmp/vibemux-zellij',
    sourceEnv: {
      PATH: '/usr/bin:/bin',
      PORT: '8989',
      TERM: 'xterm',
    },
    zellijPath: '/opt/vibemux/zellij',
    runtimeEnvironment: {
      mode: 'process-env',
      variables: {
        API_KEY: 'runtime-secret',
        PORT: '3000',
        ZELLIJ_SOCKET_DIR: '/tmp/untrusted-override',
      },
    },
  })

  assert.equal(env.API_KEY, 'runtime-secret')
  assert.equal(env.PORT, '3000')
  assert.equal(env.SHELL, '/bin/bash')
  assert.equal(env.TERM, 'xterm')
  assert.equal(env.ZELLIJ_SOCKET_DIR, '/tmp/vibemux-zellij')
  assert.equal(env.PATH, `/opt/vibemux${path.delimiter}/usr/bin:/bin`)
})

test('runTerminalCommand background mode returns quick failures instead of masking them as started', async () => {
  const script = createNodeCommandScript('vibemux-terminal-background-fail-', "process.stderr.write('port busy\\n'); process.exit(7)\n")
  try {
    const result = await runTerminalCommand(script.command, process.cwd(), {
      mode: 'background',
    })

    assert.equal(result.exitCode, 7)
    assert.equal(result.detached, false)
    assert.match(result.stderr, /port busy/)
  } finally {
    script.cleanup()
  }
})

test('runTerminalCommand materializes env-file before starting command', async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'vibemux-terminal-env-file-'))
  const script = createNodeCommandScript('vibemux-terminal-env-file-script-', [
    "const fs = require('fs')",
    "if (!fs.existsSync('.env.runtime')) process.exit(1)",
    "process.stdout.write(fs.readFileSync('.env.runtime', 'utf8'))",
    '',
  ].join('\n'))
  try {
    const result = await runTerminalCommand(script.command, cwd, {
      runtimeEnvironment: {
        mode: 'env-file',
        variables: {
          API_KEY: 'from-file',
        },
        fileName: '.env.runtime',
        fileContent: 'API_KEY=from-file',
      },
    })

    assert.equal(result.exitCode, 0)
    assert.match(result.stdout, /API_KEY=from-file/)
    assert.equal(readFileSync(path.join(cwd, '.env.runtime'), 'utf8'), 'API_KEY=from-file\n')
  } finally {
    script.cleanup()
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('runTerminalCommand wait mode times out long-running commands', async () => {
  const script = createNodeCommandScript('vibemux-terminal-timeout-', "console.log(process.pid); setTimeout(() => {}, 10000)\n")
  try {
    // Comfortably longer than Node's ~50ms cold start so this asserts timeout
    // handling (and that output printed before the hang survives) rather than
    // racing interpreter startup. The command itself sleeps 10s regardless.
    const result = await runTerminalCommand(script.command, process.cwd(), {
    timeoutMs: 400,
  })

  assert.equal(result.exitCode, 124)
  // The timeout notice is always appended, so asserting only on it cannot tell
  // "ran then hung" from "never started". Require the notice to be the whole of
  // stderr, so a startup failure (e.g. missing PATH) fails loudly instead.
  assert.equal(result.stderr, '远程终端命令执行超时。')
  // Output written before the timeout must not be discarded by the kill path.
  const pid = Number(result.stdout.trim().split(/\s+/)[0])
  assert.ok(Number.isFinite(pid) && pid > 0)

  await new Promise((resolve) => setTimeout(resolve, 700))
  assert.throws(() => process.kill(pid, 0))
  } finally {
    script.cleanup()
  }
})

test('terminateAllBackgroundTerminalCommands stops tracked background commands', async () => {
  const script = createNodeCommandScript('vibemux-terminal-background-', "setTimeout(() => {}, 10000)\n")
  const result = await runTerminalCommand(script.command, process.cwd(), {
    mode: 'background',
  })

  try {
    assert.equal(result.exitCode, 0)
    assert.equal(result.detached, true)
    assert.equal(typeof result.pid, 'number')
    assert.ok(result.pid)
    assert.doesNotThrow(() => process.kill(result.pid!, 0))
  } finally {
    await terminateAllBackgroundTerminalCommands()
  }

  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.throws(() => process.kill(result.pid!, 0))
  script.cleanup()
})

test('resolveInteractiveTerminalShell respects executable SHELL values including fish', () => {
  if (process.platform === 'win32') {
    return
  }

  const previousShell = process.env.SHELL
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vibemux-terminal-shell-'))
  const fishPath = path.join(tempDir, 'fish')
  writeFileSync(fishPath, '#!/bin/sh\nexit 0\n')
  chmodSync(fishPath, 0o755)
  process.env.SHELL = fishPath

  try {
    assert.equal(resolveInteractiveTerminalShell(), fishPath)
  } finally {
    if (previousShell === undefined) {
      delete process.env.SHELL
    } else {
      process.env.SHELL = previousShell
    }
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('terminal shell helpers use cmd.exe arguments on Windows', () => {
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  const previousComSpec = process.env.ComSpec
  Object.defineProperty(process, 'platform', { value: 'win32' })
  process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe'

  try {
    assert.equal(resolveInteractiveTerminalShell(), 'C:\\Windows\\System32\\cmd.exe')
    assert.equal(resolveNonInteractiveTerminalShell(), 'C:\\Windows\\System32\\cmd.exe')
    assert.deepEqual(buildInteractiveShellArgs('win32'), [])
    assert.deepEqual(buildNonInteractiveShellArgs('npm install', 'win32'), ['/d', '/c', 'call npm install'])
  } finally {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor)
    }
    if (previousComSpec === undefined) {
      delete process.env.ComSpec
    } else {
      process.env.ComSpec = previousComSpec
    }
  }
})

test('createTerminalCommandEnv keeps Windows Path when PATH is absent', () => {
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })

  try {
    const env = createTerminalCommandEnv({
      Path: 'C:\\Windows\\System32',
      PORT: '8989',
    })

    assert.equal(env.Path, 'C:\\Windows\\System32')
    assert.equal(env.PATH, undefined)
    assert.equal(env.PORT, undefined)
  } finally {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor)
    }
  }
})

test('zellij backend is enabled on supported platforms and can be disabled explicitly', () => {
  assert.equal(shouldUseZellijTerminalBackend('linux', {}), true)
  assert.equal(shouldUseZellijTerminalBackend('darwin', {}), true)
  assert.equal(shouldUseZellijTerminalBackend('freebsd', {}), false)
  assert.equal(shouldUseZellijTerminalBackend('darwin', { VIBEMUX_TERMINAL_BACKEND: 'native' }), false)
  assert.equal(shouldUseZellijTerminalBackend('freebsd', { VIBEMUX_TERMINAL_BACKEND: 'zellij' }), true)
})

test('windows uses the plain PTY backend rather than zellij', () => {
  // Policy, not a claim about upstream: the Zellij attempt already failed and fell
  // back on Windows, so we skip straight to the backend that actually served it.
  assert.equal(shouldUseZellijTerminalBackend('win32', {}), false)
  assert.equal(shouldUseZellijTerminalBackend('win32', { VIBEMUX_TERMINAL_BACKEND: 'zellij' }), false)
  assert.equal(shouldUseZellijTerminalBackend('win32', { VIBEMUX_TERMINAL_BACKEND: 'native' }), false)
})

test('zellij session names stay readable when short and hash long terminal identities', () => {
  assert.equal(buildZellijSessionName('workspace:short', '/tmp/workspace'), 'vibemux-workspace:short')

  const terminalKey = 'workspace:04f59e22-bffa-4d67-8b63-b8ec1ab6102f:98ea8208-1cbf-44cf-aa27-a40bcaef98f9:default'
  const sessionName = buildZellijSessionName(terminalKey, '/tmp/workspace')

  assert.match(sessionName, /^vibemux-[a-f0-9]{32}$/)
  assert.equal(sessionName, buildZellijSessionName(terminalKey, '/another/workspace'))
  assert.ok(sessionName.length <= 48)
})

test('zellij sockets live in a short per-uid directory so sun_path stays in range', () => {
  // Must be literally /tmp, not os.tmpdir(): macOS os.tmpdir() is the ~49-byte
  // /var/folders/<...>/T path, which would defeat the sun_path budget entirely.
  const darwinDir = resolveZellijSocketDir('darwin', 501, {}, () => false)
  assert.equal(darwinDir, '/tmp/vibemux-zellij-501')
  assert.equal(resolveZellijSocketDir('linux', 1000, {}, () => false), '/tmp/vibemux-zellij-1000')
  assert.equal(resolveZellijSocketDir('win32', 0, {}, () => false), '')

  // A hashed session name under the per-uid dir must fit the 104-byte macOS limit.
  const sessionName = buildZellijSessionName(
    'workspace:04f59e22-bffa-4d67-8b63-b8ec1ab6102f:98ea8208-1cbf-44cf-aa27-a40bcaef98f9:default',
    '/tmp/workspace',
  )
  assert.equal(isZellijSocketPathWithinLimit(buildZellijSocketPath({
    socketDir: darwinDir,
    version: 'v0.44.3',
    sessionName,
  })), true)

  // Even the longest readable session name must still fit under the chosen dirs.
  const longestSessionName = `vibemux-${'a'.repeat(48)}`
  for (const dir of [darwinDir, '/run/user/1000/vibemux-zellij']) {
    assert.equal(isZellijSocketPathWithinLimit(buildZellijSocketPath({
      socketDir: dir,
      version: 'v0.44.3',
      sessionName: longestSessionName,
    })), true, `expected ${dir} to leave room for the longest session name`)
  }
})

test('zellij prefers XDG_RUNTIME_DIR when it is present and short enough', () => {
  const exists = () => true

  // /run/user/<uid> is already user-owned and 0700, so it avoids the /tmp
  // squatting window entirely.
  assert.equal(
    resolveZellijSocketDir('linux', 1000, { XDG_RUNTIME_DIR: '/run/user/1000' }, exists),
    '/run/user/1000/vibemux-zellij',
  )

  // Relative or over-budget values are ignored in favour of the short /tmp path.
  assert.equal(
    resolveZellijSocketDir('linux', 1000, { XDG_RUNTIME_DIR: 'relative/path' }, exists),
    '/tmp/vibemux-zellij-1000',
  )
  assert.equal(
    resolveZellijSocketDir('linux', 1000, { XDG_RUNTIME_DIR: `/run/user/${'x'.repeat(80)}` }, exists),
    '/tmp/vibemux-zellij-1000',
  )

  // A stale XDG_RUNTIME_DIR must not cost us zellij: /run/user is root-owned, so
  // mkdir would fail there where /tmp would have worked.
  assert.equal(
    resolveZellijSocketDir('linux', 1000, { XDG_RUNTIME_DIR: '/run/user/1000' }, () => false),
    '/tmp/vibemux-zellij-1000',
  )
})

test('ensureZellijSocketDir creates a private directory and rejects hostile paths in /tmp', () => {
  if (process.platform === 'win32') {
    return
  }

  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-zellij-socketdir-'))
  try {
    const socketDir = path.join(root, 'sockets')
    assert.doesNotThrow(() => ensureZellijSocketDir(socketDir))
    assert.equal(statSync(socketDir).mode & 0o777, 0o700)

    // Idempotent, and it tightens permissions that are too open.
    chmodSync(socketDir, 0o755)
    assert.doesNotThrow(() => ensureZellijSocketDir(socketDir))
    assert.equal(statSync(socketDir).mode & 0o777, 0o700)

    // A pre-planted symlink must be refused rather than followed: /tmp is
    // world-writable, so someone else could otherwise host our sockets.
    const target = path.join(root, 'attacker-owned')
    mkdirSync(target, { recursive: true })
    const hostile = path.join(root, 'hostile')
    symlinkSync(target, hostile)
    assert.throws(() => ensureZellijSocketDir(hostile), /must not be a symlink/)

    // A non-directory squatting on the path is refused too.
    const filePath = path.join(root, 'not-a-dir')
    writeFileSync(filePath, '')
    assert.throws(() => ensureZellijSocketDir(filePath), /not a directory|ENOTDIR/)

    // Ownership mismatch is refused (simulated via an impossible expected uid).
    assert.throws(() => ensureZellijSocketDir(socketDir, 999999), /owned by uid/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('zellij socket paths under a deep workspace root are rejected instead of failing to bind', () => {
  const deepDir = `/Users/demo/.vibemux-preview/workspaces/${'a'.repeat(36)}/repos/vibemux/.vibemux/node/runtime/zellij`
  assert.equal(isZellijSocketPathWithinLimit(buildZellijSocketPath({
    socketDir: deepDir,
    version: 'v0.44.3',
    sessionName: 'vibemux-0123456789abcdef0123456789abcdef',
  })), false)
})

test('macOS node-pty spawn helper is made executable before loading the native module', () => {
  const packageRoot = mkdtempSync(path.join(os.tmpdir(), 'vibemux-node-pty-helper-'))
  try {
    const moduleEntryPath = path.join(packageRoot, 'lib', 'index.js')
    const helperPath = path.join(packageRoot, 'prebuilds', 'darwin-arm64', 'spawn-helper')
    mkdirSync(path.dirname(moduleEntryPath), { recursive: true })
    mkdirSync(path.dirname(helperPath), { recursive: true })
    writeFileSync(moduleEntryPath, '')
    writeFileSync(helperPath, '')
    chmodSync(helperPath, 0o644)

    assert.equal(ensureNodePtySpawnHelperExecutable({
      arch: 'arm64',
      moduleEntryPath,
      platform: 'darwin',
    }), true)
    assert.doesNotThrow(() => accessSync(helperPath, constants.X_OK))
  } finally {
    rmSync(packageRoot, { recursive: true, force: true })
  }
})

test('zellij attach command single-quotes the POSIX exec path', () => {
  assert.equal(
    buildZellijAttachShellCommand({
      cwd: "/tmp/work dir",
      sessionName: "vibemux-session",
      zellijPath: "/opt/zellij",
    }),
    "cd '/tmp/work dir' && exec '/opt/zellij' attach --create 'vibemux-session'",
  )

  assert.equal(
    buildZellijAttachShellCommand({
      cwd: "/tmp/it's here",
      sessionName: 'vibemux-session',
      zellijPath: '/opt/zellij',
    }),
    "cd '/tmp/it'\\''s here' && exec '/opt/zellij' attach --create 'vibemux-session'",
  )
})

test('resolveTerminalLaunchCwd preserves the exact requested directory', () => {
  const requestedCwd = '/tmp/vibemux-terminal-target'
  assert.equal(resolveTerminalLaunchCwd(requestedCwd), requestedCwd)
})
