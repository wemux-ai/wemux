// [INPUT]: Agent-owned outbound channel settings and a requested delivery target.
import { getEnv } from '@shared/env'
// [OUTPUT]: Available outbound channels and delivery results for channel.list/channel.send.
// [POS]: Server-side outbound channel service; inbound Feishu replies are handled by channel-routes.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md.
import { readCustomAgentConfig } from '@shared/custom-agent'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import { sendFeishuMessageToWebhook } from '../integrations/feishu'
import { sendTelegramMessageWithConfig } from '../integrations/telegram'
import { sendWeixinMessage, sendWeixinImageMessage, sendWeixinFileMessage, ILINK_DEFAULT_BASE_URL } from '../integrations/wechat-ilink/ilink-api'
import { getWechatLastPeer } from '../integrations/wechat-ilink/long-polling-service'
import { sendDiscordMessage } from '../integrations/discord/discord-api'
import { getDiscordLastChannel } from '../integrations/discord/gateway'
import { sendSlackMessage } from '../integrations/slack/slack-api'
import { getSlackLastChannel } from '../integrations/slack/socket-mode'
import { sendWecomAppMessage } from '../integrations/wecom/wecom-api'
import { getWecomLastPeer } from './wecom-inbound-service'
import { sendWhatsappTextMessage } from '../integrations/whatsapp/whatsapp-api'
import { getWhatsappLastPeer } from './whatsapp-inbound-service'
import { sendDingtalkOtMessage } from '../integrations/dingtalk/dingtalk-api'
import { getDingtalkLastPeer } from '../integrations/dingtalk/stream'
import { getDefaultUserAgent, getUserAgents, type AgentRecord } from '../repositories/agent'

export type AgentChannelKind = 'telegram' | 'feishu' | 'wechat' | 'discord' | 'slack' | 'wecom' | 'whatsapp' | 'dingtalk' | 'dingtalk' | 'whatsapp' | 'wecom'

type PrimaryAgentChannels = {
  telegram: {
    enabled: boolean
    botToken: string
    chatId: string
    threadId: string
    webhookSecret: string
  }
  feishu: {
    enabled: boolean
    appId: string
    appSecret: string
    webhookUrl?: string
  }
  wechat: {
    enabled: boolean
    botToken: string
    baseUrl: string
    wechatUserId: string
  }
  discord: {
    enabled: boolean
    botToken: string
    guildId: string
  }
  slack: {
    enabled: boolean
    botToken: string
    appToken: string
  }
  wecom: {
    enabled: boolean
    corpId: string
    agentId: string
    secret: string
    defaultTouser: string
  }
  whatsapp: {
    enabled: boolean
    phoneNumberId: string
    accessToken: string
  }
  dingtalk: {
    enabled: boolean
    appKey: string
    appSecret: string
  }
}

type AgentChannelBinding = {
  agent: Pick<AgentRecord, 'id' | 'name' | 'type'>
  channels: PrimaryAgentChannels
}

export type AgentChannelSummary = {
  channel: AgentChannelKind
  enabled: boolean
  ready: boolean
  details: Record<string, unknown>
}

const asRecord = (value: unknown): Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

const toTrimmedString = (value: unknown) => {
  return typeof value === 'string' ? value.trim() : ''
}

const readPrimaryAgentChannels = (config: Record<string, unknown>): PrimaryAgentChannels => {
  const channels = asRecord(config.channels)
  const telegram = asRecord(channels.telegram)
  const feishu = asRecord(channels.feishu)

  return {
    telegram: {
      enabled: telegram.enabled === true,
      botToken: toTrimmedString(telegram.botToken),
      chatId: toTrimmedString(telegram.mainChatId || telegram.chatId),
      threadId: toTrimmedString(telegram.threadId),
      webhookSecret: toTrimmedString(telegram.webhookSecret),
    },
    feishu: {
      enabled: feishu.enabled === true,
      appId: toTrimmedString(feishu.appId),
      appSecret: toTrimmedString(feishu.appSecret),
      webhookUrl: toTrimmedString(feishu.webhookUrl),
    },
    wechat: {
      enabled: false,
      botToken: '',
      baseUrl: '',
      wechatUserId: '',
    },
    discord: {
      enabled: false,
      botToken: '',
      guildId: '',
    },
    slack: {
      enabled: false,
      botToken: '',
      appToken: '',
    },
    wecom: {
      enabled: false,
      corpId: '',
      agentId: '',
      secret: '',
      defaultTouser: '',
    },
    whatsapp: {
      enabled: false,
      phoneNumberId: '',
      accessToken: '',
    },
    dingtalk: {
      enabled: false,
      appKey: '',
      appSecret: '',
    },
  }
}

const toBinding = (agent: AgentRecord): AgentChannelBinding => {
  if (agent.type.trim().toLowerCase() === 'main') {
    return {
      agent,
      channels: readPrimaryAgentChannels(agent.config),
    }
  }

  const profile = readCustomAgentConfig(agent.config)
  return {
    agent,
    channels: {
      telegram: {
        enabled: profile.channels.telegram.enabled,
        botToken: profile.channels.telegram.botToken,
        chatId: profile.channels.telegram.chatId,
        threadId: profile.channels.telegram.threadId,
        webhookSecret: profile.channels.telegram.webhookSecret,
      },
      feishu: {
        enabled: profile.channels.feishu.enabled,
        appId: profile.channels.feishu.appId,
        appSecret: profile.channels.feishu.appSecret,
      },
      wechat: {
        enabled: profile.channels.wechat.enabled,
        botToken: profile.channels.wechat.botToken,
        baseUrl: profile.channels.wechat.baseUrl,
        wechatUserId: profile.channels.wechat.wechatUserId,
      },
      discord: {
        enabled: profile.channels.discord.enabled,
        botToken: profile.channels.discord.botToken,
        guildId: profile.channels.discord.guildId,
      },
      slack: {
        enabled: profile.channels.slack.enabled,
        botToken: profile.channels.slack.botToken,
        appToken: profile.channels.slack.appToken,
      },
      wecom: {
        enabled: profile.channels.wecom.enabled,
        corpId: profile.channels.wecom.corpId,
        agentId: profile.channels.wecom.agentId,
        secret: profile.channels.wecom.secret,
        defaultTouser: profile.channels.wecom.defaultTouser,
      },
      whatsapp: {
        enabled: profile.channels.whatsapp.enabled,
        phoneNumberId: profile.channels.whatsapp.phoneNumberId,
        accessToken: profile.channels.whatsapp.accessToken,
      },
      dingtalk: {
        enabled: profile.channels.dingtalk.enabled,
        appKey: profile.channels.dingtalk.appKey,
        appSecret: profile.channels.dingtalk.appSecret,
      },
    },
  }
}

const resolveAgentRecord = (params: { userId: string; agentId?: string; agentName?: string }) => {
  const agentId = params.agentId?.trim()
  const agentName = params.agentName?.trim().toLowerCase()
  const userId = params.userId.trim()
  const agents = getUserAgents(userId)

  if (agentId) {
    return agents.find((agent) => agent.id === agentId) ?? null
  }

  if (agentName) {
    return agents.find((agent) => agent.name.trim().toLowerCase() === agentName) ?? null
  }

  return getDefaultUserAgent(userId)
}

const isTelegramReady = (binding: AgentChannelBinding) => {
  return binding.channels.telegram.enabled
    && Boolean(binding.channels.telegram.botToken)
    && Boolean(binding.channels.telegram.chatId)
}

const isFeishuReady = (binding: AgentChannelBinding) => {
  return binding.channels.feishu.enabled && Boolean(binding.channels.feishu.webhookUrl)
}

const isWechatReady = (binding: AgentChannelBinding) => {
  return binding.channels.wechat.enabled && Boolean(binding.channels.wechat.botToken)
}

const isDiscordReady = (binding: AgentChannelBinding) => {
  return binding.channels.discord.enabled && Boolean(binding.channels.discord.botToken)
}

const isSlackReady = (binding: AgentChannelBinding) => {
  return binding.channels.slack.enabled && Boolean(binding.channels.slack.botToken) && Boolean(binding.channels.slack.appToken)
}

const isWecomReady = (binding: AgentChannelBinding) => {
  return binding.channels.wecom.enabled
    && Boolean(binding.channels.wecom.corpId)
    && Boolean(binding.channels.wecom.agentId)
    && Boolean(binding.channels.wecom.secret)
}

const isWhatsappReady = (binding: AgentChannelBinding) => {
  return binding.channels.whatsapp.enabled
    && Boolean(binding.channels.whatsapp.phoneNumberId)
    && Boolean(binding.channels.whatsapp.accessToken)
}

const isDingtalkReady = (binding: AgentChannelBinding) => {
  return binding.channels.dingtalk.enabled
    && Boolean(binding.channels.dingtalk.appKey)
    && Boolean(binding.channels.dingtalk.appSecret)
}

const summarizeBinding = (binding: AgentChannelBinding): AgentChannelSummary[] => {
  const channels: AgentChannelSummary[] = [
    {
      channel: 'telegram',
      enabled: binding.channels.telegram.enabled,
      ready: isTelegramReady(binding),
      details: {
        botTokenConfigured: Boolean(binding.channels.telegram.botToken),
        chatIdConfigured: Boolean(binding.channels.telegram.chatId),
        threadIdConfigured: Boolean(binding.channels.telegram.threadId),
        webhookSecretConfigured: Boolean(binding.channels.telegram.webhookSecret),
        webhookReady: Boolean(binding.channels.telegram.botToken),
      },
    },
  ]

  if (binding.agent.type.trim().toLowerCase() === 'main') {
    channels.push({
      channel: 'feishu',
      enabled: binding.channels.feishu.enabled,
      ready: isFeishuReady(binding),
      details: {
        appIdConfigured: Boolean(binding.channels.feishu.appId),
        appSecretConfigured: Boolean(binding.channels.feishu.appSecret),
        webhookConfigured: Boolean(binding.channels.feishu.webhookUrl),
        webhookReady: Boolean(binding.channels.feishu.webhookUrl),
      },
    })
  } else {
    channels.push({
      channel: 'wechat',
      enabled: binding.channels.wechat.enabled,
      ready: isWechatReady(binding),
      details: {
        botTokenConfigured: Boolean(binding.channels.wechat.botToken),
        boundWechatUserId: binding.channels.wechat.wechatUserId,
      },
    })
    channels.push({
      channel: 'discord',
      enabled: binding.channels.discord.enabled,
      ready: isDiscordReady(binding),
      details: {
        botTokenConfigured: Boolean(binding.channels.discord.botToken),
        guildIdConfigured: Boolean(binding.channels.discord.guildId),
      },
    })
    channels.push({
      channel: 'slack',
      enabled: binding.channels.slack.enabled,
      ready: isSlackReady(binding),
      details: {
        botTokenConfigured: Boolean(binding.channels.slack.botToken),
        appTokenConfigured: Boolean(binding.channels.slack.appToken),
      },
    })
    channels.push({
      channel: 'wecom',
      enabled: binding.channels.wecom.enabled,
      ready: isWecomReady(binding),
      details: {
        corpIdConfigured: Boolean(binding.channels.wecom.corpId),
        agentIdConfigured: Boolean(binding.channels.wecom.agentId),
      },
    })
    channels.push({
      channel: 'whatsapp',
      enabled: binding.channels.whatsapp.enabled,
      ready: isWhatsappReady(binding),
      details: {
        phoneNumberIdConfigured: Boolean(binding.channels.whatsapp.phoneNumberId),
        accessTokenConfigured: Boolean(binding.channels.whatsapp.accessToken),
      },
    })
    channels.push({
      channel: 'dingtalk',
      enabled: binding.channels.dingtalk.enabled,
      ready: isDingtalkReady(binding),
      details: {
        appKeyConfigured: Boolean(binding.channels.dingtalk.appKey),
      },
    })
  }

  return channels
}

const pickChannel = (binding: AgentChannelBinding, requested: AgentChannelKind | 'auto') => {
  if (requested === 'telegram') {
    return isTelegramReady(binding) ? 'telegram' : null
  }

  if (requested === 'feishu') {
    return isFeishuReady(binding) ? 'feishu' : null
  }

  if (requested === 'wechat') {
    return isWechatReady(binding) ? 'wechat' : null
  }

  if (requested === 'discord') {
    return isDiscordReady(binding) ? 'discord' : null
  }

  if (requested === 'slack') {
    return isSlackReady(binding) ? 'slack' : null
  }

  if (requested === 'wecom') {
    return isWecomReady(binding) ? 'wecom' : null
  }

  if (requested === 'whatsapp') {
    return isWhatsappReady(binding) ? 'whatsapp' : null
  }

  if (requested === 'dingtalk') {
    return isDingtalkReady(binding) ? 'dingtalk' : null
  }

  if (isTelegramReady(binding)) {
    return 'telegram'
  }

  if (isWechatReady(binding)) {
    return 'wechat'
  }

  if (isFeishuReady(binding)) {
    return 'feishu'
  }

  if (isDiscordReady(binding)) {
    return 'discord'
  }

  if (isSlackReady(binding)) {
    return 'slack'
  }

  if (isWecomReady(binding)) {
    return 'wecom'
  }

  if (isWhatsappReady(binding)) {
    return 'whatsapp'
  }

  if (isDingtalkReady(binding)) {
    return 'dingtalk'
  }

  return null
}

export const resolveAgentChannelBinding = (params: { userId: string; agentId?: string; agentName?: string }) => {
  const agent = resolveAgentRecord(params)
  return agent ? toBinding(agent) : null
}

export const listAgentChannelSummaries = (params: { userId: string; agentId?: string; agentName?: string }) => {
  const binding = resolveAgentChannelBinding(params)
  if (!binding) {
    return null
  }

  return {
    agent: {
      id: binding.agent.id,
      name: binding.agent.name,
      type: binding.agent.type,
    },
    channels: summarizeBinding(binding),
  }
}

export const renderAgentChannelInstructions = (params: {
  userId: string
  agentId?: string
  agentName?: string
  includeUsage?: boolean
}) => {
  const summary = listAgentChannelSummaries(params)
  if (!summary) {
    return null
  }

  const configured = summary.channels
    .filter((item) => item.ready)
    .map((item) => item.channel === 'telegram' ? 'Telegram' : item.channel === 'wechat' ? 'WeChat' : item.channel === 'feishu' ? 'Feishu' : item.channel === 'discord' ? 'Discord' : item.channel === 'slack' ? 'Slack' : item.channel === 'wecom' ? 'WeCom' : item.channel === 'whatsapp' ? 'WhatsApp' : 'DingTalk')

  const lines = [
    `外部渠道: ${configured.length > 0 ? configured.join('、') : '未配置可用渠道'}`,
  ]

  if (params.includeUsage) {
    lines.push('如需主动发到外部 IM，可先调用 channel.list 查看可用渠道，再用 channel.send 发送。')
    if (summary.agent.type.trim().toLowerCase() !== 'main') {
      lines.push(`调用 channel.send 时请传 agentId="${summary.agent.id}"。`)
    }
  }

  return lines.join('\n')
}

/** 下载附件字节（相对 URL 按 WEMUX_PUBLIC_BASE_URL 解析；失败返回 null）。 */
const resolveAttachmentBuffer = async (attachment: TaskChatAttachment): Promise<Buffer | null> => {
  try {
    const raw = attachment.url.trim()
    if (!raw) return null
    const url = /^https?:\/\//i.test(raw)
      ? raw
      : `${(getEnv('WEMUX_PUBLIC_BASE_URL')?.trim() || '').replace(/\/+$/, '')}${raw}`
    const response = await fetch(url)
    if (!response.ok) return null
    return Buffer.from(await response.arrayBuffer())
  } catch {
    return null
  }
}

const isImageAttachment = (attachment: TaskChatAttachment) => {
  const contentType = attachment.contentType?.toLowerCase() || ''
  return contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(attachment.filename)
}

/** 微信出站：附件优先发送（图片/文件），文本兜底。 */
export const sendWechatWithAttachments = async (params: {
  baseUrl: string
  token: string
  toUserId: string
  message: string
  attachments: TaskChatAttachment[]
}): Promise<{ ok: boolean; message?: string }> => {
  for (const attachment of params.attachments) {
    const buf = await resolveAttachmentBuffer(attachment)
    if (!buf) {
      return { ok: false, message: '附件下载失败，无法发送。' }
    }
    const result = isImageAttachment(attachment)
      ? await sendWeixinImageMessage({
          baseUrl: params.baseUrl,
          token: params.token,
          toUserId: params.toUserId,
          buf,
        })
      : await sendWeixinFileMessage({
          baseUrl: params.baseUrl,
          token: params.token,
          toUserId: params.toUserId,
          buf,
          fileName: attachment.filename || 'attachment.bin',
        })
    if (result.ret !== 0) {
      return { ok: false, message: result.errmsg || `微信附件发送失败（errcode=${result.errcode ?? result.ret}）` }
    }
  }
  if (params.message.trim()) {
    const textResult = await sendWeixinMessage({
      baseUrl: params.baseUrl,
      token: params.token,
      toUserId: params.toUserId,
      itemList: [{ type: 1, text_item: { text: params.message.trim() } }],
    })
    if (textResult.ret !== 0) {
      return { ok: false, message: textResult.errmsg || `微信文本发送失败（errcode=${textResult.errcode ?? textResult.ret}）` }
    }
  }
  return { ok: true }
}

export const sendAgentChannelMessage = async (params: {
  userId: string
  agentId?: string
  agentName?: string
  channel: AgentChannelKind | 'auto'
  message: string
  attachments?: TaskChatAttachment[]
}) => {
  const binding = resolveAgentChannelBinding(params)
  if (!binding) {
    return { ok: false as const, message: 'Agent 不存在。' }
  }

  const channel = pickChannel(binding, params.channel)
  if (!channel) {
    return { ok: false as const, message: '当前 Agent 没有可用的渠道配置。' }
  }

  if (channel === 'telegram') {
    const result = await sendTelegramMessageWithConfig({
      botToken: binding.channels.telegram.botToken,
      chatId: binding.channels.telegram.chatId,
      threadId: binding.channels.telegram.threadId || undefined,
    }, params.message)

    if (!result.ok) {
      return {
        ok: false as const,
        message: result.message || 'Telegram 消息发送失败',
      }
    }
  } else if (channel === 'wechat') {
    const target = getWechatLastPeer(binding.agent.id) || binding.channels.wechat.wechatUserId
    if (!target) {
      return {
        ok: false as const,
        message: '当前还没有微信会话，无法主动发送（请先让用户在微信中与 Agent 对话）。',
      }
    }
    const wechatConfig = {
      baseUrl: binding.channels.wechat.baseUrl.trim() || ILINK_DEFAULT_BASE_URL,
      token: binding.channels.wechat.botToken,
    }
    if (params.attachments && params.attachments.length > 0) {
      const mediaResult = await sendWechatWithAttachments({
        ...wechatConfig,
        toUserId: target,
        message: params.message,
        attachments: params.attachments,
      })
      if (!mediaResult.ok) {
        return { ok: false as const, message: mediaResult.message || '微信附件消息发送失败' }
      }
    } else {
      const result = await sendWeixinMessage({
        ...wechatConfig,
        toUserId: target,
        itemList: [{ type: 1, text_item: { text: params.message } }],
      })
      if (result.ret !== 0) {
        return {
          ok: false as const,
          message: result.errmsg || `微信消息发送失败（errcode=${result.errcode ?? result.ret}）`,
        }
      }
    }
  } else if (channel === 'discord') {
    const channelId = getDiscordLastChannel(binding.agent.id)
    if (!channelId) {
      return {
        ok: false as const,
        message: '当前还没有 Discord 会话，无法主动发送（请先在 Discord 中与 Agent 对话）。',
      }
    }
    const result = await sendDiscordMessage({
      botToken: binding.channels.discord.botToken,
      channelId,
      content: params.message,
    })
    if (!result.ok) {
      return { ok: false as const, message: result.message || 'Discord 消息发送失败' }
    }
  } else if (channel === 'slack') {
    const channelId = getSlackLastChannel(binding.agent.id)
    if (!channelId) {
      return {
        ok: false as const,
        message: '当前还没有 Slack 会话，无法主动发送（请先在 Slack 中与 Agent 对话）。',
      }
    }
    const result = await sendSlackMessage({
      botToken: binding.channels.slack.botToken,
      channelId,
      text: params.message,
    })
    if (!result.ok) {
      return { ok: false as const, message: result.message || 'Slack 消息发送失败' }
    }
  } else if (channel === 'wecom') {
    const touser = getWecomLastPeer(binding.agent.id) || binding.channels.wecom.defaultTouser
    if (!touser) {
      return {
        ok: false as const,
        message: '当前还没有企业微信会话，无法主动发送（请先在企业微信中与 Agent 对话，或配置默认接收人）。',
      }
    }
    const result = await sendWecomAppMessage({
      corpId: binding.channels.wecom.corpId,
      agentId: binding.channels.wecom.agentId,
      secret: binding.channels.wecom.secret,
      touser,
      content: params.message,
    })
    if (!result.ok) {
      return { ok: false as const, message: result.message || '企业微信消息发送失败' }
    }
  } else if (channel === 'whatsapp') {
    const to = getWhatsappLastPeer(binding.agent.id)
    if (!to) {
      return {
        ok: false as const,
        message: '当前还没有 WhatsApp 会话，无法主动发送（请先在 WhatsApp 中与 Agent 对话）。',
      }
    }
    const result = await sendWhatsappTextMessage({
      phoneNumberId: binding.channels.whatsapp.phoneNumberId,
      accessToken: binding.channels.whatsapp.accessToken,
      to,
      text: params.message,
    })
    if (!result.ok) {
      return { ok: false as const, message: result.message || 'WhatsApp 消息发送失败' }
    }
  } else if (channel === 'dingtalk') {
    const to = getDingtalkLastPeer(binding.agent.id)
    if (!to) {
      return {
        ok: false as const,
        message: '当前还没有钉钉会话，无法主动发送（请先在钉钉中与 Agent 对话）。',
      }
    }
    const result = await sendDingtalkOtMessage({
      appKey: binding.channels.dingtalk.appKey,
      appSecret: binding.channels.dingtalk.appSecret,
      robotCode: binding.channels.dingtalk.appKey,
      userIds: [to],
      content: params.message,
    })
    if (!result.ok) {
      return { ok: false as const, message: result.message || '钉钉消息发送失败' }
    }
  } else {
    const result = await sendFeishuMessageToWebhook(binding.channels.feishu.webhookUrl ?? '', params.message)
    if (!result.ok) {
      return {
        ok: false as const,
        message: result.message || '飞书消息发送失败',
      }
    }
  }

  return {
    ok: true as const,
    agent: {
      id: binding.agent.id,
      name: binding.agent.name,
      type: binding.agent.type,
    },
    channel,
  }
}
