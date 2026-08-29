// [INPUT]: 发布信息输入
// [OUTPUT]: 版本通道
// [POS]: worker 发布服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

type WorkerReleaseChannel = 'preview' | 'production'

export type WorkerReleaseStatus = {
  channel: WorkerReleaseChannel
  packageName: string
  packageTag: string
  latestVersion?: string
  checkedAt: string
  ok: boolean
  message?: string
}

type NpmPackageMetadata = {
  'dist-tags'?: Record<string, string>
}

const WORKER_RELEASE_CACHE_TTL_MS = 5 * 60 * 1000

const releaseStatusCache = new Map<WorkerReleaseChannel, { expiresAt: number; value: WorkerReleaseStatus }>()

const getRegistryUrl = () => {
  return (process.env.npm_config_registry?.trim() || 'https://registry.npmjs.org').replace(/\/$/, '')
}

const resolveWorkerPackageName = (channel: WorkerReleaseChannel) => {
  return channel === 'preview' ? 'vibemux-worker-preview' : 'vibemux-worker'
}

const resolveWorkerPackageTag = (channel: WorkerReleaseChannel) => {
  return channel === 'preview' ? 'preview' : 'latest'
}

const fetchWorkerReleaseStatus = async (channel: WorkerReleaseChannel): Promise<WorkerReleaseStatus> => {
  const packageName = resolveWorkerPackageName(channel)
  const packageTag = resolveWorkerPackageTag(channel)
  const checkedAt = new Date().toISOString()

  try {
    const response = await fetch(`${getRegistryUrl()}/${packageName}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      return {
        channel,
        packageName,
        packageTag,
        checkedAt,
        ok: false,
        message: `查询 npm 包失败，HTTP ${response.status}`,
      }
    }

    const metadata = await response.json() as NpmPackageMetadata
    const latestVersion = metadata['dist-tags']?.[packageTag]?.trim()
    if (!latestVersion) {
      return {
        channel,
        packageName,
        packageTag,
        checkedAt,
        ok: false,
        message: `未找到 npm dist-tag: ${packageTag}`,
      }
    }

    return {
      channel,
      packageName,
      packageTag,
      latestVersion,
      checkedAt,
      ok: true,
    }
  } catch (error) {
    return {
      channel,
      packageName,
      packageTag,
      checkedAt,
      ok: false,
      message: error instanceof Error ? error.message : '查询 npm 更新失败',
    }
  }
}

export const getWorkerReleaseStatus = async (channel: WorkerReleaseChannel, options?: { force?: boolean }) => {
  const now = Date.now()
  const cached = releaseStatusCache.get(channel)
  if (!options?.force && cached && cached.expiresAt > now) {
    return cached.value
  }

  const value = await fetchWorkerReleaseStatus(channel)
  releaseStatusCache.set(channel, {
    expiresAt: now + WORKER_RELEASE_CACHE_TTL_MS,
    value,
  })
  return value
}

export const listWorkerReleaseStatuses = async () => {
  const [preview, production] = await Promise.all([
    getWorkerReleaseStatus('preview'),
    getWorkerReleaseStatus('production'),
  ])

  return {
    preview,
    production,
  }
}
