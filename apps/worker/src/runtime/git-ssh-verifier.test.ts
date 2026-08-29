import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { verifyGitSshCredential } from './git-ssh-verifier'

const withWorkerRoot = async (run: (workspaceRoot: string) => Promise<void>) => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'vibemux-ssh-verifier-'))
  try {
    await run(workspaceRoot)
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
}

test('accepts Codeup public-key authentication reported by OpenSSH', async () => {
  await withWorkerRoot(async (workspaceRoot) => {
    let invocation: { command: string; args: string[] } | undefined
    const result = await verifyGitSshCredential({
      host: 'codeup.aliyun.com',
      privateKey: 'test-private-key',
      workspaceRoot,
      run: async (command, args) => {
        invocation = { command, args }
        return {
          status: 1,
          stdout: '',
          stderr: 'debug1: Authenticated to codeup.aliyun.com ([47.246.21.18]:22) using "publickey".',
        }
      },
    })

    assert.equal(result.ok, true)
    assert.equal(result.sshUser, 'git')
    assert.equal(invocation?.command, 'ssh')
    assert.ok(invocation?.args.includes('StrictHostKeyChecking=accept-new'))
    assert.ok(invocation?.args.includes('git@codeup.aliyun.com'))
  })
})

test('reports Codeup public-key authentication failure without leaking command details', async () => {
  await withWorkerRoot(async (workspaceRoot) => {
    const result = await verifyGitSshCredential({
      host: 'codeup.aliyun.com',
      privateKey: 'test-private-key',
      workspaceRoot,
      run: async () => ({
        status: 255,
        stdout: '',
        stderr: 'git@codeup.aliyun.com: Permission denied (publickey).',
      }),
    })

    assert.equal(result.ok, false)
    assert.match(result.message, /公钥认证失败/)
    assert.doesNotMatch(result.message, /test-private-key|id_ed25519/)
  })
})

test('normalizes unexpected command failures without leaking private-key details', async () => {
  await withWorkerRoot(async (workspaceRoot) => {
    const result = await verifyGitSshCredential({
      host: 'codeup.aliyun.com',
      privateKey: 'test-private-key',
      workspaceRoot,
      run: async () => {
        throw new Error('command failed with /tmp/private/id_ed25519 and test-private-key')
      },
    })

    assert.equal(result.ok, false)
    assert.match(result.message, /Worker 无法准备 SSH 验证环境/)
    assert.doesNotMatch(result.message, /test-private-key|id_ed25519/)
  })
})

test('rejects HTTPS and mismatched repository URLs before running a command', async () => {
  await withWorkerRoot(async (workspaceRoot) => {
    let called = false
    const result = await verifyGitSshCredential({
      host: 'codeup.aliyun.com',
      privateKey: 'test-private-key',
      repoUrl: 'https://codeup.aliyun.com/team/repo.git',
      workspaceRoot,
      run: async () => {
        called = true
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    assert.equal(result.ok, false)
    assert.equal(called, false)
    assert.match(result.message, /协议或 Host 不匹配/)
  })
})

test('verifies repository read access with git ls-remote and the SSH environment', async () => {
  await withWorkerRoot(async (workspaceRoot) => {
    let invocation: { command: string; args: string[]; gitSshCommand?: string } | undefined
    const repoUrl = 'git@codeup.aliyun.com:team/repo.git'
    const result = await verifyGitSshCredential({
      host: 'codeup.aliyun.com',
      privateKey: 'test-private-key',
      repoUrl,
      workspaceRoot,
      run: async (command, args, options) => {
        invocation = { command, args, gitSshCommand: options.env.GIT_SSH_COMMAND }
        return { status: 0, stdout: 'abc123\tHEAD\n', stderr: '' }
      },
    })

    assert.equal(result.ok, true)
    assert.deepEqual(invocation?.args, ['ls-remote', repoUrl])
    assert.equal(invocation?.command, 'git')
    assert.match(invocation?.gitSshCommand || '', /StrictHostKeyChecking=accept-new/)
    assert.doesNotMatch(invocation?.gitSshCommand || '', /StrictHostKeyChecking=no/)
  })
})
