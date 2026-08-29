import { useCallback, useEffect, useRef, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'
import { Store } from '@tanstack/react-store'

export type WorkspacePanelName = 'files' | 'git' | 'preview' | 'records' | 'desktop' | 'terminal'

type WorkspaceFilesPanelUiState = {
  expandedDirectories: string[]
  selectedFilePath: string
  fileSearchQuery: string
  contentSearchQuery: string
  editMode: boolean
  editorContent: string
  lastSavedContent: string
  scrollTopByRegion: Record<string, number>
}

type WorkspaceGitPanelUiState = {
  activeTab: 'diff' | 'graph' | 'commit-diff'
  graphLimit: 20 | 40 | 80 | 120
  selectedGraphCommitSha: string
}

type WorkspacePreviewPanelUiState = {
  selectedPreviewSourceAppUrl: string
  viewportMode: 'desktop' | 'tablet' | 'mobile'
  viewportOrientation: 'portrait' | 'landscape'
  previewPath: string
  previewAddressDraft: string
  previewNavigationHistory: string[]
  previewNavigationHistoryIndex: number
  transportPreference: 'auto' | 'local-direct' | 'public-direct' | 'mesh-bridge' | 'gateway' | 'tunnel'
}

type WorkspacePanelUiStateByPanel = {
  files: WorkspaceFilesPanelUiState
  git: WorkspaceGitPanelUiState
  preview: WorkspacePreviewPanelUiState
  records: Record<string, unknown>
  desktop: Record<string, unknown>
  terminal: Record<string, unknown>
}

type WorkspacePanelUiEntry = {
  lastActiveAt: number
  panelState: Partial<WorkspacePanelUiStateByPanel>
}

type WorkspacePanelUiStoreState = {
  entriesByScopeKey: Record<string, WorkspacePanelUiEntry>
}

const MAX_WORKSPACE_PANEL_UI_SCOPES = 64
const EMPTY_PANEL_STATE = {} as const

const workspacePanelUiStore = new Store<WorkspacePanelUiStoreState>({
  entriesByScopeKey: {},
})

export const buildWorkspacePanelUiScopeKey = (params: {
  workspaceId?: string
  workspaceSessionId?: string
  panel: WorkspacePanelName
}) => JSON.stringify([
  params.workspaceId?.trim() || 'workspace',
  params.workspaceSessionId?.trim() || 'workspace-session',
  params.panel,
])

const evictWorkspacePanelUiScopes = (
  entriesByScopeKey: Record<string, WorkspacePanelUiEntry>,
) => {
  const entries = Object.entries(entriesByScopeKey)
  if (entries.length <= MAX_WORKSPACE_PANEL_UI_SCOPES) {
    return entriesByScopeKey
  }

  return Object.fromEntries(
    entries
      .sort(([, left], [, right]) => right.lastActiveAt - left.lastActiveAt)
      .slice(0, MAX_WORKSPACE_PANEL_UI_SCOPES),
  )
}

export const readWorkspacePanelUiState = <TPanel extends WorkspacePanelName>(
  scopeKey: string,
  panel: TPanel,
) => workspacePanelUiStore.state.entriesByScopeKey[scopeKey]?.panelState[panel]

export const updateWorkspacePanelUiState = <TPanel extends WorkspacePanelName>(
  scopeKey: string,
  panel: TPanel,
  nextValue: SetStateAction<WorkspacePanelUiStateByPanel[TPanel]>,
) => {
  if (!scopeKey) {
    return
  }

  workspacePanelUiStore.setState((current) => {
    const currentEntry = current.entriesByScopeKey[scopeKey]
    const currentPanelState = (currentEntry?.panelState[panel] ?? EMPTY_PANEL_STATE) as WorkspacePanelUiStateByPanel[TPanel]
    const nextPanelState = typeof nextValue === 'function'
      ? (nextValue as (value: WorkspacePanelUiStateByPanel[TPanel]) => WorkspacePanelUiStateByPanel[TPanel])(currentPanelState)
      : nextValue
    if (Object.is(nextPanelState, currentPanelState)) {
      return current
    }
    const entriesByScopeKey = {
      ...current.entriesByScopeKey,
      [scopeKey]: {
        lastActiveAt: Date.now(),
        panelState: {
          ...(currentEntry?.panelState ?? {}),
          [panel]: nextPanelState,
        },
      },
    }

    return {
      entriesByScopeKey: evictWorkspacePanelUiScopes(entriesByScopeKey),
    }
  })
}

export const useWorkspacePanelUiField = <
  TPanel extends WorkspacePanelName,
  TField extends keyof WorkspacePanelUiStateByPanel[TPanel],
>(
  scopeKey: string,
  panel: TPanel,
  field: TField,
  initialValue: WorkspacePanelUiStateByPanel[TPanel][TField],
): [WorkspacePanelUiStateByPanel[TPanel][TField], Dispatch<SetStateAction<WorkspacePanelUiStateByPanel[TPanel][TField]>>] => {
  const initialValueRef = useRef(initialValue)
  const getSnapshot = () => (
    readWorkspacePanelUiState(scopeKey, panel)?.[field] ?? initialValueRef.current
  )
  const value = useSyncExternalStore(
    (listener) => {
      const subscription = workspacePanelUiStore.subscribe(listener) as unknown as (() => void) | { unsubscribe: () => void }
      return typeof subscription === 'function' ? subscription : () => subscription.unsubscribe()
    },
    getSnapshot,
    getSnapshot,
  )

  useEffect(() => {
    const current = readWorkspacePanelUiState(scopeKey, panel)
    if (!current || !Object.prototype.hasOwnProperty.call(current, field)) {
      updateWorkspacePanelUiState(scopeKey, panel, {
        ...(current ?? {}),
        [field]: initialValueRef.current,
      } as WorkspacePanelUiStateByPanel[TPanel])
    }
  }, [field, panel, scopeKey])

  const setValue: Dispatch<SetStateAction<WorkspacePanelUiStateByPanel[TPanel][TField]>> = useCallback((nextValue) => {
    updateWorkspacePanelUiState(scopeKey, panel, (current) => {
      const currentValue = current[field] ?? initialValueRef.current
      const resolvedValue = typeof nextValue === 'function'
        ? (nextValue as (value: WorkspacePanelUiStateByPanel[TPanel][TField]) => WorkspacePanelUiStateByPanel[TPanel][TField])(currentValue)
        : nextValue
      if (Object.is(resolvedValue, currentValue)) {
        return current
      }
      return {
        ...current,
        [field]: resolvedValue,
      }
    })
  }, [field, panel, scopeKey])

  return [value, setValue]
}

export const resetWorkspacePanelUiStoreForTests = () => {
  workspacePanelUiStore.setState(() => ({ entriesByScopeKey: {} }))
}
