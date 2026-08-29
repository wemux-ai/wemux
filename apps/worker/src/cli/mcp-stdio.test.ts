import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSsePayload } from './mcp-stdio'

test('parseSsePayload extracts single-line data events', () => {
  const text = [
    'event: message',
    'data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}',
    '',
    'event: message',
    'data: {"jsonrpc":"2.0","id":2,"result":{"ok":false}}',
    '',
  ].join('\n')

  assert.deepEqual(parseSsePayload(text), [
    '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}',
    '{"jsonrpc":"2.0","id":2,"result":{"ok":false}}',
  ])
})

test('parseSsePayload merges multi-line data of one event', () => {
  const text = [
    'event: message',
    'data: {"jsonrpc":"2.0","id":3,"result":{"text":"',
    'data: line2',
    'data: "}}',
    '',
  ].join('\n')

  assert.deepEqual(parseSsePayload(text), [
    '{"jsonrpc":"2.0","id":3,"result":{"text":"\nline2\n"}}',
  ])
})

test('parseSsePayload filters [DONE] sentinel and empty data', () => {
  const text = [
    'event: message',
    'data: {"jsonrpc":"2.0","id":4,"result":{}}',
    '',
    'data: [DONE]',
    '',
    'event: comment',
    '',
  ].join('\n')

  assert.deepEqual(parseSsePayload(text), ['{"jsonrpc":"2.0","id":4,"result":{}}'])
})

test('parseSsePayload handles CRLF and empty input', () => {
  assert.deepEqual(parseSsePayload(''), [])
  assert.deepEqual(parseSsePayload('\r\n\r\n'), [])
  const text = 'event: message\r\ndata: {"a":1}\r\n\r\n'
  assert.deepEqual(parseSsePayload(text), ['{"a":1}'])
})
