import assert from 'node:assert/strict'
import test from 'node:test'
import {
  emitTextDelta,
  extractStreamingText,
  resetStreamingPartState,
  type TaskChatStreamPart,
  type TaskChatStreamWriter,
} from './task-chat-stream'

test('resetStreamingPartState prevents a new assistant message from inheriting previous text', () => {
  const parts: TaskChatStreamPart[] = []
  const writer: TaskChatStreamWriter = {
    write: (part) => {
      parts.push(part)
    },
  }
  const textState = new Map<string, string>()
  const activeTextParts = new Set<string>()

  emitTextDelta(writer, textState, activeTextParts, 'part-1', 'first reply')
  assert.equal(extractStreamingText(textState), 'first reply')

  resetStreamingPartState(writer, textState, activeTextParts, 'text')
  emitTextDelta(writer, textState, activeTextParts, 'part-2', 'second reply')

  assert.equal(extractStreamingText(textState), 'second reply')
  const simplifiedParts = parts.map((part) => {
    if (part.type === 'text-delta') {
      return { type: part.type, delta: part.delta }
    }

    if ('id' in part) {
      return { type: part.type, id: part.id }
    }

    return { type: part.type }
  })
  assert.deepEqual(
    simplifiedParts,
    [
      { type: 'text-start', id: 'part-1' },
      { type: 'text-delta', delta: 'first reply' },
      { type: 'text-end', id: 'part-1' },
      { type: 'text-start', id: 'part-2' },
      { type: 'text-delta', delta: 'second reply' },
    ],
  )
})
