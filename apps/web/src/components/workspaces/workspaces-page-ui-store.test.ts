import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getWorkspacesPageUiStateForTests,
  openWorkspaceTab,
  rememberWorkspaceTabRoute,
  resetWorkspacesPageUiStoreForTests,
  setWorkspacePrimaryView,
} from './workspaces-page-ui-store'

const readOpenWorkspaceTabs = () => getWorkspacesPageUiStateForTests().openWorkspaceTabs

test('openWorkspaceTab clears a remembered session when explicitly passed undefined', () => {
  resetWorkspacesPageUiStoreForTests()

  openWorkspaceTab({
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    workspaceSessionId: 'session-1',
  })
  openWorkspaceTab({
    workspaceId: 'workspace-1',
    workspaceSessionId: undefined,
  })

  const [tab] = readOpenWorkspaceTabs()
  assert.equal(tab?.workspaceId, 'workspace-1')
  assert.equal(tab?.projectId, 'project-1')
  assert.equal(tab?.workspaceSessionId, undefined)
})

test('rememberWorkspaceTabRoute clears a remembered session when explicitly passed undefined', () => {
  resetWorkspacesPageUiStoreForTests()

  openWorkspaceTab({
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    workspaceSessionId: 'session-1',
  })
  rememberWorkspaceTabRoute('workspace-1', {
    workspaceSessionId: undefined,
  })

  const [tab] = readOpenWorkspaceTabs()
  assert.equal(tab?.workspaceSessionId, undefined)
  assert.equal(tab?.projectId, 'project-1')
})

test('rememberWorkspaceTabRoute preserves existing fields when they are omitted', () => {
  resetWorkspacesPageUiStoreForTests()

  openWorkspaceTab({
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    workspaceSessionId: 'session-1',
  })
  rememberWorkspaceTabRoute('workspace-1', {
    projectId: 'project-2',
  })

  const [tab] = readOpenWorkspaceTabs()
  assert.equal(tab?.projectId, 'project-2')
  assert.equal(tab?.workspaceSessionId, 'session-1')
})

test('setWorkspacePrimaryView retains every visited panel per workspace', () => {
  resetWorkspacesPageUiStoreForTests()

  setWorkspacePrimaryView('workspace-1', 'files')
  setWorkspacePrimaryView('workspace-1', 'git')
  setWorkspacePrimaryView('workspace-1', 'files')
  setWorkspacePrimaryView('workspace-2', 'preview')

  const state = getWorkspacesPageUiStateForTests()
  assert.deepEqual(state.visitedPrimaryViewsByWorkspaceId['workspace-1'], ['files', 'git'])
  assert.deepEqual(state.visitedPrimaryViewsByWorkspaceId['workspace-2'], ['preview'])
})
