import { getEnv } from '@shared/env'
/**
 * [INPUT]: Persisted worker pairing config and matching local daemon APIs.
 * [OUTPUT]: Current worker and daemon status for terminal or JSON consumers.
 * [POS]: Local worker status command; never treats this one-shot CLI process as daemon state.
 * [PROTOCOL]: Update this header when responsibilities change, then check AGENTS.md.
 */
import type { WorkerConfig } from '@shared/types'
import {
  buildWorkerConsolePortCandidates,
  resolveWorkerConsolePortEnvironment,
  type WorkerConsolePortEnvironment,
} from '@shared/worker-console-ports'
import { output, getOutputFormat } from '../output'
import { parseCliFlags } from '../../cli-flags'
import { loadWorkerConfig } from '../../core/config'
import { getWorkerVersion } from '../../core/app-root'
import { getLocalWorkerConsoleUrl } from '../../core/local-console'
import type { WorkerRuntimeState } from '../../core/runtime-state'
import { getWorkerReleaseChannel } from '../../update/worker-release'

type WorkerStatusConfig = Pick<WorkerConfig, 'cloudUrl' | 'executorId' | 'localServerPort'>

type LocalWorkerStatus = {
  reachable: boolean
  url?: string
  executorId?: string
  message: string
  runtime?: WorkerRuntimeState
}

type LocalWorkerStatusOptions = {
  fetchImpl?: typeof fetch
  portEnvironment?: WorkerConsolePortEnvironment
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'unknown request failure'

export const getLiveWorkerStatus = async (
  config: WorkerStatusConfig,
  options: LocalWorkerStatusOptions = {},
): Promise<LocalWorkerStatus> => {
  const environment = options.portEnvironment ?? resolveWorkerConsolePortEnvironment({
    explicitEnvironment: getEnv('WEMUX_WORKER_PORT_PROFILE'),
    nodeEnv: process.env.NODE_ENV,
    releaseChannel: getWorkerReleaseChannel(),
    cloudUrl: config.cloudUrl,
  })
  const fetchImpl = options.fetchImpl ?? fetch
  const ports = buildWorkerConsolePortCandidates({
    environment,
    preferredPort: config.localServerPort,
  })
  const probes = await Promise.all(ports.map(async (port) => {
    const url = getLocalWorkerConsoleUrl(port)
    try {
      const identityResponse = await fetchImpl(`${url}/api/local-access/identity`, {
        signal: AbortSignal.timeout(750),
      })
      if (!identityResponse.ok) return { kind: 'unavailable' as const }

      const identity = await identityResponse.json() as { executorId?: string }
      if (identity.executorId !== config.executorId) {
        return { kind: 'mismatched' as const, executorId: identity.executorId, url }
      }

      const statusResponse = await fetchImpl(`${url}/api/status`, {
        signal: AbortSignal.timeout(750),
      })
      if (!statusResponse.ok) {
        return { kind: 'failed' as const, message: `Local worker status returned HTTP ${statusResponse.status}`, url }
      }

      const payload = await statusResponse.json() as { runtime?: WorkerRuntimeState }
      if (!payload.runtime) {
        return { kind: 'failed' as const, message: 'Local worker status did not include runtime state', url }
      }

      return { kind: 'matched' as const, executorId: identity.executorId, runtime: payload.runtime, url }
    } catch (error) {
      return { kind: 'failed' as const, message: getErrorMessage(error), url }
    }
  }))

  const matched = probes.find((probe) => probe.kind === 'matched')
  if (matched) {
    return {
      reachable: true,
      url: matched.url,
      executorId: matched.executorId,
      message: 'Live worker daemon is responding.',
      runtime: matched.runtime,
    }
  }

  const mismatched = probes.find((probe) => probe.kind === 'mismatched')
  if (mismatched) {
    return {
      reachable: false,
      url: mismatched.url,
      executorId: mismatched.executorId,
      message: `A local worker is responding, but its executor (${mismatched.executorId || 'unpaired'}) does not match this CLI configuration.`,
    }
  }

  const failed = probes.find((probe) => probe.kind === 'failed')
  return {
    reachable: false,
    message: failed
      ? `No matching local worker daemon is available: ${failed.message}`
      : 'No matching local worker daemon is listening on the configured local console ports.',
  }
}

export const runStatusCommand = async (args: string[]) => {
  const flags = parseCliFlags(args)
  const format = getOutputFormat(flags)
  const config = loadWorkerConfig()
  const localDaemon = await getLiveWorkerStatus(config)
  const version = getWorkerVersion()

  const statusData = {
    worker: {
      name: config.executorName || 'unnamed',
      executorId: config.executorId || 'not paired',
      machineId: config.machineId,
      machineName: config.machineName,
      cloudUrl: config.cloudUrl,
      version,
      paired: Boolean(config.executorId && config.executorToken),
      daemonMode: localDaemon.runtime?.daemonMode ?? 'not-running',
      connected: localDaemon.runtime?.connected ?? false,
      maxConcurrency: config.maxConcurrency,
      workspaceRoot: config.workspaceRoot,
    },
    localDaemon,
    runtime: localDaemon.runtime ?? null,
  }

  output(statusData, format)
}
