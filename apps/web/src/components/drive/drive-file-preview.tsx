// [INPUT]: DriveFileRecord + 当前 scope
// [OUTPUT]: 内嵌只读预览面板（图片/视频直出、Markdown 渲染、HTML sandbox iframe、代码高亮、其他下载提示）
// [POS]: Drive 三栏布局的第三栏；HTML 走 sandbox iframe（禁脚本）防 XSS；代码/文本走 files/file-content-view 共享渲染层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Download, Loader2, X } from 'lucide-react'
import type { DriveFileRecord } from '@shared/types'
import { authFetch } from '../../lib/api/client'
import { downloadDriveFile, previewDriveFileUrl } from '../../lib/api/methods/drive'
import { Button } from '../ui/button'
import { CodeContentView, ImageContentView, isCodeLikeFileName } from '../files/file-content-view'

const isTextual = (file: DriveFileRecord) => {
  if (file.contentType === 'document' || file.contentType === 'code') return true
  const name = file.name.toLowerCase()
  return isCodeLikeFileName(name) || file.mimeType?.startsWith('text/') || /\.(md|html?|txt|json|csv|xml|yml|yaml|log)$/.test(name)
}

// 扩展名匹配 .md（含 .markdown）；修复 /^.$/ 只能命中恰名为「.md」的文件导致正常 .md 永不渲染的问题
export const isMarkdown = (file: { name: string }) => /\.md$/i.test(file.name) || /\.markdown$/i.test(file.name)

const slugify = (text: string) =>
  text.trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

/** 从 Markdown 文本提取标题大纲（TOC） */
const extractToc = (text: string): Array<{ level: number; id: string; text: string }> => {
  const toc: Array<{ level: number; id: string; text: string }> = []
  for (const line of text.split('\n')) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line)
    if (match) {
      const raw = match[2].replace(/[#*`>\[\]()!_-]/g, '').trim()
      toc.push({ level: match[1].length, id: slugify(raw), text: raw })
    }
  }
  return toc
}

const markdownComponents = {
  h1: (props: { children?: React.ReactNode }) => <h1 id={slugify(String(props.children ?? ''))} {...props} />,
  h2: (props: { children?: React.ReactNode }) => <h2 id={slugify(String(props.children ?? ''))} {...props} />,
  h3: (props: { children?: React.ReactNode }) => <h3 id={slugify(String(props.children ?? ''))} {...props} />,
  h4: (props: { children?: React.ReactNode }) => <h4 id={slugify(String(props.children ?? ''))} {...props} />,
  h5: (props: { children?: React.ReactNode }) => <h5 id={slugify(String(props.children ?? ''))} {...props} />,
  h6: (props: { children?: React.ReactNode }) => <h6 id={slugify(String(props.children ?? ''))} {...props} />,
}

const isHtml = (file: DriveFileRecord) => file.mimeType === 'text/html' || /\.html?$/i.test(file.name)

const formatSize = (bytes: number | null) => {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function DriveFilePreview({
  file,
  workspaceId,
  onClose,
}: {
  file: DriveFileRecord
  workspaceId: string | null
  onClose: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false
    setUrl(null)
    setText(null)
    setLoading(true)
    void (async () => {
      try {
        if (file.contentType === 'image' || file.contentType === 'video') {
          const objectUrl = await previewDriveFileUrl(workspaceId, file.id)
          if (cancelled) {
            URL.revokeObjectURL(objectUrl)
            return
          }
          revoked = objectUrl
          setUrl(objectUrl)
        } else if (isTextual(file)) {
          const path = workspaceId
            ? `/api/collab/workspaces/${workspaceId}/drive/${file.id}/download`
            : `/api/my/drive/${file.id}/download`
          const response = await authFetch(path)
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
  }, [file.id, workspaceId, file.contentType])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-900 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium text-zinc-200">{file.name}</span>
          <span className="shrink-0 text-[11px] text-zinc-600">{formatSize(file.sizeBytes)}</span>
          {file.version ? <span className="shrink-0 text-[11px] text-zinc-600">v{file.version}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            title="下载"
            onClick={() => downloadDriveFile(workspaceId, file.id, file.name)}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            title="关闭"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : file.contentType === 'image' && url ? (
          <ImageContentView src={url} alt={file.name} />
        ) : file.contentType === 'video' && url ? (
          <video src={url} controls className="mx-auto max-h-[65vh] w-full" />
        ) : isHtml(file) && text ? (
          <iframe sandbox="" srcDoc={text} title={file.name} className="h-full min-h-[60vh] w-full border-0 bg-white" />
        ) : isMarkdown(file) && text ? (
          <div className="flex h-full min-h-0">
            <MarkdownToc text={text} />
            <article className="markdown-body prose prose-sm max-w-none flex-1 p-6 prose-invert prose-headings:text-zinc-50 prose-p:text-zinc-300 prose-li:text-zinc-300 prose-strong:text-zinc-100 prose-blockquote:text-zinc-400 prose-code:text-zinc-100 prose-pre:border prose-pre:border-zinc-800 prose-pre:bg-zinc-950/70">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{text}</ReactMarkdown>
            </article>
          </div>
        ) : text !== null ? (
          <CodeContentView fileName={file.name} content={text} />
        ) : (
          <div className="flex flex-col items-center gap-3 py-16 text-sm text-zinc-500">
            <span>该文件类型暂不支持在线预览，请下载查看。</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => downloadDriveFile(workspaceId, file.id, file.name)}
              className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              下载
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** MD 大纲 TOC 侧栏：点击锚点滚动 */
function MarkdownToc({ text }: { text: string }) {
  const toc = useMemo(() => extractToc(text), [text])
  if (toc.length < 2) return null
  return (
    <div className="hidden w-44 shrink-0 overflow-auto border-r border-zinc-900 p-3 lg:block">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-600">大纲</div>
      <div className="flex flex-col gap-1">
        {toc.map((item) => (
          <a
            key={`${item.level}-${item.id}`}
            href={`#${item.id}`}
            onClick={(event) => {
              event.preventDefault()
              document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            className="truncate rounded px-1.5 py-0.5 text-[11px] text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
            style={{ paddingLeft: `${8 + (item.level - 1) * 10}px` }}
          >
            {item.text}
          </a>
        ))}
      </div>
    </div>
  )
}
