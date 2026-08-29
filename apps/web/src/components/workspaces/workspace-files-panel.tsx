import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type SetStateAction, type UIEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderTree,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { ExecutorDirectoryBrowseResult, ExecutorFileReadResult } from '@shared/types'
import { api } from '../../lib/api'
import { useTranslation } from '../../lib/i18n/react'
import { workspaceQueryKeys } from '../../lib/workspace-query-keys'
import { getWorkspaceFileParentPath, listWorkspaceAncestorDirectories, normalizeWorkspaceFilePath, pickWorkspaceFileRootPath } from '../../lib/workspace-file-link'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader } from '../ui/card'
import { Input } from '../ui/input'
import { ScrollArea } from '../ui/scroll-area'
import { Textarea } from '../ui/textarea'
import { getFileName } from '../files/file-content-view'
import { WorkspaceFilePreview } from './workspace-file-preview'
import { buildPathLabel, createDirectoryState, TreeStatusRow, type DirectoryStateMap, WorkspaceFileTree } from './workspace-file-tree'
import { buildWorkspacePanelUiScopeKey, useWorkspacePanelUiField } from './workspace-panel-ui-store'
import { useWorkspaceSidePanelHeaderActions } from './workspace-side-panel-header-actions'

type WorkspaceFilesPanelProps = {
  executorId?: string
  initialDirectoryPath?: string
  candidateRootPaths?: string[]
  cacheScopeKey?: string
  uiScopeKey?: string
  openFileRequest?: {
    filePath: string
    requestId: number
  } | null
  className?: string
}

const ROOT_ROW_HEIGHT = 'min-h-8'
const DIRECTORY_CACHE_TTL_MS = 30_000
const FILE_SEARCH_RESULT_LIMIT = 80
const LINE_GUTTER_WIDTH = '4rem'

const normalizeSearchValue = (value: string) => value.trim().toLowerCase()

const countTextMatches = (content: string, query: string) => {
  const normalizedQuery = normalizeSearchValue(query)
  if (!normalizedQuery) {
    return 0
  }

  let count = 0
  let cursor = 0
  const normalizedContent = content.toLowerCase()
  while (cursor < normalizedContent.length) {
    const index = normalizedContent.indexOf(normalizedQuery, cursor)
    if (index < 0) {
      break
    }
    count += 1
    cursor = index + normalizedQuery.length
  }
  return count
}

const collectLoadedFileSearchResults = (
  directoryStates: DirectoryStateMap,
  rootEntries: ExecutorDirectoryBrowseResult['entries'],
  query: string,
) => {
  const normalizedQuery = normalizeSearchValue(query)
  if (!normalizedQuery) {
    return []
  }

  const results = new Map<string, ExecutorDirectoryBrowseResult['entries'][number]>()
  for (const entry of rootEntries) {
    if (entry.name.toLowerCase().includes(normalizedQuery) || entry.path.toLowerCase().includes(normalizedQuery)) {
      results.set(entry.path, entry)
    }
  }

  for (const state of Object.values(directoryStates)) {
    for (const entry of state.entries) {
      if (entry.name.toLowerCase().includes(normalizedQuery) || entry.path.toLowerCase().includes(normalizedQuery)) {
        results.set(entry.path, entry)
      }
    }
  }

  return Array.from(results.values())
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'directory' ? -1 : 1
      }
      return left.path.localeCompare(right.path, 'zh-Hans-CN')
    })
    .slice(0, FILE_SEARCH_RESULT_LIMIT)
}

const resolveNewWorkspaceFilePath = (rootPath: string, value: string) => {
  const normalizedValue = normalizeWorkspaceFilePath(value)
  if (!normalizedValue) {
    return ''
  }

  if (normalizedValue.startsWith('/') || /^[A-Za-z]:\//.test(normalizedValue)) {
    return normalizedValue
  }

  const normalizedRootPath = normalizeWorkspaceFilePath(rootPath)
  return normalizeWorkspaceFilePath(`${normalizedRootPath.replace(/\/$/, '')}/${normalizedValue}`)
}

const isEditableFilePreview = (preview: ExecutorFileReadResult | null) => {
  if (!preview?.ok || preview.encoding !== 'utf8' || preview.truncated) {
    return false
  }

  const contentType = preview.contentType?.toLowerCase() || ''
  return !contentType.startsWith('image/')
}

function WorkspaceTextFileEditor({
  value,
  onChange,
  scrollTop,
  onScrollTopChange,
  className,
}: {
  value: string
  onChange: (value: string) => void
  scrollTop: number
  onScrollTopChange: (scrollTop: number) => void
  className?: string
}) {
  const lineGutterRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const lines = useMemo(() => value.replace(/\r\n/g, '\n').split('\n'), [value])

  useEffect(() => {
    if (editorRef.current && editorRef.current.scrollTop !== scrollTop) {
      editorRef.current.scrollTop = scrollTop
      if (lineGutterRef.current) {
        lineGutterRef.current.scrollTop = scrollTop
      }
    }
  }, [scrollTop])

  const handleScroll = useCallback((event: UIEvent<HTMLTextAreaElement>) => {
    if (lineGutterRef.current) {
      lineGutterRef.current.scrollTop = event.currentTarget.scrollTop
    }
    onScrollTopChange(event.currentTarget.scrollTop)
  }, [onScrollTopChange])

  return (
    <div
      className={cn('grid min-h-0 flex-1 grid-cols-[var(--workspace-file-line-gutter)_minmax(0,1fr)] bg-[#090b10] font-mono text-[12px] leading-6 text-zinc-200', className)}
      style={{ '--workspace-file-line-gutter': LINE_GUTTER_WIDTH } as CSSProperties}
    >
      <div
        ref={lineGutterRef}
        aria-hidden
        className="min-h-0 overflow-hidden border-r border-zinc-800/80 bg-[#080a0f] text-zinc-500"
      >
        <div className="py-3">
          {lines.map((line, index) => (
            <div
              key={`${index}:${line.length}`}
              className="select-none px-3 text-right leading-6"
            >
              {index + 1}
            </div>
          ))}
        </div>
      </div>
      <Textarea
        ref={editorRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={handleScroll}
        wrap="off"
        spellCheck={false}
        className="h-full min-h-0 resize-none rounded-none border-0 bg-transparent px-4 py-3 font-mono text-[12px] leading-6 text-zinc-200 shadow-none outline-none placeholder:text-zinc-600 focus-visible:border-0 focus-visible:ring-0"
        style={{ tabSize: 2 }}
      />
    </div>
  )
}

const areWorkspaceFileRootPathsEqual = (left: string[], right: string[]) => {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

function WorkspaceFilesPanelComponent({
  executorId,
  initialDirectoryPath,
  candidateRootPaths = [],
  cacheScopeKey = '',
  uiScopeKey,
  openFileRequest = null,
  className,
}: WorkspaceFilesPanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const headerActions = useWorkspaceSidePanelHeaderActions()
  const normalizedExecutorId = executorId?.trim() || ''
  const normalizedInitialDirectoryPath = normalizeWorkspaceFilePath(initialDirectoryPath?.trim() || '')
  const normalizedCacheScopeKey = cacheScopeKey.trim() || `${normalizedExecutorId}:${normalizedInitialDirectoryPath || 'root'}`
  const panelUiScopeKey = uiScopeKey || buildWorkspacePanelUiScopeKey({
    workspaceId: normalizedCacheScopeKey,
    panel: 'files',
  })
  const [rootPath, setRootPath] = useState(normalizedInitialDirectoryPath)
  const [directoryStates, setDirectoryStates] = useState<DirectoryStateMap>({})
  const [expandedDirectoryPaths, setExpandedDirectoryPaths] = useWorkspacePanelUiField(panelUiScopeKey, 'files', 'expandedDirectories', [])
  const expandedDirectories = useMemo(() => new Set(expandedDirectoryPaths), [expandedDirectoryPaths])
  const setExpandedDirectories = useCallback((nextValue: SetStateAction<Set<string>>) => {
    setExpandedDirectoryPaths((currentPaths) => {
      const current = new Set(currentPaths)
      const next = typeof nextValue === 'function' ? nextValue(current) : nextValue
      return [...next]
    })
  }, [setExpandedDirectoryPaths])
  const [selectedFilePath, setSelectedFilePath] = useWorkspacePanelUiField(panelUiScopeKey, 'files', 'selectedFilePath', '')
  const [preview, setPreview] = useState<ExecutorFileReadResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [fileSearchQuery, setFileSearchQuery] = useWorkspacePanelUiField(panelUiScopeKey, 'files', 'fileSearchQuery', '')
  const [contentSearchQuery, setContentSearchQuery] = useWorkspacePanelUiField(panelUiScopeKey, 'files', 'contentSearchQuery', '')
  const [editMode, setEditMode] = useWorkspacePanelUiField(panelUiScopeKey, 'files', 'editMode', true)
  const [editorContent, setEditorContent] = useWorkspacePanelUiField(panelUiScopeKey, 'files', 'editorContent', '')
  const [lastSavedContent, setLastSavedContent] = useWorkspacePanelUiField(panelUiScopeKey, 'files', 'lastSavedContent', '')
  const [scrollTopByRegion, setScrollTopByRegion] = useWorkspacePanelUiField(panelUiScopeKey, 'files', 'scrollTopByRegion', {})
  const handleEditorScrollTopChange = useCallback((scrollTop: number) => {
    setScrollTopByRegion((current) => current.editor === scrollTop
      ? current
      : { ...current, editor: scrollTop })
  }, [setScrollTopByRegion])
  const [savingFile, setSavingFile] = useState(false)
  const [newFilePath, setNewFilePath] = useState('')
  const [creatingFile, setCreatingFile] = useState(false)
  const [createFileVisible, setCreateFileVisible] = useState(false)
  const rootLabel = useMemo(
    () => buildPathLabel(rootPath),
    [rootPath],
  )
  const loadingDirectoryText = t('workspace.files.loading', { defaultValue: '正在读取目录...' })
  const emptyDirectoryText = t('workspace.files.empty', { defaultValue: '当前目录下没有文件。' })
  const rootState = rootPath ? (directoryStates[rootPath] ?? createDirectoryState()) : createDirectoryState()
  const rootExpanded = rootPath ? expandedDirectories.has(rootPath) : false
  const loadedFileSearchResults = useMemo(
    () => collectLoadedFileSearchResults(directoryStates, rootState.entries, fileSearchQuery),
    [directoryStates, fileSearchQuery, rootState.entries],
  )
  const selectedFileName = selectedFilePath ? getFileName(selectedFilePath) : ''
  const editablePreview = isEditableFilePreview(preview)
  const hasUnsavedChanges = editablePreview && editorContent !== lastSavedContent
  const contentSearchMatchCount = preview?.ok
    ? countTextMatches(editMode ? editorContent : (preview.content || ''), contentSearchQuery)
    : 0
  const directoryStatesRef = useRef<DirectoryStateMap>({})
  const rootPathRef = useRef(rootPath)
  const errorMessagesRef = useRef({
    browseFailed: t('workspace.files.errors.browseFailed', { defaultValue: '目录读取失败。' }),
    readFailed: t('workspace.files.errors.readFailed', { defaultValue: '文件读取失败。' }),
  })
  const lastProcessedOpenFileRequestIdRef = useRef<number | null>(null)
  const previewRequestIdRef = useRef(0)
  const sourceKeyRef = useRef('')

  useEffect(() => {
    directoryStatesRef.current = directoryStates
  }, [directoryStates])

  useEffect(() => {
    rootPathRef.current = rootPath
  }, [rootPath])

  useEffect(() => {
    errorMessagesRef.current = {
      browseFailed: t('workspace.files.errors.browseFailed', { defaultValue: '目录读取失败。' }),
      readFailed: t('workspace.files.errors.readFailed', { defaultValue: '文件读取失败。' }),
    }
  }, [t])

  const loadDirectory = useCallback(async (directoryPath: string, options?: { force?: boolean }) => {
    if (!normalizedExecutorId || !directoryPath) {
      return
    }

    const queryKey = workspaceQueryKeys.filesDirectory(normalizedExecutorId, directoryPath, normalizedCacheScopeKey)
    const cached = queryClient.getQueryState<ExecutorDirectoryBrowseResult>(queryKey)
    const cachedDirectory = cached?.data
    if (!options?.force && cachedDirectory && cached.dataUpdatedAt + DIRECTORY_CACHE_TTL_MS > Date.now()) {
      setDirectoryStates((current) => ({
        ...current,
        [directoryPath]: {
          status: cachedDirectory.ok ? 'ready' : 'error',
          entries: cachedDirectory.entries,
          message: cachedDirectory.message || '',
        },
      }))
      return
    }

    const currentState = directoryStatesRef.current[directoryPath]
    if (!options?.force && (currentState?.status === 'loading' || currentState?.status === 'ready')) {
      return
    }

    setDirectoryStates((current) => ({
      ...current,
      [directoryPath]: {
        status: 'loading',
        entries: current[directoryPath]?.entries ?? [],
        message: '',
      },
    }))

    try {
      const result = await queryClient.fetchQuery({
        queryKey,
        queryFn: () => api.browseExecutorDirectory(normalizedExecutorId, directoryPath),
        staleTime: options?.force ? 0 : DIRECTORY_CACHE_TTL_MS,
      })
      setDirectoryStates((current) => ({
        ...current,
        [directoryPath]: {
          status: result.ok ? 'ready' : 'error',
          entries: result.entries,
          message: result.message || '',
        },
      }))
    } catch (error) {
      setDirectoryStates((current) => ({
        ...current,
        [directoryPath]: {
          status: 'error',
          entries: [],
          message: error instanceof Error ? error.message : errorMessagesRef.current.browseFailed,
        },
      }))
    }
  }, [normalizedCacheScopeKey, normalizedExecutorId, queryClient])

  useEffect(() => {
    const nextSourceKey = `${normalizedExecutorId}::${normalizedInitialDirectoryPath}::${normalizedCacheScopeKey}`
    if (sourceKeyRef.current === nextSourceKey) {
      return
    }

    sourceKeyRef.current = nextSourceKey
    const nextRootPath = normalizedInitialDirectoryPath
    setRootPath(nextRootPath)
    setPreview(null)
    setPreviewLoading(false)
    setSavingFile(false)
    setNewFilePath('')
    setCreatingFile(false)
    setCreateFileVisible(false)
    setDirectoryStates({})
    if (expandedDirectories.size === 0 && nextRootPath) {
      setExpandedDirectories(new Set([nextRootPath]))
    }

    if (normalizedExecutorId && nextRootPath) {
      void loadDirectory(nextRootPath)
    }
  }, [expandedDirectories.size, loadDirectory, normalizedCacheScopeKey, normalizedExecutorId, normalizedInitialDirectoryPath, setExpandedDirectories])

  useEffect(() => {
    if (!normalizedExecutorId) {
      return
    }

    expandedDirectories.forEach((directoryPath) => {
      const state = directoryStatesRef.current[directoryPath]
      if (!state || state.status === 'idle') {
        void loadDirectory(directoryPath)
      }
    })
  }, [expandedDirectories, loadDirectory, normalizedExecutorId])

  const handleToggleDirectory = useCallback((directoryPath: string) => {
    setExpandedDirectories((current) => {
      const next = new Set(current)
      if (next.has(directoryPath)) {
        next.delete(directoryPath)
      } else {
        next.add(directoryPath)
      }
      return next
    })
  }, [])

  const handleOpenFile = useCallback(async (filePath: string, options?: { skipUnsavedConfirm?: boolean }) => {
    if (!normalizedExecutorId) {
      return
    }

    if (!options?.skipUnsavedConfirm && hasUnsavedChanges && !window.confirm(t('workspace.files.unsavedSwitchConfirm', { defaultValue: '当前文件还有未保存修改，要放弃这些修改并打开其他文件吗？' }))) {
      return
    }

    const requestId = previewRequestIdRef.current + 1
    previewRequestIdRef.current = requestId
    setSelectedFilePath(filePath)
    setPreviewLoading(true)
    try {
      const result = await queryClient.fetchQuery({
        queryKey: workspaceQueryKeys.filePreview(normalizedExecutorId, filePath, normalizedCacheScopeKey),
        queryFn: () => api.readExecutorFile(normalizedExecutorId, filePath),
        staleTime: DIRECTORY_CACHE_TTL_MS,
      })
      if (previewRequestIdRef.current !== requestId) {
        return
      }
      setPreview(result)
      if (isEditableFilePreview(result)) {
        setEditorContent(result.content || '')
        setLastSavedContent(result.content || '')
        setEditMode(true)
      } else {
        setEditMode(false)
        setEditorContent('')
        setLastSavedContent('')
      }
    } catch (error) {
      if (previewRequestIdRef.current !== requestId) {
        return
      }
      setPreview({
        ok: false,
        path: filePath,
        rootPath: '',
        message: error instanceof Error ? error.message : errorMessagesRef.current.readFailed,
      })
      setEditMode(false)
      setEditorContent('')
      setLastSavedContent('')
    } finally {
      if (previewRequestIdRef.current === requestId) {
        setPreviewLoading(false)
      }
    }
  }, [hasUnsavedChanges, normalizedCacheScopeKey, normalizedExecutorId, queryClient, t])

  const restoredPreviewScopeRef = useRef('')
  useEffect(() => {
    if (!normalizedExecutorId || restoredPreviewScopeRef.current === panelUiScopeKey) {
      return
    }

    if (!selectedFilePath) {
      restoredPreviewScopeRef.current = panelUiScopeKey
      return
    }

    restoredPreviewScopeRef.current = panelUiScopeKey
    const draft = editorContent !== lastSavedContent
      ? { editorContent, lastSavedContent }
      : null
    void handleOpenFile(selectedFilePath, { skipUnsavedConfirm: true }).then(() => {
      if (draft) {
        setEditorContent(draft.editorContent)
        setLastSavedContent(draft.lastSavedContent)
        setEditMode(true)
      }
    })
  }, [editorContent, handleOpenFile, lastSavedContent, normalizedExecutorId, panelUiScopeKey, selectedFilePath, setEditMode, setEditorContent, setLastSavedContent])

  const handleRefresh = useCallback(() => {
    if (!rootPath) {
      return
    }

    setDirectoryStates({})
    queryClient.removeQueries({
      queryKey: workspaceQueryKeys.filesDirectoryScope(normalizedExecutorId, normalizedCacheScopeKey),
    })
    setExpandedDirectories(new Set([rootPath]))
    void loadDirectory(rootPath, { force: true })
  }, [loadDirectory, normalizedCacheScopeKey, normalizedExecutorId, queryClient, rootPath])

  const refreshFileDirectory = useCallback((filePath: string) => {
    const parentPath = getWorkspaceFileParentPath(filePath)
    if (parentPath) {
      queryClient.removeQueries({
        queryKey: workspaceQueryKeys.filesDirectory(normalizedExecutorId, parentPath, normalizedCacheScopeKey),
      })
      void loadDirectory(parentPath, { force: true })
    }
  }, [loadDirectory, normalizedCacheScopeKey, normalizedExecutorId, queryClient])

  const handleSaveFile = useCallback(async () => {
    if (!normalizedExecutorId || !selectedFilePath || !editablePreview) {
      return
    }

    setSavingFile(true)
    try {
      const result = await api.writeExecutorFile(normalizedExecutorId, selectedFilePath, editorContent)
      if (!result.ok) {
        toast.error(result.message || t('workspace.files.errors.writeFailed', { defaultValue: '文件写入失败。' }))
        return
      }

      const nextPreview: ExecutorFileReadResult = {
        ...(preview ?? {
          ok: true,
          path: selectedFilePath,
          rootPath: result.rootPath,
          contentType: 'text/plain',
          encoding: 'utf8',
        }),
        ok: true,
        path: result.path,
        rootPath: result.rootPath,
        content: editorContent,
        encoding: 'utf8',
        sizeBytes: result.sizeBytes,
        truncated: false,
        message: result.message,
      }
      setSelectedFilePath(result.path)
      setPreview(nextPreview)
      setLastSavedContent(editorContent)
      queryClient.setQueryData(
        workspaceQueryKeys.filePreview(normalizedExecutorId, result.path, normalizedCacheScopeKey),
        nextPreview,
      )
      refreshFileDirectory(result.path)
      toast.success(result.message || t('workspace.files.saved', { defaultValue: '文件已保存。' }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.files.errors.writeFailed', { defaultValue: '文件写入失败。' }))
    } finally {
      setSavingFile(false)
    }
  }, [
    editablePreview,
    editorContent,
    normalizedCacheScopeKey,
    normalizedExecutorId,
    preview,
    queryClient,
    refreshFileDirectory,
    selectedFilePath,
    t,
  ])

  const handleCopySelectedFilePath = useCallback(async () => {
    if (!selectedFilePath) {
      return
    }

    try {
      await navigator.clipboard.writeText(selectedFilePath)
      toast.success(t('workspace.files.pathCopied', { defaultValue: '文件路径已复制。' }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.files.pathCopyFailed', { defaultValue: '复制文件路径失败。' }))
    }
  }, [selectedFilePath, t])

  const openFileInExplorer = useCallback(async (filePath: string) => {
    if (!normalizedExecutorId || !filePath) {
      return
    }

    if (hasUnsavedChanges && !window.confirm(t('workspace.files.unsavedSwitchConfirm', { defaultValue: '当前文件还有未保存修改，要放弃这些修改并打开其他文件吗？' }))) {
      return
    }

    const currentRootPath = rootPathRef.current
    const nextRootPath = pickWorkspaceFileRootPath(
      filePath,
      candidateRootPaths,
      normalizedInitialDirectoryPath || currentRootPath,
    )
    const ancestorDirectories = listWorkspaceAncestorDirectories(nextRootPath, filePath)

    if (nextRootPath !== currentRootPath) {
      setDirectoryStates({})
    }

    setRootPath(nextRootPath)
    setExpandedDirectories(new Set([nextRootPath, ...ancestorDirectories]))
    setSelectedFilePath(filePath)
    setPreview(null)

    await Promise.all([
      loadDirectory(nextRootPath, { force: true }),
      ...ancestorDirectories.map((ancestorDirectory) => loadDirectory(ancestorDirectory)),
      handleOpenFile(filePath, { skipUnsavedConfirm: true }),
    ])
  }, [
    candidateRootPaths,
    handleOpenFile,
    hasUnsavedChanges,
    loadDirectory,
    normalizedExecutorId,
    normalizedInitialDirectoryPath,
    t,
  ])

  const handleCreateFile = useCallback(async () => {
    if (!normalizedExecutorId || !rootPath || creatingFile) {
      return
    }

    const filePath = resolveNewWorkspaceFilePath(rootPath, newFilePath)
    if (!filePath) {
      toast.error(t('workspace.files.createFilePathRequired', { defaultValue: '请输入要创建的文件路径。' }))
      return
    }

    setCreatingFile(true)
    try {
      const result = await api.writeExecutorFile(normalizedExecutorId, filePath, '')
      if (!result.ok) {
        toast.error(result.message || t('workspace.files.errors.writeFailed', { defaultValue: '文件写入失败。' }))
        return
      }

      setNewFilePath('')
      setCreateFileVisible(false)
      refreshFileDirectory(result.path)
      await openFileInExplorer(result.path)
      setEditMode(true)
      toast.success(t('workspace.files.created', { defaultValue: '文件已创建。' }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.files.errors.writeFailed', { defaultValue: '文件写入失败。' }))
    } finally {
      setCreatingFile(false)
    }
  }, [
    creatingFile,
    newFilePath,
    normalizedExecutorId,
    openFileInExplorer,
    refreshFileDirectory,
    rootPath,
    t,
  ])

  useEffect(() => {
    if (!openFileRequest?.filePath || lastProcessedOpenFileRequestIdRef.current === openFileRequest.requestId) {
      return
    }

    lastProcessedOpenFileRequestIdRef.current = openFileRequest.requestId
    void openFileInExplorer(openFileRequest.filePath)
  }, [openFileInExplorer, openFileRequest?.filePath, openFileRequest?.requestId])

  return (
    <Card className={cn('flex h-full min-h-0 flex-col overflow-hidden border-zinc-800 bg-[#0b0c0f] text-zinc-100 shadow-none', className)}>
      <CardHeader className="border-b border-zinc-800 bg-[#090a0d] px-2 py-1.5">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <FolderTree className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              {t('workspace.files.title', { defaultValue: '文件树' })}
            </span>
            <div className="mx-0.5 h-3 w-px shrink-0 bg-zinc-800" />
            <span className="truncate font-mono text-[10px] text-zinc-600">
              {rootPath || t('workspace.files.noDirectory', { defaultValue: '无目录' })}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={!normalizedExecutorId || !rootPath}
              className="h-6 w-6 rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title={t('common.refresh', { defaultValue: '刷新' })}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            {headerActions}
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 p-0">
        <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(14rem,42%)_minmax(0,1fr)] sm:grid-cols-[280px_minmax(0,1fr)] sm:grid-rows-1">
          <div className="flex min-h-0 flex-col border-b border-zinc-800 bg-[#0f1115] sm:border-b-0 sm:border-r">
            <div className={cn('flex items-center justify-between gap-2 border-b border-zinc-800 px-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500', ROOT_ROW_HEIGHT)}>
              <span>{t('workspace.files.explorer', { defaultValue: '资源管理器' })}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setCreateFileVisible((value) => !value)}
                disabled={!normalizedExecutorId || !rootPath}
                className="h-6 w-6 rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                title={t('workspace.files.newFile', { defaultValue: '新建文件' })}
              >
                <FilePlus2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="border-b border-zinc-800 px-2 py-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
                <Input
                  value={fileSearchQuery}
                  onChange={(event) => setFileSearchQuery(event.target.value)}
                  placeholder={t('workspace.files.searchFiles', { defaultValue: '搜索已加载文件...' })}
                  className="h-7 rounded-md border-zinc-800 bg-zinc-950 pl-8 pr-8 text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-0"
                />
                {fileSearchQuery ? (
                  <button
                    type="button"
                    onClick={() => setFileSearchQuery('')}
                    className="absolute right-2 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
                    title={t('common.clear', { defaultValue: '清空' })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
              {createFileVisible ? (
                <div className="mt-2 flex items-center gap-1.5">
                  <Input
                    value={newFilePath}
                    onChange={(event) => setNewFilePath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void handleCreateFile()
                      }
                    }}
                    placeholder={t('workspace.files.newFilePlaceholder', { defaultValue: 'src/new-file.ts' })}
                    className="h-7 rounded-md border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-0"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleCreateFile()}
                    disabled={creatingFile || !newFilePath.trim()}
                    className="h-7 w-7 shrink-0 rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    title={t('workspace.files.createFile', { defaultValue: '创建文件' })}
                  >
                    {creatingFile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              ) : null}
            </div>
            <ScrollArea className="min-h-0 flex-1">
              {!rootPath ? (
                <div className="px-3 py-4 text-sm text-zinc-500">
                  {t('workspace.files.noDirectory', { defaultValue: '当前没有可浏览目录。' })}
                </div>
              ) : fileSearchQuery.trim() ? (
                <div className="py-1.5">
                  {loadedFileSearchResults.length > 0 ? loadedFileSearchResults.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      onClick={() => {
                        if (entry.kind === 'directory') {
                          handleToggleDirectory(entry.path)
                        } else {
                          void handleOpenFile(entry.path)
                        }
                      }}
                      className={cn(
                        'flex min-h-7 w-full items-center gap-1.5 px-2 pr-3 text-left text-[12px] transition-colors',
                        selectedFilePath === entry.path
                          ? 'bg-[#1f2329] text-zinc-100'
                          : 'text-zinc-400 hover:bg-[#1a1d21] hover:text-zinc-100',
                      )}
                    >
                      {entry.kind === 'directory' ? (
                        <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      ) : (
                        <span className="h-3.5 w-3.5 shrink-0 rounded-sm border border-zinc-700 bg-zinc-900" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      <span className="max-w-[8rem] truncate font-mono text-[10px] text-zinc-600">
                        {getWorkspaceFileParentPath(entry.path)}
                      </span>
                    </button>
                  )) : (
                    <div className="px-3 py-4 text-sm text-zinc-500">
                      {t('workspace.files.searchNoResults', { defaultValue: '已加载目录中没有匹配文件。' })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-1.5">
                  <button
                    type="button"
                    onClick={() => handleToggleDirectory(rootPath)}
                    className="flex min-h-7 w-full items-center gap-1.5 px-2 pr-3 text-left text-[12px] font-medium text-zinc-200 transition-colors hover:bg-[#1a1d21]"
                  >
                    {rootExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    )}
                    {rootExpanded ? (
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
                    ) : (
                      <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    )}
                    <span className="truncate uppercase tracking-[0.08em]">{rootLabel}</span>
                  </button>

                  {rootExpanded ? (
                    rootState.status === 'idle' || rootState.status === 'loading' ? (
                      <TreeStatusRow
                        depth={1}
                        loading
                        message={t('workspace.files.loading', { defaultValue: '正在读取目录...' })}
                      />
                    ) : rootState.entries.length > 0 ? (
                      <WorkspaceFileTree
                        depth={1}
                        directoryStates={directoryStates}
                        entries={rootState.entries}
                        expandedDirectories={expandedDirectories}
                        emptyMessage={emptyDirectoryText}
                        loadingMessage={loadingDirectoryText}
                        selectedFilePath={selectedFilePath}
                        onOpenFile={handleOpenFile}
                        onToggleDirectory={handleToggleDirectory}
                      />
                    ) : (
                      <TreeStatusRow
                        depth={1}
                        message={rootState.message || emptyDirectoryText}
                      />
                    )
                  ) : null}
                </div>
              )}
            </ScrollArea>
          </div>

          <div className="flex min-h-0 flex-col bg-[#0c0d10]">
            <div className="flex min-h-8 items-center gap-2 border-b border-zinc-800 bg-[#090a0d] px-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', hasUnsavedChanges ? 'bg-amber-400' : selectedFilePath ? 'bg-emerald-400' : 'bg-zinc-600')} />
                <span className="truncate text-[12px] font-medium text-zinc-200">
                  {selectedFileName || t('workspace.files.preview', { defaultValue: '文件预览' })}
                </span>
                {preview?.sizeBytes !== undefined ? (
                  <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                    {preview.sizeBytes}b
                  </span>
                ) : null}
              </div>

              {preview?.ok ? (
                <div className="relative hidden w-44 shrink-0 sm:block">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-600" />
                  <Input
                    value={contentSearchQuery}
                    onChange={(event) => setContentSearchQuery(event.target.value)}
                    placeholder={t('workspace.files.searchInFile', { defaultValue: '文件内搜索' })}
                    className="h-6 rounded-md border-zinc-800 bg-zinc-950 pl-7 pr-9 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-0"
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-zinc-600">
                    {contentSearchQuery.trim() ? contentSearchMatchCount : ''}
                  </span>
                </div>
              ) : null}

              {editablePreview ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditMode((value) => !value)}
                    className="h-6 rounded px-2 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {editMode ? t('workspace.files.viewMode', { defaultValue: '预览' }) : t('workspace.files.editMode', { defaultValue: '编辑' })}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditorContent(lastSavedContent)}
                    disabled={!hasUnsavedChanges || savingFile}
                    className="h-6 w-6 rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                    title={t('workspace.files.revert', { defaultValue: '还原修改' })}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleSaveFile()}
                    disabled={!hasUnsavedChanges || savingFile}
                    className="h-6 w-6 rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    title={t('workspace.files.save', { defaultValue: '保存文件' })}
                  >
                    {savingFile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              ) : null}

              {selectedFilePath ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void handleCopySelectedFilePath()}
                  className="h-6 w-6 shrink-0 rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                  title={t('workspace.files.copyPath', { defaultValue: '复制路径' })}
                >
                  <Clipboard className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>

            {previewLoading ? (
              <div className="flex items-center gap-2 px-4 py-4 text-sm text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('workspace.files.previewLoading', { defaultValue: '正在读取文件...' })}
              </div>
            ) : preview?.ok && editMode && editablePreview ? (
              <WorkspaceTextFileEditor
                value={editorContent}
                onChange={setEditorContent}
                scrollTop={scrollTopByRegion.editor ?? 0}
                onScrollTopChange={handleEditorScrollTopChange}
              />
            ) : (
              <ScrollArea className="min-h-0 flex-1">
                {preview?.ok ? (
                  <WorkspaceFilePreview preview={preview} searchQuery={contentSearchQuery} />
                ) : (
                  <div className="px-4 py-4 text-sm text-zinc-500">
                    {preview?.message || t('workspace.files.selectHint', { defaultValue: '从左侧选择一个文件后，会在这里显示内容。' })}
                  </div>
                )}
              </ScrollArea>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export const WorkspaceFilesPanel = memo(WorkspaceFilesPanelComponent, (previousProps, nextProps) => {
  return previousProps.executorId === nextProps.executorId
    && previousProps.initialDirectoryPath === nextProps.initialDirectoryPath
    && (previousProps.cacheScopeKey ?? '') === (nextProps.cacheScopeKey ?? '')
    && (previousProps.uiScopeKey ?? '') === (nextProps.uiScopeKey ?? '')
    && previousProps.className === nextProps.className
    && areWorkspaceFileRootPathsEqual(previousProps.candidateRootPaths ?? [], nextProps.candidateRootPaths ?? [])
    && (previousProps.openFileRequest?.requestId ?? null) === (nextProps.openFileRequest?.requestId ?? null)
    && (previousProps.openFileRequest?.filePath ?? '') === (nextProps.openFileRequest?.filePath ?? '')
})

WorkspaceFilesPanel.displayName = 'WorkspaceFilesPanel'
