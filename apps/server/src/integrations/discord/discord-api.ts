// [INPUT]: Discord Bot token、REST 请求与入站事件 payload。
// [OUTPUT]: REST 出站（sendMessage/getMe）+ 邀请链接生成 + 入站消息解析。
// [POS]: Discord 渠道的 REST/协议层；WebSocket gateway 长连接在 gateway.ts。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export const DISCORD_API_BASE = 'https://discord.com/api/v10'
export const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json'

/** Discord gateway intents：DIRECT_MESSAGES(1<<12) + GUILD_MESSAGES(1<<9)。 */
export const DISCORD_GATEWAY_INTENTS = (1 << 12) | (1 << 9)

/**
 * 从 bot token 解出 client_id（token = base64(clientId).timestamp.crypto）。
 * 用于生成 OAuth 邀请链接：https://discord.com/oauth2/authorize?client_id=...&scope=bot&permissions=...
 */
export const extractDiscordClientId = (botToken: string): string => {
  const first = botToken.split('.')[0] || ''
  try {
    return Buffer.from(first, 'base64url').toString('utf8').replace(/[^\d]/g, '')
  } catch {
    return ''
  }
}

/** 生成一键邀请链接（用户点链接选择服务器即完成安装）。 */
export const buildDiscordInviteUrl = (botToken: string, guildId?: string) => {
  const clientId = extractDiscordClientId(botToken)
  if (!clientId) return ''
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'bot applications.commands',
    permissions: '274877974592',
  })
  if (guildId?.trim()) params.set('guild_id', guildId.trim())
  return `https://discord.com/oauth2/authorize?${params.toString()}`
}

export type DiscordMessageEvent = {
  channelId: string
  guildId?: string
  authorId: string
  authorName: string
  text: string
  isBot: boolean
  isDm: boolean
  messageId: string
}

/** 解析 MESSAGE_CREATE dispatch payload 为统一入站消息。 */
export const parseDiscordMessageCreate = (payload: unknown): DiscordMessageEvent | null => {
  const data = payload as {
    id?: string
    type?: number
    content?: string
    channel_id?: string
    guild_id?: string
    author?: { id?: string; username?: string; bot?: boolean }
  }
  if (!data?.id || !data.channel_id || !data.author?.id) return null
  const text = data.content?.trim() || ''
  if (!text) return null
  const isBot = data.author.bot === true
  if (isBot) return null
  return {
    channelId: data.channel_id,
    guildId: data.guild_id?.trim() || undefined,
    authorId: data.author.id,
    authorName: data.author.username?.trim() || 'discord-user',
    text,
    isBot: false,
    isDm: !data.guild_id,
    messageId: data.id,
  }
}

/** REST 发送消息（文本）。 */
export const sendDiscordMessage = async (params: {
  botToken: string
  channelId: string
  content: string
}): Promise<{ ok: boolean; message?: string }> => {
  try {
    const response = await fetch(`${DISCORD_API_BASE}/channels/${encodeURIComponent(params.channelId)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${params.botToken.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: params.content }),
    })
    if (!response.ok) {
      const raw = (await response.text()).slice(0, 200)
      return { ok: false, message: `Discord HTTP ${response.status}: ${raw}` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Discord 消息发送失败。' }
  }
}

/** 查询 bot 自身信息（验证 token + 拿用户名）。 */
export const getDiscordMe = async (botToken: string): Promise<{ ok: boolean; username?: string; message?: string }> => {
  try {
    const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
      headers: { Authorization: `Bot ${botToken.trim()}` },
    })
    if (!response.ok) {
      return { ok: false, message: `Discord getMe HTTP ${response.status}` }
    }
    const payload = await response.json() as { username?: string }
    return { ok: true, username: payload.username }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Discord getMe 失败。' }
  }
}
