import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Loader2 } from 'lucide-react'
import type { ExecutorDirectoryEntry } from '@shared/types'
import { cn } from '../../lib/utils'

export type DirectoryLoadState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  entries: ExecutorDirectoryEntry[]
  message: string
}

export type DirectoryStateMap = Record<string, DirectoryLoadState>

export type WorkspaceFileTreeProps = {
  depth?: number
  directoryStates: DirectoryStateMap
  entries: ExecutorDirectoryEntry[]
  expandedDirectories: Set<string>
  emptyMessage: string
  loadingMessage: string
  selectedFilePath: string
  onOpenFile: (filePath: string) => void
  onToggleDirectory: (directoryPath: string) => void
}

const TREE_BASE_INDENT = 10
const TREE_STEP_INDENT = 14

export const buildPathLabel = (value: string) => value.split('/').filter(Boolean).pop() || value || '/'

const buildTreeIndent = (depth: number) => ({
  paddingLeft: `${TREE_BASE_INDENT + depth * TREE_STEP_INDENT}px`,
})

export const createDirectoryState = (): DirectoryLoadState => ({
  status: 'idle',
  entries: [],
  message: '',
})

export function TreeStatusRow({
  depth,
  loading = false,
  message,
}: {
  depth: number
  loading?: boolean
  message: string
}) {
  return (
    <div
      className="flex min-h-7 items-center gap-2 py-1 pr-3 text-[12px] text-zinc-500"
      style={buildTreeIndent(depth)}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" /> : <span className="h-3.5 w-3.5" />}
      <span className="truncate">{message}</span>
    </div>
  )
}

export function WorkspaceFileTree({
  depth = 0,
  directoryStates,
  entries,
  expandedDirectories,
  emptyMessage,
  loadingMessage,
  selectedFilePath,
  onOpenFile,
  onToggleDirectory,
}: WorkspaceFileTreeProps) {
  return (
    <div>
      {entries.map((entry) => {
        if (entry.kind === 'directory') {
          const expanded = expandedDirectories.has(entry.path)
          const state = directoryStates[entry.path] ?? createDirectoryState()

          return (
            <div key={entry.path}>
              <button
                type="button"
                onClick={() => onToggleDirectory(entry.path)}
                className="flex min-h-7 w-full items-center gap-1.5 pr-3 text-left text-[12px] text-zinc-300 transition-colors hover:bg-[#1a1d21]"
                style={buildTreeIndent(depth)}
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                )}
                {expanded ? (
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                ) : (
                  <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                )}
                <span className="truncate">{entry.name}</span>
              </button>

              {expanded ? (
                state.status === 'idle' || state.status === 'loading' ? (
                  <TreeStatusRow
                    depth={depth + 1}
                    loading
                    message={loadingMessage}
                  />
                ) : state.entries.length > 0 ? (
                  <WorkspaceFileTree
                    depth={depth + 1}
                    directoryStates={directoryStates}
                    entries={state.entries}
                    expandedDirectories={expandedDirectories}
                    emptyMessage={emptyMessage}
                    loadingMessage={loadingMessage}
                    selectedFilePath={selectedFilePath}
                    onOpenFile={onOpenFile}
                    onToggleDirectory={onToggleDirectory}
                  />
                ) : (
                  <TreeStatusRow
                    depth={depth + 1}
                    message={state.message || emptyMessage}
                  />
                )
              ) : null}
            </div>
          )
        }

        return (
          <button
            key={entry.path}
            type="button"
            onClick={() => onOpenFile(entry.path)}
            className={cn(
              'flex min-h-7 w-full items-center gap-1.5 pr-3 text-left text-[12px] transition-colors',
              selectedFilePath === entry.path
                ? 'bg-[#1f2329] text-zinc-100'
                : 'text-zinc-400 hover:bg-[#1a1d21] hover:text-zinc-100',
            )}
            style={buildTreeIndent(depth)}
          >
            <span className="w-3.5 shrink-0" />
            <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <span className="truncate">{entry.name}</span>
          </button>
        )
      })}
    </div>
  )
}
