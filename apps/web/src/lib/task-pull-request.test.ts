import assert from 'node:assert/strict'
import test from 'node:test'
import type { GitHubResourceBinding, ProjectPullRequestReviewSummary, Task } from '@shared/types'
import {
  applyTaskPullRequestResult,
  listTaskPullRequestEntries,
  resolveLinkedWorkspacePullRequestDisplay,
  resolveTaskIndexedPullRequestDisplay,
  resolveWorkspaceIndexedPullRequestDisplay,
  resolveTaskPullRequestDisplay,
  resolveTaskWorkspacePullRequestDisplay,
  resolveWorkspaceDeliveryPullRequestDisplay,
  resolveWorkspaceListPullRequestDisplay,
  resolveWorkspaceSessionPreviewPullRequestDisplay,
  summarizeTaskIndexedPullRequests,
  summarizeTaskPullRequests,
} from './task-pull-request'

const createTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  projectId: 'project-1',
  title: '修复 PR 展示',
  description: '',
  status: 'todo',
  priority: 'medium',
  difficulty: 'medium',
  retryCount: 0,
  agentType: 'OpenCode',
  executionMode: 'auto',
  gitIdentityMode: 'personal',
  agentManaged: 'ai',
  baseBranch: 'main',
  createdAt: '2026-05-31T00:00:00.000Z',
  updatedAt: '2026-05-31T00:00:00.000Z',
  currentStep: '',
  needsHumanConfirm: false,
  agentRunningStatus: 'idle',
  executionHistory: [],
  comments: [],
  logs: [],
  toolCalls: [],
  history: [],
  orchestration: [],
  validationChecks: [],
  ...overrides,
} as Task)

const createProjectPullRequest = (
  overrides: Partial<ProjectPullRequestReviewSummary> = {},
): ProjectPullRequestReviewSummary => ({
  id: 'pr-1',
  provider: 'github',
  projectId: 'project-1',
  repoHost: 'github.com',
  repoOwner: 'example',
  repoName: 'repo',
  repoFullName: 'example/repo',
  repoUrl: 'https://github.com/example/repo',
  number: 101,
  url: 'https://github.com/example/repo/pull/101',
  title: 'PR A',
  body: '',
  state: 'open',
  merged: false,
  draft: false,
  baseBranch: 'main',
  compareBranch: 'feature/a',
  additions: 0,
  deletions: 0,
  changedFiles: 0,
  files: [],
  syncedAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T09:59:00.000Z',
  ...overrides,
})

const createPullRequestBinding = (
  overrides: Partial<GitHubResourceBinding> = {},
): GitHubResourceBinding => ({
  id: 'binding-1',
  provider: 'github',
  resourceType: 'pull_request',
  resourceId: 'pr-1',
  projectId: 'project-1',
  taskId: 'task-1',
  role: 'delivery',
  status: 'confirmed',
  source: 'agent_output',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
  ...overrides,
})

test('resolves workspace-specific pull requests from execution history', () => {
  const task = createTask({
    executionHistory: [
      {
        id: 'run-1',
        status: 'completed',
        createdAt: '2026-05-31T01:00:00.000Z',
        updatedAt: '2026-05-31T01:10:00.000Z',
        workspaceId: 'workspace-a',
        result: {
          taskId: 'task-1',
          status: 'completed',
          returnMode: 'commit',
          summary: 'done',
          filesChanged: [],
          startedAt: '2026-05-31T01:00:00.000Z',
          completedAt: '2026-05-31T01:10:00.000Z',
          durationSec: 600,
          executorNodeId: 'executor-1',
          workspaceId: 'workspace-a',
          delivery: {
            mode: 'commit',
            pullRequest: {
              ready: true,
              remoteReady: true,
              repoUrl: 'https://github.com/example/repo',
              title: 'PR A',
              description: 'body',
              baseBranch: 'main',
              compareBranch: 'feature/a',
              number: 101,
              url: 'https://github.com/example/repo/pull/101',
              state: 'open',
            },
          },
        },
      },
      {
        id: 'run-2',
        status: 'completed',
        createdAt: '2026-05-31T02:00:00.000Z',
        updatedAt: '2026-05-31T02:10:00.000Z',
        workspaceId: 'workspace-b',
        result: {
          taskId: 'task-1',
          status: 'completed',
          returnMode: 'commit',
          summary: 'done',
          filesChanged: [],
          startedAt: '2026-05-31T02:00:00.000Z',
          completedAt: '2026-05-31T02:10:00.000Z',
          durationSec: 600,
          executorNodeId: 'executor-1',
          workspaceId: 'workspace-b',
          delivery: {
            mode: 'commit',
            pullRequest: {
              ready: true,
              remoteReady: true,
              repoUrl: 'https://github.com/example/repo',
              title: 'PR B',
              description: 'body',
              baseBranch: 'main',
              compareBranch: 'feature/b',
              number: 102,
              url: 'https://github.com/example/repo/pull/102',
              state: 'merged',
            },
          },
        },
      },
    ],
  })

  assert.equal(resolveTaskWorkspacePullRequestDisplay({ task, workspaceId: 'workspace-a' })?.number, 101)
  assert.equal(resolveTaskWorkspacePullRequestDisplay({ task, workspaceId: 'workspace-b' })?.number, 102)
  assert.equal(resolveLinkedWorkspacePullRequestDisplay({ tasks: [task], workspaceId: 'workspace-a' })?.number, 101)
  assert.equal(resolveLinkedWorkspacePullRequestDisplay({ tasks: [task], workspaceId: 'workspace-b' })?.number, 102)
})

test('does not leak another workspace pull request into a workspace without its own record', () => {
  const task = createTask({
    executionHistory: [
      {
        id: 'run-1',
        status: 'completed',
        createdAt: '2026-05-31T01:00:00.000Z',
        updatedAt: '2026-05-31T01:10:00.000Z',
        workspaceId: 'workspace-a',
        result: {
          taskId: 'task-1',
          status: 'completed',
          returnMode: 'commit',
          summary: 'done',
          filesChanged: [],
          startedAt: '2026-05-31T01:00:00.000Z',
          completedAt: '2026-05-31T01:10:00.000Z',
          durationSec: 600,
          executorNodeId: 'executor-1',
          workspaceId: 'workspace-a',
          delivery: {
            mode: 'commit',
            pullRequest: {
              ready: true,
              remoteReady: true,
              repoUrl: 'https://github.com/example/repo',
              title: 'PR A',
              description: 'body',
              baseBranch: 'main',
              compareBranch: 'feature/a',
              number: 101,
              url: 'https://github.com/example/repo/pull/101',
              state: 'open',
            },
          },
        },
      },
    ],
  })

  assert.equal(resolveTaskWorkspacePullRequestDisplay({ task, workspaceId: 'workspace-b' }), null)
  assert.equal(resolveLinkedWorkspacePullRequestDisplay({ tasks: [task], workspaceId: 'workspace-b' }), null)
})

test('does not display an uncreated pull request from delivery branch metadata', () => {
  const task = createTask({
    result: {
      taskId: 'task-1',
      status: 'completed',
      returnMode: 'commit',
      summary: 'done',
      filesChanged: [],
      startedAt: '2026-05-31T01:00:00.000Z',
      completedAt: '2026-05-31T01:10:00.000Z',
      durationSec: 600,
      executorNodeId: 'executor-1',
      workspaceId: 'workspace-a',
      delivery: {
        mode: 'commit',
        pullRequest: {
          ready: true,
          remoteReady: true,
          repoUrl: 'https://github.com/example/repo',
          title: '',
          description: '',
          baseBranch: 'main',
          compareBranch: 'feature/uncreated',
        },
      },
    },
  })

  assert.equal(resolveTaskPullRequestDisplay(task), null)
  assert.equal(resolveTaskWorkspacePullRequestDisplay({ task, workspaceId: 'workspace-a' }), null)
  assert.equal(resolveWorkspaceListPullRequestDisplay({
    tasks: [task],
    workspaceId: 'workspace-a',
    compareBranch: 'feature/uncreated',
  }), null)
  assert.equal(resolveWorkspaceDeliveryPullRequestDisplay({
    state: 'unknown',
    updatedAt: '2026-06-01T10:00:00.000Z',
    workspaceId: 'workspace-a',
    compareBranch: 'feature/uncreated',
  }), null)
})

test('summarizes distinct workspace pull requests and keeps the latest display', () => {
  const task = createTask({
    executionHistory: [
      {
        id: 'run-1',
        status: 'completed',
        createdAt: '2026-05-31T01:00:00.000Z',
        updatedAt: '2026-05-31T01:10:00.000Z',
        workspaceId: 'workspace-a',
        result: {
          taskId: 'task-1',
          status: 'completed',
          returnMode: 'commit',
          summary: 'done',
          filesChanged: [],
          startedAt: '2026-05-31T01:00:00.000Z',
          completedAt: '2026-05-31T01:10:00.000Z',
          durationSec: 600,
          executorNodeId: 'executor-1',
          workspaceId: 'workspace-a',
          delivery: {
            mode: 'commit',
            pullRequest: {
              ready: true,
              remoteReady: true,
              repoUrl: 'https://github.com/example/repo',
              title: 'PR A',
              description: 'body',
              baseBranch: 'main',
              compareBranch: 'feature/a',
              number: 101,
              url: 'https://github.com/example/repo/pull/101',
              state: 'open',
            },
          },
        },
      },
      {
        id: 'run-2',
        status: 'completed',
        createdAt: '2026-05-31T02:00:00.000Z',
        updatedAt: '2026-05-31T02:10:00.000Z',
        workspaceId: 'workspace-b',
        result: {
          taskId: 'task-1',
          status: 'completed',
          returnMode: 'commit',
          summary: 'done',
          filesChanged: [],
          startedAt: '2026-05-31T02:00:00.000Z',
          completedAt: '2026-05-31T02:10:00.000Z',
          durationSec: 600,
          executorNodeId: 'executor-1',
          workspaceId: 'workspace-b',
          delivery: {
            mode: 'commit',
            pullRequest: {
              ready: true,
              remoteReady: true,
              repoUrl: 'https://github.com/example/repo',
              title: 'PR B',
              description: 'body',
              baseBranch: 'main',
              compareBranch: 'feature/b',
              number: 102,
              url: 'https://github.com/example/repo/pull/102',
              state: 'merged',
            },
          },
        },
      },
    ],
  })

  const entries = listTaskPullRequestEntries(task)
  const summary = summarizeTaskPullRequests(task)

  assert.equal(entries.length, 2)
  assert.equal(summary.totalCount, 2)
  assert.equal(summary.openCount, 1)
  assert.equal(summary.mergedCount, 1)
  assert.equal(summary.latestDisplay?.number, 102)
})

test('keeps refreshed pull requests scoped to the workspace and session', () => {
  const task = createTask({
    result: {
      taskId: 'task-1',
      status: 'completed',
      returnMode: 'commit',
      summary: 'done',
      filesChanged: [],
      startedAt: '2026-05-31T01:00:00.000Z',
      completedAt: '2026-05-31T01:10:00.000Z',
      durationSec: 600,
      executorNodeId: 'executor-1',
      delivery: {
        mode: 'commit',
        pullRequest: {
          ready: true,
          remoteReady: true,
          repoUrl: 'https://github.com/example/repo',
          title: 'PR A',
          description: 'body',
          baseBranch: 'main',
          compareBranch: 'feature/a',
          number: 101,
          url: 'https://github.com/example/repo/pull/101',
          state: 'open',
        },
      },
    },
  })

  const nextTask = applyTaskPullRequestResult({
    task,
    pullRequest: {
      title: 'PR A',
      body: 'body',
      baseBranch: 'main',
      compareBranch: 'feature/a',
      number: 101,
      url: 'https://github.com/example/repo/pull/101',
      state: 'merged',
    },
    repoUrl: 'https://github.com/example/repo',
    workspaceId: 'workspace-a',
    workspaceSessionId: 'session-a',
  })

  assert.equal(nextTask.result?.workspaceId, 'workspace-a')
  assert.equal(nextTask.result?.workspaceSessionId, 'session-a')
  assert.equal(resolveTaskWorkspacePullRequestDisplay({ task: nextTask, workspaceId: 'workspace-a' })?.number, 101)
})

test('maps workspace delivery summary pull request into card display labels', () => {
  const display = resolveWorkspaceDeliveryPullRequestDisplay({
    state: 'merged',
    updatedAt: '2026-06-01T10:00:00.000Z',
    number: 101,
    url: 'https://github.com/example/repo/pull/101',
    workspaceId: 'workspace-a',
  })

  assert.equal(display?.state, 'merged')
  assert.equal(display?.label, 'PR 已合并')
  assert.equal(display?.number, 101)
})

test('workspace list display prefers refreshed linked task pull request state over stale workspace delivery summary', () => {
  const task = createTask({
    updatedAt: '2026-06-01T10:05:00.000Z',
    result: {
      taskId: 'task-1',
      status: 'completed',
      returnMode: 'commit',
      summary: 'done',
      filesChanged: [],
      startedAt: '2026-06-01T10:00:00.000Z',
      completedAt: '2026-06-01T10:05:00.000Z',
      durationSec: 300,
      executorNodeId: 'executor-1',
      workspaceId: 'workspace-a',
      workspaceSessionId: 'session-a',
      delivery: {
        mode: 'commit',
        pullRequest: {
          ready: true,
          remoteReady: true,
          repoUrl: 'https://github.com/example/repo',
          title: 'PR A',
          description: 'body',
          baseBranch: 'main',
          compareBranch: 'feature/a',
          number: 101,
          url: 'https://github.com/example/repo/pull/101',
          state: 'merged',
        },
      },
    },
  })

  const display = resolveWorkspaceListPullRequestDisplay({
    tasks: [task],
    workspaceId: 'workspace-a',
    pullRequest: {
      state: 'open',
      updatedAt: '2026-06-01T09:55:00.000Z',
      number: 101,
      url: 'https://github.com/example/repo/pull/101',
      workspaceId: 'workspace-a',
      workspaceSessionId: 'session-a',
    },
  })

  assert.equal(display?.state, 'merged')
  assert.equal(display?.label, 'PR 已合并')
  assert.equal(display?.number, 101)
})

test('workspace list keeps scoped pull requests visible even when the active branch changes', () => {
  const task = createTask({
    updatedAt: '2026-06-01T10:05:00.000Z',
    result: {
      taskId: 'task-1',
      status: 'completed',
      returnMode: 'commit',
      summary: 'done',
      filesChanged: [],
      startedAt: '2026-06-01T10:00:00.000Z',
      completedAt: '2026-06-01T10:05:00.000Z',
      durationSec: 300,
      executorNodeId: 'executor-1',
      workspaceId: 'workspace-b',
      workspaceSessionId: 'session-b',
      delivery: {
        mode: 'commit',
        pullRequest: {
          ready: true,
          remoteReady: true,
          repoUrl: 'https://github.com/example/repo',
          title: 'PR B',
          description: 'body',
          baseBranch: 'main',
          compareBranch: 'feature/b',
          number: 102,
          url: 'https://github.com/example/repo/pull/102',
          state: 'merged',
        },
      },
    },
  })

  const display = resolveWorkspaceListPullRequestDisplay({
    tasks: [task],
    workspaceId: 'workspace-b',
    compareBranch: 'feature/a',
    pullRequest: {
      state: 'merged',
      updatedAt: '2026-06-01T10:05:00.000Z',
      number: 102,
      url: 'https://github.com/example/repo/pull/102',
      compareBranch: 'feature/b',
      workspaceId: 'workspace-b',
      workspaceSessionId: 'session-b',
    },
  })

  assert.equal(display?.number, 102)
  assert.equal(display?.state, 'merged')
})

test('workspace list still filters legacy fallback pull requests by compare branch', () => {
  const task = createTask({
    updatedAt: '2026-06-01T10:05:00.000Z',
    result: {
      taskId: 'task-1',
      status: 'completed',
      returnMode: 'commit',
      summary: 'done',
      filesChanged: [],
      startedAt: '2026-06-01T10:00:00.000Z',
      completedAt: '2026-06-01T10:05:00.000Z',
      durationSec: 300,
      executorNodeId: 'executor-1',
      delivery: {
        mode: 'commit',
        pullRequest: {
          ready: true,
          remoteReady: true,
          repoUrl: 'https://github.com/example/repo',
          title: 'PR Legacy',
          description: 'body',
          baseBranch: 'main',
          compareBranch: 'feature/legacy',
          number: 103,
          url: 'https://github.com/example/repo/pull/103',
          state: 'open',
        },
      },
    },
  })

  const display = resolveWorkspaceListPullRequestDisplay({
    tasks: [task],
    workspaceId: 'workspace-b',
    compareBranch: 'feature/a',
  })

  assert.equal(display, null)
})

test('workspace list resolves PR display from unified index by workspace and session before branch', () => {
  const display = resolveWorkspaceIndexedPullRequestDisplay({
    pullRequests: [
      createProjectPullRequest({
        id: 'branch-match',
        number: 201,
        compareBranch: 'feature/workspace-a',
        state: 'open',
      }),
      createProjectPullRequest({
        id: 'session-match',
        number: 202,
        compareBranch: 'feature/session-a',
        matchedWorkspaceSessionId: 'session-a',
        state: 'closed',
      }),
      createProjectPullRequest({
        id: 'workspace-match',
        number: 203,
        compareBranch: 'feature/workspace-canonical',
        matchedWorkspaceId: 'workspace-a',
        state: 'merged',
      }),
    ],
    projectId: 'project-1',
    workspaceId: 'workspace-a',
    workspaceSessionIds: ['session-a'],
    compareBranch: 'feature/workspace-a',
  })

  assert.equal(display?.number, 203)
  assert.equal(display?.state, 'merged')
})

test('workspace list resolves PR display from unified index by compare branch fallback', () => {
  const display = resolveWorkspaceIndexedPullRequestDisplay({
    pullRequests: [
      createProjectPullRequest({
        id: 'other-project',
        projectId: 'project-2',
        number: 301,
        compareBranch: 'feature/workspace-a',
      }),
      createProjectPullRequest({
        id: 'branch-match',
        number: 302,
        compareBranch: 'feature/workspace-a',
        state: 'open',
      }),
    ],
    projectId: 'project-1',
    workspaceId: 'workspace-a',
    workspaceSessionIds: [],
    compareBranch: 'feature/workspace-a',
  })

  assert.equal(display?.number, 302)
  assert.equal(display?.label, 'PR 审核中')
})

test('task and workspace indexes join canonical resources through bindings', () => {
  const pullRequests = [
    createProjectPullRequest({ id: 'pr-1', number: 89, state: 'open' }),
    createProjectPullRequest({ id: 'pr-2', number: 90, state: 'merged' }),
  ]
  const bindings = [
    createPullRequestBinding({
      id: 'task-binding',
      resourceId: 'pr-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
    }),
    createPullRequestBinding({
      id: 'other-task-binding',
      resourceId: 'pr-2',
      taskId: 'task-2',
      workspaceId: 'workspace-2',
    }),
  ]

  assert.equal(resolveTaskIndexedPullRequestDisplay({
    pullRequests,
    bindings,
    projectId: 'project-1',
    taskId: 'task-1',
  })?.number, 89)
  assert.equal(resolveWorkspaceIndexedPullRequestDisplay({
    pullRequests,
    bindings,
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    workspaceSessionIds: ['session-1'],
  })?.number, 89)
})

test('canonical joins keep a shared GitHub resource scoped to its Vibemux project', () => {
  const pullRequests = [
    createProjectPullRequest({
      id: 'github:github.com:example:repo:89',
      projectId: 'project-1',
      number: 89,
    }),
    createProjectPullRequest({
      id: 'github:github.com:example:repo:89',
      projectId: 'project-2',
      number: 89,
    }),
  ]
  const bindings = [
    createPullRequestBinding({
      id: 'project-1-binding',
      resourceId: 'github:github.com:example:repo:89',
      projectId: 'project-1',
      taskId: 'task-1',
    }),
    createPullRequestBinding({
      id: 'project-2-binding',
      resourceId: 'github:github.com:example:repo:89',
      projectId: 'project-2',
      taskId: 'task-2',
    }),
  ]

  assert.equal(resolveTaskIndexedPullRequestDisplay({
    pullRequests,
    bindings,
    projectId: 'project-1',
    taskId: 'task-1',
  })?.number, 89)
  assert.equal(resolveTaskIndexedPullRequestDisplay({
    pullRequests,
    bindings,
    projectId: 'project-1',
    taskId: 'task-2',
  }), null)
})

test('rejected bindings suppress legacy matched fields', () => {
  const pullRequests = [
    createProjectPullRequest({
      id: 'pr-1',
      number: 89,
      matchedTaskId: 'task-1',
      matchedWorkspaceId: 'workspace-1',
    }),
  ]
  const bindings = [
    createPullRequestBinding({
      resourceId: 'pr-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      status: 'rejected',
      source: 'manual',
    }),
  ]

  assert.equal(resolveTaskIndexedPullRequestDisplay({
    pullRequests,
    bindings,
    projectId: 'project-1',
    taskId: 'task-1',
  }), null)
  assert.equal(resolveWorkspaceIndexedPullRequestDisplay({
    pullRequests,
    bindings,
    projectId: 'project-1',
    workspaceId: 'workspace-1',
  }), null)
})

test('canonical task summary supports multiple pull request bindings', () => {
  const summary = summarizeTaskIndexedPullRequests({
    pullRequests: [
      createProjectPullRequest({
        id: 'pr-open',
        number: 89,
        state: 'open',
        updatedAt: '2026-06-01T11:00:00.000Z',
      }),
      createProjectPullRequest({
        id: 'pr-merged',
        number: 88,
        state: 'merged',
        updatedAt: '2026-06-01T10:00:00.000Z',
      }),
    ],
    bindings: [
      createPullRequestBinding({ id: 'binding-open', resourceId: 'pr-open' }),
      createPullRequestBinding({ id: 'binding-merged', resourceId: 'pr-merged' }),
    ],
    projectId: 'project-1',
    taskId: 'task-1',
  })

  assert.equal(summary.totalCount, 2)
  assert.equal(summary.openCount, 1)
  assert.equal(summary.mergedCount, 1)
  assert.equal(summary.latestDisplay?.number, 89)
})

test('workspace list resolves PR display from workspace session preview text', () => {
  const display = resolveWorkspaceSessionPreviewPullRequestDisplay({
    text: 'PR 已创建：https://github.com/wemux-ai/wemux/pull/57',
    compareBranch: 'vibemux/3876-workspace-message',
  })

  assert.equal(display?.number, 57)
  assert.equal(display?.url, 'https://github.com/wemux-ai/wemux/pull/57')
  assert.equal(display?.state, 'open')
  assert.equal(display?.compactLabel, 'PR')
  assert.equal(display?.compareBranch, 'vibemux/3876-workspace-message')
})
