// [INPUT]: SSH 密钥操作输入
// [OUTPUT]: 密钥管理
// [POS]: SSH 密钥管理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const SSH_DIR = path.join(os.homedir(), '.ssh')
const DEFAULT_PUBLIC_KEY_CANDIDATES = ['id_ed25519.pub', 'id_rsa.pub', 'id_ecdsa.pub']
const WORKER_KEY_BASENAME = 'wemux_worker_ed25519'

const generateWorkerSshKey = (privateKeyPath: string) => {
  mkdirSync(path.dirname(privateKeyPath), { recursive: true })
  const result = spawnSync('ssh-keygen', ['-t', 'ed25519', '-C', 'wemux-worker', '-f', privateKeyPath, '-N', ''], {
    encoding: 'utf8',
  })

  if (result.status === 0) {
    return
  }

  throw new Error((result.stderr || result.stdout || 'ssh-keygen 执行失败。').trim())
}

export const getWorkerSshPublicKey = () => {
  try {
    for (const candidate of DEFAULT_PUBLIC_KEY_CANDIDATES) {
      const publicKeyPath = path.join(SSH_DIR, candidate)
      if (!existsSync(publicKeyPath)) {
        continue
      }

      return readFileSync(publicKeyPath, 'utf8').trim()
    }

    const workerPrivateKeyPath = path.join(SSH_DIR, WORKER_KEY_BASENAME)
    const workerPublicKeyPath = `${workerPrivateKeyPath}.pub`
    if (!existsSync(workerPublicKeyPath)) {
      generateWorkerSshKey(workerPrivateKeyPath)
    }

    return existsSync(workerPublicKeyPath)
      ? readFileSync(workerPublicKeyPath, 'utf8').trim()
      : undefined
  } catch {
    return undefined
  }
}
