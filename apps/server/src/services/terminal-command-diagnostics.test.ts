import assert from 'node:assert/strict'
import test from 'node:test'
import { appendTerminalCommandDiagnostic, buildTerminalCommandDiagnostic } from './terminal-command-diagnostics'

test('diagnoses missing pnpm on executor nodes', () => {
  const diagnostic = buildTerminalCommandDiagnostic({
    command: 'pnpm install',
    exitCode: 127,
    output: '/bin/bash: line 1: pnpm: command not found',
  })

  assert.match(diagnostic, /当前执行节点缺少 pnpm/)
  assert.match(diagnostic, /Docker Worker/)
})

test('appends command diagnostics to terminal output once needed', () => {
  const output = appendTerminalCommandDiagnostic({
    command: 'pnpm dev -p 4001',
    exitCode: 127,
    output: 'bash: pnpm: command not found',
  })

  assert.match(output, /bash: pnpm: command not found/)
  assert.match(output, /请更新并重启该 Worker/)
})

test('does not add diagnostics for ordinary command failures', () => {
  const output = appendTerminalCommandDiagnostic({
    command: 'pnpm test',
    exitCode: 1,
    output: 'Tests failed',
  })

  assert.equal(output, 'Tests failed')
})
