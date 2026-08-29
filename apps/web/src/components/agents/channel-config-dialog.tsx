// [INPUT]: 渠道元数据、Agent draft、各渠道字段与特殊操作回调。
// [OUTPUT]: 按渠道渲染的配置浮窗（启用开关 + 字段 + 扫码/深链/邀请等一键操作）。
// [POS]: Agent 渠道卡片列表的配置浮窗；QR 绑定弹窗复用 feishu/wechat 现有组件。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { useState } from 'react'
import { ExternalLink, Link2, Loader2, QrCode, Radio } from 'lucide-react'
import { api } from '../../lib/api'
import type { CustomAgentDraft } from '../../lib/custom-agent/types'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Field } from './custom-agent-detail-panel-shared'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'
import { CHANNEL_METAS, type AgentChannelKey } from './channel-metadata'

const PASSWORD_FIELDS = new Set(['telegramBotToken', 'feishuAppSecret', 'wechatBotToken', 'discordBotToken', 'slackBotToken', 'slackAppToken', 'wecomSecret', 'wecomEncodingAesKey', 'whatsappAccessToken', 'dingtalkAppSecret'])

type ChannelField = {
  key: keyof CustomAgentDraft
  label: string
  placeholder?: string
  password?: boolean
  span?: boolean
}

const CHANNEL_FIELDS: Record<AgentChannelKey, ChannelField[]> = {
  telegram: [
    { key: 'telegramBotToken', label: 'Bot Token', placeholder: '123456:ABC...', password: true },
    { key: 'telegramChatId', label: 'Chat ID（可选，深链绑定后自动填入）', placeholder: '自动绑定后无需填写' },
    { key: 'telegramThreadId', label: 'Thread ID（可选）', placeholder: '群话题 ID' },
    { key: 'telegramWebhookSecret', label: 'Webhook Secret（可选）', placeholder: '防伪造回调' },
  ],
  feishu: [
    { key: 'feishuAppId', label: 'App ID', placeholder: 'cli_xxx / a-xxx' },
    { key: 'feishuAppSecret', label: 'App Secret', placeholder: '应用密钥', password: true },
    { key: 'feishuVerificationToken', label: 'Verification Token', placeholder: '回调校验' },
    { key: 'feishuEncryptKey', label: 'Encrypt Key', placeholder: '回调加密' },
  ],
  wechat: [],
  discord: [
    { key: 'discordBotToken', label: 'Bot Token', placeholder: 'MTA...', password: true },
    { key: 'discordGuildId', label: 'Guild ID（可选）', placeholder: '限定单个服务器' },
  ],
  slack: [
    { key: 'slackBotToken', label: 'Bot Token', placeholder: 'xoxb-...', password: true },
    { key: 'slackAppToken', label: 'App Token（Socket Mode）', placeholder: 'xapp-...', password: true },
  ],
  wecom: [
    { key: 'wecomCorpId', label: 'Corp ID', placeholder: 'ww...' },
    { key: 'wecomAgentId', label: 'Agent ID', placeholder: '1000002' },
    { key: 'wecomSecret', label: 'Secret', placeholder: '自建应用密钥', password: true },
    { key: 'wecomCallbackToken', label: '回调 Token', placeholder: '回调 URL 校验' },
    { key: 'wecomEncodingAesKey', label: 'EncodingAESKey', placeholder: '43 位密钥', password: true },
    { key: 'wecomDefaultTouser', label: '默认接收人（可选）', placeholder: 'channel.send 主动推送目标' },
  ],
  whatsapp: [
    { key: 'whatsappPhoneNumberId', label: 'Phone Number ID', placeholder: 'Meta 后台获取' },
    { key: 'whatsappAccessToken', label: 'Access Token', placeholder: '系统用户令牌', password: true },
    { key: 'whatsappVerifyToken', label: 'Webhook 验证令牌', placeholder: '与 Meta 后台一致' },
  ],
  dingtalk: [
    { key: 'dingtalkAppKey', label: 'AppKey', placeholder: 'ding...' },
    { key: 'dingtalkAppSecret', label: 'AppSecret', placeholder: '企业内部应用密钥', password: true },
  ],
}

export function ChannelConfigDialog({ channel, open, onOpenChange, draft, onDraftChange, selectedAgentId, wecomCallbackUrl, whatsappCallbackUrl, onOpenWechatQr, onOpenFeishuQr, onDisconnectWechat, onDisconnectFeishu }: {
  channel: AgentChannelKey | null
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: CustomAgentDraft
  onDraftChange: (updater: (current: CustomAgentDraft) => CustomAgentDraft) => void
  selectedAgentId?: string
  wecomCallbackUrl?: string
  whatsappCallbackUrl?: string
  onOpenWechatQr?: () => void
  onOpenFeishuQr?: () => void
  onDisconnectWechat?: () => void
  onDisconnectFeishu?: () => void
}) {
  const meta = CHANNEL_METAS.find((item) => item.key === channel) ?? null
  const [telegramDeepLink, setTelegramDeepLink] = useState('')
  const [deepLinkBusy, setDeepLinkBusy] = useState(false)
  const [deepLinkError, setDeepLinkError] = useState('')
  const [discordInvite, setDiscordInvite] = useState('')
  const [inviteError, setInviteError] = useState('')

  if (!meta || !channel) {
    return null
  }

  const enabled = draft[`${channel}Enabled`] as boolean
  const setEnabled = (value: boolean) => onDraftChange((current) => ({ ...current, [`${channel}Enabled`]: value }))
  const setField = (key: keyof CustomAgentDraft, value: string) => onDraftChange((current) => ({ ...current, [key]: value }))

  const renderQuickActions = () => {
    if (channel === 'wechat') {
      return draft.wechatBotToken.trim()
        ? (
          <div className="space-y-2">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">已绑定微信号（扫码即用，无需手动配置）。</div>
            <Button type="button" size="sm" variant="outline" className="w-full border-rose-500/25 bg-zinc-950 text-rose-300 hover:bg-rose-500/10" onClick={onDisconnectWechat}>断开连接</Button>
          </div>
        )
        : (
          <Button type="button" size="sm" onClick={onOpenWechatQr} className="w-full">
            <QrCode className="size-4" /> 扫码绑定微信
          </Button>
        )
    }
    if (channel === 'feishu') {
      return draft.feishuAppId.trim() && draft.feishuAppSecret.trim()
        ? (
          <div className="space-y-2">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">飞书 Bot 已配置。</div>
            <Button type="button" size="sm" variant="outline" className="w-full border-rose-500/25 bg-zinc-950 text-rose-300 hover:bg-rose-500/10" onClick={onDisconnectFeishu}>断开连接</Button>
          </div>
        )
        : (
          <Button type="button" size="sm" onClick={onOpenFeishuQr} className="w-full">
            <QrCode className="size-4" /> 扫码一键创建飞书 Bot
          </Button>
        )
    }
    if (channel === 'telegram' && draft.telegramBotToken.trim()) {
      return (
        <div className="space-y-2">
          <Button type="button" size="sm" variant="outline" className="w-full border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800" disabled={deepLinkBusy} onClick={async () => {
            if (!selectedAgentId) return
            setDeepLinkBusy(true)
            try {
              const result = await api.generateAgentTelegramDeepLink(selectedAgentId)
              setTelegramDeepLink(result.deepLinkUrl)
              setDeepLinkError('')
            } catch (reason) {
              setDeepLinkError(reason instanceof Error ? reason.message : '深链生成失败。')
            } finally {
              setDeepLinkBusy(false)
            }
          }}>
            {deepLinkBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
            生成一键绑定链接
          </Button>
          {telegramDeepLink ? (
            <div className="flex items-center gap-2">
              <Input value={telegramDeepLink} readOnly className="flex-1 text-xs" />
              <Button type="button" size="sm" variant="outline" className="shrink-0 border-zinc-700 bg-zinc-900 text-zinc-200" onClick={() => { void navigator.clipboard?.writeText(telegramDeepLink) }}>复制</Button>
            </div>
          ) : null}
          {deepLinkError ? <p className="text-xs text-rose-300">{deepLinkError}</p> : null}
          <p className="text-xs text-zinc-600">打开链接并点 Start，聊天即绑定到该 Agent，无需手动查 Chat ID。</p>
        </div>
      )
    }
    if (channel === 'discord' && draft.discordBotToken.trim()) {
      const buildInvite = () => {
        try {
          const clientId = decodeURIComponent(atob(draft.discordBotToken.split('.')[0] || '')) || ''
          if (!/^\d+$/.test(clientId)) {
            setInviteError('无法从 Bot Token 解析 Client ID，请确认 Token 格式。')
            return
          }
          setInviteError('')
          const params = new URLSearchParams({ client_id: clientId, scope: 'bot applications.commands', permissions: '274877974592' })
          if (draft.discordGuildId.trim()) params.set('guild_id', draft.discordGuildId.trim())
          setDiscordInvite(`https://discord.com/oauth2/authorize?${params.toString()}`)
        } catch {
          setInviteError('无法从 Bot Token 解析 Client ID。')
        }
      }
      return (
        <div className="space-y-2">
          <Button type="button" size="sm" variant="outline" className="w-full border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800" onClick={buildInvite}>
            <ExternalLink className="size-3.5" /> 生成一键邀请链接
          </Button>
          {discordInvite ? (
            <div className="flex items-center gap-2">
              <Input value={discordInvite} readOnly className="flex-1 text-xs" />
              <Button type="button" size="sm" variant="outline" className="shrink-0 border-zinc-700 bg-zinc-900 text-zinc-200" onClick={() => { void navigator.clipboard?.writeText(discordInvite) }}>复制</Button>
            </div>
          ) : null}
          {inviteError ? <p className="text-xs text-rose-300">{inviteError}</p> : null}
        </div>
      )
    }
    return null
  }

  const fields = CHANNEL_FIELDS[channel]
  const callbackUrl = channel === 'wecom' ? wecomCallbackUrl : channel === 'whatsapp' ? whatsappCallbackUrl : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md overflow-y-auto border-zinc-800 bg-[#0c0c0f] p-0 text-zinc-100 shadow-2xl shadow-black/60">
        <DialogHeader className="text-left">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900" style={{ color: meta.color }}>
              <meta.icon className="size-4.5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base">配置 {meta.name}</DialogTitle>
              <DialogDescription className="mt-1 text-xs leading-5 text-zinc-500">{meta.description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm text-zinc-200">
              <Radio className="size-3.5 text-zinc-500" />
              启用 {meta.name}
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {renderQuickActions()}

          {fields.length > 0 ? (
            <div className="grid gap-3">
              {fields.map((field) => (
                <Field key={field.key} label={field.label}>
                  <Input
                    value={String(draft[field.key] ?? '')}
                    onChange={(event) => setField(field.key, event.target.value)}
                    placeholder={field.placeholder}
                    type={field.password || PASSWORD_FIELDS.has(field.key) ? 'password' : 'text'}
                  />
                </Field>
              ))}
            </div>
          ) : null}

          {callbackUrl ? (
            <Field label={channel === 'wecom' ? '回调 URL（企业微信后台「接收消息」配置）' : 'Webhook 回调 URL（Meta 后台「Webhooks」配置）'}>
              <Input value={callbackUrl} readOnly className="text-xs" />
            </Field>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
