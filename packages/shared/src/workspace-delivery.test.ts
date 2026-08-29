import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWorkspaceDeliverySummary } from './workspace-delivery'

test('buildWorkspaceDeliverySummary scopes pull requests to the workspace', () => {
  const summary = buildWorkspaceDeliverySummary([
    {
      updatedAt: '2026-06-01T10:00:00.000Z',
      result: {
        workspaceId: 'workspace-a',
        delivery: {
          pullRequest: {
            number: 101,
            url: 'https://github.com/example/repo/pull/101',
            state: 'open',
            compareBranch: 'feature/a',
          },
        },
      },
    },
    {
      updatedAt: '2026-06-01T11:00:00.000Z',
      result: {
        workspaceId: 'workspace-b',
        delivery: {
          pullRequest: {
            number: 202,
            url: 'https://github.com/example/repo/pull/202',
            state: 'merged',
            compareBranch: 'feature/b',
          },
        },
      },
    },
  ], 'workspace-a')

  assert.equal(summary?.pullRequest?.number, 101)
  assert.equal(summary?.pullRequest?.state, 'open')
})

test('buildWorkspaceDeliverySummary keeps refreshed pull request state from execution history', () => {
  const summary = buildWorkspaceDeliverySummary([
    {
      updatedAt: '2026-06-01T10:00:00.000Z',
      executionHistory: [
        {
          updatedAt: '2026-06-01T10:00:00.000Z',
          result: {
            workspaceId: 'workspace-a',
            delivery: {
              pullRequest: {
                number: 101,
                url: 'https://github.com/example/repo/pull/101',
                state: 'open',
                compareBranch: 'feature/a',
              },
            },
          },
        },
      ],
      result: {
        workspaceId: 'workspace-a',
        delivery: {
          pullRequest: {
            number: 101,
            url: 'https://github.com/example/repo/pull/101',
            state: 'merged',
            compareBranch: 'feature/a',
          },
        },
      },
    },
  ], 'workspace-a')

  assert.equal(summary?.pullRequest?.number, 101)
  assert.equal(summary?.pullRequest?.state, 'merged')
})

test('buildWorkspaceDeliverySummary keeps the single unscoped legacy pull request fallback', () => {
  const summary = buildWorkspaceDeliverySummary([
    {
      updatedAt: '2026-06-01T10:00:00.000Z',
      result: {
        delivery: {
          pullRequest: {
            number: 101,
            url: 'https://github.com/example/repo/pull/101',
            state: 'open',
            compareBranch: 'feature/a',
          },
        },
      },
    },
  ], 'workspace-a')

  assert.equal(summary?.pullRequest?.number, 101)
})

test('buildWorkspaceDeliverySummary includes workspace session pull requests', () => {
  const summary = buildWorkspaceDeliverySummary([], 'workspace-a', [
    {
      id: 'session-a',
      workspaceId: 'workspace-a',
      updatedAt: '2026-06-01T10:00:00.000Z',
      deliverySummary: {
        pullRequest: {
          state: 'open',
          updatedAt: '2026-06-01T10:00:00.000Z',
          number: 57,
          url: 'https://github.com/example/repo/pull/57',
          compareBranch: 'feature/session-a',
          workspaceId: 'workspace-a',
          workspaceSessionId: 'session-a',
        },
      },
    },
  ])

  assert.equal(summary?.pullRequest?.number, 57)
  assert.equal(summary?.pullRequest?.workspaceSessionId, 'session-a')
})
