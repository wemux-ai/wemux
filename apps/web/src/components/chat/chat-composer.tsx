import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react'

import { findActiveMentionRange, replaceMentionRange } from '../../lib/chat-mentions'
import { isImeComposingKeyboardEvent } from '../../lib/ime-keyboard'
import { cn } from '../../lib/utils'
import { ChatMentionList, type ChatMentionOption } from './chat-mention-list'
import { Textarea } from '../ui/textarea'

interface ChatComposerProps extends Omit<ComponentProps<'textarea'>, 'ref'> {
  /** 输入框上方的附加内容（渲染在 shell 边框内，如排队消息、@ 菜单、图片附件）。 */
  beforeInput?: ReactNode
  containerClassName?: string
  /** 悬浮模式：整块内容绝对定位于父容器底部（workspace 会话页使用）。 */
  floating?: boolean
  footer?: ReactNode
  /** footer 渲染在 shell 边框内（workspace 会话页使用）。 */
  footerInside?: boolean
  /** 输入框内联前缀（贴在文本起始位置，如已选上下文 chips）。 */
  inputInlinePrefix?: ReactNode
  inputShellClassName?: string
  maxHeight?: number
  minHeight?: number
  onHeightChange?: (height: number) => void
  overlay?: ReactNode
  overlayPlacement?: 'inside' | 'side'
  mentionEmptyText?: string
  mentionHintText?: string
  mentionOptions?: ChatMentionOption[]
  mentionTitle?: string
  onSelectMention?: (value: string) => void
  /** 输入 @ 后的查询词变化（供父组件异步加载候选，如 @文档） */
  onMentionQueryChange?: (query: string) => void
  shellClassName?: string
  sideInputClassName?: string
  topContent?: ReactNode
}

/**
 * 所有聊天形态（主聊天 / DM / 群聊 / 自定义 Agent / workspace 会话）共用的输入框。
 * 不要为新的聊天面板再复制一个 composer。
 */
/**
 * [INPUT]: textarea 受控值、@ 候选、overlay（发送/附件/emoji 按钮组）、beforeInput/topContent/footer 附加内容、
 *           shell 视觉类（shellClassName / inputShellClassName）。
 * [OUTPUT]: 所有聊天形态（主聊天 / DM / 群聊 / 自定义 Agent / workspace 会话）共用的自动增高输入框，
 *           支持 @ 提及补全、内联前缀、悬浮模式与高度回传。
 * [POS]: 聊天输入框唯一实现；新增聊天面板必须复用本组件，禁止新建 composer 变体。
 */
export const ChatComposer = forwardRef<HTMLTextAreaElement, ChatComposerProps>(function ChatComposer({
  beforeInput,
  className,
  containerClassName,
  floating = false,
  footer,
  footerInside = false,
  inputInlinePrefix,
  inputShellClassName,
  maxHeight = 220,
  minHeight = 96,
  onHeightChange,
  overlay,
  overlayPlacement = 'inside',
  mentionEmptyText = 'No matching members.',
  mentionHintText = 'Type @ to mention a member or agent.',
  mentionOptions = [],
  mentionTitle = 'Group Members',
  onSelectMention,
  onMentionQueryChange,
  shellClassName,
  sideInputClassName,
  topContent,
  value,
  ...props
}: ChatComposerProps, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const inlinePrefixRef = useRef<HTMLDivElement | null>(null)
  const pendingCaretRef = useRef<number | null>(null)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [inlinePrefixWidth, setInlinePrefixWidth] = useState(0)
  const [isFocused, setIsFocused] = useState(false)
  const inputValue = typeof value === 'string' ? value : ''
  const collapsedSelection = selection.start === selection.end
  const activeMentionRange = useMemo(() => {
    if (!isFocused || !collapsedSelection || props.disabled) {
      return null
    }

    return findActiveMentionRange(inputValue, selection.start)
  }, [collapsedSelection, inputValue, isFocused, props.disabled, selection.start])

  const filteredMentionOptions = useMemo(() => {
    if (!activeMentionRange) {
      return []
    }

    const normalizedQuery = activeMentionRange.query.trim().toLowerCase()
    const items = mentionOptions.filter((option) => {
      if (!normalizedQuery) {
        return true
      }

      const haystack = [
        option.label,
        option.description ?? '',
        option.kindLabel,
        ...(option.keywords ?? []),
      ].join(' ').toLowerCase()

      return haystack.includes(normalizedQuery)
    })

    return items.slice(0, 8)
  }, [activeMentionRange, mentionOptions])

  const mentionOpen = Boolean(activeMentionRange && isFocused && !props.disabled && mentionOptions.length > 0 && onSelectMention)

  useEffect(() => {
    setActiveMentionIndex(0)
  }, [activeMentionRange?.query, activeMentionRange?.start])

  // 输入 @ 查询词变化 → 通知父组件（异步候选加载，如 @文档）
  const mentionQuery = activeMentionRange?.query ?? ''
  useEffect(() => {
    onMentionQueryChange?.(mentionQuery)
  }, [mentionQuery, onMentionQueryChange])

  useLayoutEffect(() => {
    const node = textareaRef.current
    if (!node) return

    node.style.height = '0px'
    const nextHeight = Math.min(Math.max(node.scrollHeight, minHeight), maxHeight)
    node.style.height = `${nextHeight}px`
    node.style.overflowY = node.scrollHeight > maxHeight ? 'auto' : 'hidden'

    if (pendingCaretRef.current !== null) {
      const nextCaret = pendingCaretRef.current
      pendingCaretRef.current = null
      node.focus()
      node.setSelectionRange(nextCaret, nextCaret)
      setSelection({ start: nextCaret, end: nextCaret })
      return
    }

    setSelection({
      start: node.selectionStart ?? inputValue.length,
      end: node.selectionEnd ?? inputValue.length,
    })
  }, [maxHeight, minHeight, inputValue])

  useEffect(() => {
    const node = containerRef.current
    if (!node || !onHeightChange) return

    const emitHeight = () => onHeightChange(node.getBoundingClientRect().height)
    emitHeight()

    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(emitHeight)
    observer.observe(node)
    return () => observer.disconnect()
  }, [onHeightChange])

  // 内联前缀宽度 → textarea textIndent（前缀贴在文本起始位置）
  useLayoutEffect(() => {
    const node = inlinePrefixRef.current
    if (!node || !inputInlinePrefix) {
      setInlinePrefixWidth(0)
      return
    }

    const updateWidth = () => setInlinePrefixWidth(Math.ceil(node.getBoundingClientRect().width))
    updateWidth()

    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateWidth)
    observer.observe(node)
    return () => observer.disconnect()
  }, [inputInlinePrefix])

  const isSide = overlayPlacement === 'side'
  const textareaInlineIndent = inputInlinePrefix ? inlinePrefixWidth + 10 : 0
  const selectMention = (option: ChatMentionOption) => {
    if (!activeMentionRange || !onSelectMention) {
      return
    }

    const nextValue = replaceMentionRange(inputValue, activeMentionRange, option.label)
    pendingCaretRef.current = nextValue.caret
    onSelectMention(nextValue.value)
  }

  const handleSelectionSync = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    const node = event.currentTarget
    setSelection({
      start: node.selectionStart ?? node.value.length,
      end: node.selectionEnd ?? node.value.length,
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposingKeyboardEvent(event)) {
      return
    }

    if (mentionOpen && filteredMentionOptions.length > 0 && onSelectMention) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveMentionIndex((current) => {
          const delta = event.key === 'ArrowDown' ? 1 : -1
          return (current + delta + filteredMentionOptions.length) % filteredMentionOptions.length
        })
        return
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        selectMention(filteredMentionOptions[activeMentionIndex] ?? filteredMentionOptions[0])
        return
      }
    }

    if (mentionOpen && event.key === 'Escape') {
      event.preventDefault()
      setIsFocused(false)
      textareaRef.current?.blur()
      return
    }

    props.onKeyDown?.(event)
  }

  const content = (
    <div
      ref={containerRef}
      className={cn('flex flex-col', containerClassName)}
    >
      {topContent}

      <div className={cn('relative', shellClassName)}>
        {beforeInput}

        <div className={cn('flex', isSide ? 'items-end gap-2' : 'flex-col items-end')}>
          <ChatMentionList
            activeIndex={activeMentionIndex}
            emptyText={mentionEmptyText}
            hintText={mentionHintText}
            onSelect={selectMention}
            options={filteredMentionOptions}
            open={mentionOpen}
            title={mentionTitle}
          />

          <div
            className={cn(
              'relative overflow-hidden',
              isSide ? 'min-w-0 flex-1' : 'w-full',
              inputShellClassName,
            )}
          >
            {inputInlinePrefix ? (
              <div
                ref={inlinePrefixRef}
                className="pointer-events-none absolute left-4 top-2.5 z-10 max-w-[calc(100%-2rem)]"
              >
                {inputInlinePrefix}
              </div>
            ) : null}
            <Textarea
              {...props}
              ref={(node) => {
                textareaRef.current = node
                if (typeof ref === 'function') {
                  ref(node)
                } else if (ref) {
                  ref.current = node
                }
              }}
              value={value}
              style={{
                ...(props.style ?? {}),
                textIndent: textareaInlineIndent > 0 ? `${textareaInlineIndent}px` : props.style?.textIndent,
              }}
              onChange={(event) => {
                props.onChange?.(event)
                handleSelectionSync(event)
              }}
              onClick={handleSelectionSync}
              onFocus={(event) => {
                setIsFocused(true)
                props.onFocus?.(event)
              }}
              onBlur={(event) => {
                setIsFocused(false)
                props.onBlur?.(event)
              }}
              onKeyDown={handleKeyDown}
              onKeyUp={handleSelectionSync}
              onSelect={handleSelectionSync}
              className={cn(
                'min-h-0 resize-none border-0 bg-transparent px-4 py-4 text-sm text-zinc-100 shadow-none outline-none ring-0 placeholder:text-zinc-500 focus-visible:ring-0',
                className,
              )}
            />
            {overlay && !isSide && (
              <div className="absolute bottom-3 right-3 flex items-end gap-2">
                {overlay}
              </div>
            )}
          </div>

          {overlay && isSide && (
            <div className={cn('shrink-0', sideInputClassName)}>
              {overlay}
            </div>
          )}
        </div>

        {footerInside ? footer : null}
      </div>

      {!footerInside ? footer : null}
    </div>
  )

  if (!floating) {
    return content
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
      {content}
    </div>
  )
})
