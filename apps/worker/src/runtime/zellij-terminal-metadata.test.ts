import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getWorkspaceNodeDir } from '@shared/workspace-paths'
import { buildZellijSessionName } from './terminal-session'
import {
  clearZellijTerminalMetadata,
  loadRestorableZellijTerminalMetadata,
  removeZellijTerminalMetadata,
  upsertZellijTerminalMetadata,
} from './zellij-terminal-metadata'

const readMetadataFile = (root: string) => {
  const metadataPath = path.join(getWorkspaceNodeDir(root), 'runtime', 'zellij', 'terminal-sessions.json')
  return existsSync(metadataPath)
    ? JSON.parse(readFileSync(metadataPath, 'utf8')) as { sessions: unknown[] }
    : { sessions: [] }
}

test('zellij terminal metadata upserts and removes records by terminal identity', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-zellij-metadata-'))
  try {
    upsertZellijTerminalMetadata(root, {
      executorId: 'executor-1',
      scope: 'workspace',
      terminalId: 'default',
      workspaceId: 'workspace-1',
      title: 'Default',
      cwd: '/tmp/workspace-1',
    })
    upsertZellijTerminalMetadata(root, {
      executorId: 'executor-1',
      scope: 'workspace',
      terminalId: 'default',
      workspaceId: 'workspace-1',
      title: 'Renamed',
      cwd: '/tmp/workspace-1',
    })

    const afterUpsert = readMetadataFile(root)
    assert.equal(afterUpsert.sessions.length, 1)
    assert.equal((afterUpsert.sessions[0] as { title?: string }).title, 'Renamed')

    removeZellijTerminalMetadata(root, {
      executorId: 'executor-1',
      scope: 'workspace',
      terminalId: 'default',
      workspaceId: 'workspace-1',
    })
    assert.equal(readMetadataFile(root).sessions.length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadRestorableZellijTerminalMetadata returns empty without metadata', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-zellij-metadata-empty-'))
  try {
    assert.deepEqual(await loadRestorableZellijTerminalMetadata(root, 'executor-1'), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('clearZellijTerminalMetadata removes only the requested executor records', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-zellij-metadata-clear-'))
  try {
    upsertZellijTerminalMetadata(root, {
      executorId: 'executor-1',
      scope: 'workspace',
      terminalId: 'one',
      workspaceId: 'workspace-1',
      title: 'One',
      cwd: '/tmp/one',
    })
    upsertZellijTerminalMetadata(root, {
      executorId: 'executor-2',
      scope: 'workspace',
      terminalId: 'two',
      workspaceId: 'workspace-2',
      title: 'Two',
      cwd: '/tmp/two',
    })

    clearZellijTerminalMetadata(root, 'executor-1')
    const sessions = readMetadataFile(root).sessions as Array<{ executorId: string }>
    assert.deepEqual(sessions.map((record) => record.executorId), ['executor-2'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadRestorableZellijTerminalMetadata prunes stale records for the requested executor', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-zellij-metadata-prune-'))
  try {
    upsertZellijTerminalMetadata(root, {
      executorId: 'executor-1',
      scope: 'workspace',
      terminalId: 'live',
      workspaceId: 'workspace-1',
      title: 'Live',
      cwd: '/tmp/live',
    })
    upsertZellijTerminalMetadata(root, {
      executorId: 'executor-1',
      scope: 'workspace',
      terminalId: 'stale',
      workspaceId: 'workspace-1',
      title: 'Stale',
      cwd: '/tmp/stale',
    })
    upsertZellijTerminalMetadata(root, {
      executorId: 'executor-2',
      scope: 'workspace',
      terminalId: 'other',
      workspaceId: 'workspace-2',
      title: 'Other',
      cwd: '/tmp/other',
    })

    const liveSessionName = buildZellijSessionName('workspace::executor-1::workspace-1::live', '/tmp/live')
    const restorable = await loadRestorableZellijTerminalMetadata(root, 'executor-1', {
      listLiveSessionNames: async () => new Set([liveSessionName]),
    })

    assert.deepEqual(restorable.map((record) => record.terminalId), ['live'])
    const persisted = readMetadataFile(root).sessions as Array<{ executorId: string; terminalId: string }>
    assert.deepEqual(
      persisted.map((record) => `${record.executorId}:${record.terminalId}`).sort(),
      ['executor-1:live', 'executor-2:other'],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadRestorableZellijTerminalMetadata keeps metadata when session discovery fails', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-zellij-metadata-discovery-failure-'))
  try {
    upsertZellijTerminalMetadata(root, {
      executorId: 'executor-1',
      scope: 'workspace',
      terminalId: 'default',
      workspaceId: 'workspace-1',
      title: 'Default',
      cwd: '/tmp/workspace-1',
    })

    const restorable = await loadRestorableZellijTerminalMetadata(root, 'executor-1', {
      listLiveSessionNames: async () => {
        throw new Error('zellij daemon unavailable')
      },
    })

    assert.deepEqual(restorable, [])
    const persisted = readMetadataFile(root).sessions as Array<{ terminalId: string }>
    assert.deepEqual(persisted.map((record) => record.terminalId), ['default'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
