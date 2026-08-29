import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AgentActivityIndicator } from './agent-activity-indicator'

test('AgentActivityIndicator uses motion only while an Agent is actively thinking or executing', () => {
  for (const status of ['thinking', 'executing'] as const) {
    const markup = renderToStaticMarkup(
      <AgentActivityIndicator status={status} ariaLabel={`Agent ${status}`} />,
    )

    assert.match(markup, /aria-label="Agent/)
    assert.match(markup, /motion-safe:animate-ping/)
  }

  for (const status of ['idle', 'waiting', 'complete', 'error'] as const) {
    const markup = renderToStaticMarkup(
      <AgentActivityIndicator status={status} ariaLabel={`Agent ${status}`} />,
    )

    assert.doesNotMatch(markup, /animate-ping|animate-pulse/)
  }
})

test('AgentActivityIndicator has a compact execution dot for dense status rows', () => {
  const markup = renderToStaticMarkup(
    <AgentActivityIndicator status="executing" variant="dot" size="xs" ariaLabel="Agent executing" />,
  )

  assert.match(markup, /h-1\.5/)
  assert.match(markup, /bg-sky-400/)
  assert.match(markup, /motion-safe:animate-ping/)
})
