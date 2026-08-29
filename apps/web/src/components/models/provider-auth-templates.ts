// [INPUT]: AI 公司授权模板定义（接入类型：OAuth 订阅 / API Key）。
// [OUTPUT]: 「新增模型」浮窗的模板目录；新增提供商只需加一条模板 + logo。
// [POS]: 模型中心授权模板体系；账号订阅登录与 api-key 快捷接入统一从这里出。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type AuthProviderAccessKind = 'oauth-chatgpt' | 'oauth-claude' | 'oauth-openrouter' | 'api-key'

export type AuthProviderTemplate = {
  id: string
  label: string
  providerId: string
  /** 接入方式：OAuth 订阅账号登录 / API Key 快速接入 */
  kind: AuthProviderAccessKind
  /** 中文描述 */
  descriptionZh: string
  /** 英文描述 */
  descriptionEn: string
  /** api-key 接入时的预填信息 */
  baseUrl?: string
  modelExamples?: string[]
}

export const AUTH_PROVIDER_TEMPLATES: AuthProviderTemplate[] = [
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    providerId: 'openai',
    kind: 'oauth-chatgpt',
    descriptionZh: '登录 ChatGPT 账号，用订阅额度跑 Codex（GPT-5.x 系列）',
    descriptionEn: 'Sign in with ChatGPT, use subscription quota for Codex (GPT-5.x)',
  },
  {
    id: 'claude',
    label: 'Claude',
    providerId: 'anthropic',
    kind: 'oauth-claude',
    descriptionZh: '登录 Claude 账号，用订阅额度跑 Claude Code（Opus/Sonnet/Haiku）',
    descriptionEn: 'Sign in with Claude, use subscription quota for Claude Code',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    providerId: 'deepseek',
    kind: 'api-key',
    descriptionZh: '填入 DeepSeek 开放平台 API Key，快速接入 DeepSeek 模型',
    descriptionEn: 'Add a DeepSeek Platform API key to use DeepSeek models',
    baseUrl: 'https://api.deepseek.com',
    modelExamples: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'kimi',
    label: 'Kimi',
    providerId: 'moonshot',
    kind: 'api-key',
    descriptionZh: '填入 Kimi（Moonshot）开放平台 API Key，快速接入 Kimi 模型',
    descriptionEn: 'Add a Moonshot Platform API key to use Kimi models',
    baseUrl: 'https://api.moonshot.ai/v1',
    modelExamples: ['kimi-k2.5', 'kimi-k2', 'kimi-k2-thinking'],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    providerId: 'google',
    kind: 'api-key',
    descriptionZh: '用 Google AI Studio 的 API Key 接入 Gemini 模型',
    descriptionEn: 'Add a Google AI Studio API key to use Gemini models',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    modelExamples: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash-lite'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    providerId: 'openrouter',
    kind: 'oauth-openrouter',
    descriptionZh: '一键授权连接你的 OpenRouter 账号，免费模型零成本起步',
    descriptionEn: 'One-click connect your OpenRouter account, start free with :free models',
  },
  {
    id: 'openrouter-apikey',
    label: 'OpenRouter API Key',
    providerId: 'openrouter',
    kind: 'api-key',
    descriptionZh: '手动填入 OpenRouter API Key，访问聚合的数百家模型',
    descriptionEn: 'Manually add an OpenRouter key for hundreds of aggregated models',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelExamples: ['openai/gpt-5', 'anthropic/claude-sonnet-4', 'deepseek/deepseek-chat'],
  },
  {
    id: 'qwen',
    label: '通义千问',
    providerId: 'qwen',
    kind: 'api-key',
    descriptionZh: '阿里云百炼 DashScope API Key，接入 Qwen 系列',
    descriptionEn: 'Add an Alibaba DashScope API key to use Qwen models',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelExamples: ['qwen-max', 'qwen-plus', 'qwen3-coder-plus'],
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    providerId: 'zhipu',
    kind: 'api-key',
    descriptionZh: '智谱开放平台 API Key，接入 GLM 系列模型',
    descriptionEn: 'Add a Zhipu API key to use GLM models',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelExamples: ['glm-4.6', 'glm-4.5-air', 'glm-z1-flash'],
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    providerId: 'minimax-cn',
    kind: 'api-key',
    descriptionZh: 'MiniMax 开放平台 API Key，接入 M 系列模型',
    descriptionEn: 'Add a MiniMax API key to use M-series models',
    baseUrl: 'https://api.minimaxi.com/v1',
    modelExamples: ['MiniMax-M2.7', 'MiniMax-M2.5', 'MiniMax-M1'],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    providerId: 'mistral',
    kind: 'api-key',
    descriptionZh: 'Mistral 平台 API Key，接入 Mistral 与 Codestral',
    descriptionEn: 'Add a Mistral API key to use Mistral / Codestral',
    baseUrl: 'https://api.mistral.ai/v1',
    modelExamples: ['mistral-large-latest', 'codestral-latest'],
  },
  {
    id: 'groq',
    label: 'Groq',
    providerId: 'groq',
    kind: 'api-key',
    descriptionZh: 'Groq 超快推理 API Key，接入 Llama / 开源模型',
    descriptionEn: 'Add a Groq API key for fast open-model inference',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelExamples: ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b'],
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    providerId: 'xai',
    kind: 'api-key',
    descriptionZh: 'xAI 开放平台 API Key，接入 Grok 系列模型',
    descriptionEn: 'Add an xAI API key to use Grok models',
    baseUrl: 'https://api.x.ai/v1',
    modelExamples: ['grok-4', 'grok-4-fast'],
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    providerId: 'siliconflow',
    kind: 'api-key',
    descriptionZh: '硅基流动聚合平台 API Key，接入主流开源模型',
    descriptionEn: 'Add a SiliconFlow API key for open-source models',
    baseUrl: 'https://api.siliconflow.cn/v1',
    modelExamples: ['deepseek-ai/DeepSeek-V3-0324', 'Qwen/Qwen3-Coder-480B-A35B'],
  },
  {
    id: 'doubao',
    label: '豆包',
    providerId: 'volcengine',
    kind: 'api-key',
    descriptionZh: '火山方舟 API Key，接入豆包系列模型',
    descriptionEn: 'Add a Volcengine Ark API key to use Doubao models',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelExamples: ['doubao-seed-1.6-flash', 'doubao-1.5-pro-32k-250115'],
  },
]

export const getAuthProviderTemplate = (templateId: string) => {
  return AUTH_PROVIDER_TEMPLATES.find((template) => template.id === templateId) ?? null
}
