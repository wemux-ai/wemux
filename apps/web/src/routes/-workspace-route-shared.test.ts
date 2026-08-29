import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWorkspaceRouteSearch,
  buildWorkspacesRouteSearch,
  resolvePreviewSourceDirectAccess,
  resolvePreviewUrlAddressSpace,
  resolveWorkspacePrimaryViewForWorkspace,
  shouldRunEnvironmentStartInTerminal,
  shouldShowEnvironmentLogsCommand,
  shouldShowEnvironmentStopCommand,
} from './-workspace-route-shared'

test('keeps create mode for a pure workspace-create route', () => {
  assert.deepEqual(
    buildWorkspaceRouteSearch({
      create: '1',
      projectId: 'project-1',
    }),
    {
      projectId: 'project-1',
      taskId: undefined,
      workspaceId: undefined,
      workspaceSessionId: undefined,
      launchId: undefined,
      autoEnvironmentInstall: undefined,
      panel: undefined,
      terminal: undefined,
      mobileView: undefined,
      create: '1',
    },
  )
})

test('drops create mode when the route already targets a workspace detail', () => {
  assert.deepEqual(
    buildWorkspaceRouteSearch({
      create: '1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
      taskId: 'task-1',
    }),
    {
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
      launchId: undefined,
      autoEnvironmentInstall: undefined,
      panel: undefined,
      terminal: undefined,
      mobileView: undefined,
      create: undefined,
    },
  )
})

test('drops a session runtime id from the route task field', () => {
  const search = buildWorkspaceRouteSearch({
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    taskId: 'session-1',
  })

  assert.equal(search.taskId, undefined)
  assert.equal(search.workspaceSessionId, 'session-1')
})

test('keeps the workspaces page taskless even for a real task id', () => {
  const search = buildWorkspacesRouteSearch({
    projectId: 'project-1',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
  })

  assert.equal(search.taskId, undefined)
  assert.equal(search.workspaceSessionId, 'session-1')
})

test('keeps an explicit route panel on first load before any workspace switch happens', () => {
  assert.equal(
    resolveWorkspacePrimaryViewForWorkspace({
      previousWorkspaceId: '',
      routePanel: 'preview',
      savedPrimaryView: undefined,
      workspaceId: 'workspace-1',
    }),
    'preview',
  )
})

test('does not inherit the previous workspace panel when opening a new workspace for the first time', () => {
  assert.equal(
    resolveWorkspacePrimaryViewForWorkspace({
      previousWorkspaceId: 'workspace-1',
      routePanel: 'preview',
      savedPrimaryView: undefined,
      workspaceId: 'workspace-2',
    }),
    'chat',
  )
})

test('prefers the saved workspace-specific panel when it exists', () => {
  assert.equal(
    resolveWorkspacePrimaryViewForWorkspace({
      previousWorkspaceId: 'workspace-1',
      routePanel: 'preview',
      savedPrimaryView: 'files',
      workspaceId: 'workspace-2',
    }),
    'files',
  )
})

test('classifies preview urls by browser address space', () => {
  assert.equal(resolvePreviewUrlAddressSpace('http://127.0.0.1:3005/'), 'local')
  assert.equal(resolvePreviewUrlAddressSpace('http://app.wemux.localtest.me:15173/workspace'), 'local')
  assert.equal(resolvePreviewUrlAddressSpace('http://192.168.2.11:3005/'), 'private')
  assert.equal(resolvePreviewUrlAddressSpace('https://wemux.xyz/workspace'), 'public')
})

test('blocks direct preview source access when the current page is less private than the source url', () => {
  assert.deepEqual(
    resolvePreviewSourceDirectAccess({
      currentPageUrl: 'https://wemux.xyz/workspace',
      sourceUrl: 'http://127.0.0.1:3005/',
    }),
    {
      allowed: false,
      currentAddressSpace: 'public',
      sourceAddressSpace: 'local',
    },
  )

  assert.deepEqual(
    resolvePreviewSourceDirectAccess({
      currentPageUrl: 'http://app.wemux.localtest.me:15173/workspace',
      sourceUrl: 'http://127.0.0.1:3005/',
    }),
    {
      allowed: true,
      currentAddressSpace: 'local',
      sourceAddressSpace: 'local',
    },
  )
})

test('runs configured workspace environment commands through the terminal controls', () => {
  const preview = {
    startCommand: 'COMPOSE_PROJECT_NAME=demo docker compose up --build',
    stopCommand: 'COMPOSE_PROJECT_NAME=demo docker compose down',
    logsCommand: 'COMPOSE_PROJECT_NAME=demo docker compose logs -f',
  }

  assert.equal(shouldRunEnvironmentStartInTerminal(preview), true)
  assert.equal(shouldShowEnvironmentStopCommand(preview), true)
  assert.equal(shouldShowEnvironmentLogsCommand(preview), true)
})

test('keeps terminal stop and logs controls available for long-running start commands without explicit helpers', () => {
  const preview = {
    startCommand: 'pnpm dev',
  }

  assert.equal(shouldRunEnvironmentStartInTerminal(preview), true)
  assert.equal(shouldShowEnvironmentStopCommand(preview), true)
  assert.equal(shouldShowEnvironmentLogsCommand(preview), true)
})
