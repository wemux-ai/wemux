import { type CSSProperties, type ReactNode, type Ref, type UIEventHandler } from 'react'

import { cn } from '../../lib/utils'

interface ChatViewportProps {
  absolute?: boolean
  children: ReactNode
  jumpButton?: ReactNode
  overlay?: ReactNode
  paddingBottom?: number
  rootClassName?: string
  scrollClassName?: string
  scrollRef?: Ref<HTMLDivElement>
  style?: CSSProperties
  onScroll?: UIEventHandler<HTMLDivElement>
}

export function ChatViewport({
  absolute = false,
  children,
  jumpButton,
  overlay,
  paddingBottom,
  rootClassName,
  scrollClassName,
  scrollRef,
  style,
  onScroll,
}: ChatViewportProps) {
  return (
    <div className={cn('relative min-h-0 flex-1', rootClassName)}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={cn(
          absolute ? 'absolute inset-0' : 'h-full',
          scrollClassName,
        )}
        style={{ ...style, overflowAnchor: 'none', paddingBottom }}
      >
        {children}
      </div>
      {overlay ? overlay : null}
      {jumpButton ? jumpButton : null}
    </div>
  )
}
