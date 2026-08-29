import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildWorkspacePanelUiScopeKey,
  readWorkspacePanelUiState,
  resetWorkspacePanelUiStoreForTests,
  updateWorkspacePanelUiState,
} from './workspace-panel-ui-store'

test('panel UI state is isolated by workspace, session, and panel', () => {
  resetWorkspacePanelUiStoreForTests()
  const filesScope = buildWorkspacePanelUiScopeKey({ workspaceId: 'workspace-1', workspaceSessionId: 'session-1', panel: 'files' })
  const otherSessionScope = buildWorkspacePanelUiScopeKey({ workspaceId: 'workspace-1', workspaceSessionId: 'session-2', panel: 'files' })

  updateWorkspacePanelUiState(filesScope, 'files', {
    expandedDirectories: ['/repo/src'],
    selectedFilePath: '/repo/src/app.ts',
    fileSearchQuery: '',
    contentSearchQuery: '',
    editMode: true,
    editorContent: 'draft',
    lastSavedContent: 'saved',
    scrollTopByRegion: {},
  })

  assert.equal(readWorkspacePanelUiState(filesScope, 'files')?.editorContent, 'draft')
  assert.equal(readWorkspacePanelUiState(otherSessionScope, 'files'), undefined)
})
