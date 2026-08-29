import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { buildOpencodeServerCacheKey, buildOpencodeServerEnv, terminateOpencodeServerProcess } from './client'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const waitForLine = (child: ReturnType<typeof spawn>) => {
  return new Promise<string>((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('Timed out waiting for child pid output.')), 3000)
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString()
      const line = output.split('\n').find((item) => item.trim())
      if (!line) {
        return
      }

      clearTimeout(timer)
      resolve(line.trim())
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Child exited before printing child pid: ${code}`))
    })
  })
}

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('buildOpencodeServerEnv injects runtime env alongside managed config', () => {
  const env = buildOpencodeServerEnv(JSON.stringify({
    model: 'openai/gpt-5.1',
    provider: {
      openai: {
        options: {
          baseURL: 'https://api.openai.com/v1',
        },
      },
    },
  }), {
    OPENAI_API_KEY: 'opencode-test-key',
    OPENAI_BASE_URL: 'https://runtime.example/v1',
  }, {
    PATH: '/usr/bin',
  })

  assert.equal(env.PATH, '/usr/bin')
  assert.equal(env.OPENAI_API_KEY, 'opencode-test-key')
  assert.equal(env.OPENAI_BASE_URL, 'https://runtime.example/v1')
  assert.match(env.OPENCODE_CONFIG_CONTENT ?? '', /openai\/gpt-5\.1/)
})

test('buildOpencodeServerCacheKey separates pooled runtimes by injected credentials', () => {
  const configContent = JSON.stringify({
    model: 'openai/gpt-5.1',
  })

  const left = buildOpencodeServerCacheKey(configContent, {
    OPENAI_API_KEY: 'token-a',
  })
  const right = buildOpencodeServerCacheKey(configContent, {
    OPENAI_API_KEY: 'token-b',
  })

  assert.notEqual(left, right)
})

test('terminateOpencodeServerProcess stops a detached server process group', { skip: process.platform === 'win32' }, async () => {
  const parent = spawn(process.execPath, ['-e', [
    "const { spawn } = require('node:child_process')",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
    'console.log(child.pid)',
    'setInterval(() => {}, 1000)',
  ].join(';')], {
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const childPid = Number(await waitForLine(parent))

  try {
    assert.ok(parent.pid)
    assert.ok(isProcessAlive(parent.pid))
    assert.ok(isProcessAlive(childPid))

    terminateOpencodeServerProcess(parent)

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!isProcessAlive(parent.pid) && !isProcessAlive(childPid)) {
        return
      }
      await sleep(50)
    }

    assert.equal(isProcessAlive(parent.pid), false)
    assert.equal(isProcessAlive(childPid), false)
  } finally {
    if (parent.pid && isProcessAlive(parent.pid)) {
      process.kill(-parent.pid, 'SIGKILL')
    }
    if (isProcessAlive(childPid)) {
      process.kill(childPid, 'SIGKILL')
    }
  }
})
