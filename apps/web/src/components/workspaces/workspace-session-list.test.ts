import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getWorkspaceSessionIndicatorMode,
  resolveWorkspaceSessionIndicatorIdentity,
  resolveWorkspaceSessionVisibilityState,
} from './workspace-session-list'

test('acknowledged attention sessions stop using the unread indicator mode', () => {
  assert.equal(getWorkspaceSessionIndicatorMode(undefined, 'attention'), 'idle')
})

test('unread attention sessions still use the unread indicator mode', () => {
  assert.equal(getWorkspaceSessionIndicatorMode('attention', 'attention'), 'unread-attention')
})

test('completed sessions return to idle after being read', () => {
  assert.equal(getWorkspaceSessionIndicatorMode(undefined, 'complete'), 'idle')
})

test('failed sessions return to idle after being read', () => {
  assert.equal(getWorkspaceSessionIndicatorMode(undefined, 'error'), 'idle')
})

test('running custom agent sessions prefer uploaded avatars in the indicator', () => {
  const identity = resolveWorkspaceSessionIndicatorIdentity(
    {
      agentType: 'Codex',
      customAgentId: 'agent-design',
      customAgentName: 'Design Partner',
    },
    new Map([
      ['agent-design', {
        customAgentId: 'agent-design',
        customAgentName: 'Design Partner',
        avatarUrl: '/api/agents/agent-design/avatar/design.png',
        agentType: 'Codex',
      }],
    ]),
  )

  assert.deepEqual(identity, {
    kind: 'custom-avatar',
    avatarUrl: '/api/agents/agent-design/avatar/design.png',
    initials: 'DP',
    accentSeed: 'agent-design',
    runtime: 'Codex',
  })
})

test('runtime-backed sessions fall back to runtime icons when no custom avatar is available', () => {
  const identity = resolveWorkspaceSessionIndicatorIdentity(
    {
      agentType: 'ClaudeCode',
      customAgentId: '',
      customAgentName: 'Reviewer',
    },
    new Map(),
  )

  assert.deepEqual(identity, {
    kind: 'runtime',
    runtime: 'ClaudeCode',
    initials: 'RE',
    accentSeed: 'ClaudeCode',
  })
})

test('sessions without runtime or custom agent data fall back to initials', () => {
  const identity = resolveWorkspaceSessionIndicatorIdentity(
    {
      customAgentId: '',
      customAgentName: 'General Assistant',
    },
    new Map(),
  )

  assert.deepEqual(identity, {
    kind: 'initials',
    initials: 'GA',
    accentSeed: 'General Assistant',
  })
})

test('workspace session visibility stays fully expanded when the list is below the collapsed threshold', () => {
  assert.deepEqual(
    resolveWorkspaceSessionVisibilityState({
      totalCount: 6,
      collapsedVisibleCount: 10,
      expandStepCount: 10,
    }),
    {
      canToggle: false,
      canExpand: false,
      canCollapse: false,
      visibleCount: 6,
      hiddenCount: 0,
      nextVisibleCount: 6,
      collapsedVisibleCount: 6,
    },
  )
})

test('workspace session visibility shows only the collapsed count before expansion', () => {
  assert.deepEqual(
    resolveWorkspaceSessionVisibilityState({
      totalCount: 12,
      collapsedVisibleCount: 10,
      expandStepCount: 10,
    }),
    {
      canToggle: true,
      canExpand: true,
      canCollapse: false,
      visibleCount: 10,
      hiddenCount: 2,
      nextVisibleCount: 12,
      collapsedVisibleCount: 10,
    },
  )
})

test('workspace session visibility keeps expanding in steps until the full list is visible', () => {
  assert.deepEqual(
    resolveWorkspaceSessionVisibilityState({
      totalCount: 27,
      currentVisibleCount: 20,
      collapsedVisibleCount: 10,
      expandStepCount: 10,
    }),
    {
      canToggle: true,
      canExpand: true,
      canCollapse: true,
      visibleCount: 20,
      hiddenCount: 7,
      nextVisibleCount: 27,
      collapsedVisibleCount: 10,
    },
  )
})

test('workspace session visibility shows the full list once the expanded count reaches the total', () => {
  assert.deepEqual(
    resolveWorkspaceSessionVisibilityState({
      totalCount: 24,
      currentVisibleCount: 30,
      collapsedVisibleCount: 10,
      expandStepCount: 10,
    }),
    {
      canToggle: true,
      canExpand: false,
      canCollapse: true,
      visibleCount: 24,
      hiddenCount: 0,
      nextVisibleCount: 24,
      collapsedVisibleCount: 10,
    },
  )
})
