import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolCall } from './types'
import {
  buildWorkspaceSessionEventsPageFixture,
  buildWorkspaceSessionHistoryFixture,
} from './workspace-session-history-test-fixtures'
import {
  getToolCallPersistenceDisplay,
  sanitizeToolCallForPersistence,
  toolCallHasOmittedPersistenceContent,
} from './tool-call-persistence'
import {
  isWorkspaceSessionConversationEvent,
  isWorkspaceSessionTranscriptEvent,
  resolveWorkspaceSessionEventVisibility,
  resolveWorkspaceSessionSystemMessageVisibility,
  isWorkspaceSessionTurnDeletedEvent,
  workspaceSessionEventRecordToTimelineEvent,
  type WorkspaceSessionEventRecord,
  type WorkspaceSessionTurnRecord,
} from './workspace-session-history'

test('workspaceSessionEventRecordToTimelineEvent preserves an Agent message author', () => {
  const event: WorkspaceSessionEventRecord = {
    id: 'event-agent-user-1',
    sessionId: 'session-1',
    turnId: 'turn-agent-1',
    sessionSeq: 11,
    turnSeq: 1,
    visibility: 'transcript',
    kind: 'user_message',
    createdAt: '2026-07-23T00:00:01.000Z',
    payload: {
      messageId: 'message-agent-1',
      text: '请在这个工作区更新 PRD。',
      authorId: 'agent-research',
      author: {
        type: 'agent',
        id: 'agent-research',
        name: 'Research Agent',
        avatarUrl: '/avatars/research-agent.png',
      },
    },
  }

  assert.deepEqual(workspaceSessionEventRecordToTimelineEvent(event), {
    id: 'event-agent-user-1',
    ts: '2026-07-23T00:00:01.000Z',
    turnId: 'turn-agent-1',
    seq: 1,
    kind: 'user_message',
    messageId: 'message-agent-1',
    text: '请在这个工作区更新 PRD。',
    authorId: 'agent-research',
    author: {
      type: 'agent',
      id: 'agent-research',
      name: 'Research Agent',
      avatarUrl: '/avatars/research-agent.png',
    },
    attachments: undefined,
  })
})

test('workspaceSessionEventRecordToTimelineEvent maps assistant message event', () => {
  const event: WorkspaceSessionEventRecord = {
    id: 'event-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    sessionSeq: 12,
    turnSeq: 2,
    visibility: 'transcript',
    kind: 'assistant_message',
    createdAt: '2026-05-17T00:00:02.000Z',
    payload: {
      messageId: 'message-1',
      text: 'done',
      authorName: 'Codex',
      executionModel: 'gpt-5.5',
    },
  }

  assert.deepEqual(workspaceSessionEventRecordToTimelineEvent(event), {
    id: 'event-1',
    ts: '2026-05-17T00:00:02.000Z',
    turnId: 'turn-1',
    seq: 2,
    kind: 'assistant_message',
    messageId: 'message-1',
    text: 'done',
    authorName: 'Codex',
    executionModel: 'gpt-5.5',
    attachments: undefined,
  })
})

test('workspaceSessionEventRecordToTimelineEvent maps system message event', () => {
  const event: WorkspaceSessionEventRecord = {
    id: 'event-system-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    sessionSeq: 13,
    turnSeq: 3,
    visibility: 'transcript',
    kind: 'system_message',
    createdAt: '2026-05-17T00:00:03.000Z',
    payload: {
      message: '执行器与控制面连接已断开，本次回复已中止。',
    },
  }

  assert.deepEqual(workspaceSessionEventRecordToTimelineEvent(event), {
    id: 'event-system-1',
    ts: '2026-05-17T00:00:03.000Z',
    turnId: 'turn-1',
    seq: 3,
    kind: 'system_message',
    message: '执行器与控制面连接已断开，本次回复已中止。',
  })
})

test('isWorkspaceSessionConversationEvent ignores system-only runtime history', () => {
  const events: WorkspaceSessionEventRecord[] = [
    {
      id: 'event-system-1',
      sessionId: 'session-1',
      turnId: 'system:event-system-1',
      sessionSeq: 1,
      turnSeq: 1,
      visibility: 'diagnostic',
      kind: 'system_message',
      createdAt: '2026-05-17T00:00:01.000Z',
      payload: {
        message: '正在检查原始项目目录：/tmp/project',
      },
    },
    {
      id: 'event-status-1',
      sessionId: 'session-1',
      turnId: 'system:event-system-1',
      sessionSeq: 2,
      turnSeq: 2,
      visibility: 'diagnostic',
      kind: 'status',
      createdAt: '2026-05-17T00:00:02.000Z',
      payload: {
        status: 'complete',
        step: '工作区目录准备完成',
      },
    },
  ]

  assert.equal(events.some(isWorkspaceSessionConversationEvent), false)

  events.push({
    id: 'event-user-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    sessionSeq: 3,
    turnSeq: 1,
    visibility: 'transcript',
    kind: 'user_message',
    createdAt: '2026-05-17T00:00:03.000Z',
    payload: {
      messageId: 'message-user-1',
      text: '继续',
    },
  })

  assert.equal(events.some(isWorkspaceSessionConversationEvent), true)
})

test('resolveWorkspaceSessionSystemMessageVisibility marks lifecycle system turns as diagnostic', () => {
  assert.equal(resolveWorkspaceSessionSystemMessageVisibility({
    message: '正在检查原始项目目录：/tmp/project',
    turnId: 'system:event-1',
  }), 'diagnostic')

  assert.equal(resolveWorkspaceSessionSystemMessageVisibility({
    message: '用户主动停止，本次回复已中止。',
    turnId: 'turn-1',
  }), 'transcript')
})

test('resolveWorkspaceSessionEventVisibility defaults turn_deleted to hidden', () => {
  const event: WorkspaceSessionEventRecord = {
    id: 'event-delete-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    sessionSeq: 1,
    turnSeq: 2,
    visibility: 'hidden',
    kind: 'turn_deleted',
    createdAt: '2026-05-17T00:00:02.000Z',
    payload: {
      deletedTurnId: 'turn-1',
      deletedMessageId: 'message-1',
    },
  }

  assert.equal(resolveWorkspaceSessionEventVisibility(event), 'hidden')
  assert.equal(isWorkspaceSessionTranscriptEvent(event), false)
})

test('workspaceSessionEventRecordToTimelineEvent maps tool call event', () => {
  const toolCall: ToolCall = {
    id: 'tool-1',
    name: 'exec',
    args: 'pwd',
    startedAt: '2026-05-17T00:00:01.000Z',
  }

  const event: WorkspaceSessionEventRecord = {
    id: 'event-2',
    sessionId: 'session-1',
    turnId: 'turn-1',
    sessionSeq: 13,
    turnSeq: 3,
    visibility: 'transcript',
    kind: 'tool_call',
    createdAt: '2026-05-17T00:00:03.000Z',
    payload: {
      toolCall,
    },
  }

  assert.deepEqual(workspaceSessionEventRecordToTimelineEvent(event), {
    id: 'event-2',
    ts: '2026-05-17T00:00:03.000Z',
    turnId: 'turn-1',
    seq: 3,
    kind: 'tool_call',
    toolCall,
  })
})

test('workspaceSessionEventRecordToTimelineEvent maps pending interaction event', () => {
  const event: WorkspaceSessionEventRecord = {
    id: 'event-interaction',
    sessionId: 'session-1',
    turnId: 'turn-1',
    sessionSeq: 14,
    turnSeq: 4,
    visibility: 'transcript',
    kind: 'interaction',
    createdAt: '2026-05-17T00:00:04.000Z',
    payload: {
      interaction: {
        id: 'question-1',
        type: 'question',
        status: 'pending',
        title: '需要 GitHub 仓库地址',
        prompt: '请提供一个空仓库 URL。',
        provider: 'Codex',
        toolName: 'requestUserInput',
      },
    },
  }

  assert.deepEqual(workspaceSessionEventRecordToTimelineEvent(event), {
    id: 'event-interaction',
    ts: '2026-05-17T00:00:04.000Z',
    turnId: 'turn-1',
    seq: 4,
    kind: 'interaction',
    interaction: event.payload.interaction,
  })
})

test('workspaceSessionEventRecordToTimelineEvent hides turn deleted event from visible timeline', () => {
  const event: WorkspaceSessionEventRecord = {
    id: 'event-3',
    sessionId: 'session-1',
    turnId: 'turn-1',
    sessionSeq: 14,
    turnSeq: 4,
    visibility: 'hidden',
    kind: 'turn_deleted',
    createdAt: '2026-05-17T00:00:04.000Z',
    payload: {
      deletedTurnId: 'turn-1',
      deletedMessageId: 'message-1',
    },
  }

  assert.equal(isWorkspaceSessionTurnDeletedEvent(event), true)
  assert.equal(workspaceSessionEventRecordToTimelineEvent(event), null)
})

test('WorkspaceSessionTurnRecord supports persisted revision lineage metadata', () => {
  const turn: WorkspaceSessionTurnRecord = {
    id: 'turn-1',
    sessionId: 'session-1',
    status: 'completed',
    startedAt: '2026-05-17T00:00:01.000Z',
    finishedAt: '2026-05-17T00:00:03.000Z',
    eventCount: 4,
    lineage: {
      sourceSessionId: 'session-source',
      sourceTurnId: 'turn-source',
      sourceUserMessageId: 'message-user-source',
      sourceAssistantMessageId: 'message-assistant-source',
      revision: {
        kind: 'retry-assistant-turn',
        sourceTurnId: 'turn-source',
        sourceUserMessageId: 'message-user-source',
        sourceAssistantMessageId: 'message-assistant-source',
      },
    },
  }

  assert.equal(turn.lineage?.revision?.kind, 'retry-assistant-turn')
  assert.equal(turn.lineage?.sourceSessionId, 'session-source')
})

test('buildWorkspaceSessionEventsPageFixture slices long history like workspace history pagination', () => {
  const fixture = buildWorkspaceSessionHistoryFixture({
    sessionId: 'session-long-history',
    turnCount: 180,
  })

  const latestPage = buildWorkspaceSessionEventsPageFixture({
    sessionId: fixture.sessionId,
    events: fixture.events,
    limit: 120,
  })
  assert.equal(latestPage.events.length, 120)
  assert.equal(latestPage.hasMoreBefore, true)
  assert.equal(latestPage.hasMoreAfter, false)

  const initialLazyPage = buildWorkspaceSessionEventsPageFixture({
    sessionId: fixture.sessionId,
    events: fixture.events,
    limit: 20,
  })
  assert.equal(initialLazyPage.events.length, 20)
  assert.equal(initialLazyPage.events[0]!.sessionSeq > latestPage.events[0]!.sessionSeq, true)
  assert.equal(initialLazyPage.hasMoreBefore, true)
  assert.equal(initialLazyPage.hasMoreAfter, false)

  const olderPage = buildWorkspaceSessionEventsPageFixture({
    sessionId: fixture.sessionId,
    events: fixture.events,
    beforeSessionSeq: latestPage.events[0]?.sessionSeq,
    limit: 120,
  })
  assert.equal(olderPage.events.length >= 120, true)
  assert.equal(olderPage.events[0]!.sessionSeq < latestPage.events[0]!.sessionSeq, true)
  assert.equal(
    olderPage.events.filter((event) => event.turnId === olderPage.events[0]!.turnId).length,
    fixture.events.filter((event) => event.turnId === olderPage.events[0]!.turnId).length,
  )
  assert.equal(olderPage.hasMoreBefore, true)
  assert.equal(olderPage.hasMoreAfter, true)

  const incrementalPage = buildWorkspaceSessionEventsPageFixture({
    sessionId: fixture.sessionId,
    events: fixture.events,
    afterSessionSeq: latestPage.events.at(-1)?.sessionSeq,
    limit: 120,
  })
  assert.equal(incrementalPage.events.length, 0)
  assert.equal(incrementalPage.hasMoreAfter, false)
})

test('sanitizeToolCallForPersistence omits tool args and result for history storage', () => {
  const longText = 'x'.repeat(6_000)
  const persisted = sanitizeToolCallForPersistence({
    id: 'tool-oversized',
    name: 'Read',
    args: longText,
    result: longText,
    startedAt: '2026-05-17T00:00:01.000Z',
  })

  assert.equal(persisted.result, undefined)
  assert.equal(persisted.args?.includes('[tool_call_persistence_meta]') ?? false, true)
  assert.equal(toolCallHasOmittedPersistenceContent(persisted), true)
})

test('sanitizeToolCallForPersistence keeps one-line command preview for history storage', () => {
  const persisted = sanitizeToolCallForPersistence({
    id: 'tool-command',
    name: 'Shell',
    args: JSON.stringify({
      command: 'pnpm exec tsx --test packages/shared/src/workspace-session-history.test.ts',
    }),
    result: 'x'.repeat(6_000),
    startedAt: '2026-05-17T00:00:01.000Z',
  })

  const display = getToolCallPersistenceDisplay(persisted)
  assert.equal(display.args, 'pnpm exec tsx --test packages/shared/src/workspace-session-history.test.ts')
  assert.equal(display.result, undefined)
  assert.equal(display.contentOmitted, true)
})

test('sanitizeToolCallForPersistence keeps path and search previews without storing file content', () => {
  const readCall = sanitizeToolCallForPersistence({
    id: 'tool-read',
    name: 'Read',
    args: JSON.stringify({
      file_path: '/Users/x/work/Vibemux/apps/server/src/services/agent-tool-call.ts',
      content: 'x'.repeat(6_000),
    }),
    result: 'x'.repeat(6_000),
    startedAt: '2026-05-17T00:00:01.000Z',
  })
  const searchCall = sanitizeToolCallForPersistence({
    id: 'tool-search',
    name: 'Grep',
    args: JSON.stringify({
      pattern: 'buildToolCall',
      path: 'apps/server/src',
      content: 'x'.repeat(6_000),
    }),
    result: 'x'.repeat(6_000),
    startedAt: '2026-05-17T00:00:01.000Z',
  })

  const readDisplay = getToolCallPersistenceDisplay(readCall)
  const searchDisplay = getToolCallPersistenceDisplay(searchCall)
  assert.equal(readDisplay.args, '/Users/x/work/Vibemux/apps/server/src/services/agent-tool-call.ts')
  assert.equal(searchDisplay.args, 'buildToolCall · apps/server/src')
  assert.equal(readDisplay.args?.includes('xxxx'), false)
  assert.equal(searchDisplay.args?.includes('xxxx'), false)
  assert.equal(readDisplay.result, undefined)
  assert.equal(searchDisplay.result, undefined)
})

test('getToolCallPersistenceDisplay strips internal persistence metadata from display values', () => {
  const persisted = sanitizeToolCallForPersistence({
    id: 'tool-preview',
    name: 'Read',
    args: 'x'.repeat(6_000),
    result: 'y'.repeat(6_000),
    startedAt: '2026-05-17T00:00:01.000Z',
  })

  const display = getToolCallPersistenceDisplay(persisted)
  assert.equal(display.contentOmitted, true)
  assert.equal(display.args?.includes('[tool_call_persistence_meta]') ?? false, false)
  assert.equal(display.result, undefined)
  assert.equal(display.meta?.contentOmitted, true)
  assert.equal(display.meta?.argsStored, false)
  assert.equal(display.meta?.resultStored, false)
})

test('getToolCallPersistenceDisplay remains compatible with legacy truncated persistence payloads', () => {
  const display = getToolCallPersistenceDisplay({
    args: `preview\n\n[tool_call_persistence_meta]\n{"truncated":true,"argsLength":6000,"resultLength":6000,"argsTruncated":true,"resultTruncated":true}`,
    result: `preview result\n…(结果已截断，完整输出未写入历史存储)`,
  })

  assert.equal(display.contentOmitted, true)
  assert.equal(display.args, 'preview')
  assert.equal(display.result, undefined)
  assert.equal(display.meta?.argsLength, 6000)
  assert.equal(display.meta?.resultLength, 6000)
})
