import assert from 'node:assert/strict'
import test from 'node:test'
import type { PreviewSessionDto } from '@shared/types'
import { isWorkspacePreviewConnected } from './workspace-preview-status'

const basePreview: PreviewSessionDto = {
  previewId: 'preview-1',
  purpose: 'app',
  projectId: 'project-1',
  taskId: 'task-1',
  workspaceId: 'workspace-1',
  workspaceSessionId: 'workspace-session-1',
  executorId: 'executor-1',
  executionSurface: 'private-node',
  accessMode: 'tunnel',
  status: 'active',
  publicUrl: 'https://preview.wemux.xyz/',
  previewHost: 'preview.wemux.xyz',
  sourceAppUrl: 'http://127.0.0.1:3000/',
  additionalSourceAppUrls: [],
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  share: { enabled: false },
}

test('isWorkspacePreviewConnected treats tunnel previews as connected only when the tunnel is open', () => {
  assert.equal(isWorkspacePreviewConnected({
    ...basePreview,
    accessMode: 'tunnel',
    tunnelClientStatus: 'open',
  }), true)

  assert.equal(isWorkspacePreviewConnected({
    ...basePreview,
    accessMode: 'tunnel',
    tunnelClientStatus: 'closed',
  }), false)
})

test('isWorkspacePreviewConnected treats active public-proxy previews as connected without a tunnel client', () => {
  assert.equal(isWorkspacePreviewConnected({
    ...basePreview,
    executionSurface: 'managed-cloud',
    accessMode: 'public-proxy',
    tunnelClientStatus: undefined,
  }), true)

  assert.equal(isWorkspacePreviewConnected({
    ...basePreview,
    executionSurface: 'managed-cloud',
    accessMode: 'public-proxy',
    status: 'waiting_tunnel',
    tunnelClientStatus: undefined,
  }), false)
})
