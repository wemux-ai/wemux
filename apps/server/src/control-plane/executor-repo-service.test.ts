import assert from 'node:assert/strict'
import test from 'node:test'
import type { LocalPathProbeResult, Project } from '@shared/types'
import { buildProjectVersionControlProbePaths, resolveProjectVersionControlFromProbeResult } from './executor-repo-service'

const createProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'project-1',
  name: 'Vibe Test',
  gitUrl: '',
  versionControl: 'none',
  rootPath: '/tmp/vibe-test',
  defaultBranch: 'main',
  recentBaseBranches: [],
  description: '',
  status: 'active',
  priority: 'medium',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
}) as Project

const createProbeResult = (overrides: Partial<LocalPathProbeResult> = {}): LocalPathProbeResult => ({
  ok: true,
  path: '/tmp/vibe-test',
  versionControl: 'none',
  message: '目录无 Git 仓库',
  ...overrides,
})

test('resolveProjectVersionControlFromProbeResult downgrades a stale remote git project to a local directory project', () => {
  const project = createProject({
    gitUrl: 'https://github.com/example/vibe-test.git',
    versionControl: 'git-remote',
    defaultBranch: 'main',
  })

  const nextProject = resolveProjectVersionControlFromProbeResult(project, createProbeResult({
    versionControl: 'none',
    message: '目录无 Git 仓库',
  }))

  assert.ok(nextProject)
  assert.equal(nextProject?.versionControl, 'none')
  assert.equal(nextProject?.gitUrl, '')
  assert.equal(nextProject?.rootPath, '/tmp/vibe-test')
})

test('resolveProjectVersionControlFromProbeResult keeps local git projects on git-local when probe reports git-local', () => {
  const project = createProject({
    versionControl: 'none',
    gitUrl: '',
  })

  const nextProject = resolveProjectVersionControlFromProbeResult(project, createProbeResult({
    versionControl: 'git-local',
    defaultBranch: 'dev',
    message: '已检测到本地 Git 仓库（未绑定远端），共 2 个分支',
  }))

  assert.ok(nextProject)
  assert.equal(nextProject?.versionControl, 'git-local')
  assert.equal(nextProject?.defaultBranch, 'dev')
  assert.deepEqual(nextProject?.recentBaseBranches, ['dev'])
})

test('resolveProjectVersionControlFromProbeResult returns null when probe is not usable', () => {
  const project = createProject()

  const nextProject = resolveProjectVersionControlFromProbeResult(project, {
    ok: false,
    path: '/tmp/vibe-test',
    message: '目录不存在',
  })

  assert.equal(nextProject, null)
})

test('buildProjectVersionControlProbePaths includes workspace and binding candidates after project root', () => {
  const paths = buildProjectVersionControlProbePaths(
    createProject({ rootPath: '/tmp/project-root' }),
    [
      ' /tmp/workspace-repo ',
      '/tmp/project-root',
      '',
      undefined,
      '/tmp/workspace-repo',
      '/tmp/binding-repo',
    ],
  )

  assert.deepEqual(paths, [
    '/tmp/project-root',
    '/tmp/workspace-repo',
    '/tmp/binding-repo',
  ])
})
