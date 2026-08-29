/**
 * [INPUT]: Repository URLs, task-scoped Git identities, and ambient process environment.
 * [OUTPUT]: Safe Git authentication environments, SSH command construction, and normalized errors.
 * [POS]: Shared Git authentication boundary consumed by server and worker Git operations.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rootCertificates } from 'node:tls'
import type { GitProvider, TaskRuntimeGitIdentity } from './types'

const escapeJsString = (value: string) => value
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$/g, '\\$')

export const resolveGitRemoteHost = (repoUrl?: string) => {
  const trimmed = repoUrl?.trim() || ''
  if (!trimmed) {
    return null
  }

  const sshMatch = trimmed.includes('://')
    ? null
    : /^[^@/]+@([^:/?#]+):/i.exec(trimmed)
  if (sshMatch?.[1]) {
    return sshMatch[1].toLowerCase()
  }

  try {
    return new URL(trimmed).host.toLowerCase()
  } catch {
    return null
  }
}

export const isSshGitRemoteUrl = (repoUrl?: string) => {
  const trimmed = repoUrl?.trim() || ''
  if (!trimmed) {
    return false
  }

  if (/^[^@/]+@[^:/?#]+:/i.test(trimmed)) {
    return true
  }

  try {
    return new URL(trimmed).protocol === 'ssh:'
  } catch {
    return false
  }
}

const resolveProviderHost = (repoUrl?: string) => {
  const host = resolveGitRemoteHost(repoUrl)
  if (!host) {
    return null
  }

  try {
    return new URL(`ssh://${host}`).hostname.toLowerCase()
  } catch {
    return host.toLowerCase().replace(/:\d+$/, '')
  }
}

export const resolveGitProviderFromUrl = (repoUrl?: string): GitProvider | null => {
  const host = resolveProviderHost(repoUrl)
  if (!host) {
    return null
  }

  if (host === 'github.com' || host.endsWith('.github.com')) {
    return 'github'
  }

  if (host === 'gitlab.com' || host.endsWith('.gitlab.com') || host.includes('gitlab')) {
    return 'gitlab'
  }

  return 'generic'
}

const resolvePatUsername = (repoUrl: string | undefined, identity: TaskRuntimeGitIdentity) => {
  const provider = identity.provider ?? resolveGitProviderFromUrl(repoUrl)
  if (provider === 'github') {
    return 'x-access-token'
  }

  if (provider === 'gitlab') {
    return 'oauth2'
  }

  return identity.email?.trim() || identity.name?.trim() || 'git'
}

const resolveGitProviderLabel = (repoUrl?: string) => {
  const provider = resolveGitProviderFromUrl(repoUrl)
  if (provider === 'github') {
    return 'GitHub'
  }

  if (provider === 'gitlab') {
    return 'GitLab'
  }

  return 'Git'
}

const isGitCredentialErrorMessage = (message: string) => {
  const normalizedMessage = message.trim().toLowerCase()
  if (!normalizedMessage) {
    return false
  }

  return [
    'terminal prompts disabled',
    'could not read username',
    'could not read password',
    'authentication failed',
    'http basic: access denied',
    'invalid username or password',
    'invalid username or token',
    'support for password authentication was removed',
    'permission denied (publickey)',
    'write access to repository not granted',
    'the requested url returned error: 403',
  ].some((pattern) => normalizedMessage.includes(pattern))
}

const isGitCertificateErrorMessage = (message: string) => {
  const normalizedMessage = message.trim().toLowerCase()
  if (!normalizedMessage) {
    return false
  }

  return [
    'server certificate verification failed',
    'ssl certificate problem',
    'unable to get local issuer certificate',
    'peer certificate cannot be authenticated',
    'self-signed certificate',
    'certificate has expired',
    'schannel: ',
  ].some((pattern) => normalizedMessage.includes(pattern))
}

export const rewriteGitCredentialError = (error: unknown, repoUrl?: string) => {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : ''

  if (isGitCertificateErrorMessage(message)) {
    const providerLabel = resolveGitProviderLabel(repoUrl)
    return new Error(`当前节点的 Git 无法验证 ${providerLabel} 仓库的 HTTPS 证书，请检查该节点的系统根证书、Git 的 http.sslCAInfo / GIT_SSL_CAINFO / SSL_CERT_FILE 配置，或改用 SSH 仓库地址。`)
  }

  if (!isGitCredentialErrorMessage(message)) {
    return error instanceof Error ? error : new Error(message || 'Git 操作失败。')
  }

  const providerLabel = resolveGitProviderLabel(repoUrl)
  return new Error(`当前凭证无法访问 ${providerLabel} 仓库，请确认已在设置页配置 PAT（或验证 SSH 身份），并且该凭证对目标仓库有读取权限。`)
}

const createAskPassScript = (tempDir: string, identity: TaskRuntimeGitIdentity, repoUrl?: string) => {
  const username = resolvePatUsername(repoUrl, identity)
  const password = identity.credentialToken || ''
  const scriptPath = path.join(tempDir, 'git-askpass.js')
  const script = `#!/usr/bin/env node
const prompt = (process.argv[2] || '').toLowerCase()
if (prompt.includes('username')) {
  process.stdout.write(\`${escapeJsString(username)}\`)
  process.exit(0)
}
if (prompt.includes('password')) {
  process.stdout.write(\`${escapeJsString(password)}\`)
  process.exit(0)
}
process.stdout.write(\`${escapeJsString(password)}\`)
`
  writeFileSync(scriptPath, script, { encoding: 'utf8', mode: 0o700 })
  chmodSync(scriptPath, 0o700)
  return scriptPath
}

const quoteSshCommandValue = (value: string) => `"${value.replace(/([\\"$`])/g, '\\$1')}"`

export const buildGitSshCommandArgs = (keyFile: string, knownHostsFile: string) => [
  '-i',
  keyFile,
  '-o',
  'BatchMode=yes',
  '-o',
  'IdentitiesOnly=yes',
  '-o',
  'PreferredAuthentications=publickey',
  '-o',
  'StrictHostKeyChecking=accept-new',
  '-o',
  `UserKnownHostsFile=${knownHostsFile}`,
]

export const createSshCommand = (keyFile: string, knownHostsFile: string) => [
  'ssh',
  ...buildGitSshCommandArgs(keyFile, knownHostsFile).map(quoteSshCommandValue),
].join(' ')

const UNSAFE_AMBIENT_GIT_ENV_KEYS = new Set([
  'EDITOR',
  'GIT_ASKPASS',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_EDITOR',
  'GIT_EXEC_PATH',
  'GIT_EXTERNAL_DIFF',
  'GIT_PAGER',
  'GIT_PROXY_COMMAND',
  'GIT_SEQUENCE_EDITOR',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_TEMPLATE_DIR',
  'PAGER',
  'PREFIX',
  'SSH_ASKPASS',
])

const GIT_CA_BUNDLE_PATH_CANDIDATES = [
  '/etc/ssl/cert.pem',
  '/etc/ssl/certs/ca-certificates.crt',
  '/etc/pki/tls/certs/ca-bundle.crt',
  '/etc/ssl/ca-bundle.pem',
  '/usr/local/etc/openssl@3/cert.pem',
  '/opt/homebrew/etc/openssl@3/cert.pem',
  '/usr/local/etc/openssl/cert.pem',
  '/opt/homebrew/etc/openssl/cert.pem',
] as const
const GENERATED_GIT_CA_BUNDLE_PATH = path.join(os.tmpdir(), 'vibemux-git', 'generated-ca-bundle.pem')

const isUnsafeAmbientGitEnvKey = (key: string) => {
  const normalizedKey = key.toUpperCase()
  return UNSAFE_AMBIENT_GIT_ENV_KEYS.has(normalizedKey)
    || normalizedKey.startsWith('GIT_CONFIG_KEY_')
    || normalizedKey.startsWith('GIT_CONFIG_VALUE_')
}

const hasConfiguredGitCaBundle = (env: NodeJS.ProcessEnv) => {
  return Boolean(
    env.GIT_SSL_CAINFO?.trim()
    || env.SSL_CERT_FILE?.trim()
    || env.CURL_CA_BUNDLE?.trim()
  )
}

const ensureGeneratedGitCaBundle = (bundlePath = GENERATED_GIT_CA_BUNDLE_PATH) => {
  if (existsSync(bundlePath)) {
    return bundlePath
  }

  if (rootCertificates.length < 1) {
    return ''
  }

  mkdirSync(path.dirname(bundlePath), { recursive: true })
  writeFileSync(bundlePath, `${rootCertificates.join('\n')}\n`, 'utf8')
  return bundlePath
}

export const resolveGitCertificateAuthorityEnv = (
  source: NodeJS.ProcessEnv = process.env,
  candidatePaths: readonly string[] = GIT_CA_BUNDLE_PATH_CANDIDATES,
  generatedBundlePath = GENERATED_GIT_CA_BUNDLE_PATH,
) => {
  if (hasConfiguredGitCaBundle(source)) {
    return {}
  }

  const certificateBundlePath = candidatePaths.find((candidatePath) => existsSync(candidatePath))
    || ensureGeneratedGitCaBundle(generatedBundlePath)
  if (!certificateBundlePath) {
    return {}
  }

  return {
    GIT_SSL_CAINFO: certificateBundlePath,
    SSL_CERT_FILE: certificateBundlePath,
    CURL_CA_BUNDLE: certificateBundlePath,
  } satisfies Partial<NodeJS.ProcessEnv>
}

export const createSafeGitProcessEnv = (source: NodeJS.ProcessEnv = process.env) => {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && !isUnsafeAmbientGitEnvKey(key)) {
      env[key] = value
    }
  }
  Object.assign(env, resolveGitCertificateAuthorityEnv(source))
  return env
}

export const getSimpleGitOptionsForEnv = (env?: NodeJS.ProcessEnv) => {
  const unsafe: Record<string, boolean> = {}

  if (env?.GIT_ASKPASS || env?.SSH_ASKPASS) {
    unsafe.allowUnsafeAskPass = true
  }

  if (env?.GIT_SSH || env?.GIT_SSH_COMMAND) {
    unsafe.allowUnsafeSshCommand = true
  }

  return Object.keys(unsafe).length > 0 ? { unsafe } : {}
}

export type GitAuthContext = {
  env: NodeJS.ProcessEnv
  tempDir: string
  sshKeyFile?: string
  knownHostsFile?: string
  cleanup: () => void
}

export const createGitAuthContext = (params: {
  taskId: string
  identity: TaskRuntimeGitIdentity
  repoUrl?: string
  knownHostsFile?: string
}): GitAuthContext => {
  const tempDir = path.join(os.tmpdir(), 'vibemux-git', params.taskId)
  mkdirSync(tempDir, { recursive: true })

  const env = createSafeGitProcessEnv()
  env.GIT_TERMINAL_PROMPT = '0'

  let sshKeyFile: string | undefined
  let knownHostsFile: string | undefined
  if (params.identity.authMode === 'ssh' && params.identity.credentialToken) {
    const keyFile = path.join(tempDir, 'id_ed25519')
    knownHostsFile = params.knownHostsFile ?? path.join(tempDir, 'known_hosts')
    mkdirSync(path.dirname(knownHostsFile), { recursive: true })
    if (!existsSync(knownHostsFile)) {
      writeFileSync(knownHostsFile, '', { encoding: 'utf8', mode: 0o600 })
    }
    writeFileSync(keyFile, params.identity.credentialToken, { encoding: 'utf8', mode: 0o600 })
    chmodSync(keyFile, 0o600)
    chmodSync(knownHostsFile, 0o600)
    env.GIT_SSH_COMMAND = createSshCommand(keyFile, knownHostsFile)
    sshKeyFile = keyFile
  } else if (params.identity.credentialToken) {
    env.GIT_ASKPASS = createAskPassScript(tempDir, params.identity, params.repoUrl)
  }

  return {
    env,
    tempDir,
    sshKeyFile,
    knownHostsFile,
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true })
    },
  }
}
