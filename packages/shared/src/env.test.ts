import assert from 'node:assert/strict'
import test from 'node:test'
import { bridgeWemuxEnvToLegacy, getEnv } from './env'

test('getEnv prefers the new WEMUX_ prefix over the legacy VIBEMUX_ prefix', () => {
  const legacy = 'WEMUX_TEST_GET_ENV'
  process.env[legacy] = 'new-value'
  process.env[`VIBEMUX_TEST_GET_ENV`] = 'legacy-value'
  assert.equal(getEnv(legacy), 'new-value')
  delete process.env[legacy]
  delete process.env[`VIBEMUX_TEST_GET_ENV`]
})

test('getEnv falls back to the legacy VIBEMUX_ prefix when WEMUX_ is unset', () => {
  delete process.env['WEMUX_TEST_FALLBACK']
  process.env['VIBEMUX_TEST_FALLBACK'] = 'legacy-only'
  assert.equal(getEnv('WEMUX_TEST_FALLBACK'), 'legacy-only')
  delete process.env['VIBEMUX_TEST_FALLBACK']
})

test('bridgeWemuxEnvToLegacy copies WEMUX_ values into VIBEMUX_ slots', () => {
  process.env['WEMUX_TEST_BRIDGE'] = 'copied'
  delete process.env['VIBEMUX_TEST_BRIDGE']
  bridgeWemuxEnvToLegacy()
  assert.equal(process.env['VIBEMUX_TEST_BRIDGE'], 'copied')
  delete process.env['WEMUX_TEST_BRIDGE']
  delete process.env['VIBEMUX_TEST_BRIDGE']
})

test('bridgeWemuxEnvToLegacy does not overwrite legacy values with empty WEMUX_ placeholders', () => {
  // 部署层常注入空字符串占位（如 docker-compose 的 ${WEMUX_X:-}），
  // 不得覆盖 .env 中已配置的旧前缀真实值。
  process.env['WEMUX_TEST_BRIDGE_EMPTY'] = ''
  process.env['VIBEMUX_TEST_BRIDGE_EMPTY'] = 'real-value'
  bridgeWemuxEnvToLegacy()
  assert.equal(process.env['VIBEMUX_TEST_BRIDGE_EMPTY'], 'real-value')
  delete process.env['WEMUX_TEST_BRIDGE_EMPTY']
  delete process.env['VIBEMUX_TEST_BRIDGE_EMPTY']
})
