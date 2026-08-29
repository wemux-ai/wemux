// [INPUT]: 可选 workspaceId（来自路由搜索参数）；当前用户 Drive 文件数据
// [OUTPUT]: Drive 云盘主页面（协作目录 + 个人目录 双区树 + 文件列表/网格 + 上传/新建/操作 + 内嵌预览三栏）
// [POS]: Drive 页面；有 workspaceId 时展示该组织的协作目录与个人目录；无 workspaceId 时仅展示个人目录；选中文件时右侧展开预览面板（DriveFilePreview）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Group, Panel, Separator } from 'react-resizable-panels'
import {
  ChevronRight,
  Database,
  Download,
  File as FileIcon,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  Grid2x2,
  Image as ImageIcon,
  List,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  Shield,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react'
import type { CloudDriveFileEntry, DriveFileRecord, DriveSearchResult } from '@shared/types'
import { api } from '../../lib/api'
import { downloadDriveFile, type DriveQuotaInfo } from '../../lib/api/methods/drive'
import { COLLABORATION_WORKSPACE_CHANGE_EVENT, getStoredCollaborationWorkspaceId } from '../../lib/collaboration-workspace'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Input } from '../ui/input'

import { DriveFilePreview } from './drive-file-preview'
import { CloudFilePreview } from './cloud-file-preview'
import { DrivePermissionDialog, DriveShareDialog } from './drive-share-permission-dialogs'

type ViewMode = 'list' | 'grid'
type DriveSection = 'drive' | 'cloud' | 'trash'
type FileSection = 'team' | 'personal'

const fileIconFor = (file: DriveFileRecord) => {
  if (file.fileType === 'folder') return Folder
  if (file.contentType === 'image') return ImageIcon
  if (file.contentType === 'document') return FileText
  return FileIcon
}

const formatSize = (bytes: number | null) => {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const formatTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function DrivePage() {
  // 协作目录绑定全局「当前组织」（sidebar 切换时通过事件广播同步）
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(() => getStoredCollaborationWorkspaceId() || undefined)
  const [teamFiles, setTeamFiles] = useState<DriveFileRecord[]>([])
  const [personalFiles, setPersonalFiles] = useState<DriveFileRecord[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<FileSection>(workspaceId ? 'team' : 'personal')

  // 监听 sidebar 组织切换事件，协作目录随之联动
  useEffect(() => {
    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail
      const nextWorkspaceId = detail?.workspaceId || undefined
      setWorkspaceId(nextWorkspaceId)
      setCurrentFolderId(null)
      setActiveSection(nextWorkspaceId ? 'team' : 'personal')
      setPreviewFile(null)
    }
    window.addEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleChange)
    return () => window.removeEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleChange)
  }, [])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [section, setSection] = useState<DriveSection>('drive')
  const [cloudPath, setCloudPath] = useState('')
  const [cloudEntries, setCloudEntries] = useState<CloudDriveFileEntry[]>([])
  const [cloudLoading, setCloudLoading] = useState(false)
  const [trashFiles, setTrashFiles] = useState<DriveFileRecord[]>([])
  const [trashLoading, setTrashLoading] = useState(false)
  const [previewFile, setPreviewFile] = useState<DriveFileRecord | null>(null)
  const [permissionTarget, setPermissionTarget] = useState<DriveFileRecord | null>(null)
  const [shareTarget, setShareTarget] = useState<DriveFileRecord | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<DriveSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<DriveFileRecord | null>(null)
  const [moveTarget, setMoveTarget] = useState<DriveFileRecord | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [quota, setQuota] = useState<DriveQuotaInfo | null>(null)

  // 根据 workspaceId 与当前活跃分区决定使用哪个 API
  const isTeamApi = activeSection === 'team' && Boolean(workspaceId)

  const allFiles = useMemo(() => [...teamFiles, ...personalFiles], [teamFiles, personalFiles])

  const fileSection = useCallback((fileId: string): FileSection => {
    if (teamFiles.some((f) => f.id === fileId)) return 'team'
    return 'personal'
  }, [teamFiles, personalFiles])

  useEffect(() => {
    setQuota(null)
    const load = isTeamApi
      ? api.getTeamDriveQuota(workspaceId!)
      : api.getMyDriveQuota()
    load.then(setQuota).catch(() => {})
  }, [isTeamApi, workspaceId])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      let newTeamFiles: DriveFileRecord[] = []
      let newPersonalFiles: DriveFileRecord[] = []
      if (workspaceId) {
        const [teamRes, personalRes] = await Promise.all([
          api.listTeamDriveTree(workspaceId),
          api.listMyDriveTree(),
        ])
        newTeamFiles = teamRes.files
        newPersonalFiles = personalRes.files
      } else {
        const personalRes = await api.listMyDriveTree()
        newPersonalFiles = personalRes.files
      }
      setTeamFiles(newTeamFiles)
      setPersonalFiles(newPersonalFiles)
      const allNew = [...newTeamFiles, ...newPersonalFiles]
      setCurrentFolderId((current) => (current && allNew.some((f) => f.id === current) ? current : null))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载 Drive 失败。')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { void reload() }, [reload])

  const showCloudSection = section === 'cloud'
  const showTrashSection = section === 'trash'

  // 回收站（R8.3 孤儿软删）：列表 + 恢复。
  useEffect(() => {
    if (section !== 'trash') return
    setTrashLoading(true)
    const load = isTeamApi
      ? api.listTeamDriveTrash(workspaceId!)
      : api.listMyDriveTrash()
    load
      .then((res) => setTrashFiles(res.files))
      .catch((error) => toast.error(error instanceof Error ? error.message : '加载回收站失败。'))
      .finally(() => setTrashLoading(false))
  }, [section, isTeamApi])

  const restoreTrashFile = useCallback(async (fileId: string) => {
    try {
      const res = isTeamApi
        ? await api.restoreTeamDriveTrashFile(workspaceId!, fileId)
        : await api.restoreMyDriveTrashFile(fileId)
      setTrashFiles((current) => current.filter((file) => file.id !== fileId))
      toast.success(res.message || '已恢复。')
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '恢复失败。')
    }
  }, [reload, isTeamApi, workspaceId])

  // 云节点文件只读视图：直接读 R2 前缀（团队 workspaces/<wid>/，个人 users/<uid>/agents），虚拟目录无 DB 元数据
  useEffect(() => {
    if (section !== 'cloud') return
    setCloudLoading(true)
    const load = isTeamApi
      ? api.listTeamDriveCloudFiles(workspaceId!, cloudPath)
      : api.listMyDriveCloudFiles(cloudPath)
    load
      .then((res) => setCloudEntries(res.entries))
      .catch((error) => toast.error(error instanceof Error ? error.message : '读取云节点文件失败。'))
      .finally(() => setCloudLoading(false))
  }, [section, isTeamApi, cloudPath])

  const cloudBreadcrumbs = useMemo(() => cloudPath ? cloudPath.split('/').filter(Boolean) : [], [cloudPath])

  const folders = useMemo(() => allFiles.filter((f) => f.fileType === 'folder'), [allFiles])
  const children = useMemo(() => {
    const inFolder = allFiles.filter((f) => f.parentId === currentFolderId && fileSection(f.id) === activeSection)
    return [...inFolder].sort((a, b) => {
      if (a.fileType !== b.fileType) return a.fileType === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [allFiles, currentFolderId, activeSection, fileSection])

  const breadcrumbs = useMemo(() => {
    const trail: DriveFileRecord[] = []
    let cursor: DriveFileRecord | null = folders.find((f) => f.id === currentFolderId) ?? null
    const seen = new Set<string>()
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      trail.unshift(cursor)
      cursor = folders.find((f) => f.id === cursor!.parentId) ?? null
    }
    return trail
  }, [folders, currentFolderId])

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(fileList)) {
        const res = isTeamApi
          ? await api.uploadTeamDriveFile(workspaceId!, file, currentFolderId)
          : await api.uploadMyDriveFile(file, currentFolderId)
        void res
      }
      toast.success(`已上传 ${fileList.length} 个文件。`)
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '上传失败。')
    } finally {
      setUploading(false)
    }
  }

  const handleCreateFolder = async (name: string) => {
    try {
      const res = isTeamApi
        ? await api.createTeamDriveFolder(workspaceId!, { name, parentId: currentFolderId ?? undefined })
        : await api.createMyDriveFolder({ name, parentId: currentFolderId ?? undefined })
      void res
      toast.success('文件夹已创建。')
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建失败。')
    }
  }

  const handleMove = async (file: DriveFileRecord, parentId: string | null, targetWorkspaceId: string | null) => {
    try {
      const sec = fileSection(file.id)
      if (sec === 'team' && workspaceId) {
        await api.moveTeamDriveFile(workspaceId, file.id, parentId, targetWorkspaceId)
      } else {
        await api.moveMyDriveFile(file.id, parentId, targetWorkspaceId)
      }
      toast.success('已移动。')
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移动失败。')
    }
  }

  const handleRename = async (file: DriveFileRecord, name: string) => {
    try {
      const sec = fileSection(file.id)
      if (sec === 'team' && workspaceId) {
        await api.renameTeamDriveFile(workspaceId, file.id, name)
      } else {
        await api.renameMyDriveFile(file.id, name)
      }
      toast.success('已重命名。')
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重命名失败。')
    }
  }

  const handleDelete = async (file: DriveFileRecord) => {
    if (!window.confirm(`确定将「${file.name}」移入回收站？${file.fileType === 'folder' ? '文件夹内的内容将一并移入回收站。' : ''}`)) return
    try {
      const sec = fileSection(file.id)
      if (sec === 'team' && workspaceId) {
        await api.deleteTeamDriveFile(workspaceId, file.id)
      } else {
        await api.deleteMyDriveFile(file.id)
      }
      toast.success('已移入回收站。')
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败。')
    }
  }

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults(null)
      return
    }
    setSearching(true)
    try {
      const res = isTeamApi
        ? await api.searchTeamDrive(workspaceId!, query.trim())
        : await api.searchMyDrive(query.trim())
      setSearchResults(res.results)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '搜索失败。')
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶栏：标题 + 视图切换 + 搜索 + 上传 / 新建（协作/个人目录分区在左侧树中切换） */}
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-900 px-4 py-2.5">
        <h1 className="text-sm font-semibold text-zinc-100">Drive 云盘</h1>
        <div className="flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
          <button
            className={cn(
              'flex h-6 items-center rounded-sm px-2 text-xs transition-colors',
              section === 'drive' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
            )}
            onClick={() => setSection('drive')}
          >文件</button>
          <button
            className={cn(
              'flex h-6 items-center rounded-sm px-2 text-xs transition-colors',
              section === 'cloud' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
            )}
            onClick={() => setSection('cloud')}
          >云节点文件</button>
          <button
            className={cn(
              'flex h-6 items-center rounded-sm px-2 text-xs transition-colors',
              section === 'trash' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
            )}
            onClick={() => setSection('trash')}
          >回收站</button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {quota && (
            <div className="hidden items-center gap-2 md:flex">
              <span className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-500">
                <Database className="h-3 w-3 shrink-0 text-zinc-600" />
                <span className="whitespace-nowrap">已用 {formatSize(quota.usedStorageBytes)} / {formatSize(quota.totalStorageBytes)}</span>
              </span>
              <span className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-500">
                <span className="whitespace-nowrap">单文件 ≤ {formatSize(quota.maxFileSizeBytes)}</span>
              </span>
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
            <Input
              className="h-7 w-44 rounded-lg pl-8 text-xs"
              placeholder="搜索文件…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void handleSearch(searchQuery) }}
            />
            {searchResults !== null && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
                onClick={() => { setSearchResults(null); setSearchQuery('') }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => { void handleUpload(event.target.files); event.target.value = '' }}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            {uploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
            上传
          </Button>
          <Button
            size="sm"
            onClick={() => setCreateFolderOpen(true)}
            className="h-7 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />新建文件夹
          </Button>
        </div>
      </div>

      {/* 主体：云节点文件只读视图 / 回收站 / 目录树 + 文件区 + 预览 */}
      {showTrashSection ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-300">回收站</p>
            <p className="text-[11px] text-zinc-600">孤儿附件自动回收（免费 30 天 / 超过 50MB 90 天）后在此保留，30 天内可恢复</p>
          </div>
          {trashLoading ? (
            <p className="py-8 text-center text-xs text-zinc-600">加载中…</p>
          ) : trashFiles.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-600">回收站为空。</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {trashFiles.map((file) => (
                <div key={file.id} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-sm text-zinc-200">{file.name}</span>
                    {file.sizeBytes != null ? (
                      <span className="text-[11px] text-zinc-600">{formatSize(file.sizeBytes)}</span>
                    ) : null}
                    {file.deletedAt ? (
                      <span className="text-[11px] text-zinc-600">删除于 {new Date(file.deletedAt).toLocaleString()}</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => void restoreTrashFile(file.id)}
                    className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
                  >恢复</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : showCloudSection ? (
        <CloudFilesPanel
          workspaceId={workspaceId ?? null}
          path={cloudPath}
          breadcrumbs={cloudBreadcrumbs}
          entries={cloudEntries}
          loading={cloudLoading}
          onNavigate={setCloudPath}
        />
      ) : (
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel id="driveTree" defaultSize="20%" minSize="16%" maxSize="28%">
          <div className="h-full overflow-auto border-r border-zinc-900 bg-[#060607]">
            <DriveTree
              teamFolders={teamFiles.filter((f) => f.fileType === 'folder')}
              personalFolders={personalFiles.filter((f) => f.fileType === 'folder')}
              workspaceId={workspaceId}
              currentFolderId={currentFolderId}
              activeSection={activeSection}
              onSelect={(folderId, section) => {
                setCurrentFolderId(folderId)
                if (section) setActiveSection(section)
              }}
            />
          </div>
        </Panel>
        <Separator className="w-px bg-zinc-900" />
        <Panel id="driveFiles" defaultSize={previewFile ? '44%' : '80%'} minSize="30%">
          <section
            className={cn(
              'flex h-full min-w-0 flex-col',
              dragOver && 'ring-1 ring-inset ring-zinc-700',
            )}
            onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragOver(false)
              void handleUpload(event.dataTransfer.files)
            }}
          >
            {/* 面包屑 */}
            <div className="flex shrink-0 items-center gap-1 border-b border-zinc-900 px-4 py-2 text-xs text-zinc-500">
              <button className="hover:text-zinc-200" onClick={() => setCurrentFolderId(null)}>根目录</button>
              {breadcrumbs.map((folder) => (
                <span key={folder.id} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 text-zinc-700" />
                  <button className="hover:text-zinc-200" onClick={() => setCurrentFolderId(folder.id)}>{folder.name}</button>
                </span>
              ))}
              <div className="ml-auto flex items-center gap-2">
                <span className="text-[11px] text-zinc-600">{children.length} 项</span>
                <div className="flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
                  <button
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-sm',
                      viewMode === 'list' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
                    )}
                    onClick={() => setViewMode('list')}
                    title="列表视图"
                  >
                    <List className="h-3 w-3" />
                  </button>
                  <button
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-sm',
                      viewMode === 'grid' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
                    )}
                    onClick={() => setViewMode('grid')}
                    title="网格视图"
                  >
                    <Grid2x2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…
              </div>
            ) : searching ? (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />搜索中…
              </div>
            ) : searchResults !== null ? (
              <div className="flex-1 overflow-auto p-3">
                <p className="mb-2 text-xs text-zinc-500">搜索「{searchQuery}」：{searchResults.length} 个结果</p>
                {searchResults.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-5 text-center text-xs text-zinc-500">
                    没有匹配的文件。
                  </div>
                ) : (
                  <div className="space-y-1">
                    {searchResults.map((result) => (
                      <button
                        key={result.id}
                        className="block w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-zinc-900/40"
                        onClick={() => setCurrentFolderId(result.parentId)}
                      >
                        <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                          {result.fileType === 'folder' ? <Folder className="h-3.5 w-3.5 text-zinc-500" /> : <FileText className="h-3.5 w-3.5 text-zinc-500" />}
                          <span className="truncate">{result.name}</span>
                        </div>
                        {result.snippet && <p className="mt-1 line-clamp-2 text-[11px] text-zinc-600">{result.snippet}</p>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : children.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-6">
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 px-6 py-8 text-center text-xs text-zinc-500">
                  <FolderOpen className="h-8 w-8 text-zinc-700" />
                  目录为空，拖拽文件到此处或点击上传。
                </div>
              </div>
            ) : viewMode === 'list' ? (
              <div className="flex-1 overflow-auto">
                <div className="grid grid-cols-[1fr_88px_88px_120px_32px] items-center gap-2 border-b border-zinc-900 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  <span>名称</span>
                  <span>类型</span>
                  <span>大小</span>
                  <span>修改时间</span>
                  <span />
                </div>
                {children.map((file) => (
                  <DriveFileRow
                    key={file.id}
                    file={file}
                    selected={previewFile?.id === file.id}
                    onOpen={() => file.fileType === 'folder' ? setCurrentFolderId(file.id) : setPreviewFile(file)}
                    onDownload={() => downloadDriveFile(fileSection(file.id) === 'team' && workspaceId ? workspaceId : null, file.id, file.name).catch(() => toast.error('下载失败。'))}
                    onRename={() => setRenameTarget(file)}
                    onMove={() => setMoveTarget(file)}
                    onDelete={() => void handleDelete(file)}
                    onShare={() => setShareTarget(file)}
                    onPermission={() => setPermissionTarget(file)}
                  />
                ))}
              </div>
            ) : (
              <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-auto p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {children.map((file) => (
                  <DriveFileCard
                    key={file.id}
                    file={file}
                    selected={previewFile?.id === file.id}
                    onOpen={() => file.fileType === 'folder' ? setCurrentFolderId(file.id) : setPreviewFile(file)}
                    onDownload={() => downloadDriveFile(fileSection(file.id) === 'team' && workspaceId ? workspaceId : null, file.id, file.name).catch(() => toast.error('下载失败。'))}
                    onRename={() => setRenameTarget(file)}
                    onMove={() => setMoveTarget(file)}
                    onDelete={() => void handleDelete(file)}
                    onShare={() => setShareTarget(file)}
                    onPermission={() => setPermissionTarget(file)}
                  />
                ))}
              </div>
            )}
          </section>
        </Panel>
        {previewFile && (
          <>
            <Separator className="w-px bg-zinc-900" />
            <Panel id="drivePreview" defaultSize="36%" minSize="24%">
              <DriveFilePreview file={previewFile} workspaceId={workspaceId ?? null} onClose={() => setPreviewFile(null)} />
            </Panel>
          </>
        )}
      </Group>
      )}

      {permissionTarget && (
        <DrivePermissionDialog
          file={permissionTarget}
          scope={fileSection(permissionTarget.id) === 'team' && workspaceId ? { kind: 'team', workspaceId } : { kind: 'personal' }}
          onClose={() => setPermissionTarget(null)}
        />
      )}

      {shareTarget && (
        <DriveShareDialog
          file={shareTarget}
          scope={fileSection(shareTarget.id) === 'team' && workspaceId ? { kind: 'team', workspaceId } : { kind: 'personal' }}
          onClose={() => setShareTarget(null)}
        />
      )}

      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        onSubmit={(name) => void handleCreateFolder(name)}
      />

      <RenameDialog
        file={renameTarget}
        onOpenChange={(open) => { if (!open) setRenameTarget(null) }}
        onSubmit={(name) => { if (renameTarget) void handleRename(renameTarget, name) }}
      />

      <MoveDialog
        file={moveTarget}
        teamFolders={teamFiles.filter((f) => f.fileType === 'folder')}
        personalFolders={personalFiles.filter((f) => f.fileType === 'folder')}
        fileSection={moveTarget ? fileSection(moveTarget.id) : 'personal'}
        workspaceId={workspaceId ?? null}
        onClose={() => setMoveTarget(null)}
        onSubmit={(parentId, targetWorkspaceId) => { if (moveTarget) void handleMove(moveTarget, parentId, targetWorkspaceId) }}
      />
    </div>
  )
}

// ---------- 目录树 ----------

function DriveTree({
  teamFolders,
  personalFolders,
  workspaceId,
  currentFolderId,
  activeSection,
  onSelect,
}: {
  teamFolders: DriveFileRecord[]
  personalFolders: DriveFileRecord[]
  workspaceId?: string
  currentFolderId: string | null
  activeSection: FileSection
  onSelect: (folderId: string | null, section?: FileSection) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const childrenOf = useCallback(
    (parentId: string | null, folders: DriveFileRecord[]) =>
      folders.filter((f) => f.parentId === parentId),
    [],
  )

  const renderNode = (folder: DriveFileRecord, depth: number, folders: DriveFileRecord[], section: FileSection) => {
    const isExpanded = expanded.has(folder.id)
    const childFolders = childrenOf(folder.id, folders)
    return (
      <div key={folder.id}>
        <button
          className={cn(
            'group flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left transition-colors',
            currentFolderId === folder.id
              ? 'bg-zinc-900/80 text-zinc-100'
              : 'text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200',
          )}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => { onSelect(folder.id, section); setExpanded((prev) => { const next = new Set(prev); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next }) }}
        >
          <ChevronRight className={cn('h-3 w-3 shrink-0 text-zinc-600 transition-transform', isExpanded && 'rotate-90')} />
          <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <span className="truncate text-xs">{folder.name}</span>
        </button>
        {isExpanded && childFolders.map((child) => renderNode(child, depth + 1, folders, section))}
      </div>
    )
  }

  const renderSection = (label: string, folders: DriveFileRecord[], section: FileSection, hint?: string) => (
    <div>
      <div
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
          hint ? 'cursor-default text-zinc-500' : 'cursor-pointer',
          !hint && activeSection === section && currentFolderId === null
            ? 'bg-zinc-900/80 text-zinc-100'
            : 'text-zinc-500 hover:text-zinc-300',
        )}
        onClick={() => { if (!hint) onSelect(null, section) }}
      >
        <Users className="h-3.5 w-3.5 text-zinc-500" />
        <span>{label}</span>
      </div>
      {hint ? (
        <p className="px-2.5 pb-2 pt-0.5 text-[11px] leading-4 text-zinc-600">{hint}</p>
      ) : (
        childrenOf(null, folders).map((folder) => renderNode(folder, 0, folders, section))
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-0.5 p-1.5">
      {renderSection(
        '协作目录',
        teamFolders,
        'team',
        workspaceId ? undefined : '在侧边栏选择组织后，这里显示该组织的协作文件',
      )}
      <div className="my-1 border-t border-zinc-800/50" />
      {renderSection('个人目录', personalFolders, 'personal')}
    </div>
  )
}

// ---------- 文件行（操作菜单，行/卡片共用） ----------

type DriveFileActions = {
  onOpen: () => void
  onDownload: () => void
  onRename: () => void
  onMove: () => void
  onDelete: () => void
  onShare: () => void
  onPermission: () => void
}

type DriveFileSelectable = { selected?: boolean }

function DriveFileActionsMenu({ file, actions }: { file: DriveFileRecord; actions: DriveFileActions }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-md text-zinc-500 opacity-0 hover:bg-zinc-900 hover:text-zinc-200 group-hover:opacity-100"
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={actions.onOpen}>{file.fileType === 'folder' ? '打开' : '预览'}</DropdownMenuItem>
        {file.fileType === 'file' && <DropdownMenuItem onClick={actions.onDownload}><Download className="mr-2 h-3.5 w-3.5" />下载</DropdownMenuItem>}
        <DropdownMenuItem onClick={actions.onRename}><Pencil className="mr-2 h-3.5 w-3.5" />重命名</DropdownMenuItem>
        <DropdownMenuItem onClick={actions.onMove}><FolderInput className="mr-2 h-3.5 w-3.5" />移动到</DropdownMenuItem>
        {file.fileType === 'file' && <DropdownMenuItem onClick={actions.onShare}><Share2 className="mr-2 h-3.5 w-3.5" />分享</DropdownMenuItem>}
        <DropdownMenuItem onClick={actions.onPermission}><Shield className="mr-2 h-3.5 w-3.5" />权限</DropdownMenuItem>
        <DropdownMenuItem className="text-rose-300 focus:bg-rose-500/10 focus:text-rose-100" onClick={actions.onDelete}><Trash2 className="mr-2 h-3.5 w-3.5" />删除</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------- 文件行（列表视图） ----------

function DriveFileRow({ file, selected, onOpen, onDownload, onRename, onMove, onDelete, onShare, onPermission }: DriveFileActions & DriveFileSelectable & { file: DriveFileRecord }) {
  const Icon = fileIconFor(file)
  return (
    <div
      className={cn(
        'group grid grid-cols-[1fr_88px_88px_120px_32px] items-center gap-2 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-900/40 hover:text-zinc-200',
        selected && 'bg-zinc-900/60 text-zinc-100',
      )}
      onClick={onOpen}
      role="button"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <span className="truncate">{file.name}</span>
      </span>
      <span className="truncate text-[11px] text-zinc-600">{file.fileType === 'folder' ? '文件夹' : '文件'}</span>
      <span className="truncate text-[11px] text-zinc-600">{file.fileType === 'folder' ? '—' : formatSize(file.sizeBytes)}</span>
      <span className="truncate text-[11px] text-zinc-600">{formatTime(file.updatedAt)}</span>
      <DriveFileActionsMenu file={file} actions={{ onOpen, onDownload, onRename, onMove, onDelete, onShare, onPermission }} />
    </div>
  )
}

// ---------- 文件卡片（网格视图） ----------

function DriveFileCard({ file, selected, onOpen, onDownload, onRename, onMove, onDelete, onShare, onPermission }: DriveFileActions & DriveFileSelectable & { file: DriveFileRecord }) {
  const Icon = fileIconFor(file)
  return (
    <div
      className={cn(
        'group relative flex cursor-pointer flex-col gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 p-2.5 transition-colors hover:bg-zinc-900/40',
        selected && 'bg-zinc-900/60 ring-1 ring-inset ring-zinc-700',
      )}
    >
      <button className="flex min-h-0 flex-1 flex-col items-start gap-1 text-left" onClick={onOpen}>
        <Icon className="h-5 w-5 text-zinc-500" />
        <span className="line-clamp-2 w-full break-all text-[11px] font-medium text-zinc-200">{file.name}</span>
        <span className="text-[10px] text-zinc-600">
          {file.fileType === 'folder' ? '文件夹' : formatSize(file.sizeBytes)}
        </span>
      </button>
      <div className="flex items-center justify-between text-[10px] text-zinc-600">
        <span>{formatTime(file.updatedAt)}</span>
        <DriveFileActionsMenu file={file} actions={{ onOpen, onDownload, onRename, onMove, onDelete, onShare, onPermission }} />
      </div>
    </div>
  )
}

// ---------- 云节点文件只读视图（直接读 R2 前缀；无上传/新建/重命名/删除） ----------

function CloudFilesPanel({
  workspaceId,
  path,
  breadcrumbs,
  entries,
  loading,
  onNavigate,
}: {
  workspaceId: string | null
  path: string
  breadcrumbs: string[]
  entries: CloudDriveFileEntry[]
  loading: boolean
  onNavigate: (path: string) => void
}) {
  const [selected, setSelected] = useState<CloudDriveFileEntry | null>(null)
  const sorted = useMemo(() => [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  }), [entries])

  // 导航目录或切换 scope 时清空选中预览
  useEffect(() => { setSelected(null) }, [path, workspaceId])

  const handleOpen = (entry: CloudDriveFileEntry) => {
    if (entry.kind === 'folder') {
      onNavigate(entry.key)
    } else {
      setSelected(entry)
    }
  }

  return (
    <Group orientation="horizontal" className="min-h-0 flex-1">
      <Panel id="cloudFiles" defaultSize="62%" minSize="40%">
        <section className="flex h-full min-h-0 flex-col">
          {/* 面包屑（虚拟目录层级）+ 来源标注 */}
          <div className="flex shrink-0 items-center gap-1 border-b border-zinc-900 px-4 py-2 text-xs text-zinc-500">
            <button className="hover:text-zinc-200" onClick={() => onNavigate('')}>云节点文件</button>
            {breadcrumbs.map((segment, index) => (
              <span key={`${segment}-${index}`} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-zinc-700" />
                <button
                  className="hover:text-zinc-200"
                  onClick={() => onNavigate(breadcrumbs.slice(0, index + 1).join('/'))}
                >{segment}</button>
              </span>
            ))}
            <span className="ml-auto flex items-center gap-1">
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">云节点执行文件</span>
              <span className="text-[11px] text-zinc-600">{sorted.length} 项</span>
            </span>
          </div>

          {loading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 px-6 py-8 text-center text-xs text-zinc-500">
                <FolderOpen className="h-8 w-8 text-zinc-700" />
                暂无云节点文件——在 Wemux 云节点执行的任务/工作区文件会显示在这里（只读）。
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <div className="grid grid-cols-[1fr_88px_88px_160px] items-center gap-2 border-b border-zinc-900 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                <span>名称</span>
                <span>类型</span>
                <span>大小</span>
                <span>修改时间</span>
              </div>
              {sorted.map((entry) => (
                <div
                  key={entry.key}
                  className={cn(
                    'group grid grid-cols-[1fr_88px_88px_160px] items-center gap-2 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-900/40 hover:text-zinc-200',
                    selected?.key === entry.key && 'bg-zinc-900/60 text-zinc-100',
                  )}
                  onClick={() => handleOpen(entry)}
                  role="button"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {entry.kind === 'folder'
                      ? <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      : <FileIcon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />}
                    <span className="truncate">{entry.name}</span>
                  </span>
                  <span className="truncate text-[11px] text-zinc-600">{entry.kind === 'folder' ? '文件夹' : '文件'}</span>
                  <span className="truncate text-[11px] text-zinc-600">{entry.kind === 'folder' ? '—' : formatSize(entry.sizeBytes)}</span>
                  <span className="truncate text-[11px] text-zinc-600">{entry.updatedAt ? formatTime(entry.updatedAt) : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </Panel>
      {selected && selected.kind === 'file' && (
        <>
          <Separator className="w-px bg-zinc-900" />
          <Panel id="cloudFilePreview" defaultSize="38%" minSize="28%">
            <CloudFilePreview
              workspaceId={workspaceId}
              key={selected.key}
              name={selected.name}
              sizeBytes={selected.sizeBytes}
              onClose={() => setSelected(null)}
            />
          </Panel>
        </>
      )}
    </Group>
  )
}

// ---------- 对话框 ----------

function CreateFolderDialog({ open, onOpenChange, onSubmit }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-sm">
        <DialogHeader><DialogTitle>新建文件夹</DialogTitle></DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <Input
            autoFocus
            className="h-9 rounded-lg border-zinc-800 bg-zinc-950"
            placeholder="文件夹名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) { onSubmit(name.trim()); setName(''); onOpenChange(false) } }}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400"
            >取消</Button>
            <Button
              disabled={!name.trim()}
              onClick={() => { onSubmit(name.trim()); setName(''); onOpenChange(false) }}
              className="h-8 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
            >创建</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RenameDialog({ file, onOpenChange, onSubmit }: {
  file: DriveFileRecord | null
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState('')
  useEffect(() => { if (file) setName(file.name) }, [file])
  if (!file) return null
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-sm">
        <DialogHeader><DialogTitle>重命名</DialogTitle></DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <Input
            autoFocus
            className="h-9 rounded-lg border-zinc-800 bg-zinc-950"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) { onSubmit(name.trim()); onOpenChange(false) } }}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400"
            >取消</Button>
            <Button
              disabled={!name.trim()}
              onClick={() => { onSubmit(name.trim()); onOpenChange(false) }}
              className="h-8 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
            >保存</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------- 移动到（目标目录选择器：协作目录 + 个人目录 双区，跨区移动按权限由 server 校验） ----------

type MoveTarget = { parentId: string | null; workspaceId: string | null }

function MoveDialog({ file, teamFolders, personalFolders, fileSection, workspaceId, onClose, onSubmit }: {
  file: DriveFileRecord | null
  /** 协作目录文件夹（当前全局组织） */
  teamFolders: DriveFileRecord[]
  /** 个人目录文件夹 */
  personalFolders: DriveFileRecord[]
  /** 被移动文件当前所在区（跨区提示用） */
  fileSection: FileSection
  /** 当前全局协作空间；null = 无协作空间（只显示个人目录） */
  workspaceId: string | null
  onClose: () => void
  onSubmit: (parentId: string | null, targetWorkspaceId: string | null) => void
}) {
  const [target, setTarget] = useState<MoveTarget | null>(null)
  useEffect(() => { setTarget(null) }, [file])

  // 移动对象是文件夹时，其子孙目录不可作为目标（避免循环引用）——在文件所在区内计算
  const fileFolders = fileSection === 'team' ? teamFolders : personalFolders
  const disabledIds = useMemo(() => {
    if (!file || file.fileType !== 'folder') return new Set<string>()
    const ids = new Set<string>()
    const walk = (parentId: string) => {
      for (const f of fileFolders) {
        if (f.parentId === parentId && !ids.has(f.id)) {
          ids.add(f.id)
          walk(f.id)
        }
      }
    }
    walk(file.id)
    return ids
  }, [file, fileFolders])

  const targetPath = useMemo(() => {
    if (!target) return '未选择'
    const sectionLabel = target.workspaceId ? '协作目录' : '个人目录'
    if (!target.parentId) return `${sectionLabel} / 根目录`
    const folders = target.workspaceId ? teamFolders : personalFolders
    const trail: string[] = []
    let cursor: DriveFileRecord | null = folders.find((f) => f.id === target.parentId) ?? null
    const seen = new Set<string>()
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      trail.unshift(cursor.name)
      cursor = folders.find((f) => f.id === cursor!.parentId) ?? null
    }
    return `${sectionLabel} / ${trail.join(' / ')}`
  }, [target, teamFolders, personalFolders])

  if (!file) return null

  const renderTree = (folders: DriveFileRecord[], sectionWorkspaceId: string | null) => {
    const renderNode = (folder: DriveFileRecord, depth: number) => {
      const isSelf = folder.id === file.id
      const isDisabled = isSelf || disabledIds.has(folder.id)
      const childFolders = folders.filter((f) => f.parentId === folder.id)
      return (
        <div key={folder.id}>
          <button
            type="button"
            disabled={isDisabled}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs transition-colors',
              isDisabled
                ? 'cursor-not-allowed text-zinc-700'
                : target?.parentId === folder.id && target.workspaceId === sectionWorkspaceId
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200',
            )}
            style={{ paddingLeft: 10 + depth * 14 }}
            onClick={() => setTarget({ parentId: folder.id, workspaceId: sectionWorkspaceId })}
            title={isDisabled ? (isSelf ? '不能移动到自身' : '不能移动到自身的子目录') : undefined}
          >
            <Folder className={cn('h-3.5 w-3.5 shrink-0', isDisabled ? 'text-zinc-800' : 'text-zinc-500')} />
            <span className="truncate">{folder.name}</span>
          </button>
          {childFolders.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }
    return (
      <>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors',
            target?.parentId === null && target.workspaceId === sectionWorkspaceId
              ? 'bg-zinc-800 text-zinc-100'
              : 'text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200',
          )}
          onClick={() => setTarget({ parentId: null, workspaceId: sectionWorkspaceId })}
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <span>根目录</span>
        </button>
        {folders.filter((f) => f.parentId === null).map((folder) => renderNode(folder, 0))}
      </>
    )
  }

  const movingAcrossScopes = target !== null && target.workspaceId !== (fileSection === 'team' ? workspaceId : null)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-sm">
        <DialogHeader><DialogTitle>移动「{file.name}」到</DialogTitle></DialogHeader>
        <div className="flex max-h-[50vh] flex-col gap-3 px-5 py-4">
          <div className="flex-1 space-y-2 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-1.5">
            {workspaceId && (
              <div>
                <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">协作目录</p>
                <div className="space-y-0.5">{renderTree(teamFolders, workspaceId)}</div>
              </div>
            )}
            <div>
              <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">个人目录</p>
              <div className="space-y-0.5">{renderTree(personalFolders, null)}</div>
            </div>
          </div>
          {movingAcrossScopes && (
            <p className="text-[11px] leading-4 text-amber-400/80">
              {target?.workspaceId
                ? '将移到协作空间：文件分享给该空间成员，归属不变。'
                : '将转为你的个人文件：需管理权限，原协作者与分享链接将一并移除。'}
            </p>
          )}
          <p className="text-[11px] text-zinc-600">目标位置：<span className="text-zinc-300">{targetPath}</span></p>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={onClose}
              className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400"
            >取消</Button>
            <Button
              disabled={!target}
              onClick={() => { if (target) { onSubmit(target.parentId, target.workspaceId); onClose() } }}
              className="h-8 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
            >移动</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
