import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  GitBranchPlus,
  RefreshCcw,
  ScanSearch,
} from 'lucide-react'
import type { ExecutorRecord, Project as SharedProject } from '@shared/types'
import type { SkillFileInventoryEntry } from '@shared/skill'
import type { CollaborationWorkspace, SkillScanResult } from '../../lib/api'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { Textarea } from '../ui/textarea'

export type ImportMode = 'git' | 'download' | 'scan'

type SkillTreeNode = {
  name: string
  path: string
  kind: 'dir' | 'file'
  fileKind?: SkillFileInventoryEntry['kind']
  children: SkillTreeNode[]
}

const TREE_BASE_INDENT = 16
const TREE_STEP_INDENT = 18
const text = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

const buildTree = (entries: SkillFileInventoryEntry[]) => {
  const root: SkillTreeNode = {
    name: '',
    path: '',
    kind: 'dir',
    children: [],
  }

  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean)
    let current = root
    let currentPath = ''

    for (const [index, part] of parts.entries()) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const leaf = index === parts.length - 1
      let node = current.children.find((item) => item.name === part)
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          kind: leaf ? 'file' : 'dir',
          fileKind: leaf ? entry.kind : undefined,
          children: [],
        }
        current.children.push(node)
      }

      current = node
    }
  }

  const sortNode = (node: SkillTreeNode) => {
    node.children.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'dir' ? -1 : 1
      }

      if (left.name === 'SKILL.md') return -1
      if (right.name === 'SKILL.md') return 1
      return left.name.localeCompare(right.name)
    })
    node.children.forEach(sortNode)
  }

  sortNode(root)
  return root.children
}

const fileKindIcon = (kind: SkillFileInventoryEntry['kind']) => {
  return kind === 'reference' || kind === 'script' ? FileCode2 : FileText
}

export const formatUpdatedAt = (value: string, language: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SkillTree({
  expandedDirs,
  nodes,
  onSelectPath,
  onToggleDir,
  selectedPath,
  depth = 0,
}: {
  expandedDirs: Set<string>
  nodes: SkillTreeNode[]
  onSelectPath: (path: string) => void
  onToggleDir: (path: string) => void
  selectedPath: string
  depth?: number
}) {
  return (
    <div>
      {nodes.map((node) => {
        if (node.kind === 'dir') {
          const expanded = expandedDirs.has(node.path)
          return (
            <div key={node.path}>
              <button
                type="button"
                onClick={() => onToggleDir(node.path)}
                className="flex min-h-9 w-full items-center justify-between gap-2 pr-3 text-left text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
                style={{ paddingLeft: `${TREE_BASE_INDENT + depth * TREE_STEP_INDENT}px` }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {expanded ? <FolderOpen size={14} /> : <Folder size={14} />}
                  <span className="truncate">{node.name}</span>
                </span>
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {expanded ? (
                <SkillTree
                  expandedDirs={expandedDirs}
                  nodes={node.children}
                  onSelectPath={onSelectPath}
                  onToggleDir={onToggleDir}
                  selectedPath={selectedPath}
                  depth={depth + 1}
                />
              ) : null}
            </div>
          )
        }

        const Icon = fileKindIcon(node.fileKind ?? 'other')
        return (
          <button
            key={node.path}
            type="button"
            onClick={() => onSelectPath(node.path)}
            className={cn(
              'flex min-h-9 w-full items-center gap-2 pr-3 text-left text-sm transition-colors',
              node.path === selectedPath
                ? 'bg-zinc-900 text-zinc-100'
                : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100',
            )}
            style={{ paddingLeft: `${TREE_BASE_INDENT + depth * TREE_STEP_INDENT}px` }}
          >
            <Icon size={14} />
            <span className="truncate">{node.name}</span>
          </button>
        )
      })}
    </div>
  )
}

export function CreateSkillDialog({
  busy,
  open,
  onCreate,
  onOpenChange,
}: {
  busy: boolean
  open: boolean
  onCreate: (payload: { name: string; slug: string; description: string }) => Promise<void>
  onOpenChange: (open: boolean) => void
}) {
  const { language } = useTranslation()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (!open) {
      setName('')
      setSlug('')
      setDescription('')
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{text(language, '新建 Skill', 'Create Skill')}</DialogTitle>
          <DialogDescription className="text-zinc-500">
            {text(language, '创建后的 Skill 默认全局可见，所有组织都可以使用。', 'New skills are globally visible by default and can be used in every workspace.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={text(language, 'skill 名称', 'Skill name')}
            className="border-zinc-800 bg-zinc-950 text-zinc-100 placeholder:text-zinc-500"
          />
          <Input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder={text(language, 'slug（可选）', 'Slug (optional)')}
            className="border-zinc-800 bg-zinc-950 font-mono text-zinc-100 placeholder:text-zinc-500"
          />
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            placeholder={text(language, '一句话描述（可选）', 'One-line description (optional)')}
            className="border-zinc-800 bg-zinc-950 text-zinc-100 placeholder:text-zinc-500"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
            >
              {text(language, '取消', 'Cancel')}
            </Button>
            <Button
              disabled={busy || !name.trim()}
              onClick={() => void onCreate({ name, slug, description })}
              className="rounded-full border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
            >
              {busy ? text(language, '创建中...', 'Creating...') : text(language, '创建 Skill', 'Create Skill')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const inputClass = 'border-zinc-800 bg-zinc-950 text-zinc-100 placeholder:text-zinc-500'

export function ImportSkillDialog({
  busy,
  downloadBusy,
  gitBusy,
  lastScanResult,
  loading,
  mode,
  open,
  executors,
  projects,
  scanBusy,
  selectedScanScope,
  selectedExecutorId,
  onClose,
  onDownload,
  onGit,
  onModeChange,
  onOpenChange,
  onRefresh,
  onSelectedScanScopeChange,
  onSelectedExecutorIdChange,
  onSelectedProjectIdsChange,
  onScan,
  selectedProjectIds,
}: {
  busy: boolean
  downloadBusy: boolean
  gitBusy: boolean
  lastScanResult: SkillScanResult | null
  loading: boolean
  mode: ImportMode
  open: boolean
  executors: ExecutorRecord[]
  projects: Array<Pick<SharedProject, 'id' | 'name'>>
  scanBusy: boolean
  selectedScanScope: 'project' | 'global'
  selectedExecutorId: string
  onClose: () => void
  onDownload: (url: string) => Promise<void>
  onGit: (payload: { url: string; ref: string; subdirectory: string }) => Promise<void>
  onModeChange: (mode: ImportMode) => void
  onOpenChange: (open: boolean) => void
  onRefresh: () => Promise<void>
  onSelectedScanScopeChange: (scope: 'project' | 'global') => void
  onSelectedExecutorIdChange: (executorId: string) => void
  onSelectedProjectIdsChange: (projectIds: string[]) => void
  onScan: (payload?: { scope?: 'project' | 'global'; projectIds?: string[]; executorId?: string }) => Promise<void>
  selectedProjectIds: string[]
}) {
  const { language } = useTranslation()
  const [gitUrl, setGitUrl] = useState('')
  const [gitRef, setGitRef] = useState('')
  const [gitSubdirectory, setGitSubdirectory] = useState('')
  const [downloadUrl, setDownloadUrl] = useState('')

  useEffect(() => {
    if (!open) {
      setGitUrl('')
      setGitRef('')
      setGitSubdirectory('')
      setDownloadUrl('')
      onModeChange('git')
    }
  }, [open])

  const modeTabs = [
    { id: 'git' as const, label: 'Git', icon: GitBranchPlus },
    { id: 'download' as const, label: text(language, '下载', 'Download'), icon: Download },
    { id: 'scan' as const, label: text(language, '扫描', 'Scan'), icon: ScanSearch },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#0a0a0c] text-zinc-100 sm:max-w-[540px] max-h-[90dvh] flex flex-col gap-0 p-0 overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
          <DialogTitle className="text-base font-semibold text-zinc-100">
            {text(language, '引入 Skill', 'Import Skill')}
          </DialogTitle>
          <p className="mt-1 text-xs text-zinc-500">
            {text(language, '支持 Git 仓库、下载链接或本地目录扫描导入', 'Import via Git repo, download link, or local directory scan')}
          </p>
        </div>

        {/* Mode tabs */}
        <div className="shrink-0 px-5 sm:px-6">
          <div className="flex gap-1 rounded-lg border border-zinc-800/80 bg-zinc-950 p-1">
            {modeTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onModeChange(id)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm',
                  mode === id
                    ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300',
                )}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {mode === 'git' && (
            <div className="space-y-3">
              <Input
                value={gitUrl}
                onChange={(event) => setGitUrl(event.target.value)}
                placeholder="https://github.com/org/repo.git"
                className={inputClass}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  value={gitRef}
                  onChange={(event) => setGitRef(event.target.value)}
                  placeholder={text(language, '分支 / tag', 'branch / tag')}
                  className={inputClass}
                />
                <Input
                  value={gitSubdirectory}
                  onChange={(event) => setGitSubdirectory(event.target.value)}
                  placeholder={text(language, '子目录（可选）', 'subdirectory (optional)')}
                  className={inputClass}
                />
              </div>
              <Button
                disabled={busy || gitBusy || !gitUrl.trim()}
                onClick={() => void onGit({ url: gitUrl, ref: gitRef, subdirectory: gitSubdirectory })}
                className="w-full"
              >
                {gitBusy ? text(language, '导入中...', 'Importing...') : text(language, '从 Git 导入', 'Import from Git')}
              </Button>
            </div>
          )}

          {mode === 'download' && (
            <div className="space-y-3">
              <Textarea
                value={downloadUrl}
                onChange={(event) => setDownloadUrl(event.target.value)}
                rows={3}
                placeholder={text(language, '粘贴 raw SKILL.md 或 Markdown 链接', 'Paste a raw SKILL.md or Markdown URL')}
                className={inputClass}
              />
              <Button
                disabled={busy || downloadBusy || !downloadUrl.trim()}
                onClick={() => void onDownload(downloadUrl)}
                className="w-full"
              >
                {downloadBusy ? text(language, '导入中...', 'Importing...') : text(language, '下载并导入', 'Download & Import')}
              </Button>
            </div>
          )}

          {mode === 'scan' && (
            <div className="space-y-4">
              {/* Scope toggle */}
              <div className="flex gap-2">
                {([
                  { value: 'project' as const, label: text(language, '项目', 'Project') },
                  { value: 'global' as const, label: text(language, '执行器全局', 'Executor Global') },
                ]).map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onSelectedScanScopeChange(value)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm',
                      selectedScanScope === value
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-300',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Executor select */}
              <NativeSelect
                value={selectedExecutorId}
                onChange={(event) => onSelectedExecutorIdChange(event.target.value)}
                className={inputClass}
              >
                <option value="">
                  {selectedScanScope === 'global'
                    ? text(language, '全部执行器', 'All Executors')
                    : text(language, '自动选择', 'Auto-select')}
                </option>
                {executors.map((executor) => (
                  <option key={executor.executorId} value={executor.executorId}>
                    {executor.name}
                  </option>
                ))}
              </NativeSelect>

              {/* Project grid */}
              {selectedScanScope === 'project' && projects.length > 0 && (
                <div className="grid max-h-36 gap-1.5 overflow-y-auto sm:max-h-40 sm:grid-cols-2">
                  {projects.map((project) => {
                    const selected = selectedProjectIds.includes(project.id)
                    return (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => {
                          onSelectedProjectIdsChange(
                            selected
                              ? selectedProjectIds.filter((id) => id !== project.id)
                              : [...selectedProjectIds, project.id],
                          )
                        }}
                        className={cn(
                          'rounded-md border px-3 py-1.5 text-left text-xs transition-colors sm:text-sm',
                          selected
                            ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                            : 'border-zinc-800/60 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
                        )}
                      >
                        {project.name}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Scan actions */}
              <div className="flex gap-2">
                <Button
                  disabled={busy || scanBusy}
                  onClick={() => void onScan({
                    scope: selectedScanScope,
                    projectIds: selectedScanScope === 'project' ? selectedProjectIds : undefined,
                    executorId: selectedExecutorId || undefined,
                  })}
                  className="flex-1"
                >
                  {scanBusy ? text(language, '扫描中...', 'Scanning...') : text(language, '开始扫描', 'Start Scan')}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={loading}
                  onClick={() => void onRefresh()}
                  className="shrink-0 border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                >
                  <RefreshCcw size={14} />
                </Button>
              </div>

              {/* Scan result */}
              {lastScanResult && (
                <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/70 px-3 py-2.5">
                  <p className="text-xs leading-relaxed text-zinc-400">
                    {lastScanResult.scope === 'global'
                      ? `${text(language, '扫描', 'Scanned')} ${lastScanResult.scannedExecutors} ${text(language, '个执行器', 'executors')}, ${text(language, '发现', 'found')} ${lastScanResult.discovered}, ${text(language, '新增', 'imported')} ${lastScanResult.imported.length}, ${text(language, '更新', 'updated')} ${lastScanResult.updated.length}`
                      : `${text(language, '扫描', 'Scanned')} ${lastScanResult.scannedProjects} ${text(language, '个项目', 'projects')}, ${text(language, '发现', 'found')} ${lastScanResult.discovered}, ${text(language, '新增', 'imported')} ${lastScanResult.imported.length}, ${text(language, '更新', 'updated')} ${lastScanResult.updated.length}`}
                  </p>
                  {lastScanResult.skipped.length > 0 && (
                    <p className="mt-1 text-xs text-amber-400/80">
                      {text(language, '跳过', 'Skipped')}: {lastScanResult.skipped.length}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-zinc-800/60 px-5 py-3 sm:px-6">
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={onClose}
              className="border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            >
              {text(language, '关闭', 'Close')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { buildTree }
