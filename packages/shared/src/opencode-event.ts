// [INPUT]: OpenCode 事件输入
// [OUTPUT]: 事件类型
// [POS]: OpenCode 事件
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type OpenCodeEventRecord = {
  type?: string
  properties?: Record<string, unknown>
}

type OpenCodeWrappedEventRecord = OpenCodeEventRecord & {
  payload?: OpenCodeEventRecord
}

export const unwrapOpenCodeEvent = (rawEvent: Record<string, unknown>) => {
  const wrapped = rawEvent as OpenCodeWrappedEventRecord
  const candidate = wrapped.payload && typeof wrapped.payload === 'object'
    ? wrapped.payload
    : wrapped

  if (!candidate.type || !candidate.properties) {
    return null
  }

  return {
    type: candidate.type,
    properties: candidate.properties,
  }
}
