// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// [INPUT]: Worker environment plus optional preferred and additional local console ports.
// [OUTPUT]: Stable environment-specific base ports and non-overlapping probe/listen candidates.
// [POS]: Cross-client Worker console port contract shared by web, server tooling, and worker runtime.

export type WorkerConsolePortEnvironment = 'development' | 'preview' | 'production'

export const WORKER_CONSOLE_PORT_BASES: Record<WorkerConsolePortEnvironment, number> = {
  development: 48121,
  preview: 48123,
  production: 48100,
}

export const WORKER_CONSOLE_PORT_RANGE_SIZE = 20

export const normalizeWorkerConsolePortEnvironment = (value?: string): WorkerConsolePortEnvironment | undefined => {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'dev' || normalized === 'development' || normalized === 'local') {
    return 'development'
  }
  if (normalized === 'preview' || normalized === 'staging') {
    return 'preview'
  }
  if (normalized === 'prod' || normalized === 'production' || normalized === 'latest') {
    return 'production'
  }
  return undefined
}

export const resolveWorkerConsolePortEnvironment = (params: {
  explicitEnvironment?: string
  nodeEnv?: string
  releaseChannel?: string
  cloudUrl?: string
  appUrl?: string
} = {}): WorkerConsolePortEnvironment => {
  const explicit = normalizeWorkerConsolePortEnvironment(params.explicitEnvironment)
  if (explicit) {
    return explicit
  }

  const releaseChannel = params.releaseChannel?.trim().toLowerCase()
  if (releaseChannel === 'preview') {
    return 'preview'
  }
  if (releaseChannel === 'production' || releaseChannel === 'latest') {
    return 'production'
  }

  const url = `${params.cloudUrl ?? ''} ${params.appUrl ?? ''}`.toLowerCase()
  // 兼容窗口：新旧域名都识别，后续可移除 vibemux 分支
  if (url.includes('vibemux.xyz') || url.includes('wemux.xyz')) {
    return 'preview'
  }
  if (url.includes('vibemux.com') || url.includes('wemux.ai')) {
    return 'production'
  }

  if (params.nodeEnv?.trim().toLowerCase() === 'development') {
    return 'development'
  }

  return 'production'
}

export const getWorkerConsolePortBase = (environment: WorkerConsolePortEnvironment) => {
  return WORKER_CONSOLE_PORT_BASES[environment]
}

const normalizePort = (value: unknown) => {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined
}

const getWorkerConsoleRangePort = (environment: WorkerConsolePortEnvironment, offset: number) => {
  if (environment === 'production') {
    return offset < WORKER_CONSOLE_PORT_RANGE_SIZE ? 48100 + offset : 48200 + (offset - WORKER_CONSOLE_PORT_RANGE_SIZE) * 3
  }
  if (environment === 'preview') {
    return offset < WORKER_CONSOLE_PORT_RANGE_SIZE ? 48123 + offset : 48201 + (offset - WORKER_CONSOLE_PORT_RANGE_SIZE) * 3
  }
  if (offset === 0) {
    return 48121
  }
  return offset < WORKER_CONSOLE_PORT_RANGE_SIZE ? 48142 + offset : 48202 + (offset - WORKER_CONSOLE_PORT_RANGE_SIZE) * 3
}

export const buildWorkerConsolePortCandidates = (params: {
  environment?: WorkerConsolePortEnvironment
  preferredPort?: number
  additionalPorts?: readonly number[]
  rangeSize?: number
} = {}) => {
  const environment = params.environment ?? 'production'
  const rangeSize = Math.max(1, Math.floor(params.rangeSize ?? WORKER_CONSOLE_PORT_RANGE_SIZE))
  const ports: number[] = []
  const addPort = (value: unknown) => {
    const port = normalizePort(value)
    if (port && !ports.includes(port)) {
      ports.push(port)
    }
  }

  addPort(params.preferredPort)
  for (const port of params.additionalPorts ?? []) {
    addPort(port)
  }

  for (let offset = 0; offset < rangeSize; offset += 1) {
    addPort(getWorkerConsoleRangePort(environment, offset))
  }

  return ports
}
