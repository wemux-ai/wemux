import assert from 'node:assert/strict'
import test from 'node:test'
import { copyTextToClipboard } from './clipboard'

test('copyTextToClipboard prefers the native desktop clipboard', async () => {
  const calls: string[] = []
  const copied = await copyTextToClipboard('worker command', {
    writeNative: async (text) => {
      calls.push(`native:${text}`)
      return true
    },
    writeBrowser: async (text) => {
      calls.push(`browser:${text}`)
    },
  })

  assert.equal(copied, true)
  assert.deepEqual(calls, ['native:worker command'])
})

test('copyTextToClipboard falls back to the browser clipboard', async () => {
  const calls: string[] = []
  const copied = await copyTextToClipboard('pairing code', {
    writeNative: async () => null,
    writeBrowser: async (text) => {
      calls.push(text)
    },
  })

  assert.equal(copied, true)
  assert.deepEqual(calls, ['pairing code'])
})

test('copyTextToClipboard reports unavailable clipboard providers', async () => {
  assert.equal(await copyTextToClipboard('command', {
    writeNative: async () => null,
  }), false)
})
