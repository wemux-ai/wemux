import {
  WORKSPACE_SESSION_HISTORY_PROTOCOL_VERSION,
  type WorkspaceSessionEventRecord,
  type WorkspaceSessionEventsPage,
} from './workspace-session-history'

type BuildWorkspaceSessionHistoryFixtureOptions = {
  sessionId?: string
  turnCount: number
  deletedTurnIndexes?: number[]
  thinkingEvery?: number
  toolCallEvery?: number
  statusEvery?: number
  startAt?: string
}

export type WorkspaceSessionHistoryFixtureTurn = {
  index: number
  turnId: string
  userMessageId: string
  assistantMessageId: string
  firstSessionSeq: number
  lastSessionSeq: number
  deleted: boolean
}

export type WorkspaceSessionHistoryFixture = {
  sessionId: string
  events: WorkspaceSessionEventRecord[]
  turns: WorkspaceSessionHistoryFixtureTurn[]
}

const clampPositiveInteger = (value: number | undefined, fallback: number) => {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.max(1, Math.floor(value as number))
}

const shouldIncludeEvery = (index: number, every: number) => index % every === 0

export const buildWorkspaceSessionHistoryFixture = (
  options: BuildWorkspaceSessionHistoryFixtureOptions,
): WorkspaceSessionHistoryFixture => {
  const sessionId = options.sessionId?.trim() || 'workspace-session-fixture'
  const thinkingEvery = clampPositiveInteger(options.thinkingEvery, 2)
  const toolCallEvery = clampPositiveInteger(options.toolCallEvery, 3)
  const statusEvery = clampPositiveInteger(options.statusEvery, 1)
  const deletedTurnIndexes = new Set(options.deletedTurnIndexes ?? [])
  const baseTime = new Date(options.startAt ?? '2026-05-17T00:00:00.000Z').getTime()

  let sessionSeq = 0
  const events: WorkspaceSessionEventRecord[] = []
  const turns: WorkspaceSessionHistoryFixtureTurn[] = []

  const nextCreatedAt = () => {
    return new Date(baseTime + sessionSeq * 1_000).toISOString()
  }

  for (let turnIndex = 1; turnIndex <= options.turnCount; turnIndex += 1) {
    const turnId = `turn-${turnIndex}`
    const userMessageId = `message-user-${turnIndex}`
    const assistantMessageId = `message-assistant-${turnIndex}`
    let turnSeq = 1
    const firstSessionSeq = sessionSeq + 1

    sessionSeq += 1
    events.push({
      id: `event-user-${turnIndex}`,
      sessionId,
      turnId,
      sessionSeq,
      turnSeq,
      createdAt: nextCreatedAt(),
      visibility: 'transcript',
      kind: 'user_message',
      payload: {
        messageId: userMessageId,
        text: `user message ${turnIndex}`,
      },
    })

    if (shouldIncludeEvery(turnIndex, thinkingEvery)) {
      turnSeq += 1
      sessionSeq += 1
      events.push({
        id: `event-thinking-${turnIndex}`,
        sessionId,
        turnId,
        sessionSeq,
        turnSeq,
        createdAt: nextCreatedAt(),
        visibility: 'transcript',
        kind: 'thinking',
        payload: {
          partId: `thinking-${turnIndex}`,
          messageId: assistantMessageId,
          text: `thinking ${turnIndex}`,
        },
      })
    }

    if (shouldIncludeEvery(turnIndex, toolCallEvery)) {
      turnSeq += 1
      sessionSeq += 1
      events.push({
        id: `event-tool-${turnIndex}`,
        sessionId,
        turnId,
        sessionSeq,
        turnSeq,
        createdAt: nextCreatedAt(),
        visibility: 'transcript',
        kind: 'tool_call',
        payload: {
          toolCall: {
            id: `tool-${turnIndex}`,
            name: 'exec_command',
            args: `echo turn-${turnIndex}`,
            startedAt: nextCreatedAt(),
            finishedAt: nextCreatedAt(),
          },
        },
      })
    }

    turnSeq += 1
    sessionSeq += 1
    events.push({
      id: `event-assistant-${turnIndex}`,
      sessionId,
      turnId,
      sessionSeq,
      turnSeq,
      createdAt: nextCreatedAt(),
      visibility: 'transcript',
      kind: 'assistant_message',
      payload: {
        messageId: assistantMessageId,
        text: `assistant message ${turnIndex}`,
        authorName: 'Codex',
        executionModel: 'gpt-5.5',
      },
    })

    if (shouldIncludeEvery(turnIndex, statusEvery)) {
      turnSeq += 1
      sessionSeq += 1
      events.push({
        id: `event-status-${turnIndex}`,
        sessionId,
        turnId,
        sessionSeq,
        turnSeq,
        createdAt: nextCreatedAt(),
        visibility: 'transcript',
        kind: 'status',
        payload: {
          status: 'complete',
          step: `turn ${turnIndex} complete`,
        },
      })
    }

    const deleted = deletedTurnIndexes.has(turnIndex)
    if (deleted) {
      turnSeq += 1
      sessionSeq += 1
      events.push({
        id: `event-delete-${turnIndex}`,
        sessionId,
        turnId,
        sessionSeq,
        turnSeq,
        createdAt: nextCreatedAt(),
        visibility: 'hidden',
        kind: 'turn_deleted',
        payload: {
          deletedTurnId: turnId,
          deletedMessageId: userMessageId,
        },
      })
    }

    turns.push({
      index: turnIndex,
      turnId,
      userMessageId,
      assistantMessageId,
      firstSessionSeq,
      lastSessionSeq: sessionSeq,
      deleted,
    })
  }

  return {
    sessionId,
    events,
    turns,
  }
}

export const buildWorkspaceSessionEventsPageFixture = (params: {
  sessionId: string
  events: WorkspaceSessionEventRecord[]
  afterSessionSeq?: number
  beforeSessionSeq?: number
  limit?: number
}): WorkspaceSessionEventsPage => {
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500)
  const useBackwardPage = typeof params.beforeSessionSeq === 'number'
    || (typeof params.afterSessionSeq !== 'number' && typeof params.beforeSessionSeq !== 'number')

  let filteredEvents = params.events.filter((event) => event.sessionId === params.sessionId)
  if (typeof params.afterSessionSeq === 'number') {
    filteredEvents = filteredEvents.filter((event) => event.sessionSeq > params.afterSessionSeq!)
  }
  if (typeof params.beforeSessionSeq === 'number') {
    filteredEvents = filteredEvents.filter((event) => event.sessionSeq < params.beforeSessionSeq!)
  }

  let pageEvents = useBackwardPage
    ? [...filteredEvents].sort((left, right) => right.sessionSeq - left.sessionSeq).slice(0, limit).reverse()
    : [...filteredEvents].sort((left, right) => left.sessionSeq - right.sessionSeq).slice(0, limit)

  if (useBackwardPage && pageEvents.length > 0) {
    const leadingTurnId = pageEvents[0]?.turnId
    const firstSeq = pageEvents[0]?.sessionSeq
    if (leadingTurnId && typeof firstSeq === 'number') {
      const leadingTurnPrefix = filteredEvents.filter((event) => event.turnId === leadingTurnId && event.sessionSeq < firstSeq)
      if (leadingTurnPrefix.length > 0) {
        pageEvents = [...leadingTurnPrefix, ...pageEvents]
      }
    }
  }

  const firstSeq = pageEvents[0]?.sessionSeq
  const lastSeq = pageEvents.at(-1)?.sessionSeq
  const totalCount = params.events.filter((event) => event.sessionId === params.sessionId).length

  return {
    protocolVersion: WORKSPACE_SESSION_HISTORY_PROTOCOL_VERSION,
    sessionId: params.sessionId,
    events: pageEvents,
    totalCount,
    hasMoreBefore: typeof firstSeq === 'number' ? firstSeq > 1 : false,
    hasMoreAfter: typeof lastSeq === 'number' ? lastSeq < totalCount : false,
    visibility: 'all',
  }
}
