import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './dialog'

export interface PreviewableImageGalleryItem {
  src: string
  alt: string
  caption?: string
}

interface PreviewableImageProps {
  src: string
  alt: string
  caption?: string
  triggerClassName?: string
  imageClassName?: string
  previewImageClassName?: string
  dialogClassName?: string
  galleryItems?: PreviewableImageGalleryItem[]
  galleryIndex?: number
}

export function PreviewableImage({
  src,
  alt,
  caption,
  triggerClassName,
  imageClassName,
  previewImageClassName,
  dialogClassName,
  galleryItems,
  galleryIndex = 0,
}: PreviewableImageProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const standaloneItem = useMemo<PreviewableImageGalleryItem>(() => ({
    src,
    alt,
    caption,
  }), [alt, caption, src])
  const resolvedGalleryItems = useMemo(() => {
    const filteredItems = (galleryItems ?? []).filter((item) => item.src)
    return filteredItems.length > 0 ? filteredItems : [standaloneItem]
  }, [galleryItems, standaloneItem])
  const lastGalleryIndex = Math.max(0, resolvedGalleryItems.length - 1)
  const initialGalleryIndex = Math.min(Math.max(galleryIndex, 0), lastGalleryIndex)
  const [activeIndex, setActiveIndex] = useState(initialGalleryIndex)

  useEffect(() => {
    if (!open) {
      setActiveIndex(initialGalleryIndex)
      return
    }

    if (activeIndex > lastGalleryIndex) {
      setActiveIndex(lastGalleryIndex)
    }
  }, [activeIndex, initialGalleryIndex, lastGalleryIndex, open])

  useEffect(() => {
    if (!open || resolvedGalleryItems.length <= 1) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setActiveIndex((currentIndex) => (
          currentIndex === 0 ? resolvedGalleryItems.length - 1 : currentIndex - 1
        ))
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        setActiveIndex((currentIndex) => (
          currentIndex === resolvedGalleryItems.length - 1 ? 0 : currentIndex + 1
        ))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, resolvedGalleryItems.length])

  const activeItem = resolvedGalleryItems[activeIndex] ?? standaloneItem
  const hasGallery = resolvedGalleryItems.length > 1
  const title = activeItem.alt.trim() || t('common.imagePreviewTitle', { defaultValue: '图片预览' })
  const description = activeItem.caption || t('common.imagePreviewHint', { defaultValue: '按 Esc、点击遮罩，或使用关闭按钮退出预览。' })
  const moveToPrevious = () => {
    setActiveIndex((currentIndex) => (
      currentIndex === 0 ? resolvedGalleryItems.length - 1 : currentIndex - 1
    ))
  }
  const moveToNext = () => {
    setActiveIndex((currentIndex) => (
      currentIndex === resolvedGalleryItems.length - 1 ? 0 : currentIndex + 1
    ))
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setActiveIndex(initialGalleryIndex)
          setOpen(true)
        }}
        className={cn('block cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-zinc-400/60 focus:ring-offset-0', triggerClassName)}
        aria-label={t('common.previewImage', { defaultValue: '预览图片' })}
      >
        <img src={src} alt={alt} className={imageClassName} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className={cn(
            'grid max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[min(calc(100vw-1rem),72rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-zinc-800 bg-[#050506] p-0 text-zinc-100 shadow-2xl shadow-black/60 sm:max-h-[94vh] sm:w-full sm:max-w-[min(96vw,72rem)]',
            dialogClassName,
          )}
        >
          <DialogHeader className="min-w-0 border-b border-zinc-800/80 bg-zinc-950/90 px-3 py-2.5 text-left sm:px-4 sm:py-3">
            <div className="flex min-w-0 items-start justify-between gap-2 sm:items-center sm:gap-3">
              <div className="min-w-0">
                <DialogTitle className="truncate text-sm font-medium text-zinc-100">{title}</DialogTitle>
                <DialogDescription className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500 sm:line-clamp-none">
                  {description}
                </DialogDescription>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                {hasGallery ? (
                  <>
                    <span className="hidden text-xs text-zinc-500 sm:inline">
                      {activeIndex + 1} / {resolvedGalleryItems.length}
                    </span>
                    <button
                      type="button"
                      onClick={moveToPrevious}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100 transition-colors hover:bg-zinc-800 sm:h-9 sm:w-9"
                      aria-label={t('common.previousImage', { defaultValue: '上一张' })}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={moveToNext}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100 transition-colors hover:bg-zinc-800 sm:h-9 sm:w-9"
                      aria-label={t('common.nextImage', { defaultValue: '下一张' })}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </>
                ) : null}
                <DialogClose asChild>
                  <button
                    type="button"
                    className="inline-flex h-8 shrink-0 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-100 transition-colors hover:bg-zinc-800 sm:h-9 sm:px-3 sm:text-sm"
                  >
                    {t('common.close', { defaultValue: '关闭' })}
                  </button>
                </DialogClose>
              </div>
            </div>
          </DialogHeader>

          <div className="relative flex min-h-0 items-center justify-center bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_42%),linear-gradient(180deg,rgba(3,7,18,0.94),rgba(0,0,0,0.98))] p-2 sm:p-6">
            {hasGallery ? (
              <button
                type="button"
                onClick={moveToPrevious}
                className="absolute left-4 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-700/80 bg-zinc-950/85 text-zinc-100 shadow-lg transition-colors hover:bg-zinc-900 sm:left-6"
                aria-label={t('common.previousImage', { defaultValue: '上一张' })}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            ) : null}
            <img
              src={activeItem.src}
              alt={activeItem.alt}
              className={cn('max-h-full w-auto max-w-full rounded-lg object-contain', previewImageClassName)}
            />
            {hasGallery ? (
              <button
                type="button"
                onClick={moveToNext}
                className="absolute right-4 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-700/80 bg-zinc-950/85 text-zinc-100 shadow-lg transition-colors hover:bg-zinc-900 sm:right-6"
                aria-label={t('common.nextImage', { defaultValue: '下一张' })}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
