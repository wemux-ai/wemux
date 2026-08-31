import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendWemuxAgentCoAuthorTrailer,
  buildWemuxAgentCommitMessage,
  buildWemuxAgentCoAuthorTrailer,
  WEMUX_AGENT_CO_AUTHOR_TRAILER,
} from './git-commit-message'

test('buildWemuxAgentCommitMessage keeps the AI headline as subject and appends the agent trailer', () => {
  assert.equal(
    buildWemuxAgentCommitMessage({
      reply: '# Fix workspace auto commit\n\nDetails here.',
      fallback: 'vibemux: workspace auto commit',
    }),
    `Fix workspace auto commit\n\n${WEMUX_AGENT_CO_AUTHOR_TRAILER}`,
  )
})

test('appendWemuxAgentCoAuthorTrailer does not duplicate the Vibemux trailer', () => {
  const message = `Fix something\n\n${WEMUX_AGENT_CO_AUTHOR_TRAILER}`
  assert.equal(appendWemuxAgentCoAuthorTrailer(message), message)
})

test('buildWemuxAgentCommitMessage uses the provided agent bot identity', () => {
  const identity = {
    name: 'Vibemux',
    email: '289628643+vibemux[bot]@users.noreply.github.com',
  }

  assert.equal(
    buildWemuxAgentCommitMessage({
      reply: 'Ship the fix',
      fallback: 'vibemux: task',
      agentIdentity: identity,
    }),
    `Ship the fix\n\n${buildWemuxAgentCoAuthorTrailer(identity)}`,
  )
})

test('buildWemuxAgentCommitMessage adds both agent and user co-authors', () => {
  assert.equal(
    buildWemuxAgentCommitMessage({
      reply: 'Ship the fix',
      fallback: 'vibemux: task',
      agentIdentity: {
        name: 'Vibemux',
        email: '289628643+vibemux[bot]@users.noreply.github.com',
      },
      userIdentity: {
        name: 'Example Developer',
        email: 'developer@example.com',
      },
    }),
    [
      'Ship the fix',
      '',
      'Co-authored-by: Vibemux <289628643+vibemux[bot]@users.noreply.github.com>',
      'Co-authored-by: Example Developer <developer@example.com>',
    ].join('\n'),
  )
})

test('appendWemuxAgentCoAuthorTrailer does not duplicate a matching agent bot email', () => {
  const identity = {
    name: 'Vibemux',
    email: '289628643+vibemux[bot]@users.noreply.github.com',
  }
  const message = 'Fix something\n\nCo-authored-by: Vibemux Agent <289628643+vibemux[bot]@users.noreply.github.com>'

  assert.equal(appendWemuxAgentCoAuthorTrailer(message, identity), message)
})
