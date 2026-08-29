import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../../lib/utils'

const DEFAULT_COLLAPSED_HEIGHT = 320

type CollapsibleMessageBodyProps = {
  children: ReactNode
  enabled?: boolean
  contentKey?: string | number
  maxHeight?: number
  className?: string
  contentClassName?: string
  overlayClassName?: string
  toggleClassName?: string
  toggleAlignment?: 'start' | 'end'
  expandLabel?: string
  collapseLabel?: string
}

export function CollapsibleMessageBody({
  children,
  enabled = true,
  contentKey,
  maxHeight = DEFAULT_COLLAPSED_HEIGHT,
  className,
  contentClassName,
  overlayClassName,
  toggleClassName,
  toggleAlignment = 'end',
  expandLabel = '展开全文',
  collapseLabel = '收起',
}: CollapsibleMessageBodyProps) {
  const contentId = useId()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [collapsible, setCollapsible] = useState(false)

  useEffect(() => {
    setExpanded(false)
  }, [contentKey, enabled])

  useEffect(() => {
    if (!enabled) {
      setCollapsible(false)
      return
    }

    const contentNode = contentRef.current
    if (!contentNode) {
      setCollapsible(false)
      return
    }

    let frameId = 0

    // Measure the rendered height so folding follows actual layout, not character count.
    const updateCollapsible = () => {
      const nextValue = contentNode.scrollHeight > maxHeight + 1
      setCollapsible((current) => (current === nextValue ? current : nextValue))
    }

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(updateCollapsible)
    }

    scheduleUpdate()

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        window.cancelAnimationFrame(frameId)
      }
    }

    const observer = new ResizeObserver(() => {
      scheduleUpdate()
    })

    observer.observe(contentNode)

    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frameId)
    }
  }, [children, enabled, maxHeight])

  const collapsed = enabled && collapsible && !expanded
  const toggleJustifyClassName = toggleAlignment === 'start' ? 'justify-start' : 'justify-end'

  return (
    <div className={cn('min-w-0', className)}>
      <div
        id={contentId}
        className={cn('relative min-w-0', collapsed && 'overflow-hidden', contentClassName)}
        style={collapsed ? { maxHeight } : undefined}
      >
        <div ref={contentRef}>
          {children}
        </div>
        {collapsed ? (
          <>
            <div
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t',
                overlayClassName ?? 'from-zinc-950 via-zinc-950/72 via-40% to-transparent',
              )}
            />
            <div className={cn('pointer-events-none absolute inset-x-0 bottom-0 flex px-3 pb-2', toggleJustifyClassName)}>
              <button
                type="button"
                aria-controls={contentId}
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
                className={cn(
                  'pointer-events-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                  'border-white/10 bg-zinc-950/88 text-zinc-300 shadow-[0_10px_30px_rgba(0,0,0,0.32)] backdrop-blur-sm hover:bg-zinc-900/95 hover:text-zinc-100',
                  toggleClassName,
                )}
              >
                <ChevronDown className="h-3.5 w-3.5" />
                {expandLabel}
              </button>
            </div>
          </>
        ) : null}
      </div>
      {enabled && collapsible && !collapsed ? (
        <div className={cn('mt-2 flex', toggleJustifyClassName)}>
          <button
            type="button"
            aria-controls={contentId}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              'border-white/10 text-zinc-300 hover:bg-black/10 hover:text-zinc-100',
              toggleClassName,
            )}
          >
            <ChevronUp className="h-3.5 w-3.5" />
            {collapseLabel}
          </button>
        </div>
      ) : null}
    </div>
  )
}
