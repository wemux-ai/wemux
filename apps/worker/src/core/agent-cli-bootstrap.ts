/**
 * [INPUT]: Worker-managed agent CLI configuration, credentials, and host command availability.
 * [OUTPUT]: Runtime capability checks, authentication probes, and install strategies.
 * [POS]: Worker runtime bootstrap boundary; diagnostic logs stay on stderr to preserve command stdout contracts.
 * [PROTOCOL]: Update this header when responsibilities change, then check AGENTS.md.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { loadWorkerConfig } from './config'
import { getCommandDetail, hasCommand, resolveExecutable, runCommand, runPrivilegedCommand, shouldSpawnWithShellOnWindows } from './command-utils'
import type { InstallAttempt, InstallExecutionOptions, InstallStrategy, RuntimeCheck, RuntimeRequirementId } from './runtime-bootstrap-types'
import { ensureCodexProviderEnvKeyInConfig, ensureCodexProviderNameInConfig, hasCodexAuthDotJsonContent, hasLegacyCodexAccessTokenContent, parseCodexCredentialEnvironment, resolveCodexProviderConfig } from '../execution/codex-models'

const INSTALL_TIMEOUT_MS = 15 * 60 * 1000

/**
 * codex >= 0.41.0 uses 'proto' for stdin/stdout JSON-RPC.
 * Older versions use 'app-server'.
 */
let cachedProtoSupported: boolean | null = null
const isCodexProtoSupported = (executable: string): boolean => {
  if (cachedProtoSupported !== null) return cachedProtoSupported
  try {
    const result = spawnSync(executable, ['--help'], {
      encoding: 'utf8',
      timeout: 5000,
      shell: shouldSpawnWithShellOnWindows(executable),
    })
    cachedProtoSupported = result.stdout?.includes('proto') ?? false
  } catch {
    cachedProtoSupported = false
  }
  return cachedProtoSupported
}
const AUTH_TIMEOUT_MS = 15000

const getClaudeHome = () => process.env.CLAUDE_HOME?.trim() || path.join(os.homedir(), '.claude')

const logWorkerCodexBootstrapDebug = (stage: string, payload: Record<string, unknown>) => {
  console.error('[worker-codex-bootstrap]', stage, JSON.stringify(payload))
}

type CodexAuthProbeEnvironment = {
  env: NodeJS.ProcessEnv
  cleanup: () => void
  metadata: {
    providerId: string
    providerEnvKey: string
    configPresent: boolean
    providerNameAdded: boolean
    providerEnvKeyAdded: boolean
    managedCredentialEnvKeys: string[]
    usingLegacyAuthJson: boolean
    usingOauthAuthJson: boolean
  }
}

const createCodexAuthProbeEnvironment = () => {
  const config = loadWorkerConfig()
  const managedCredentialEnv = parseCodexCredentialEnvironment(config.codexAuthContent)
  const managedCredentialEnvKeys = Object.keys(managedCredentialEnv).sort()
  const rawManagedConfig = config.codexConfigContent?.trim() || ''
  const resolvedProvider = resolveCodexProviderConfig({
    configContent: rawManagedConfig,
    authContent: config.codexAuthContent,
  })
  const managedConfig = ensureCodexProviderNameInConfig(rawManagedConfig, resolvedProvider.providerId)
  const managedEnvKeyConfig = ensureCodexProviderEnvKeyInConfig(
    managedConfig.content,
    resolvedProvider.providerId,
    resolvedProvider.envKey,
  )
  const usingLegacyAuthJson = hasLegacyCodexAccessTokenContent(config.codexAuthContent)
  const usingOauthAuthJson = hasCodexAuthDotJsonContent(config.codexAuthContent)

  if (managedCredentialEnvKeys.length === 0 && !usingOauthAuthJson) {
    logWorkerCodexBootstrapDebug('auth-probe:env-skipped', {
      providerId: resolvedProvider.providerId,
      providerEnvKey: resolvedProvider.envKey,
      configPresent: Boolean(rawManagedConfig),
      providerNameAdded: managedConfig.changed,
      providerEnvKeyAdded: managedEnvKeyConfig.changed,
      managedCredentialEnvKeys,
      usingLegacyAuthJson,
      usingOauthAuthJson,
      reason: 'no-managed-credential-env',
    })
    return null
  }

  const runtimeRoot = mkdtempSync(path.join(os.tmpdir(), 'vibemux-codex-auth-'))

  if (managedEnvKeyConfig.content) {
    writeFileSync(path.join(runtimeRoot, 'config.toml'), `${managedEnvKeyConfig.content}\n`, 'utf8')
  }

  if (usingLegacyAuthJson || usingOauthAuthJson) {
    writeFileSync(path.join(runtimeRoot, 'auth.json'), `${config.codexAuthContent?.trim() || ''}\n`, 'utf8')
  }

  const metadata = {
    providerId: resolvedProvider.providerId,
    providerEnvKey: resolvedProvider.envKey,
    configPresent: Boolean(rawManagedConfig),
    providerNameAdded: managedConfig.changed,
    providerEnvKeyAdded: managedEnvKeyConfig.changed,
    managedCredentialEnvKeys,
    usingLegacyAuthJson,
    usingOauthAuthJson,
  }

  logWorkerCodexBootstrapDebug('auth-probe:env-created', {
    ...metadata,
    runtimeRoot,
  })

  return {
    env: {
      ...process.env,
      CODEX_HOME: runtimeRoot,
      ...managedCredentialEnv,
    },
    metadata,
    cleanup: () => {
      // Windows 上 codex 子进程退出后，goals_1.sqlite 等文件句柄释放有延迟，
      // 立即 rmSync 可能 EBUSY。retry 几次；仍失败就静默——这只是临时探测目录，
      // 残留不影响功能，OS 会在重启后释放。
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          rmSync(runtimeRoot, { recursive: true, force: true })
          return
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') {
            throw error
          }
        }
      }
    },
  } satisfies CodexAuthProbeEnvironment
}

const getRequirementLabel = (id: RuntimeRequirementId) => {
  if (id === 'codex-cli') return 'Codex CLI'
  if (id === 'codex-auth') return 'Codex 登录'
  if (id === 'claude-cli') return 'Claude Code CLI'
  if (id === 'claude-auth') return 'Claude Code 认证'
  return id
}

const buildAttempt = (
  id: RuntimeRequirementId,
  strategy: Pick<InstallStrategy, 'installer' | 'commandSummary'> | null,
  attempt: Pick<InstallAttempt, 'ok' | 'changed' | 'detail' | 'skipped'>,
): InstallAttempt => {
  return {
    id,
    label: getRequirementLabel(id),
    ok: attempt.ok,
    changed: attempt.changed,
    detail: attempt.detail,
    skipped: attempt.skipped,
    installer: strategy?.installer,
    commandSummary: strategy?.commandSummary,
  }
}

const runGlobalNodeInstall = (
  packageName: string,
  commandSummary: string,
  strategyName: string,
  id: RuntimeRequirementId,
  fallbackDetail: string,
  options?: InstallExecutionOptions,
) => {
  const strategy = { installer: strategyName, commandSummary }
  let result = runCommand('npm', ['install', '-g', packageName], {
    streamOutput: options?.streamOutput,
    timeout: INSTALL_TIMEOUT_MS,
  })

  if (!result.ok && process.platform !== 'win32') {
    result = runPrivilegedCommand('npm', ['install', '-g', packageName], INSTALL_TIMEOUT_MS, options)
  }

  return buildAttempt(id, strategy, {
    ok: result.ok,
    changed: result.ok,
    detail: result.ok ? `${commandSummary} 完成。` : getCommandDetail(result, fallbackDetail),
  })
}

const resolveCodexInstallStrategy = (): InstallStrategy | null => {
  if (!hasCommand('npm')) {
    return null
  }

  return {
    installer: 'npm',
    commandSummary: 'npm install -g @openai/codex',
    manualHint: '请先安装 Node.js/npm，然后执行 `npm install -g @openai/codex`。',
    run(options) {
      return runGlobalNodeInstall(
        '@openai/codex',
        'npm install -g @openai/codex',
        'npm',
        'codex-cli',
        '安装 Codex CLI 失败',
        options,
      )
    },
  }
}

const resolveClaudeInstallStrategy = (): InstallStrategy | null => {
  if (process.platform === 'darwin' && hasCommand('brew')) {
    return {
      installer: 'brew',
      commandSummary: 'brew install --cask claude-code',
      manualHint: '请先执行 `brew install --cask claude-code`，然后运行 `claude` 完成登录。',
      run(options) {
        const strategy = { installer: 'brew', commandSummary: 'brew install --cask claude-code' }
        const result = runCommand('brew', ['install', '--cask', 'claude-code'], {
          streamOutput: options?.streamOutput,
          timeout: INSTALL_TIMEOUT_MS,
        })
        return buildAttempt('claude-cli', strategy, {
          ok: result.ok,
          changed: result.ok,
          detail: getCommandDetail(result, '安装 Claude Code CLI 失败'),
        })
      },
    }
  }

  if (process.platform === 'win32' && hasCommand('winget')) {
    return {
      installer: 'winget',
      commandSummary: 'winget install Anthropic.ClaudeCode',
      manualHint: '请先执行 `winget install Anthropic.ClaudeCode`，然后运行 `claude` 完成登录。',
      run(options) {
        const strategy = { installer: 'winget', commandSummary: 'winget install Anthropic.ClaudeCode' }
        const result = runCommand(
          'winget',
          ['install', '--id', 'Anthropic.ClaudeCode', '--exact', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements'],
          {
            streamOutput: options?.streamOutput,
            timeout: INSTALL_TIMEOUT_MS,
          },
        )
        return buildAttempt('claude-cli', strategy, {
          ok: result.ok,
          changed: result.ok,
          detail: getCommandDetail(result, '安装 Claude Code CLI 失败'),
        })
      },
    }
  }

  if (hasCommand('npm')) {
    return {
      installer: 'npm',
      commandSummary: 'npm install -g @anthropic-ai/claude-code',
      manualHint: '请先安装 Node.js/npm，然后执行 `npm install -g @anthropic-ai/claude-code`。',
      run(options) {
        return runGlobalNodeInstall(
          '@anthropic-ai/claude-code',
          'npm install -g @anthropic-ai/claude-code',
          'npm',
          'claude-cli',
          '安装 Claude Code CLI 失败',
          options,
        )
      },
    }
  }

  if (process.platform !== 'win32' && hasCommand('bash') && hasCommand('curl')) {
    return {
      installer: 'install.sh',
      commandSummary: 'curl -fsSL https://claude.ai/install.sh | bash',
      manualHint: '请执行 `curl -fsSL https://claude.ai/install.sh | bash`，然后运行 `claude` 完成登录。',
      run(options) {
        const strategy = { installer: 'install.sh', commandSummary: 'curl -fsSL https://claude.ai/install.sh | bash' }
        const result = runCommand('bash', ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'], {
          streamOutput: options?.streamOutput,
          timeout: INSTALL_TIMEOUT_MS,
        })
        return buildAttempt('claude-cli', strategy, {
          ok: result.ok,
          changed: result.ok,
          detail: getCommandDetail(result, '安装 Claude Code CLI 失败'),
        })
      },
    }
  }

  return null
}

const checkCodexCli = (): RuntimeCheck => {
  const executable = resolveExecutable('codex')
  const version = executable ? runCommand(executable, ['--version']) : null
  const strategy = resolveCodexInstallStrategy()

  return {
    id: 'codex-cli',
    label: 'Codex CLI',
    ok: Boolean(executable && version?.ok),
    detail: executable && version?.ok ? version.stdout || executable : '未检测到 `codex` 可执行文件。',
    autoInstallable: Boolean(strategy),
    installer: strategy?.installer,
    installCommand: strategy?.commandSummary,
    hint: strategy?.manualHint || '请先安装 Codex CLI，并确认 `codex` 已进入 PATH。',
  }
}

const checkCodexAuth = async (): Promise<RuntimeCheck> => {
  const executable = resolveExecutable('codex')
  if (!executable) {
    return {
      id: 'codex-auth',
      label: 'Codex 登录',
      ok: false,
      detail: '未检测到 `codex`，暂时无法检查登录状态。',
      autoInstallable: false,
      hint: '请先安装 Codex CLI，再运行 `codex` 完成登录。',
    }
  }

  const probeEnvironment = createCodexAuthProbeEnvironment()
  const managedCredentialEnvKeys = probeEnvironment?.metadata.managedCredentialEnvKeys ?? []

  logWorkerCodexBootstrapDebug('auth-probe:start', {
    executable,
    usingManagedProbeEnvironment: Boolean(probeEnvironment),
    providerId: probeEnvironment?.metadata.providerId || '',
    providerEnvKey: probeEnvironment?.metadata.providerEnvKey || '',
    configPresent: probeEnvironment?.metadata.configPresent ?? false,
    providerNameAdded: probeEnvironment?.metadata.providerNameAdded ?? false,
    providerEnvKeyAdded: probeEnvironment?.metadata.providerEnvKeyAdded ?? false,
    managedCredentialEnvKeys,
    usingLegacyAuthJson: probeEnvironment?.metadata.usingLegacyAuthJson ?? false,
    usingOauthAuthJson: probeEnvironment?.metadata.usingOauthAuthJson ?? false,
  })

  const useProto = isCodexProtoSupported(executable)
  const codexSubcommand = useProto ? 'proto' : 'app-server'

  const result = await (async () => {
    try {
      return await new Promise<{ ok: boolean; detail: string }>((resolve) => {
        const child = spawn(executable, [codexSubcommand], {
          env: probeEnvironment?.env ?? process.env,
          stdio: ['pipe', 'pipe', 'pipe'] as const,
          shell: shouldSpawnWithShellOnWindows(executable),
        })
        let stdoutBuffer = ''
        let stderrBuffer = ''
        let settled = false
        let pendingResolve: (() => void) | null = null
        let requestId = 0
        let initializeRequestId = -1
        let accountRequestId = -1

        const finalize = (payload: { ok: boolean; detail: string }) => {
          if (settled) {
            return
          }

          settled = true
          clearTimeout(timer)
          if (!child.killed) {
            child.kill('SIGTERM')
          }

          // 等子进程真正退出后再 resolve —— Windows 上 codex 会在 CODEX_HOME 下建
          // goals_1.sqlite 等文件，SIGTERM 后文件句柄还没释放就 rmSync 会 EBUSY。
          // 让 finalize 的 resolve 在 child 'close' 之后触发，保证 finally 里的
          // cleanup() 执行时进程已退出、文件锁已释放。
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve(payload)
            return
          }

          pendingResolve = () => {
            pendingResolve = null
            resolve(payload)
          }

          // 兜底：若 SIGTERM 后 2s 子进程仍未退出（卡住），不再死等，直接 resolve。
          // cleanup 会容忍 EBUSY/EPERM，避免登录探测因为临时文件锁阻塞 worker 启动。
          setTimeout(() => {
            if (pendingResolve) {
              pendingResolve()
            }
          }, 2000)
        }

        const send = (payload: unknown) => {
          child.stdin.write(`${JSON.stringify(payload)}\n`)
        }

        const timer = setTimeout(() => {
          logWorkerCodexBootstrapDebug('auth-probe:timeout', {
            providerId: probeEnvironment?.metadata.providerId || '',
            managedCredentialEnvKeys,
            protocol: useProto ? 'proto' : 'app-server',
          })
          finalize({ ok: false, detail: 'Codex 登录状态检查超时。' })
        }, AUTH_TIMEOUT_MS)

        const requestAccount = () => {
          requestId += 1
          accountRequestId = requestId
          send({
            jsonrpc: '2.0',
            id: requestId,
            method: 'account/read',
            params: { refreshToken: false },
          })
        }

        const handleLine = (line: string) => {
          const trimmed = line.trim()
          if (!trimmed) return

          try {
            const payload = JSON.parse(trimmed) as {
              id?: number | string
              msg?: { type?: string }
              error?: { message?: string }
              result?: { account?: unknown | null; requiresOpenaiAuth?: boolean }
            }

            if (payload.error?.message) {
              logWorkerCodexBootstrapDebug('auth-probe:rpc-error', {
                requestId: payload.id ?? null,
                message: payload.error.message,
              })
              finalize({ ok: false, detail: payload.error.message })
              return
            }

            // New proto protocol (>= 0.41.0): session_configured means codex is ready
            if (useProto && payload.msg?.type === 'session_configured') {
              logWorkerCodexBootstrapDebug('auth-probe:decision', {
                ok: true,
                reason: 'proto-session-configured',
                providerId: probeEnvironment?.metadata.providerId || '',
                managedCredentialEnvKeys,
              })
              finalize({ ok: true, detail: 'Codex proto 会话已建立。' })
              return
            }

            // Old app-server protocol: JSON-RPC id-matched responses
            if (!useProto && payload.result && typeof payload.id !== 'undefined') {
              if (payload.id === initializeRequestId) {
                logWorkerCodexBootstrapDebug('auth-probe:initialized', {
                  providerId: probeEnvironment?.metadata.providerId || '',
                })
                send({ jsonrpc: '2.0', method: 'initialized' })
                requestAccount()
                return
              }

              if (payload.id === accountRequestId) {
                const hasAccount = Boolean(payload.result.account)
                const requiresOpenaiAuth = Boolean(payload.result.requiresOpenaiAuth)
                logWorkerCodexBootstrapDebug('auth-probe:account-result', {
                  providerId: probeEnvironment?.metadata.providerId || '',
                  hasAccount,
                  requiresOpenaiAuth,
                  managedCredentialEnvKeys,
                })

                if (requiresOpenaiAuth && !hasAccount) {
                  if (managedCredentialEnvKeys.length > 0) {
                    finalize({ ok: true, detail: 'Codex 已检测到运行时 provider 凭证。' })
                    return
                  }
                  finalize({ ok: false, detail: 'Codex 未登录，请先运行 `codex` 完成认证。' })
                  return
                }
                finalize({ ok: true, detail: 'Codex 登录状态正常。' })
                return
              }
            }
          } catch {
            // Not JSON, ignore
          }
        }

        child.stdout.on('data', (chunk: Buffer | string) => {
          stdoutBuffer += chunk.toString()
          const lines = stdoutBuffer.split('\n')
          stdoutBuffer = lines.pop() ?? ''
          for (const line of lines) handleLine(line)
        })

        child.stderr.on('data', (chunk: Buffer | string) => {
          stderrBuffer += chunk.toString()
        })

        child.on('error', (error) => {
          logWorkerCodexBootstrapDebug('auth-probe:process-error', {
            error: error instanceof Error ? error.message : 'Codex 登录检查失败。',
          })
          finalize({ ok: false, detail: error instanceof Error ? error.message : 'Codex 登录检查失败。' })
        })

        child.on('close', () => {
          // 子进程已退出：若有 finalize 排队的 resolve，现在触发（文件锁已释放）。
          if (pendingResolve) {
            pendingResolve()
            return
          }
          if (settled) return
          const detail = stderrBuffer.trim().split('\n').filter(Boolean).at(-1) || 'Codex 登录检查失败。'
          logWorkerCodexBootstrapDebug('auth-probe:process-close', { detail })
          finalize({ ok: false, detail })
        })

        // Send initialize
        requestId += 1
        initializeRequestId = requestId
        send({
          jsonrpc: '2.0',
          id: initializeRequestId,
          method: 'initialize',
          params: {
            clientInfo: { name: 'wemux-worker', version: '0.1.1' },
            capabilities: { experimentalApi: true },
          },
        })
      })
    } finally {
      probeEnvironment?.cleanup()
    }
  })()

  return {
    id: 'codex-auth',
    label: 'Codex 登录',
    ok: result.ok,
    detail: result.detail,
    autoInstallable: false,
    hint: result.ok ? undefined : '请先运行 `codex`，按提示完成登录后再重试。',
  }
}

const checkClaudeCli = (): RuntimeCheck => {
  const executable = resolveExecutable('claude')
  const version = executable ? runCommand(executable, ['--version']) : null
  const strategy = resolveClaudeInstallStrategy()

  return {
    id: 'claude-cli',
    label: 'Claude Code CLI',
    ok: Boolean(executable && version?.ok),
    detail: executable && version?.ok ? version.stdout || executable : '未检测到 `claude` 可执行文件。',
    autoInstallable: Boolean(strategy),
    installer: strategy?.installer,
    installCommand: strategy?.commandSummary,
    hint: strategy?.manualHint || '请先安装 Claude Code CLI，并确认 `claude` 已进入 PATH。',
  }
}

const hasClaudeSettingsCredential = (content: string) => {
  const trimmed = content.trim()
  if (!trimmed) {
    return false
  }

  try {
    const parsed = JSON.parse(trimmed) as { apiKeyHelper?: unknown; env?: Record<string, unknown> }
    const env = parsed.env && typeof parsed.env === 'object' ? parsed.env : undefined
    const token = typeof env?.ANTHROPIC_AUTH_TOKEN === 'string'
      ? env.ANTHROPIC_AUTH_TOKEN.trim()
      : typeof env?.ANTHROPIC_API_KEY === 'string'
        ? env.ANTHROPIC_API_KEY.trim()
        : ''
    return Boolean(token || (typeof parsed.apiKeyHelper === 'string' && parsed.apiKeyHelper.trim()))
  } catch {
    return false
  }
}

const hasClaudeCredentialHint = () => {
  if (process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
    return true
  }

  if (existsSync(path.join(getClaudeHome(), '.credentials.json'))) {
    return true
  }

  try {
    return hasClaudeSettingsCredential(loadWorkerConfig().claudeCodeConfigContent ?? '')
  } catch {
    return false
  }
}

const checkClaudeAuth = (): RuntimeCheck => {
  const executable = resolveExecutable('claude')
  if (!executable) {
    return {
      id: 'claude-auth',
      label: 'Claude Code 认证',
      ok: false,
      detail: '未检测到 `claude`，暂时无法检查认证状态。',
      autoInstallable: false,
      hint: '请先安装 Claude Code CLI，再配置 API 凭证或运行 `claude` 完成登录。',
    }
  }

  if (hasClaudeCredentialHint()) {
    return {
      id: 'claude-auth',
      label: 'Claude Code 认证',
      ok: true,
      detail: '检测到 Claude Code API / 凭证配置。',
      autoInstallable: false,
    }
  }

  const doctor = runCommand(executable, ['doctor'], { timeout: AUTH_TIMEOUT_MS })
  return {
    id: 'claude-auth',
    label: 'Claude Code 认证',
    ok: doctor.ok,
    detail: doctor.ok
      ? doctor.stdout || 'Claude Code doctor 检查通过。'
      : getCommandDetail(doctor, 'Claude Code doctor 检查失败。'),
    autoInstallable: false,
    hint: doctor.ok ? undefined : '请先配置 Claude Console / API 凭证，或运行 `claude` 完成登录后再重试。',
  }
}

export const inspectAgentCliRequirement = async (id: RuntimeRequirementId): Promise<RuntimeCheck | null> => {
  if (id === 'codex-cli') return checkCodexCli()
  if (id === 'codex-auth') return checkCodexAuth()
  if (id === 'claude-cli') return checkClaudeCli()
  if (id === 'claude-auth') return checkClaudeAuth()
  return null
}

export const getAgentCliInstallStrategy = (id: RuntimeRequirementId) => {
  if (id === 'codex-cli') return resolveCodexInstallStrategy()
  if (id === 'claude-cli') return resolveClaudeInstallStrategy()
  return null
}
