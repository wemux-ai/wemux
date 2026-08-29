import assert from 'node:assert/strict'
import test from 'node:test'
import type { PreviewSessionDto, PreviewViewerAccess } from '@shared/types'
import {
  buildWorkspacePreviewScopeKey,
  canOpenWorkspacePreviewInBrowser,
  clearCachedWorkspacePreviewState,
  readCachedWorkspacePreviewState,
  shouldReconnectRestoredWorkspacePreview,
  writeCachedWorkspacePreviewState,
} from './-use-workspace-testing'

const buildPreview = (workspaceId: string, previewId: string, executorId = 'executor-1'): PreviewSessionDto => ({
  previewId,
  purpose: 'app',
  projectId: 'project-1',
  taskId: 'task-1',
  workspaceId,
  workspaceSessionId: `workspace-session-${workspaceId}`,
  executorId,
  executionSurface: 'private-node',
  accessMode: 'tunnel',
  status: 'active',
  publicUrl: `http://${previewId}.local/`,
  previewHost: `${previewId}.local`,
  sourceAppUrl: 'http://127.0.0.1:3000/',
  additionalSourceAppUrls: [],
  createdAt: '2026-05-27T00:00:00.000Z',
  updatedAt: '2026-05-27T00:00:00.000Z',
  tunnelClientStatus: 'open',
  share: { enabled: false },
})

const buildViewer = (previewId: string): PreviewViewerAccess => ({
  iframeUrl: `http://${previewId}.iframe.local/`,
  publicUrl: `http://${previewId}.public.local/`,
  previewHost: `${previewId}.public.local`,
  grantType: 'owner',
})

test('workspace preview scope is stable across workspace session changes', () => {
  assert.equal(
    buildWorkspacePreviewScopeKey({
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    }),
    buildWorkspacePreviewScopeKey({
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    }),
  )
})

test('workspace preview scope changes across workspaces', () => {
  assert.notEqual(
    buildWorkspacePreviewScopeKey({
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    }),
    buildWorkspacePreviewScopeKey({
      taskId: 'task-1',
      workspaceId: 'workspace-2',
    }),
  )
})

test('workspace preview scope changes across executors', () => {
  assert.notEqual(
    buildWorkspacePreviewScopeKey({
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      executorId: 'executor-old',
    }),
    buildWorkspacePreviewScopeKey({
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      executorId: 'executor-new',
    }),
  )
})

test('workspace preview cache is keyed by task, workspace, and executor', () => {
  const firstScope = buildWorkspacePreviewScopeKey({
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    executorId: 'executor-1',
  })
  const secondScope = buildWorkspacePreviewScopeKey({
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    executorId: 'executor-2',
  })

  clearCachedWorkspacePreviewState(firstScope)
  clearCachedWorkspacePreviewState(secondScope)
  writeCachedWorkspacePreviewState(firstScope, buildPreview('workspace-1', 'preview-1', 'executor-1'), buildViewer('preview-1'), null)
  writeCachedWorkspacePreviewState(secondScope, buildPreview('workspace-1', 'preview-2', 'executor-2'), buildViewer('preview-2'), null)

  assert.equal(readCachedWorkspacePreviewState(firstScope)?.preview.previewId, 'preview-1')
  assert.equal(readCachedWorkspacePreviewState(secondScope)?.preview.previewId, 'preview-2')

  clearCachedWorkspacePreviewState(firstScope)
  assert.equal(readCachedWorkspacePreviewState(firstScope), null)
  assert.equal(readCachedWorkspacePreviewState(secondScope)?.preview.previewId, 'preview-2')

  clearCachedWorkspacePreviewState(secondScope)
})

test('restored workspace preview reconnects only when the tunnel is not open', () => {
  const basePreview = {
    previewId: 'preview-1',
    purpose: 'app' as const,
    projectId: 'project-1',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'workspace-session-1',
    executorId: 'executor-1',
    executionSurface: 'private-node' as const,
    accessMode: 'tunnel' as const,
    publicUrl: 'http://preview.local/',
    previewHost: 'preview.local',
    sourceAppUrl: 'http://127.0.0.1:3000/',
    additionalSourceAppUrls: [],
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    share: { enabled: false },
  }

  assert.equal(shouldReconnectRestoredWorkspacePreview({
    ...basePreview,
    status: 'active',
    tunnelClientStatus: 'open',
  }), false)
  assert.equal(shouldReconnectRestoredWorkspacePreview({
    ...basePreview,
    executionSurface: 'managed-cloud',
    accessMode: 'public-proxy',
    status: 'active',
    tunnelClientStatus: undefined,
  }), false)
  assert.equal(shouldReconnectRestoredWorkspacePreview({
    ...basePreview,
    status: 'waiting_tunnel',
    tunnelClientStatus: 'closed',
  }), true)
  assert.equal(shouldReconnectRestoredWorkspacePreview({
    ...basePreview,
    status: 'closed',
    tunnelClientStatus: 'closed',
  }), false)
})

test('canOpenWorkspacePreviewInBrowser permits public direct URLs without a Preview session', () => {
  assert.equal(canOpenWorkspacePreviewInBrowser({
    preview: null,
    options: { transport: 'public-direct' },
  }), true)
})

test('canOpenWorkspacePreviewInBrowser retains the Preview connection guard for other transports', () => {
  assert.equal(canOpenWorkspacePreviewInBrowser({ preview: null }), false)
  assert.equal(canOpenWorkspacePreviewInBrowser({
    preview: buildPreview('workspace-1', 'preview-1'),
  }), true)
})
