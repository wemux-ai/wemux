import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Clock3, Download, Folder, FolderOpen, FolderTree, HardDrive, Loader2, RefreshCw, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import type { ExecutorDirectoryEntry } from '@shared/types'
import type { AgentWorkdirFileEntry, AgentWorkdirReadResult, AgentWorkdirSummary } from '../../lib/api'
import { useTranslation } from '../../lib/i18n/react'
import { cn, formatDate } from '../../lib/utils'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { Badge } from '../ui/badge'
import { SectionHeader, SummaryRow } from './custom-agent-detail-panel-shared'
import { buildPathLabel, type DirectoryStateMap, WorkspaceFileTree } from '../workspaces/workspace-file-tree'

const ROOT_ROW_HEIGHT = 'min-h-8'

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`
}

const summarizeStatus = (status: AgentWorkdirSummary['status'] | undefined, t: (key: string) => string) => {
  if (status === 'ready') {
    return {
      label: t('agents.custom.detail.workdir.status.ready'),
      className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
    }
  }

  if (status === 'error') {
    return {
      label: t('agents.custom.detail.workdir.status.error'),
      className: 'border-rose-500/20 bg-rose-500/10 text-rose-200',
    }
  }

  if (status === 'missing') {
    return {
      label: t('agents.custom.detail.workdir.status.missing'),
      className: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    }
  }

  return {
    label: t('agents.custom.detail.workdir.status.unknown'),
    className: 'border-zinc-700 bg-zinc-900 text-zinc-300',
  }
}

const formatTimestamp = (value?: string | null) => {
  if (!value) {
    return '—'
  }

  return formatDate(value)
}

const compareEntries = (left: ExecutorDirectoryEntry, right: ExecutorDirectoryEntry) => {
  if (left.kind !== right.kind) {
    return left.kind === 'directory' ? -1 : 1
  }

  return left.name.localeCompare(right.name)
}

const getParentPath = (value: string) => {
  const parts = value.split('/').filter(Boolean)
  return parts.slice(0, -1).join('/')
}

const toExplorerEntry = (item: AgentWorkdirFileEntry): ExecutorDirectoryEntry => ({
  name: buildPathLabel(item.path),
  path: item.path,
  kind: item.type === 'directory' ? 'directory' : 'file',
  sizeBytes: item.type === 'file' ? item.sizeBytes : undefined,
})

function MetricCard({
  icon,
  label,
  value,
  emphasize = false,
}: {
  icon: ReactNode
  label: string
  value: string
  emphasize?: boolean
}) {
  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/70 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-300">
          {icon}
        </span>
        {label}
      </div>
      <p className={`mt-3 text-2xl font-semibold tracking-tight ${emphasize ? 'text-zinc-50' : 'text-zinc-100'}`}>{value}</p>
    </div>
  )
}

function InfoStack({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/60 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className={`mt-2 text-sm leading-6 text-zinc-200 ${mono ? 'break-all font-mono text-[13px]' : ''}`}>{value}</p>
    </div>
  )
}

export function AgentWorkdirPanel({
  summary,
  files,
  loading,
  refreshing,
  onEnsure,
  onRefresh,
  onCleanup,
  onRead,
  onDownload,
  onDelete,
}: {
  summary: AgentWorkdirSummary | null
  files: AgentWorkdirFileEntry[]
  loading: boolean
  refreshing: boolean
  onEnsure: () => Promise<void>
  onRefresh: () => Promise<void>
  onCleanup: () => Promise<void>
  onRead: (relativePath: string) => Promise<AgentWorkdirReadResult>
  onDownload: (relativePath: string) => Promise<void>
  onDelete: (relativePath: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set())
  const [selectedFilePath, setSelectedFilePath] = useState('')
  const [rootExpanded, setRootExpanded] = useState(true)
  const [preview, setPreview] = useState<AgentWorkdirReadResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const previewRequestRef = useRef(0)
  const statusMeta = summarizeStatus(summary?.status, t)
  const fileCount = summary ? String(summary.totalFiles) : '0'
  const directoryCount = summary ? String(summary.totalDirectories) : '0'
  const totalSize = summary ? formatBytes(summary.totalSizeBytes) : '0 B'
  const rootPath = summary?.workDirPath || ''

  const explorer = useMemo(() => {
    const directoryStates: DirectoryStateMap = {}
    const rootEntries: ExecutorDirectoryEntry[] = []
    const filesByPath = new Map<string, AgentWorkdirFileEntry>()
    const childrenByParent = new Map<string, ExecutorDirectoryEntry[]>()

    for (const item of files) {
      const parentPath = getParentPath(item.path)
      const bucket = childrenByParent.get(parentPath) ?? []
      const entry = toExplorerEntry(item)
      bucket.push(entry)
      childrenByParent.set(parentPath, bucket)

      if (item.type === 'file') {
        filesByPath.set(item.path, item)
      }
    }

    for (const [parentPath, entries] of childrenByParent.entries()) {
      entries.sort(compareEntries)
      if (!parentPath) {
        rootEntries.push(...entries)
      }
    }

    for (const item of files) {
      if (item.type !== 'directory') {
        continue
      }

      directoryStates[item.path] = {
        status: 'ready',
        entries: [...(childrenByParent.get(item.path) ?? [])].sort(compareEntries),
        message: '',
      }
    }

    return {
      rootEntries: rootEntries.sort(compareEntries),
      directoryStates,
      filesByPath,
    }
  }, [files])

  const selectedFile = selectedFilePath ? (explorer.filesByPath.get(selectedFilePath) ?? null) : null
  const rootLabel = useMemo(() => buildPathLabel(rootPath), [rootPath])

  useEffect(() => {
    setExpandedDirectories(new Set())
    setRootExpanded(true)
    setSelectedFilePath('')
    setPreview(null)
    setPreviewLoading(false)
  }, [rootPath])

  useEffect(() => {
    if (selectedFilePath && explorer.filesByPath.has(selectedFilePath)) {
      return
    }

    setSelectedFilePath('')
  }, [explorer.filesByPath, explorer.rootEntries, selectedFilePath])

  useEffect(() => {
    if (!selectedFilePath) {
      setPreview(null)
      setPreviewLoading(false)
      return
    }

    const requestId = previewRequestRef.current + 1
    previewRequestRef.current = requestId
    setPreviewLoading(true)
    setPreview(null)

    void onRead(selectedFilePath)
      .then((result) => {
        if (previewRequestRef.current !== requestId) {
          return
        }
        setPreview(result)
      })
      .catch((error) => {
        if (previewRequestRef.current !== requestId) {
          return
        }
        setPreview({
          ok: false,
          relativePath: selectedFilePath,
          message: error instanceof Error ? error.message : t('workspace.files.errors.readFailed', { defaultValue: '文件读取失败。' }),
        })
      })
      .finally(() => {
        if (previewRequestRef.current !== requestId) {
          return
        }
        setPreviewLoading(false)
      })
  }, [onRead, selectedFilePath, t])

  const handleToggleDirectory = (directoryPath: string) => {
    setExpandedDirectories((current) => {
      const next = new Set(current)
      if (next.has(directoryPath)) {
        next.delete(directoryPath)
      } else {
        next.add(directoryPath)
      }
      return next
    })
  }

  return (
    <section className="space-y-5 rounded-2xl border border-zinc-800 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.12),transparent_28%),#09090b] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeader
          icon={<FolderTree className="h-4 w-4" />}
          title={t('agents.custom.detail.workdir.title')}
          description={t('agents.custom.detail.workdir.description')}
        />
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Badge variant="outline" className={statusMeta.className}>
            {statusMeta.label}
          </Badge>
          <p className="text-xs text-zinc-500">
            {t('agents.custom.detail.workdir.summary.lastScannedAt')}: {formatTimestamp(summary?.lastScannedAt)}
          </p>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_repeat(3,minmax(0,0.75fr))]">
        <InfoStack label={t('agents.custom.detail.workdir.summary.path')} value={rootPath || '—'} mono />
        <MetricCard icon={<FolderOpen className="h-3.5 w-3.5" />} label={t('agents.custom.detail.workdir.summary.files')} value={fileCount} emphasize />
        <MetricCard icon={<FolderTree className="h-3.5 w-3.5" />} label={t('agents.custom.detail.workdir.summary.directories')} value={directoryCount} />
        <MetricCard icon={<HardDrive className="h-3.5 w-3.5" />} label={t('agents.custom.detail.workdir.summary.size')} value={totalSize} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-3 md:grid-cols-3">
          <SummaryRow label={t('agents.custom.detail.workdir.summary.lastUsedAt')} value={formatTimestamp(summary?.lastUsedAt)} />
          <SummaryRow label={t('agents.custom.detail.workdir.summary.lastSessionId')} value={summary?.lastSessionId || '—'} />
          <SummaryRow label={t('agents.custom.detail.workdir.summary.lastScannedAt')} value={formatTimestamp(summary?.lastScannedAt)} />
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button type="button" variant="outline" onClick={() => void onEnsure()} disabled={refreshing} className="h-11 rounded-xl border-zinc-800 bg-zinc-950 text-zinc-100 hover:bg-zinc-900">
            <Sparkles size={16} />
            {t('agents.custom.detail.workdir.actions.ensure')}
          </Button>
          <Button type="button" variant="outline" onClick={() => void onRefresh()} disabled={refreshing} className="h-11 rounded-xl border-zinc-800 bg-zinc-950 text-zinc-100 hover:bg-zinc-900">
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            {t('agents.custom.detail.workdir.actions.rescan')}
          </Button>
          <Button type="button" variant="outline" onClick={() => void onCleanup()} disabled={refreshing} className="h-11 rounded-xl border-zinc-800 bg-zinc-950 text-zinc-100 hover:bg-zinc-900">
            <ShieldCheck size={16} />
            {t('agents.custom.detail.workdir.actions.cleanup')}
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4">
        <SectionHeader
          icon={<FolderTree className="h-4 w-4" />}
          title={t('agents.custom.detail.workdir.filesTitle')}
          description={t('agents.custom.detail.workdir.filesDescription')}
        />

        {loading ? (
          <p className="text-sm text-zinc-500">{t('agents.custom.detail.workdir.loading')}</p>
        ) : explorer.rootEntries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-8 text-center">
            <p className="text-sm text-zinc-400">{t('agents.custom.detail.workdir.empty')}</p>
          </div>
        ) : (
          <div className="grid min-h-[24rem] gap-0 overflow-hidden rounded-2xl border border-zinc-800/80 bg-[#0b0c0f] lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col border-b border-zinc-800 bg-[#0f1115] lg:border-b-0 lg:border-r">
              <div className={cn('flex items-center border-b border-zinc-800 px-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500', ROOT_ROW_HEIGHT)}>
                {t('agents.custom.detail.workdir.treeSidebarTitle')}
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="py-1.5">
                  <button
                    type="button"
                    onClick={() => setRootExpanded((current) => !current)}
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
                    <span className="truncate uppercase tracking-[0.08em]">{rootLabel || 'workdir'}</span>
                  </button>

                  {rootExpanded ? (
                    <WorkspaceFileTree
                      depth={1}
                      directoryStates={explorer.directoryStates}
                      entries={explorer.rootEntries}
                      expandedDirectories={expandedDirectories}
                      emptyMessage={t('agents.custom.detail.workdir.empty')}
                      loadingMessage={t('agents.custom.detail.workdir.loading')}
                      selectedFilePath={selectedFilePath}
                      onOpenFile={setSelectedFilePath}
                      onToggleDirectory={handleToggleDirectory}
                    />
                  ) : null}
                </div>
              </ScrollArea>
            </div>

            <div className="flex min-h-0 flex-col bg-[#0c0d10]">
              <div className={cn('flex items-center border-b border-zinc-800 px-3', ROOT_ROW_HEIGHT)}>
                <div className="min-w-0">
                  <p className="truncate text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                    {selectedFile ? t('workspace.files.preview', { defaultValue: '文件预览' }) : t('agents.custom.detail.workdir.filePlaceholderTitle')}
                  </p>
                  {selectedFile ? (
                    <p className="truncate font-mono text-[10px] text-zinc-600">{selectedFile.path}</p>
                  ) : null}
                </div>
              </div>

              <ScrollArea className="min-h-0 flex-1">
                {selectedFile ? (
                  <div className="space-y-4 px-4 py-4">
                    <div>
                      <p className="text-base font-medium text-zinc-100">{buildPathLabel(selectedFile.path)}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-500">
                        <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-zinc-400">{formatBytes(selectedFile.sizeBytes)}</span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {formatTimestamp(selectedFile.modifiedAt)}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <SummaryRow label={t('agents.custom.detail.workdir.fileMeta.name')} value={buildPathLabel(selectedFile.path)} />
                      <SummaryRow label={t('agents.custom.detail.workdir.fileMeta.path')} value={selectedFile.path} />
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-[#090a0d]">
                      <div className="flex items-center border-b border-zinc-800 px-3 py-2">
                        <p className="truncate text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                          {t('workspace.files.preview', { defaultValue: '文件预览' })}
                        </p>
                      </div>
                      <div className="min-h-[14rem]">
                        {previewLoading ? (
                          <div className="flex items-center gap-2 px-4 py-4 text-sm text-zinc-400">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t('workspace.files.previewLoading', { defaultValue: '正在读取文件...' })}
                          </div>
                        ) : preview?.ok ? (
                          <pre className="min-h-[14rem] whitespace-pre-wrap break-words px-4 py-4 font-mono text-[12px] leading-6 text-zinc-200">
                            {preview.content}
                          </pre>
                        ) : (
                          <div className="px-4 py-4 text-sm text-zinc-500">
                            {preview?.message || t('workspace.files.selectHint', { defaultValue: '从左侧选择一个文件后，会在这里显示内容。' })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => void onDownload(selectedFile.path)} className="rounded-xl border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900">
                        <Download size={14} />
                        {t('agents.custom.detail.workdir.actions.download')}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => void onDelete(selectedFile.path)} className="rounded-xl border-rose-500/20 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20">
                        <Trash2 size={14} />
                        {t('common.delete')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-4 text-sm text-zinc-500">
                    {t('agents.custom.detail.workdir.selectHint')}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
