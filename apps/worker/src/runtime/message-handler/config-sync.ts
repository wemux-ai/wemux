// [INPUT]: 配置同步消息
// [OUTPUT]: 同步执行
// [POS]: 配置同步处理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { normalizeAgentSettings, normalizeWorkerUpdateSettings } from '@shared/agent-config'
import type { ControlPlaneToExecutorMessage, WorkerConfig } from '@shared/types'
import {
  clearWorkerPairing,
  getWorkerLocalClaudeCodeConfigContent,
  getWorkerLocalCodexAuthContent,
  getWorkerLocalCodexConfigContent,
  getWorkerLocalOpencodeConfigContent,
  loadWorkerConfig,
  saveWorkerConfig,
} from '../../core/config'
import { getWorkerRuntimeState, updateWorkerRuntimeState } from '../../core/runtime-state'
import { listWorkerAvailableModels } from '../../execution/available-models'
import { parseCodexCredentialEnvironment, resolveCodexProviderConfig } from '../../execution/codex-models'
import { resolveExportedModelBindings } from '../model-config-export'
import { getWorkerVersion } from '../../core/app-root'
import { buildExecutorTelemetrySnapshot } from '../executor-resource-snapshot'
import { previewIngressController } from '../../preview-ingress/controller'
import { loadWorkerMeshRuntimeConfig, startWorkerMeshRuntime } from '../mesh-runtime-manager'
import type { ControlPlaneMessageHandlerParams } from './types'

const logWorkerConfigSync = (stage: string, payload: Record<string, unknown>) => {
  console.log('[worker-config-sync]', stage, JSON.stringify(payload))
}

const reconcilePreviewIngressIfLocalConsoleAvailable = (config: WorkerConfig) => {
  const localConsole = getWorkerRuntimeState().localConsole
  if (localConsole && !localConsole.enabled) {
    logWorkerConfigSync('preview-ingress.skipped', {
      reason: localConsole.disabledReason || 'local console unavailable',
    })
    return
  }

  void previewIngressController.reconcile(config).catch((error) => {
    logWorkerConfigSync('preview-ingress.failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

const buildConfigSyncDebugPayload = (config: WorkerConfig) => {
  const codexConfigContent = config.codexConfigContent?.trim() || ''
  const codexAuthContent = config.codexAuthContent?.trim() || ''
  const codexProvider = resolveCodexProviderConfig({
    configContent: codexConfigContent,
    authContent: codexAuthContent,
  })

  return {
    executorId: config.executorId || '',
    defaultModel: config.defaultModel || '',
    codexDefaultModel: config.agentSettings?.Codex?.defaultModel || '',
    hasOpencodeConfigContent: Boolean(config.opencodeConfigContent?.trim()),
    opencodeConfigLength: config.opencodeConfigContent?.length ?? 0,
    hasCodexConfigContent: Boolean(codexConfigContent),
    codexConfigLength: codexConfigContent.length,
    hasCodexAuthContent: Boolean(codexAuthContent),
    codexAuthLength: codexAuthContent.length,
    codexProviderId: codexProvider.providerId,
    codexConfiguredModel: codexProvider.configuredModel || '',
    codexManagedCredentialEnvKeys: Object.keys(parseCodexCredentialEnvironment(codexAuthContent)).sort(),
    hasClaudeCodeConfigContent: Boolean(config.claudeCodeConfigContent?.trim()),
    claudeCodeConfigLength: config.claudeCodeConfigContent?.length ?? 0,
    mcpServerCount: config.mcpServers?.length ?? 0,
    featureFlags: config.featureFlags ?? null,
    maxConcurrency: config.maxConcurrency,
    previewExposureMode: config.previewExposureMode ?? 'private',
    previewIngressPort: config.previewIngressPort,
    hasPreviewProxySecret: Boolean(config.previewProxySecret?.trim()),
    meshEnabled: config.meshEnrollment?.enabled === true,
    meshPeerCount: config.meshEnrollment?.peers.length ?? 0,
  }
}

// 中央下发的 agent 配置内容：仅当非空时才覆盖 worker 本地（可能由本地文件回填）的值。
// 否则未填写的中央配置会以空字符串清空本地 provider/auth，导致 agent 退回内置免费额度。
const resolveCentralConfigContent = (incoming: string | undefined, current: string | undefined) =>
  incoming && incoming.trim() ? incoming : (current ?? '')

export const syncWorkerAgentConfig = (payload: {
  opencodeConfigContent?: string
  codexConfigContent?: string
  codexAuthContent?: string
  claudeCodeConfigContent?: string
  claudeCodeCredentialsContent?: string
  defaultModel?: string
  agentSettings?: WorkerConfig['agentSettings']
  workerUpdateSettings?: WorkerConfig['workerUpdateSettings']
  mcpServers?: WorkerConfig['mcpServers']
  maxConcurrency?: number
  previewExposureMode?: WorkerConfig['previewExposureMode']
  previewIngressPort?: WorkerConfig['previewIngressPort']
  previewProxySecret?: WorkerConfig['previewProxySecret']
  meshEnrollment?: WorkerConfig['meshEnrollment']
  featureFlags?: import('@shared/user-experimental-settings').ExecutorFeatureFlags
}) => {
  const current = getWorkerRuntimeState().config ?? loadWorkerConfig()
  const nextOpencodeConfigContent = resolveCentralConfigContent(payload.opencodeConfigContent, current.opencodeConfigContent)
  const nextCodexConfigContent = resolveCentralConfigContent(payload.codexConfigContent, current.codexConfigContent)
  const nextCodexAuthContent = resolveCentralConfigContent(payload.codexAuthContent, current.codexAuthContent)
  const nextClaudeCodeConfigContent = resolveCentralConfigContent(payload.claudeCodeConfigContent, current.claudeCodeConfigContent)
  const nextClaudeCodeCredentialsContent = resolveCentralConfigContent(payload.claudeCodeCredentialsContent, current.claudeCodeCredentialsContent)
  const nextDefaultModel = payload.defaultModel !== undefined
    ? payload.defaultModel
    : current.defaultModel
  const next = {
    ...current,
    opencodeConfigContent: nextOpencodeConfigContent,
    codexConfigContent: nextCodexConfigContent,
    codexAuthContent: nextCodexAuthContent,
    claudeCodeConfigContent: nextClaudeCodeConfigContent,
    claudeCodeCredentialsContent: nextClaudeCodeCredentialsContent,
    defaultModel: nextDefaultModel,
    agentSettings: normalizeAgentSettings(payload.agentSettings ?? current.agentSettings, nextDefaultModel),
    workerUpdateSettings: normalizeWorkerUpdateSettings(payload.workerUpdateSettings ?? current.workerUpdateSettings),
    mcpServers: payload.mcpServers ?? current.mcpServers ?? [],
    maxConcurrency: Math.max(1, payload.maxConcurrency ?? current.maxConcurrency),
    previewExposureMode: payload.previewExposureMode ?? current.previewExposureMode ?? 'private',
    previewIngressPort: Math.max(1, payload.previewIngressPort ?? current.previewIngressPort ?? 38080),
    previewProxySecret: payload.previewProxySecret ?? current.previewProxySecret,
    meshEnrollment: payload.meshEnrollment ?? current.meshEnrollment,
    featureFlags: payload.featureFlags ?? current.featureFlags,
  }

  saveWorkerConfig(next)
  updateWorkerRuntimeState({
    config: next,
    featureFlags: next.featureFlags,
    mesh: startWorkerMeshRuntime(loadWorkerMeshRuntimeConfig(next)),
  })
  reconcilePreviewIngressIfLocalConsoleAvailable(next)
  return next
}

export const syncWorkerOpenCodeConfig = syncWorkerAgentConfig

export const handleConfigSyncMessage = (
  message: ControlPlaneToExecutorMessage,
  params: ControlPlaneMessageHandlerParams,
) => {
  let config = params.getConfig()

  if (message.type === 'control-plane.ready') {
    config = syncWorkerAgentConfig({
      opencodeConfigContent: message.opencodeConfigContent,
      codexConfigContent: message.codexConfigContent,
      codexAuthContent: message.codexAuthContent,
      claudeCodeConfigContent: message.claudeCodeConfigContent,
      claudeCodeCredentialsContent: message.claudeCodeCredentialsContent,
      defaultModel: message.defaultModel,
      agentSettings: message.agentSettings,
      workerUpdateSettings: message.workerUpdateSettings,
      mcpServers: message.mcpServers,
      maxConcurrency: message.maxConcurrency,
      previewExposureMode: message.previewExposureMode,
      previewIngressPort: message.previewIngressPort,
      previewProxySecret: message.previewProxySecret,
      meshEnrollment: message.meshEnrollment,
      featureFlags: message.featureFlags,
    })
    params.setConfig(config)
    updateWorkerRuntimeState({
      config,
      executorId: config.executorId,
    })
    logWorkerConfigSync('control-plane.ready', buildConfigSyncDebugPayload(config))
    return true
  }

  if (message.type === 'config.sync') {
    config = syncWorkerAgentConfig({
      opencodeConfigContent: message.opencodeConfigContent,
      codexConfigContent: message.codexConfigContent,
      codexAuthContent: message.codexAuthContent,
      claudeCodeConfigContent: message.claudeCodeConfigContent,
      claudeCodeCredentialsContent: message.claudeCodeCredentialsContent,
      defaultModel: message.defaultModel,
      agentSettings: message.agentSettings,
      workerUpdateSettings: message.workerUpdateSettings,
      mcpServers: message.mcpServers,
      maxConcurrency: message.maxConcurrency,
      previewExposureMode: message.previewExposureMode,
      previewIngressPort: message.previewIngressPort,
      previewProxySecret: message.previewProxySecret,
      meshEnrollment: message.meshEnrollment,
      featureFlags: message.featureFlags,
    })
    params.setConfig(config)
    updateWorkerRuntimeState({ config })
    logWorkerConfigSync('config.sync', buildConfigSyncDebugPayload(config))
    return true
  }

  if (message.type === 'executor.unpair') {
    const reason = message.reason || 'This worker was removed from the control plane.'
    const next = clearWorkerPairing()
    params.setConfig(next)
    updateWorkerRuntimeState({
      daemonMode: 'unpaired',
      paired: false,
      connected: false,
      executorId: undefined,
      config: next,
      lastError: reason,
    })
    if (message.shutdown) {
      params.requestShutdown(reason)
    }
    return true
  }

  if (message.type === 'executor.shutdown') {
    params.requestShutdown(message.reason || 'Control plane requested worker shutdown.')
    return true
  }

  if (message.type === 'config.export.request') {
    config = loadWorkerConfig()
    params.setConfig(config)
    void listWorkerAvailableModels(message.agentType).then((modelSnapshot: Awaited<ReturnType<typeof listWorkerAvailableModels>>) => {
      const localOpencodeConfigContent = getWorkerLocalOpencodeConfigContent()
      const localCodexConfigContent = getWorkerLocalCodexConfigContent()
      const localCodexAuthContent = getWorkerLocalCodexAuthContent()
      const localClaudeCodeConfigContent = getWorkerLocalClaudeCodeConfigContent()
      const exportConfig: WorkerConfig = {
        ...config,
        opencodeConfigContent: localOpencodeConfigContent || config.opencodeConfigContent,
        codexConfigContent: localCodexConfigContent || config.codexConfigContent,
        codexAuthContent: localCodexAuthContent || config.codexAuthContent,
        claudeCodeConfigContent: localClaudeCodeConfigContent || config.claudeCodeConfigContent,
      }
      params.send({
        type: 'config.export.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        opencodeConfigContent: exportConfig.opencodeConfigContent,
        codexConfigContent: exportConfig.codexConfigContent,
        codexAuthContent: exportConfig.codexAuthContent,
        claudeCodeConfigContent: exportConfig.claudeCodeConfigContent,
        defaultModel: modelSnapshot.defaultModel ?? config.defaultModel,
        agentSettings: config.agentSettings,
        availableModels: modelSnapshot.models,
        resolvedModelBindings: message.includeResolvedModelBindings
          ? resolveExportedModelBindings({
              config: exportConfig,
              agentType: message.agentType,
              availableModels: modelSnapshot.models,
            })
          : undefined,
        modelsMessage: modelSnapshot.message,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.telemetry.request') {
    config = loadWorkerConfig()
    params.setConfig(config)
    params.send({
      type: 'executor.telemetry.response',
      executorId: config.executorId!,
      requestId: message.requestId,
      telemetry: buildExecutorTelemetrySnapshot({
        workspaceRoot: config.workspaceRoot,
        workerVersion: getWorkerVersion(),
      }),
      at: new Date().toISOString(),
    })
    return true
  }

  return false
}
