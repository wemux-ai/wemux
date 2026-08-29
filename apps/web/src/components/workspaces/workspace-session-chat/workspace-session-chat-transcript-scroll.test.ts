import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveWorkspaceSessionTranscriptScrollStep,
  type PendingInitialScrollParams,
} from './workspace-session-chat-transcript-scroll'
import type { TimelineTurnDisplay } from './workspace-session-chat-helpers'

const basePendingInitialScroll: PendingInitialScrollParams = {
  conversationLoaded: false,
  conversationMessageCount: 0,
  displayTimelineLength: 0,
  hasResolvedInitialWorkspaceHistory: true,
  isWorkspaceHistoryMode: false,
  isSessionBusy: false,
  noticesLength: 0,
  queuedMessagesLength: 0,
  systemLogsLength: 0,
}

const streamingTimeline: TimelineTurnDisplay[] = [{
  id: 'turn-1',
  isCurrent: true,
  entries: [{
    kind: 'assistant',
    id: 'assistant-entry-1',
    message: {
      id: 'assistant-message-1',
      role: 'assistant',
      text: 'streaming',
      streaming: true,
    },
  }],
}]

test('resolveWorkspaceSessionTranscriptScrollStep waits while initial workspace history is still unresolved', () => {
  const step = resolveWorkspaceSessionTranscriptScrollStep({
    state: {
      pendingInitialScroll: true,
      skipNextAutoScroll: false,
    },
    open: true,
    pendingInitialScroll: {
      ...basePendingInitialScroll,
      hasResolvedInitialWorkspaceHistory: false,
      conversationLoaded: true,
      conversationMessageCount: 8,
      displayTimelineLength: 8,
    },
    displayTimeline: [],
  })

  assert.deepEqual(step, { kind: 'wait-for-initial-scroll' })
})

test('resolveWorkspaceSessionTranscriptScrollStep resolves exactly one initial scroll once history content is ready', () => {
  const step = resolveWorkspaceSessionTranscriptScrollStep({
    state: {
      pendingInitialScroll: true,
      skipNextAutoScroll: false,
    },
    open: true,
    pendingInitialScroll: {
      ...basePendingInitialScroll,
      conversationLoaded: true,
      conversationMessageCount: 20,
      displayTimelineLength: 20,
      isWorkspaceHistoryMode: true,
    },
    displayTimeline: [],
  })

  assert.deepEqual(step, { kind: 'initial-scroll' })
})

test('resolveWorkspaceSessionTranscriptScrollStep resolves once an empty workspace history page has loaded', () => {
  const step = resolveWorkspaceSessionTranscriptScrollStep({
    state: {
      pendingInitialScroll: true,
      skipNextAutoScroll: false,
    },
    open: true,
    pendingInitialScroll: {
      ...basePendingInitialScroll,
      conversationLoaded: true,
      displayTimelineLength: 0,
      isWorkspaceHistoryMode: true,
    },
    displayTimeline: [],
  })

  assert.deepEqual(step, { kind: 'initial-scroll' })
})

test('resolveWorkspaceSessionTranscriptScrollStep skips the auto-scroll immediately after initial scroll', () => {
  const step = resolveWorkspaceSessionTranscriptScrollStep({
    state: {
      pendingInitialScroll: false,
      skipNextAutoScroll: true,
    },
    open: true,
    pendingInitialScroll: {
      ...basePendingInitialScroll,
      conversationLoaded: true,
      conversationMessageCount: 20,
      displayTimelineLength: 20,
    },
    displayTimeline: [],
  })

  assert.deepEqual(step, { kind: 'skip-auto-scroll-after-initial-scroll' })
})

test('resolveWorkspaceSessionTranscriptScrollStep follows live streaming with instant scrolling', () => {
  const step = resolveWorkspaceSessionTranscriptScrollStep({
    state: {
      pendingInitialScroll: false,
      skipNextAutoScroll: false,
    },
    open: true,
    pendingInitialScroll: {
      ...basePendingInitialScroll,
      conversationLoaded: true,
      conversationMessageCount: 20,
      displayTimelineLength: 20,
    },
    displayTimeline: streamingTimeline,
  })

  assert.deepEqual(step, { kind: 'auto-scroll', mode: 'instant' })
})

test('resolveWorkspaceSessionTranscriptScrollStep keeps settled history changes smooth', () => {
  const step = resolveWorkspaceSessionTranscriptScrollStep({
    state: {
      pendingInitialScroll: false,
      skipNextAutoScroll: false,
    },
    open: true,
    pendingInitialScroll: {
      ...basePendingInitialScroll,
      conversationLoaded: true,
      conversationMessageCount: 20,
      displayTimelineLength: 20,
    },
    displayTimeline: [],
  })

  assert.deepEqual(step, { kind: 'auto-scroll', mode: 'smooth' })
})
