// [INPUT]: ExecutorFileReadResult（executor 实时文件系统读取结果）
// [OUTPUT]: 只读预览（图片走 ImageContentView，其余走 CodeContentView），及截断提示条
// [POS]: 工作区文件面板的预览适配器；纯渲染逻辑已收敛到 files/file-content-view.tsx 共享层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ExecutorFileReadResult } from '@shared/types'
import { cn } from '../../lib/utils'
import { CodeContentView, getFileName, ImageContentView } from '../files/file-content-view'

type WorkspaceFilePreviewProps = {
  preview: ExecutorFileReadResult
  className?: string
}

const IMAGE_CONTENT_TYPE_PREFIX = 'image/'

export function WorkspaceFilePreview({ preview, className, searchQuery }: WorkspaceFilePreviewProps & { searchQuery?: string }) {
  const contentType = preview.contentType?.trim().toLowerCase() || ''
  const isImage = contentType.startsWith(IMAGE_CONTENT_TYPE_PREFIX) && preview.encoding === 'base64'
  const imageSrc = isImage && preview.content ? `data:${preview.contentType};base64,${preview.content}` : ''

  return (
    <div className={cn('min-h-full', className)}>
      {isImage ? (
        <ImageContentView src={imageSrc} alt={getFileName(preview.path)} />
      ) : (
        <CodeContentView fileName={preview.path} content={preview.content || ''} searchQuery={searchQuery} />
      )}
      {preview.truncated ? (
        <div className="border-t border-zinc-800 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          文件内容已截断显示。
        </div>
      ) : null}
    </div>
  )
}
