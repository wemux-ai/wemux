import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWorkspaceOpenCommandAttempts,
  getWorkspaceOpenTargetLabel,
  listWorkspaceOpenTargets,
  normalizeWorkspaceOpenSettings,
} from './workspace-open-command'

test('buildWorkspaceOpenCommandAttempts builds VS Code, Ghostty, and custom launches', () => {
  const vscodeCommands = buildWorkspaceOpenCommandAttempts({ target: 'vscode', path: '/tmp/demo' })
  const ghosttyCommands = buildWorkspaceOpenCommandAttempts({ target: 'ghostty', path: '/tmp/demo' })
  const customCommands = buildWorkspaceOpenCommandAttempts({
    target: 'custom',
    path: '/tmp/demo folder',
    customCommand: 'code ${path}',
  })

  assert.ok(vscodeCommands[0]?.includes(`code --reuse-window '/tmp/demo'`))
  assert.ok(ghosttyCommands.some((command) => command.includes(`ghostty --working-directory='/tmp/demo'`)))
  assert.deepEqual(customCommands, [`code '/tmp/demo folder'`])
})

test('buildWorkspaceOpenCommandAttempts falls back to app-less Linux commands', () => {
  const commands = buildWorkspaceOpenCommandAttempts({
    target: 'vscode',
    platform: 'linux',
    path: '/tmp/demo',
  })

  assert.ok(commands.every((command) => !command.includes(' open ')))
  assert.ok(commands.some((command) => command.includes('code --reuse-window')))
})

test('workspace open settings normalize and labels stay stable', () => {
  assert.deepEqual(
    normalizeWorkspaceOpenSettings({ defaultTarget: 'custom', customCommand: 'cursor ${path}' }),
    { defaultTarget: 'custom', customCommand: 'cursor ${path}' },
  )
  assert.equal(normalizeWorkspaceOpenSettings({ defaultTarget: 'invalid' as never }).defaultTarget, 'vscode')
  assert.equal(getWorkspaceOpenTargetLabel('ghostty'), 'Ghostty')
  assert.ok(listWorkspaceOpenTargets().some((option) => option.value === 'warp'))
})
