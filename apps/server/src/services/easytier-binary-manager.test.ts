import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildEasyTierAssetName,
  buildEasyTierDownloadUrl,
  resolveCachedEasyTierBinaries,
  resolveEasyTierArch,
  resolveEasyTierInstallDir,
  resolveEasyTierPlatform,
} from './easytier-binary-manager'

test('server easytier binary manager maps release platform and arch', () => {
  assert.equal(resolveEasyTierPlatform('darwin'), 'macos')
  assert.equal(resolveEasyTierPlatform('linux'), 'linux')
  assert.equal(resolveEasyTierArch('x64'), 'x86_64')
  assert.equal(resolveEasyTierArch('arm64'), 'aarch64')
})

test('server easytier binary manager builds asset names and download urls', () => {
  assert.equal(buildEasyTierAssetName({
    version: 'v2.6.4',
    platform: 'linux',
    arch: 'x64',
  }), 'easytier-linux-x86_64-v2.6.4.zip')
  assert.equal(buildEasyTierDownloadUrl({
    version: 'v2.6.4',
    platform: 'linux',
    arch: 'x64',
    baseUrl: 'https://downloads.example.com/easytier',
  }), 'https://downloads.example.com/easytier/v2.6.4/easytier-linux-x86_64-v2.6.4.zip')
})

test('server easytier binary manager resolves cached binaries from runtime root', () => {
  const runtimeRoot = mkdtempSync(path.join(os.tmpdir(), 'vibemux-server-easytier-'))
  try {
    const installDir = resolveEasyTierInstallDir({
      runtimeRoot,
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
      runtimeRoot,
      version: 'v2.6.4',
    })
    assert.equal(resolved?.corePath, corePath)
    assert.equal(resolved?.cliPath, cliPath)
  } finally {
    rmSync(runtimeRoot, { recursive: true, force: true })
  }
})

test('server easytier binary manager resolves cached binaries from release subdirectory', () => {
  const runtimeRoot = mkdtempSync(path.join(os.tmpdir(), 'vibemux-server-easytier-nested-'))
  try {
    const installDir = resolveEasyTierInstallDir({
      runtimeRoot,
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
      runtimeRoot,
      version: 'v2.6.4',
    })
    assert.equal(resolved?.corePath, corePath)
    assert.equal(resolved?.cliPath, cliPath)
  } finally {
    rmSync(runtimeRoot, { recursive: true, force: true })
  }
})
