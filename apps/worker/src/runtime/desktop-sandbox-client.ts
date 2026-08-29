// [INPUT]: desktop-sandbox 客户端请求
// [OUTPUT]: 沙箱客户端操作
// [POS]: 桌面沙箱客户端
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ConnectionConfig,
  Sandbox,
  SandboxApiException,
  SandboxManager,
  type Execution,
  type RunCommandOpts,
} from '@alibaba-group/opensandbox'
import {
  normalizeWorkspaceDesktopSandboxDisplayProfile,
  resolveWorkspaceDesktopSandboxDisplaySettings,
  type WorkspaceDesktopSandboxDisplaySettings,
} from '@shared/types'
import type {
  WorkspaceDesktopSandboxAction,
  WorkspaceDesktopSandboxClientNetworkHint,
  WorkspaceDesktopSandboxDisplayProfile,
  WorkspaceDesktopSandboxRequest,
  WorkspaceDesktopSandboxResult,
  WorkspaceDesktopSandboxStatus,
} from '@shared/types'
import { getWorkerNodeDir } from '../core/config'

const DEFAULT_OPENSANDBOX_DOMAIN = '127.0.0.1:18080'
const DEFAULT_DESKTOP_IMAGE = 'opensandbox/desktop:latest'
const DEFAULT_VNC_PASSWORD = 'opensandbox'
const DEFAULT_DESKTOP_TIMEOUT_SECONDS = 60 * 60 * 2
const DEFAULT_CLI_TIMEOUT_SECONDS = 60 * 60
const DEFAULT_COMMAND_TIMEOUT_SECONDS = 120
const DEFAULT_REQUEST_TIMEOUT_SECONDS = 120
const DEFAULT_SERVER_START_TIMEOUT_MS = 30_000
const DEFAULT_DESKTOP_DISPLAY_PROFILE: WorkspaceDesktopSandboxDisplayProfile = 'auto'
const OPENSANDBOX_DOCKER_DROP_CAPABILITIES = [
  'AUDIT_WRITE',
  'MKNOD',
  'NET_ADMIN',
  'NET_RAW',
  'SYS_ADMIN',
  'SYS_MODULE',
  'SYS_PTRACE',
  'SYS_TIME',
  'SYS_TTY_CONFIG',
]

type MutableDesktopState = Pick<
  WorkspaceDesktopSandboxStatus,
  | 'phase'
  | 'provider'
  | 'message'
  | 'streamUrl'
  | 'password'
  | 'sandboxId'
  | 'displayProfile'
  | 'effectiveDisplayProfile'
  | 'displaySettings'
  | 'lastOutput'
  | 'error'
  | 'mountedCwd'
>

type MutableCliState = NonNullable<WorkspaceDesktopSandboxStatus['cli']>

type PersistedDesktopSandboxState = {
  desktop?: Partial<MutableDesktopState>
  cli?: Partial<MutableCliState>
}

let desktopSandbox: Sandbox | null = null
let cliSandbox: Sandbox | null = null
let desktopStartPromise: Promise<WorkspaceDesktopSandboxStatus> | null = null
let cliStartPromise: Promise<MutableCliState> | null = null
let serverStartPromise: Promise<void> | null = null
let serverProcess: ChildProcess | null = null

const desktopState: MutableDesktopState = {
  provider: 'opensandbox',
  phase: 'idle',
  message: 'Ready to start OpenSandbox Desktop.',
  streamUrl: undefined,
  password: DEFAULT_VNC_PASSWORD,
  sandboxId: undefined,
  displayProfile: DEFAULT_DESKTOP_DISPLAY_PROFILE,
  effectiveDisplayProfile: '720p',
  displaySettings: resolveWorkspaceDesktopSandboxDisplaySettings({ profile: DEFAULT_DESKTOP_DISPLAY_PROFILE }),
  lastOutput: undefined,
  error: undefined,
  mountedCwd: undefined,
}

const cliState: MutableCliState = {
  phase: 'idle',
  message: 'Ready to start a CLI-only OpenSandbox sandbox.',
  image: undefined,
  sandboxId: undefined,
  lastOutput: undefined,
  error: undefined,
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
const getStatePath = () => path.join(getWorkerNodeDir(), 'runtime', 'desktop-sandbox.json')
const getServerConfigPath = () => path.join(getWorkerNodeDir(), 'runtime', 'opensandbox-server.toml')
const resolveOpenSandboxDomain = () => readEnv('VIBEMUX_OPENSANDBOX_DOMAIN') || readEnv('OPEN_SANDBOX_DOMAIN') || DEFAULT_OPENSANDBOX_DOMAIN
const resolveOpenSandboxProtocol = () => readEnv('VIBEMUX_OPENSANDBOX_PROTOCOL') === 'https' ? 'https' : 'http'
const resolveDesktopImage = () => readEnv('VIBEMUX_OPENSANDBOX_DESKTOP_IMAGE') || readEnv('SANDBOX_IMAGE') || DEFAULT_DESKTOP_IMAGE
const resolveCliImage = () => readEnv('VIBEMUX_OPENSANDBOX_CLI_IMAGE') || readEnv('CLI_SANDBOX_IMAGE') || resolveDesktopImage()
const resolveVncPassword = () => readEnv('VIBEMUX_OPENSANDBOX_VNC_PASSWORD') || readEnv('VNC_PASSWORD') || DEFAULT_VNC_PASSWORD
const resolveConfiguredDesktopProfile = (): WorkspaceDesktopSandboxDisplayProfile => {
  const value = readEnv('VIBEMUX_OPENSANDBOX_DESKTOP_PROFILE')
  return normalizeWorkspaceDesktopSandboxDisplayProfile(value as WorkspaceDesktopSandboxDisplayProfile | undefined)
}
const resolveDisplaySettings = (params: {
  profile?: WorkspaceDesktopSandboxDisplayProfile
  network?: WorkspaceDesktopSandboxClientNetworkHint
}) => {
  const settings = resolveWorkspaceDesktopSandboxDisplaySettings({
    profile: params.profile || resolveConfiguredDesktopProfile(),
    network: params.network,
  })
  return {
    ...settings,
    noVncQuality: readEnvNumber('VIBEMUX_OPENSANDBOX_NOVNC_QUALITY', settings.noVncQuality),
    noVncCompression: readEnvNumber('VIBEMUX_OPENSANDBOX_NOVNC_COMPRESSION', settings.noVncCompression),
  }
}

const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, '')

const createConnectionConfig = () => new ConnectionConfig({
  domain: resolveOpenSandboxDomain(),
  protocol: resolveOpenSandboxProtocol(),
  apiKey: readEnv('VIBEMUX_OPENSANDBOX_API_KEY') || readEnv('OPEN_SANDBOX_API_KEY'),
  requestTimeoutSeconds: readEnvNumber('VIBEMUX_OPENSANDBOX_REQUEST_TIMEOUT_SECONDS', DEFAULT_REQUEST_TIMEOUT_SECONDS),
  debug: readEnvBoolean('VIBEMUX_OPENSANDBOX_DEBUG'),
  useServerProxy: readEnvBoolean('VIBEMUX_OPENSANDBOX_USE_SERVER_PROXY'),
})

const getControlUrl = () => {
  const config = createConnectionConfig()
  const domain = config.domain.startsWith('http://') || config.domain.startsWith('https://')
    ? config.domain
    : `${config.protocol}://${config.domain}`
  return stripTrailingSlashes(domain)
}

const getControlUrlInfo = () => {
  try {
    return new URL(getControlUrl())
  } catch {
    return null
  }
}

const isLoopbackHost = (host: string) => {
  const normalized = host.toLowerCase()
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1' || normalized === '[::1]'
}

const shouldAutostartOpenSandboxServer = () => {
  if (!readEnvBoolean('VIBEMUX_OPENSANDBOX_AUTOSTART', true)) {
    return false
  }

  const url = getControlUrlInfo()
  return Boolean(url && isLoopbackHost(url.hostname))
}

const resolveAllowedHostPaths = () => {
  const custom = readEnv('VIBEMUX_OPENSANDBOX_ALLOWED_HOST_PATHS')?.trim()
  if (custom) {
    return custom.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return [os.homedir()]
}

const createOpenSandboxServerConfig = (port: number) => [
  '# Generated by wemux worker. Safe to delete; it will be recreated.',
  '[server]',
  'host = "127.0.0.1"',
  `port = ${port}`,
  'max_sandbox_timeout_seconds = 86400',
  '',
  '[log]',
  'level = "INFO"',
  '',
  '[runtime]',
  'type = "docker"',
  'execd_image = "opensandbox/execd:v1.0.16"',
  '',
  '[storage]',
  `allowed_host_paths = [${resolveAllowedHostPaths().map((item) => `"${item.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(', ')}]`,
  'volume_default_size = "1Gi"',
  '',
  '[store]',
  'type = "sqlite"',
  `path = "${path.join(os.homedir(), '.opensandbox', 'opensandbox.db')}"`,
  '',
  '[docker]',
  'network_mode = "bridge"',
  `drop_capabilities = [${OPENSANDBOX_DOCKER_DROP_CAPABILITIES.map((item) => `"${item}"`).join(', ')}]`,
  'no_new_privileges = true',
  'apparmor_profile = ""',
  'pids_limit = 4096',
  'seccomp_profile = ""',
  '',
  '[ingress]',
  'mode = "direct"',
  '',
  '[egress]',
  'image = "opensandbox/egress:v1.0.12"',
  'mode = "dns"',
  '',
  '[renew_intent]',
  'enabled = false',
  'min_interval_seconds = 60',
  '',
].join('\n')

const ensureOpenSandboxServerConfig = () => {
  const url = getControlUrlInfo()
  const port = Number(url?.port || 0)
  if (!url || !Number.isFinite(port) || port <= 0) {
    throw new Error(`OpenSandbox control URL 无效：${getControlUrl()}`)
  }

  const configPath = getServerConfigPath()
  mkdirSync(path.dirname(configPath), { recursive: true })
  writeFileSync(configPath, createOpenSandboxServerConfig(port), 'utf8')
  return configPath
}

type OpenSandboxApiCheck = {
  ok: boolean
  canAutostart: boolean
  message?: string
}

const checkOpenSandboxApiBase = async (): Promise<OpenSandboxApiCheck> => {
  const controlUrl = getControlUrl()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await fetch(`${controlUrl}/v1/sandboxes?page=1&pageSize=1`, {
      headers: {
        accept: 'application/json',
      },
      signal: controller.signal,
    })
    const contentType = response.headers.get('content-type')?.toLowerCase() || ''
    const body = await response.text().catch(() => '')
    const trimmedBody = body.trim().toLowerCase()
    const looksLikeHtml = contentType.includes('text/html')
      || trimmedBody.startsWith('<!doctype html')
      || trimmedBody.startsWith('<html')

    if (looksLikeHtml) {
      return {
        ok: false,
        canAutostart: false,
        message: [
          `${controlUrl} 返回的是 HTML，不像 OpenSandbox Lifecycle API。`,
          '请确认 OpenSandbox server 正在运行，并把 VIBEMUX_OPENSANDBOX_DOMAIN 指向它的 host:port。',
          '如果本机 8080 被其他服务占用，请换一个 OpenSandbox server 端口。',
        ].join(' '),
      }
    }
    return { ok: true, canAutostart: false }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        canAutostart: true,
        message: `连接 ${controlUrl} 超时，请确认 OpenSandbox server 已启动。`,
      }
    }
    return {
      ok: false,
      canAutostart: true,
      message: error instanceof Error ? error.message : `无法连接 ${controlUrl}。`,
    }
  } finally {
    clearTimeout(timer)
  }
}

const startOpenSandboxServerProcess = () => {
  if (serverProcess && serverProcess.exitCode === null) {
    return
  }

  const configPath = ensureOpenSandboxServerConfig()
  serverProcess = spawn('uvx', ['opensandbox-server', '--config', configPath], {
    detached: true,
    env: {
      ...process.env,
      OPENSANDBOX_INSECURE_SERVER: 'YES',
    },
    stdio: 'ignore',
  })
  serverProcess.once('error', () => {
    serverProcess = null
  })
  serverProcess.once('exit', () => {
    serverProcess = null
  })
  serverProcess.unref()
}

const ensureOpenSandboxApiBase = async () => {
  const initialCheck = await checkOpenSandboxApiBase()
  if (initialCheck.ok) {
    return
  }

  if (!shouldAutostartOpenSandboxServer() || !initialCheck.canAutostart) {
    throw new Error(initialCheck.message || `OpenSandbox server unavailable at ${getControlUrl()}.`)
  }

  if (!serverStartPromise) {
    serverStartPromise = Promise.resolve().then(async () => {
      startOpenSandboxServerProcess()
      const startedAt = Date.now()
      let lastMessage = initialCheck.message
      while (Date.now() - startedAt < DEFAULT_SERVER_START_TIMEOUT_MS) {
        await sleep(700)
        const check = await checkOpenSandboxApiBase()
        if (check.ok) {
          return
        }
        lastMessage = check.message || lastMessage
        if (!check.canAutostart) {
          break
        }
      }
      throw new Error(lastMessage || `OpenSandbox server did not become ready at ${getControlUrl()}.`)
    }).finally(() => {
      serverStartPromise = null
    })
  }

  return serverStartPromise
}

const readPersistedState = (): PersistedDesktopSandboxState => {
  const statePath = getStatePath()
  if (!existsSync(statePath)) {
    return {}
  }

  try {
    return JSON.parse(readFileSync(statePath, 'utf8')) as PersistedDesktopSandboxState
  } catch {
    return {}
  }
}

const writePersistedState = () => {
  const statePath = getStatePath()
  mkdirSync(path.dirname(statePath), { recursive: true })
  writeFileSync(statePath, `${JSON.stringify({
    desktop: desktopState,
    cli: cloneCliState(),
  }, null, 2)}\n`, 'utf8')
}

const hydratePersistedState = () => {
  const persisted = readPersistedState()
  if (persisted.desktop && !desktopSandbox) {
    Object.assign(desktopState, persisted.desktop)
  }
  if (persisted.cli && !cliSandbox) {
    Object.assign(cliState, persisted.cli)
  }
  desktopState.password = resolveVncPassword()
  desktopState.displayProfile = desktopState.displayProfile || resolveConfiguredDesktopProfile()
  const hydratedDisplaySettings = desktopState.displaySettings || resolveDisplaySettings({
    profile: desktopState.displayProfile,
  })
  desktopState.effectiveDisplayProfile = hydratedDisplaySettings.effectiveProfile
  desktopState.displaySettings = hydratedDisplaySettings
  cliState.image = cliState.image || resolveCliImage()
}

const cloneCliState = (): MutableCliState => ({
  ...cliState,
  image: cliState.image || resolveCliImage(),
})

const getStatusSnapshot = (): WorkspaceDesktopSandboxStatus => {
  hydratePersistedState()
  return {
    ...desktopState,
    provider: 'opensandbox',
    password: desktopState.password || resolveVncPassword(),
    controlUrl: getControlUrl(),
    streamRedirectUrl: desktopState.streamUrl || '',
    cli: cloneCliState(),
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

const setDesktopError = (message: string) => {
  desktopState.phase = 'error'
  desktopState.message = message
  desktopState.error = message
  writePersistedState()
}

const setCliError = (message: string) => {
  cliState.phase = 'error'
  cliState.message = message
  cliState.error = message
  writePersistedState()
}

const formatUnknownBody = (body: unknown) => {
  if (!body) return undefined
  if (typeof body === 'string') return body
  try {
    return JSON.stringify(body)
  } catch {
    return String(body)
  }
}

const describeError = (error: unknown, fallback: string) => {
  if (error instanceof SandboxApiException) {
    const rawBody = formatUnknownBody(error.rawBody)
    const requestId = error.requestId ? ` requestId=${error.requestId}` : ''
    const status = error.statusCode ? `HTTP ${error.statusCode}` : 'OpenSandbox API error'
    return [status, error.message, rawBody, requestId].filter(Boolean).join(' | ')
  }

  if (error instanceof Error) {
    return error.message || fallback
  }

  return fallback
}

const collectExecutionOutput = (execution: Execution) => {
  const chunks: string[] = []
  for (const message of execution.logs.stdout) {
    chunks.push(message.text.endsWith('\n') ? message.text : `${message.text}\n`)
  }
  for (const message of execution.logs.stderr) {
    chunks.push(message.text.endsWith('\n') ? message.text : `${message.text}\n`)
  }
  for (const result of execution.result) {
    if (result.text) {
      chunks.push(result.text.endsWith('\n') ? result.text : `${result.text}\n`)
    }
  }
  if (execution.error) {
    chunks.push(`${execution.error.name}: ${execution.error.value}\n`)
    if (execution.error.traceback.length) {
      chunks.push(`${execution.error.traceback.join('\n')}\n`)
    }
  }
  if (typeof execution.exitCode === 'number' && execution.exitCode !== 0) {
    chunks.push(`exitCode=${execution.exitCode}\n`)
  }
  return chunks.join('').trim()
}

const runCommand = async (
  sandbox: Sandbox,
  command: string,
  opts: RunCommandOpts = {},
) => {
  const execution = await sandbox.commands.run(command, opts)
  return collectExecutionOutput(execution) || '(no output)'
}

const didCommandSucceed = (output: string) => !/(?:^|\n)exitCode=[1-9]\d*(?:\n|$)/.test(output)

const findReusableSandboxId = async (kind: 'desktop' | 'cli') => {
  await ensureOpenSandboxApiBase()
  const manager = SandboxManager.create({
    connectionConfig: createConnectionConfig(),
  })
  try {
    const response = await manager.listSandboxInfos({
      states: ['Running'],
      metadata: {
        source: 'vibemux',
        kind,
      },
      page: 1,
      pageSize: 10,
    })
    return response.items
      .slice()
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0]
      ?.id
  } finally {
    await manager.close().catch(() => undefined)
  }
}

const connectDesktopSandbox = async () => {
  hydratePersistedState()
  if (desktopSandbox) {
    return desktopSandbox
  }

  const sandboxId = desktopState.sandboxId || await findReusableSandboxId('desktop')
  if (!sandboxId) {
    return null
  }
  desktopState.sandboxId = sandboxId

  await ensureOpenSandboxApiBase()
  const sandbox = await Sandbox.connect({
    sandboxId,
    connectionConfig: createConnectionConfig(),
    readyTimeoutSeconds: readEnvNumber('VIBEMUX_OPENSANDBOX_READY_TIMEOUT_SECONDS', 60),
  })
  desktopSandbox = sandbox
  desktopState.phase = 'ready'
  desktopState.message = 'Connected to existing OpenSandbox Desktop.'
  desktopState.error = undefined
  if (!desktopState.streamUrl) {
    const endpoint = await sandbox.getEndpoint(6080)
    desktopState.streamUrl = buildNoVncUrl(endpoint.endpoint, desktopState.password || resolveVncPassword())
  }
  writePersistedState()
  return sandbox
}

const ensureDesktopSandbox = async () => {
  const sandbox = await connectDesktopSandbox()
  if (!sandbox) {
    throw new Error('Desktop sandbox is not running. Start it first.')
  }
  return sandbox
}

const ensureCliSandbox = async () => {
  const connected = await connectCliSandbox()
  if (connected) {
    return connected
  }

  await startCliSandbox()
  if (!cliSandbox) {
    throw new Error('CLI sandbox is not running.')
  }
  return cliSandbox
}

const buildNoVncUrl = (endpoint: string, password: string) => {
  const displaySettings = desktopState.displaySettings || resolveDisplaySettings({
    profile: desktopState.displayProfile,
  })
  const endpointUrl = new URL(`${resolveOpenSandboxProtocol()}://${endpoint}`)
  const path = endpointUrl.pathname.replace(/^\/+/, '')
  const query = new URLSearchParams({
    autoconnect: 'true',
    resize: 'scale',
    quality: String(displaySettings.noVncQuality),
    compression: String(displaySettings.noVncCompression),
    password,
    host: endpointUrl.hostname,
    port: endpointUrl.port,
  })
  if (path) {
    query.set('path', path)
  }
  return `${resolveOpenSandboxProtocol()}://${endpoint}/vnc.html?${query.toString()}`
}

const applyNoVncDisplaySettingsToUrl = (
  value: string | undefined,
  displaySettings: Pick<WorkspaceDesktopSandboxDisplaySettings, 'noVncQuality' | 'noVncCompression'>,
) => {
  if (!value) {
    return value
  }

  try {
    const url = new URL(value)
    url.searchParams.set('quality', String(displaySettings.noVncQuality))
    url.searchParams.set('compression', String(displaySettings.noVncCompression))
    return url.toString()
  } catch {
    return value
  }
}

const resolveDesktopWorkspaceMountPath = () => '/home/desktop/workspace'

const buildDesktopWorkspaceVolumes = (cwd?: string) => {
  const trimmed = cwd?.trim()
  if (!trimmed) {
    return undefined
  }
  return [{
    name: 'workspace',
    host: { path: trimmed },
    mountPath: resolveDesktopWorkspaceMountPath(),
  }]
}

const createDesktopSandbox = async (request?: Pick<WorkspaceDesktopSandboxRequest, 'displayProfile' | 'clientNetwork' | 'cwd'>) => {
  hydratePersistedState()
  const image = resolveDesktopImage()
  const password = resolveVncPassword()
  const displaySettings = resolveDisplaySettings({
    profile: request?.displayProfile,
    network: request?.clientNetwork,
  })
  desktopState.phase = 'creating'
  desktopState.message = `Creating OpenSandbox desktop from ${image} (${displaySettings.effectiveProfile}).`
  desktopState.streamUrl = undefined
  desktopState.password = password
  desktopState.sandboxId = undefined
  desktopState.displayProfile = displaySettings.profile
  desktopState.effectiveDisplayProfile = displaySettings.effectiveProfile
  desktopState.displaySettings = displaySettings
  desktopState.lastOutput = undefined
  desktopState.error = undefined
  writePersistedState()

  let createdSandbox: Sandbox | null = null
  try {
    desktopState.message = 'Creating sandbox instance.'
    writePersistedState()
    await ensureOpenSandboxApiBase()
    const volumes = buildDesktopWorkspaceVolumes(request?.cwd)
    createdSandbox = await Sandbox.create({
      image,
      connectionConfig: createConnectionConfig(),
      timeoutSeconds: readEnvNumber('VIBEMUX_OPENSANDBOX_DESKTOP_TIMEOUT_SECONDS', DEFAULT_DESKTOP_TIMEOUT_SECONDS),
      env: { VNC_PASSWORD: password },
      volumes,
      metadata: {
        source: 'vibemux',
        kind: 'desktop',
      },
      readyTimeoutSeconds: readEnvNumber('VIBEMUX_OPENSANDBOX_READY_TIMEOUT_SECONDS', 60),
    })
    desktopSandbox = createdSandbox
    desktopState.sandboxId = createdSandbox.id
    writePersistedState()

    desktopState.phase = 'starting'
    desktopState.message = 'Starting Xvfb display server.'
    desktopState.lastOutput = await runCommand(
      createdSandbox,
      `Xvfb :0 -screen 0 ${displaySettings.width}x${displaySettings.height}x${displaySettings.depth}`,
      { background: true },
    )

    desktopState.message = 'Starting XFCE desktop.'
    desktopState.lastOutput = await runCommand(
      createdSandbox,
      'DISPLAY=:0 dbus-launch startxfce4',
      { background: true },
    )

    desktopState.message = 'Starting x11vnc.'
    desktopState.lastOutput = await runCommand(
      createdSandbox,
      'x11vnc -display :0 -passwd "$VNC_PASSWORD" -forever -shared -noxdamage -rfbport 5900',
      { background: true, envs: { VNC_PASSWORD: password } },
    )

    desktopState.message = 'Starting noVNC websockify.'
    desktopState.lastOutput = await runCommand(
      createdSandbox,
      '/usr/bin/websockify --web=/usr/share/novnc 6080 localhost:5900',
      { background: true },
    )

    const endpoint = await createdSandbox.getEndpoint(6080)
    desktopState.streamUrl = buildNoVncUrl(endpoint.endpoint, password)

    if (volumes) {
      desktopState.message = 'Linking workspace on desktop.'
      writePersistedState()
      const mountPath = resolveDesktopWorkspaceMountPath()
      await runCommand(
        createdSandbox,
        'mkdir -p /home/desktop/Desktop && ' +
        `ln -sf ${mountPath} /home/desktop/Desktop/workspace 2>/dev/null; ` +
        `grep -q 'cd ${mountPath}' /home/desktop/.bashrc 2>/dev/null || echo 'cd ${mountPath}' >> /home/desktop/.bashrc 2>/dev/null; ` +
        'true',
      )
      desktopState.mountedCwd = request?.cwd?.trim()
    }

    desktopState.phase = 'ready'
    desktopState.message = `OpenSandbox Desktop is ready (${displaySettings.effectiveProfile}).`
    desktopState.error = undefined
    writePersistedState()
    return getStatusSnapshot()
  } catch (error) {
    const message = describeError(error, 'Failed to start OpenSandbox Desktop.')
    setDesktopError(message)
    if (createdSandbox) {
      await createdSandbox.kill().catch(() => undefined)
      await createdSandbox.close().catch(() => undefined)
    }
    if (desktopSandbox === createdSandbox) {
      desktopSandbox = null
    }
    throw error
  }
}

const applyDisplayRequestMetadata = (request?: Pick<WorkspaceDesktopSandboxRequest, 'displayProfile' | 'clientNetwork' | 'cwd'>) => {
  if (!request?.displayProfile) {
    return
  }

  const settings = resolveDisplaySettings({
    profile: request.displayProfile,
    network: request.clientNetwork,
  })
  desktopState.displayProfile = settings.profile
  desktopState.effectiveDisplayProfile = settings.effectiveProfile
  desktopState.displaySettings = settings
  desktopState.streamUrl = applyNoVncDisplaySettingsToUrl(desktopState.streamUrl, settings)
  desktopState.message = `OpenSandbox Desktop is ready (${settings.effectiveProfile}).`
  writePersistedState()
}

const startDesktopSandbox = async (request?: Pick<WorkspaceDesktopSandboxRequest, 'displayProfile' | 'clientNetwork' | 'cwd'>) => {
  const existingSandbox = await connectDesktopSandbox().catch(() => null)
  if (existingSandbox) {
    applyDisplayRequestMetadata(request)
    return getStatusSnapshot()
  }

  desktopState.sandboxId = undefined
  desktopState.streamUrl = undefined
  desktopState.error = undefined
  if (!desktopStartPromise) {
    desktopStartPromise = createDesktopSandbox(request).finally(() => {
      desktopStartPromise = null
    })
  }
  return desktopStartPromise
}

const stopDesktopSandbox = async () => {
  hydratePersistedState()
  const sandbox = desktopSandbox
  const sandboxId = desktopState.sandboxId
  desktopSandbox = null
  desktopStartPromise = null

  if (sandbox) {
    await sandbox.kill().catch(() => undefined)
    await sandbox.close().catch(() => undefined)
  } else if (sandboxId) {
    await killSandboxById(sandboxId)
  }

  desktopState.phase = 'stopped'
  desktopState.message = 'OpenSandbox Desktop stopped.'
  desktopState.streamUrl = undefined
  desktopState.sandboxId = undefined
  desktopState.error = undefined
  writePersistedState()
  return getStatusSnapshot()
}

const createCliSandbox = async () => {
  hydratePersistedState()
  const image = resolveCliImage()
  cliState.phase = 'creating'
  cliState.message = `Creating CLI-only OpenSandbox sandbox from ${image}.`
  cliState.image = image
  cliState.sandboxId = undefined
  cliState.lastOutput = undefined
  cliState.error = undefined
  writePersistedState()

  let createdSandbox: Sandbox | null = null
  try {
    await ensureOpenSandboxApiBase()
    createdSandbox = await Sandbox.create({
      image,
      connectionConfig: createConnectionConfig(),
      timeoutSeconds: readEnvNumber('VIBEMUX_OPENSANDBOX_CLI_TIMEOUT_SECONDS', DEFAULT_CLI_TIMEOUT_SECONDS),
      metadata: {
        source: 'vibemux',
        kind: 'cli',
      },
      readyTimeoutSeconds: readEnvNumber('VIBEMUX_OPENSANDBOX_READY_TIMEOUT_SECONDS', 60),
    })
    cliSandbox = createdSandbox
    cliState.phase = 'ready'
    cliState.message = 'CLI-only OpenSandbox sandbox is ready.'
    cliState.sandboxId = createdSandbox.id
    cliState.error = undefined
    writePersistedState()
    return cloneCliState()
  } catch (error) {
    const message = describeError(error, 'Failed to start CLI-only OpenSandbox sandbox.')
    setCliError(message)
    if (createdSandbox) {
      await createdSandbox.kill().catch(() => undefined)
      await createdSandbox.close().catch(() => undefined)
    }
    if (cliSandbox === createdSandbox) {
      cliSandbox = null
    }
    throw error
  }
}

const startCliSandbox = async () => {
  const existingSandbox = await connectCliSandbox().catch(() => null)
  if (existingSandbox) {
    return cloneCliState()
  }
  cliState.sandboxId = undefined
  cliState.error = undefined
  if (!cliStartPromise) {
    cliStartPromise = createCliSandbox().finally(() => {
      cliStartPromise = null
    })
  }
  return cliStartPromise
}

const stopCliSandbox = async () => {
  hydratePersistedState()
  const sandbox = cliSandbox
  const sandboxId = cliState.sandboxId
  cliSandbox = null
  cliStartPromise = null

  if (sandbox) {
    await sandbox.kill().catch(() => undefined)
    await sandbox.close().catch(() => undefined)
  } else if (sandboxId) {
    await killSandboxById(sandboxId)
  }

  cliState.phase = 'stopped'
  cliState.message = 'CLI-only OpenSandbox sandbox stopped.'
  cliState.sandboxId = undefined
  cliState.error = undefined
  writePersistedState()
  return cloneCliState()
}

const connectCliSandbox = async () => {
  hydratePersistedState()
  if (cliSandbox) {
    return cliSandbox
  }

  const sandboxId = cliState.sandboxId || await findReusableSandboxId('cli')
  if (!sandboxId) {
    return null
  }
  cliState.sandboxId = sandboxId

  await ensureOpenSandboxApiBase()
  const sandbox = await Sandbox.connect({
    sandboxId,
    connectionConfig: createConnectionConfig(),
    readyTimeoutSeconds: readEnvNumber('VIBEMUX_OPENSANDBOX_READY_TIMEOUT_SECONDS', 60),
  })
  cliSandbox = sandbox
  cliState.phase = 'ready'
  cliState.message = 'Connected to existing CLI-only OpenSandbox sandbox.'
  cliState.error = undefined
  writePersistedState()
  return sandbox
}

const killSandboxById = async (sandboxId: string) => {
  await ensureOpenSandboxApiBase()
  const manager = SandboxManager.create({
    connectionConfig: createConnectionConfig(),
  })
  try {
    await manager.killSandbox(sandboxId)
  } catch {
    // If the persisted sandbox no longer exists, local cleanup should still succeed.
  } finally {
    await manager.close().catch(() => undefined)
  }
}

const runDesktopAction = async (action: WorkspaceDesktopSandboxAction) => {
  const commands: Record<WorkspaceDesktopSandboxAction, string> = {
    terminal: 'DISPLAY=:0 xterm -geometry 100x30 -e bash &',
    'file-manager': 'DISPLAY=:0 thunar /home/desktop &',
    note: [
      'mkdir -p /home/desktop/Desktop',
      "printf 'Hello from OpenSandbox\\nThis file was created by wemux.\\n' > /home/desktop/Desktop/opensandbox-demo.txt",
    ].join(' && '),
    'demo-window': [
      'DISPLAY=:0 xterm -geometry 90x24 -T OpenSandbox-Demo',
      "-e bash -lc 'echo OpenSandbox desktop is running locally; echo; echo Try interacting through noVNC.; sleep 300' &",
    ].join(' '),
  }

  const sandbox = await ensureDesktopSandbox()
  const output = await runCommand(sandbox, commands[action])
  desktopState.lastOutput = output
  writePersistedState()
  return resultFromStatus(getStatusSnapshot(), true, output)
}

export const openSandboxDesktopProvider = {
  provider: 'opensandbox' as const,

  async status(): Promise<WorkspaceDesktopSandboxResult> {
    return resultFromStatus(getStatusSnapshot())
  },

  async start(request?: Pick<WorkspaceDesktopSandboxRequest, 'displayProfile' | 'clientNetwork' | 'cwd'>): Promise<WorkspaceDesktopSandboxResult> {
    try {
      return resultFromStatus(await startDesktopSandbox(request))
    } catch (error) {
      const message = describeError(error, 'OpenSandbox Desktop start failed.')
      return resultFromStatus(getStatusSnapshot(), false, message)
    }
  },

  async stop(): Promise<WorkspaceDesktopSandboxResult> {
    try {
      return resultFromStatus(await stopDesktopSandbox())
    } catch (error) {
      const message = describeError(error, 'OpenSandbox Desktop stop failed.')
      setDesktopError(message)
      return resultFromStatus(getStatusSnapshot(), false, message)
    }
  },

  async execute(request: WorkspaceDesktopSandboxRequest): Promise<WorkspaceDesktopSandboxResult> {
    try {
      if (request.operation === 'status') return await this.status()
      if (request.operation === 'start') return resultFromStatus(await startDesktopSandbox(request))

      if (request.operation === 'stop') return await this.stop()

      if (request.operation === 'command') {
        const command = request.command?.trim()
        if (!command) throw new Error('缺少 desktop sandbox command。')
        const output = await runCommand(
          await ensureDesktopSandbox(),
          command,
          {
            background: request.background === true,
            timeoutSeconds: readEnvNumber('VIBEMUX_OPENSANDBOX_COMMAND_TIMEOUT_SECONDS', DEFAULT_COMMAND_TIMEOUT_SECONDS),
          },
        )
        desktopState.lastOutput = output
        writePersistedState()
        return resultFromStatus(getStatusSnapshot(), didCommandSucceed(output), output)
      }

      if (request.operation === 'file.read') {
        const filePath = request.path?.trim()
        if (!filePath) throw new Error('缺少 file.read path。')
        const output = await (await ensureDesktopSandbox()).files.readFile(filePath)
        desktopState.lastOutput = output
        writePersistedState()
        return resultFromStatus(getStatusSnapshot(), true, output)
      }

      if (request.operation === 'file.write') {
        const filePath = request.path?.trim()
        if (!filePath) throw new Error('缺少 file.write path。')
        await (await ensureDesktopSandbox()).files.writeFiles([{ path: filePath, data: request.content ?? '', mode: 0o644 }])
        const output = `Wrote ${filePath}`
        desktopState.lastOutput = output
        writePersistedState()
        return resultFromStatus(getStatusSnapshot(), true, output)
      }

      if (request.operation === 'desktop.action') {
        if (!request.action) throw new Error('缺少 desktop action。')
        return await runDesktopAction(request.action)
      }

      if (request.operation === 'cli.start') {
        await startCliSandbox()
        return resultFromStatus(getStatusSnapshot())
      }

      if (request.operation === 'cli.stop') {
        await stopCliSandbox()
        return resultFromStatus(getStatusSnapshot())
      }

      if (request.operation === 'cli.command') {
        const command = request.command?.trim()
        if (!command) throw new Error('缺少 cli sandbox command。')
        const output = await runCommand(
          await ensureCliSandbox(),
          command,
          { timeoutSeconds: readEnvNumber('VIBEMUX_OPENSANDBOX_COMMAND_TIMEOUT_SECONDS', DEFAULT_COMMAND_TIMEOUT_SECONDS) },
        )
        cliState.lastOutput = output
        writePersistedState()
        return resultFromStatus(getStatusSnapshot(), didCommandSucceed(output), output)
      }

      throw new Error(`Unsupported desktop sandbox operation: ${request.operation}`)
    } catch (error) {
      const message = describeError(error, 'OpenSandbox desktop operation failed.')
      desktopState.lastOutput = message
      writePersistedState()
      return resultFromStatus(getStatusSnapshot(), false, message)
    }
  },
}

export const openSandboxDesktopClient = openSandboxDesktopProvider

/**
 * 暴露沙箱内指定端口（用于 Browser Use 的 CDP 调试端口）。
 * 返回形如 host:port 的 endpoint，host 侧据此连接 connectOverCDP。
 */
export const getDesktopSandboxEndpoint = async (port: number): Promise<{ endpoint: string }> => {
  const sandbox = await ensureDesktopSandbox()
  return sandbox.getEndpoint(port)
}
