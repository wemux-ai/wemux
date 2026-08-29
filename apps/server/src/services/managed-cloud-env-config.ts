// [INPUT]: 云节点环境配置
// [OUTPUT]: 配置输出
// [POS]: managed cloud 环境配置
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { normalizeManagedCloudConfig } from '@shared/agent-config'
import type { ManagedCloudConfig } from '@shared/types'

// 品牌迁移兼容：WEMUX_ 优先，VIBEMUX_ 兜底双读（存量部署不受影响）。
const readString = (key: string) => {
  const wemuxKey = key.startsWith('VIBEMUX_') ? `WEMUX_${key.slice('VIBEMUX_'.length)}` : key
  return process.env[wemuxKey]?.trim() || process.env[key]?.trim() || ''
}

const readBoolean = (key: string) => {
  const wemuxKey = key.startsWith('VIBEMUX_') ? `WEMUX_${key.slice('VIBEMUX_'.length)}` : key
  const normalized = process.env[wemuxKey]?.trim().toLowerCase()
    || process.env[key]?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

const readRuntimeProvider = () => {
  const value = readString('VIBEMUX_MANAGED_CLOUD_RUNTIME_PROVIDER')
  return value === 'disabled' || value === 'unsafe-local-process' || value === 'docker-cli' || value === 'boxlite-cli' || value === 'ascii-box-cli' || value === 'ascii-box-sdk' || value === 'cloudflare-sandbox'
    ? value
    : undefined
}

const readEgressMode = () => {
  const dockerValue = readString('VIBEMUX_MANAGED_CLOUD_DOCKER_EGRESS_MODE')
  const boxliteValue = readString('VIBEMUX_MANAGED_CLOUD_BOXLITE_EGRESS_MODE')
  const asciiBoxValue = readString('VIBEMUX_MANAGED_CLOUD_ASCII_BOX_EGRESS_MODE')
  return dockerValue === 'none' || boxliteValue === 'none' || asciiBoxValue === 'none'
    ? 'none'
    : undefined
}

const readDockerPool = (): ManagedCloudConfig['dockerPool'] | undefined => {
  const raw = readString('VIBEMUX_MANAGED_CLOUD_DOCKER_POOL')
  if (!raw) {
    return undefined
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    return normalizeManagedCloudConfig({ dockerPool: Array.isArray(parsed) ? parsed : [] }).dockerPool
  } catch {
    return undefined
  }
}

const readBoxlitePool = (): ManagedCloudConfig['boxlitePool'] | undefined => {
  const raw = readString('VIBEMUX_MANAGED_CLOUD_ASCII_BOX_POOL')
    || readString('VIBEMUX_MANAGED_CLOUD_BOXLITE_POOL')
  if (!raw) {
    return undefined
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    return normalizeManagedCloudConfig({ boxlitePool: Array.isArray(parsed) ? parsed : [] }).boxlitePool
  } catch {
    return undefined
  }
}

export const resolveManagedCloudConfigFromEnv = (): ManagedCloudConfig => {
  const dockerPool = readDockerPool()
  const boxlitePool = readBoxlitePool()

  return normalizeManagedCloudConfig({
    runtimeProvider: readRuntimeProvider(),
    idleAutoStopMinutes: readString('VIBEMUX_MANAGED_CLOUD_IDLE_AUTO_STOP_MINUTES'),
    allowLocalControlPlaneRuntime: readBoolean('VIBEMUX_MANAGED_CLOUD_ALLOW_LOCAL_CONTROL_PLANE_RUNTIME')
      || readBoolean('VIBEMUX_MANAGED_CLOUD_ALLOW_LOCAL_DOCKER'),
    allowLocalDocker: readBoolean('VIBEMUX_MANAGED_CLOUD_ALLOW_LOCAL_CONTROL_PLANE_RUNTIME')
      || readBoolean('VIBEMUX_MANAGED_CLOUD_ALLOW_LOCAL_DOCKER'),
    dockerImage: readString('VIBEMUX_MANAGED_CLOUD_DOCKER_IMAGE'),
    dockerHost: readString('VIBEMUX_MANAGED_CLOUD_DOCKER_HOST'),
    dockerContext: readString('VIBEMUX_MANAGED_CLOUD_DOCKER_CONTEXT'),
    dockerEgressMode: readEgressMode(),
    dockerNetwork: readString('VIBEMUX_MANAGED_CLOUD_DOCKER_NETWORK'),
    dockerCpus: readString('VIBEMUX_MANAGED_CLOUD_DOCKER_CPUS'),
    dockerMemory: readString('VIBEMUX_MANAGED_CLOUD_DOCKER_MEMORY'),
    dockerWorkerHomeInContainer: readString('VIBEMUX_MANAGED_CLOUD_DOCKER_WORKER_HOME'),
    dockerPool,
    boxliteUrl: readString('VIBEMUX_MANAGED_CLOUD_ASCII_BOX_URL') || readString('VIBEMUX_MANAGED_CLOUD_BOXLITE_URL'),
    boxliteHome: readString('VIBEMUX_MANAGED_CLOUD_ASCII_BOX_HOME') || readString('VIBEMUX_MANAGED_CLOUD_BOXLITE_HOME'),
    boxliteImage: readString('VIBEMUX_MANAGED_CLOUD_ASCII_BOX_IMAGE') || readString('VIBEMUX_MANAGED_CLOUD_BOXLITE_IMAGE'),
    boxliteCpus: readString('VIBEMUX_MANAGED_CLOUD_ASCII_BOX_CPUS') || readString('VIBEMUX_MANAGED_CLOUD_BOXLITE_CPUS'),
    boxliteMemory: readString('VIBEMUX_MANAGED_CLOUD_ASCII_BOX_MEMORY') || readString('VIBEMUX_MANAGED_CLOUD_BOXLITE_MEMORY'),
    boxliteWorkerHomeInContainer: readString('VIBEMUX_MANAGED_CLOUD_ASCII_BOX_WORKER_HOME') || readString('VIBEMUX_MANAGED_CLOUD_BOXLITE_WORKER_HOME'),
    boxlitePool,
    asciiBoxApiKey: readString('VIBEMUX_MANAGED_CLOUD_ASCII_BOX_API_KEY') || readString('ASCII_BOX_API_KEY') || readString('BOX_API_KEY'),
    asciiBoxBaseUrl: readString('VIBEMUX_MANAGED_CLOUD_ASCII_BOX_BASE_URL') || readString('BOX_BASE_URL'),
    asciiBoxTtlSeconds: readString('VIBEMUX_MANAGED_CLOUD_ASCII_BOX_TTL_SECONDS'),
    asciiBoxBootstrapCommand: readString('VIBEMUX_MANAGED_CLOUD_ASCII_BOX_BOOTSTRAP_COMMAND'),
    cfSandbox: {
      gatewayUrl: readString('VIBEMUX_MANAGED_CLOUD_CF_SANDBOX_GATEWAY_URL'),
      apiKey: readString('VIBEMUX_MANAGED_CLOUD_CF_SANDBOX_API_KEY'),
      instanceType: readString('VIBEMUX_MANAGED_CLOUD_CF_SANDBOX_INSTANCE_TYPE'),
      workspaceHome: readString('VIBEMUX_MANAGED_CLOUD_CF_SANDBOX_WORKSPACE_HOME'),
      keepAliveSeconds: readString('VIBEMUX_MANAGED_CLOUD_CF_SANDBOX_KEEP_ALIVE_SECONDS'),
      mountDrive: readBoolean('VIBEMUX_MANAGED_CLOUD_CF_SANDBOX_MOUNT_DRIVE'),
      driveMountPath: readString('VIBEMUX_MANAGED_CLOUD_CF_SANDBOX_DRIVE_MOUNT_PATH'),
      bootstrapCommand: readString('VIBEMUX_MANAGED_CLOUD_CF_SANDBOX_BOOTSTRAP_COMMAND'),
    },
  })
}

export const applyManagedCloudEnvConfig = <T extends { managedCloud?: ManagedCloudConfig }>(config: T): T & { managedCloud: ManagedCloudConfig } => {
  return {
    ...config,
    managedCloud: resolveManagedCloudConfigFromEnv(),
  }
}
