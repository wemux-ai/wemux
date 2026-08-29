import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractOpenCodeTextOutput,
  getOpenCodeAssistantEntriesForPrompt,
  getOpenCodeErrorFromMessageEntries,
  getOpenCodeOutputFromMessageEntries,
  hasSettledOpenCodeAssistantEntry,
  isOpenCodeMissingTextOutput,
  isOpenCodeMessageSettled,
  OPENCODE_MISSING_TEXT_OUTPUT_ERROR_MESSAGE,
} from './opencode-message-output'

test('extractOpenCodeTextOutput joins text parts and ignores non-text parts', () => {
  assert.equal(extractOpenCodeTextOutput([
    { type: 'reasoning', text: 'internal' },
    { type: 'text', text: 'hello' },
    { type: 'tool' },
    { type: 'text', text: 'world' },
  ]), 'hello\n\nworld')
})

test('getOpenCodeOutputFromMessageEntries prefers the matching assistant message id', () => {
  const entries = [
    {
      info: { id: 'assistant-1', role: 'assistant', time: { created: 10, completed: 20 } },
      parts: [{ type: 'text', text: 'older' }],
    },
    {
      info: { id: 'assistant-2', role: 'assistant', time: { created: 30, completed: 40 } },
      parts: [{ type: 'text', text: 'newer' }],
    },
  ]

  assert.equal(getOpenCodeOutputFromMessageEntries(entries, { preferredMessageId: 'assistant-1' }), 'older')
})

test('getOpenCodeOutputFromMessageEntries ignores assistant output from earlier prompts', () => {
  const entries = [
    {
      info: { id: 'assistant-old', role: 'assistant', time: { created: 100, completed: 120 } },
      parts: [{ type: 'text', text: 'old output' }],
    },
    {
      info: { id: 'assistant-new', role: 'assistant', time: { created: 240, completed: 260 } },
      parts: [{ type: 'text', text: 'new output' }],
    },
  ]

  assert.equal(
    getOpenCodeOutputFromMessageEntries(entries, { promptStartedAtMs: 200 }),
    'new output',
  )
})

test('getOpenCodeErrorFromMessageEntries returns assistant error text for empty failed messages', () => {
  const entries = [
    {
      info: { id: 'assistant-failed', role: 'assistant', time: { created: 240 }, error: { message: 'unexpected status 403 Forbidden' } },
      parts: [],
    },
  ]

  assert.equal(
    getOpenCodeErrorFromMessageEntries(entries, { promptStartedAtMs: 200 }),
    'unexpected status 403 Forbidden',
  )
})

test('getOpenCodeErrorFromMessageEntries prefers the matching assistant error', () => {
  const entries = [
    {
      info: { id: 'assistant-old', role: 'assistant', time: { created: 100 }, error: { message: 'old error' } },
      parts: [],
    },
    {
      info: { id: 'assistant-new', role: 'assistant', time: { created: 240 }, error: { error: { data: { message: 'new error' } } } },
      parts: [],
    },
  ]

  assert.equal(
    getOpenCodeErrorFromMessageEntries(entries, {
      preferredMessageId: 'assistant-new',
      promptStartedAtMs: 200,
    }),
    'new error',
  )
})

test('getOpenCodeAssistantEntriesForPrompt selects only current prompt snapshot entries', () => {
  const entries = [
    {
      info: { id: 'assistant-old', role: 'assistant', time: { created: 100, completed: 120 } },
      parts: [{ type: 'text', text: 'old output' }],
    },
    {
      info: { id: 'assistant-new', role: 'assistant', time: { created: 240, completed: 260 } },
      parts: [{ type: 'text', text: 'new output' }],
    },
  ]

  assert.deepEqual(
    getOpenCodeAssistantEntriesForPrompt(entries, { promptStartedAtMs: 200 }).map((entry) => entry.info?.id),
    ['assistant-new'],
  )
})

test('getOpenCodeAssistantEntriesForPrompt prefers the active assistant message id', () => {
  const entries = [
    {
      info: { id: 'assistant-old', role: 'assistant', time: { created: 100, completed: 120 } },
      parts: [{ type: 'text', text: 'old output' }],
    },
    {
      info: { id: 'assistant-new', role: 'assistant', time: { created: 240, completed: 260 } },
      parts: [{ type: 'text', text: 'new output' }],
    },
  ]

  assert.deepEqual(
    getOpenCodeAssistantEntriesForPrompt(entries, {
      preferredMessageId: 'assistant-old',
      promptStartedAtMs: 200,
    }).map((entry) => entry.info?.id),
    ['assistant-old'],
  )
})

test('hasSettledOpenCodeAssistantEntry only considers this prompt window when no preferred id is available', () => {
  const entries = [
    {
      info: { id: 'assistant-old', role: 'assistant', time: { created: 100, completed: 120 } },
      parts: [{ type: 'text', text: 'old output' }],
    },
    {
      info: { id: 'assistant-new', role: 'assistant', time: { created: 240 } },
      parts: [{ type: 'text', text: 'pending output' }],
    },
  ]

  assert.equal(hasSettledOpenCodeAssistantEntry(entries, { promptStartedAtMs: 200 }), false)
  assert.equal(isOpenCodeMessageSettled(entries[0]), true)
})

test('isOpenCodeMissingTextOutput identifies empty and placeholder output', () => {
  assert.equal(isOpenCodeMissingTextOutput(''), true)
  assert.equal(isOpenCodeMissingTextOutput('   '), true)
  assert.equal(isOpenCodeMissingTextOutput('OpenCode 未返回文本输出。'), true)
  assert.equal(isOpenCodeMissingTextOutput('OpenCode 已处理完成，但没有返回文本输出。'), true)
  assert.equal(isOpenCodeMissingTextOutput('OpenCode 未生成有效文本回复，请重试。'), true)
  assert.equal(isOpenCodeMissingTextOutput('real reply'), false)
  assert.equal(OPENCODE_MISSING_TEXT_OUTPUT_ERROR_MESSAGE, 'OpenCode 未生成有效文本回复，请重试。')
})
