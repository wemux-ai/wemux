import assert from 'node:assert/strict'
import test from 'node:test'

import { getCliName, isCanonicalCliName, renderRootHelp, renderTopicHelp } from './help'

test('root help presents worker as a first-class resource', () => {
  const help = renderRootHelp('wemux', '1.2.3')

  assert.match(help, /wemux CLI 1\.2\.3/)
  assert.match(help, /Resources:/)
  assert.match(help, /worker\s+Manage the local worker/)
  assert.match(help, /project\s+Manage projects/)
  assert.doesNotMatch(help, /Worker commands:/)
  assert.doesNotMatch(help, /Advanced commands:/)
})

test('worker help contains lifecycle and advanced commands under one namespace', () => {
  const help = renderTopicHelp('wemux', 'worker')

  assert.match(help || '', /worker connect --pairing-code/)
  assert.match(help || '', /worker service/)
  assert.match(help || '', /worker mcp-stdio/)
})

test('topic help supports nested workspace session commands', () => {
  const help = renderTopicHelp('wemux', 'workspace', 'session list')

  assert.match(help || '', /workspace session list <task-id>/)
})

test('resource help covers inbox, drive and chat', () => {
  const inbox = renderTopicHelp('wemux', 'inbox')
  assert.match(inbox || '', /inbox list/)
  assert.match(inbox || '', /inbox reply <item-id>/)

  const drive = renderTopicHelp('wemux', 'drive')
  assert.match(drive || '', /drive list/)
  assert.match(drive || '', /drive write <name>/)

  const chat = renderTopicHelp('wemux', 'chat')
  assert.match(chat || '', /chat conversations/)
  assert.match(chat || '', /chat channel send/)
})

test('CLI uses one canonical name', () => {
  assert.equal(getCliName('wemux'), 'wemux')
  assert.equal(getCliName('vbx'), 'vbx')
  assert.equal(getCliName('vibemux'), 'vibemux')
  // daemon package bins and unknown invocations fall back to the brand default
  assert.equal(getCliName('wemux-worker'), 'wemux')
  assert.equal(getCliName('vibemux-worker'), 'wemux')
  assert.equal(getCliName(), 'wemux')
})

test('canonical CLI names cover wemux and legacy aliases only', () => {
  assert.equal(isCanonicalCliName('wemux'), true)
  assert.equal(isCanonicalCliName('vbx'), true)
  assert.equal(isCanonicalCliName('vibemux'), true)
  assert.equal(isCanonicalCliName('wemux-worker'), false)
  assert.equal(isCanonicalCliName('vibemux-worker'), false)
  assert.equal(isCanonicalCliName(undefined), false)
})
