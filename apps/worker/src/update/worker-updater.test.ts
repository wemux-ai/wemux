import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path, { delimiter } from 'node:path'
import test from 'node:test'

import {
  getInstalledWorkerExecutableCandidates,
  getInstalledWorkerExecutablePath,
  resolveWorkerInstallPrefix,
  resolveWorkerServiceCommand,
} from '../service/service-common'
import {
  buildNpmWorkerUpdateApplyArgs,
  buildWorkerUpdateNpmEnv,
  canAutoApplyWorkerUpdateInCurrentProcess,
  preserveWorkerInstallerWrapper,
  reinstallWorkerServiceRegistration,
  resolveAutoUpdateApplyOptions,
  resolveNpmCommandForWorkerUpdate,
  resolveWorkerEntryPathInRoot,
  shouldApplyNpmWorkerUpdateOutOfProcess,
  smokeCheckStagedWorkerRoot,
  WORKER_ENTRY_SMOKE_COMMAND,
} from './worker-updater'
import { resolveNpmWorkerInstallPrefixFromAppRoot } from '../core/app-root'
import type { PlatformService, ServiceInstallOptions } from '../service/platform-service'

test('worker executable helpers use the npm global prefix root on Windows', () => {
  const prefix = path.join(os.tmpdir(), 'vibemux-preview-worker-prefix')

  assert.deepEqual(
    getInstalledWorkerExecutableCandidates(prefix, 'vibemux-worker-preview', 'win32'),
    [
      path.join(prefix, 'vibemux-worker-preview.cmd'),
      path.join(prefix, 'bin', 'vibemux-worker-preview.cmd'),
    ],
  )
  assert.equal(
    getInstalledWorkerExecutablePath(prefix, 'vibemux-worker-preview', 'win32'),
    path.join(prefix, 'vibemux-worker-preview.cmd'),
  )
  assert.equal(
    resolveWorkerInstallPrefix(path.join(prefix, 'vibemux-worker-preview.cmd')),
    path.resolve(prefix),
  )
})

test('resolveWorkerServiceCommand runs Windows npm shims through node cli entrypoint', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worker-service-command-'))
  const packageRoot = path.join(tempDir, 'node_modules', 'vibemux-worker-preview')
  const cliPath = path.join(packageRoot, 'bin', 'cli.mjs')
  const workerPath = path.join(tempDir, 'vibemux-worker-preview.cmd')

  try {
    mkdirSync(path.dirname(cliPath), { recursive: true })
    writeFileSync(path.join(packageRoot, 'package.json'), `${JSON.stringify({
      name: 'vibemux-worker-preview',
      version: '0.0.0-test',
    })}\n`)
    writeFileSync(cliPath, '#!/usr/bin/env node\n')
    writeFileSync(workerPath, '@echo off\r\n')

    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      assert.deepEqual(resolveWorkerServiceCommand(workerPath, tempDir), {
        workerPath: process.execPath,
        args: [cliPath],
        executablePath: path.resolve(workerPath),
        installPrefix: path.resolve(tempDir),
      })
    } finally {
      if (originalPlatformDescriptor) {
        Object.defineProperty(process, 'platform', originalPlatformDescriptor)
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('resolveNpmWorkerInstallPrefixFromAppRoot detects npm global prefix layout', () => {
  assert.equal(
    resolveNpmWorkerInstallPrefixFromAppRoot(
      path.join('/root/.vibemux-preview-worker', 'lib', 'node_modules', 'vibemux-worker-preview'),
      'vibemux-worker-preview',
    ),
    '/root/.vibemux-preview-worker',
  )
})

test('resolveNpmWorkerInstallPrefixFromAppRoot detects Windows npm global prefix layout', () => {
  assert.equal(
    resolveNpmWorkerInstallPrefixFromAppRoot(
      path.join('C:\\Users\\X\\.vibemux-preview-worker', 'node_modules', 'vibemux-worker-preview'),
      'vibemux-worker-preview',
    ),
    path.resolve('C:\\Users\\X\\.vibemux-preview-worker'),
  )
})

test('resolveNpmWorkerInstallPrefixFromAppRoot ignores source checkouts', () => {
  assert.equal(
    resolveNpmWorkerInstallPrefixFromAppRoot(
      path.join('/Users/x/work/Vibemux', 'apps', 'worker'),
      'vibemux-worker-preview',
    ),
    '',
  )
})

test('resolveNpmCommandForWorkerUpdate prefers npm next to the current node executable', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worker-npm-'))
  try {
    const npmName = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
    const npmPath = path.join(tempDir, npmName)
    writeFileSync(npmPath, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n')
    chmodSync(npmPath, 0o755)

    assert.equal(resolveNpmCommandForWorkerUpdate(path.join(tempDir, nodeName)), npmPath)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('buildWorkerUpdateNpmEnv prepends the current node executable directory to PATH', () => {
  const execPath = path.join('/root/.nvm/versions/node/v22.23.1/bin', process.platform === 'win32' ? 'node.exe' : 'node')
  const env = buildWorkerUpdateNpmEnv({ PATH: '/usr/local/bin:/usr/bin' }, execPath)

  assert.equal(env.PATH?.split(delimiter)[0], path.dirname(execPath))
})

test('buildWorkerUpdateNpmEnv preserves Windows Path casing when prepending Node dir', () => {
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })

  try {
    const execPath = path.join('C:\\Program Files\\nodejs', 'node.exe')
    const env = buildWorkerUpdateNpmEnv({ Path: 'C:\\Windows\\System32' }, execPath)

    assert.ok(env.Path?.startsWith(`${path.dirname(execPath)}${delimiter}`))
    assert.equal(env.PATH, undefined)
  } finally {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor)
    }
  }
})

test('buildNpmWorkerUpdateApplyArgs prepares a detached service-managed prefix swap', () => {
  const args = buildNpmWorkerUpdateApplyArgs({
    stagingPrefix: path.join(os.tmpdir(), '.vibemux-worker-stage-123'),
    installPrefix: path.join(os.tmpdir(), '.vibemux-preview-worker'),
    parentPid: 12345,
    serviceName: 'vibemux-worker-preview',
  })

  assert.equal(args[1], 'apply-update-internal')
  assert.equal(args.at(-4), '--staging-prefix')
  assert.equal(args.at(-3), '--service-managed')
  assert.equal(args.at(-2), '--restart-service')
  assert.equal(args.at(-1), 'vibemux-worker-preview')
})

test('Windows npm worker updates apply out of process to release locked install dirs', () => {
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })
  try {
    assert.equal(shouldApplyNpmWorkerUpdateOutOfProcess(), true)
  } finally {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor)
    }
  }
})

test('preserveWorkerInstallerWrapper restores the curl installer node wrapper after prefix replacement', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worker-wrapper-'))
  try {
    const backupRoot = path.join(tempDir, 'backup')
    const targetRoot = path.join(tempDir, 'target')
    const wrapperName = 'vibemux-worker-node-wrapper'
    const backupWrapperPath = path.join(backupRoot, 'bin', wrapperName)
    const targetWrapperPath = path.join(targetRoot, 'bin', wrapperName)

    mkdirSync(path.dirname(backupWrapperPath), { recursive: true })
    mkdirSync(path.dirname(targetWrapperPath), { recursive: true })
    writeFileSync(backupWrapperPath, '#!/usr/bin/env bash\nexec /opt/node/bin/node "$@"\n')
    writeFileSync(targetWrapperPath, '#!/usr/bin/env node\n')

    assert.equal(preserveWorkerInstallerWrapper(backupRoot, targetRoot), true)
    assert.equal(readFileSync(targetWrapperPath, 'utf8'), '#!/usr/bin/env bash\nexec /opt/node/bin/node "$@"\n')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('preserveWorkerInstallerWrapper no-ops when an old installer wrapper is absent', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worker-wrapper-'))
  try {
    assert.equal(preserveWorkerInstallerWrapper(path.join(tempDir, 'backup'), path.join(tempDir, 'target')), false)
    assert.equal(existsSync(path.join(tempDir, 'target')), false)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('reinstallWorkerServiceRegistration rewrites the service registration against the fresh npm prefix', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worker-reinstall-'))
  const originalExecutablePath = process.env.VIBEMUX_WORKER_EXECUTABLE_PATH
  const originalInstallPrefix = process.env.VIBEMUX_WORKER_INSTALL_PREFIX
  const installPrefix = path.join(tempDir, '.wemux-preview-worker')
  const workerPath = path.join(installPrefix, 'bin', 'wemux-worker-preview')

  let recordedOptions: ServiceInstallOptions | undefined
  const fakeService: PlatformService = {
    install: async (options) => {
      recordedOptions = options
    },
    uninstall: async () => undefined,
    start: async () => undefined,
    stop: async () => undefined,
    restart: async () => undefined,
    status: async () => ({ installed: true, running: false, serviceName: 'wemux-worker-preview' }),
    logs: async function* () {},
  }

  try {
    process.env.VIBEMUX_WORKER_EXECUTABLE_PATH = workerPath
    delete process.env.VIBEMUX_WORKER_INSTALL_PREFIX

    const resolved = await reinstallWorkerServiceRegistration({
      service: fakeService,
      installPrefix,
      serviceName: 'wemux-worker-preview',
      logDir: path.join(tempDir, 'logs'),
    })

    assert.equal(resolved.workerPath, workerPath)
    assert.deepEqual(recordedOptions?.args, ['daemon'])
    assert.equal(recordedOptions?.workerPath, workerPath)
    assert.equal(recordedOptions?.serviceName, 'wemux-worker-preview')
    assert.equal(recordedOptions?.autoStart, true)
    assert.equal(recordedOptions?.restartOnFailure, true)
    assert.equal(recordedOptions?.logDir, path.join(tempDir, 'logs'))
    assert.equal(recordedOptions?.env.VIBEMUX_WORKER_INSTALL_PREFIX, installPrefix)
    assert.equal(recordedOptions?.env.VIBEMUX_WORKER_EXECUTABLE_PATH, workerPath)
  } finally {
    if (originalExecutablePath === undefined) {
      delete process.env.VIBEMUX_WORKER_EXECUTABLE_PATH
    } else {
      process.env.VIBEMUX_WORKER_EXECUTABLE_PATH = originalExecutablePath
    }
    if (originalInstallPrefix === undefined) {
      delete process.env.VIBEMUX_WORKER_INSTALL_PREFIX
    } else {
      process.env.VIBEMUX_WORKER_INSTALL_PREFIX = originalInstallPrefix
    }
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('resolveAutoUpdateApplyOptions requests an explicit service restart for service-managed workers', () => {
  const original = process.env.VIBEMUX_WORKER_RESTART_STRATEGY
  process.env.VIBEMUX_WORKER_RESTART_STRATEGY = 'system-service'

  try {
    assert.deepEqual(resolveAutoUpdateApplyOptions(), {
      restartServiceAfterApply: true,
      serviceName: 'vibemux-worker',
    })
  } finally {
    if (original === undefined) {
      delete process.env.VIBEMUX_WORKER_RESTART_STRATEGY
    } else {
      process.env.VIBEMUX_WORKER_RESTART_STRATEGY = original
    }
  }
})

test('resolveAutoUpdateApplyOptions stays disabled without a service restart strategy', () => {
  const original = process.env.VIBEMUX_WORKER_RESTART_STRATEGY
  delete process.env.VIBEMUX_WORKER_RESTART_STRATEGY

  try {
    assert.equal(resolveAutoUpdateApplyOptions(), undefined)
  } finally {
    if (original !== undefined) {
      process.env.VIBEMUX_WORKER_RESTART_STRATEGY = original
    }
  }
})

test('canAutoApplyWorkerUpdateInCurrentProcess accepts docker restart strategy', () => {
  const originalStrategy = process.env.VIBEMUX_WORKER_RESTART_STRATEGY
  const originalPmId = process.env.pm_id
  delete process.env.VIBEMUX_WORKER_RESTART_STRATEGY
  delete process.env.pm_id

  try {
    assert.equal(canAutoApplyWorkerUpdateInCurrentProcess(), false)
    process.env.VIBEMUX_WORKER_RESTART_STRATEGY = 'system-service'
    assert.equal(canAutoApplyWorkerUpdateInCurrentProcess(), true)
    process.env.VIBEMUX_WORKER_RESTART_STRATEGY = 'docker'
    assert.equal(canAutoApplyWorkerUpdateInCurrentProcess(), true)
    delete process.env.VIBEMUX_WORKER_RESTART_STRATEGY
    process.env.pm_id = '0'
    assert.equal(canAutoApplyWorkerUpdateInCurrentProcess(), true)
  } finally {
    if (originalStrategy === undefined) {
      delete process.env.VIBEMUX_WORKER_RESTART_STRATEGY
    } else {
      process.env.VIBEMUX_WORKER_RESTART_STRATEGY = originalStrategy
    }
    if (originalPmId === undefined) {
      delete process.env.pm_id
    } else {
      process.env.pm_id = originalPmId
    }
  }
})

test('resolveWorkerEntryPathInRoot locates the entry across npm prefix, flat node_modules, and portable layouts', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'worker-smoke-entry-'))
  try {
    const entryRelativePath = path.join('dist-worker', 'apps', 'worker', 'src', 'index.js')
    const packageName = 'wemux-worker-preview'

    const npmPrefix = path.join(tempDir, 'npm-prefix')
    const npmEntry = path.join(npmPrefix, 'lib', 'node_modules', packageName, entryRelativePath)
    mkdirSync(path.dirname(npmEntry), { recursive: true })
    writeFileSync(npmEntry, '')
    assert.equal(resolveWorkerEntryPathInRoot(npmPrefix, packageName), npmEntry)
    assert.equal(resolveWorkerEntryPathInRoot(npmPrefix, ''), '')

    const flatRoot = path.join(tempDir, 'flat')
    const flatEntry = path.join(flatRoot, 'node_modules', packageName, entryRelativePath)
    mkdirSync(path.dirname(flatEntry), { recursive: true })
    writeFileSync(flatEntry, '')
    assert.equal(resolveWorkerEntryPathInRoot(flatRoot, packageName), flatEntry)

    const portableRoot = path.join(tempDir, 'portable')
    const portableEntry = path.join(portableRoot, entryRelativePath)
    mkdirSync(path.dirname(portableEntry), { recursive: true })
    writeFileSync(portableEntry, '')
    assert.equal(resolveWorkerEntryPathInRoot(portableRoot, packageName), portableEntry)

    assert.equal(resolveWorkerEntryPathInRoot(path.join(tempDir, 'missing'), packageName), '')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('smokeCheckStagedWorkerRoot passes only when the staged entry loads cleanly', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'worker-smoke-run-'))
  try {
    const packageName = 'wemux-worker-preview'
    const root = path.join(tempDir, 'staging')
    const entryPath = path.join(root, 'lib', 'node_modules', packageName, 'dist-worker', 'apps', 'worker', 'src', 'index.js')
    mkdirSync(path.dirname(entryPath), { recursive: true })
    writeFileSync(entryPath, '')

    const spawnCalls: Array<{ file: string; args: string[] }> = []
    const okSpawn = ((file: string, args: string[]) => {
      spawnCalls.push({ file, args })
      return { status: 0, stdout: '', stderr: '' }
    }) as never

    smokeCheckStagedWorkerRoot({ root, packageName, spawnSyncImpl: okSpawn })
    assert.equal(spawnCalls.length, 1)
    assert.deepEqual(spawnCalls[0].args.slice(0, 2), [entryPath, WORKER_ENTRY_SMOKE_COMMAND])

    assert.throws(
      () => smokeCheckStagedWorkerRoot({
        root,
        packageName,
        spawnSyncImpl: (() => ({ status: 1, stdout: '', stderr: 'Error [ERR_MODULE_NOT_FOUND]: Cannot find module typebox' })) as never,
      }),
      /ERR_MODULE_NOT_FOUND/,
    )

    assert.throws(
      () => smokeCheckStagedWorkerRoot({
        root,
        packageName,
        spawnSyncImpl: (() => ({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' })) as never,
      }),
      /SIGTERM|冒烟校验失败/,
    )

    assert.throws(
      () => smokeCheckStagedWorkerRoot({
        root: path.join(tempDir, 'empty'),
        packageName,
        spawnSyncImpl: (() => ({ status: 0, stdout: '', stderr: '' })) as never,
      }),
      /未找到 worker 入口文件/,
    )

    assert.throws(
      () => smokeCheckStagedWorkerRoot({
        root,
        packageName,
        spawnSyncImpl: (() => ({ error: new Error('spawn ENOENT'), status: null, stdout: '', stderr: '' })) as never,
      }),
      /无法启动/,
    )
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
