/**
 * [INPUT]: A server-delivered SSH private key, Git host, optional repository URL, and worker storage root.
 * [OUTPUT]: A normalized SSH identity or repository-access verification result without secret material.
 * [POS]: Worker execution boundary for proving that persisted Git SSH credentials work on the real node.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { buildGitSshCommandArgs, createGitAuthContext, isSshGitRemoteUrl, resolveGitRemoteHost } from '@shared/git-auth'
import type { SshVerificationResult } from '@shared/types'
import { getWorkerNodeDir } from '../core/config'
import { normalizeFilesystemPath } from './local-git-repository'

type CommandResult = {
  status: number | null
  stdout: string
  stderr: string
  error?: Error
  timedOut?: boolean
}

type RunCommand = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number },
) => Promise<CommandResult>

const execFileAsync = promisify(execFile)

type ExecFileFailure = Error & {
  code?: number | string
  killed?: boolean
  stdout?: string
  stderr?: string
}

const runCommand: RunCommand = async (command, args, options) => {
  try {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      env: options.env,
      timeout: options.timeout,
      maxBuffer: 1024 * 1024,
    })
    return {
      status: 0,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    }
  } catch (error) {
    const failure = error as ExecFileFailure
    return {
      status: typeof failure.code === 'number' ? failure.code : null,
      stdout: failure.stdout || '',
      stderr: failure.stderr || '',
      error: typeof failure.code === 'number' ? undefined : failure,
      timedOut: Boolean(failure.killed),
    }
  }
}

const resolveSshEndpoint = (host: string, repoUrl?: string, requestedUser = 'git') => {
  if (repoUrl?.trim().startsWith('ssh://')) {
    const parsed = new URL(repoUrl.trim())
    return {
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      sshUser: decodeURIComponent(parsed.username) || requestedUser,
    }
  }

  const normalizedHost = host.trim().toLowerCase()
  const parsed = new URL(`ssh://${normalizedHost}`)
  return {
    hostname: parsed.hostname,
    port: parsed.port || undefined,
    sshUser: requestedUser,
  }
}

export const isSshPublicKeyAuthenticationSuccess = (output: string) => (
  /authenticated to .* using ["']?publickey["']?/i.test(output)
  || /authentication succeeded \(publickey\)/i.test(output)
)

const toFailureMessage = (result: CommandResult, repoUrl?: string) => {
  const detail = `${result.stderr}\n${result.stdout}`.trim().toLowerCase()
  if (result.timedOut || result.error?.message.includes('ETIMEDOUT')) {
    return 'SSH 验证超时，请检查 Worker 到 Git Host 的网络连接。'
  }
  if (result.error) {
    return result.error.message.includes('ENOENT')
      ? 'Worker 缺少 Git 或 OpenSSH 客户端，无法执行 SSH 验证。'
      : 'Worker 无法执行 SSH 验证，请检查节点运行环境。'
  }
  if (detail.includes('permission denied (publickey)')) {
    return 'SSH 公钥认证失败，请确认已将该公钥添加到 Git 平台账号。'
  }
  if (detail.includes('host key verification failed') || detail.includes('remote host identification has changed')) {
    return 'Git Host Key 校验失败，服务器身份可能已变化，请检查 Worker 的 known_hosts。'
  }
  if (repoUrl && (
    detail.includes('repository not found')
    || detail.includes('repository does not exist')
    || detail.includes('could not read from remote repository')
  )) {
    return 'SSH 身份有效，但无权读取该仓库或仓库地址不存在。'
  }
  if (detail.includes('could not resolve hostname')) {
    return '无法解析 Git Host，请检查 Host 配置和 Worker 网络。'
  }
  if (detail.includes('connection timed out') || detail.includes('connection refused')) {
    return '无法连接 Git SSH 服务，请检查 Host、端口和 Worker 网络。'
  }
  return repoUrl ? 'SSH 仓库访问验证失败。' : 'SSH 身份验证失败。'
}

export const verifyGitSshCredential = async (params: {
  host: string
  privateKey: string
  repoUrl?: string
  sshUser?: string
  workspaceRoot: string
  run?: RunCommand
}): Promise<SshVerificationResult> => {
  const host = params.host.trim().toLowerCase()
  const sshUser = params.sshUser?.trim() || 'git'
  const repoUrl = params.repoUrl?.trim() || undefined
  if (!host || !params.privateKey.trim()) {
    return { ok: false, host, sshUser, repoUrl, message: 'SSH Host 或私钥缺失。' }
  }
  if (repoUrl && (!isSshGitRemoteUrl(repoUrl) || resolveGitRemoteHost(repoUrl) !== host)) {
    return { ok: false, host, sshUser, repoUrl, message: 'SSH 凭证与仓库 URL 的协议或 Host 不匹配。' }
  }

  let endpoint: ReturnType<typeof resolveSshEndpoint>
  try {
    endpoint = resolveSshEndpoint(host, repoUrl, sshUser)
  } catch {
    return { ok: false, host, sshUser, repoUrl, message: 'SSH Host 格式不正确。' }
  }

  const knownHostsFile = path.join(
    // known_hosts 是节点级 cache：固定落机器级 workerHome，不随 workspaceRoot（云节点 R2 挂载）走
    normalizeFilesystemPath(getWorkerNodeDir()),
    'cache',
    'git',
    'known_hosts',
  )
  const execute = params.run ?? runCommand
  let context: ReturnType<typeof createGitAuthContext> | undefined

  try {
    context = createGitAuthContext({
      taskId: `ssh-verify-${randomUUID()}`,
      identity: {
        mode: 'personal',
        authMode: 'ssh',
        credentialToken: params.privateKey,
      },
      repoUrl,
      knownHostsFile,
    })
    if (!context.sshKeyFile || !context.knownHostsFile) {
      return { ok: false, host, sshUser: endpoint.sshUser, repoUrl, message: 'SSH 临时凭证准备失败。' }
    }

    const result = repoUrl
      ? await execute('git', ['ls-remote', repoUrl], { env: context.env, timeout: 20000 })
      : await execute('ssh', [
          '-v',
          '-T',
          ...buildGitSshCommandArgs(context.sshKeyFile, context.knownHostsFile),
          ...(endpoint.port ? ['-p', endpoint.port] : []),
          `${endpoint.sshUser}@${endpoint.hostname}`,
        ], { env: context.env, timeout: 15000 })

    const output = `${result.stderr}\n${result.stdout}`
    const ok = repoUrl ? result.status === 0 : result.status === 0 || isSshPublicKeyAuthenticationSuccess(output)
    return {
      ok,
      host,
      sshUser: endpoint.sshUser,
      repoUrl,
      message: ok
        ? repoUrl
          ? 'SSH 身份和仓库读取权限验证通过。'
          : 'SSH 公钥身份验证通过。'
        : toFailureMessage(result, repoUrl),
    }
  } catch {
    return {
      ok: false,
      host,
      sshUser: endpoint.sshUser,
      repoUrl,
      message: 'Worker 无法准备 SSH 验证环境，请检查节点存储权限和运行状态。',
    }
  } finally {
    context?.cleanup()
  }
}
