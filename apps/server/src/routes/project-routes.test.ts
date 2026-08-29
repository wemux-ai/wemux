import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { ExecutorRecord, LocalPathProbeResult, Project } from '@shared/types'
import { buildWorkspaceProjectRootPath } from '@shared/workspace-paths'
import { executorRegistry } from '../control-plane/executor-registry'
import { executorWsService } from '../control-plane/executor-ws-service'
import { addUserProject, createToken } from '../repositories/auth'
import { getProjectRuntimeEnvironmentDetail, saveProjectRuntimeEnvironmentConfig } from '../services/runtime-environment-service'
import { resetState, saveProject, loadState } from '../storage/app-state-store'
import { listProjectBindings, resetClusterData, saveWorkspace } from '../storage/distributed-task-store'
import { closePostgres } from '../storage/postgres/db'
import { createProjectRecord } from './project-route-shared'
import { registerProjectRoutes } from './project-routes'

const requireAuth: MiddlewareHandler = async (_c, next) => {
  await next()
}

const createApp = () => {
  const app = new Hono()
  registerProjectRoutes(app, requireAuth)
  return app
}

const createProjectUpdatePayload = (project: Project, override: Partial<{
  name: string
  gitUrl: string
  color: string
  workspaceId: string
  visibility: 'private' | 'workspace'
  rootPath: string
  versionControl: 'none' | 'git-local' | 'git-remote'
  defaultBranch: string
  preferredExecutorId: string
}> = {}) => ({
  name: override.name ?? project.name,
  gitUrl: override.gitUrl ?? project.gitUrl,
  color: override.color ?? project.color ?? '#43dba8',
  workspaceId: override.workspaceId ?? project.workspaceId,
  visibility: override.visibility ?? project.visibility,
  rootPath: override.rootPath ?? project.rootPath,
  versionControl: override.versionControl ?? project.versionControl,
  defaultBranch: override.defaultBranch ?? project.defaultBranch,
  preferredExecutorId: override.preferredExecutorId ?? project.preferredExecutorId,
})

const withSuppressedPostgresErrors = async <T>(action: () => Promise<T> | T) => {
  const originalConsoleError = console.error
  const originalConsoleWarn = console.warn
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[postgres]')) {
      return
    }
    originalConsoleError(...args)
  }
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[project-routes] delete project directory failed')) {
      return
    }
    originalConsoleWarn(...args)
  }

  try {
    return await action()
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0))
    console.error = originalConsoleError
    console.warn = originalConsoleWarn
  }
}

test.after(async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()
    await closePostgres()
  })
})

test('project creation persists before returning state', async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const userId = `user-${crypto.randomUUID()}`
    const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'vibemux-project-create-'))
    const app = createApp()
    const response = await app.request('/api/projects', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${createToken(userId)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `create-persisted-${Date.now()}`,
        gitUrl: '',
        rootPath: projectRoot,
        visibility: 'private',
      }),
    })

    assert.equal(response.status, 200)
    const payload = await response.json() as {
      state: {
        selectedProjectId: string
      }
    }
    assert.ok(payload.state.selectedProjectId)
    assert.ok(loadState().projects.some((project) => project.id === payload.state.selectedProjectId))
  })
})

test('create project without preferredExecutorId defers node binding', async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const userId = `user-${crypto.randomUUID()}`
    const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'vibemux-project-create-no-node-'))
    const app = createApp()
    const response = await app.request('/api/projects', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${createToken(userId)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `no-node-create-${Date.now()}`,
        gitUrl: '',
        rootPath: projectRoot,
        visibility: 'private',
      }),
    })

    assert.equal(response.status, 200)
    const payload = await response.json() as {
      message?: string
      state: {
        selectedProjectId: string
        projects: Array<{ id: string; preferredExecutorId?: string }>
      }
    }
    const createdProject = payload.state.projects.find((item) => item.id === payload.state.selectedProjectId)
    assert.ok(createdProject)
    assert.equal(createdProject.preferredExecutorId, undefined)
    assert.match(payload.message ?? '', /项目已创建/)

    const activeBindings = listProjectBindings().filter((binding) => binding.projectId === createdProject.id && binding.isActive)
    assert.equal(activeBindings.length, 0)
  })
})

test('clone project without preferredExecutorId defers node resolution', async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const userId = `user-${crypto.randomUUID()}`
    const app = createApp()
    const response = await app.request('/api/projects/clone', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${createToken(userId)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `no-node-clone-${Date.now()}`,
        gitUrl: 'https://github.com/example/no-node-clone.git',
        visibility: 'private',
      }),
    })

    assert.equal(response.status, 200)
    const payload = await response.json() as {
      message?: string
      state: {
        selectedProjectId: string
        projects: Array<{
          id: string
          preferredExecutorId?: string
          repositoryCloneStatus?: string
        }>
      }
    }
    const createdProject = payload.state.projects.find((item) => item.id === payload.state.selectedProjectId)
    assert.ok(createdProject)
    assert.equal(createdProject.preferredExecutorId, undefined)
    assert.equal(createdProject.repositoryCloneStatus, undefined)
    assert.match(payload.message ?? '', /绑定执行节点后会开始准备仓库/)

    const activeBindings = listProjectBindings().filter((binding) => binding.projectId === createdProject.id && binding.isActive)
    assert.equal(activeBindings.length, 0)
  })
})

test('delete project skips original directories instead of deleting them', async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const userId = `user-${crypto.randomUUID()}`
    const project = {
      ...createProjectRecord({
        name: `delete-fallback-${Date.now()}`,
        gitUrl: '',
        rootPath: os.homedir(),
        versionControl: 'none',
      }),
      id: `project-${crypto.randomUUID()}`,
    }

    saveProject(project)
    addUserProject(userId, project.id)

    const app = createApp()
    const response = await app.request(`/api/projects/${project.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${createToken(userId)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectName: project.name,
        deleteProjectDirectory: true,
      }),
    })

    assert.equal(response.status, 200)

    const payload = await response.json() as {
      message?: string
      state: {
        projects: Array<{ id: string }>
      }
    }

    assert.match(payload.message ?? '', /项目已删除。当前路径不是 wemux 托管目录，已跳过目录删除：/)
    assert.ok(!payload.state.projects.some((item) => item.id === project.id))
    assert.ok(!loadState().projects.some((item) => item.id === project.id))
  })
})

test('update project keeps existing workspace assignment without requiring workspace membership', async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const userId = `user-${crypto.randomUUID()}`
    const workspaceId = `workspace-${crypto.randomUUID()}`
    const project = {
      ...createProjectRecord({
        name: `workspace-project-${Date.now()}`,
        gitUrl: 'https://github.com/example/project.git',
        rootPath: '/tmp/project-root',
        workspaceId,
        visibility: 'workspace',
        versionControl: 'git-remote',
      }),
      id: `project-${crypto.randomUUID()}`,
    }

    saveProject(project)
    addUserProject(userId, project.id)

    const app = createApp()
    const response = await app.request(`/api/projects/${project.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${createToken(userId)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createProjectUpdatePayload(project, { name: `${project.name}-updated` })),
    })

    assert.equal(response.status, 200)
    const updatedProject = loadState().projects.find((item) => item.id === project.id)
    assert.equal(updatedProject?.name, `${project.name}-updated`)
    assert.equal(updatedProject?.workspaceId, workspaceId)
    assert.equal(updatedProject?.visibility, 'workspace')
  })
})

test('update project returns lightweight error when workspace assignment is invalid', async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const userId = `user-${crypto.randomUUID()}`
    const project = {
      ...createProjectRecord({
        name: `private-project-${Date.now()}`,
        gitUrl: '',
        rootPath: '/tmp/private-project-root',
        visibility: 'private',
        versionControl: 'none',
      }),
      id: `project-${crypto.randomUUID()}`,
    }

    saveProject(project)
    addUserProject(userId, project.id)

    const app = createApp()
    const response = await app.request(`/api/projects/${project.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${createToken(userId)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createProjectUpdatePayload(project, {
        workspaceId: '',
        visibility: 'workspace',
      })),
    })

    assert.equal(response.status, 400)
    const payload = await response.json() as { message?: string; state?: unknown }
    assert.equal(payload.message, '工作区共享项目必须选择 workspace。')
    assert.equal(payload.state, undefined)
  })
})

test('reimport environment template falls back to workspace repo path', async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const userId = `user-${crypto.randomUUID()}`
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'vibemux-project-template-'))
    const projectRootPath = path.join(tempRoot, 'project-root')
    const workspaceRepoPath = path.join(tempRoot, 'workspace-root')
    mkdirSync(projectRootPath, { recursive: true })
    mkdirSync(workspaceRepoPath, { recursive: true })
    writeFileSync(path.join(workspaceRepoPath, '.vibemux.yml'), [
      'environment:',
      '  install: "pnpm install"',
      '  start: "PORT={{add worktree.unique_id 3000}} pnpm dev -- --port {{add worktree.unique_id 3000}}"',
      '  appPort: "{{add worktree.unique_id 3000}}"',
      '  ports:',
      '    - id: "api"',
      '      port: "{{add worktree.unique_id 4000}}"',
      '      note: "API"',
      '',
    ].join('\n'))

    const project = {
      ...createProjectRecord({
        name: `workspace-template-${Date.now()}`,
        gitUrl: '',
        rootPath: projectRootPath,
        versionControl: 'none',
      }),
      id: `project-${crypto.randomUUID()}`,
    }

    saveProject(project)
    saveWorkspace({
      id: `workspace-${crypto.randomUUID()}`,
      projectId: project.id,
      executorNodeId: 'executor-local',
      agentType: 'Codex',
      name: 'Workspace A',
      status: 'ready',
      repoReady: true,
      repoPath: workspaceRepoPath,
      source: 'manual',
      workingDirectoryMode: 'original-dir',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    addUserProject(userId, project.id)

    const app = createApp()
    const response = await app.request(`/api/projects/${project.id}/environment-template/import`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${createToken(userId)}`,
      },
    })

    assert.equal(response.status, 200)

    const payload = await response.json() as {
      state: {
        projects: Array<{
          id: string
          environmentTemplate?: {
            installCommand?: string
            startCommandTemplate?: string
            appPort?: string
            ports?: Array<{ id: string; port: string; note?: string }>
            configPath?: string
          }
        }>
      }
    }

    const updatedProject = payload.state.projects.find((item) => item.id === project.id)
    assert.equal(updatedProject?.environmentTemplate?.installCommand, 'pnpm install')
    assert.equal(updatedProject?.environmentTemplate?.startCommandTemplate, 'PORT={{add worktree.unique_id 3000}} pnpm dev -- --port {{add worktree.unique_id 3000}}')
    assert.equal(updatedProject?.environmentTemplate?.appPort, '{{add worktree.unique_id 3000}}')
    assert.deepEqual(updatedProject?.environmentTemplate?.ports, [{
      id: 'api',
      port: '{{add worktree.unique_id 4000}}',
      note: 'API',
      type: 'generated',
    }])
    assert.equal(updatedProject?.environmentTemplate?.configPath, path.join(workspaceRepoPath, '.vibemux.yml'))
  })
})

test('reimport environment template accepts legacy .Vibemux.yml in workspace repo path', async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const userId = `user-${crypto.randomUUID()}`
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'vibemux-project-template-'))
    const projectRootPath = path.join(tempRoot, 'project-root')
    const workspaceRepoPath = path.join(tempRoot, 'workspace-root')
    mkdirSync(projectRootPath, { recursive: true })
    mkdirSync(workspaceRepoPath, { recursive: true })
    writeFileSync(path.join(workspaceRepoPath, '.Vibemux.yml'), [
      'environment:',
      '  install: "pnpm install"',
      '  start: "pnpm dev"',
      '  appPort: "3000"',
      '',
    ].join('\n'))

    const project = {
      ...createProjectRecord({
        name: `workspace-template-legacy-${Date.now()}`,
        gitUrl: '',
        rootPath: projectRootPath,
        versionControl: 'none',
      }),
      id: `project-${crypto.randomUUID()}`,
    }

    saveProject(project)
    saveWorkspace({
      id: `workspace-${crypto.randomUUID()}`,
      projectId: project.id,
      executorNodeId: 'executor-local',
      agentType: 'Codex',
      name: 'Workspace A',
      status: 'ready',
      repoReady: true,
      repoPath: workspaceRepoPath,
      source: 'manual',
      workingDirectoryMode: 'original-dir',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    addUserProject(userId, project.id)

    const app = createApp()
    const response = await app.request(`/api/projects/${project.id}/environment-template/import`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${createToken(userId)}`,
      },
    })

    assert.equal(response.status, 200)

    const payload = await response.json() as {
      state: {
        projects: Array<{
          id: string
          environmentTemplate?: {
            installCommand?: string
            startCommandTemplate?: string
            appPort?: string
            configPath?: string
          }
        }>
      }
    }

    const updatedProject = payload.state.projects.find((item) => item.id === project.id)
    assert.equal(updatedProject?.environmentTemplate?.installCommand, 'pnpm install')
    assert.equal(updatedProject?.environmentTemplate?.startCommandTemplate, 'pnpm dev')
    assert.equal(updatedProject?.environmentTemplate?.appPort, '3000')
    assert.match(
      updatedProject?.environmentTemplate?.configPath ?? '',
      new RegExp(`${workspaceRepoPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.vibemux\\.yml$`, 'i'),
    )
  })
})

test('reimport environment template accepts service-based .vibemux.yml in workspace repo path', async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const userId = `user-${crypto.randomUUID()}`
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'vibemux-project-template-'))
    const projectRootPath = path.join(tempRoot, 'project-root')
    const workspaceRepoPath = path.join(tempRoot, 'workspace-root')
    mkdirSync(projectRootPath, { recursive: true })
    mkdirSync(workspaceRepoPath, { recursive: true })
    writeFileSync(path.join(workspaceRepoPath, '.vibemux.yml'), [
      'name: shopping-agent',
      'runtime:',
      '  node: ">=22.13.0"',
      '  packageManager: pnpm@10',
      'services:',
      '  mastra:',
      '    command: "pnpm run dev"',
      '    port: 4111',
      '    healthCheck:',
      '      path: /api/health',
      '  docs:',
      '    command: "pnpm run docs"',
      '    port: 4112',
      '',
    ].join('\n'))

    const project = {
      ...createProjectRecord({
        name: `workspace-template-service-${Date.now()}`,
        gitUrl: '',
        rootPath: projectRootPath,
        versionControl: 'none',
      }),
      id: `project-${crypto.randomUUID()}`,
    }

    saveProject(project)
    saveWorkspace({
      id: `workspace-${crypto.randomUUID()}`,
      projectId: project.id,
      executorNodeId: 'executor-local',
      agentType: 'Codex',
      name: 'Workspace A',
      status: 'ready',
      repoReady: true,
      repoPath: workspaceRepoPath,
      source: 'manual',
      workingDirectoryMode: 'original-dir',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    addUserProject(userId, project.id)

    const app = createApp()
    const response = await app.request(`/api/projects/${project.id}/environment-template/import`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${createToken(userId)}`,
      },
    })

    assert.equal(response.status, 200)

    const payload = await response.json() as {
      state: {
        projects: Array<{
          id: string
          environmentTemplate?: {
            installCommand?: string
            startCommandTemplate?: string
            appPort?: string
            healthPath?: string
            ports?: Array<{ id: string; port: string; note?: string }>
            configPath?: string
          }
        }>
      }
    }

    const updatedProject = payload.state.projects.find((item) => item.id === project.id)
    assert.equal(updatedProject?.environmentTemplate?.installCommand, 'pnpm install')
    assert.equal(updatedProject?.environmentTemplate?.startCommandTemplate, 'pnpm run dev')
    assert.equal(updatedProject?.environmentTemplate?.appPort, '4111')
    assert.equal(updatedProject?.environmentTemplate?.healthPath, '/api/health')
    assert.deepEqual(updatedProject?.environmentTemplate?.ports, [{
      id: 'docs',
      port: '4112',
      note: 'docs',
      type: 'generated',
    }])
    assert.equal(updatedProject?.environmentTemplate?.configPath, path.join(workspaceRepoPath, '.vibemux.yml'))
  })
})

test('sync project settings detects git remote from workspace repo path', async (t) => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const userId = `user-${crypto.randomUUID()}`
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'vibemux-project-sync-'))
    const projectRootPath = path.join(tempRoot, 'project-root')
    const workspaceRepoPath = path.join(tempRoot, 'workspace-root')
    mkdirSync(projectRootPath, { recursive: true })
    mkdirSync(workspaceRepoPath, { recursive: true })

    const project = {
      ...createProjectRecord({
        name: `sync-git-${Date.now()}`,
        gitUrl: '',
        rootPath: projectRootPath,
        versionControl: 'none',
        preferredExecutorId: 'executor-sync',
      }),
      id: `project-${crypto.randomUUID()}`,
    }

    saveProject(project)
    saveWorkspace({
      id: `workspace-${crypto.randomUUID()}`,
      projectId: project.id,
      executorNodeId: 'executor-sync',
      agentType: 'Codex',
      name: 'Workspace A',
      status: 'ready',
      repoReady: true,
      repoPath: workspaceRepoPath,
      source: 'manual',
      workingDirectoryMode: 'original-dir',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    addUserProject(userId, project.id)

    const executor: ExecutorRecord = {
      executorId: 'executor-sync',
      machineId: 'machine-sync',
      machineName: 'Sync machine',
      name: 'Sync executor',
      ownerUserId: userId,
      visibility: 'private',
      status: 'online',
      workspaceRoot: tempRoot,
      maxConcurrency: 1,
      capabilities: [],
      labels: [],
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    }
    const listExecutorsRestore = t.mock.method(executorRegistry, 'listExecutorsWithPresence', () => [executor])
    const probeCalls: string[] = []
    const requestRepoProbeRestore = t.mock.method(
      executorWsService,
      'requestRepoProbe',
      async (_executorId: string, localPath: string): Promise<LocalPathProbeResult> => {
        probeCalls.push(localPath)
        if (localPath === workspaceRepoPath) {
          return {
            ok: true,
            path: workspaceRepoPath,
            versionControl: 'git-remote',
            gitUrl: 'https://github.com/example/sync-git.git',
            defaultBranch: 'main',
            message: '已检测到远端 Git 仓库',
          }
        }

        return {
          ok: true,
          path: localPath,
          versionControl: 'none',
          message: '目录无 Git 仓库',
        }
      },
    )
    const requestRepoBranchesRestore = t.mock.method(executorWsService, 'requestRepoBranches', async () => ({
      ok: true,
      branches: ['main', 'feature/demo'],
      defaultBranch: 'main',
      currentBranch: 'main',
    }))

    try {
      const app = createApp()
      const response = await app.request(`/api/projects/${project.id}/settings/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${createToken(userId)}`,
        },
      })

      assert.equal(response.status, 200)
      const payload = await response.json() as {
        message?: string
        state: {
          projects: Array<{
            id: string
            rootPath?: string
            gitUrl?: string
            versionControl?: string
            recentBaseBranches?: string[]
          }>
        }
      }
      const updatedProject = payload.state.projects.find((item) => item.id === project.id)

      assert.deepEqual(probeCalls.slice(0, 2), [projectRootPath, workspaceRepoPath])
      assert.equal(updatedProject?.versionControl, 'git-remote')
      assert.equal(updatedProject?.gitUrl, 'https://github.com/example/sync-git.git')
      assert.equal(updatedProject?.rootPath, workspaceRepoPath)
      assert.deepEqual(updatedProject?.recentBaseBranches, ['main', 'feature/demo'])
      assert.match(payload.message ?? '', /已识别为远端 Git 项目。/)
    } finally {
      requestRepoBranchesRestore.mock.restore()
      requestRepoProbeRestore.mock.restore()
      listExecutorsRestore.mock.restore()
    }
  })
})

test('sync project settings detects git remote from managed user project path', async (t) => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const userId = `user-${crypto.randomUUID()}`
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'vibemux-project-sync-user-root-'))
    const stalePreviewRootPath = path.join(tempRoot, 'preview-root', 'projects', 'test')
    mkdirSync(stalePreviewRootPath, { recursive: true })

    const project = {
      ...createProjectRecord({
        name: 'test',
        gitUrl: '',
        rootPath: stalePreviewRootPath,
        versionControl: 'none',
        preferredExecutorId: 'executor-sync-user-root',
      }),
      id: `project-${crypto.randomUUID()}`,
    }
    const managedUserProjectPath = buildWorkspaceProjectRootPath(tempRoot, project, undefined, userId)
    mkdirSync(managedUserProjectPath, { recursive: true })

    saveProject(project)
    addUserProject(userId, project.id)

    const executor: ExecutorRecord = {
      executorId: 'executor-sync-user-root',
      machineId: 'machine-sync-user-root',
      machineName: 'Sync user root machine',
      name: 'Sync user root executor',
      ownerUserId: userId,
      visibility: 'private',
      status: 'online',
      workspaceRoot: tempRoot,
      maxConcurrency: 1,
      capabilities: [],
      labels: [],
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    }
    const listExecutorsRestore = t.mock.method(executorRegistry, 'listExecutorsWithPresence', () => [executor])
    const probeCalls: string[] = []
    const requestRepoProbeRestore = t.mock.method(
      executorWsService,
      'requestRepoProbe',
      async (_executorId: string, localPath: string): Promise<LocalPathProbeResult> => {
        probeCalls.push(localPath)
        if (localPath === managedUserProjectPath) {
          return {
            ok: true,
            path: managedUserProjectPath,
            versionControl: 'git-remote',
            gitUrl: 'https://github.com/example-org/example-repo.git',
            defaultBranch: 'main',
            message: '已检测到远端 Git 仓库',
          }
        }

        return {
          ok: true,
          path: localPath,
          versionControl: 'none',
          message: '目录无 Git 仓库',
        }
      },
    )
    const requestRepoBranchesRestore = t.mock.method(executorWsService, 'requestRepoBranches', async () => ({
      ok: true,
      branches: ['main'],
      defaultBranch: 'main',
      currentBranch: 'main',
    }))

    try {
      const app = createApp()
      const response = await app.request(`/api/projects/${project.id}/settings/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${createToken(userId)}`,
        },
      })

      assert.equal(response.status, 200)
      const payload = await response.json() as {
        message?: string
        state: {
          projects: Array<{
            id: string
            rootPath?: string
            gitUrl?: string
            versionControl?: string
          }>
        }
      }
      const updatedProject = payload.state.projects.find((item) => item.id === project.id)

      assert.deepEqual(probeCalls.slice(0, 2), [stalePreviewRootPath, managedUserProjectPath])
      assert.equal(updatedProject?.versionControl, 'git-remote')
      assert.equal(updatedProject?.gitUrl, 'https://github.com/example-org/example-repo.git')
      assert.equal(updatedProject?.rootPath, managedUserProjectPath)
      assert.match(payload.message ?? '', /已识别为远端 Git 项目。/)
    } finally {
      requestRepoBranchesRestore.mock.restore()
      requestRepoProbeRestore.mock.restore()
      listExecutorsRestore.mock.restore()
    }
  })
})

test('sync project settings overwrites project runtime environment from local .env', async (t) => {
  if (!process.env.DATABASE_URL?.trim() && !process.env.POSTGRES_URL?.trim()) {
    t.skip('requires Postgres runtime environment store')
    return
  }

  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const userId = `user-${crypto.randomUUID()}`
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'vibemux-project-sync-runtime-env-'))
    const projectRootPath = path.join(tempRoot, 'project-root')
    mkdirSync(projectRootPath, { recursive: true })
    writeFileSync(path.join(projectRootPath, '.env'), 'API_KEY=synced\n')

    const project = {
      ...createProjectRecord({
        name: `sync-runtime-env-${Date.now()}`,
        gitUrl: '',
        rootPath: projectRootPath,
        versionControl: 'none',
      }),
      id: `project-${crypto.randomUUID()}`,
    }

    saveProject(project)
    addUserProject(userId, project.id)
    await saveProjectRuntimeEnvironmentConfig(project.id, {
      mode: 'process-env',
      fileName: '.env',
      content: 'API_KEY=stale\n',
    })

    const app = createApp()
    const response = await app.request(`/api/projects/${project.id}/settings/sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${createToken(userId)}`,
      },
    })

    assert.equal(response.status, 200)
    const detail = await getProjectRuntimeEnvironmentDetail(project.id)
    assert.equal(detail.config?.fileName, '.env')
    assert.equal(detail.config?.content, 'API_KEY=synced\n')
  })
})
