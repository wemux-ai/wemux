import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
} from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'

const TRACK_WIDTH = 34
const TRACK_HEIGHT = 20
const THUMB_SIZE = 16
const THUMB_OFFSET = 2
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - THUMB_OFFSET * 2
const PILL_EXTEND = 2
const PRESS_EXTEND = 4
const PRESS_SHRINK = 4
const DRAG_DEAD_ZONE = 2

type SwitchRootProps = ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>

type SwitchStyle = CSSProperties & Record<string, string | number | undefined>

interface SwitchProps extends SwitchRootProps {
  label?: ReactNode
  labelClassName?: string
  containerClassName?: string
  onToggle?: () => void
}

const Switch = forwardRef<ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  (
    {
      checked: checkedProp,
      defaultChecked = false,
      disabled = false,
      className,
      containerClassName,
      label,
      labelClassName,
      onCheckedChange,
      onToggle,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerEnter,
      onPointerLeave,
      onClick,
      style,
      ...props
    },
    ref,
  ) => {
    const isControlled = checkedProp !== undefined
    const [uncontrolledChecked, setUncontrolledChecked] = useState(defaultChecked)
    const checked = isControlled ? checkedProp : uncontrolledChecked

    const hasMounted = useRef(false)
    const checkedRef = useRef(checked)
    const [hovered, setHovered] = useState(false)
    const [pressed, setPressed] = useState(false)
    const [isDragging, setIsDragging] = useState(false)

    const dragging = useRef(false)
    const didDrag = useRef(false)
    const pointerStart = useRef<{ clientX: number; originX: number } | null>(null)
    const [thumbX, setThumbX] = useState(checked ? THUMB_OFFSET + THUMB_TRAVEL : THUMB_OFFSET)
    const thumbXRef = useRef(thumbX)

    useEffect(() => {
      hasMounted.current = true
    }, [])

    useEffect(() => {
      checkedRef.current = checked
    }, [checked])

    const thumbWidth = pressed ? THUMB_SIZE + PRESS_EXTEND : hovered ? THUMB_SIZE + PILL_EXTEND : THUMB_SIZE
    const thumbHeight = pressed ? THUMB_SIZE - PRESS_SHRINK : THUMB_SIZE
    const thumbY = pressed ? THUMB_OFFSET + PRESS_SHRINK / 2 : THUMB_OFFSET
    const extraWidth = thumbWidth - THUMB_SIZE
    const restingThumbX = checked ? THUMB_OFFSET + THUMB_TRAVEL - extraWidth : THUMB_OFFSET

    const updateThumbX = useCallback((nextThumbX: number) => {
      thumbXRef.current = nextThumbX
      setThumbX(nextThumbX)
    }, [])

    useEffect(() => {
      if (dragging.current) {
        return
      }

      updateThumbX(restingThumbX)
    }, [restingThumbX, updateThumbX])

    const commitCheckedChange = useCallback(
      (nextChecked: boolean) => {
        if (nextChecked === checkedRef.current) {
          return
        }

        if (!isControlled) {
          setUncontrolledChecked(nextChecked)
        }

        onCheckedChange?.(nextChecked)
        onToggle?.()
      },
      [isControlled, onCheckedChange, onToggle],
    )

    const handlePointerDown = useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        onPointerDown?.(event)
        if (event.defaultPrevented || disabled) {
          return
        }

        if (event.pointerType === 'mouse' && event.button !== 0) {
          return
        }

        setPressed(true)
        dragging.current = false
        setIsDragging(false)
        didDrag.current = false
        pointerStart.current = { clientX: event.clientX, originX: thumbXRef.current }
        event.currentTarget.setPointerCapture(event.pointerId)
      },
      [disabled, onPointerDown],
    )

    const handlePointerMove = useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        onPointerMove?.(event)
        if (!pointerStart.current) {
          return
        }

        const delta = event.clientX - pointerStart.current.clientX
        if (!dragging.current) {
          if (Math.abs(delta) < DRAG_DEAD_ZONE) {
            return
          }
          dragging.current = true
          setIsDragging(true)
        }

        const dragMin = THUMB_OFFSET
        const dragMax = TRACK_WIDTH - THUMB_OFFSET - (THUMB_SIZE + PRESS_EXTEND)
        updateThumbX(Math.max(dragMin, Math.min(dragMax, pointerStart.current.originX + delta)))
      },
      [onPointerMove, updateThumbX],
    )

    const resetDragState = useCallback(() => {
      pointerStart.current = null
      dragging.current = false
      setIsDragging(false)
      setPressed(false)
    }, [])

    const handlePointerUp = useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        onPointerUp?.(event)
        if (!pointerStart.current) {
          return
        }

        setPressed(false)

        if (dragging.current) {
          didDrag.current = true
          dragging.current = false
          setIsDragging(false)

          const currentX = thumbXRef.current
          const dragMin = THUMB_OFFSET
          const dragMax = TRACK_WIDTH - THUMB_OFFSET - (THUMB_SIZE + PRESS_EXTEND)
          const shouldBeChecked = currentX > (dragMin + dragMax) / 2

          if (shouldBeChecked !== checkedRef.current) {
            commitCheckedChange(shouldBeChecked)
          } else {
            updateThumbX(checkedRef.current ? THUMB_OFFSET + THUMB_TRAVEL : THUMB_OFFSET)
          }

          requestAnimationFrame(() => {
            didDrag.current = false
          })
        }

        pointerStart.current = null
      },
      [commitCheckedChange, onPointerUp, updateThumbX],
    )

    const handlePointerCancel = useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        onPointerCancel?.(event)

        if (event.defaultPrevented) {
          return
        }

        resetDragState()
        updateThumbX(checkedRef.current ? THUMB_OFFSET + THUMB_TRAVEL : THUMB_OFFSET)
      },
      [onPointerCancel, resetDragState, updateThumbX],
    )

    const handleCheckedChange = useCallback(
      (nextChecked: boolean) => {
        if (didDrag.current) {
          return
        }

        commitCheckedChange(nextChecked)
      },
      [commitCheckedChange],
    )

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)

        if (didDrag.current) {
          event.preventDefault()
          event.stopPropagation()
        }
      },
      [onClick],
    )

    const trackStyle = {
      width: TRACK_WIDTH,
      height: TRACK_HEIGHT,
      '--switch-track-on': hovered ? '#5C89F2' : '#6B97FF',
      '--switch-track-off': hovered
        ? 'color-mix(in oklab, var(--accent), var(--foreground) 10%)'
        : 'var(--accent)',
      ...style,
    } as SwitchStyle

    const thumbStyle: CSSProperties = {
      transform: `translateX(${thumbX}px)`,
      width: thumbWidth,
      height: thumbHeight,
      top: thumbY,
      transition:
        hasMounted.current && !isDragging
          ? 'transform 160ms cubic-bezier(0.22, 1, 0.36, 1), width 160ms cubic-bezier(0.22, 1, 0.36, 1), height 160ms cubic-bezier(0.22, 1, 0.36, 1), top 160ms cubic-bezier(0.22, 1, 0.36, 1)'
          : 'none',
      willChange: 'transform, width, height, top',
    }

    const switchElement = (
      <SwitchPrimitive.Root
        ref={ref}
        checked={checked}
        disabled={disabled}
        onCheckedChange={handleCheckedChange}
        onPointerEnter={(event) => {
          onPointerEnter?.(event)
          if (event.pointerType === 'mouse') {
            setHovered(true)
          }
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event)
          setHovered(false)
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClick={handleClick}
        data-switch-root="true"
        className={cn(
          'peer relative inline-flex shrink-0 cursor-pointer rounded-full outline-none transition-colors duration-75 touch-none',
          'bg-[var(--switch-track-off)] data-[state=checked]:bg-[var(--switch-track-on)]',
          'focus-visible:ring-1 focus-visible:ring-[#6B97FF] focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        style={trackStyle}
        {...props}
      >
        <SwitchPrimitive.Thumb asChild>
          <span
            className="absolute left-0 block rounded-full bg-white shadow-sm"
            style={thumbStyle}
          />
        </SwitchPrimitive.Thumb>
      </SwitchPrimitive.Root>
    )

    if (!label) {
      return switchElement
    }

    return (
      <div
        className={cn(
          'relative z-10 flex items-center gap-2.5 px-3 py-2 select-none',
          disabled && 'opacity-50',
          containerClassName,
        )}
        onClick={(event) => {
          if (disabled) {
            return
          }

          const target = event.target as HTMLElement
          if (target.closest('[data-switch-root="true"]')) {
            return
          }

          commitCheckedChange(!checked)
        }}
      >
        {switchElement}
        <span
          className={cn(
            'text-[13px] transition-[color] duration-75',
            checked ? 'text-foreground' : 'text-muted-foreground',
            labelClassName,
          )}
        >
          {label}
        </span>
      </div>
    )
  },
)

Switch.displayName = 'Switch'

export { Switch }
export type { SwitchProps }
