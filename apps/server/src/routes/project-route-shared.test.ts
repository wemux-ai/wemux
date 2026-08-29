import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProjectEnvironmentTemplate } from '@shared/types'
import { mergeProjectEnvironmentTemplateUpdate } from './project-route-shared'

test('mergeProjectEnvironmentTemplateUpdate keeps and updates full environment template fields', () => {
  const current: ProjectEnvironmentTemplate = {
    installCommand: 'pnpm install',
    startCommandTemplate: 'pnpm dev',
    stopCommandTemplate: 'pnpm stop',
    appPort: '3000',
    healthPath: '/health',
    logsCommandTemplate: 'pnpm logs',
    ports: [{ id: 'api', port: '{{add worktree.unique_id 4000}}', note: 'API', type: 'generated' }],
    previewDomainBindings: [{ id: 'api', port: 8000, type: 'generated' }],
    source: 'manual',
  }

  const merged = mergeProjectEnvironmentTemplateUpdate(current, {
    installCommand: 'bun install',
    startCommandTemplate: 'pnpm start',
    stopCommandTemplate: 'pnpm down',
    appPort: '4000',
    healthPath: '/ready',
    logsCommandTemplate: 'pnpm tail',
    ports: [{ id: 'docs', port: '{{add worktree.unique_id 5000}}', note: 'Docs', type: 'generated' }],
    previewDomainBindings: [{ id: 'admin', port: 9000, type: 'generated' }],
    source: 'manual',
  })

  assert.ok(merged)
  assert.equal(merged.installCommand, 'bun install')
  assert.equal(merged.startCommandTemplate, 'pnpm start')
  assert.equal(merged.stopCommandTemplate, 'pnpm down')
  assert.equal(merged.appPort, '4000')
  assert.equal(merged.healthPath, '/ready')
  assert.equal(merged.logsCommandTemplate, 'pnpm tail')
  assert.deepEqual(merged.ports, [{
    id: 'docs',
    domain: undefined,
    port: '{{add worktree.unique_id 5000}}',
    note: 'Docs',
    type: 'generated',
  }])
  assert.deepEqual(merged.previewDomainBindings, [{
    id: 'admin',
    domain: undefined,
    port: 9000,
    note: undefined,
    type: 'generated',
  }])
  assert.equal(merged.source, 'manual')
})

test('mergeProjectEnvironmentTemplateUpdate returns undefined when cleared explicitly', () => {
  const merged = mergeProjectEnvironmentTemplateUpdate({
    installCommand: 'pnpm install',
    source: 'manual',
  }, null)

  assert.equal(merged, undefined)
})
