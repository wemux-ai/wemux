/**
 * [INPUT]: Control-plane route candidates, assigned labels, health endpoints, and probe timing.
 * [OUTPUT]: The lowest-latency reachable Worker control-plane route with deterministic fallback behavior.
 * [POS]: Worker connection routing policy used before opening the executor WebSocket.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { ExecutorConnectionRouteCandidate, ExecutorConnectionRouteResponse } from '@shared/types'
import { trimTrailingSlash } from './cloud-url'

type WorkerRouteProbeResult = {
  candidate: ExecutorConnectionRouteCandidate
  reachable: boolean
  latencyMs?: number
  statusCode?: number
  error?: string
}

export const workerRouteSelectionDeps = {
  fetch: (input: string, init?: RequestInit) => fetch(input, init),
  now: () => Date.now(),
}

const dedupeCandidates = (candidates: ExecutorConnectionRouteCandidate[]) => {
  const seen = new Set<string>()
  const deduped: ExecutorConnectionRouteCandidate[] = []

  for (const candidate of candidates) {
    const cloudUrl = trimTrailingSlash(candidate.cloudUrl.trim())
    if (!cloudUrl || seen.has(cloudUrl)) {
      continue
    }

    seen.add(cloudUrl)
    deduped.push({
      id: candidate.id.trim() || cloudUrl,
      cloudUrl,
      labels: Array.from(new Set(candidate.labels.map((label) => label.trim()).filter(Boolean))),
    })
  }

  return deduped
}

const buildRouteCandidates = (params: {
  bootstrapCloudUrl: string
  route: ExecutorConnectionRouteResponse
}) => {
  return dedupeCandidates([
    ...(params.route.candidates ?? []),
    {
      id: params.route.matchedRouteId?.trim() || 'assigned-route',
      cloudUrl: params.route.assignedCloudUrl,
      labels: params.route.assignedLabels,
    },
    {
      id: 'bootstrap',
      cloudUrl: params.bootstrapCloudUrl,
      labels: [],
    },
  ])
}

export const probeWorkerRouteCandidate = async (candidate: ExecutorConnectionRouteCandidate, timeoutMs = 2500): Promise<WorkerRouteProbeResult> => {
  const startedAt = workerRouteSelectionDeps.now()
  try {
    const response = await workerRouteSelectionDeps.fetch(`${trimTrailingSlash(candidate.cloudUrl)}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    })

    return {
      candidate,
      reachable: response.ok,
      latencyMs: workerRouteSelectionDeps.now() - startedAt,
      statusCode: response.status,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      candidate,
      reachable: false,
      latencyMs: workerRouteSelectionDeps.now() - startedAt,
      error: error instanceof Error ? error.message : 'probe failed',
    }
  }
}

export const selectWorkerConnectionRoute = async (params: {
  bootstrapCloudUrl: string
  route: ExecutorConnectionRouteResponse
  probeTimeoutMs?: number
}) => {
  const candidates = buildRouteCandidates(params)
  if (candidates.length <= 1) {
    const fallbackCandidate = candidates[0] ?? {
      id: params.route.matchedRouteId?.trim() || 'assigned-route',
      cloudUrl: trimTrailingSlash(params.route.assignedCloudUrl),
      labels: params.route.assignedLabels,
    }

    return {
      cloudUrl: fallbackCandidate.cloudUrl,
      labels: fallbackCandidate.labels,
      selectedCandidate: fallbackCandidate,
      probeResults: [] as WorkerRouteProbeResult[],
    }
  }

  const probeResults = await Promise.all(candidates.map((candidate) => probeWorkerRouteCandidate(
    candidate,
    params.probeTimeoutMs,
  )))
  const bestReachableProbe = probeResults
    .filter((result) => result.reachable)
    .sort((left, right) => (left.latencyMs ?? Number.MAX_SAFE_INTEGER) - (right.latencyMs ?? Number.MAX_SAFE_INTEGER))[0]

  const selectedCandidate = bestReachableProbe?.candidate ?? {
    id: params.route.matchedRouteId?.trim() || 'assigned-route',
    cloudUrl: trimTrailingSlash(params.route.assignedCloudUrl),
    labels: params.route.assignedLabels,
  }

  return {
    cloudUrl: selectedCandidate.cloudUrl,
    labels: selectedCandidate.labels,
    selectedCandidate,
    probeResults,
  }
}
