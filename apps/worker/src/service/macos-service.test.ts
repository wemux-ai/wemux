import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('MacOSService installs a launch agent with keepalive and environment variables', async () => {
  const source = await readFile(new URL('./macos-service.ts', import.meta.url), 'utf8')

  assert.match(source, /<key>RunAtLoad<\/key>/)
  assert.match(source, /<key>KeepAlive<\/key>/)
  assert.match(source, /options\.restartOnFailure \? 'true' : 'false'/)
  assert.match(source, /<key>EnvironmentVariables<\/key>/)
  assert.match(source, /launchctl', \['bootstrap'/)
  assert.match(source, /launchctl', \['kickstart', '-k'/)
  assert.match(source, /async restart\(\) {\n    await this\.start\(\)\n  }/)
})
