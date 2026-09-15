import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createAppProtocolResponse } from './app-protocol.mjs'

const createWebRoot = () => {
  const webRoot = mkdtempSync(path.join(tmpdir(), 'wemux-app-protocol-'))
  mkdirSync(path.join(webRoot, 'assets'))
  writeFileSync(path.join(webRoot, 'index.html'), '<main>Wemux</main>', 'utf8')
  writeFileSync(path.join(webRoot, 'assets', 'app.js'), 'globalThis.wemux = true', 'utf8')
  return webRoot
}

test('createAppProtocolResponse serves JavaScript with an executable MIME type', async () => {
  const response = createAppProtocolResponse(createWebRoot(), new Request('wemux-app://local/assets/app.js'))

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8')
  assert.equal(await response.text(), 'globalThis.wemux = true')
})

test('createAppProtocolResponse falls back to the SPA shell for routes', async () => {
  const response = createAppProtocolResponse(createWebRoot(), new Request('wemux-app://local/chat'))

  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.equal(await response.text(), '<main>Wemux</main>')
})

test('createAppProtocolResponse rejects malformed and escaping paths', () => {
  const webRoot = createWebRoot()
  assert.equal(createAppProtocolResponse(webRoot, { url: 'wemux-app://local/%E0%A4%A', method: 'GET' }).status, 400)
  assert.equal(createAppProtocolResponse(webRoot, { url: 'wemux-app://local/..%2Foutside', method: 'GET' }).status, 403)
})
