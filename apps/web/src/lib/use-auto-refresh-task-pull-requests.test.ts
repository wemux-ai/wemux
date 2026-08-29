import assert from 'node:assert/strict'
import test from 'node:test'
import type { Project, Task, TaskWorkspaceBinding, WorkspaceSession } from '@shared/types'
import { collectTaskPullRequestRefreshCandidates } from './use-auto-refresh-task-pull-requests'

const project = {
  id: 'project-1',
  versionControl: 'git-remote',
  gitUrl: 'https://github.com/example/repo.git',
  defaultBranch: 'main',
} as Project

const task = {
  id: 'task-1',
  projectId: 'project-1',
  agentRunningStatus: 'complete',
  result: {
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    executorNodeId: 'executor-1',
    delivery: {
      pullRequest: {
        number: 80,
        url: 'https://github.com/example/repo/pull/80',
        baseBranch: 'dev',
        compareBranch: 'feature/admin',
      },
    },
  },
} as Task

test('refreshes a task pull request after its workspace binding is detached', () => {
  const candidates = collectTaskPullRequestRefreshCandidates({
    projects: [project],
    tasks: [task],
    taskWorkspaceBindings: [{
      id: 'binding-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      status: 'detached',
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    }] as TaskWorkspaceBinding[],
    workspaceSessions: [{
      id: 'session-1',
      workspaceId: 'workspace-1',
      status: 'active',
      branchName: 'feature/admin',
      executorNodeId: 'executor-1',
    }] as WorkspaceSession[],
  })

  assert.deepEqual(candidates.map((candidate) => ({
    taskId: candidate.taskId,
    workspaceId: candidate.workspaceId,
    workspaceSessionId: candidate.workspaceSessionId,
    executorNodeId: candidate.executorNodeId,
  })), [{
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    executorNodeId: 'executor-1',
  }])
})
