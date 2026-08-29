import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { getCommandDetail, getProcessPathValue, resolveExecutable, setProcessPathValue } from './command-utils'

test('getCommandDetail prefers stderr when a command fails', () => {
  assert.equal(
    getCommandDetail({
      ok: false,
      stdout: 'Reading package lists...',
      stderr: 'E: Unable to locate package unzip',
    }, 'apt-get install unzip failed'),
    'E: Unable to locate package unzip',
  )
})

test('getCommandDetail keeps stdout first when a command succeeds', () => {
  assert.equal(
    getCommandDetail({
      ok: true,
      stdout: 'git version 2.34.1',
      stderr: 'warning: ignored',
    }, 'git unavailable'),
    'git version 2.34.1',
  )
})

test('resolveExecutable accepts existing Windows command files without POSIX execute bits', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vibemux-command-utils-'))
  const previousPath = process.env.PATH
  const previousPathExt = process.env.PATHEXT
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')

  try {
    const commandPath = path.join(tempDir, 'opencode.cmd')
    writeFileSync(commandPath, '@echo off\r\n')
    Object.defineProperty(process, 'platform', { value: 'win32' })
    process.env.PATH = tempDir
    process.env.PATHEXT = '.CMD;.EXE'

    assert.equal(resolveExecutable('opencode'), commandPath)
  } finally {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor)
    }
    if (previousPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = previousPath
    }
    if (previousPathExt === undefined) {
      delete process.env.PATHEXT
    } else {
      process.env.PATHEXT = previousPathExt
    }
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('resolveExecutable finds Windows npm global command shims outside PATH', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vibemux-npm-global-bin-'))
  const previousPath = process.env.PATH
  const previousPathExt = process.env.PATHEXT
  const previousAppData = process.env.APPDATA
  const previousUserProfile = process.env.USERPROFILE
  const previousNpmConfigPrefix = process.env.npm_config_prefix
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')

  try {
    const npmGlobalBin = path.join(tempDir, 'Roaming', 'npm')
    mkdirSync(npmGlobalBin, { recursive: true })
    const commandPath = path.join(npmGlobalBin, 'codex.cmd')
    writeFileSync(commandPath, '@echo off\r\n')
    Object.defineProperty(process, 'platform', { value: 'win32' })
    process.env.PATH = tempDir
    process.env.PATHEXT = '.CMD;.EXE'
    process.env.APPDATA = path.join(tempDir, 'Roaming')
    delete process.env.USERPROFILE
    delete process.env.npm_config_prefix

    assert.equal(resolveExecutable('codex'), commandPath)
    assert.equal(getProcessPathValue(process.env).split(path.delimiter)[0], npmGlobalBin)
  } finally {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor)
    }
    if (previousPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = previousPath
    }
    if (previousPathExt === undefined) {
      delete process.env.PATHEXT
    } else {
      process.env.PATHEXT = previousPathExt
    }
    if (previousAppData === undefined) {
      delete process.env.APPDATA
    } else {
      process.env.APPDATA = previousAppData
    }
    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE
    } else {
      process.env.USERPROFILE = previousUserProfile
    }
    if (previousNpmConfigPrefix === undefined) {
      delete process.env.npm_config_prefix
    } else {
      process.env.npm_config_prefix = previousNpmConfigPrefix
    }
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('Windows PATH helpers preserve Path casing from the host environment', () => {
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })

  try {
    const env: NodeJS.ProcessEnv = { Path: 'C:\\Windows\\System32' }
    assert.equal(getProcessPathValue(env), 'C:\\Windows\\System32')

    setProcessPathValue(env, `C:\\Node${path.delimiter}${getProcessPathValue(env)}`)

    assert.equal(env.Path, `C:\\Node${path.delimiter}C:\\Windows\\System32`)
    assert.equal(env.PATH, undefined)
  } finally {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor)
    }
  }
})
