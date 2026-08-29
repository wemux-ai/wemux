import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkspaceEnvironmentStatusSnapshot } from '@shared/task-environment'
import type { WorkspaceListItem } from './workspaces-page-utils'
import {
  filterWorkspaceProjectGroups,
  invertVisibleProjectIds,
  sortWorkspaceListItemsByRecentActivity,
  toggleSelectAllVisibleProjectIds,
  WorkspaceListCard,
  WorkspacesListPanel,
  resolveWorkspaceEnvironmentBadge,
  resolveWorkspaceListTerminalOpen,
  resolveWorkspaceListPreviewPorts,
} from './workspaces-list-panel'

const buildEnvironmentStatus = (status: WorkspaceEnvironmentStatusSnapshot['status']): WorkspaceEnvironmentStatusSnapshot => ({
  status,
  message: `status:${status}`,
  checkedAt: '2026-05-25T00:00:00.000Z',
})

test('does not show dev running badge from probe status alone', () => {
  const badge = resolveWorkspaceEnvironmentBadge({
    environmentStartCommandRunning: false,
    environmentStatus: buildEnvironmentStatus('running'),
  })

  assert.equal(badge, null)
})

test('shows dev running badge only after workspace terminal environment start is tracked', () => {
  const badge = resolveWorkspaceEnvironmentBadge({
    environmentStartCommandRunning: true,
    environmentStatus: buildEnvironmentStatus('running'),
  })

  assert.equal(badge?.defaultValue, 'Dev 运行中')
})

test('keeps startup badge when the workspace terminal has launched dev but probe is not ready yet', () => {
  const badge = resolveWorkspaceEnvironmentBadge({
    environmentStartCommandRunning: true,
    environmentStatus: buildEnvironmentStatus('starting'),
  })

  assert.equal(badge?.defaultValue, 'Dev 启动中')
})

test('shows stopping badge instead of started badge while environment is stopping', () => {
  const badge = resolveWorkspaceEnvironmentBadge({
    environmentStartCommandRunning: true,
    environmentStatus: buildEnvironmentStatus('stopping'),
  })

  assert.equal(badge?.defaultValue, 'Dev 停止中')
})

test('uses optimistic terminal-open state only for the selected workspace row', () => {
  assert.equal(resolveWorkspaceListTerminalOpen({
    localTerminalOpen: true,
    runtimeTerminal: undefined,
    selected: true,
  }), true)

  assert.equal(resolveWorkspaceListTerminalOpen({
    localTerminalOpen: true,
    runtimeTerminal: undefined,
    selected: false,
  }), false)
})

test('keeps terminal-open badge when runtime reports an open terminal', () => {
  assert.equal(resolveWorkspaceListTerminalOpen({
    localTerminalOpen: false,
    runtimeTerminal: {
      status: 'open',
      sessionCount: 1,
      reportedAt: new Date().toISOString(),
    },
    selected: false,
  }), true)
})

test('does not show dev running badge from runtime probe alone in workspace list rows', () => {
  const item = {
    workspace: {
      id: 'workspace-a',
      name: '登录页改造',
      status: 'active',
      updatedAt: '2026-06-12T00:00:00.000Z',
      runtimeSummary: {
        environment: buildEnvironmentStatus('running'),
      },
    } as unknown as WorkspaceListItem['workspace'],
    project: {
      id: 'project-a',
      name: 'Wemux',
    } as unknown as WorkspaceListItem['project'],
    recentActivityAt: '2026-06-12T00:00:00.000Z',
    linkedTasks: [],
    activeTask: null,
    sessionCount: 0,
    sessionPreviews: [],
    runningCount: 0,
    unreadCount: 0,
    errorCount: 0,
    baseBranch: 'main',
    worktreeLabel: '原始目录',
    worktreeStatusLabel: '复用',
  } as unknown as WorkspaceListItem

  const html = renderToStaticMarkup(
    React.createElement(WorkspacesListPanel, {
      activeFilteredItems: [item],
      archivedFilteredItems: [],
      environmentStartCommandRunningWorkspaceIds: {},
      projects: [item.project],
      visibleProjectIds: null,
      searchQuery: '',
      selectedWorkspaceId: item.workspace.id,
      onCreate: () => {},
      onCreateForProject: () => {},
      onEditProject: () => {},
      onVisibleProjectIdsChange: () => {},
      onSearchChange: () => {},
      onSelectWorkspace: () => {},
    }),
  )

  assert.doesNotMatch(html, /Dev 运行中/)
})

test('shows preview badge as note and port in workspace list rows', () => {
  const item = {
    workspace: {
      id: 'workspace-preview',
      name: '预览工作区',
      status: 'active',
      updatedAt: '2026-06-12T00:00:00.000Z',
    } as unknown as WorkspaceListItem['workspace'],
    project: {
      id: 'project-a',
      name: 'Wemux',
    } as unknown as WorkspaceListItem['project'],
    recentActivityAt: '2026-06-12T00:00:00.000Z',
    linkedTasks: [],
    activeTask: null,
    sessionCount: 0,
    sessionPreviews: [],
    runningCount: 0,
    unreadCount: 0,
    errorCount: 0,
    baseBranch: 'main',
    worktreeLabel: '原始目录',
    worktreeStatusLabel: '复用',
    previewSummary: {
      previewId: 'preview-3000',
      remoteTransport: 'tunnel',
      sources: [{
        publicUrl: 'https://preview-3000.wemux.xyz/',
        previewHost: 'preview-3000.wemux.xyz',
        appUrl: 'http://127.0.0.1:3000/',
        port: 3000,
        note: 'Web',
        primary: true,
      }],
    },
  } as unknown as WorkspaceListItem

  const html = renderToStaticMarkup(
    React.createElement(WorkspacesListPanel, {
      activeFilteredItems: [item],
      archivedFilteredItems: [],
      environmentStartCommandRunningWorkspaceIds: {},
      projects: [item.project],
      visibleProjectIds: null,
      searchQuery: '',
      selectedWorkspaceId: item.workspace.id,
      onCreate: () => {},
      onCreateForProject: () => {},
      onEditProject: () => {},
      onVisibleProjectIdsChange: () => {},
      onSearchChange: () => {},
      onSelectWorkspace: () => {},
    }),
  )

  assert.match(html, /Web:3000/)
})

test('shared workspace cards show creator avatar and active runtime signals without count or idle labels', () => {
  const item = {
    workspace: {
      id: 'workspace-agent',
      name: '任务协作工作区',
      status: 'ready',
      updatedAt: '2026-07-23T00:00:00.000Z',
    } as unknown as WorkspaceListItem['workspace'],
    project: {
      id: 'project-a',
      name: 'Wemux',
    } as unknown as WorkspaceListItem['project'],
    creatorProfile: {
      id: 'agent-research',
      type: 'agent',
      name: 'Research Agent',
    },
    activePresenceUsers: [{
      workspaceId: 'workspace-agent',
      userId: 'user-viewer',
      name: 'Current Viewer',
      state: 'viewing',
      lastSeenAt: '2026-07-23T00:00:00.000Z',
    }],
    recentActivityAt: '2026-07-23T00:00:00.000Z',
    linkedTasks: [],
    activeTask: null,
    sessionCount: 2,
    sessionPreviews: [
      {
        id: 'session-running',
        title: '正在实现共享卡片',
        tone: 'running',
        badgeLabel: '运行中',
      },
      {
        id: 'session-idle',
        title: '已完成需求梳理',
        tone: 'idle',
      },
    ],
    runningCount: 1,
    unreadCount: 0,
    errorCount: 0,
    runningTargetWorkspaceSessionId: 'session-running',
    baseBranch: 'dev',
    worktreeLabel: 'codex/task-workspace-card',
    worktreeStatusLabel: '已创建',
    currentExecutorDisplayName: 'MBP',
    currentExecutorStatusTone: 'online',
  } as WorkspaceListItem

  const html = renderToStaticMarkup(
    React.createElement(WorkspaceListCard, {
      item,
      onSelect: () => {},
    }),
  )

  assert.match(html, /Research Agent/)
  assert.match(html, /Current Viewer/)
  assert.ok(html.indexOf('Current Viewer') < html.indexOf('Research Agent'))
  assert.match(html, /正在实现共享卡片/)
  assert.match(html, /已完成需求梳理/)
  assert.doesNotMatch(html, /2 个会话|2 sessions/)
  assert.match(html, /运行中|Running/)
  assert.doesNotMatch(html, /class="rounded-md px-1\.5 py-0\.5 text-\[10px\] font-medium bg-sky-500\/10 text-sky-300"/)
  assert.match(html, /data-workspace-session-target="running"/)
})

test('shared workspace cards hide idle status labels', () => {
  const item = {
    workspace: {
      id: 'workspace-idle',
      name: '空闲工作区',
      status: 'ready',
      updatedAt: '2026-07-23T00:00:00.000Z',
    } as unknown as WorkspaceListItem['workspace'],
    project: {
      id: 'project-a',
      name: 'Wemux',
    } as unknown as WorkspaceListItem['project'],
    creatorProfile: {
      id: 'user-owner',
      type: 'user',
      name: 'May',
    },
    activePresenceUsers: [],
    recentActivityAt: '2026-07-23T00:00:00.000Z',
    linkedTasks: [],
    activeTask: null,
    sessionCount: 1,
    sessionPreviews: [{
      id: 'session-idle',
      title: '空闲会话',
      tone: 'idle',
    }],
    runningCount: 0,
    unreadCount: 0,
    errorCount: 0,
    baseBranch: 'dev',
    worktreeLabel: 'codex/idle',
    worktreeStatusLabel: '已创建',
  } as WorkspaceListItem

  const html = renderToStaticMarkup(
    React.createElement(WorkspaceListCard, {
      item,
      onSelect: () => {},
    }),
  )

  assert.match(html, /空闲会话/)
  assert.match(html, /(工作目录：|Worktree: )codex\/idle/)
  assert.doesNotMatch(html, />空闲<|>Idle</)
  assert.doesNotMatch(html, /1 个会话|1 session/)
})

test('shows archived workspace section from summary count before archived items are loaded', () => {
  const project = {
    id: 'project-a',
    name: 'Wemux',
  } as unknown as WorkspaceListItem['project']

  const html = renderToStaticMarkup(
    React.createElement(WorkspacesListPanel, {
      activeFilteredItems: [],
      archivedFilteredItems: [],
      archivedWorkspaceCount: 3,
      environmentStartCommandRunningWorkspaceIds: {},
      projects: [project],
      visibleProjectIds: null,
      searchQuery: '',
      selectedWorkspaceId: '',
      onCreate: () => {},
      onCreateForProject: () => {},
      onEditProject: () => {},
      onVisibleProjectIdsChange: () => {},
      onSearchChange: () => {},
      onSelectWorkspace: () => {},
    }),
  )

  assert.match(html, /已归档工作区/)
  assert.match(html, />3</)
})

test('workspace list retains configured preview ports', () => {
  const previewPorts = resolveWorkspaceListPreviewPorts([
      {
        url: 'https://preview-3000.wemux.xyz/',
        appUrl: 'http://127.0.0.1:3000/',
        host: 'preview-3000.wemux.xyz',
        port: 3000,
        note: 'Web',
        transport: 'tunnel',
        transportLabel: '隧道预览域名',
      },
      {
        url: 'https://preview-4111.wemux.xyz/',
        appUrl: 'http://127.0.0.1:4111/',
        host: 'preview-4111.wemux.xyz',
        port: 4111,
        note: 'Mastra',
        transport: 'tunnel',
        transportLabel: '隧道预览域名',
      },
  ])

  assert.deepEqual(previewPorts.map((port) => port.port), [3000, 4111])
})

test('keeps empty projects visible when project display filter is all', () => {
  const groups = [
    { project: { id: 'project-a' }, items: [{ id: 'workspace-a' }] },
    { project: { id: 'project-b' }, items: [] },
  ]

  assert.deepEqual(filterWorkspaceProjectGroups(groups, null), groups)
})

test('shows only checked projects in the project visibility filter', () => {
  const groups = [
    { project: { id: 'project-a' }, items: [{ id: 'workspace-a' }] },
    { project: { id: 'project-b' }, items: [] },
  ]

  assert.deepEqual(filterWorkspaceProjectGroups(groups, ['project-a']), [
    { project: { id: 'project-a' }, items: [{ id: 'workspace-a' }] },
  ])
})

test('sortWorkspaceListItemsByRecentActivity keeps newest workspaces first across projects', () => {
  const items = [
    {
      recentActivityAt: '2026-06-10T00:00:00.000Z',
      workspace: {
        id: 'workspace-a',
        name: 'A',
        updatedAt: '2026-06-10T00:00:00.000Z',
      },
    },
    {
      recentActivityAt: '2026-06-12T00:00:00.000Z',
      workspace: {
        id: 'workspace-b',
        name: 'B',
        updatedAt: '2026-06-12T00:00:00.000Z',
      },
    },
    {
      recentActivityAt: '2026-06-11T00:00:00.000Z',
      workspace: {
        id: 'workspace-c',
        name: 'C',
        updatedAt: '2026-06-11T00:00:00.000Z',
      },
    },
  ] as WorkspaceListItem[]

  assert.deepEqual(
    sortWorkspaceListItemsByRecentActivity(items).map((item) => item.workspace.id),
    ['workspace-b', 'workspace-c', 'workspace-a'],
  )
})

test('sortWorkspaceListItemsByRecentActivity prefers recent session activity over stale workspace updatedAt', () => {
  const items = [
    {
      recentActivityAt: '2026-06-12T00:00:00.000Z',
      workspace: {
        id: 'workspace-a',
        name: 'A',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    },
    {
      recentActivityAt: '2026-06-11T00:00:00.000Z',
      workspace: {
        id: 'workspace-b',
        name: 'B',
        updatedAt: '2026-06-20T00:00:00.000Z',
      },
    },
  ] as WorkspaceListItem[]

  assert.deepEqual(
    sortWorkspaceListItemsByRecentActivity(items).map((item) => item.workspace.id),
    ['workspace-a', 'workspace-b'],
  )
})

test('grouped workspace list sorting can reuse recent activity ordering within a project', () => {
  const items = [
    {
      recentActivityAt: '2026-06-12T00:00:00.000Z',
      workspace: {
        id: 'workspace-a',
        name: 'A',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    },
    {
      recentActivityAt: '2026-06-11T00:00:00.000Z',
      workspace: {
        id: 'workspace-b',
        name: 'B',
        updatedAt: '2026-06-20T00:00:00.000Z',
      },
    },
  ] as WorkspaceListItem[]

  assert.deepEqual(
    sortWorkspaceListItemsByRecentActivity(items).map((item) => item.workspace.id),
    ['workspace-a', 'workspace-b'],
  )
})

test('toggleSelectAllVisibleProjectIds selects all projects when some are hidden', () => {
  const projects = [
    { id: 'project-a' },
    { id: 'project-b' },
    { id: 'project-c' },
  ] as WorkspaceListItem['project'][]

  assert.equal(toggleSelectAllVisibleProjectIds(projects, ['project-a']), null)
})

test('toggleSelectAllVisibleProjectIds inverts selection when all projects are selected', () => {
  const projects = [
    { id: 'project-a' },
    { id: 'project-b' },
    { id: 'project-c' },
  ] as WorkspaceListItem['project'][]

  assert.deepEqual(toggleSelectAllVisibleProjectIds(projects, null), [])
})

test('invertVisibleProjectIds returns the complement of the current selection', () => {
  const projects = [
    { id: 'project-a' },
    { id: 'project-b' },
    { id: 'project-c' },
  ] as WorkspaceListItem['project'][]

  assert.deepEqual(invertVisibleProjectIds(projects, ['project-a', 'project-c']), ['project-b'])
})
