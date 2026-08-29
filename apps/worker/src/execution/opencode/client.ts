// [INPUT]: OpenCode server 输入
// [OUTPUT]: 客户端句柄
// [POS]: OpenCode 客户端
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHash } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createOpencodeClient } from '@opencode-ai/sdk'
import { parseOpencodeConfigContent } from '@shared/opencode-config'
import { resolveExecutable } from '../../core/command-utils'
import { resolveOpencodeExecutable } from '../../core/opencode-runtime'
import { shouldSpawnWithShellOnWindows } from '../agent-runner-shared'
import { getErrorText, logWorkerOpencodeDebug } from './shared'

type OpenCodeServerHandle = {
  url: string
  close: () => void
}

const serverPool = new Map<string, Promise<OpenCodeServerHandle>>()
const serverHandles = new Set<OpenCodeServerHandle>()
const serverProcesses = new Set<ChildProcess>()

export const terminateOpencodeServerProcess = (proc: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') => {
  if (!proc.pid) {
    proc.kill(signal)
    return
  }

  if (process.platform !== 'win32') {
    try {
      process.kill(-proc.pid, signal)
      return
    } catch {
      // Fall back to the direct child; the process may have exited between checks.
    }
  }

  proc.kill(signal)
}

const terminateTrackedOpencodeServerProcesses = () => {
  for (const proc of Array.from(serverProcesses)) {
    terminateOpencodeServerProcess(proc)
  }
}

process.once('exit', terminateTrackedOpencodeServerProcesses)

const sortRecordEntries = (record?: Record<string, string>) => {
  return Object.entries(record ?? {}).sort(([left], [right]) => left.localeCompare(right))
}

export const buildOpencodeServerCacheKey = (configContent?: string, runtimeEnv?: Record<string, string>) => {
  return createHash('sha1')
    .update(JSON.stringify({
      config: parseOpencodeConfigContent(configContent),
      runtimeEnv: sortRecordEntries(runtimeEnv),
    }))
    .digest('hex')
}

export const buildOpencodeServerEnv = (
  configContent?: string,
  runtimeEnv?: Record<string, string>,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => {
  return {
    ...baseEnv,
    ...(runtimeEnv ?? {}),
    OPENCODE_CONFIG_CONTENT: JSON.stringify(parseOpencodeConfigContent(configContent)),
  }
}

const resolveOpencodeLaunchCommand = () => {
  const opencodeExecutable = resolveOpencodeExecutable()
  if (opencodeExecutable) {
    return {
      command: opencodeExecutable,
      args: [] as string[],
      detail: opencodeExecutable,
    }
  }

  const npxExecutable = resolveExecutable('npx')
  if (npxExecutable) {
    return {
      command: npxExecutable,
      args: ['-y', 'opencode-ai'],
      detail: `${npxExecutable} -y opencode-ai`,
    }
  }

  throw new Error('未检测到可执行的 OpenCode runtime（`opencode`），无法启动 OpenCode 会话。')
}

const allocatePort = async () => {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('无法分配 OpenCode 端口。')))
        return
      }

      const { port } = address
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(port)
      })
    })
  })
}

const startOpencodeServer = async (key: string, configContent?: string, runtimeEnv?: Record<string, string>) => {
  const port = await allocatePort()
  const launch = resolveOpencodeLaunchCommand()
  const proc = spawn(launch.command, [...launch.args, 'serve', '--hostname=127.0.0.1', `--port=${port}`], {
    detached: process.platform !== 'win32',
    env: buildOpencodeServerEnv(configContent, runtimeEnv),
    stdio: ['ignore', 'pipe', 'pipe'] as const,
    shell: shouldSpawnWithShellOnWindows(launch.command),
  })
  serverProcesses.add(proc)
  let handle: OpenCodeServerHandle | null = null

  proc.once('exit', (code, signal) => {
    serverPool.delete(key)
    serverProcesses.delete(proc)
    if (handle) {
      serverHandles.delete(handle)
    }
    logWorkerOpencodeDebug('server:exit', {
      pid: proc.pid,
      code,
      signal,
      port,
    })
  })

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for server to start after 15000ms via ${launch.detail}`))
    }, 15000)
    let output = ''
    let settled = false

    const finalize = (callback: () => void) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      callback()
    }

    const handleOutput = (chunk: Buffer | string) => {
      output += chunk.toString()
      const lines = output.split('\n')
      for (const line of lines) {
        if (!line.startsWith('opencode server listening')) {
          continue
        }

        const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
        if (!match) {
          finalize(() => reject(new Error(`Failed to parse server url from output: ${line}`)))
          return
        }

        finalize(() => resolve(match[1]))
        return
      }
    }

    proc.stdout?.on('data', handleOutput)
    proc.stderr?.on('data', handleOutput)
    proc.on('error', (error) => {
      finalize(() => reject(error))
    })
    proc.on('exit', (code) => {
      finalize(() => {
        const detail = output.trim()
        reject(new Error(detail ? `OpenCode server exited with code ${code}: ${detail}` : `OpenCode server exited with code ${code}`))
      })
    })
  })

  let closed = false
  handle = {
    url,
    close() {
      if (closed) {
        return
      }

      closed = true
      serverHandles.delete(handle!)
      terminateOpencodeServerProcess(proc)
    },
  }
  serverHandles.add(handle)

  return handle
}

const getOpencodeServer = async (configContent?: string, runtimeEnv?: Record<string, string>) => {
  const key = buildOpencodeServerCacheKey(configContent, runtimeEnv)
  const existing = serverPool.get(key)
  if (existing) {
    return existing
  }

  const next = startOpencodeServer(key, configContent, runtimeEnv).catch((error) => {
    serverPool.delete(key)
    throw error
  })
  serverPool.set(key, next)
  return next
}

export const shutdownOpencodeServers = async () => {
  const pendingServers = Array.from(serverPool.values())
  serverPool.clear()

  terminateTrackedOpencodeServerProcesses()

  const settledServers = await Promise.allSettled(pendingServers)
  for (const result of settledServers) {
    if (result.status === 'fulfilled') {
      result.value.close()
    }
  }

  for (const handle of Array.from(serverHandles)) {
    handle.close()
  }
  serverHandles.clear()
}

export const getOpencodeClient = async (cwd: string, configContent?: string, runtimeEnv?: Record<string, string>) => {
  const server = await getOpencodeServer(configContent, runtimeEnv)
  return createOpencodeClient({ baseUrl: server.url, directory: cwd })
}

export const getRootOpencodeClient = async (configContent?: string, runtimeEnv?: Record<string, string>) => {
  const server = await getOpencodeServer(configContent, runtimeEnv)
  return createOpencodeClient({ baseUrl: server.url })
}

export const createOpencodeSession = async (
  client: ReturnType<typeof createOpencodeClient>,
  cwd: string,
  title: string,
) => {
  logWorkerOpencodeDebug('session:create:start', {
    cwd,
    title,
  })

  let session: Awaited<ReturnType<typeof client.session.create>>
  try {
    session = await client.session.create({
      body: { title },
      query: { directory: cwd },
    })
  } catch (error) {
    logWorkerOpencodeDebug('session:create:error', {
      cwd,
      title,
      error: getErrorText(error),
    })
    throw error
  }

  logWorkerOpencodeDebug('session:create:result', {
    cwd,
    title,
    hasData: Boolean(session.data),
    sessionId: session.data?.id,
    error: 'error' in session ? session.error : undefined,
    response: 'response' in session ? session.response : undefined,
  })

  if (!session.data?.id) {
    const reason = getErrorText(session)
    throw new Error(reason === 'OpenCode 执行失败。' ? 'OpenCode 会话创建失败' : `OpenCode 会话创建失败：${reason}`)
  }

  return session.data.id
}

export const ensureOpencodeSession = async (
  client: ReturnType<typeof createOpencodeClient>,
  cwd: string,
  sessionId: string | undefined,
  title: string,
) => {
  const normalizedSessionId = sessionId?.trim()
  if (!normalizedSessionId) {
    return createOpencodeSession(client, cwd, title)
  }

  try {
    const session = await client.session.get({
      path: { id: normalizedSessionId },
      query: { directory: cwd },
    })

    if (!session.data) {
      return createOpencodeSession(client, cwd, title)
    }

    await client.session.update({
      path: { id: normalizedSessionId },
      body: { title },
      query: { directory: cwd },
    })

    return normalizedSessionId
  } catch {
    return createOpencodeSession(client, cwd, title)
  }
}
