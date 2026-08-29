// [INPUT]: 完整 /chat 页面组件（ChatRoutePage）+ inbox 未读 + 个人云盘便签面板（FloatingNotesPanel）+ 本地开关偏好（floating-chat-visibility）
// [OUTPUT]: 全局右下角悬浮快捷入口（FAB + Dialog），聊天/笔记双 tab：展开即完整 /chat（会话列表+目标选择+聊天面板）或便签笔记（Markdown 编辑/保存/目录选择）；可在设置页关闭整个入口
// [POS]: 已登录壳层 AppShellFrame 内的全局快捷入口；悬浮窗 = /chat 的悬浮形态 + 云盘个人便签入口，不写第二套聊天实现
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Bot, MessageSquareText, StickyNote, X } from 'lucide-react'
import { useLocation } from '@tanstack/react-router'
import { isIndexedMarketingPath } from '@shared/site-seo'
import { isDocsPath } from '@shared/docs-content'
import { useTranslation } from '@/lib/i18n/react'
import { useInbox } from '@/lib/inbox-provider'
import { cn } from '@/lib/utils'
import { ChatRoutePage } from '@/routes/-chat-route/chat-route'
import { FloatingNotesPanel } from './floating-notes/floating-notes-panel'
import {
  clampFabPosition,
  FAB_DRAG_THRESHOLD,
  readPersistedFabPosition,
  writePersistedFabPosition,
  type FabPosition,
} from './floating-chat-position'
import { isFloatingChatEnabled, subscribeFloatingChatEnabled } from './floating-chat-visibility'

type FloatingTab = 'chat' | 'notes'

/**
 * 悬浮聊天入口的可见性守卫（防御性）：只在已登录业务页面显示。
 * 实际挂载点在 AppShellFrame（已排除 embed/admin/营销页），这里再兜底一次，
 * 防止未来挂载位置变化时在非业务页误出。
 */
export const shouldShowFloatingChatForPathname = (pathname: string): boolean => {
  if (pathname.startsWith('/embed/') || pathname === '/embed') {
    return false
  }
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return false
  }
  if (pathname === '/login' || pathname === '/onboarding') {
    return false
  }
  if (isIndexedMarketingPath(pathname) || isDocsPath(pathname)) {
    return false
  }
  return true
}

export function FloatingAgentChat() {
  const { t } = useTranslation()
  const { badgeCount } = useInbox()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [chatMounted, setChatMounted] = useState(false)
  const [notesMounted, setNotesMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<FloatingTab>('chat')
  const [enabled, setEnabled] = useState(isFloatingChatEnabled)
  const [fabPosition, setFabPosition] = useState<FabPosition | null>(() => {
    // 持久化位置可能来自更早的视口/窗口尺寸，读回时重新 clamp 到当前视口内，避免浮窗被藏到屏幕外。
    const persisted = readPersistedFabPosition()
    if (!persisted) {
      return null
    }
    return clampFabPosition({
      startLeft: persisted.x,
      startTop: persisted.y,
      deltaX: 0,
      deltaY: 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    })
  })
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startLeft: number
    startTop: number
  } | null>(null)
  const fabPositionRef = useRef<FabPosition | null>(fabPosition)
  fabPositionRef.current = fabPosition
  const didDragRef = useRef(false)

  const handleFabPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    }
    didDragRef.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleFabPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (!didDragRef.current && Math.abs(deltaX) < FAB_DRAG_THRESHOLD && Math.abs(deltaY) < FAB_DRAG_THRESHOLD) {
      return
    }
    didDragRef.current = true
    const nextPosition = clampFabPosition({
      startLeft: drag.startLeft,
      startTop: drag.startTop,
      deltaX,
      deltaY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    })
    fabPositionRef.current = nextPosition
    setFabPosition(nextPosition)
  }

  const handleFabPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (didDragRef.current && fabPositionRef.current) {
      writePersistedFabPosition(fabPositionRef.current)
    }
  }

  const handleFabClick = () => {
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }
    setOpen(true)
  }

  // 设置页切换开关后同标签页即时生效：关闭立即隐藏 FAB，重新开启立即恢复。
  useEffect(() => subscribeFloatingChatEnabled(setEnabled), [])

  // 首次打开后保持挂载：关闭只隐藏、不销毁，ChatRoutePage 状态缓存（会话列表/历史/目标选择都在），
  // 再打开时无需重新加载。未打开过则零成本不挂载。
  useEffect(() => {
    if (open) {
      setChatMounted(true)
    }
  }, [open])

  // 笔记面板同样首开即挂载：切回聊天再切回笔记不丢编辑状态。
  useEffect(() => {
    if (activeTab === 'notes') {
      setNotesMounted(true)
    }
  }, [activeTab])

  // 面板内焦点按 Esc 关闭（输入框/文本域内不拦截，避免误关）。
  // 用面板内 onKeyDown 而非 window 监听：ChatRoutePage 内部自己的弹窗（配置/分享）
  // 的 Esc 由它们自己处理，不会误关悬浮面板。
  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') {
      return
    }
    const target = event.target as HTMLElement | null
    const tag = target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
      return
    }
    setOpen(false)
  }

  // 弹窗打开期间锁定 body 滚动，避免底层页面随聊天内容滚动。
  useEffect(() => {
    if (!open) {
      return
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!enabled || !shouldShowFloatingChatForPathname(location.pathname)) {
    return null
  }

  const showBadge = badgeCount > 0

  return (
    <>
      <button
        type="button"
        aria-label={t('agents.custom.floating.fabLabel')}
        title={t('agents.custom.floating.fabLabel')}
        onClick={handleFabClick}
        onPointerDown={handleFabPointerDown}
        onPointerMove={handleFabPointerMove}
        onPointerUp={handleFabPointerUp}
        onPointerCancel={handleFabPointerUp}
        className={cn(
          'fixed z-40 flex size-12 touch-none select-none items-center justify-center rounded-full border border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/50 transition-colors hover:bg-zinc-900 hover:text-zinc-100',
          fabPosition === null
            && 'right-4 bottom-[calc(var(--mobile-bottom-nav-offset)+0.875rem)] md:right-6 md:bottom-6',
        )}
        style={fabPosition ? { left: `${fabPosition.x}px`, top: `${fabPosition.y}px` } : undefined}
      >
        <Bot className="size-5" />
        {showBadge ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        ) : null}
        <span className="sr-only">{t('agents.custom.floating.fabLabel')}</span>
      </button>

      {chatMounted ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-hidden={!open || undefined}
          onKeyDown={handlePanelKeyDown}
          className={cn(
            // 移动端（<768px，与应用 isMobile 断点一致）：底部抽屉式近全屏；
            // 桌面端：右下角悬浮面板，宽度容纳 /chat 三栏（220+220+440 最小宽度）。
            // 无遮罩：展开时背景不变暗；关闭时仅隐藏（invisible），保留 ChatRoutePage 实例。
            'fixed bottom-0 left-0 right-0 top-auto z-50 grid h-[92dvh] w-full max-w-none translate-x-0 translate-y-0 overflow-hidden border border-zinc-800 bg-[#09090b] p-0 text-zinc-100 shadow-2xl shadow-black/40 outline-none md:bottom-6 md:left-auto md:right-6 md:top-auto md:h-[min(76vh,46rem)] md:w-[min(64rem,calc(100vw-2rem))] md:rounded-xl md:p-0',
            !open && 'pointer-events-none invisible',
          )}
        >
          <div className="flex min-h-0 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-900 px-3 py-1.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
                  <button
                    type="button"
                    onClick={() => setActiveTab('chat')}
                    className={cn(
                      'flex h-6 items-center gap-1 rounded px-2 text-xs transition-colors',
                      activeTab === 'chat' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
                    )}
                  >
                    <MessageSquareText className="size-3" />
                    {t('agents.custom.floating.chatTab')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('notes')}
                    className={cn(
                      'flex h-6 items-center gap-1 rounded px-2 text-xs transition-colors',
                      activeTab === 'notes' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
                    )}
                  >
                    <StickyNote className="size-3" />
                    {t('agents.custom.floating.notesTab')}
                  </button>
                </div>
                <p className="truncate text-xs font-medium text-zinc-100" title={t('agents.custom.floating.subtitle')}>
                  {activeTab === 'chat' ? t('agents.custom.floating.title') : t('agents.custom.floating.notes.title')}
                </p>
              </div>
              <button
                type="button"
                aria-label={t('common.close')}
                title={t('common.close')}
                onClick={() => setOpen(false)}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
              >
                <X className="size-3.5" />
              </button>
            </div>

            <div className="relative min-h-0 flex-1">
              <div className={cn('h-full', activeTab === 'chat' ? '' : 'hidden')}>
                <ChatRoutePage />
              </div>
              {notesMounted ? (
                <div className={cn('h-full', activeTab === 'notes' ? '' : 'hidden')}>
                  <FloatingNotesPanel />
                </div>
              ) : null}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
