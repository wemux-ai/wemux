// [INPUT]: 预览入口请求
// [OUTPUT]: 控制器
// [POS]: 预览入口控制
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import os from 'node:os'
import type http from 'node:http'
import { deriveMeshProxyPortFromLocalServerPort } from '@shared/easytier-ports'
import type { WorkerConfig } from '@shared/types'
import { updateWorkerRuntimeState } from '../core/runtime-state'
import { detectPublicIp } from './public-ip'
import { buildPreviewIngressBaseUrl, shouldEnablePreviewIngress, startPreviewIngressServer } from './server'

const closeServer = async (server: http.Server) => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

const state: {
  server: http.Server | null
  meshServer: http.Server | null
  port: number
  meshPort: number
  meshHost: string
  previewProxySecret: string
  detectedPublicIp: string
  detectedLanIp: string
} = {
  server: null,
  meshServer: null,
  port: 0,
  meshPort: 0,
  meshHost: '',
  previewProxySecret: '',
  detectedPublicIp: '',
  detectedLanIp: '',
}

const isPrivateIpv4 = (value: string) => (
  /^10\./.test(value)
  || /^192\.168\./.test(value)
  || /^172\.(1[6-9]|2\d|3[0-1])\./.test(value)
)

const detectLanIp = () => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .filter((entry) => !entry.internal && Boolean(entry.address?.trim()))

  const ipv4Candidates = addresses.filter((entry) => entry.family === 'IPv4' && !entry.address.startsWith('169.254.'))
  const privateIpv4 = ipv4Candidates.find((entry) => isPrivateIpv4(entry.address))
  if (privateIpv4) {
    return privateIpv4.address
  }
  if (ipv4Candidates[0]) {
    return ipv4Candidates[0].address
  }

  const ipv6Candidate = addresses.find((entry) => entry.family === 'IPv6' && !entry.address.toLowerCase().startsWith('fe80:'))
  return ipv6Candidate?.address || ''
}

const hasInterfaceAddress = (targetAddress: string) => {
  const normalizedTarget = targetAddress.trim()
  if (!normalizedTarget) {
    return false
  }

  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .some((entry) => entry.address?.trim() === normalizedTarget)
}

export const resolveWorkerMeshProxyPort = (config: Pick<WorkerConfig, 'localServerPort' | 'meshEnrollment'>) => {
  const fallbackMeshPort = deriveMeshProxyPortFromLocalServerPort(config.localServerPort)
  const configuredMeshPort = Number(config.meshEnrollment?.previewProxyPort || 0)
  const hasExplicitMeshProxyPort = Boolean(process.env.VIBEMUX_EASYTIER_PREVIEW_PROXY_PORT?.trim())
  return hasExplicitMeshProxyPort && Number.isInteger(configuredMeshPort) && configuredMeshPort > 0 && configuredMeshPort <= 65535
    ? configuredMeshPort
    : fallbackMeshPort
}

export const previewIngressController = {
  async reconcile(config: WorkerConfig) {
    const previewProxySecret = config.previewProxySecret?.trim() || ''
    const meshHost = config.meshEnrollment?.enabled ? config.meshEnrollment.ipv4?.trim() || '' : ''
    const meshPort = config.meshEnrollment?.enabled
      ? resolveWorkerMeshProxyPort(config)
      : 0
    const meshHostReady = !meshHost || hasInterfaceAddress(meshHost)
    state.detectedLanIp = detectLanIp()
    if (!meshHost || !meshHostReady || !previewProxySecret || !Number.isInteger(meshPort) || meshPort <= 0 || meshPort > 65535) {
      if (state.meshServer) {
        await closeServer(state.meshServer)
        state.meshServer = null
        state.meshPort = 0
        state.meshHost = ''
      }
    } else if (
      !state.meshServer
      || state.meshPort !== meshPort
      || state.meshHost !== meshHost
      || state.previewProxySecret !== previewProxySecret
    ) {
      if (state.meshServer) {
        await closeServer(state.meshServer)
      }
      state.meshServer = startPreviewIngressServer({
        port: meshPort,
        sharedSecret: previewProxySecret,
        listenHost: meshHost,
        executorId: config.executorId,
        terminalDirectWsUrl: `ws://127.0.0.1:${config.localServerPort}/api/terminal-direct/ws`,
      })
      state.meshPort = meshPort
      state.meshHost = meshHost
    }

    if (!shouldEnablePreviewIngress(config)) {
      if (state.server) {
        await closeServer(state.server)
        state.server = null
        state.port = 0
      }
      state.previewProxySecret = state.meshServer ? previewProxySecret : ''
      state.detectedPublicIp = ''
      return {
        enabled: false as const,
        previewIngressBaseUrl: '',
        detectedPublicIp: '',
        detectedLanIp: state.detectedLanIp,
      }
    }

    const nextPort = Number(config.previewIngressPort || 0)
    if (!state.server || state.port !== nextPort || state.previewProxySecret !== previewProxySecret) {
      if (state.server) {
        await closeServer(state.server)
      }
      state.server = startPreviewIngressServer({
        port: nextPort,
        sharedSecret: previewProxySecret,
        terminalDirectWsUrl: `ws://127.0.0.1:${config.localServerPort}/api/terminal-direct/ws`,
      })
      state.port = nextPort
      state.previewProxySecret = previewProxySecret
    }

    state.detectedPublicIp = await detectPublicIp()
    const previewIngressBaseUrl = state.detectedPublicIp
      ? buildPreviewIngressBaseUrl({ publicIp: state.detectedPublicIp, port: nextPort })
      : ''
    updateWorkerRuntimeState({
      config: {
        ...config,
        previewExposureMode: config.previewExposureMode,
        previewIngressPort: config.previewIngressPort,
        previewProxySecret: config.previewProxySecret,
      },
    })

    return {
      enabled: true as const,
      previewIngressBaseUrl,
      detectedPublicIp: state.detectedPublicIp,
      detectedLanIp: state.detectedLanIp,
    }
  },

  async shutdown() {
    if (!state.server && !state.meshServer) {
      return
    }
    if (state.server) {
      await closeServer(state.server)
    }
    state.server = null
    if (state.meshServer) {
      await closeServer(state.meshServer)
      state.meshServer = null
    }
    state.port = 0
    state.meshPort = 0
    state.meshHost = ''
    state.previewProxySecret = ''
    state.detectedPublicIp = ''
    state.detectedLanIp = ''
  },
}
