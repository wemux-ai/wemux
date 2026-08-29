import { useEffect, useRef, type ReactNode } from 'react'

import { cn } from '../../lib/utils'

interface ChatComposerOverlayProps {
  children: ReactNode
  className?: string
  /** 覆盖层总高度变化（消息区用它加底部内边距，避免消息被输入框遮挡） */
  onHeightChange?: (height: number) => void
}

/**
 * [INPUT]: 输入区内容（草稿队列 + ChatComposer 及其 footer）与高度回传回调。
 * [OUTPUT]: 飞书式悬浮输入区——绝对定位于会话底部（pointer-events-none 外层，
 *           内容区 pointer-events-auto），消息从下方滚动穿过，不再分隔成独立区块。
 * [POS]: 所有聊天面板的输入区统一用本组件包裹，禁止各自再写一份悬浮布局。
 */
export function ChatComposerOverlay({ children, className, onHeightChange }: ChatComposerOverlayProps) {
  const innerRef = useRef<HTMLDivElement | null>(null)
  const lastEmittedHeightRef = useRef<number | null>(null)

  useEffect(() => {
    const node = innerRef.current
    if (!node) {
      return
    }

    const emit = () => {
      const height = Math.ceil(node.getBoundingClientRect().height)
      if (lastEmittedHeightRef.current === height) {
        return
      }
      lastEmittedHeightRef.current = height
      onHeightChange?.(height)
    }
    emit()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(emit)
    observer.observe(node)
    return () => observer.disconnect()
  }, [onHeightChange])

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
      <div
        ref={innerRef}
        className={cn(
          'pointer-events-auto mx-auto w-full max-w-3xl px-2 pb-2 sm:px-3 sm:pb-3',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
