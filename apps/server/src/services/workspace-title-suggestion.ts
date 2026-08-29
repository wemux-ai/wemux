// [INPUT]: 会话标题请求
// [OUTPUT]: AI 标题建议（ai/fallback）
// [POS]: 标题建议服务（DeepSeek，OpenAI 兼容 chat/completions）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { truncateWorkspaceTitle } from '@shared/workspace-title'
export { buildWorkspaceNameFromInitialPrompt, buildWorkspaceTitleFallback } from '@shared/workspace-title'

const DEEPSEEK_CHAT_COMPLETIONS_URL = 'https://api.deepseek.com/chat/completions'
const DEFAULT_DEEPSEEK_TITLE_MODEL = 'deepseek-chat'
const DEFAULT_TIMEOUT_MS = 12_000

export type WorkspaceTitleSuggestionResult = {
  title: string
  source: 'ai' | 'fallback'
  model?: string
  reason?: string
  message?: string
}

export const resolveDeepSeekWorkspaceTitleConfig = () => {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() || ''
  const model = process.env.DEEPSEEK_WORKSPACE_TITLE_MODEL?.trim()
    || process.env.WORKSPACE_TITLE_DEEPSEEK_MODEL?.trim()
    || DEFAULT_DEEPSEEK_TITLE_MODEL
  return {
    apiKey,
    model,
  }
}

const parseStructuredTitle = (value: string) => {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return ''
    }

    const record = parsed as Record<string, unknown>
    for (const key of ['title', 'name', 'workspaceName', 'workspaceTitle']) {
      const candidate = record[key]
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate
      }
    }
  } catch {
    return ''
  }

  return ''
}

export const sanitizeSuggestedWorkspaceTitle = (output: string, fallbackTitle: string) => {
  const structuredTitle = parseStructuredTitle(output.trim())
  const firstLine = (structuredTitle || output)
    .replace(/^```(?:json|text)?/i, '')
    .replace(/```$/i, '')
    .trim()
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim() ?? ''

  const normalized = firstLine
    .replace(/^[#>\-\s\d.)]+/, '')
    .replace(/^(?:标题|名称|工作区名称|workspace\s*title|workspace\s*name|title|name)\s*[:：-]\s*/i, '')
    .replace(/^["'“”‘’`「『《]+|["'“”‘’`」』》。.:：]+$/g, '')
  const title = truncateWorkspaceTitle(normalized)
  if (!title || /^(?:标题|名称|title|name|好的|当然)$/i.test(title)) {
    return fallbackTitle
  }

  return title
}

export const buildWorkspaceTitleSuggestionPrompt = (initialPrompt: string) => {
  return [
    '请根据下面用户输入，为即将创建的代码工作区起一个简短标题。',
    '',
    '要求：',
    '- 只输出标题本身，不要解释',
    '- 使用用户输入的主要语言',
    '- 最多 12 个中文字符或 6 个英文单词',
    '- 不要包含引号、句号、冒号、emoji',
    '- 提炼任务主题，不要照抄完整用户输入',
    '',
    '用户输入：',
    initialPrompt.trim(),
  ].join('\n')
}

/**
 * DeepSeek chat 模型（deepseek-chat）不支持图片输入，
 * 附图的 imageDataUrl 在此被忽略，仅用文本提示起名。
 * 若未来需要图片上下文，需切换到多模态模型。
 */
const buildWorkspaceTitleSuggestionUserContent = (params: { initialPrompt: string }) => {
  return buildWorkspaceTitleSuggestionPrompt(params.initialPrompt)
}

const extractDeepSeekOutput = (body: unknown) => {
  if (!body || typeof body !== 'object') {
    return ''
  }

  const firstChoice = (body as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> }).choices?.[0]
  const content = firstChoice?.message?.content ?? firstChoice?.text
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text
        return ''
      })
      .join('')
  }

  return ''
}

const extractDeepSeekError = async (response: Response) => {
  const parsed = await response.json().catch(() => null) as
    | { error?: { message?: string }; message?: string }
    | null
  return parsed?.error?.message || parsed?.message || `DeepSeek 请求失败：${response.status}`
}

export const suggestWorkspaceTitleWithDeepSeek = async (params: {
  initialPrompt: string
  fallbackTitle: string
  imageFilename?: string
  imageDataUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  log?: Pick<typeof console, 'info'>
}): Promise<WorkspaceTitleSuggestionResult> => {
  const logger = params.log ?? console
  const fallbackTitle = params.fallbackTitle.trim()
  const fallback = (reason: string, message?: string): WorkspaceTitleSuggestionResult => {
    logger.info('[workspace-title-suggestion] fallback', {
      provider: 'deepseek',
      fallbackTitle,
      reason,
      message,
    })
    return {
      title: fallbackTitle,
      source: 'fallback',
      reason,
      message,
    }
  }
  const initialPrompt = params.initialPrompt.trim()
  if (!initialPrompt) {
    return fallback('empty_prompt')
  }

  const config = resolveDeepSeekWorkspaceTitleConfig()
  if (!config.apiKey) {
    return fallback('deepseek_api_key_missing')
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), params.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const fetchImpl = params.fetchImpl ?? fetch
    const response = await fetchImpl(DEEPSEEK_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: 'You generate concise workspace titles. Return only the title.' },
          {
            role: 'user',
            content: buildWorkspaceTitleSuggestionUserContent({
              initialPrompt,
            }),
          },
        ],
        temperature: 0.2,
        max_tokens: 24,
        stream: false,
      }),
      signal: abortController.signal,
    })
    if (!response.ok) {
      return fallback('deepseek_request_failed', await extractDeepSeekError(response))
    }

    const body = await response.json().catch(() => null) as unknown
    const output = extractDeepSeekOutput(body)
    if (!output.trim()) {
      return fallback('deepseek_empty_output')
    }

    const title = sanitizeSuggestedWorkspaceTitle(output, fallbackTitle)
    logger.info('[workspace-title-suggestion] generated', {
      provider: 'deepseek',
      model: config.model,
      title,
      fallbackMatched: title === fallbackTitle,
    })
    return {
      title,
      source: 'ai',
      model: config.model,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DeepSeek 起名失败。'
    return fallback('deepseek_error', message)
  } finally {
    clearTimeout(timeout)
  }
}
