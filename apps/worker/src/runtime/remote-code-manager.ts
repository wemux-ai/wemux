// [INPUT]: remote-code 请求
// [OUTPUT]: 远端代码管理
// [POS]: 远端代码管理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { WorkspaceRemoteCodeRequest, WorkspaceRemoteCodeResult } from '@shared/types'
import { resolveExecutable, shouldSpawnWithShellOnWindows } from '../core/command-utils'
import { getWorkerNodeDir } from '../core/config'

type RemoteCodeSession = {
  workspaceId: string
  workspaceSessionId: string
  cwd: string
  port: number
  localUrl: string
  password?: string
  pid?: number
  process: ChildProcess
  startedAt: string
  updatedAt: string
}

const sessions = new Map<string, RemoteCodeSession>()
const startPromises = new Map<string, Promise<WorkspaceRemoteCodeResult>>()
let installPromise: Promise<string> | null = null

const nowIso = () => new Date().toISOString()
const sessionKey = (workspaceSessionId: string) => workspaceSessionId.trim()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const readEnv = (name: string) => {
  const value = process.env[name]?.trim()
  return value || undefined
}

const getManagedCodeServerPrefix = () => path.join(getWorkerNodeDir(), 'runtime', 'code-server')
const getManagedCodeServerBin = () => path.join(getManagedCodeServerPrefix(), 'bin', 'code-server')

const commandRuns = (command: string, args: string[], timeoutMs = 5000) => new Promise<boolean>((resolve) => {
  const executable = resolveExecutable(command) || command
  const child = spawn(executable, args, {
    stdio: ['ignore', 'ignore', 'ignore'],
    shell: shouldSpawnWithShellOnWindows(executable),
  })
  const timer = setTimeout(() => {
    child.kill('SIGKILL')
    resolve(false)
  }, timeoutMs)
  child.once('error', () => {
    clearTimeout(timer)
    resolve(false)
  })
  child.once('exit', (code) => {
    clearTimeout(timer)
    resolve(code === 0)
  })
})

const resolveExistingCodeServerBin = async () => {
  const configured = readEnv('VIBEMUX_CODE_SERVER_BIN')
  if (configured) {
    if (await commandRuns(configured, ['--version'])) {
      return configured
    }
    throw new Error(`VIBEMUX_CODE_SERVER_BIN 不可执行或无法启动: ${configured}`)
  }

  const managedBin = getManagedCodeServerBin()
  if (existsSync(managedBin) && await commandRuns(managedBin, ['--version'])) {
    return managedBin
  }

  if (await commandRuns('code-server', ['--version'])) {
    return resolveExecutable('code-server') || 'code-server'
  }

  return null
}

const installManagedCodeServer = async () => {
  const existing = await resolveExistingCodeServerBin()
  if (existing) {
    return existing
  }

  if (process.platform === 'win32') {
    throw new Error('当前 worker 平台暂不支持自动安装 code-server，请设置 VIBEMUX_CODE_SERVER_BIN。')
  }

  const prefix = getManagedCodeServerPrefix()
  mkdirSync(prefix, { recursive: true })

  const response = await fetch('https://code-server.dev/install.sh')
  if (!response.ok) {
    throw new Error(`下载 code-server 安装脚本失败: HTTP ${response.status}`)
  }
  const script = await response.text()

  const child = spawn('sh', ['-s', '--', '--method=standalone', `--prefix=${prefix}`], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
    },
  })
  let output = ''
  const collectOutput = (chunk: Buffer) => {
    output = `${output}${chunk.toString('utf8')}`.slice(-8000)
  }
  child.stdout?.on('data', collectOutput)
  child.stderr?.on('data', collectOutput)

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
    child.stdin?.end(script)
  }).catch((error) => {
    throw new Error(`启动 code-server 安装脚本失败: ${error instanceof Error ? error.message : String(error)}`)
  })

  if (exitCode !== 0) {
    throw new Error(`code-server 自动安装失败，exitCode=${exitCode}${output.trim() ? `\n${output.trim()}` : ''}`)
  }

  const managedBin = getManagedCodeServerBin()
  if (existsSync(managedBin) && await commandRuns(managedBin, ['--version'])) {
    return managedBin
  }

  throw new Error(`code-server 自动安装完成但未找到可执行文件: ${managedBin}`)
}

const resolveCodeServerBin = async () => {
  const existing = await resolveExistingCodeServerBin()
  if (existing) {
    return existing
  }

  if (!installPromise) {
    installPromise = installManagedCodeServer().finally(() => {
      installPromise = null
    })
  }

  return installPromise
}

const buildErrorResult = (
  request: Pick<WorkspaceRemoteCodeRequest, 'workspaceId' | 'workspaceSessionId' | 'cwd'>,
  error: string,
): WorkspaceRemoteCodeResult => ({
  ok: false,
  phase: 'error',
  workspaceId: request.workspaceId,
  workspaceSessionId: request.workspaceSessionId,
  cwd: request.cwd,
  updatedAt: nowIso(),
  error,
})

const toResult = (session: RemoteCodeSession, phase: WorkspaceRemoteCodeResult['phase'] = 'ready'): WorkspaceRemoteCodeResult => ({
  ok: phase === 'ready' || phase === 'stopped',
  phase,
  workspaceId: session.workspaceId,
  workspaceSessionId: session.workspaceSessionId,
  cwd: session.cwd,
  localUrl: session.localUrl,
  password: session.password,
  pid: session.pid,
  port: session.port,
  startedAt: session.startedAt,
  updatedAt: nowIso(),
})

const isProcessAlive = (pid?: number) => {
  if (!pid) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const normalizeCwd = (cwd: string) => path.resolve(cwd)

const validateCwd = (cwd: string) => {
  const resolved = normalizeCwd(cwd)
  if (!existsSync(resolved)) {
    throw new Error(`Code Server 工作目录不存在: ${resolved}`)
  }
  if (!statSync(resolved).isDirectory()) {
    throw new Error(`Code Server 工作目录不是目录: ${resolved}`)
  }
  return resolved
}

const isPortAvailable = (port: number) => new Promise<boolean>((resolve) => {
  const server = net.createServer()
  server.once('error', () => resolve(false))
  server.once('listening', () => {
    server.close(() => resolve(true))
  })
  server.listen(port, '127.0.0.1')
})

const pickPort = async () => {
  const configured = Number(readEnv('VIBEMUX_CODE_SERVER_PORT') || 0)
  if (Number.isInteger(configured) && configured > 0 && await isPortAvailable(configured)) {
    return configured
  }

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const port = 49152 + Math.floor(Math.random() * 12000)
    if (await isPortAvailable(port)) {
      return port
    }
  }

  throw new Error('没有可用端口启动 Code Server。')
}

const waitForHealth = async (params: {
  localUrl: string
  processRef: ChildProcess
  getSpawnError: () => Error | null
}) => {
  const deadline = Date.now() + 20_000
  const healthUrl = new URL('/healthz', params.localUrl).toString()
  let lastError = ''

  while (Date.now() < deadline) {
    const spawnError = params.getSpawnError()
    if (spawnError) {
      throw spawnError
    }
    if (params.processRef.exitCode !== null) {
      throw new Error(lastError || `code-server 已退出，exitCode=${params.processRef.exitCode}`)
    }

    try {
      const response = await fetch(healthUrl)
      await response.body?.cancel().catch(() => undefined)
      if (response.ok) {
        return
      }
      lastError = `healthz returned ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'health check failed'
    }

    await sleep(300)
  }

  throw new Error(`等待 code-server 启动超时: ${lastError || healthUrl}`)
}

const stopSession = async (workspaceSessionId: string) => {
  const key = sessionKey(workspaceSessionId)
  const session = sessions.get(key)
  if (!session) {
    return null
  }

  sessions.delete(key)
  try {
    session.process.kill('SIGTERM')
  } catch {
    // Process may already be gone.
  }

  await sleep(300)
  if (isProcessAlive(session.pid)) {
    try {
      session.process.kill('SIGKILL')
    } catch {
      // Process may already be gone.
    }
  }

  return session
}

const getActiveSession = (workspaceSessionId: string) => {
  const key = sessionKey(workspaceSessionId)
  const session = sessions.get(key)
  if (!session) {
    return null
  }
  if (!isProcessAlive(session.pid) || session.process.exitCode !== null) {
    sessions.delete(key)
    return null
  }
  session.updatedAt = nowIso()
  return session
}

const startSession = async (request: WorkspaceRemoteCodeRequest) => {
  const existing = getActiveSession(request.workspaceSessionId)
  const cwd = validateCwd(request.cwd)
  if (existing && existing.cwd === cwd) {
    return toResult(existing)
  }
  if (existing) {
    await stopSession(request.workspaceSessionId)
  }

  const port = await pickPort()
  const localUrl = `http://127.0.0.1:${port}/`
  const storageRoot = path.join(getWorkerNodeDir(), 'runtime', 'remote-code', request.workspaceSessionId)
  const userDataDir = path.join(storageRoot, 'user-data')
  const extensionsDir = path.join(storageRoot, 'extensions')
  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(extensionsDir, { recursive: true })

  const args = [
    '--bind-addr', `127.0.0.1:${port}`,
    '--auth', 'none',
    '--disable-telemetry',
    '--trusted-origins', '*',
    '--user-data-dir', userDataDir,
    '--extensions-dir', extensionsDir,
    cwd,
  ]
  const codeServerBin = await resolveCodeServerBin()
  const child = spawn(codeServerBin, args, {
    cwd,
    env: {
      ...process.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: shouldSpawnWithShellOnWindows(codeServerBin),
  })

  let output = ''
  let spawnError: Error | null = null
  const collectOutput = (chunk: Buffer) => {
    output = `${output}${chunk.toString('utf8')}`.slice(-4000)
  }
  child.stdout?.on('data', collectOutput)
  child.stderr?.on('data', collectOutput)
  child.once('error', (error) => {
    spawnError = error
  })

  const session: RemoteCodeSession = {
    workspaceId: request.workspaceId,
    workspaceSessionId: request.workspaceSessionId,
    cwd,
    port,
    localUrl,
    pid: child.pid,
    process: child,
    startedAt: nowIso(),
    updatedAt: nowIso(),
  }
  sessions.set(sessionKey(request.workspaceSessionId), session)

  child.once('exit', () => {
    const current = sessions.get(sessionKey(request.workspaceSessionId))
    if (current?.process === child) {
      sessions.delete(sessionKey(request.workspaceSessionId))
    }
  })

  try {
    await waitForHealth({
      localUrl,
      processRef: child,
      getSpawnError: () => spawnError,
    })
    return toResult(session)
  } catch (error) {
    await stopSession(request.workspaceSessionId)
    const message = error instanceof Error ? error.message : 'code-server 启动失败'
    return buildErrorResult(request, `${message}${output.trim() ? `\n${output.trim()}` : ''}`)
  }
}

export const remoteCodeManager = {
  async execute(request: WorkspaceRemoteCodeRequest): Promise<WorkspaceRemoteCodeResult> {
    try {
      if (request.operation === 'status') {
        const session = getActiveSession(request.workspaceSessionId)
        return session
          ? toResult(session)
          : {
              ok: true,
              phase: 'idle',
              workspaceId: request.workspaceId,
              workspaceSessionId: request.workspaceSessionId,
              cwd: request.cwd,
              updatedAt: nowIso(),
            }
      }

      if (request.operation === 'stop') {
        const stopped = await stopSession(request.workspaceSessionId)
        return stopped
          ? { ...toResult(stopped, 'stopped'), localUrl: undefined, password: undefined }
          : {
              ok: true,
              phase: 'stopped',
              workspaceId: request.workspaceId,
              workspaceSessionId: request.workspaceSessionId,
              cwd: request.cwd,
              updatedAt: nowIso(),
            }
      }

      if (request.operation === 'restart') {
        await stopSession(request.workspaceSessionId)
      }

      const key = sessionKey(request.workspaceSessionId)
      const existingStart = startPromises.get(key)
      if (existingStart) {
        return existingStart
      }

      const startPromise = startSession(request).finally(() => {
        startPromises.delete(key)
      })
      startPromises.set(key, startPromise)
      return startPromise
    } catch (error) {
      return buildErrorResult(request, error instanceof Error ? error.message : 'Code Server 操作失败')
    }
  },

  stopAll() {
    for (const key of sessions.keys()) {
      void stopSession(key)
    }
  },

  describeStartCommand(request: WorkspaceRemoteCodeRequest) {
    return `code-server --bind-addr 127.0.0.1:<port> --auth none --trusted-origins '*' ${shellQuote(normalizeCwd(request.cwd))}`
  },
}
