import {
  normalizeSkillApprovalMode,
  normalizeSkillScope,
  normalizeSkillSlug,
  type SkillApprovalMode,
  type SkillScope,
  type SkillSelectionPolicy,
} from '@shared/skill'

export type McpTransport = 'http' | 'sse' | 'stdio' | 'custom'

export type McpCapabilityMode = 'resources' | 'resources+tools'

export type SkillPolicy = SkillSelectionPolicy

export type McpServerPolicy = {
  id: string
  name: string
  target: string
  transport: McpTransport
  enabled: boolean
  capabilityMode: McpCapabilityMode
  visibility?: 'private' | 'workspace' | 'team'
  workspaceId?: string
  ownerUserId?: string
  managedBySystem?: boolean
}

export const VIBEMUX_MCP_SERVER_ID = 'mcp-vibemux'
export const VIBEMUX_MCP_SERVER_NAME = 'vibemux'
const VIBEMUX_MCP_TARGET = 'built-in://vibemux'

export function createVibemuxMcpServerPolicy(enabled = true): McpServerPolicy {
  return {
    id: VIBEMUX_MCP_SERVER_ID,
    name: VIBEMUX_MCP_SERVER_NAME,
    target: VIBEMUX_MCP_TARGET,
    transport: 'http',
    enabled,
    capabilityMode: 'resources+tools',
    managedBySystem: true,
  }
}

export type PrimaryAgentConfig = {
  skills: SkillPolicy[]
  mcpServers: McpServerPolicy[]
  channels: {
    telegram: {
      enabled: boolean
      botToken: string
      mainChatId: string
      webhookUrl: string
    }
    feishu: {
      enabled: boolean
      webhookUrl: string
    }
  }
}

export type PrimaryAgentDraft = {
  name: string
  endpoint: string
  skills: SkillPolicy[]
  mcpServers: McpServerPolicy[]
  telegramEnabled: boolean
  telegramBotToken: string
  telegramMainChatId: string
  telegramWebhookUrl: string
  feishuEnabled: boolean
  feishuWebhookUrl: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createStableId(prefix: string, seed: string, index: number) {
  const slug = seed.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `${prefix}-${index + 1}`
  return `${prefix}-${index + 1}-${slug}`
}

function inferTransport(target: string): McpTransport {
  if (target.startsWith('stdio://')) {
    return 'stdio'
  }
  if (target.startsWith('sse://')) {
    return 'sse'
  }
  if (target.startsWith('http://') || target.startsWith('https://')) {
    return target.includes('/sse') ? 'sse' : 'http'
  }
  return 'custom'
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
}

function parseSkillPolicy(item: unknown, index: number): SkillPolicy | null {
  if (typeof item === 'string') {
    const name = item.trim()
    return name
      ? {
          id: createStableId('skill', name, index),
          slug: normalizeSkillSlug(name) ?? undefined,
          name,
          enabled: true,
          scope: 'agent',
          approvalMode: 'auto',
          tags: [],
        }
      : null
  }

  if (!isRecord(item)) {
    return null
  }

  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (!name) {
    return null
  }

  const scope = normalizeSkillScope(item.scope)
  const approvalMode = normalizeSkillApprovalMode(item.approvalMode)
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : createStableId('skill', name, index)
  const skillId = typeof item.skillId === 'string' && item.skillId.trim() ? item.skillId.trim() : undefined
  const slug = normalizeSkillSlug(typeof item.slug === 'string' ? item.slug : name) ?? undefined
  const description = typeof item.description === 'string' && item.description.trim() ? item.description.trim() : undefined

  return {
    id,
    skillId,
    slug,
    name,
    description,
    enabled: item.enabled !== false,
    scope,
    approvalMode,
    tags: normalizeTags(item.tags),
  }
}

function parseMcpServerPolicy(item: unknown, index: number): McpServerPolicy | null {
  if (!isRecord(item)) {
    return null
  }

  const name = typeof item.name === 'string' ? item.name.trim() : ''
  const target = typeof item.target === 'string' ? item.target.trim() : ''
  if (!name || !target) {
    return null
  }

  const transport = item.transport === 'http' || item.transport === 'sse' || item.transport === 'stdio' ? item.transport : inferTransport(target)
  const capabilityMode = item.capabilityMode === 'resources+tools' ? 'resources+tools' : 'resources'
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : createStableId('mcp', name, index)
  const visibility = item.visibility === 'workspace' || item.visibility === 'team' ? item.visibility : 'private'
  const workspaceId = typeof item.workspaceId === 'string' && item.workspaceId.trim() ? item.workspaceId.trim() : undefined
  const ownerUserId = typeof item.ownerUserId === 'string' && item.ownerUserId.trim() ? item.ownerUserId.trim() : undefined

  return {
    id,
    name,
    target,
    transport,
    enabled: item.enabled !== false,
    capabilityMode,
    visibility,
    workspaceId,
    ownerUserId,
    managedBySystem: item.managedBySystem === true || name === VIBEMUX_MCP_SERVER_NAME,
  }
}

export function ensureVibemuxMcpServer(servers: McpServerPolicy[]) {
  const existing = servers.find((item) => item.name === VIBEMUX_MCP_SERVER_NAME || item.id === VIBEMUX_MCP_SERVER_ID)
  if (!existing) {
    return [...servers, createVibemuxMcpServerPolicy(true)]
  }

  return servers.map((item) => {
    if (item.id !== existing.id) {
      return item
    }

    return {
      ...item,
      id: VIBEMUX_MCP_SERVER_ID,
      name: VIBEMUX_MCP_SERVER_NAME,
      target: item.target.trim() || VIBEMUX_MCP_TARGET,
      transport: 'http' as const,
      capabilityMode: 'resources+tools' as const,
      managedBySystem: true,
    }
  })
}

export function parseMcpServerPolicies(value: unknown): McpServerPolicy[] {
  const rawMcpServers = Array.isArray(value) ? value : []
  return ensureVibemuxMcpServer(
    rawMcpServers
      .map((item, index) => parseMcpServerPolicy(item, index))
      .filter((item): item is McpServerPolicy => item !== null),
  )
}

export function buildMcpServerPolicies(servers: McpServerPolicy[]): McpServerPolicy[] {
  return ensureVibemuxMcpServer(
    servers
      .map((item, index): McpServerPolicy => {
        const visibility: McpServerPolicy['visibility'] = item.managedBySystem
          ? undefined
          : (item.visibility === 'workspace' || item.visibility === 'team' ? item.visibility : undefined)

        return {
          ...item,
          id: item.managedBySystem ? VIBEMUX_MCP_SERVER_ID : item.id || createStableId('mcp', item.name, index),
          name: item.managedBySystem ? VIBEMUX_MCP_SERVER_NAME : item.name.trim(),
          target: item.managedBySystem ? VIBEMUX_MCP_TARGET : item.target.trim(),
          transport: item.managedBySystem ? 'http' : item.transport,
          capabilityMode: item.managedBySystem ? 'resources+tools' : item.capabilityMode,
          visibility,
          workspaceId: item.managedBySystem ? undefined : item.workspaceId?.trim() || undefined,
          ownerUserId: item.managedBySystem ? undefined : item.ownerUserId?.trim() || undefined,
          managedBySystem: item.managedBySystem === true,
        }
      })
      .filter((item) => item.name && item.target),
  )
}

export function createPrimaryAgentDraft(defaultName = 'Agent'): PrimaryAgentDraft {
  return {
    name: defaultName,
    endpoint: '',
    skills: [],
    mcpServers: [],
    telegramEnabled: false,
    telegramBotToken: '',
    telegramMainChatId: '',
    telegramWebhookUrl: '',
    feishuEnabled: false,
    feishuWebhookUrl: '',
  }
}

export function parsePrimaryAgentConfig(config: Record<string, unknown>): PrimaryAgentConfig {
  const rawSkills = Array.isArray(config.skills) ? config.skills : []
  const rawChannels = isRecord(config.channels) ? config.channels : {}
  const rawTelegram = isRecord(rawChannels.telegram) ? rawChannels.telegram : {}
  const rawFeishu = isRecord(rawChannels.feishu) ? rawChannels.feishu : {}

  return {
    skills: rawSkills.map((item, index) => parseSkillPolicy(item, index)).filter((item): item is SkillPolicy => item !== null),
    mcpServers: parseMcpServerPolicies(config.mcpServers),
    channels: {
      telegram: {
        enabled: Boolean(rawTelegram.enabled),
        botToken: typeof rawTelegram.botToken === 'string' ? rawTelegram.botToken : '',
        mainChatId: typeof rawTelegram.mainChatId === 'string' ? rawTelegram.mainChatId : '',
        webhookUrl: typeof rawTelegram.webhookUrl === 'string' ? rawTelegram.webhookUrl : '',
      },
      feishu: {
        enabled: Boolean(rawFeishu.enabled),
        webhookUrl: typeof rawFeishu.webhookUrl === 'string' ? rawFeishu.webhookUrl : '',
      },
    },
  }
}

export function toPrimaryAgentDraft(agent: { name: string; endpoint: string | null; config: Record<string, unknown> } | null, defaultName = 'Agent'): PrimaryAgentDraft {
  if (!agent) {
    return createPrimaryAgentDraft(defaultName)
  }

  const config = parsePrimaryAgentConfig(agent.config)

  return {
    name: agent.name || defaultName,
    endpoint: agent.endpoint || '',
    skills: config.skills,
    mcpServers: config.mcpServers,
    telegramEnabled: config.channels.telegram.enabled,
    telegramBotToken: config.channels.telegram.botToken,
    telegramMainChatId: config.channels.telegram.mainChatId,
    telegramWebhookUrl: config.channels.telegram.webhookUrl,
    feishuEnabled: config.channels.feishu.enabled,
    feishuWebhookUrl: config.channels.feishu.webhookUrl,
  }
}

export function buildPrimaryAgentConfig(draft: PrimaryAgentDraft): PrimaryAgentConfig {
  return {
    skills: draft.skills
      .map((item, index) => ({
        ...item,
        id: item.id || createStableId('skill', item.name, index),
        skillId: item.skillId?.trim() || undefined,
        slug: normalizeSkillSlug(item.slug || item.name) ?? undefined,
        name: item.name.trim(),
        description: item.description?.trim() || undefined,
        tags: item.tags.map((tag) => tag.trim()).filter(Boolean),
      }))
      .filter((item) => item.name),
    mcpServers: buildMcpServerPolicies(draft.mcpServers),
    channels: {
      telegram: {
        enabled: draft.telegramEnabled,
        botToken: draft.telegramBotToken.trim(),
        mainChatId: draft.telegramMainChatId.trim(),
        webhookUrl: draft.telegramWebhookUrl.trim(),
      },
      feishu: {
        enabled: draft.feishuEnabled,
        webhookUrl: draft.feishuWebhookUrl.trim(),
      },
    },
  }
}

export function countConfiguredChannels(config: PrimaryAgentConfig) {
  return [config.channels.telegram.enabled, config.channels.feishu.enabled].filter(Boolean).length
}

export function hasEnabledVibemuxMcp(config: PrimaryAgentConfig) {
  return config.mcpServers.some((item) => item.name === VIBEMUX_MCP_SERVER_NAME && item.enabled)
}
