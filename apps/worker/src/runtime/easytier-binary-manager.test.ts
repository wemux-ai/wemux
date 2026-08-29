import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildEasyTierAssetName,
  buildEasyTierDownloadUrl,
  extractEasyTierArchive,
  resolveCachedEasyTierBinaries,
  resolveEasyTierArch,
  resolveEasyTierInstallDir,
  resolveEasyTierPlatform,
} from './easytier-binary-manager'

test('resolveEasyTierPlatform and resolveEasyTierArch map node values to release assets', () => {
  assert.equal(resolveEasyTierPlatform('darwin'), 'macos')
  assert.equal(resolveEasyTierPlatform('linux'), 'linux')
  assert.equal(resolveEasyTierPlatform('win32'), 'windows')
  assert.equal(resolveEasyTierPlatform('freebsd'), '')
  assert.equal(resolveEasyTierArch('x64'), 'x86_64')
  assert.equal(resolveEasyTierArch('arm64'), 'aarch64')
  assert.equal(resolveEasyTierArch('arm'), '')
})

test('buildEasyTierAssetName builds pinned release zip names', () => {
  assert.equal(buildEasyTierAssetName({
    version: 'v2.6.4',
    platform: 'linux',
    arch: 'x64',
  }), 'easytier-linux-x86_64-v2.6.4.zip')
  assert.equal(buildEasyTierAssetName({
    version: '2.6.4',
    platform: 'darwin',
    arch: 'arm64',
  }), 'easytier-macos-aarch64-v2.6.4.zip')
})

test('buildEasyTierDownloadUrl points at the release asset', () => {
  assert.equal(
    buildEasyTierDownloadUrl({
      version: 'v2.6.4',
      platform: 'linux',
      arch: 'x64',
      baseUrl: 'https://downloads.example.com/easytier',
    }),
    'https://downloads.example.com/easytier/v2.6.4/easytier-linux-x86_64-v2.6.4.zip',
  )
})

test('extractEasyTierArchive uses PowerShell Expand-Archive on Windows', () => {
  const calls: Array<{ command: string; args: string[] }> = []
  extractEasyTierArchive("C:\\tmp\\easy tier's.zip", 'C:\\tmp\\easy tier', {
    resolveExecutable: (command) => command === 'powershell.exe' ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' : null,
    runCommand: (command, args) => {
      calls.push({ command, args })
      return { ok: true, stdout: '', stderr: '' }
    },
  }, 'win32')

  assert.equal(calls[0]?.command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  assert.deepEqual(calls[0]?.args.slice(0, 4), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command'])
  assert.equal(calls[0]?.args[4], "Expand-Archive -LiteralPath 'C:\\tmp\\easy tier''s.zip' -DestinationPath 'C:\\tmp\\easy tier' -Force")
  assert.equal(calls[0]?.args.includes('$args[0]'), false)
})

test('extractEasyTierArchive uses unzip on non-Windows platforms', () => {
  const calls: Array<{ command: string; args: string[] }> = []
  extractEasyTierArchive('/tmp/easytier.zip', '/tmp/easytier', {
    resolveExecutable: (command) => command === 'unzip' ? '/usr/bin/unzip' : null,
    runCommand: (command, args) => {
      calls.push({ command, args })
      return { ok: true, stdout: '', stderr: '' }
    },
  }, 'linux')

  assert.equal(calls[0]?.command, '/usr/bin/unzip')
  assert.deepEqual(calls[0]?.args, ['-oq', '/tmp/easytier.zip', '-d', '/tmp/easytier'])
})

test('resolveCachedEasyTierBinaries finds binaries in worker node runtime cache', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-easytier-cache-'))
  try {
    const installDir = resolveEasyTierInstallDir({
      workspaceRoot: root,
      version: 'v2.6.4',
      platform: process.platform,
      arch: process.arch,
    })
    mkdirSync(installDir, { recursive: true })
    const corePath = path.join(installDir, process.platform === 'win32' ? 'easytier-core.exe' : 'easytier-core')
    const cliPath = path.join(installDir, process.platform === 'win32' ? 'easytier-cli.exe' : 'easytier-cli')
    writeFileSync(corePath, '')
    writeFileSync(cliPath, '')
    if (process.platform !== 'win32') {
      chmodSync(corePath, 0o755)
      chmodSync(cliPath, 0o755)
    }

    const resolved = resolveCachedEasyTierBinaries({
      workspaceRoot: root,
      version: 'v2.6.4',
    })
    assert.equal(resolved?.corePath, corePath)
    assert.equal(resolved?.cliPath, cliPath)
    assert.equal(resolved?.version, 'v2.6.4')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveCachedEasyTierBinaries finds binaries in extracted release subdirectory', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-easytier-cache-nested-'))
  try {
    const installDir = resolveEasyTierInstallDir({
      workspaceRoot: root,
      version: 'v2.6.4',
      platform: process.platform,
      arch: process.arch,
    })
    const releaseDir = path.join(installDir, `easytier-${resolveEasyTierPlatform(process.platform)}-${resolveEasyTierArch(process.arch)}`)
    mkdirSync(releaseDir, { recursive: true })
    const corePath = path.join(releaseDir, process.platform === 'win32' ? 'easytier-core.exe' : 'easytier-core')
    const cliPath = path.join(releaseDir, process.platform === 'win32' ? 'easytier-cli.exe' : 'easytier-cli')
    writeFileSync(corePath, '')
    writeFileSync(cliPath, '')
    if (process.platform !== 'win32') {
      chmodSync(corePath, 0o755)
      chmodSync(cliPath, 0o755)
    }

    const resolved = resolveCachedEasyTierBinaries({
      workspaceRoot: root,
      version: 'v2.6.4',
    })
    assert.equal(resolved?.corePath, corePath)
    assert.equal(resolved?.cliPath, cliPath)
    assert.equal(resolved?.version, 'v2.6.4')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
