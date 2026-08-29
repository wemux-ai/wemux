import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTaskAgentActivityStream,
  publishTaskAgentActivityChange,
  publishTaskAgentTranscriptChange,
} from './task-agent-activity-stream'

test('task Agent activity stream only receives invalidations for its task', async () => {
  const reader = createTaskAgentActivityStream('task-1').getReader()
  const decoder = new TextDecoder()
  const initial = await reader.read()
  assert.match(decoder.decode(initial.value), /event: activity/)

  publishTaskAgentActivityChange('task-2')
  publishTaskAgentActivityChange('task-1')
  const changed = await reader.read()
  assert.match(decoder.decode(changed.value), /"taskId":"task-1"/)
  await reader.cancel()
})

test('task Agent activity stream pushes transcript invalidations with an event id', async () => {
  const reader = createTaskAgentActivityStream('task-transcript').getReader()
  const decoder = new TextDecoder()
  await reader.read()

  publishTaskAgentTranscriptChange('task-transcript', 'event-1')
  const changed = decoder.decode((await reader.read()).value)
  assert.match(changed, /event: transcript/)
  assert.match(changed, /"eventId":"event-1"/)
  await reader.cancel()
})
