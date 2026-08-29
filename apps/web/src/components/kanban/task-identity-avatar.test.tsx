import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { TaskIdentityAvatar } from './task-identity-avatar'

test('task identity avatar keeps initials hidden while a real image is loading', () => {
  const loadingMarkup = renderToStaticMarkup(
    <TaskIdentityAvatar
      type="agent"
      id="agent-ceo"
      name="CEO"
      avatarUrl="/agents/avatars/agent-01.png"
    />,
  )
  const missingMarkup = renderToStaticMarkup(
    <TaskIdentityAvatar type="agent" id="agent-ceo" name="CEO" />,
  )

  assert.doesNotMatch(loadingMarkup, />CE</)
  assert.match(loadingMarkup, /bg-zinc-900/)
  assert.match(missingMarkup, />CE</)
})
