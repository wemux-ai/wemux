import { strict as assert } from 'node:assert'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_AGENT_SETTINGS } from '@shared/agent-config'

test('workspace create panel shows Codex runtime settings control', async () => {
  ;(globalThis as typeof globalThis & { __APP_VERSION__?: string }).__APP_VERSION__ = 'test'
  const { WorkspacesCreatePanel } = await import('./workspaces-create-panel')

  const html = renderToStaticMarkup(
    <WorkspacesCreatePanel
      busy={false}
      agentSettings={DEFAULT_AGENT_SETTINGS}
      createState={{
        projectSource: 'existing',
        projectId: 'project-1',
        executorId: 'executor-1',
        agentType: 'Codex',
        executionModel: '',
        workingDirectoryMode: 'worktree',
        autoCommitEnabled: true,
        name: '',
        initialPrompt: '',
        images: [],
        busy: false,
        creatingStep: '',
        branchOptions: ['master'],
        branchLoading: false,
        selectedBranch: 'master',
        branchMessage: '',
        defaultBranch: 'master',
        branchVersionControl: 'git-remote',
        githubInstallationId: '',
        githubRepositoryId: '',
        githubRepositoryName: '',
        githubRepositoryCloneUrl: '',
        githubRepositoryDefaultBranch: '',
      }}
      defaultModel="gpt-5.4"
      executorOptions={[{
        executorId: 'executor-1',
        machineId: 'machine-1',
        name: 'Mac-mini',
        machineName: 'Mac-mini',
        ownerUserId: 'user-1',
        visibility: 'private',
        status: 'online',
        workspaceRoot: '/tmp',
        maxConcurrency: 1,
        capabilities: [],
        labels: [],
        createdAt: '2026-06-08T00:00:00.000Z',
      }]}
      githubAppConfigured
      githubAppInstallations={[]}
      githubRepositories={[]}
      githubRepositoriesLoading={false}
      modelLoading={false}
      modelOptions={[{
        id: 'codex/gpt-5.4',
        label: 'codex/gpt-5.4',
        providerId: 'codex',
        modelId: 'gpt-5.4',
        isDefault: true,
      }]}
      projects={[{
        id: 'project-1',
        name: 'wemux',
        gitUrl: 'https://example.com/wemux.git',
        defaultBranch: 'master',
        versionControl: 'git-remote',
        createdAt: '2026-06-08T00:00:00.000Z',
        updatedAt: '2026-06-08T00:00:00.000Z',
      }]}
      onCancel={() => {}}
      onCreate={async () => {}}
      onUpdate={() => {}}
    />,
  )

  assert.match(html, /思考强度：medium；摘要模式：auto/)
  assert.match(html, /执行权限：可写/)
  assert.match(html, /wemux/)
  assert.match(html, /Mac-mini/)
})
