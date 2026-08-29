// [INPUT]: 个人云盘（/api/my/drive/*）文本文件；便签 = 个人空间 Markdown 文件 + 便捷入口
// [OUTPUT]: 悬浮窗笔记面板（列表 / 编辑 / 预览 / 新建 / 保存 / 删除 / 重命名 / 目录选择）
// [POS]: 悬浮窗「笔记」tab 内容；默认「便签笔记」目录（懒创建），文件选择器可切换保存目录；
//       新建走 POST text-files、保存走 PUT :id/content（保留版本历史），云盘内即为普通 .md 文件
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, Eye, FilePlus2, Folder, FolderOpen, Loader2, Pencil, Save, Trash2 } from 'lucide-react'
import type { DriveFileRecord } from '@shared/types'
import { useTranslation } from '@/lib/i18n/react'
import { api } from '@/lib/api'
import { readDriveTextContent } from '@/lib/api/methods/drive'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TaskCommentMarkdown } from '@/components/kanban/task-comment-markdown'

/** 默认便签目录名：云盘个人空间根级文件夹 */
export const DEFAULT_NOTES_FOLDER_NAME = '便签笔记'

const stripMd = (name: string) => name.replace(/\.(md|markdown)$/i, '')
const ensureMd = (name: string) => (/\.(md|markdown)$/i.test(name) ? name : `${name}.md`)

/** 文件名安全化：去掉路径分隔与文件系统非法字符，空则回退默认标题 */
export const sanitizeNoteTitle = (raw: string, fallback: string): string => {
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.(md|markdown)$/i, '')
  return cleaned || fallback
}

const formatTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function FloatingNotesPanel() {
  const { t } = useTranslation()
  const keys = 'agents.custom.floating.notes'

  const [files, setFiles] = useState<DriveFileRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState<{ title: string; content: string } | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(false)
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)

  const defaultTitle = t(`${keys}.untitled`)

  // ---------- 加载个人云盘 + 确保「便签笔记」目录 ----------
  const reload = useCallback(async (): Promise<DriveFileRecord[]> => {
    try {
      const res = await api.listMyDriveTree()
      setFiles(res.files)
      return res.files
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(`${keys}.loadFailed`))
      return []
    }
  }, [keys, t])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const all = await reload()
        if (cancelled) return
        let folderId = all.find(
          (f) => f.fileType === 'folder' && f.parentId === null && f.name === DEFAULT_NOTES_FOLDER_NAME,
        )?.id ?? null
        if (!folderId) {
          try {
            const created = await api.createMyDriveFolder({ name: DEFAULT_NOTES_FOLDER_NAME })
            if (!cancelled) folderId = created.file.id
          } catch {
            // 并发竞态（多 tab 同时建）：失败容忍，下次 reload 重新定位
          }
        }
        if (!cancelled) {
          setCurrentFolderId((current) => current ?? folderId)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reload])

  // ---------- 派生数据 ----------
  const notes = useMemo(() => {
    return files
      .filter((f) => f.fileType === 'file' && f.parentId === currentFolderId && /\.(md|markdown)$/i.test(f.name))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [files, currentFolderId])

  const currentFolder = useMemo(
    () => files.find((f) => f.id === currentFolderId) ?? null,
    [files, currentFolderId],
  )

  /** 目录树（含根目录伪项），供文件选择器展示 */
  const folderTree = useMemo(() => {
    const byParent = new Map<string | null, DriveFileRecord[]>()
    for (const f of files) {
      if (f.fileType !== 'folder') continue
      const key = f.parentId
      const list = byParent.get(key) ?? []
      list.push(f)
      byParent.set(key, list)
    }
    const rows: Array<{ file: DriveFileRecord | null; depth: number }> = [{ file: null, depth: 0 }]
    const walk = (parentId: string | null, depth: number) => {
      const kids = (byParent.get(parentId) ?? []).sort((a, b) => a.name.localeCompare(b.name))
      for (const kid of kids) {
        rows.push({ file: kid, depth })
        walk(kid.id, depth + 1)
      }
    }
    walk(null, 0)
    return rows
  }, [files])

  const dirty = saved ? title !== saved.title || content !== saved.content : title.trim() !== '' || content !== ''

  // ---------- 笔记操作 ----------
  const openNote = async (file: DriveFileRecord) => {
    if (dirty && !window.confirm(t(`${keys}.discardConfirm`))) return
    setSelectedId(file.id)
    setTitle(stripMd(file.name))
    setPreview(false)
    setContentLoading(true)
    try {
      const text = await readDriveTextContent(null, file.id)
      setContent(text)
      setSaved({ title: stripMd(file.name), content: text })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(`${keys}.readFailed`))
      setContent('')
      setSaved({ title: stripMd(file.name), content: '' })
    } finally {
      setContentLoading(false)
    }
  }

  const startNew = () => {
    if (dirty && !window.confirm(t(`${keys}.discardConfirm`))) return
    setSelectedId(null)
    setSaved(null)
    setTitle(defaultTitle)
    setContent('')
    setPreview(false)
  }

  const handleSave = async () => {
    if (saving) return
    const finalTitle = sanitizeNoteTitle(title, defaultTitle)
    setSaving(true)
    try {
      if (selectedId) {
        const existing = files.find((f) => f.id === selectedId)
        if (!existing) throw new Error(t(`${keys}.saveFailed`))
        let file = existing
        const newName = ensureMd(finalTitle)
        if (newName !== existing.name) {
          const renamed = await api.renameMyDriveFile(selectedId, newName)
          file = renamed.file
        }
        const res = await api.saveMyDriveTextContent(selectedId, content)
        file = res.file
        setFiles((prev) => prev.map((f) => (f.id === file.id ? file : f)))
        setTitle(stripMd(file.name))
        setSaved({ title: stripMd(file.name), content })
        toast.success(t(`${keys}.savedToast`))
      } else {
        const created = await api.createMyDriveTextFile({
          name: ensureMd(finalTitle),
          content,
          parentId: currentFolderId ?? undefined,
        })
        setFiles((prev) => [...prev, created.file])
        setSelectedId(created.file.id)
        setTitle(stripMd(created.file.name))
        setSaved({ title: stripMd(created.file.name), content })
        toast.success(t(`${keys}.createdToast`))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(`${keys}.saveFailed`))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (file: DriveFileRecord) => {
    if (!window.confirm(t(`${keys}.deleteConfirm`))) return
    try {
      await api.deleteMyDriveFile(file.id)
      setFiles((prev) => prev.filter((f) => f.id !== file.id))
      if (selectedId === file.id) {
        setSelectedId(null)
        setSaved(null)
        setTitle('')
        setContent('')
      }
      toast.success(t(`${keys}.deletedToast`))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(`${keys}.deleteFailed`))
    }
  }

  const switchFolder = (folderId: string | null) => {
    if (dirty && !window.confirm(t(`${keys}.discardConfirm`))) return
    setCurrentFolderId(folderId)
    setSelectedId(null)
    setSaved(null)
    setTitle('')
    setContent('')
    setFolderPickerOpen(false)
  }

  const noteRows = notes.length > 0
    ? notes
    : []

  return (
    <div className="flex h-full min-h-0">
      {/* 左：笔记列表 + 目录选择 */}
      <div className="flex w-44 shrink-0 flex-col border-r border-zinc-900 md:w-52">
        <div className="flex shrink-0 items-center gap-1 border-b border-zinc-900 px-2 py-1.5">
          <Popover open={folderPickerOpen} onOpenChange={setFolderPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
                title={t(`${keys}.chooseFolder`)}
              >
                {currentFolder ? <FolderOpen className="size-3.5 shrink-0 text-zinc-500" /> : <Folder className="size-3.5 shrink-0 text-zinc-500" />}
                <span className="truncate">{currentFolder?.name ?? t(`${keys}.folderRoot`)}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" className="w-64 p-1.5">
              <p className="px-2 py-1 text-[11px] font-medium text-zinc-500">{t(`${keys}.chooseFolder`)}</p>
              <div className="max-h-64 overflow-y-auto">
                {folderTree.map(({ file, depth }) => (
                  <button
                    key={file?.id ?? 'root'}
                    type="button"
                    onClick={() => switchFolder(file?.id ?? null)}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900',
                      currentFolderId === (file?.id ?? null) && 'bg-zinc-900 text-zinc-100',
                    )}
                    style={{ paddingLeft: `${8 + depth * 14}px` }}
                  >
                    {file ? <Folder className="size-3.5 shrink-0 text-zinc-500" /> : <FolderOpen className="size-3.5 shrink-0 text-zinc-500" />}
                    <span className="min-w-0 flex-1 truncate">{file?.name ?? t(`${keys}.folderRoot`)}</span>
                    {currentFolderId === (file?.id ?? null) ? <Check className="size-3.5 shrink-0 text-zinc-400" /> : null}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon-sm" onClick={startNew} title={t(`${keys}.newNote`)}>
            <FilePlus2 className="size-3.5" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-4 animate-spin text-zinc-600" />
            </div>
          ) : noteRows.length === 0 ? (
            <p className="px-3 py-4 text-xs leading-relaxed text-zinc-600">{t(`${keys}.emptyList`)}</p>
          ) : (
            <ul>
              {noteRows.map((note) => (
                <li key={note.id}>
                  <div
                    className={cn(
                      'group flex cursor-pointer items-center gap-1 border-b border-zinc-900/60 px-2 py-2 transition-colors hover:bg-zinc-900/60',
                      selectedId === note.id && 'bg-zinc-900',
                    )}
                    onClick={() => void openNote(note)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate text-xs', selectedId === note.id ? 'text-zinc-100' : 'text-zinc-300')}>
                        {stripMd(note.name)}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-zinc-600">{formatTime(note.updatedAt)}</p>
                    </div>
                    <button
                      type="button"
                      data-testid="notes-delete"
                      title={t(`${keys}.delete`)}
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleDelete(note)
                      }}
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-600 opacity-0 transition-opacity hover:bg-zinc-800 hover:text-rose-400 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 右：编辑器 / 预览 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-900 px-2 py-1.5">
          <Input
            data-testid="notes-title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={defaultTitle}
            className="h-7 min-w-0 flex-1 rounded-md border-zinc-800 bg-zinc-950 px-2 text-xs"
          />
          {dirty ? (
            <span className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
              {t(`${keys}.unsaved`)}
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPreview((v) => !v)}
            title={preview ? t(`${keys}.edit`) : t(`${keys}.preview`)}
          >
            {preview ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void handleSave()}
            disabled={saving || !dirty}
            title={t(`${keys}.save`)}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          </Button>
        </div>

        <div className="min-h-0 flex-1">
          {contentLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-4 animate-spin text-zinc-600" />
            </div>
          ) : preview ? (
            <div className="h-full overflow-y-auto px-3 py-2.5 text-sm leading-relaxed text-zinc-300">
              <TaskCommentMarkdown content={content || t(`${keys}.emptyContent`)} />
            </div>
          ) : (
            <textarea
              data-testid="notes-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={t(`${keys}.contentPlaceholder`)}
              className="h-full w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
            />
          )}
        </div>
      </div>
    </div>
  )
}
