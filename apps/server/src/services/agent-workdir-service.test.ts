import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  ensureAgentWorkdir,
  getAgentWorkdirPaths,
  listAgentWorkdirFiles,
  resolveAgentWorkdirFile,
  touchAgentWorkdirSession,
} from './agent-workdir-service'

test('agent workdir layout and snapshot stay under the hidden system boundary', () => {
  const previousHome = process.env.VIBEMUX_AGENT_HOME
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'vibemux-agent-workdir-'))
  process.env.VIBEMUX_AGENT_HOME = tempHome

  try {
    const ensured = ensureAgentWorkdir('agent-123')
    const paths = getAgentWorkdirPaths('agent-123')

    assert.equal(ensured.summary.status, 'ready')
    assert.ok(existsSync(paths.workDirPath))
    assert.ok(existsSync(path.join(paths.systemPath, 'manifest.json')))
    assert.ok(existsSync(path.join(paths.systemPath, 'snapshots', 'current.json')))
  } finally {
    process.env.VIBEMUX_AGENT_HOME = previousHome
    rmSync(tempHome, { force: true, recursive: true })
  }
})

test('rescan indexes files relative to workdir and rejects path traversal downloads', () => {
  const previousHome = process.env.VIBEMUX_AGENT_HOME
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'vibemux-agent-files-'))
  process.env.VIBEMUX_AGENT_HOME = tempHome

  try {
    const paths = getAgentWorkdirPaths('agent-456')
    ensureAgentWorkdir('agent-456')
    writeFileSync(path.join(paths.workDirPath, 'report.md'), '# report\n', 'utf8')
    writeFileSync(path.join(paths.workDirPath, 'notes.txt'), 'hello\n', 'utf8')
    touchAgentWorkdirSession('agent-456', 'session-1')

    const listed = listAgentWorkdirFiles('agent-456', true)

    assert.equal(listed.summary.totalFiles, 2)
    assert.deepEqual(
      listed.files.filter((item) => item.type === 'file').map((item) => item.path).sort(),
      ['notes.txt', 'report.md'],
    )
    assert.equal(resolveAgentWorkdirFile('agent-456', 'report.md').relativePath, 'report.md')
    assert.throws(() => resolveAgentWorkdirFile('agent-456', '../secret.txt'))
  } finally {
    process.env.VIBEMUX_AGENT_HOME = previousHome
    rmSync(tempHome, { force: true, recursive: true })
  }
})
