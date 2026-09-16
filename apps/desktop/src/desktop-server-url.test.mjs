import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildDesktopServerPageUrl,
  DEFAULT_DESKTOP_SERVER_URL,
  normalizeDesktopServerUrl,
  persistDesktopServerUrl,
  readDesktopServerUrl,
} from './desktop-server-url.mjs'

test('normalizeDesktopServerUrl accepts only credential-free HTTP origins', () => {
  assert.equal(normalizeDesktopServerUrl(' http://127.0.0.1:8989/path/ '), 'http://127.0.0.1:8989')
  assert.equal(normalizeDesktopServerUrl('https://example.com/'), 'https://example.com')
  assert.equal(normalizeDesktopServerUrl('file:///tmp/wemux'), null)
  assert.equal(normalizeDesktopServerUrl('https://user:secret@example.com'), null)
})

test('buildDesktopServerPageUrl resolves application routes on the selected origin', () => {
  assert.equal(buildDesktopServerPageUrl('http://localhost:8989', '/login'), 'http://localhost:8989/login')
})

test('desktop server persistence falls back safely and writes normalized state', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wemux-desktop-server-'))
  const configPath = path.join(directory, 'server-connection.json')

  assert.equal(readDesktopServerUrl(configPath), DEFAULT_DESKTOP_SERVER_URL)
  assert.equal(persistDesktopServerUrl(configPath, 'http://127.0.0.1:8989/'), 'http://127.0.0.1:8989')
  assert.equal(readDesktopServerUrl(configPath), 'http://127.0.0.1:8989')
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), { serverUrl: 'http://127.0.0.1:8989' })
})
