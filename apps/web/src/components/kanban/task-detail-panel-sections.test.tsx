import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  GitHubResourceBinding,
  Project,
  ProjectPullRequestReviewSummary,
  Task,
  TaskWorkspaceBinding,
  Workspace,
  WorkspaceSession,
} from '@shared/types'
import type { TaskAgentActivityRecord } from '../../lib/api'

import { TaskDetailCommentsSection, TaskDetailWorkspaceSection } from './task-detail-panel-sections'

const createdAt = '2026-07-24T00:00:00.000Z'
const projectId = 'project-vibemux'
const taskId = 'task-prd'
const workspaceId = 'workspace-prd'
const workspaceSessionId = 'session-prd'
const pullRequestId = 'github:github.com:example-org:example-repo:89'

test('task detail workspace cards consume canonical pull request bindings', () => {
  const project = {
    id: projectId,
    name: 'wemux',
    color: '#34d399',
    gitUrl: 'https://github.com/wemux-ai/wemux.git',
    defaultBranch: 'dev',
    createdAt,
    updatedAt: createdAt,
  } as Project
  const task = {
    id: taskId,
    projectId,
    title: '更新 PRD',
    description: '',
    status: 'in_review',
    priority: 'high',
    history: [],
    comments: [],
    logs: [],
    toolCalls: [],
    executionHistory: [],
    orchestration: [],
    validationChecks: [],
    createdAt,
    updatedAt: createdAt,
  } as unknown as Task
  const workspace = {
    id: workspaceId,
    projectId,
    name: 'PRD更新v2',
    source: 'manual',
    workingDirectoryMode: 'worktree',
    status: 'ready',
    repoReady: true,
    executorName: 'MBP',
    executorStatus: 'online',
    agentType: 'OpenCode',
    createdAt,
    updatedAt: createdAt,
  } as Workspace
  const workspaceSession = {
    id: workspaceSessionId,
    workspaceId,
    taskId,
    title: 'PRD更新v2',
    status: 'active',
    branchName: 'vibemux/f47d-prd更新v2',
    baseBranch: 'dev',
    createdAt,
    updatedAt: createdAt,
    lastActiveAt: createdAt,
  } as unknown as WorkspaceSession
  const taskBinding = {
    id: 'task-workspace-binding',
    taskId,
    workspaceId,
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  } as TaskWorkspaceBinding
  const pullRequest = {
    id: pullRequestId,
    provider: 'github',
    projectId,
    repoHost: 'github.com',
    repoOwner: 'example-org',
    repoName: 'wemux',
    repoFullName: 'wemux-ai/wemux',
    repoUrl: 'https://github.com/wemux-ai/wemux.git',
    number: 89,
    url: 'https://github.com/wemux-ai/wemux/pull/89',
    title: '更新 PRD 到 v0.3.108',
    body: '',
    state: 'open',
    merged: false,
    draft: false,
    baseBranch: 'dev',
    compareBranch: 'vibemux/f47d-prd更新v2',
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    files: [],
    syncedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  } satisfies ProjectPullRequestReviewSummary
  const resourceBinding = {
    id: 'github-resource-binding',
    provider: 'github',
    resourceType: 'pull_request',
    resourceId: pullRequestId,
    projectId,
    taskId,
    workspaceId,
    workspaceSessionId,
    role: 'delivery',
    status: 'confirmed',
    source: 'manual',
    confidence: 100,
    createdAt,
    updatedAt: createdAt,
  } satisfies GitHubResourceBinding

  const html = renderToStaticMarkup(
    <TaskDetailWorkspaceSection
      project={project}
      task={task}
      projectPullRequests={[pullRequest]}
      projectPullRequestBindings={[resourceBinding]}
      taskBindings={[taskBinding]}
      executors={[]}
      preferredExecutorName=""
      workspaces={[workspace]}
      workspaceSessions={[workspaceSession]}
      selectedWorkspaceId={workspaceId}
      pendingConfirmationWorkspaceId=""
      loading={false}
      busy={false}
      onCreateWorkspace={() => {}}
      onOpenWorkspaceSession={() => {}}
      onArchiveWorkspace={async () => {}}
      onDeleteWorkspace={async () => {}}
    />,
  )

  assert.match(html, /PRD更新v2/)
  assert.match(html, /data-task-pull-request-url="https:\/\/github\.com\/wemux-ai\/wemux\/pull\/89"/)
  assert.match(html, /#89/)
})

test('task comment shows the Agent currently processing that comment', () => {
  const comments = [{
    id: 'comment-1',
    authorType: 'user',
    authorId: 'user-1',
    authorName: 'Demo User',
    content: '@CEO 你是？',
    mentions: [{ targetType: 'agent', targetId: 'agent-ceo', targetName: 'CEO' }],
    attachments: [],
    createdAt,
  }] as Task['comments']
  const activities = [{
    id: 'event-1',
    agentId: 'agent-ceo',
    agentName: 'CEO',
    eventType: 'task.comment.mentioned',
    triggerKind: 'mention',
    triggerActorType: 'user',
    triggerActorId: 'user-1',
    includedCommentIds: ['comment-1'],
    commentId: 'comment-1',
    comment: '@CEO 你是？',
    coalescedCommentCount: 0,
    attempt: 1,
    retrySource: 'initial',
    status: 'running',
    result: null,
    startedAt: createdAt,
    completedAt: null,
    createdAt,
  }] satisfies TaskAgentActivityRecord[]

  const html = renderToStaticMarkup(
    <TaskDetailCommentsSection
      taskId={taskId}
      comments={comments}
      agentActivities={activities}
      currentUserId="user-1"
      commentInput=""
      mentionOptions={[]}
      busy={false}
      onCommentChange={() => {}}
      onCommentSubmit={async () => true}
      onCommentEdit={async () => true}
      onCommentDelete={async () => true}
      onCommentReaction={async () => true}
      onCommentResolution={async () => true}
      onCommentAttachmentUpload={async () => null}
      onOpenAgentActivity={() => {}}
    />,
  )

  assert.match(html, /data-task-comment-agent-activity="event-1"/)
  assert.match(html, /data-task-comment-agent-running-indicator="true"/)
  assert.match(html, /animate-spin/)
  assert.match(html, /motion-reduce:animate-none/)
  assert.match(html, /CEO/)
  assert.match(html, /正在处理/)
})

test('Agent comment links back to the run that produced it', () => {
  const comments = [{
    id: 'comment-agent-delivery',
    authorType: 'agent',
    authorId: 'agent-ceo',
    authorName: 'CEO',
    content: '任务已处理完成。',
    mentions: [],
    attachments: [],
    idempotencyKey: 'task-delivery:event-delivery',
    createdAt,
  }] as Task['comments']
  const activities = [{
    id: 'event-delivery',
    agentId: 'agent-ceo',
    agentName: 'CEO',
    eventType: 'task.comment.mentioned',
    triggerKind: 'mention',
    triggerActorType: 'user',
    triggerActorId: 'user-1',
    includedCommentIds: ['comment-user-trigger'],
    commentId: 'comment-user-trigger',
    comment: '@CEO 处理一下',
    coalescedCommentCount: 0,
    attempt: 1,
    retrySource: 'initial',
    status: 'completed',
    result: null,
    startedAt: createdAt,
    completedAt: createdAt,
    createdAt,
  }] satisfies TaskAgentActivityRecord[]

  const html = renderToStaticMarkup(
    <TaskDetailCommentsSection
      taskId={taskId}
      comments={comments}
      agentActivities={activities}
      currentUserId="user-1"
      commentInput=""
      mentionOptions={[]}
      busy={false}
      onCommentChange={() => {}}
      onCommentSubmit={async () => true}
      onCommentEdit={async () => true}
      onCommentDelete={async () => true}
      onCommentReaction={async () => true}
      onCommentResolution={async () => true}
      onCommentAttachmentUpload={async () => null}
      onOpenAgentActivity={() => {}}
    />,
  )

  assert.match(html, /data-task-comment-agent-run="event-delivery"/)
  assert.match(html, /本轮运行/)
  assert.match(html, /已完成/)
  assert.match(html, /查看过程/)
})
