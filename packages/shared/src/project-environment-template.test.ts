import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasProjectEnvironmentTemplateContent,
  mergeImportedProjectEnvironmentTemplate,
  parseProjectEnvironmentTemplate,
  resolveProjectEnvironmentCommandFields,
  resolveProjectEnvironmentPreview,
} from './project-environment-template'
import { buildWorkspacePreviewSourceOptions, resolvePreviewSourceLabel, validateProjectEnvironmentPreviewPorts } from './preview-source'
import type { Project, WorkspaceSession } from './types'

const createProject = (environmentTemplate?: Project['environmentTemplate']): Project => ({
  id: 'project-1',
  name: 'Agor Mirror',
  gitUrl: 'https://github.com/preset-io/agor.git',
  defaultBranch: 'main',
  versionControl: 'git-remote',
  environmentTemplate,
  recentBaseBranches: ['main'],
  createdAt: '2026-05-11T00:00:00.000Z',
  updatedAt: '2026-05-11T00:00:00.000Z',
})

const createSession = (): WorkspaceSession => ({
  id: 'workspace-session-1',
  workspaceId: 'workspace-1',
  displayOrder: 0,
  title: '默认会话',
  titleOrigin: 'system',
  status: 'active',
  sessionKind: 'primary',
  sessionRole: 'general',
  sessionOrigin: 'manual',
  executorNodeId: 'executor-1',
  agentType: 'OpenCode',
  mountedSkillNames: [],
  mountedMcpServerNames: [],
  enabledMcpServerIds: [],
  executionModel: 'openai/gpt-5',
  gitIdentityMode: 'personal',
  runtimeContinuations: [],
  baseBranch: 'main',
  worktreeId: 'worktree-1',
  worktreeUniqueId: 7,
  branchName: 'feat/install-template',
  worktreeStatus: 'created',
  workingDirectoryMode: 'worktree',
  needsHumanConfirm: false,
  agentRunningStatus: 'idle',
  runtimeStatus: 'idle',
  runtimeSequence: 0,
  currentStep: '',
  lastActiveAt: '2026-05-11T00:00:00.000Z',
  createdAt: '2026-05-11T00:00:00.000Z',
  updatedAt: '2026-05-11T00:00:00.000Z',
})

test('resolveProjectEnvironmentPreview renders install command templates', () => {
  const template = parseProjectEnvironmentTemplate(`
environment:
  install: "pnpm --dir {{worktree.path}} install"
  start: "pnpm --dir {{worktree.path}} dev --port {{add worktree.unique_id 3000}}"
  stop: "pkill -f vibemux"
`)!
  const preview = resolveProjectEnvironmentPreview({
    project: createProject(template),
    session: createSession(),
    cwd: '/tmp/worktrees/agor-mirror-7',
  })

  assert.equal(preview?.installCommand, 'pnpm --dir /tmp/worktrees/agor-mirror-7 install')
  assert.equal(preview?.startCommand, 'pnpm --dir /tmp/worktrees/agor-mirror-7 dev --port 3007')
})

test('resolveProjectEnvironmentPreview renders dynamic port templates across preview fields', () => {
  const template = parseProjectEnvironmentTemplate(`
environment:
  start: "pnpm --dir {{worktree.path}} dev -- --port {{add worktree.unique_id 5173}}"
  stop: "bash -lc \\"pkill -f '{{worktree.path}}.*{{add worktree.unique_id 5173}}' || true\\""
  appPort: "{{add worktree.unique_id 5173}}"
  healthPath: "/health"
  ports:
    - id: "api"
      port: "{{add worktree.unique_id 4000}}"
      note: "API"
    - id: "docs"
      port: "{{add worktree.unique_id 5000}}"
      note: "Docs"
`)!
  const preview = resolveProjectEnvironmentPreview({
    project: createProject(template),
    session: createSession(),
    cwd: '/tmp/worktrees/agor-mirror-7',
  })

  assert.equal(preview?.startCommand, 'pnpm --dir /tmp/worktrees/agor-mirror-7 dev -- --port 5180')
  assert.equal(preview?.stopCommand, 'bash -lc "pkill -f \'/tmp/worktrees/agor-mirror-7.*5180\' || true"')
  assert.equal(preview?.appUrl, 'http://127.0.0.1:5180/')
  assert.equal(preview?.healthUrl, 'http://127.0.0.1:5180/health')
  assert.deepEqual(preview?.additionalAppUrls, [
    'http://127.0.0.1:4007/',
    'http://127.0.0.1:5007/',
  ])
  assert.deepEqual(preview?.domainBindings, [
    {
      id: 'app',
      domain: undefined,
      port: 5180,
      note: undefined,
      type: 'generated',
      appUrl: 'http://127.0.0.1:5180/',
      primary: true,
    },
    {
      id: 'api',
      domain: undefined,
      port: 4007,
      note: 'API',
      type: 'generated',
      appUrl: 'http://127.0.0.1:4007/',
      primary: false,
    },
    {
      id: 'docs',
      domain: undefined,
      port: 5007,
      note: 'Docs',
      type: 'generated',
      appUrl: 'http://127.0.0.1:5007/',
      primary: false,
    },
  ])
})

test('parseProjectEnvironmentTemplate supports service-based vibemux yml files', () => {
  const template = parseProjectEnvironmentTemplate(`
name: shopping-agent
description: AI-powered shopping workflow

runtime:
  node: ">=22.13.0"
  packageManager: pnpm@10

services:
  mastra:
    command: "pnpm run dev"
    port: 4111
    healthCheck:
      path: /api/health
    environment:
      NODE_ENV: development
      PORT: "4111"
  docs:
    command: "pnpm run docs"
    port: 4112
`)! 

  assert.equal(template.installCommand, 'pnpm install')
  assert.equal(template.startCommandTemplate, 'pnpm run dev')
  assert.equal(template.appPort, '4111')
  assert.equal(template.healthPath, '/api/health')
  assert.deepEqual(template.ports, [{
    id: 'docs',
    port: '4112',
    note: 'docs',
    type: 'generated',
  }])
})

test('parseProjectEnvironmentTemplate ignores non-runtime environment fields from vibemux yml', () => {
  const template = parseProjectEnvironmentTemplate(`
environment:
  install: "pnpm install"
  build: "pnpm build"
  test: "pnpm test"
  lint: "pnpm lint"
  branch: "feat/{task}"
  start: "pnpm dev -- --port {{add worktree.unique_id 3000}}"
  stop: "pkill -f pnpm"
  nuke: "rm -rf .next"
  appPort: "{{add worktree.unique_id 3000}}"
  healthPath: "/health"
  logs: "pnpm logs"
`)! 

  assert.equal(template.installCommand, 'pnpm install')
  assert.equal(template.startCommandTemplate, 'pnpm dev -- --port {{add worktree.unique_id 3000}}')
  assert.equal(template.stopCommandTemplate, 'pkill -f pnpm')
  assert.equal(template.appPort, '{{add worktree.unique_id 3000}}')
  assert.equal(template.healthPath, '/health')
  assert.equal(template.logsCommandTemplate, 'pnpm logs')
  assert.equal(template.buildCommand, undefined)
  assert.equal(template.testCommand, undefined)
  assert.equal(template.lintCommand, undefined)
  assert.equal(template.branchNamePattern, undefined)
  assert.equal(template.nukeCommandTemplate, undefined)
})

test('mergeImportedProjectEnvironmentTemplate only refreshes runtime fields from vibemux yml', () => {
  const current = {
    source: 'vibemux-yml' as const,
    installCommand: 'pnpm install',
    buildCommand: 'pnpm build --cached',
    testCommand: 'pnpm test --watch=false',
    lintCommand: 'pnpm lint --fix',
    branchNamePattern: 'feature/{task}',
    startCommandTemplate: 'pnpm dev -- --port {{add worktree.unique_id 3000}}',
    stopCommandTemplate: 'pkill -f pnpm',
    nukeCommandTemplate: 'rm -rf .next',
    appPort: '{{add worktree.unique_id 3000}}',
    healthPath: '/health',
    logsCommandTemplate: 'pnpm logs',
    configPath: '.vibemux.yml',
    imported: {
      installCommand: 'pnpm install',
      startCommandTemplate: 'pnpm dev -- --port {{add worktree.unique_id 3000}}',
      stopCommandTemplate: 'pkill -f pnpm',
      appPort: '{{add worktree.unique_id 3000}}',
      healthPath: '/health',
      logsCommandTemplate: 'pnpm logs',
      configPath: '.vibemux.yml',
    },
  }

  const merged = mergeImportedProjectEnvironmentTemplate({
    current,
    imported: parseProjectEnvironmentTemplate(`
environment:
  install: "pnpm install --frozen-lockfile"
  build: "pnpm build"
  test: "pnpm test"
  lint: "pnpm lint"
  branch: "bugfix/{task}"
  start: "pnpm preview --port {{add worktree.unique_id 3100}}"
  stop: "pkill -f preview"
  nuke: "rm -rf dist"
  appPort: "{{add worktree.unique_id 3100}}"
  healthPath: "/ready"
  logs: "pnpm preview:logs"
` , { configPath: '.vibemux.yml', source: 'vibemux-yml' })!,
  })

  assert.equal(merged.installCommand, 'pnpm install --frozen-lockfile')
  assert.equal(merged.startCommandTemplate, 'pnpm preview --port {{add worktree.unique_id 3100}}')
  assert.equal(merged.stopCommandTemplate, 'pkill -f preview')
  assert.equal(merged.appPort, '{{add worktree.unique_id 3100}}')
  assert.equal(merged.healthPath, '/ready')
  assert.equal(merged.logsCommandTemplate, 'pnpm preview:logs')
  assert.equal(merged.buildCommand, 'pnpm build --cached')
  assert.equal(merged.testCommand, 'pnpm test --watch=false')
  assert.equal(merged.lintCommand, 'pnpm lint --fix')
  assert.equal(merged.branchNamePattern, 'feature/{task}')
  assert.equal(merged.nukeCommandTemplate, 'rm -rf .next')
})

test('resolveProjectEnvironmentPreview renders a stable environment slug for resource names', () => {
  const template = parseProjectEnvironmentTemplate(`
environment:
  start: "COMPOSE_PROJECT_NAME={{environment.slug}} docker compose -f {{worktree.path}}/docker-compose.yml up -d"
  stop: "COMPOSE_PROJECT_NAME={{environment.slug}} docker compose -f {{worktree.path}}/docker-compose.yml down"
`)!
  const session = {
    ...createSession(),
    title: '帮这个 chore/postgres 分支直接部署到 railway',
    branchName: 'vibemux/f79d-帮这个-chore-postgres-分支',
    worktreeUniqueId: 2,
  }
  const preview = resolveProjectEnvironmentPreview({
    project: createProject(template),
    session,
    cwd: '/tmp/worktrees/todomap-2',
  })

  assert.equal(
    preview?.startCommand,
    'COMPOSE_PROJECT_NAME=agor-2 docker compose -f /tmp/worktrees/todomap-2/docker-compose.yml up -d',
  )
  assert.equal(
    preview?.stopCommand,
    'COMPOSE_PROJECT_NAME=agor-2 docker compose -f /tmp/worktrees/todomap-2/docker-compose.yml down',
  )
})

test('resolveProjectEnvironmentPreview resolves preview domain bindings into local port targets', () => {
  const preview = resolveProjectEnvironmentPreview({
    project: createProject({
      source: 'manual',
      startCommandTemplate: 'pnpm dev',
      stopCommandTemplate: 'pkill -f pnpm',
      previewDomainBindings: [
        {
          id: 'web',
          port: 3000,
          note: 'Web',
          type: 'generated',
        },
        {
          id: 'api',
          domain: 'api.example.com',
          port: 3001,
          note: 'API',
          type: 'custom',
        },
      ],
    }),
    session: createSession(),
    cwd: '/tmp/worktrees/agor-mirror-7',
  })

  assert.equal(preview?.appUrl, 'http://127.0.0.1:3000/')
  assert.deepEqual(preview?.additionalAppUrls, ['http://127.0.0.1:3001/'])
  assert.deepEqual(preview?.domainBindings, [
    {
      id: 'web',
      domain: undefined,
      port: 3000,
      note: 'Web',
      type: 'generated',
      appUrl: 'http://127.0.0.1:3000/',
      primary: true,
    },
    {
      id: 'api',
      domain: 'api.example.com',
      port: 3001,
      note: 'API',
      type: 'custom',
      appUrl: 'http://127.0.0.1:3001/',
      primary: false,
    },
  ])
})

test('workspace environment template empty fields fall back to project template fields', () => {
  const preview = resolveProjectEnvironmentPreview({
    project: createProject({
      source: 'manual',
      installCommand: 'pnpm install',
      startCommandTemplate: 'pnpm dev --port {{add worktree.unique_id 3000}}',
      stopCommandTemplate: 'pkill -f pnpm',
      logsCommandTemplate: 'tail -f app.log',
      previewDomainBindings: [{ id: 'web', port: 3000, type: 'generated' }],
    }),
    workspaceEnvironmentTemplate: {
      source: 'manual',
      startCommandTemplate: '',
      stopCommandTemplate: '',
      previewDomainBindings: [],
    },
    session: createSession(),
    cwd: '/tmp/worktrees/agor-mirror-7',
  })

  assert.equal(preview?.installCommand, 'pnpm install')
  assert.equal(preview?.startCommand, 'pnpm dev --port 3007')
  assert.equal(preview?.stopCommand, 'pkill -f pnpm')
  assert.equal(preview?.logsCommand, 'tail -f app.log')
  assert.equal(preview?.appUrl, 'http://127.0.0.1:3000/')
})

test('project environment helpers ignore malformed non-string template fields', () => {
  const malformedTemplate = {
    installCommand: ['pnpm install'],
    startCommandTemplate: { raw: 'pnpm dev' },
    stopCommandTemplate: null,
    logsCommandTemplate: 42,
  } as unknown as Project['environmentTemplate']

  const project = createProject(malformedTemplate)

  assert.deepEqual(resolveProjectEnvironmentCommandFields(project), {
    installCommand: undefined,
    buildCommand: undefined,
    testCommand: undefined,
    lintCommand: undefined,
    branchNamePattern: undefined,
  })
  assert.equal(hasProjectEnvironmentTemplateContent(malformedTemplate), false)
  assert.equal(resolveProjectEnvironmentPreview({
    project,
    session: createSession(),
    cwd: '/tmp/worktrees/agor-mirror-7',
  }), null)
})

test('buildWorkspacePreviewSourceOptions returns primary and additional preview sources in order', () => {
  const sources = buildWorkspacePreviewSourceOptions({
    preview: {
      sourceAppUrl: 'http://127.0.0.1:3000/',
      domainBindings: [
        {
          id: 'web',
          appUrl: 'http://127.0.0.1:3000/',
          publicUrl: 'https://preview.example.com/',
          previewHost: 'preview.example.com',
          port: 3000,
          note: 'Web',
          primary: true,
        },
        {
          id: 'admin',
          appUrl: 'http://127.0.0.1:3001/',
          publicUrl: 'https://admin-preview.example.com/',
          previewHost: 'admin-preview.example.com',
          port: 3001,
          note: 'Admin',
          primary: false,
        },
      ],
      additionalSourceAppUrls: [],
    },
  })

  assert.deepEqual(sources, [
    {
      id: 'web',
      appUrl: 'http://127.0.0.1:3000/',
      accessUrl: 'https://preview.example.com/',
      port: 3000,
      note: 'Web',
      primary: true,
    },
    {
      id: 'admin',
      appUrl: 'http://127.0.0.1:3001/',
      accessUrl: 'https://admin-preview.example.com/',
      port: 3001,
      note: 'Admin',
      primary: false,
    },
  ])
  assert.equal(resolvePreviewSourceLabel(sources[0]!), 'Web · 3000')
  assert.equal(resolvePreviewSourceLabel(sources[1]!), 'Admin · 3001')
})

test('validateProjectEnvironmentPreviewPorts reports duplicate primary and additional preview ports', () => {
  assert.deepEqual(validateProjectEnvironmentPreviewPorts({
    appPort: '{{ add worktree.unique_id 3000 }}',
    ports: [
      { id: 'web-copy', port: '{{ add worktree.unique_id 3000 }}' },
      { id: 'api', port: '{{ add worktree.unique_id 4000 }}' },
      { id: 'api-copy', port: '{{ add worktree.unique_id 4000 }}' },
    ],
  }), [
    '{{ add worktree.unique_id 3000 }}',
    '{{ add worktree.unique_id 4000 }}',
  ])
})

test('validateProjectEnvironmentPreviewPorts reports duplicate preview domain binding ports', () => {
  assert.deepEqual(validateProjectEnvironmentPreviewPorts({
    appPort: '3005',
    ports: [{ id: 'docs', port: '4111' }],
    previewDomainBindings: [
      { id: 'web', port: 3005, type: 'generated' },
      { id: 'preview-copy', port: 3005, note: 'Preview', type: 'custom' },
    ],
  }), ['3005'])
})

test('resolveProjectEnvironmentPreview dedupes same rendered port across ports and preview domain bindings', () => {
  const preview = resolveProjectEnvironmentPreview({
    project: createProject({
      source: 'manual',
      startCommandTemplate: 'pnpm dev --port {{add worktree.unique_id 3000}}',
      appPort: '{{add worktree.unique_id 3000}}',
      ports: [{ id: 'preview', port: '{{add worktree.unique_id 3000}}', note: 'Preview', type: 'generated' }],
      previewDomainBindings: [{ id: 'mastra', domain: 'preview.example.com', port: 3007, note: 'Mastra', type: 'custom' }],
    }),
    session: createSession(),
    cwd: '/tmp/worktrees/agor-mirror-7',
  })

  assert.equal(preview?.appUrl, 'http://127.0.0.1:3007/')
  assert.deepEqual(preview?.additionalAppUrls, [])
  assert.deepEqual(preview?.domainBindings, [{
    id: 'mastra',
    domain: 'preview.example.com',
    port: 3007,
    note: 'Mastra',
    type: 'custom',
    appUrl: 'http://127.0.0.1:3007/',
    primary: true,
  }])
})
