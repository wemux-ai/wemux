import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isAllowedReadableLocalApiCorsOrigin,
  isReadableLocalApiCorsPath,
} from './cors'

test('isReadableLocalApiCorsPath allows only read-only diagnostics endpoints', () => {
  assert.equal(isReadableLocalApiCorsPath('/api/health'), true)
  assert.equal(isReadableLocalApiCorsPath('/health'), true)
  assert.equal(isReadableLocalApiCorsPath('/api/status'), true)
  assert.equal(isReadableLocalApiCorsPath('/api/local-access/identity'), true)
  assert.equal(isReadableLocalApiCorsPath('/api/doctor'), true)
  assert.equal(isReadableLocalApiCorsPath('/api/config'), false)
  assert.equal(isReadableLocalApiCorsPath('/api/pair'), false)
})

test('isAllowedReadableLocalApiCorsOrigin allows Vibemux and local development origins', () => {
  assert.equal(isAllowedReadableLocalApiCorsOrigin('https://wemux.xyz'), true)
  assert.equal(isAllowedReadableLocalApiCorsOrigin('https://preview.wemux.xyz'), true)
  assert.equal(isAllowedReadableLocalApiCorsOrigin('https://wemux.ai'), true)
  assert.equal(isAllowedReadableLocalApiCorsOrigin('https://app.wemux.ai'), true)
  assert.equal(isAllowedReadableLocalApiCorsOrigin('http://app.wemux.localtest.me:15173'), true)
  assert.equal(isAllowedReadableLocalApiCorsOrigin('http://127.0.0.1:3000'), true)
  assert.equal(isAllowedReadableLocalApiCorsOrigin('http://localhost:3000'), true)
})

test('isAllowedReadableLocalApiCorsOrigin rejects unrelated websites', () => {
  assert.equal(isAllowedReadableLocalApiCorsOrigin('https://example.com'), false)
  assert.equal(isAllowedReadableLocalApiCorsOrigin('chrome-extension://extension-id'), false)
  assert.equal(isAllowedReadableLocalApiCorsOrigin(undefined), false)
})
