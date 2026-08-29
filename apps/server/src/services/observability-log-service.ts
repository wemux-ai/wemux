// [INPUT]: 日志事件
// [OUTPUT]: stdout 结构化日志
// [POS]: 可观测日志服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

type StructuredLogEvent = Record<string, unknown>

export const emitStructuredLog = (event: StructuredLogEvent) => {
  console.info(JSON.stringify(event))
}
