// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// INPUT: workspace session props, remote snapshots, and local composer/runtime interactions
// OUTPUT: synchronized workspace-session chat state and setters for actions and views
// POS: state owner for a single workspace session chat surface

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TaskChatContextRef } from '@shared/task-chat-context'
import type { TaskChatSessionSnapshot } from '@shared/task-chat-session'
import type {
  AgentRunningStatus,
  AgentRuntimeSettings,
  ExecutionModelOption,
  ModelTokenUsage,
  Task,
  ToolCall,
  WorkspaceSessionRole,
} from '@shared/types'
import type { AgentRecord, ConversationMessageRecord } from '../../../lib/api'
import {
  buildTaskChatScopeKey,
  getCachedTaskChatComposer,
  getCachedTaskChatSession,
  getCachedTaskConversation,
  setCachedTaskChatComposer,
} from '../../../lib/workspace-session-chat-cache'
import { resolveDefaultDelegatePrompt, resolveDefaultSubAgentSessionRole } from '../../../lib/custom-agent/delegate-runtime'
import type { ChatTimelineEvent } from '../../../lib/workspace-session-chat-ui'
import { useAvailableSkills } from '../../../lib/use-available-skills'
import { useSmoothAutoScroll } from '../../../lib/use-smooth-auto-scroll'
import {
  readWorkspaceSessionModelMenuPreferences,
  recordWorkspaceSessionModelMenuSelection,
  writeWorkspaceSessionModelMenuPreferences,
} from '../../../lib/workspace-session-model-menu-preferences'
import { useTaskChatDerivedState } from './workspace-session-chat-derived-state'
import { useTaskChatHistoryState } from './workspace-session-chat-history-state'
import {
  getTaskScopedAgentSettings,
  getTaskScopedEnabledMcpServerIds,
  resolveTaskChatMcpServerSelection,
  resolveTaskChatRuntimeSettings,
  resolveWorkspaceSessionScopedRuntimeConfig,
  type NoticeItem,
} from './workspace-session-chat-helpers'
import {
  mapDisplayTimelineToOutlineItems,
  mergeTaskChatOutlineItems,
  type TaskChatOutlineItem,
} from './workspace-session-chat-outline'
import { useTaskChatSessionSync } from './workspace-session-chat-session-sync'
import type {
  ChatImage,
  PendingAgentDispatch,
  WorkspaceSessionChatDraftMessage,
  WorkspaceSessionChatProps,
} from './workspace-session-chat-types'
import { filterQueuedMessagesAlreadyInConversation } from '../../../lib/thread/thread-merge'

type TaskChatStateParams = Pick<
  WorkspaceSessionChatProps,
  | 'activeExecutorId'
  | 'agentSettings'
  | 'executors'
  | 'initialInput'
  | 'mcpServers'
  | 'onTaskUpdate'
  | 'onWorkspaceSessionChange'
  | 'open'
  | 'preparingWorkspace'
  | 'project'
  | 'task'
  | 'workspaceId'
  | 'workspaceSession'
  | 'workspaceSessionId'
>

const TASK_CHAT_COMPOSER_HISTORY_LIMIT = 32
const WORKSPACE_SESSION_INITIAL_HISTORY_PAGE_SIZE = 50
export function useTaskChatState({
  activeExecutorId,
  agentSettings,
  executors,
  initialInput = '',
  mcpServers,
  onTaskUpdate,
  onWorkspaceSessionChange,
  open,
  preparingWorkspace = false,
  project,
  task,
  workspaceId,
  workspaceSession,
  workspaceSessionId,
}: TaskChatStateParams) {
  const initialCachedConversation = useMemo(() => {
    return getCachedTaskConversation(task.id, workspaceId, workspaceSessionId)
  }, [task.id, workspaceId, workspaceSessionId])
  const initialCachedComposer = useMemo(() => {
    return getCachedTaskChatComposer(task.id, workspaceId, workspaceSessionId)
  }, [task.id, workspaceId, workspaceSessionId])
  const initialCachedSession = useMemo(() => {
    return getCachedTaskChatSession(task.id, workspaceId, workspaceSessionId)
  }, [task.id, workspaceId, workspaceSessionId])
  const scopedRuntimeConfig = useMemo(() => {
    return resolveWorkspaceSessionScopedRuntimeConfig(task, workspaceSession)
  }, [task, workspaceSession])
  const chatScopeKey = useMemo(() => {
    return buildTaskChatScopeKey(task.id, workspaceId, workspaceSessionId)
  }, [task.id, workspaceId, workspaceSessionId])
  const scopedAgentSettings = scopedRuntimeConfig.agentSettings
  const scopedEnabledMcpServerIds = scopedRuntimeConfig.enabledMcpServerIds
  const scopedAgentSettingsKey = JSON.stringify(scopedAgentSettings ?? null)
  const scopedEnabledMcpServerIdsKey = JSON.stringify(scopedEnabledMcpServerIds ?? null)
  const globalAgentSettingsKey = JSON.stringify(agentSettings ?? null)
  const persistedExecutorId = activeExecutorId?.trim() || ''

  const [input, setInput] = useState(() => initialInput.trim() || initialCachedComposer?.input || '')
  const [inputHistory, setInputHistory] = useState<string[]>(() => initialCachedComposer?.history ?? [])
  const [inputHistoryIndex, setInputHistoryIndex] = useState<number | null>(null)
  const [inputHistoryDraft, setInputHistoryDraft] = useState('')
  const [images, setImages] = useState<ChatImage[]>(() => initialCachedComposer?.images ?? [])
  const [selectedContextRefs, setSelectedContextRefs] = useState<TaskChatContextRef[]>(() => initialCachedComposer?.contextRefs ?? [])
  const [isUploading, setIsUploading] = useState(false)
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [liveStatus, setLiveStatus] = useState<AgentRunningStatus>(task.agentRunningStatus)
  const [liveStep, setLiveStep] = useState(task.currentStep)
  const [liveTools, setLiveTools] = useState<ToolCall[]>(task.toolCalls ?? [])
  const [currentRunTiming, setCurrentRunTiming] = useState<{
    turnId: string
    startedAt: string
    finishedAt?: string
  } | null>(null)
  const [notices, setNotices] = useState<NoticeItem[]>([])
  const [chatSession, setChatSession] = useState<TaskChatSessionSnapshot | null>(() => initialCachedSession)
  const [modelOptions, setModelOptions] = useState<ExecutionModelOption[]>([])
  const [defaultModel, setDefaultModel] = useState('')
  const [modelMenuPreferences, setModelMenuPreferences] = useState(() => readWorkspaceSessionModelMenuPreferences())
  const [selectedExecutorId, setSelectedExecutorId] = useState(persistedExecutorId)
  const effectiveExecutorId = selectedExecutorId.trim()
  const [selectedAgentType, setSelectedAgentType] = useState<Task['agentType']>(scopedRuntimeConfig.agentType)
  // selectedModel is the "model for the next message". Its single source of truth is the
  // persisted session executionModel, seeded once per chat scope (see the scope effect below).
  // It only changes on explicit user action or when the scope changes — never on runtime
  // snapshots arriving mid-run — so the footer label stays stable while a turn is running.
  const [selectedModel, setSelectedModel] = useState(scopedRuntimeConfig.executionModel)
  const [selectedRuntimeSettings, setSelectedRuntimeSettings] = useState<AgentRuntimeSettings>(() => {
    return resolveTaskChatRuntimeSettings(scopedRuntimeConfig.agentType, agentSettings, scopedAgentSettings)
  })
  const [selectedMcpServerIds, setSelectedMcpServerIds] = useState<string[]>(() => {
    return resolveTaskChatMcpServerSelection(
      (mcpServers ?? []).filter((server) => server.enabled),
      scopedEnabledMcpServerIds,
    )
  })
  const [agentSaving, setAgentSaving] = useState(false)
  const [executorSaving, setExecutorSaving] = useState(false)
  const [modelLoading, setModelLoading] = useState(false)
  const [modelSaving, setModelSaving] = useState(false)
  const [runtimeSettingsSaving, setRuntimeSettingsSaving] = useState(false)
  const [mcpSettingsSaving, setMcpSettingsSaving] = useState(false)
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [messageQueue, setMessageQueue] = useState<WorkspaceSessionChatDraftMessage[]>([])
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [executorMenuOpen, setExecutorMenuOpen] = useState(false)
  const [preflightOpen, setPreflightOpen] = useState(false)
  const [pendingMessage, setPendingMessage] = useState('')
  const [pendingAgentDispatch, setPendingAgentDispatch] = useState<PendingAgentDispatch | null>(null)
  const [availableAgents, setAvailableAgents] = useState<AgentRecord[]>([])
  const [delegateOpen, setDelegateOpen] = useState(false)
  const [delegateAgentId, setDelegateAgentId] = useState('')
  const [delegatePrompt, setDelegatePrompt] = useState('')
  const [delegateSessionRole, setDelegateSessionRole] = useState<WorkspaceSessionRole>('general')
  const [composerCaret, setComposerCaret] = useState(0)
  const [preflightAgentType, setPreflightAgentType] = useState<Task['agentType']>(scopedRuntimeConfig.agentType)
  const [preflightModel, setPreflightModel] = useState(scopedRuntimeConfig.executionModel)
  const [preflightRuntimeSettings, setPreflightRuntimeSettings] = useState<AgentRuntimeSettings>(() => {
    return resolveTaskChatRuntimeSettings(scopedRuntimeConfig.agentType, agentSettings, scopedAgentSettings)
  })
  const [preflightMcpServerIds, setPreflightMcpServerIds] = useState<string[]>(() => {
    return resolveTaskChatMcpServerSelection(
      (mcpServers ?? []).filter((server) => server.enabled),
      scopedEnabledMcpServerIds,
    )
  })
  const [preflightExecutorId, setPreflightExecutorId] = useState(() => selectedExecutorId.trim())
  const [preflightSaving, setPreflightSaving] = useState(false)
  const [socketStatus, setSocketStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('closed')
  const [conversationMessages, setConversationMessages] = useState<ConversationMessageRecord[]>(() => {
    return initialCachedConversation?.messages ?? []
  })
  const [conversationHasMoreBefore, setConversationHasMoreBefore] = useState(() => Boolean(initialCachedConversation?.hasMoreBefore))
  const [conversationLoaded, setConversationLoaded] = useState(() => Boolean(initialCachedConversation))
  const [historyHasMoreBefore, setHistoryHasMoreBefore] = useState(false)
  const [initialTranscriptReady, setInitialTranscriptReady] = useState(false)
  const [timeline, setTimeline] = useState<ChatTimelineEvent[]>([])
  const [turnUsageById, setTurnUsageById] = useState<Record<string, ModelTokenUsage>>({})
  const [mentionSkillsRequested, setMentionSkillsRequested] = useState(false)

  const {
    autoScrollToBottom,
    isSelectionGestureActive,
    resumeAutoScroll,
    scrollRef,
    scrollShortcutTarget,
    scrollToTop,
    scrollToBottom,
    showJumpToBottom,
    updateStickiness,
  } = useSmoothAutoScroll({ threshold: 48 })
  const { skills: mentionSkills, loading: mentionSkillsLoading } = useAvailableSkills(task.projectId, {
    enabled: mentionSkillsRequested,
    workspaceId: workspaceId || undefined,
  })

  const queuedMessages = useMemo(() => {
    return filterQueuedMessagesAlreadyInConversation(
      chatSession?.queue.items ?? [],
      conversationMessages,
      timeline,
    )
  }, [chatSession?.queue.items, conversationMessages, timeline])
  const chatSocketRef = useRef<WebSocket | null>(null)
  const modelMenuPreferencesRef = useRef(modelMenuPreferences)
  // Tracks the chat scope selectedModel was last seeded for, so we only re-seed on an
  // actual scope change (not when the same session's executionModel echoes back mid-run).
  const seededModelScopeRef = useRef(chatScopeKey)
  const taskRef = useRef(task)
  const onTaskUpdateRef = useRef(onTaskUpdate)
  const messageScopeRef = useRef(`${task.id}:${workspaceId || 'default'}:${workspaceSessionId || 'latest'}`)
  const conversationCountRef = useRef<number | null>(null)
  const conversationMessagesRef = useRef(initialCachedConversation?.messages ?? [])
  const conversationHasMoreBeforeRef = useRef(Boolean(initialCachedConversation?.hasMoreBefore))
  const socketLastEventIdRef = useRef<string | null>(null)
  const historyLastSessionSeqRef = useRef(0)
  const liveSessionRevisionRef = useRef(0)
  const injectedTesterContextIdsRef = useRef<string[]>([])

  const derived = useTaskChatDerivedState({
    agentSaving,
    availableAgents,
    chatSession,
    composerCaret,
    conversationMessages,
    defaultModel,
    delegateAgentId,
    delegateSessionRole,
    effectiveExecutorId,
    executorSaving,
    executors,
    images,
    injectedTesterContextIdsRef,
    input,
    isSendingMessage,
    liveStatus,
    liveStep,
    liveTools,
    mcpServers,
    mcpSettingsSaving,
    modelLoading,
    modelMenuPreferences,
    modelOptions,
    modelSaving,
    preflightAgentType,
    preflightExecutorId,
    preflightModel,
    preflightOpen,
    preparingWorkspace,
    project,
    queuedMessages,
    runtimeSettingsSaving,
    selectedAgentType,
    selectedModel,
    setComposerCaret,
    setInput,
    socketStatus,
    task,
    timeline,
    workspaceId,
    workspaceSessionId,
  })

  const resetTimeline = useCallback(() => {
    setTimeline([])
  }, [])

  const syncLocalMountedMcpServerNames = useCallback((selectedIds: string[]) => {
    const selectedSet = new Set(selectedIds)
    setChatSession((current) => current ? {
      ...current,
      runtime: {
        ...current.runtime,
        mountedMcpServerNames: derived.availableMcpServers
          .filter((server) => selectedSet.has(server.id))
          .map((server) => server.name),
      },
    } : current)
  }, [derived.availableMcpServers])

  useEffect(() => {
    const cachedConversation = getCachedTaskConversation(task.id, workspaceId, workspaceSessionId)
    conversationMessagesRef.current = cachedConversation?.messages ?? []
    setConversationHasMoreBefore(Boolean(cachedConversation?.hasMoreBefore))
    setHistoryHasMoreBefore(false)
    setCurrentRunTiming(null)
    setTurnUsageById({})
    historyLastSessionSeqRef.current = 0
    conversationHasMoreBeforeRef.current = Boolean(cachedConversation?.hasMoreBefore)
  }, [task.id, workspaceId, workspaceSessionId])

  useEffect(() => {
    conversationMessagesRef.current = conversationMessages
  }, [conversationMessages])

  useEffect(() => {
    conversationHasMoreBeforeRef.current = conversationHasMoreBefore
  }, [conversationHasMoreBefore])

  useEffect(() => {
    if (!mentionSkillsRequested && /(^|\s)@[\w-]*$/i.test(input)) {
      setMentionSkillsRequested(true)
    }
  }, [input, mentionSkillsRequested])

  useEffect(() => {
    const cachedComposer = getCachedTaskChatComposer(task.id, workspaceId, workspaceSessionId)
    setInput(initialInput.trim() || cachedComposer?.input || '')
    setInputHistory(cachedComposer?.history ?? [])
    setInputHistoryIndex(null)
    setInputHistoryDraft('')
    setImages(cachedComposer?.images ?? [])
    setSelectedContextRefs(cachedComposer?.contextRefs ?? [])
    setSelectedExecutorId(persistedExecutorId)
  }, [chatScopeKey, initialInput, persistedExecutorId, task.id, workspaceId, workspaceSessionId])

  const sessionSync = useTaskChatSessionSync({
    applyCachedSession: initialCachedSession,
    autoScrollToBottom,
    chatSession,
    chatSocketRef,
    conversationCountRef,
    conversationLoaded,
    conversationMessages,
    conversationMessagesRef,
    displayStatus: derived.displayStatus,
    displayStep: derived.displayStep,
    displayTimeline: derived.displayTimeline,
    historyLastSessionSeqRef,
    injectedTesterContextIdsRef,
    isSessionBusy: derived.isSessionBusy,
    liveSessionRevisionRef,
    messageScopeRef,
    modelAgentType: derived.modelAgentType,
    modelExecutorId: derived.modelExecutorId,
    noticesLength: notices.length,
    onTaskUpdate,
    onTaskUpdateRef,
    onWorkspaceSessionChange,
    open,
    preflightOpen,
    queuedMessagesLength: queuedMessages.length,
    resetTimeline,
    resumeAutoScroll,
    scrollToBottom,
    setAvailableAgents,
    setChatSession,
    setConversationHasMoreBefore,
    setConversationLoaded,
    setConversationMessages,
    setDefaultModel,
    setHistoryHasMoreBefore,
    setInitialTranscriptReady,
    workspaceSessionInitialHistoryLimit: WORKSPACE_SESSION_INITIAL_HISTORY_PAGE_SIZE,
    setLiveStatus,
    setLiveStep,
    setLiveTools,
    setModelLoading,
    setModelOptions,
    setNotices,
    setPreflightModel,
    setSocketStatus,
    setTimeline,
    socketLastEventIdRef,
    socketStatus,
    systemLogsLength: derived.systemLogs.length,
    task,
    taskRef,
    workspaceId,
    workspaceSession,
    workspaceSessionId,
  })

  const displayTimeline = useMemo(() => {
    return derived.displayTimeline.map((turn) => (
      turnUsageById[turn.id]
        ? { ...turn, usage: turnUsageById[turn.id] }
        : turn
    ))
  }, [derived.displayTimeline, turnUsageById])

  const outlineItems = useMemo(() => {
    return mergeTaskChatOutlineItems([], mapDisplayTimelineToOutlineItems(displayTimeline))
  }, [displayTimeline])
  const historyState = useTaskChatHistoryState({
    conversationHasMoreBefore,
    conversationMessagesLength: conversationMessages.length,
    conversationMessagesRef,
    historyHasMoreBefore,
    scrollRef,
    sessionSync,
    setConversationHasMoreBefore,
    setConversationLoaded,
    setConversationMessages,
    setHistoryHasMoreBefore,
    taskId: task.id,
    timeline,
    workspaceId,
    workspaceSessionId,
  })

  useEffect(() => {
    if (!initialInput.trim()) {
      return
    }

    setInput(initialInput)
    setInputHistoryIndex(null)
    setInputHistoryDraft('')
  }, [initialInput])

  useEffect(() => {
    const persistedImages = images
      .filter((image) => image.uploadState !== 'uploading' && image.uploadState !== 'failed')
      .map((image) => ({
        id: image.id,
        url: image.url,
        filename: image.filename,
        contentType: image.contentType,
      }))

    setCachedTaskChatComposer(task.id, workspaceId, workspaceSessionId, {
      input,
      history: inputHistory,
      images: persistedImages,
      contextRefs: selectedContextRefs,
    })
  }, [images, input, inputHistory, selectedContextRefs, task.id, workspaceId, workspaceSessionId])

  useEffect(() => {
    setSelectedAgentType(scopedRuntimeConfig.agentType)
  }, [scopedRuntimeConfig.agentType, task.id])

  useEffect(() => {
    // Seed selectedModel from the persisted session model ONLY when the chat scope changes
    // (switching workspace session / task). We intentionally do NOT depend on
    // scopedRuntimeConfig.executionModel: within one scope, runtime snapshots (thinking →
    // executing → complete) re-emit the session and would otherwise reset the footer label
    // mid-run. User model changes go through handleModelChange, which sets selectedModel and
    // persists it — so local state and the server converge without this effect fighting them.
    if (seededModelScopeRef.current === chatScopeKey) {
      return
    }

    seededModelScopeRef.current = chatScopeKey
    setSelectedModel(scopedRuntimeConfig.executionModel)
  }, [chatScopeKey, scopedRuntimeConfig.executionModel])

  useEffect(() => {
    setSelectedRuntimeSettings(resolveTaskChatRuntimeSettings(
      scopedRuntimeConfig.agentType,
      agentSettings,
      scopedAgentSettings,
    ))
  }, [agentSettings, globalAgentSettingsKey, scopedAgentSettings, scopedAgentSettingsKey, scopedRuntimeConfig.agentType, task.id])

  useEffect(() => {
    setSelectedMcpServerIds(resolveTaskChatMcpServerSelection(derived.availableMcpServers, scopedEnabledMcpServerIds))
  }, [derived.availableMcpServers, scopedEnabledMcpServerIds, scopedEnabledMcpServerIdsKey, task.id])

  useEffect(() => {
    setPreflightAgentType(scopedRuntimeConfig.agentType)
  }, [scopedRuntimeConfig.agentType, task.id])

  useEffect(() => {
    setPreflightModel(scopedRuntimeConfig.executionModel)
  }, [scopedRuntimeConfig.executionModel, task.id])

  useEffect(() => {
    setPreflightRuntimeSettings(resolveTaskChatRuntimeSettings(
      preflightAgentType,
      agentSettings,
      preflightAgentType === scopedRuntimeConfig.agentType ? scopedAgentSettings : undefined,
    ))
  }, [
    agentSettings,
    globalAgentSettingsKey,
    preflightAgentType,
    scopedAgentSettings,
    scopedAgentSettingsKey,
    scopedRuntimeConfig.agentType,
    task.id,
  ])

  useEffect(() => {
    setPreflightMcpServerIds(resolveTaskChatMcpServerSelection(derived.availableMcpServers, scopedEnabledMcpServerIds))
  }, [derived.availableMcpServers, scopedEnabledMcpServerIds, scopedEnabledMcpServerIdsKey, task.id])

  useEffect(() => {
    setPreflightExecutorId(effectiveExecutorId)
  }, [effectiveExecutorId, task.id])

  useEffect(() => {
    if (!delegateOpen) {
      return
    }

    if (!delegateAgentId && derived.delegateOptions.length > 0) {
      setDelegateAgentId(derived.delegateOptions[0].value)
    }
  }, [delegateAgentId, delegateOpen, derived.delegateOptions])

  useEffect(() => {
    if (!delegateOpen) {
      return
    }

    setDelegateSessionRole(resolveDefaultSubAgentSessionRole(derived.selectedDelegateAgent))
    setDelegatePrompt((current) => current.trim() ? current : resolveDefaultDelegatePrompt(derived.selectedDelegateAgent))
  }, [delegateOpen, derived.selectedDelegateAgent])

  useEffect(() => {
    if (!currentRunTiming || currentRunTiming.finishedAt || derived.isSessionBusy) {
      return
    }

    const currentTurn = displayTimeline.find((turn) => turn.isCurrent)
    if (!currentTurn || currentTurn.id !== currentRunTiming.turnId) {
      return
    }

    setCurrentRunTiming((current) => {
      if (!current || current.turnId !== currentTurn.id || current.finishedAt) {
        return current
      }

      return {
        ...current,
        finishedAt: currentTurn.status?.ts ?? new Date().toISOString(),
      }
    })
  }, [currentRunTiming, displayTimeline, derived.isSessionBusy])

  useEffect(() => {
    if (!derived.isSessionBusy) {
      return
    }

    const currentTurn = displayTimeline.find((turn) => turn.isCurrent)
    if (!currentTurn) {
      return
    }

    const startedAt = currentTurn.user?.ts
      ?? currentTurn.status?.ts
      ?? currentTurn.entries.find((entry) => entry.kind === 'tool')?.tool.startedAt

    if (!startedAt) {
      return
    }

    setCurrentRunTiming((current) => {
      if (current?.turnId === currentTurn.id && !current.finishedAt) {
        return current
      }

      return {
        turnId: currentTurn.id,
        startedAt,
      }
    })
  }, [displayTimeline, derived.isSessionBusy])

  const resetComposerHistoryNavigation = useCallback(() => {
    setInputHistoryIndex(null)
    setInputHistoryDraft('')
  }, [])

  const rememberComposerHistory = useCallback((value: string) => {
    const normalized = value.trim()
    if (!normalized) {
      return
    }

    setInputHistory((current) => {
      const next = [...current.filter((entry) => entry !== normalized), normalized]
      return next.slice(-TASK_CHAT_COMPOSER_HISTORY_LIMIT)
    })
    setInputHistoryIndex(null)
    setInputHistoryDraft('')
  }, [])

  const rememberWorkspaceSessionModelMenuSelection = useCallback((modelId: string) => {
    const normalizedModelId = modelId.trim()
    if (!normalizedModelId) {
      return
    }

    const matchedModel = modelOptions.find((model) => model.id === normalizedModelId)
    if (!matchedModel) {
      return
    }

    const nextPreferences = recordWorkspaceSessionModelMenuSelection(
      modelMenuPreferencesRef.current,
      matchedModel,
    )
    if (nextPreferences === modelMenuPreferencesRef.current) {
      return
    }

    modelMenuPreferencesRef.current = nextPreferences
    setModelMenuPreferences(nextPreferences)
    writeWorkspaceSessionModelMenuPreferences(nextPreferences)
  }, [modelOptions])

  const markLiveSessionRevision = useCallback(() => {
    liveSessionRevisionRef.current += 1
  }, [liveSessionRevisionRef])

  const navigateComposerHistory = useCallback((direction: 'prev' | 'next') => {
    if (inputHistory.length === 0) {
      return
    }

    if (direction === 'prev') {
      if (inputHistoryIndex === null) {
        setInputHistoryDraft(input)
        setInputHistoryIndex(inputHistory.length - 1)
        setInput(inputHistory[inputHistory.length - 1] ?? '')
        return
      }

      const nextIndex = Math.max(0, inputHistoryIndex - 1)
      setInputHistoryIndex(nextIndex)
      setInput(inputHistory[nextIndex] ?? '')
      return
    }

    if (inputHistoryIndex === null) {
      return
    }

    if (inputHistoryIndex >= inputHistory.length - 1) {
      setInputHistoryIndex(null)
      setInput(inputHistoryDraft)
      return
    }

    const nextIndex = inputHistoryIndex + 1
    setInputHistoryIndex(nextIndex)
    setInput(inputHistory[nextIndex] ?? '')
  }, [input, inputHistory, inputHistoryDraft, inputHistoryIndex])

  return {
    agentMenuOpen,
    agentSaving,
    availableMcpServers: derived.availableMcpServers,
    boundCustomAgentMode: derived.boundCustomAgentMode,
    boundCustomAgentName: derived.boundCustomAgentName,
    canAssignExecutor: derived.canAssignExecutor,
    canConfirmPreflight: derived.canConfirmPreflight,
    chatSession,
    conversationHasMoreBefore,
    currentRunTiming,
    ensureOutlineItemVisible: historyState.ensureOutlineItemVisible,
    historyHasMoreBefore,
    loadOlderTranscriptPage: historyState.loadOlderTranscriptPage,
    loadingOlderHistory: historyState.loadingOlderHistory,
    loadingOlderConversation: historyState.loadingOlderConversation,
    composerCaret,
    defaultModel,
    delegateAgentId,
    delegateOpen,
    delegateOptions: derived.delegateOptions,
    delegatePrompt,
    delegatePromptHint: derived.delegatePromptHint,
    delegatePromptPlaceholder: derived.delegatePromptPlaceholder,
    delegateSessionRole,
    delegateUnavailableAgentItems: derived.delegateUnavailableAgentItems,
    displayStatus: derived.displayStatus,
    displayStep: derived.displayStep,
    displayTimeline,
    effectiveExecutorId,
    effectiveModel: derived.effectiveModel,
    effectivePreflightModel: derived.effectivePreflightModel,
    executorCards: derived.executorCards,
    executorMenuOpen,
    executorSaving,
    groupedModelOptions: derived.groupedModelOptions,
    isWorkspaceHistoryMode: Boolean(workspaceId && workspaceSessionId),
    hasUnavailableSelectedModel: derived.hasUnavailableSelectedModel,
    images,
    input,
    insertAgentMention: derived.insertAgentMention,
    initialTranscriptReady,
    isSelectionGestureActive,
    isCurrentChatScope: derived.isCurrentChatScope,
    isSessionBusy: derived.isSessionBusy,
    isSocketOpen: derived.isSocketOpen,
    isSendingMessage,
    isSubagentSession: derived.isSubagentSession,
    isTesterSubagentSession: derived.isTesterSubagentSession,
    isUploading,
    liveBadgeTone: derived.liveBadgeTone,
    markLiveSessionRevision,
    markTesterContextInjected: derived.markTesterContextInjected,
    mcpSettingsSaving,
    maybeInjectTesterLogContext: derived.maybeInjectTesterLogContext,
    mentionAvailableOptions: derived.mentionAvailableOptions,
    mentionQuery: derived.mentionQuery,
    mentionSkills,
    mentionSkillsLoading,
    requestMentionSkills: () => setMentionSkillsRequested(true),
    mentionUnavailableAgentItems: derived.mentionUnavailableAgentItems,
    mentionedAgents: derived.mentionedAgents,
    messageQueue,
    modelDisabled: derived.modelDisabled,
    modelLoading,
    modelMenuOpen,
    modelMeta: derived.modelMeta,
    modelOptions,
    modelSaving,
    modelSummary: derived.modelSummary,
    modelSummaryHint: derived.modelSummaryHint,
    modelSummaryTitle: derived.modelSummaryTitle,
    mountedMcpServerNames: derived.mountedMcpServerNames,
    mountedSkillNames: derived.mountedSkillNames,
    notices,
    notifySocketIssue: sessionSync.notifySocketIssue,
    outlineItems,
    pendingAgentDispatch,
    pendingMessage,
    persistedExecutorId,
    preflightAgentType,
    preflightExecutorId,
    preflightMcpServerIds,
    preflightModel,
    preflightOpen,
    preflightRequiresModelSelection: derived.preflightRequiresModelSelection,
    preflightRuntimeSettings,
    preflightSaving,
    queueStatusMessage: derived.queueStatusMessage,
    queuePending: derived.queuePending,
    queuedMessages,
    refreshSessionView: sessionSync.refreshSessionView,
    requiresExecutorSelection: derived.requiresExecutorSelection,
    requiresModelSelection: derived.requiresModelSelection,
    resumeAutoScroll,
    rememberComposerHistory,
    rememberWorkspaceSessionModelMenuSelection,
    resetComposerHistoryNavigation,
    runtimeSettingsDisabled: derived.runtimeSettingsDisabled,
    runtimeSettingsSaving,
    scrollRef,
    scrollToBottom,
    selectedAgentType,
    selectedContextRefs,
    selectedDelegateAgent: derived.selectedDelegateAgent,
    selectedDelegateSummary: derived.selectedDelegateSummary,
    selectedExecutorId,
    selectedMcpServerIds,
    selectedModel,
    selectedRuntimeSettings,
    sendDisabled: derived.sendDisabled,
    sendSocketMessage: sessionSync.sendSocketMessage,
    sendSocketMessageWithAck: sessionSync.sendSocketMessageWithAck,
    sessionQueued: derived.sessionQueued,
    sessionRoleLabel: derived.sessionRoleLabel,
    setAgentMenuOpen,
    setAgentSaving,
    setChatSession,
    setConversationHasMoreBefore,
    setConversationMessages,
    setCurrentRunTiming,
    setSelectedContextRefs,
    setHistoryHasMoreBefore,
    setTimeline,
    setDefaultModel,
    setDelegateAgentId,
    setDelegateOpen,
    setDelegatePrompt,
    setDelegateSessionRole,
    setExecutorMenuOpen,
    setExecutorSaving,
    setImages,
    setInput,
    setIsUploading,
    setIsSendingMessage,
    setLiveStatus,
    setLiveStep,
    setLiveTools,
    setMcpSettingsSaving,
    setMessageQueue,
    setModelLoading,
    setModelMenuOpen,
    setModelOptions,
    setModelSaving,
    setNotices,
    setPendingAgentDispatch,
    setPendingMessage,
    setPreflightAgentType,
    setPreflightExecutorId,
    setPreflightMcpServerIds,
    setPreflightModel,
    setPreflightOpen,
    setPreflightRuntimeSettings,
    setPreflightSaving,
    setRuntimeSettingsSaving,
    setComposerCaret,
    setSelectedExecutorId,
    setSelectedAgentType,
    setSelectedMcpServerIds,
    setSelectedModel,
    setSelectedRuntimeSettings,
    shouldOpenModelField: derived.shouldOpenModelField,
    scrollShortcutTarget,
    scrollToTop,
    showJumpToBottom,
    socketStatus,
    syncLocalMountedMcpServerNames,
    syncScopedTaskFromState: sessionSync.syncScopedTaskFromState,
    syncTaskRuntime: sessionSync.syncTaskRuntime,
    systemLogs: derived.systemLogs,
    unseenTesterObservationMessages: derived.unseenTesterObservationMessages,
    unseenTesterSystemLogs: derived.unseenTesterSystemLogs,
    navigateComposerHistory,
    updateComposerCaret: derived.updateComposerCaret,
    updateStickiness,
    visibleMessages: derived.visibleMessages,
    visibleSelectedModel: derived.visibleSelectedModel,
    visibleTools: derived.visibleTools,
  }
}
