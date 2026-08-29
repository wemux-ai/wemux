// [INPUT]: AI 公司品牌图标资源（/brand-icons/*.svg）与品牌色表。
// [OUTPUT]: 按 providerId 渲染品牌 logo；无图标资源时用首字母 + 品牌色兜底。
// [POS]: 模型中心「新增」菜单、账号接入区、provider 模板的通用品牌标识。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { cn } from '../../lib/utils'

export const BRAND_ICON_SRC: Record<string, string> = {
  openai: '/brand-icons/openai.svg',
  chatgpt: '/brand-icons/openai.svg',
  anthropic: '/brand-icons/claude.svg',
  claude: '/brand-icons/claude.svg',
  deepseek: '/brand-icons/deepseek.svg',
  gemini: '/brand-icons/gemini.svg',
  google: '/brand-icons/gemini.svg',
  openrouter: '/brand-icons/openrouter.svg',
  minimax: '/brand-icons/minimax.svg',
  'minimax-cn': '/brand-icons/minimax.svg',
  moonshot: '/brand-icons/moonshot.svg',
  kimi: '/brand-icons/moonshot.svg',
  qwen: '/brand-icons/qwen.svg',
  zhipu: '/brand-icons/zhipu.svg',
  siliconflow: '/brand-icons/siliconflow.svg',
  volcengine: '/brand-icons/volcengine.svg',
  doubao: '/brand-icons/doubao.svg',
  mistral: '/brand-icons/mistral.svg',
  groq: '/brand-icons/groq.svg',
  xai: '/brand-icons/xai.svg',
}

export const BRAND_COLORS: Record<string, string> = {
  openai: '#10a37f',
  chatgpt: '#10a37f',
  anthropic: '#d97757',
  claude: '#d97757',
  deepseek: '#4d6bfe',
  kimi: '#8a63ff',
  moonshot: '#8a63ff',
  gemini: '#4285f4',
  google: '#4285f4',
  openrouter: '#f97316',
  minimax: '#22d3ee',
  qwen: '#6d28d9',
  zhipu: '#4f46e5',
  mistral: '#f59e0b',
  groq: '#f43f5e',
  xai: '#111111',
  siliconflow: '#2563eb',
  volcengine: '#3370ff',
  doubao: '#3370ff',
}

const BRAND_FALLBACK_LETTERS: Record<string, string> = {
  kimi: 'K',
  moonshot: 'K',
  qwen: 'Q',
  zhipu: 'Z',
  mistral: 'M',
  groq: 'G',
  xai: 'x',
  siliconflow: 'S',
  volcengine: 'D',
  doubao: 'D',
  custom: 'P',
}

const resolveBrandKey = (providerId?: string) => {
  const normalized = providerId?.trim().toLowerCase() || ''
  if (BRAND_ICON_SRC[normalized]) {
    return normalized
  }
  if (normalized.includes('anthropic') || normalized.includes('claude')) {
    return 'claude'
  }
  if (normalized.includes('openai') || normalized.includes('chatgpt') || normalized.includes('codex')) {
    return 'openai'
  }
  if (normalized.includes('deepseek')) {
    return 'deepseek'
  }
  if (normalized.includes('moonshot') || normalized.includes('kimi')) {
    return 'moonshot'
  }
  return normalized
}

export function ProviderLogo({
  providerId,
  size = 16,
  className,
}: {
  providerId?: string
  size?: number
  className?: string
}) {
  const brandKey = resolveBrandKey(providerId)
  const iconSrc = BRAND_ICON_SRC[brandKey]

  if (iconSrc) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[4px] ring-1 ring-inset ring-white/10',
          brandKey === 'claude' ? 'bg-[#f7dacc] p-[2px]' : 'bg-white p-[2px]',
          className,
        )}
        style={{ height: size, width: size }}
      >
        <img
          alt=""
          aria-hidden="true"
          src={iconSrc}
          className="h-full w-full object-contain"
        />
      </span>
    )
  }

  const color = BRAND_COLORS[brandKey] ?? BRAND_COLORS[providerId?.trim().toLowerCase() ?? ''] ?? '#71717a'
  const letter = BRAND_FALLBACK_LETTERS[brandKey]
    ?? BRAND_FALLBACK_LETTERS[providerId?.trim().toLowerCase() ?? '']
    ?? (providerId?.trim().charAt(0).toUpperCase() || 'P')

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[4px] text-zinc-950',
        className,
      )}
      style={{
        height: size,
        width: size,
        backgroundColor: color,
        fontSize: Math.max(9, size * 0.55),
        fontWeight: 700,
      }}
    >
      {letter}
    </span>
  )
}
