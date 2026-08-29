import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { TimelineTurnDisplay } from './workspace-session-chat-helpers'
import { traceWorkspaceSessionChat } from './workspace-session-chat-trace'

type ScrollMode = 'instant' | 'smooth'

type TranscriptScrollControllerState = {
  pendingInitialScroll: boolean
  skipNextAutoScroll: boolean
}

export type TranscriptScrollStep =
  | { kind: 'wait-for-initial-scroll' }
  | { kind: 'initial-scroll' }
  | { kind: 'skip-auto-scroll-after-initial-scroll' }
  | { kind: 'auto-scroll'; mode: ScrollMode }

export type PendingInitialScrollParams = {
  conversationLoaded: boolean
  conversationMessageCount: number
  displayTimelineLength: number
  hasResolvedInitialWorkspaceHistory: boolean
  isWorkspaceHistoryMode: boolean
  isSessionBusy: boolean
  noticesLength: number
  queuedMessagesLength: number
  systemLogsLength: number
}

export const shouldResolvePendingInitialScroll = ({
  conversationLoaded,
  conversationMessageCount,
  displayTimelineLength,
  hasResolvedInitialWorkspaceHistory,
  isWorkspaceHistoryMode,
  isSessionBusy,
  noticesLength,
  queuedMessagesLength,
  systemLogsLength,
}: PendingInitialScrollParams) => {
  if (!hasResolvedInitialWorkspaceHistory) {
    return false
  }

  return conversationLoaded
    || conversationMessageCount > 0
    || displayTimelineLength > 0
    || isSessionBusy
    || noticesLength > 0
    || queuedMessagesLength > 0
    || systemLogsLength > 0
}

const hasStreamingTimelineTurn = (displayTimeline: TimelineTurnDisplay[]) => {
  return displayTimeline.some((turn) => {
    return turn.entries.some((entry) => entry.kind === 'assistant' && Boolean(entry.message.streaming))
  })
}

export const resolveTimelineAutoScrollMode = (params: {
  isSessionBusy: boolean
  displayTimeline: TimelineTurnDisplay[]
}): ScrollMode => {
  if (params.isSessionBusy || hasStreamingTimelineTurn(params.displayTimeline)) {
    return 'instant'
  }

  return 'smooth'
}

export const resolveWorkspaceSessionTranscriptScrollStep = (params: {
  state: TranscriptScrollControllerState
  open: boolean
  pendingInitialScroll: PendingInitialScrollParams
  displayTimeline: TimelineTurnDisplay[]
}) => {
  const {
    displayTimeline,
    open,
    pendingInitialScroll,
    state,
  } = params

  if (state.pendingInitialScroll) {
    if (!open || !shouldResolvePendingInitialScroll(pendingInitialScroll)) {
      return { kind: 'wait-for-initial-scroll' } satisfies TranscriptScrollStep
    }

    return { kind: 'initial-scroll' } satisfies TranscriptScrollStep
  }

  if (state.skipNextAutoScroll) {
    return { kind: 'skip-auto-scroll-after-initial-scroll' } satisfies TranscriptScrollStep
  }

  return {
    kind: 'auto-scroll',
    mode: resolveTimelineAutoScrollMode({
      isSessionBusy: pendingInitialScroll.isSessionBusy,
      displayTimeline,
    }),
  } satisfies TranscriptScrollStep
}

export const useWorkspaceSessionTranscriptScrollController = (params: {
  autoScrollToBottom: (mode?: ScrollMode) => void
  conversationLoaded: boolean
  conversationMessageCount: number
  displayStatus: string
  displayStep: string
  displayTimeline: TimelineTurnDisplay[]
  hasResolvedInitialWorkspaceHistory: boolean
  isWorkspaceHistoryMode: boolean
  isSessionBusy: boolean
  noticesLength: number
  open: boolean
  queuedMessagesLength: number
  resumeAutoScroll: () => void
  scrollToBottom: (mode?: ScrollMode) => void
  setInitialTranscriptReady: Dispatch<SetStateAction<boolean>>
  systemLogsLength: number
  taskId: string
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const {
    autoScrollToBottom,
    conversationLoaded,
    conversationMessageCount,
    displayStatus,
    displayStep,
    displayTimeline,
    hasResolvedInitialWorkspaceHistory,
    isWorkspaceHistoryMode,
    isSessionBusy,
    noticesLength,
    open,
    queuedMessagesLength,
    resumeAutoScroll,
    scrollToBottom,
    setInitialTranscriptReady,
    systemLogsLength,
    taskId,
    workspaceId,
    workspaceSessionId,
  } = params
  const pendingInitialScrollRef = useRef(true)
  const skipNextAutoScrollRef = useRef(false)
  const initialTranscriptReadyFrameRef = useRef<number | null>(null)

  const cancelPendingReadyFrame = useCallback(() => {
    if (initialTranscriptReadyFrameRef.current === null) {
      return
    }

    window.cancelAnimationFrame(initialTranscriptReadyFrameRef.current)
    initialTranscriptReadyFrameRef.current = null
  }, [])

  useEffect(() => {
    cancelPendingReadyFrame()
    pendingInitialScrollRef.current = true
    setInitialTranscriptReady(false)
  }, [cancelPendingReadyFrame, open, setInitialTranscriptReady, taskId, workspaceId, workspaceSessionId])

  useEffect(() => {
    return () => {
      cancelPendingReadyFrame()
    }
  }, [cancelPendingReadyFrame])

  useLayoutEffect(() => {
    const step = resolveWorkspaceSessionTranscriptScrollStep({
      state: {
        pendingInitialScroll: pendingInitialScrollRef.current,
        skipNextAutoScroll: skipNextAutoScrollRef.current,
      },
      open,
      pendingInitialScroll: {
        conversationLoaded,
        conversationMessageCount,
        displayTimelineLength: displayTimeline.length,
        hasResolvedInitialWorkspaceHistory,
        isWorkspaceHistoryMode,
        isSessionBusy,
        noticesLength,
        queuedMessagesLength,
        systemLogsLength,
      },
      displayTimeline,
    })
    if (step.kind !== 'initial-scroll') {
      return
    }

    traceWorkspaceSessionChat('initial-scroll', {
      taskId,
      workspaceId,
      workspaceSessionId,
      conversationLoaded,
      conversationMessageCount,
      displayTimelineLength: displayTimeline.length,
      hasResolvedInitialWorkspaceHistory,
      isWorkspaceHistoryMode,
      isSessionBusy,
      noticesLength,
      queuedMessagesLength,
      systemLogsLength,
    })
    resumeAutoScroll()
    scrollToBottom('instant')
    pendingInitialScrollRef.current = false
    skipNextAutoScrollRef.current = true
    cancelPendingReadyFrame()
    initialTranscriptReadyFrameRef.current = window.requestAnimationFrame(() => {
      initialTranscriptReadyFrameRef.current = null
      setInitialTranscriptReady(true)
    })
  }, [
    cancelPendingReadyFrame,
    conversationLoaded,
    conversationMessageCount,
    displayTimeline.length,
    hasResolvedInitialWorkspaceHistory,
    isWorkspaceHistoryMode,
    isSessionBusy,
    noticesLength,
    open,
    queuedMessagesLength,
    resumeAutoScroll,
    scrollToBottom,
    setInitialTranscriptReady,
    systemLogsLength,
    taskId,
    workspaceId,
    workspaceSessionId,
  ])

  useEffect(() => {
    const step = resolveWorkspaceSessionTranscriptScrollStep({
      state: {
        pendingInitialScroll: pendingInitialScrollRef.current,
        skipNextAutoScroll: skipNextAutoScrollRef.current,
      },
      open,
      pendingInitialScroll: {
        conversationLoaded,
        conversationMessageCount,
        displayTimelineLength: displayTimeline.length,
        hasResolvedInitialWorkspaceHistory,
        isWorkspaceHistoryMode,
        isSessionBusy,
        noticesLength,
        queuedMessagesLength,
        systemLogsLength,
      },
      displayTimeline,
    })

    if (step.kind === 'wait-for-initial-scroll' || step.kind === 'initial-scroll') {
      return
    }

    if (step.kind === 'skip-auto-scroll-after-initial-scroll') {
      skipNextAutoScrollRef.current = false
      traceWorkspaceSessionChat('timeline-auto-scroll-skip', {
        reason: 'after-initial-scroll',
        taskId,
        workspaceId,
        workspaceSessionId,
        displayTimelineLength: displayTimeline.length,
      })
      return
    }

    traceWorkspaceSessionChat('timeline-auto-scroll', {
      taskId,
      workspaceId,
      workspaceSessionId,
      mode: step.mode,
      displayStatus,
      displayStep,
      displayTimelineLength: displayTimeline.length,
      isSessionBusy,
      noticesLength,
      queuedMessagesLength,
      systemLogsLength,
    })
    autoScrollToBottom(step.mode)
  }, [
    autoScrollToBottom,
    conversationLoaded,
    conversationMessageCount,
    displayStatus,
    displayStep,
    displayTimeline,
    hasResolvedInitialWorkspaceHistory,
    isWorkspaceHistoryMode,
    isSessionBusy,
    noticesLength,
    open,
    queuedMessagesLength,
    systemLogsLength,
    taskId,
    workspaceId,
    workspaceSessionId,
  ])
}
