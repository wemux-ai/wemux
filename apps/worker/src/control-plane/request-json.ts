// [INPUT]: HTTP 请求输入
// [OUTPUT]: JSON 响应
// [POS]: 请求 JSON 工具
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export const requestJson = async <T,>(params: {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
  errorMessage: string
}) => {
  const response = await fetch(params.url, {
    method: params.method ?? 'GET',
    headers: {
      ...(params.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(params.headers ?? {}),
    },
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
  })

  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => ({ message: params.errorMessage }))) as {
      message?: string
    }
    throw new Error(payload.message || params.errorMessage)
  }

  return (await response.json()) as T
}
