// [INPUT]: 渠道标识与连接状态。
// [OUTPUT]: 渠道展示元数据（名称/图标/品牌色/连接判断）。
// [POS]: Agent 渠道卡片列表与配置浮窗共享的渠道元数据层。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import type { LucideIcon } from 'lucide-react'
import { Bell, Briefcase, Gamepad2, Hash, MessageCircle, MessageSquare, Phone, Send } from 'lucide-react'

export type AgentChannelKey = 'telegram' | 'feishu' | 'wechat' | 'discord' | 'slack' | 'wecom' | 'whatsapp' | 'dingtalk'

export interface AgentChannelMeta {
  key: AgentChannelKey
  name: string
  icon: LucideIcon
  color: string
  description: string
  /** 主要配置字段是否存在（用于连接状态判断） */
  isConfigured: (channelConfig: Record<string, unknown>) => boolean
  isEnabled: (channelConfig: Record<string, unknown>) => boolean
}

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const bool = (value: unknown) => value === true

export const CHANNEL_METAS: AgentChannelMeta[] = [
  {
    key: 'wechat',
    name: '微信',
    icon: MessageCircle,
    color: '#07C160',
    description: '腾讯官方 iLink（智联）通道，扫码一键绑定个人微信号',
    isConfigured: (c) => Boolean(str(c.botToken)),
    isEnabled: (c) => bool(c.enabled),
  },
  {
    key: 'telegram',
    name: 'Telegram',
    icon: Send,
    color: '#229ED9',
    description: 'Bot + 深链一键绑定，无需手动查找 Chat ID',
    isConfigured: (c) => Boolean(str(c.botToken)),
    isEnabled: (c) => bool(c.enabled),
  },
  {
    key: 'discord',
    name: 'Discord',
    icon: Gamepad2,
    color: '#5865F2',
    description: 'Gateway 长连接 + OAuth 邀请链接一键加入服务器',
    isConfigured: (c) => Boolean(str(c.botToken)),
    isEnabled: (c) => bool(c.enabled),
  },
  {
    key: 'slack',
    name: 'Slack',
    icon: Hash,
    color: '#4A154B',
    description: 'Socket Mode 免公网长连接，Bot/App Token 收发',
    isConfigured: (c) => Boolean(str(c.botToken) && str(c.appToken)),
    isEnabled: (c) => bool(c.enabled),
  },
  {
    key: 'wecom',
    name: '企业微信',
    icon: Briefcase,
    color: '#0082FF',
    description: '自建应用回调 + 应用消息（官方 WXBizMsgCrypt 加密）',
    isConfigured: (c) => Boolean(str(c.corpId) && str(c.agentId) && str(c.secret)),
    isEnabled: (c) => bool(c.enabled),
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    icon: Phone,
    color: '#25D366',
    description: 'Meta 官方 Cloud API，webhook 收发（需企业验证）',
    isConfigured: (c) => Boolean(str(c.phoneNumberId) && str(c.accessToken)),
    isEnabled: (c) => bool(c.enabled),
  },
  {
    key: 'dingtalk',
    name: '钉钉',
    icon: Bell,
    color: '#007FFF',
    description: 'Stream 模式免公网长连接，企业内部机器人',
    isConfigured: (c) => Boolean(str(c.appKey) && str(c.appSecret)),
    isEnabled: (c) => bool(c.enabled),
  },
  {
    key: 'feishu',
    name: '飞书',
    icon: MessageSquare,
    color: '#3370FF',
    description: '扫码一键创建 Bot（Lark.registerApp），长连接免公网',
    isConfigured: (c) => Boolean(str(c.appId) && str(c.appSecret)),
    isEnabled: (c) => bool(c.enabled),
  },
]
