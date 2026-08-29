import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSelectedContextItemsFromRefs, extractWorkspaceContextRefs, mergeTaskChatContextRefs } from './workspace-session-chat-context-refs'

test('extractWorkspaceContextRefs collects workspace file refs from @paths', () => {
  const result = extractWorkspaceContextRefs({
    input: '看看 @apps/web/src/lib/i18n/react.ts 和 @./README.md',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
  })

  assert.equal(result.message, '看看 @apps/web/src/lib/i18n/react.ts 和 @./README.md')
  assert.deepEqual(result.contextRefs, [
    {
      kind: 'workspace_file',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
      path: 'apps/web/src/lib/i18n/react.ts',
    },
    {
      kind: 'workspace_file',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
      path: './README.md',
    },
  ])
})

test('extractWorkspaceContextRefs collects project refs from @项目 tokens', () => {
  const result = extractWorkspaceContextRefs({
    input: '先结合 @项目 看一下这里的结构',
    projectId: 'project-1',
  })

  assert.equal(result.message, '先结合 @项目 看一下这里的结构')
  assert.deepEqual(result.contextRefs, [
    {
      kind: 'project',
      projectId: 'project-1',
    },
  ])
})

test('extractWorkspaceContextRefs de-duplicates repeated project tokens', () => {
  const result = extractWorkspaceContextRefs({
    input: '@项目 帮我总结一下，再结合 @project 给个建议',
    projectId: 'project-1',
  })

  assert.equal(result.message, '@项目 帮我总结一下，再结合 @project 给个建议')
  assert.deepEqual(result.contextRefs, [
    {
      kind: 'project',
      projectId: 'project-1',
    },
  ])
})

test('extractWorkspaceContextRefs collects named project refs from inline mentions', () => {
  const result = extractWorkspaceContextRefs({
    input: '顺手对比一下 @Other Project 的实现',
    projectId: 'project-1',
    projects: [{
      id: 'project-2',
      name: 'Other Project',
    }],
  })

  assert.equal(result.message, '顺手对比一下 @Other Project 的实现')
  assert.deepEqual(result.contextRefs, [
    {
      kind: 'project',
      projectId: 'project-2',
    },
  ])
})

test('buildSelectedContextItemsFromRefs creates display items for project and workspace files', () => {
  const result = buildSelectedContextItemsFromRefs({
    refs: [
      {
        kind: 'project',
        projectId: 'project-1',
      },
      {
        kind: 'workspace_file',
        workspaceId: 'workspace-1',
        workspaceSessionId: 'session-1',
        path: './apps/web/src/routes/workspace.tsx',
      },
    ],
    project: {
      id: 'project-1',
      name: 'Wemux',
      gitUrl: 'https://github.com/example/wemux',
      defaultBranch: 'dev',
      color: '#34d399',
    } as never,
    workspacePath: '/Users/x/work/Vibemux',
  })

  assert.deepEqual(result.map((item: { kind: string; label: string; meta: string }) => ({
    kind: item.kind,
    label: item.label,
    meta: item.meta,
  })), [
    {
      kind: 'project',
      label: 'Wemux',
      meta: '/Users/x/work/Vibemux · https://github.com/example/wemux · dev',
    },
    {
      kind: 'workspace_file',
      label: 'workspace.tsx',
      meta: 'apps/web/src/routes · ./apps/web/src/routes/workspace.tsx',
    },
  ])
})

test('buildSelectedContextItemsFromRefs resolves project refs from available projects', () => {
  const result = buildSelectedContextItemsFromRefs({
    refs: [
      {
        kind: 'project',
        projectId: 'project-2',
      },
    ],
    project: {
      id: 'project-1',
      name: 'Current Project',
      gitUrl: 'https://github.com/example/current',
      defaultBranch: 'dev',
      color: '#34d399',
    } as never,
    projects: [
      {
        id: 'project-2',
        name: 'mastra_shopping_agent',
        gitUrl: 'https://github.com/example/mastra-shopping-agent',
        defaultBranch: 'main',
        color: '#ec4899',
      } as never,
    ],
  })

  assert.deepEqual(result.map((item: { kind: string; label: string; meta: string }) => ({
    kind: item.kind,
    label: item.label,
    meta: item.meta,
  })), [
    {
      kind: 'project',
      label: 'mastra_shopping_agent',
      meta: 'https://github.com/example/mastra-shopping-agent · main',
    },
  ])
})

test('mergeTaskChatContextRefs de-duplicates selected refs and parsed refs', () => {
  const result = mergeTaskChatContextRefs(
    [{
      kind: 'project',
      projectId: 'project-1',
    }],
    [{
      kind: 'project',
      projectId: 'project-1',
    }, {
      kind: 'workspace_file',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
      path: './README.md',
    }],
  )

  assert.deepEqual(result, [
    {
      kind: 'project',
      projectId: 'project-1',
    },
    {
      kind: 'workspace_file',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
      path: './README.md',
    },
  ])
})
