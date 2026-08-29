import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { isWemuxHomePath, resolveWemuxHomeDir } from './wemux-home'

const withHome = async (home: string, run: () => void) => {
  const previousHome = process.env.HOME
  process.env.HOME = home
  try {
    run()
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = previousHome
    }
  }
}

test('resolveWemuxHomeDir prefers the new ~/.wemux directory when both exist', () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'wemux-home-both-'))
  mkdirSync(path.join(tempHome, '.wemux'), { recursive: true })
  mkdirSync(path.join(tempHome, '.vibemux'), { recursive: true })
  try {
    withHome(tempHome, () => {
      assert.equal(resolveWemuxHomeDir('production'), path.join(tempHome, '.wemux'))
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('resolveWemuxHomeDir falls back to an existing legacy ~/.vibemux directory', () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'wemux-home-legacy-'))
  mkdirSync(path.join(tempHome, '.vibemux'), { recursive: true })
  try {
    withHome(tempHome, () => {
      assert.equal(resolveWemuxHomeDir('production'), path.join(tempHome, '.vibemux'))
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('resolveWemuxHomeDir uses the new directory when neither exists', () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'wemux-home-fresh-'))
  try {
    withHome(tempHome, () => {
      assert.equal(resolveWemuxHomeDir('production'), path.join(tempHome, '.wemux'))
      assert.equal(resolveWemuxHomeDir('development'), path.join(tempHome, '.wemux-dev'))
      assert.equal(resolveWemuxHomeDir('preview'), path.join(tempHome, '.wemux-preview'))
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('isWemuxHomePath recognizes both new and legacy default homes', () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'wemux-home-is-'))
  try {
    withHome(tempHome, () => {
      assert.equal(isWemuxHomePath(path.join(tempHome, '.wemux')), true)
      assert.equal(isWemuxHomePath(path.join(tempHome, '.vibemux')), true)
      assert.equal(isWemuxHomePath(path.join(tempHome, '.wemux-preview')), true)
      assert.equal(isWemuxHomePath(path.join(tempHome, '.custom-data')), false)
      assert.equal(existsSync(tempHome), true)
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})
