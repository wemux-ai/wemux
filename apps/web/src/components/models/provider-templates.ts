export type ProviderTemplateCompatibility = 'openai' | 'anthropic'

export type ProviderTemplate = {
  id: string
  label: string
  providerId: string
  baseUrl: string
  compatibility: ProviderTemplateCompatibility
  modelExamples: string[]
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    providerId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    compatibility: 'openai',
    modelExamples: ['gpt-5', 'gpt-5-mini'],
  },
  {
    id: 'anthropic',
    label: 'Claude / Anthropic',
    providerId: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    compatibility: 'anthropic',
    modelExamples: ['claude-sonnet-4-20250514', 'claude-opus-4-1-20250805'],
  },
  {
    id: 'google-gemini',
    label: 'Gemini / Google AI Studio',
    providerId: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    compatibility: 'openai',
    modelExamples: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    providerId: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    compatibility: 'openai',
    modelExamples: ['openai/gpt-5', 'anthropic/claude-sonnet-4'],
  },
  {
    id: 'moonshot',
    label: 'Kimi / Moonshot',
    providerId: 'moonshot',
    baseUrl: 'https://api.moonshot.ai/v1',
    compatibility: 'openai',
    modelExamples: ['kimi-k2.5', 'kimi-k2'],
  },
  {
    id: 'minimax-global',
    label: 'MiniMax Global',
    providerId: 'minimax',
    baseUrl: 'https://api.minimax.io/v1',
    compatibility: 'openai',
    modelExamples: ['MiniMax-M2.7', 'MiniMax-M2.5'],
  },
  {
    id: 'minimax-cn',
    label: 'MiniMax CN',
    providerId: 'minimax-cn',
    baseUrl: 'https://api.minimaxi.com/v1',
    compatibility: 'openai',
    modelExamples: ['MiniMax-M2.7', 'MiniMax-M2.5'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    providerId: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    compatibility: 'openai',
    modelExamples: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  },
  {
    id: 'qwen',
    label: 'Qwen / DashScope',
    providerId: 'qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    compatibility: 'openai',
    modelExamples: ['qwen-max', 'qwen-plus'],
  },
  {
    id: 'zhipu',
    label: 'Zhipu / GLM',
    providerId: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    compatibility: 'openai',
    modelExamples: ['glm-4.6', 'glm-z1-air'],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    providerId: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    compatibility: 'openai',
    modelExamples: ['mistral-large-latest', 'mistral-small-latest'],
  },
  {
    id: 'groq',
    label: 'Groq',
    providerId: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    compatibility: 'openai',
    modelExamples: ['openai/gpt-oss-20b', 'llama-3.3-70b-versatile'],
  },
  {
    id: 'xai',
    label: 'xAI / Grok',
    providerId: 'xai',
    baseUrl: 'https://api.x.ai/v1',
    compatibility: 'openai',
    modelExamples: ['grok-4', 'grok-4.20-reasoning'],
  },
]

const normalizeProviderValue = (value?: string | null) => {
  return value?.trim().toLowerCase() || ''
}

const normalizeBaseUrlValue = (value?: string | null) => {
  return value?.trim().replace(/\/+$/g, '').toLowerCase() || ''
}

export const findProviderTemplate = (providerId?: string, baseUrl?: string) => {
  const normalizedProviderId = normalizeProviderValue(providerId)
  const normalizedBaseUrl = normalizeBaseUrlValue(baseUrl)

  return PROVIDER_TEMPLATES.find((template) => {
    if (normalizeProviderValue(template.providerId) !== normalizedProviderId) {
      return false
    }

    if (!normalizedBaseUrl) {
      return true
    }

    return normalizeBaseUrlValue(template.baseUrl) === normalizedBaseUrl
  }) ?? null
}

export const getProviderTemplate = (templateId: string) => {
  return PROVIDER_TEMPLATES.find((template) => template.id === templateId) ?? null
}

export const inferProviderCompatibility = (
  providerId?: string,
  baseUrl?: string,
): ProviderTemplateCompatibility => {
  const matchedTemplate = findProviderTemplate(providerId, baseUrl) ?? findProviderTemplate(providerId)
  if (matchedTemplate) {
    return matchedTemplate.compatibility
  }

  const combined = `${providerId || ''} ${baseUrl || ''}`.toLowerCase()
  return combined.includes('anthropic') || combined.includes('claude')
    ? 'anthropic'
    : 'openai'
}
