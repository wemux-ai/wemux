/**
 * [INPUT]: Raw text/event-stream chunks emitted by the authenticated Inbox endpoint.
 * [OUTPUT]: Parsed event names and JSON payloads for the frontend Inbox store.
 * [POS]: Browser-independent SSE framing helper; network ownership stays in InboxProvider.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

export type ParsedInboxStreamEvent = {
  event: string
  data: unknown
}

export const parseInboxStreamEvent = (rawEvent: string): ParsedInboxStreamEvent | null => {
  const lines: string[] = rawEvent.split('\r\n').join('\n').split('\n')
  const event = lines.find((line: string) => line.startsWith('event:'))?.slice(6).trim() || 'message'
  const data = lines
    .filter((line: string) => line.startsWith('data:'))
    .map((line: string) => line.slice(5).trimStart())
    .join('\n')

  if (!data) return null

  try {
    return { event, data: JSON.parse(data) as unknown }
  } catch {
    return null
  }
}

export const splitInboxStreamBuffer = (buffer: string) => {
  const normalized = buffer.split('\r\n').join('\n')
  const events = normalized.split('\n\n')
  return {
    events: events.slice(0, -1),
    remainder: events.at(-1) ?? '',
  }
}
