// [INPUT]: 模型可用性输入
// [OUTPUT]: 判定结果
// [POS]: 模型可用性
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

type ModelProfileAvailabilityProtocol = 'openai' | 'anthropic'

type TestModelProfileAvailabilityInput = {
  providerId: string
  baseUrl: string
  apiToken?: string
  compatibility: ModelProfileAvailabilityProtocol
  modelIds: string[]
  timeoutMs?: number
}

type TestModelProfileAvailabilityOptions = {
  fetchImpl?: typeof fetch
}

export type ModelProfileAvailabilityResult = {
  ok: true
  providerId: string
  endpoint: string
  testedModelId: string
  status: number
  latencyMs: number
  message: string
}

const DEFAULT_TIMEOUT_MS = 15000
const TEST_PROMPT = 'ping'

const normalizeUrl = (value: string) => value.trim().replace(/\/+$/g, '')

const appendUrlPath = (baseUrl: string, suffix: string) => {
  const normalizedBaseUrl = normalizeUrl(baseUrl)
  const normalizedSuffix = suffix.replace(/^\/+/, '')
  if (!normalizedBaseUrl) {
    return ''
  }

  return normalizedBaseUrl.endsWith(`/${normalizedSuffix}`)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/${normalizedSuffix}`
}

const resolveOpenAiEndpoint = (baseUrl: string) => {
  const normalizedBaseUrl = normalizeUrl(baseUrl)
  if (normalizedBaseUrl.endsWith('/chat/completions')) {
    return normalizedBaseUrl
  }

  return appendUrlPath(normalizedBaseUrl, 'chat/completions')
}

const resolveAnthropicEndpoint = (baseUrl: string) => {
  const normalizedBaseUrl = normalizeUrl(baseUrl)
  if (normalizedBaseUrl.endsWith('/messages')) {
    return normalizedBaseUrl
  }

  if (normalizedBaseUrl.endsWith('/v1')) {
    return appendUrlPath(normalizedBaseUrl, 'messages')
  }

  return appendUrlPath(normalizedBaseUrl, 'v1/messages')
}

const resolveEndpoint = (compatibility: ModelProfileAvailabilityProtocol, baseUrl: string) => {
  return compatibility === 'anthropic'
    ? resolveAnthropicEndpoint(baseUrl)
    : resolveOpenAiEndpoint(baseUrl)
}

const buildHeaders = (params: {
  apiToken?: string
  compatibility: ModelProfileAvailabilityProtocol
}) => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }

  const apiToken = params.apiToken?.trim()
  if (params.compatibility === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01'
    if (apiToken) {
      headers['x-api-key'] = apiToken
    }
    return headers
  }

  if (apiToken) {
    headers.Authorization = `Bearer ${apiToken}`
  }
  return headers
}

const buildRequestBody = (params: {
  compatibility: ModelProfileAvailabilityProtocol
  modelId: string
}) => {
  if (params.compatibility === 'anthropic') {
    return {
      model: params.modelId,
      max_tokens: 1,
      messages: [{ role: 'user', content: TEST_PROMPT }],
    }
  }

  return {
    model: params.modelId,
    messages: [{ role: 'user', content: TEST_PROMPT }],
    max_tokens: 1,
    temperature: 0,
    stream: false,
  }
}

const extractErrorMessage = async (response: Response) => {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const parsed = await response.json().catch(() => null) as
      | { error?: { message?: string }; message?: string; detail?: string }
      | null
    const message = parsed?.error?.message || parsed?.message || parsed?.detail
    if (message) {
      return message
    }
  }

  const text = await response.text().catch(() => '')
  return text.trim() || `HTTP ${response.status}`
}

export const testModelProfileAvailability = async (
  input: TestModelProfileAvailabilityInput,
  options: TestModelProfileAvailabilityOptions = {},
): Promise<ModelProfileAvailabilityResult> => {
  const providerId = input.providerId.trim()
  const baseUrl = input.baseUrl.trim()
  const modelIds = input.modelIds.map((modelId) => modelId.trim()).filter(Boolean)
  const testedModelId = modelIds[0] || ''

  if (!providerId) {
    throw new Error('请先填写供应商 ID。')
  }
  if (!baseUrl) {
    throw new Error('请先填写 Base URL。')
  }
  if (!testedModelId) {
    throw new Error('请至少填写一个模型 ID。')
  }

  const endpoint = resolveEndpoint(input.compatibility, baseUrl)
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: buildHeaders({
        apiToken: input.apiToken,
        compatibility: input.compatibility,
      }),
      body: JSON.stringify(buildRequestBody({
        compatibility: input.compatibility,
        modelId: testedModelId,
      })),
      signal: controller.signal,
    })

    const latencyMs = Date.now() - startedAt
    if (!response.ok) {
      const errorMessage = await extractErrorMessage(response)
      throw new Error(`可用性检测失败：${errorMessage}`)
    }

    return {
      ok: true,
      providerId,
      endpoint,
      testedModelId,
      status: response.status,
      latencyMs,
      message: `可用性检测通过：${providerId}/${testedModelId} 可访问。`,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`可用性检测超时（>${timeoutMs}ms）。`)
    }

    throw error instanceof Error
      ? error
      : new Error('可用性检测失败。')
  } finally {
    clearTimeout(timeoutHandle)
  }
}
