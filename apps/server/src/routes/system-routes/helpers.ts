import type { AppState } from '@shared/types'
import { getEnv } from '@shared/env'
import { getWorkerConsolePortBase } from '@shared/worker-console-ports'
import { readCustomAgentConfig, writeCustomAgentConfig } from '@shared/custom-agent'
import { agentService } from '../../integrations/agent/service'
import { deleteTelegramWebhookWithConfig, setupTelegramWebhookWithConfig } from '../../integrations/telegram'
import { listVisibleExecutorsForUser } from '../../control-plane/collaboration'
import { executorRegistry } from '../../control-plane/executor-registry'
import { executorWsService } from '../../control-plane/executor-ws-service'
import { getPrimaryAgentMcpServers } from '../../services/primary-agent-mcp'
import { resolveUserFeatureFlags } from '../../services/user-experimental-settings-service'
import { resolveExecutorMeshEnrollment } from '../../services/executor-mesh-service'

const DEFAULT_WORKER_LOCAL_SERVER_PORT = Number(getEnv('WEMUX_WORKER_PORT') || getWorkerConsolePortBase(process.env.NODE_ENV === 'development' ? 'development' : 'production'))
const DEFAULT_WORKER_CONSOLE_URL = `http://127.0.0.1:${DEFAULT_WORKER_LOCAL_SERVER_PORT}`

export const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

export const resolveWorkerConsoleUrl = () => {
  const configured = process.env.VIBEMUX_WORKER_CONSOLE_URL?.trim()
  return trimTrailingSlash(configured || DEFAULT_WORKER_CONSOLE_URL)
}

export const resolveTaskImageObjectKeys = (filename: string) => {
  if (!filename || filename.includes('/') || filename.includes('\\')) {
    return []
  }

  const keys: string[] = []
  const appendKey = (taskId?: string) => {
    if (!taskId || keys.includes(`images/tasks/${taskId}/${filename}`)) {
      return
    }
    keys.push(`images/tasks/${taskId}/${filename}`)
  }

  appendKey(/^(.+)-\d{10,}-[a-z0-9]{6}\.[a-z0-9]+$/i.exec(filename)?.[1])
  appendKey(filename.split('-')[0])
  return keys
}

export const resolveTaskAttachmentObjectKeys = (filename: string) => {
  if (!filename || filename.includes('/') || filename.includes('\\')) {
    return []
  }

  const keys: string[] = []
  const appendKey = (taskId?: string) => {
    if (!taskId || keys.includes(`attachments/tasks/${taskId}/${filename}`)) {
      return
    }
    keys.push(`attachments/tasks/${taskId}/${filename}`)
  }

  appendKey(/^(.+)-\d{10,}-[a-z0-9]{6}\.[a-z0-9]+$/i.exec(filename)?.[1])
  appendKey(filename.split('-')[0])
  return keys
}

export const resolveMainChatImageObjectKey = (filename: string) => {
  if (!filename || filename.includes('/') || filename.includes('\\')) {
    return ''
  }

  return `images/main-chat/${filename}`
}

export const sanitizeUploadFilename = (filename: string, fallback: string) => {
  const trimmed = filename.trim()
  const parts = trimmed.split(/[\\/]+/).filter(Boolean)
  const basename = parts.at(-1) || fallback
  const sanitized = basename
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 160)

  return sanitized || fallback
}

export const requestWorkerConsole = async <T>(path: string, init?: RequestInit) => {
  const response = await fetch(`${resolveWorkerConsoleUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const payload = await response.json().catch(() => ({})) as T & { message?: string }
  if (!response.ok) {
    throw new Error(payload.message || `Worker Console 请求失败 (${response.status})`)
  }

  return payload
}

export const parseClaudeCodeConfigContent = (content: string) => {
  const trimmed = content.trim()
  if (!trimmed) {
    return null
  }

  return JSON.parse(trimmed) as unknown
}

export const normalizeAgentMutationPayload = (payload: {
  name: string
  type: string
  endpoint?: string | null
  config?: Record<string, unknown>
}) => {
  const name = payload.name.trim().slice(0, 80)
  const endpoint = payload.endpoint?.trim() || null
  const currentConfig = payload.config ?? {}

  return {
    name,
    type: 'custom',
    endpoint,
    config: writeCustomAgentConfig(currentConfig, readCustomAgentConfig(currentConfig)),
  }
}

export const findConflictingAgentName = (name: string, userId: string, currentId?: string) => {
  const normalized = name.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  return agentService.getAllAgents().find((agent) => {
    if (agent.ownerUserId !== userId) {
      return false
    }
    if (currentId && agent.id === currentId) {
      return false
    }

    return agent.name.trim().toLowerCase() === normalized
  }) ?? null
}

export const resolveImportedAgentName = (name: string, userId: string) => {
  const baseName = name.trim().slice(0, 80) || 'Imported Agent'
  if (!findConflictingAgentName(baseName, userId)) {
    return baseName
  }

  const importedBase = `${baseName} (Imported)`.slice(0, 80)
  if (!findConflictingAgentName(importedBase, userId)) {
    return importedBase
  }

  for (let index = 2; index < 1000; index += 1) {
    const suffix = ` (${index})`
    const candidate = importedBase.slice(0, Math.max(1, 80 - suffix.length)) + suffix
    if (!findConflictingAgentName(candidate, userId)) {
      return candidate
    }
  }

  return `${baseName.slice(0, 60)}-${Date.now().toString().slice(-6)}`.slice(0, 80)
}

export const syncSettingsToVisibleExecutors = (params: {
  userId: string
  config: AppState['config']
}) => {
  const executors = listVisibleExecutorsForUser(params.userId)

  return executors
    .filter((executor) => executorWsService.dispatchTask(executor.executorId, {
      type: 'config.sync',
      opencodeConfigContent: params.config.opencodeConfigContent,
      codexConfigContent: params.config.codexConfigContent,
      codexAuthContent: params.config.codexAuthContent,
      claudeCodeConfigContent: params.config.claudeCodeConfigContent,
      claudeCodeCredentialsContent: params.config.claudeCodeCredentialsContent,
      defaultModel: params.config.defaultModel,
      agentSettings: params.config.agentSettings,
      workerUpdateSettings: params.config.workerUpdateSettings,
      mcpServers: getPrimaryAgentMcpServers(params.config, executor.ownerUserId),
      maxConcurrency: executor.maxConcurrency,
      previewExposureMode: executor.previewExposureMode,
      previewIngressPort: executor.previewIngressPort,
      previewProxySecret: executorRegistry.getPreviewProxySecret(executor.executorId),
      meshEnrollment: resolveExecutorMeshEnrollment(executor),
      featureFlags: resolveUserFeatureFlags(executor.ownerUserId),
      at: new Date().toISOString(),
    }))
    .map((executor) => executor.executorId)
}

export const resolveCustomChannelAgent = (agentId: string, userId?: string) => {
  const agent = agentService.getAgent(agentId)
  if (
    !agent
    || agent.type.trim().toLowerCase() === 'main'
    || (userId?.trim() && agent.ownerUserId !== userId.trim())
  ) {
    return null
  }

  return {
    agent,
    profile: readCustomAgentConfig(agent.config),
  }
}

export const resolvePublicBaseUrl = (requestUrl: string) => {
  const configured = trimTrailingSlash(process.env.VIBEMUX_PUBLIC_BASE_URL?.trim() || '')
  if (configured) {
    return configured
  }

  return trimTrailingSlash(new URL(requestUrl).origin)
}

export const buildAgentWebhookUrls = (requestUrl: string, agentId: string, workspaceId?: string) => {
  const baseUrl = resolvePublicBaseUrl(requestUrl)
  const suffix = workspaceId?.trim() ? `?workspaceId=${encodeURIComponent(workspaceId.trim())}` : ''
  return {
    telegram: `${baseUrl}/api/channel/telegram/${agentId}/webhook${suffix}`,
    feishu: `${baseUrl}/api/channel/feishu/${agentId}/webhook${suffix}`,
    wecom: `${baseUrl}/api/channel/wecom/${agentId}/callback${suffix}`,
    whatsapp: `${baseUrl}/api/channel/whatsapp/${agentId}/webhook${suffix}`,
  }
}

export const buildExternalConversationTitle = (text: string) => {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized) {
    return '外部会话'
  }

  return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized
}

export const buildTelegramExternalConversationId = (chatId: number, threadId?: number) => {
  return threadId ? `telegram:${chatId}:${threadId}` : `telegram:${chatId}`
}

export const buildFeishuExternalConversationId = (chatType: string, chatId: string, senderId: string) => {
  if (chatType === 'group' && chatId) {
    return `feishu:group:${chatId}`
  }

  return `feishu:p2p:${senderId}`
}

export const stripFeishuMentions = (text: string) => text.replace(/@_user_\d+/g, '').trim()

export const parseFeishuTextContent = (content?: string) => {
  if (!content?.trim()) {
    return ''
  }

  try {
    const parsed = JSON.parse(content) as { text?: string }
    return typeof parsed.text === 'string' ? parsed.text : ''
  } catch {
    return ''
  }
}

export const buildAgentChannelPayload = (params: {
  requestUrl: string
  agentId: string
  workspaceId?: string
  profile: ReturnType<typeof readCustomAgentConfig>
  syncStatus?: {
    telegramWebhookRegistered?: boolean
    warnings?: string[]
  }
  telegramWebhookInfo?: {
    url: string
    hasCustomCertificate: boolean
    pendingUpdateCount: number
    lastErrorDate?: number
    lastErrorMessage: string
    maxConnections?: number
    allowedUpdates: string[]
  } | null
}) => {
  return {
    channels: params.profile.channels,
    webhookUrls: buildAgentWebhookUrls(params.requestUrl, params.agentId, params.workspaceId),
    syncStatus: {
      telegramWebhookRegistered: params.syncStatus?.telegramWebhookRegistered ?? false,
      warnings: params.syncStatus?.warnings ?? [],
    },
    telegramWebhookInfo: params.telegramWebhookInfo ?? null,
  }
}

export const syncAgentChannelBindings = async (params: {
  requestUrl: string
  agentId: string
  workspaceId?: string
  profile: ReturnType<typeof readCustomAgentConfig>
  previousProfile?: ReturnType<typeof readCustomAgentConfig>
}) => {
  const warnings: string[] = []
  let telegramWebhookRegistered = false
  const previousToken = params.previousProfile?.channels.telegram.botToken.trim() || ''
  const nextToken = params.profile.channels.telegram.botToken.trim()
  const shouldDeletePreviousTelegramWebhook = Boolean(
    previousToken
    && (
      !params.profile.channels.telegram.enabled
      || !nextToken
      || previousToken !== nextToken
    ),
  )

  if (shouldDeletePreviousTelegramWebhook) {
    const deleteResult = await deleteTelegramWebhookWithConfig(previousToken)
    if (!deleteResult.ok) {
      warnings.push(`Telegram 旧 webhook 清理失败：${deleteResult.message}`)
    }
  }

  if (params.profile.channels.telegram.enabled && nextToken) {
    const webhookUrls = buildAgentWebhookUrls(params.requestUrl, params.agentId, params.workspaceId)
    const telegramResult = await setupTelegramWebhookWithConfig({
      botToken: nextToken,
      webhookUrl: webhookUrls.telegram,
      secretToken: params.profile.channels.telegram.webhookSecret || undefined,
    })
    if (telegramResult.ok) {
      telegramWebhookRegistered = true
    } else {
      warnings.push(`Telegram webhook 自动注册失败：${telegramResult.message}`)
    }
  }

  if (
    params.profile.channels.feishu.enabled
    && (!params.profile.channels.feishu.appId.trim() || !params.profile.channels.feishu.appSecret.trim())
  ) {
    warnings.push('飞书已启用，但尚未填写 App ID / App Secret，暂时无法处理入站事件。')
  }

  if (
    params.profile.channels.wechat.enabled
    && !params.profile.channels.wechat.botToken.trim()
  ) {
    warnings.push('微信已启用，但尚未完成扫码绑定，暂时无法处理入站消息。')
  }

  if (
    params.profile.channels.discord.enabled
    && !params.profile.channels.discord.botToken.trim()
  ) {
    warnings.push('Discord 已启用，但尚未填写 Bot Token，暂时无法处理入站消息。')
  }

  if (
    params.profile.channels.slack.enabled
    && (!params.profile.channels.slack.botToken.trim() || !params.profile.channels.slack.appToken.trim())
  ) {
    warnings.push('Slack 已启用，但尚未填写 Bot Token / App Token，暂时无法处理入站消息。')
  }

  if (
    params.profile.channels.wecom.enabled
    && (!params.profile.channels.wecom.corpId.trim() || !params.profile.channels.wecom.agentId.trim() || !params.profile.channels.wecom.secret.trim())
  ) {
    warnings.push('企业微信已启用，但尚未填写 Corp ID / Agent ID / Secret，暂时无法处理入站消息。')
  }

  if (
    params.profile.channels.whatsapp.enabled
    && (!params.profile.channels.whatsapp.phoneNumberId.trim() || !params.profile.channels.whatsapp.accessToken.trim())
  ) {
    warnings.push('WhatsApp 已启用，但尚未填写 Phone Number ID / Access Token，暂时无法处理入站消息。')
  }

  return {
    telegramWebhookRegistered,
    warnings,
  }
}
