// [INPUT]: desktop-sandbox 统一提供器输入
// [OUTPUT]: 桌面沙箱能力提供
// [POS]: 桌面沙箱 AIO provider
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  normalizeWorkspaceDesktopSandboxDisplayProfile,
  resolveWorkspaceDesktopSandboxDisplaySettings,
  type WorkspaceDesktopSandboxProvider,
} from '@shared/types'
import type {
  WorkspaceDesktopSandboxAction,
  WorkspaceDesktopSandboxRequest,
  WorkspaceDesktopSandboxResult,
  WorkspaceDesktopSandboxStatus,
} from '@shared/types'
import { getWorkerNodeDir } from '../core/config'

const execFileAsync = promisify(execFile)

const DEFAULT_AIO_IMAGE = 'ghcr.io/agent-infra/sandbox:latest'
const DEFAULT_AIO_CONTAINER_NAME = 'vibemux-aio-desktop-sandbox'
const DEFAULT_AIO_HOST_PORT = 18081
const DEFAULT_AIO_CONTAINER_PORT = 8080
const DEFAULT_AIO_PLATFORM = 'linux/amd64'
const DEFAULT_AIO_PULL_TIMEOUT_MS = 15 * 60_000
const DEFAULT_AIO_START_TIMEOUT_MS = 30_000
const DEFAULT_AIO_COMMAND_TIMEOUT_MS = 120_000
const AIO_PROVIDER: WorkspaceDesktopSandboxProvider = 'aio'
const AIO_NOVNC_WEBSOCKET_PATH = 'websockify'

type AioDesktopState = Pick<
  WorkspaceDesktopSandboxStatus,
  | 'provider'
  | 'phase'
  | 'message'
  | 'streamUrl'
  | 'sandboxId'
  | 'displayProfile'
  | 'effectiveDisplayProfile'
  | 'displaySettings'
  | 'lastOutput'
  | 'error'
> & {
  containerName?: string
  image?: string
  platform?: string
  hostPort?: number
  mountedCwd?: string
}

const readEnv = (name: string) => {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

const readEnvNumber = (name: string, fallback: number) => {
  const raw = readEnv(name)
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const readEnvBoolean = (name: string, fallback = false) => {
  const raw = readEnv(name)?.toLowerCase()
  if (!raw) return fallback
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false
  return fallback
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const getStatePath = () => path.join(getWorkerNodeDir(), 'runtime', 'desktop-sandbox-aio.json')
const resolveAioImage = () => readEnv('VIBEMUX_AIO_SANDBOX_IMAGE') || readEnv('AIO_SANDBOX_IMAGE') || DEFAULT_AIO_IMAGE
const resolveAioPlatform = () => readEnv('VIBEMUX_AIO_SANDBOX_PLATFORM') || readEnv('AIO_SANDBOX_PLATFORM') || DEFAULT_AIO_PLATFORM
const resolveAioContainerName = () => readEnv('VIBEMUX_AIO_SANDBOX_CONTAINER_NAME') || DEFAULT_AIO_CONTAINER_NAME
const resolveAioHostPort = () => readEnvNumber('VIBEMUX_AIO_SANDBOX_PORT', DEFAULT_AIO_HOST_PORT)
const resolveAioBaseUrl = () => readEnv('VIBEMUX_AIO_SANDBOX_BASE_URL') || `http://127.0.0.1:${resolveAioHostPort()}`
const resolveAioPullTimeoutMs = () => readEnvNumber('VIBEMUX_AIO_SANDBOX_PULL_TIMEOUT_MS', DEFAULT_AIO_PULL_TIMEOUT_MS)
const resolveAioStartTimeoutMs = () => readEnvNumber('VIBEMUX_AIO_SANDBOX_START_TIMEOUT_MS', DEFAULT_AIO_START_TIMEOUT_MS)
const resolveAioCommandTimeoutMs = () => readEnvNumber('VIBEMUX_AIO_SANDBOX_COMMAND_TIMEOUT_MS', DEFAULT_AIO_COMMAND_TIMEOUT_MS)
const resolveAioCommandTimeoutSeconds = () => Math.ceil(resolveAioCommandTimeoutMs() / 1000)

export const buildAioVncUrl = () => {
  const url = new URL('/vnc/index.html', resolveAioBaseUrl())
  url.searchParams.set('autoconnect', 'true')
  url.searchParams.set('resize', 'scale')
  url.searchParams.set('path', AIO_NOVNC_WEBSOCKET_PATH)
  return url.toString()
}

const state: AioDesktopState = {
  provider: AIO_PROVIDER,
  phase: 'idle',
  message: 'Ready to start AIO Sandbox Desktop.',
  streamUrl: undefined,
  sandboxId: undefined,
  displayProfile: 'auto',
  effectiveDisplayProfile: '720p',
  displaySettings: resolveWorkspaceDesktopSandboxDisplaySettings({ profile: 'auto' }),
  lastOutput: undefined,
  error: undefined,
  containerName: resolveAioContainerName(),
  image: resolveAioImage(),
  platform: resolveAioPlatform(),
  hostPort: resolveAioHostPort(),
  mountedCwd: undefined,
}

const readPersistedState = (): Partial<AioDesktopState> => {
  const statePath = getStatePath()
  if (!existsSync(statePath)) {
    return {}
  }

  try {
    return JSON.parse(readFileSync(statePath, 'utf8')) as Partial<AioDesktopState>
  } catch {
    return {}
  }
}

const writePersistedState = () => {
  const statePath = getStatePath()
  mkdirSync(path.dirname(statePath), { recursive: true })
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

const hydratePersistedState = () => {
  Object.assign(state, readPersistedState())
  state.provider = AIO_PROVIDER
  state.containerName = resolveAioContainerName()
  state.image = resolveAioImage()
  state.platform = resolveAioPlatform()
  state.hostPort = resolveAioHostPort()
  if (['creating', 'starting', 'ready'].includes(state.phase)) {
    state.streamUrl = buildAioVncUrl()
  } else if (state.streamUrl?.includes('vnc/websockify') || state.streamUrl?.includes('vnc%2Fwebsockify')) {
    state.streamUrl = buildAioVncUrl()
  }
  state.displayProfile = normalizeWorkspaceDesktopSandboxDisplayProfile(state.displayProfile)
  state.displaySettings = state.displaySettings || resolveWorkspaceDesktopSandboxDisplaySettings({
    profile: state.displayProfile,
  })
  state.effectiveDisplayProfile = state.displaySettings.effectiveProfile
}

const getStatusSnapshot = (): WorkspaceDesktopSandboxStatus => {
  hydratePersistedState()
  return {
    ...state,
    provider: AIO_PROVIDER,
    controlUrl: resolveAioBaseUrl(),
    streamRedirectUrl: state.streamUrl || '',
  }
}

const resultFromStatus = (
  status: WorkspaceDesktopSandboxStatus = getStatusSnapshot(),
  ok = true,
  output?: string,
): WorkspaceDesktopSandboxResult => ({
  ...status,
  ok,
  output,
})

const describeError = (error: unknown, fallback: string) => (
  error instanceof Error && error.message ? error.message : fallback
)

const describeDockerError = (error: unknown, fallback: string) => {
  const message = describeError(error, fallback)
  if (message.includes('no matching manifest') && message.includes('linux/arm64')) {
    return [
      'AIO Sandbox 镜像没有可用的 linux/arm64 manifest。',
      `wemux 已按 ${resolveAioPlatform()} 启动；如果仍失败，请确认 Docker Desktop 已启用 amd64 emulation，或设置 VIBEMUX_AIO_SANDBOX_PLATFORM 指向可用平台。`,
      message,
    ].join(' ')
  }
  if (message.toLowerCase().includes('timed out')) {
    return [
      'AIO Sandbox Docker 操作超时。',
      `首次启动可能需要拉取较大的镜像；当前拉取超时为 ${Math.round(resolveAioPullTimeoutMs() / 1000)} 秒。`,
      '可以稍后重试，或通过 VIBEMUX_AIO_SANDBOX_PULL_TIMEOUT_MS 调大超时。',
      message,
    ].join(' ')
  }
  return message
}

const setError = (message: string) => {
  state.phase = 'error'
  state.message = message
  state.error = message
  writePersistedState()
}

const runDocker = async (args: string[], timeout = resolveAioCommandTimeoutMs()) => {
  const result = await execFileAsync('docker', args, {
    timeout,
    maxBuffer: 1024 * 1024 * 4,
  })
  return [result.stdout, result.stderr].filter(Boolean).join('').trim()
}

const ensureAioDockerAvailable = async () => {
  await runDocker(['version', '--format', '{{.Server.Version}}'], 10_000)
}

const normalizeDockerPlatform = (value: string) => value.trim().toLowerCase().replace(/\/v\d+$/, '')

const getLocalAioImagePlatform = async () => {
  try {
    const output = await runDocker([
      'image',
      'inspect',
      '--format',
      '{{.Os}}/{{.Architecture}}',
      resolveAioImage(),
    ], 10_000)
    return normalizeDockerPlatform(output)
  } catch {
    return undefined
  }
}

const shouldPullAioImage = async () => {
  const localPlatform = await getLocalAioImagePlatform()
  return !localPlatform || localPlatform !== normalizeDockerPlatform(resolveAioPlatform())
}

const extractAioText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return value === undefined ? '' : String(value)

  const record = value as Record<string, unknown>
  for (const key of ['output', 'content', 'stdout', 'stderr', 'message', 'text']) {
    const nested = record[key]
    if (typeof nested === 'string') return nested
  }

  const data = record.data
  if (data && typeof data === 'object') {
    const nested = extractAioText(data)
    if (nested) return nested
  }

  return JSON.stringify(value)
}

const callAioApi = async (pathname: string, body?: unknown) => {
  const url = new URL(pathname, resolveAioBaseUrl())
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const contentType = response.headers.get('content-type')?.toLowerCase() || ''
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => undefined)
    : await response.text().catch(() => undefined)

  if (!response.ok) {
    throw new Error(`AIO Sandbox API ${pathname} failed: HTTP ${response.status} ${extractAioText(payload)}`.trim())
  }

  return payload
}

const isContainerRunning = async (containerName = resolveAioContainerName()) => {
  try {
    const output = await runDocker(['inspect', '-f', '{{.State.Running}}', containerName], 10_000)
    return output.trim() === 'true'
  } catch {
    return false
  }
}

const waitForAioHttp = async () => {
  const startedAt = Date.now()
  let lastMessage = ''
  while (Date.now() - startedAt < resolveAioStartTimeoutMs()) {
    try {
      const response = await fetch(resolveAioBaseUrl(), {
        headers: { accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
      })
      await response.body?.cancel().catch(() => undefined)
      if (response.ok || response.status < 500) {
        return
      }
      lastMessage = `HTTP ${response.status}`
    } catch (error) {
      lastMessage = describeError(error, 'AIO Sandbox is not reachable yet.')
    }
    await sleep(700)
  }
  throw new Error(lastMessage || `AIO Sandbox did not become ready at ${resolveAioBaseUrl()}.`)
}

const checkAioHttp = async () => {
  try {
    const response = await fetch(resolveAioBaseUrl(), {
      headers: { accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
    })
    await response.body?.cancel().catch(() => undefined)
    return {
      ok: response.ok || response.status < 500,
      message: response.ok || response.status < 500
        ? undefined
        : `AIO Sandbox returned HTTP ${response.status}.`,
    }
  } catch (error) {
    return {
      ok: false,
      message: describeError(error, 'AIO Sandbox is not reachable.'),
    }
  }
}

const prepareAioEnvironment = async (): Promise<WorkspaceDesktopSandboxStatus> => {
  hydratePersistedState()
  state.provider = AIO_PROVIDER
  state.containerName = resolveAioContainerName()
  state.image = resolveAioImage()
  state.platform = resolveAioPlatform()
  state.hostPort = resolveAioHostPort()
  state.error = undefined

  if (readEnv('VIBEMUX_AIO_SANDBOX_BASE_URL')) {
    state.phase = 'starting'
    state.message = `Checking external AIO Sandbox at ${resolveAioBaseUrl()}.`
    state.streamUrl = buildAioVncUrl()
    writePersistedState()

    const check = await checkAioHttp()
    if (!check.ok) {
      throw new Error(check.message || `AIO Sandbox is not reachable at ${resolveAioBaseUrl()}.`)
    }

    state.phase = 'ready'
    state.message = 'Connected to existing AIO Sandbox Desktop.'
    state.streamUrl = buildAioVncUrl()
    writePersistedState()
    return getStatusSnapshot()
  }

  const containerName = resolveAioContainerName()
  if (await isContainerRunning(containerName)) {
    const check = await checkAioHttp()
    if (!check.ok) {
      throw new Error(check.message || `AIO Sandbox container ${containerName} is running but not reachable.`)
    }

    state.phase = 'ready'
    state.message = `AIO Sandbox Desktop is already running at ${resolveAioBaseUrl()}.`
    state.streamUrl = buildAioVncUrl()
    state.sandboxId = state.sandboxId || containerName
    writePersistedState()
    return getStatusSnapshot()
  }

  state.phase = 'creating'
  state.message = `Preparing AIO Sandbox image ${resolveAioImage()} for ${resolveAioPlatform()}.`
  state.streamUrl = undefined
  state.sandboxId = undefined
  writePersistedState()

  await ensureAioDockerAvailable()
  if (await shouldPullAioImage()) {
    state.message = `Pulling AIO Sandbox image ${resolveAioImage()} for ${resolveAioPlatform()}.`
    writePersistedState()
    state.lastOutput = await runDocker([
      'pull',
      '--platform',
      resolveAioPlatform(),
      resolveAioImage(),
    ], resolveAioPullTimeoutMs())
    writePersistedState()
  }

  state.phase = 'idle'
  state.message = 'AIO Sandbox image is ready. Desktop container will start when requested.'
  state.streamUrl = undefined
  state.error = undefined
  writePersistedState()
  return getStatusSnapshot()
}

const resolveMountCwd = (cwd?: string) => {
  const resolvedCwd = cwd?.trim()
  if (!resolvedCwd || !existsSync(resolvedCwd)) {
    return undefined
  }
  return resolvedCwd
}

const normalizeMountCwd = (cwd?: string) => cwd ? path.resolve(cwd) : undefined

const resolveMountArgs = (cwd?: string) => {
  const resolvedCwd = resolveMountCwd(cwd)
  state.mountedCwd = resolvedCwd
  if (!resolvedCwd) {
    return []
  }
  return [
    '-v',
    `${resolvedCwd}:/home/gem/workspace`,
    '-e',
    'VIBEMUX_WORKSPACE_DIR=/home/gem/workspace',
    '-e',
    'WORKSPACE=/home/gem/workspace',
  ]
}

const startAioContainer = async (request?: Pick<WorkspaceDesktopSandboxRequest, 'cwd' | 'displayProfile' | 'clientNetwork'>) => {
  hydratePersistedState()

  const displaySettings = resolveWorkspaceDesktopSandboxDisplaySettings({
    profile: request?.displayProfile || state.displayProfile,
    network: request?.clientNetwork,
  })
  state.phase = 'creating'
  state.message = `Starting AIO Sandbox from ${resolveAioImage()} (${displaySettings.effectiveProfile}).`
  state.streamUrl = buildAioVncUrl()
  state.sandboxId = resolveAioContainerName()
  state.displayProfile = displaySettings.profile
  state.effectiveDisplayProfile = displaySettings.effectiveProfile
  state.displaySettings = displaySettings
  state.error = undefined
  writePersistedState()

  if (!readEnv('VIBEMUX_AIO_SANDBOX_BASE_URL')) {
    const containerName = resolveAioContainerName()
    const requestedMountCwd = resolveMountCwd(request?.cwd)
    const currentMountCwd = normalizeMountCwd(state.mountedCwd)
    const containerRunning = await isContainerRunning(containerName)
    const shouldRecreateForMount = Boolean(
      containerRunning && requestedMountCwd && currentMountCwd !== normalizeMountCwd(requestedMountCwd),
    )
    if (!containerRunning || shouldRecreateForMount) {
      await runDocker(['rm', '-f', containerName], 10_000).catch(() => undefined)
      const mountArgs = resolveMountArgs(requestedMountCwd)
      const extraArgs = readEnvBoolean('VIBEMUX_AIO_SANDBOX_PRIVILEGED')
        ? ['--privileged']
        : ['--security-opt', 'seccomp=unconfined']
      if (await shouldPullAioImage()) {
        state.message = `Pulling AIO Sandbox image ${resolveAioImage()} for ${resolveAioPlatform()}.`
        writePersistedState()
        state.lastOutput = await runDocker([
          'pull',
          '--platform',
          resolveAioPlatform(),
          resolveAioImage(),
        ], resolveAioPullTimeoutMs())
        writePersistedState()
      }
      state.message = `Creating AIO Sandbox container ${containerName}.`
      writePersistedState()
      const output = await runDocker([
        'run',
        '-d',
        '--rm',
        '--name',
        containerName,
        '--platform',
        resolveAioPlatform(),
        '-p',
        `${resolveAioHostPort()}:${DEFAULT_AIO_CONTAINER_PORT}`,
        '--shm-size',
        '2g',
        '--add-host',
        'host.docker.internal:host-gateway',
        ...extraArgs,
        ...mountArgs,
        resolveAioImage(),
      ], resolveAioStartTimeoutMs())
      state.lastOutput = output
      state.sandboxId = output || containerName
      writePersistedState()
    }
  }

  state.phase = 'starting'
  state.message = 'Waiting for AIO Sandbox HTTP surface.'
  writePersistedState()
  await waitForAioHttp()

  state.phase = 'ready'
  state.message = `AIO Sandbox Desktop is ready (${displaySettings.effectiveProfile}).`
  state.streamUrl = buildAioVncUrl()
  state.error = undefined
  writePersistedState()
  return getStatusSnapshot()
}

const stopAioContainer = async () => {
  hydratePersistedState()
  if (!readEnv('VIBEMUX_AIO_SANDBOX_BASE_URL')) {
    await runDocker(['rm', '-f', resolveAioContainerName()], 10_000).catch(() => undefined)
  }

  state.phase = 'stopped'
  state.message = 'AIO Sandbox Desktop stopped.'
  state.streamUrl = undefined
  state.sandboxId = undefined
  state.error = undefined
  writePersistedState()
  return getStatusSnapshot()
}

const runAioCommand = async (command: string) => {
  await waitForAioHttp()
  const output = extractAioText(await callAioApi('/v1/shell/exec', {
    command,
    timeout: resolveAioCommandTimeoutSeconds(),
  })) || '(no output)'
  state.lastOutput = output
  writePersistedState()
  return resultFromStatus(getStatusSnapshot(), true, output)
}

const readAioFile = async (filePath: string) => {
  await waitForAioHttp()
  const output = extractAioText(await callAioApi('/v1/file/read', { file: filePath }))
  state.lastOutput = output
  writePersistedState()
  return resultFromStatus(getStatusSnapshot(), true, output)
}

const writeAioFile = async (filePath: string, content: string) => {
  await waitForAioHttp()
  const payload = await callAioApi('/v1/file/write', {
    file: filePath,
    content,
    encoding: 'utf-8',
  })
  const output = extractAioText(payload) || `Wrote ${filePath}`
  state.lastOutput = output
  writePersistedState()
  return resultFromStatus(getStatusSnapshot(), true, output)
}

const buildOpenAioBrowserUrlCommand = (url: string) => [
  `curl -sS -X PUT '${`http://127.0.0.1:9222/json/new?${url}`}' >/dev/null`,
  `|| DISPLAY=:99.0 xdg-open '${url}' >/dev/null 2>&1`,
].join(' ')

const runAioAction = async (action: WorkspaceDesktopSandboxAction) => {
  const commands: Record<WorkspaceDesktopSandboxAction, string> = {
    terminal: buildOpenAioBrowserUrlCommand('http://127.0.0.1:8080/terminal'),
    'file-manager': buildOpenAioBrowserUrlCommand('http://127.0.0.1:8080/code-server/'),
    note: [
      'mkdir -p /home/gem/Desktop',
      "printf 'Hello from AIO Sandbox\\nThis file was created by wemux.\\n' > /home/gem/Desktop/aio-demo.txt",
      buildOpenAioBrowserUrlCommand('file:///home/gem/Desktop/aio-demo.txt'),
    ].join(' && '),
    'demo-window': [
      'mkdir -p /home/gem/workspace',
      "printf 'AIO Sandbox desktop is browser-first.\\nUse /terminal for shell and /code-server/ for files.\\n' > /home/gem/workspace/aio-desktop-demo.txt",
      buildOpenAioBrowserUrlCommand('http://127.0.0.1:8080/'),
    ].join(' && '),
  }
  return runAioCommand(commands[action])
}

export const aioDesktopProvider = {
  provider: AIO_PROVIDER,

  async prepare(): Promise<WorkspaceDesktopSandboxResult> {
    try {
      return resultFromStatus(await prepareAioEnvironment())
    } catch (error) {
      const message = describeDockerError(error, 'AIO Sandbox Desktop prepare failed.')
      setError(message)
      return resultFromStatus(getStatusSnapshot(), false, message)
    }
  },

  async status(): Promise<WorkspaceDesktopSandboxResult> {
    const running = await isContainerRunning().catch(() => false)
    const status = getStatusSnapshot()
    const usesExternalBaseUrl = Boolean(readEnv('VIBEMUX_AIO_SANDBOX_BASE_URL'))
    if (!usesExternalBaseUrl && !running && ['creating', 'starting', 'ready'].includes(status.phase)) {
      state.phase = 'stopped'
      state.message = 'AIO Sandbox Desktop is not running.'
      state.streamUrl = undefined
      state.sandboxId = undefined
      state.error = undefined
      writePersistedState()
      return resultFromStatus(getStatusSnapshot())
    }
    if (usesExternalBaseUrl || running) {
      const check = await checkAioHttp()
      if (!check.ok) {
        return resultFromStatus({
          ...status,
          phase: 'error',
          error: check.message,
          message: check.message || 'AIO Sandbox is not reachable.',
        }, false, check.message)
      }
      const streamUrl = buildAioVncUrl()
      return resultFromStatus({
        ...status,
        phase: status.phase === 'idle' || status.phase === 'stopped' ? 'ready' : status.phase,
        streamUrl,
        streamRedirectUrl: streamUrl,
        message: status.phase === 'idle' || status.phase === 'stopped'
          ? 'Connected to existing AIO Sandbox Desktop.'
          : status.message,
      })
    }
    return resultFromStatus(status)
  },

  async start(request?: WorkspaceDesktopSandboxRequest): Promise<WorkspaceDesktopSandboxResult> {
    try {
      return resultFromStatus(await startAioContainer(request))
    } catch (error) {
      const message = describeDockerError(error, 'AIO Sandbox Desktop start failed.')
      setError(message)
      return resultFromStatus(getStatusSnapshot(), false, message)
    }
  },

  async stop(): Promise<WorkspaceDesktopSandboxResult> {
    try {
      return resultFromStatus(await stopAioContainer())
    } catch (error) {
      const message = describeError(error, 'AIO Sandbox Desktop stop failed.')
      setError(message)
      return resultFromStatus(getStatusSnapshot(), false, message)
    }
  },

  async execute(request: WorkspaceDesktopSandboxRequest): Promise<WorkspaceDesktopSandboxResult> {
    try {
      if (request.operation === 'status') return await this.status()
      if (request.operation === 'start') return await this.start(request)
      if (request.operation === 'stop') return await this.stop()

      if (request.operation === 'command' || request.operation === 'cli.command') {
        const command = request.command?.trim()
        if (!command) throw new Error('缺少 AIO Sandbox command。')
        return await runAioCommand(command)
      }

      if (request.operation === 'desktop.action') {
        if (!request.action) throw new Error('缺少 desktop action。')
        return await runAioAction(request.action)
      }

      if (request.operation === 'file.read') {
        const filePath = request.path?.trim()
        if (!filePath) throw new Error('缺少 file.read path。')
        return await readAioFile(filePath)
      }

      if (request.operation === 'file.write') {
        const filePath = request.path?.trim()
        if (!filePath) throw new Error('缺少 file.write path。')
        return await writeAioFile(filePath, request.content ?? '')
      }

      if (request.operation === 'cli.start') return await this.start(request)
      if (request.operation === 'cli.stop') return await this.stop()

      throw new Error(`Unsupported AIO desktop sandbox operation: ${request.operation}`)
    } catch (error) {
      const message = describeError(error, 'AIO Sandbox desktop operation failed.')
      state.lastOutput = message
      writePersistedState()
      return resultFromStatus(getStatusSnapshot(), false, message)
    }
  },
}
