/**
 * [INPUT]: Authenticated user id and the control-plane OpenSSH runtime.
 * [OUTPUT]: An Ed25519 SSH key pair plus its public-key fingerprint.
 * [POS]: Server-side key generation boundary for encrypted user Git credentials.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const runSshKeygen = (args: string[]) => {
  const result = spawnSync('ssh-keygen', args, { encoding: 'utf8' })
  if (result.status === 0) {
    return result.stdout.trim()
  }

  if (result.error) {
    throw new Error(`ssh-keygen 不可用：${result.error.message}`)
  }

  throw new Error((result.stderr || result.stdout || `ssh-keygen 执行失败（退出码 ${result.status ?? 'unknown'}）。`).trim())
}

export const generateSshKeyPair = (userId: string) => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vibemux-ssh-'))
  const keyPath = path.join(tempDir, 'git-identity')
  const comment = `wemux-user-${userId}`

  try {
    runSshKeygen(['-t', 'ed25519', '-C', comment, '-f', keyPath, '-N', ''])

    const privateKey = readFileSync(keyPath, 'utf8').trim()
    const publicKey = readFileSync(`${keyPath}.pub`, 'utf8').trim()
    const fingerprintOutput = runSshKeygen(['-lf', `${keyPath}.pub`])
    const fingerprint = fingerprintOutput.split(/\s+/)[1] || ''

    if (!fingerprint) {
      throw new Error('SSH 指纹生成失败。')
    }

    return {
      publicKey,
      privateKey,
      fingerprint,
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}
