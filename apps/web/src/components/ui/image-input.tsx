import { useCallback, useMemo, useRef, useState } from 'react'
import { ImagePlus, Upload, X } from 'lucide-react'
import { getAuthHeaders, resolveApiUrl, resolveMediaUrl } from '../../lib/api'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'

export interface UploadedImage {
  id: string
  url: string
  filename: string
}

interface ImageInputProps {
  value: UploadedImage[]
  onChange: (images: UploadedImage[]) => void
  taskId?: string
  disabled?: boolean
  maxImages?: number
  placeholder?: string
}

export function ImageInput({
  value,
  onChange,
  taskId,
  disabled,
  maxImages = 5,
  placeholder = '添加图片',
}: ImageInputProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const canAddMore = value.length < maxImages
  const helperText = useMemo(() => {
    if (value.length >= maxImages) {
      return `最多上传 ${maxImages} 张参考图`
    }

    return `${placeholder} · 支持粘贴、拖拽或点击上传`
  }, [maxImages, placeholder, value.length])

  const handleFileSelect = useCallback(
    async (files: File[] | null) => {
      if (!files || files.length === 0 || disabled || isUploading) return
      if (value.length >= maxImages) return

      const remainingSlots = maxImages - value.length
      const filesToUpload = files.slice(0, remainingSlots)

      setIsUploading(true)
      try {
        let nextImages = value

        for (const file of filesToUpload) {
          if (!file.type.startsWith('image/')) continue

          const reader = new FileReader()
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })

          if (taskId) {
            const response = await fetch(resolveApiUrl(`/api/tasks/${taskId}/images`), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
              body: JSON.stringify({ image: base64, filename: file.name }),
            })
            if (!response.ok) continue
            const result = (await response.json()) as { id: string; url: string }
            nextImages = [...nextImages, { id: result.id, url: result.url, filename: file.name }]
            onChange(nextImages)
          } else {
            const blobUrl = URL.createObjectURL(file)
            nextImages = [...nextImages, { id: crypto.randomUUID(), url: blobUrl, filename: file.name }]
            onChange(nextImages)
          }
        }
      } finally {
        setIsUploading(false)
      }
    },
    [disabled, isUploading, maxImages, onChange, taskId, value],
  )

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData.items)
      const files: File[] = []
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length === 0) return

      e.preventDefault()
      await handleFileSelect(files)
    },
    [handleFileSelect],
  )

  const removeImage = (id: string) => {
    const image = value.find((item) => item.id === id)
    if (image?.url.startsWith('blob:')) {
      URL.revokeObjectURL(image.url)
    }

    onChange(value.filter((img) => img.id !== id))
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void handleFileSelect(e.target.files ? Array.from(e.target.files) : null)
    e.target.value = ''
  }

  const openPicker = () => {
    if (disabled || isUploading || !canAddMore) return
    if (inputRef.current?.showPicker) {
      inputRef.current.showPicker()
      return
    }

    inputRef.current?.click()
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    void handleFileSelect(Array.from(e.dataTransfer.files))
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleInputChange}
        disabled={disabled}
      />

      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openPicker()
          }
        }}
        onPaste={(e) => void handlePaste(e)}
        onDragEnter={(e) => {
          e.preventDefault()
          if (!disabled && canAddMore) setIsDragging(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled && canAddMore) setIsDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setIsDragging(false)
        }}
        onDrop={handleDrop}
        className={cn(
          'rounded-lg border border-dashed px-4 py-4 transition-all outline-none',
          'bg-[linear-gradient(180deg,rgba(14,14,18,0.92),rgba(10,10,12,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
          disabled && 'pointer-events-none opacity-50',
          isDragging
            ? 'border-emerald-500/60 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.2),inset_0_1px_0_rgba(255,255,255,0.04)]'
            : 'border-zinc-800 hover:border-zinc-700 hover:bg-[#101014]',
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-black/30 text-zinc-300">
                {isUploading ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-300 border-t-transparent" /> : <Upload className="h-4 w-4" />}
              </span>
              <span>{placeholder}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-500">{helperText}</p>
          </div>

          {canAddMore ? (
            <span className="inline-flex items-center rounded-full border border-zinc-800 bg-black/20 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">
              {maxImages - value.length} left
            </span>
          ) : null}
        </div>

        {value.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {value.map((img) => (
              <div key={img.id} className="group relative overflow-hidden rounded-lg border border-zinc-800 bg-black/30">
                <img
                  src={resolveMediaUrl(img.url)}
                  alt={img.filename}
                  className="aspect-[4/3] w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3 pb-2 pt-5 text-[11px] text-zinc-200">
                  <p className="truncate">{img.filename}</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeImage(img.id)
                  }}
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/70 text-zinc-100 opacity-0 transition-opacity group-hover:opacity-100"
                  disabled={disabled}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-zinc-800/80 bg-black/20 px-3 py-2.5 text-xs text-zinc-500">
            <ImagePlus className="h-4 w-4" />
            参考图会和需求描述一起进入任务理解。
          </div>
        )}
      </div>
    </div>
  )
}

interface ImageInputTriggerProps {
  onClick: () => void
  disabled?: boolean
}

export function ImageInputTrigger({ onClick, disabled }: ImageInputTriggerProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
      onClick={onClick}
      disabled={disabled}
    >
      <ImagePlus className="h-4 w-4" />
    </Button>
  )
}
