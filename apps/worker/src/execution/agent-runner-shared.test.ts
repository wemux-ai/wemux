import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldSpawnWithShellOnWindows } from './agent-runner-shared'

test('shouldSpawnWithShellOnWindows enables shell for Windows command shims', () => {
  assert.equal(shouldSpawnWithShellOnWindows('C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd', 'win32'), true)
  assert.equal(shouldSpawnWithShellOnWindows('C:\\tools\\opencode.bat', 'win32'), true)
  assert.equal(shouldSpawnWithShellOnWindows('C:\\tools\\opencode.exe', 'win32'), false)
  assert.equal(shouldSpawnWithShellOnWindows('/usr/local/bin/claude.cmd', 'darwin'), false)
})
