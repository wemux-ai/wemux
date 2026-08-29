import { normalizeAgentConfig } from '@shared/agent-config'
import { normalizeMainChatSessionState } from '@shared/main-chat-session'
import { initialState } from '../data/mock'
import { createAdapters, createExecutionCenter, createOrchestration, createValidationChecks } from './orchestrator'
import { safeLocalStorageSetItem } from './browser-storage'
import type { AppState } from '@shared/types'

const STORAGE_KEY = 'vibemux-state'
const LEGACY_STORAGE_KEY = 'devagent-mvp-state'
const CREATE_TASK_DRAFT_KEY_PREFIX = 'vibemux-create-task-draft'
const LEGACY_CREATE_TASK_DRAFT_KEY_PREFIX = 'devagent-create-task-draft'
const MAX_PERSISTED_CREATE_TASK_TITLE_LENGTH = 4_000
const MAX_PERSISTED_CREATE_TASK_TEXT_LENGTH = 128_000

export type CreateTaskDraftRecord = {
  savedAt: string
  projectId: string
  title: string
  description: string
  acceptanceCriteria: string
  requirementType: 'task' | 'requirement'
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  assigneeId: string
  startedAt?: string
  dueAt?: string
}

const normalizeCreateTaskDraftScope = (draftScope?: string) => draftScope?.trim() || ''

const getCreateTaskDraftMemoryKey = (projectId: string, draftScope?: string) => {
  const normalizedScope = normalizeCreateTaskDraftScope(draftScope)
  return normalizedScope ? `${projectId}:${normalizedScope}` : projectId
}

const getCreateTaskDraftKey = (projectId: string, draftScope?: string) => `${CREATE_TASK_DRAFT_KEY_PREFIX}:${getCreateTaskDraftMemoryKey(projectId, draftScope)}`

const getLegacyCreateTaskDraftKey = (projectId: string) => `${LEGACY_CREATE_TASK_DRAFT_KEY_PREFIX}:${projectId}`
const createTaskDraftMemoryStore = new Map<string, CreateTaskDraftRecord>()

const normalizeTaskPriority = (priority: string | undefined) => {
  if (priority === 'none' || priority === 'low' || priority === 'high' || priority === 'urgent') {
    return priority
  }

  return 'medium' as const
}

const truncatePersistedText = (value: string, maxLength: number) => {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

const hasCreateTaskDraftContent = (
  parsed: Partial<CreateTaskDraftRecord> & { draftId?: string },
) => {
  return Boolean(
    typeof parsed.title === 'string'
    || typeof parsed.description === 'string'
    || typeof parsed.acceptanceCriteria === 'string'
    || typeof parsed.assigneeId === 'string'
    || typeof parsed.startedAt === 'string'
    || typeof parsed.dueAt === 'string'
    || parsed.requirementType === 'requirement'
    || parsed.priority === 'none'
    || parsed.priority === 'low'
    || parsed.priority === 'high'
    || parsed.priority === 'urgent',
  )
}

const normalizeCreateTaskDraftRecord = (
  projectId: string,
  parsed: Partial<CreateTaskDraftRecord> & { draftId?: string },
) => {
  if (!parsed || typeof parsed !== 'object' || !hasCreateTaskDraftContent(parsed)) {
    return null
  }

  return {
    savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    projectId,
    title: typeof parsed.title === 'string' ? parsed.title : '',
    description: typeof parsed.description === 'string' ? parsed.description : '',
    acceptanceCriteria: typeof parsed.acceptanceCriteria === 'string' ? parsed.acceptanceCriteria : '',
    requirementType: parsed.requirementType === 'requirement' ? 'requirement' : 'task',
    priority: parsed.priority === 'low' || parsed.priority === 'medium' || parsed.priority === 'high' || parsed.priority === 'urgent' ? parsed.priority : 'none',
    assigneeId: typeof parsed.assigneeId === 'string' ? parsed.assigneeId : '',
    startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
    dueAt: typeof parsed.dueAt === 'string' ? parsed.dueAt : '',
  } satisfies CreateTaskDraftRecord
}

const serializeCreateTaskDraftForStorage = (draft: CreateTaskDraftRecord) => {
  return JSON.stringify({
    ...draft,
    title: truncatePersistedText(draft.title, MAX_PERSISTED_CREATE_TASK_TITLE_LENGTH),
    description: truncatePersistedText(draft.description, MAX_PERSISTED_CREATE_TASK_TEXT_LENGTH),
    acceptanceCriteria: truncatePersistedText(draft.acceptanceCriteria, MAX_PERSISTED_CREATE_TASK_TEXT_LENGTH),
  } satisfies CreateTaskDraftRecord)
}

const normalizeTask = (task: AppState['tasks'][number]): AppState['tasks'][number] => ({
  ...task,
  priority: normalizeTaskPriority(task.priority),
  needsHumanConfirm: task.needsHumanConfirm ?? false,
  executionHistory: task.executionHistory ?? [],
  comments: task.comments ?? [],
  orchestration: task.orchestration ?? createOrchestration(),
  validationChecks: task.validationChecks ?? createValidationChecks(),
})

const normalizeState = (value: Partial<AppState>): AppState => normalizeMainChatSessionState({
  ...initialState,
  ...value,
  filters: {
    ...initialState.filters,
    ...value.filters,
  },
  config: {
    ...normalizeAgentConfig({
      ...initialState.config,
      ...value.config,
    }),
  },
  projects: value.projects ?? initialState.projects,
  tasks: value.tasks ? value.tasks.map(normalizeTask) : initialState.tasks,
  mainChatSessions: value.mainChatSessions ?? initialState.mainChatSessions,
  selectedMainChatSessionId: value.selectedMainChatSessionId ?? initialState.selectedMainChatSessionId,
  adapters: value.adapters ?? createAdapters(),
  executionCenter: value.executionCenter ?? createExecutionCenter(value.tasks ? value.tasks.map(normalizeTask) : initialState.tasks),
})

export const loadState = (): AppState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) {
      return initialState
    }

    return normalizeState(JSON.parse(raw) as Partial<AppState>)
  } catch {
    return initialState
  }
}

export const saveState = (state: AppState) => {
  safeLocalStorageSetItem(STORAGE_KEY, JSON.stringify(state), {
    clearRecoverableLocalStorageOnQuota: true,
  })
}

export const loadCreateTaskDraft = (projectId: string, draftScope?: string): CreateTaskDraftRecord | null => {
  if (!projectId) {
    return null
  }

  const memoryKey = getCreateTaskDraftMemoryKey(projectId, draftScope)
  const memoryDraft = createTaskDraftMemoryStore.get(memoryKey)
  if (memoryDraft) {
    return memoryDraft
  }

  try {
    const raw = localStorage.getItem(getCreateTaskDraftKey(projectId, draftScope))
      || (!normalizeCreateTaskDraftScope(draftScope) ? localStorage.getItem(getLegacyCreateTaskDraftKey(projectId)) : null)
    if (!raw) {
      return null
    }

    const normalizedDraft = normalizeCreateTaskDraftRecord(projectId, JSON.parse(raw) as Partial<CreateTaskDraftRecord> & {
      draftId?: string
    })
    if (!normalizedDraft) {
      return null
    }

    createTaskDraftMemoryStore.set(memoryKey, normalizedDraft)
    return normalizedDraft
  } catch {
    return null
  }
}

export const saveCreateTaskDraft = (projectId: string, draft: Omit<CreateTaskDraftRecord, 'savedAt' | 'projectId'>, draftScope?: string) => {
  if (!projectId) {
    return
  }

  const nextDraft = {
    ...draft,
    projectId,
    savedAt: new Date().toISOString(),
  } satisfies CreateTaskDraftRecord

  createTaskDraftMemoryStore.set(getCreateTaskDraftMemoryKey(projectId, draftScope), nextDraft)
  safeLocalStorageSetItem(
    getCreateTaskDraftKey(projectId, draftScope),
    serializeCreateTaskDraftForStorage(nextDraft),
    { clearRecoverableLocalStorageOnQuota: true },
  )
}

export const clearCreateTaskDraft = (projectId: string, draftScope?: string) => {
  if (!projectId) {
    return
  }

  createTaskDraftMemoryStore.delete(getCreateTaskDraftMemoryKey(projectId, draftScope))

  try {
    localStorage.removeItem(getCreateTaskDraftKey(projectId, draftScope))
    if (!normalizeCreateTaskDraftScope(draftScope)) {
      localStorage.removeItem(getLegacyCreateTaskDraftKey(projectId))
    }
  } catch {
    // Ignore storage cleanup failures so the modal can still reset itself.
  }
}
