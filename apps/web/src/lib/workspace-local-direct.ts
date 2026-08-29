import {
  LOCAL_WORKER_DOCTOR_URL,
  LOCAL_WORKER_STATUS_URL,
  readLocalWorkerExecutor,
  resolveLocalWorkerEndpoints,
} from './browser-local-network-access'

export type LocalProbeStatus = 'idle' | 'ok' | 'error'

export type LocalWorkerDiagnosticsSnapshot = {
  status: LocalProbeStatus
  checkedAt: string
  executorId?: string
  daemonMode?: string
  connected?: boolean
  summary?: {
    total: number
    passed: number
    failed: number
    ok: boolean
  }
  firstFailureLabel?: string
  error?: string
  url: string
}

export type LocalEnvironmentProbeSnapshot = {
  status: LocalProbeStatus
  checkedAt: string
  url: string
  httpStatus?: number
  readable: boolean
  error?: string
}

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const DEFAULT_LOCAL_PROBE_TIMEOUT_MS = 3000

export const isLoopbackUrl = (value?: string) => {
  const url = value?.trim() || ''
  if (!url) {
    return false
  }

  try {
    const parsed = new URL(url)
    return LOOPBACK_HOSTNAMES.has(parsed.hostname)
  } catch {
    return false
  }
}

export const canUseLocalDirectWorkerScope = (params: {
  workspaceExecutorId?: string
  localWorkerExecutorId?: string
}) => {
  const workspaceExecutorId = params.workspaceExecutorId?.trim() || ''
  const localWorkerExecutorId = params.localWorkerExecutorId?.trim() || ''
  return Boolean(workspaceExecutorId && localWorkerExecutorId && workspaceExecutorId === localWorkerExecutorId)
}

export const readLocalWorkerDiagnostics = async ({
  endpoints = resolveLocalWorkerEndpoints(),
  fetchImpl = fetch,
  timeoutMs = DEFAULT_LOCAL_PROBE_TIMEOUT_MS,
  statusUrl = endpoints[0]?.statusUrl ?? LOCAL_WORKER_STATUS_URL,
  doctorUrl = endpoints[0]?.doctorUrl ?? LOCAL_WORKER_DOCTOR_URL,
}: {
  endpoints?: ReturnType<typeof resolveLocalWorkerEndpoints>
  fetchImpl?: typeof fetch
  timeoutMs?: number
  statusUrl?: string
  doctorUrl?: string
} = {}): Promise<LocalWorkerDiagnosticsSnapshot> => {
  const checkedAt = new Date().toISOString()
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null

  try {
    const [statusResponse, doctorResponse] = await Promise.all([
      fetchImpl(statusUrl, {
        cache: 'no-store',
        signal: controller?.signal,
      }),
      fetchImpl(doctorUrl, {
        cache: 'no-store',
        signal: controller?.signal,
      }),
    ])

    if (!statusResponse.ok) {
      return {
        status: 'error',
        checkedAt,
        url: statusUrl,
        error: `HTTP ${statusResponse.status}`,
      }
    }

    if (!doctorResponse.ok) {
      return {
        status: 'error',
        checkedAt,
        url: doctorUrl,
        error: `HTTP ${doctorResponse.status}`,
      }
    }

    const payload = await statusResponse.json().catch(() => null) as { runtime?: { executorId?: string; daemonMode?: string; connected?: boolean } } | null
    const doctorPayload = await doctorResponse.json().catch(() => null) as {
      items?: Array<{ ok?: boolean; label?: string }>
      summary?: { total: number; passed: number; failed: number; ok: boolean }
    } | null
    const firstFailure = doctorPayload?.items?.find((item) => item?.ok === false)
    return {
      status: 'ok',
      checkedAt,
      url: statusUrl,
      executorId: payload?.runtime?.executorId?.trim() || undefined,
      daemonMode: payload?.runtime?.daemonMode?.trim() || undefined,
      connected: payload?.runtime?.connected,
      summary: doctorPayload?.summary,
      firstFailureLabel: firstFailure?.label?.trim() || undefined,
    }
  } catch (error) {
    return {
      status: 'error',
      checkedAt,
      url: statusUrl,
      error: error instanceof Error ? error.message : 'Local worker diagnostics failed.',
    }
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

export const probeLocalEnvironmentUrl = async ({
  fetchImpl = fetch,
  timeoutMs = DEFAULT_LOCAL_PROBE_TIMEOUT_MS,
  url,
}: {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  url?: string
}): Promise<LocalEnvironmentProbeSnapshot | null> => {
  const normalizedUrl = url?.trim() || ''
  if (!normalizedUrl || !isLoopbackUrl(normalizedUrl)) {
    return null
  }

  const checkedAt = new Date().toISOString()
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null

  try {
    const response = await fetchImpl(normalizedUrl, {
      cache: 'no-store',
      signal: controller?.signal,
      mode: 'cors',
    })
    return {
      status: response.ok ? 'ok' : 'error',
      checkedAt,
      url: normalizedUrl,
      httpStatus: response.status,
      readable: true,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      status: 'error',
      checkedAt,
      url: normalizedUrl,
      readable: false,
      error: error instanceof Error ? error.message : 'Local environment probe failed.',
    }
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

export const readLocalDirectContext = async (workspaceExecutorId?: string) => {
  const localWorker = await readLocalWorkerExecutor({
    expectedExecutorId: workspaceExecutorId,
  })
  const localWorkerExecutorId = localWorker.executorId
  return {
    localWorkerExecutorId,
    localWorkerEndpoint: localWorker.endpoint,
    canUseLocalWorkerScope: canUseLocalDirectWorkerScope({
      workspaceExecutorId,
      localWorkerExecutorId,
    }),
  }
}
