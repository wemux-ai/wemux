import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { detectProjectEnvironmentTemplate } from './project-environment-service'

test('detectProjectEnvironmentTemplate reads legacy .Vibemux.yml from repo root', async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), 'vibemux-env-template-'))
  const configPath = path.join(rootPath, '.Vibemux.yml')
  writeFileSync(configPath, [
    'environment:',
    '  install: "pnpm install"',
    '  start: "pnpm dev"',
    '  appPort: "3000"',
    '',
  ].join('\n'))

  const detected = await detectProjectEnvironmentTemplate({ rootPath })

  assert.equal(detected?.installCommand, 'pnpm install')
  assert.equal(detected?.startCommandTemplate, 'pnpm dev')
  assert.equal(detected?.appPort, '3000')
  assert.match(detected?.configPath ?? '', new RegExp(`${rootPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.vibemux\\.yml$`, 'i'))
  assert.equal(detected?.source, 'vibemux-yml')
})

test('detectProjectEnvironmentTemplate reads service-based .vibemux.yml from repo root', async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), 'vibemux-env-template-'))
  const configPath = path.join(rootPath, '.vibemux.yml')
  writeFileSync(configPath, [
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
    '',
  ].join('\n'))

  const detected = await detectProjectEnvironmentTemplate({ rootPath })

  assert.equal(detected?.installCommand, 'pnpm install')
  assert.equal(detected?.startCommandTemplate, 'pnpm run dev')
  assert.equal(detected?.appPort, '4111')
  assert.equal(detected?.healthPath, '/api/health')
  assert.equal(detected?.configPath, configPath)
  assert.equal(detected?.source, 'vibemux-yml')
})
