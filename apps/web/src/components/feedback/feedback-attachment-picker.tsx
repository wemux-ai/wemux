// [INPUT]: 附件选择/上传意图（个人 Drive）
// [OUTPUT]: 图片附件上传按钮 + 已选附件列表（可移除），供聊天输入框与反馈表单复用
// [POS]: 用户侧反馈/聊天图片上传公共件；上传走 /api/my/drive，仅持引用
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { useRef, useState } from 'react'
import { ImagePlus, Loader2, Paperclip, X } from 'lucide-react'
import type { FeedbackAttachment } from '@shared/types'
import { api } from '@/lib/api'
import { useTranslation } from '@/lib/i18n/react'
import { cn } from '@/lib/utils'

export function FeedbackAttachmentPicker({
  attachments,
  onChange,
  compact,
}: {
  attachments: FeedbackAttachment[]
  onChange: (next: FeedbackAttachment[]) => void
  /** 紧凑模式：仅图片按钮（聊天输入框旁），不显示已选列表外置布局。 */
  compact?: boolean
}) {
  const { t, language } = useTranslation()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canUpload = attachments.length < 9 && !uploading

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setError('')
    try {
      const next: FeedbackAttachment[] = [...attachments]
      for (const file of Array.from(files).slice(0, 9 - attachments.length)) {
        const result = await api.uploadMyDriveFile(file, null)
        next.push({
          kind: 'drive',
          driveFileId: result.file.id,
          name: result.file.name,
          mimeType: result.file.mimeType ?? (file.type || undefined),
          sizeBytes: result.file.sizeBytes ?? file.size,
        })
      }
      onChange(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('feedback.uploadFailed'))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className={cn('flex items-center gap-2', compact ? 'shrink-0' : 'flex-wrap')}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => void handleFiles(event.target.files)}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={!canUpload}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors disabled:opacity-40',
          compact
            ? 'h-9 w-9 hover:bg-zinc-900 hover:text-zinc-200'
            : 'gap-1.5 border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[11px] hover:border-zinc-700 hover:text-zinc-300',
        )}
        aria-label={t('feedback.addImage')}
        title={t('feedback.addImage')}
      >
        {uploading ? <Loader2 className={cn('animate-spin', compact ? 'size-4' : 'size-3.5')} /> : <ImagePlus className={compact ? 'size-4' : 'size-3.5'} />}
        {!compact && (language === 'zh' ? '上传图片' : 'Upload image')}
      </button>
      {!compact && attachments.map((attachment) => (
        <span key={attachment.driveFileId} className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300">
          <Paperclip className="size-3" />
          <span className="max-w-[8rem] truncate">{attachment.name}</span>
          <button
            type="button"
            onClick={() => onChange(attachments.filter((item) => item.driveFileId !== attachment.driveFileId))}
            className="ml-0.5 text-zinc-500 hover:text-zinc-200"
            aria-label={t('feedback.removeAttachment')}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {error ? <span className="text-[11px] text-rose-400">{error}</span> : null}
    </div>
  )
}
