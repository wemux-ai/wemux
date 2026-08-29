// [INPUT]: 云节点文件条目（R2 前缀只读视图，无 DB contentType）+ 下载 key
// [OUTPUT]: 内嵌只读预览（图片直出 / Markdown 渲染 / 代码文本高亮 / 其他下载提示）+ 来源标注
// [POS]: Drive 云节点文件只读视图的预览栏；来源标注「Wemux 云节点（R2）· 单一权威 = 执行位置」
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Download, File as FileIcon, Loader2, X } from 'lucide-react'
import { authFetch } from '../../lib/api/client'
import { downloadCloudDriveFile, downloadMyCloudDriveFile } from '../../lib/api/methods/drive'
import { Button } from '../ui/button'
import { CodeContentView, ImageContentView, isCodeLikeFileName } from '../files/file-content-view'

type CloudFileKind = 'image' | 'markdown' | 'text' | 'other'

const classifyCloudFile = (name: string): CloudFileKind => {
  const lower = name.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) return 'image'
  if (/\.(md|markdown)$/.test(lower)) return 'markdown'
  if (isCodeLikeFileName(name) || /\.(txt|html?|json|csv|xml|yml|yaml|log|md)$/.test(lower)) return 'text'
  return 'other'
}

const formatSize = (bytes: number | null) => {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function CloudFilePreview({
  workspaceId,
  key,
  name,
  sizeBytes,
  onClose,
}: {
  workspaceId: string | null
  key: string
  name: string
  sizeBytes: number | null
  onClose: () => void
}) {
  const [kind] = useState<CloudFileKind>(() => classifyCloudFile(name))
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const downloadPath = workspaceId
    ? `/api/collab/workspaces/${workspaceId}/drive/cloud-files/download?key=${encodeURIComponent(key)}`
    : `/api/my/drive/cloud-files/download?key=${encodeURIComponent(key)}`

  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        if (kind === 'image') {
          const response = await authFetch(downloadPath)
          if (response.ok) {
            const blob = await response.blob()
            const objectUrl = URL.createObjectURL(blob)
            if (cancelled) {
              URL.revokeObjectURL(objectUrl)
              return
            }
            revoked = objectUrl
            setImageUrl(objectUrl)
          }
        } else if (kind === 'markdown' || kind === 'text') {
          const response = await authFetch(downloadPath)
          if (response.ok) {
            const content = await response.text()
            if (!cancelled) setText(content)
          }
        }
      } catch {
        // 预览失败静默，界面展示下载提示
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [key, kind, downloadPath])

  const handleDownload = () => {
    if (workspaceId) {
      void downloadCloudDriveFile(workspaceId, key, name).catch(() => {})
    } else {
      void downloadMyCloudDriveFile(key, name).catch(() => {})
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 头部：文件名 + 来源标注 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-900 px-4 py-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-100">{name}</span>
        <span className="shrink-0 text-[10px] text-zinc-600">{formatSize(sizeBytes)}</span>
        <button
          className="rounded p-0.5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
          onClick={onClose}
          title="关闭预览"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-900 bg-zinc-950/60 px-4 py-1.5 text-[10px] text-zinc-500">
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">来源：Wemux 云节点（R2）</span>
        <span>单一权威 = 执行位置，本地节点执行的文件不在此显示</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…
          </div>
        ) : kind === 'image' && imageUrl ? (
          <ImageContentView src={imageUrl} alt={name} />
        ) : kind === 'markdown' && text ? (
          <div className="p-4 text-xs text-zinc-300">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        ) : kind === 'text' && text ? (
          <CodeContentView fileName={name} content={text} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-xs text-zinc-500">
            <FileIcon className="h-8 w-8 text-zinc-700" />
            该文件暂不支持预览，请下载查看。
            <Button
              size="sm"
              onClick={handleDownload}
              className="h-8 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />下载
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
