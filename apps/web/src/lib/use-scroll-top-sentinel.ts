import { type RefObject, useEffect, useRef } from 'react'

type UseScrollTopSentinelOptions = {
  enabled: boolean
  onTrigger: () => void
  rootRef: RefObject<HTMLElement | null>
  targetRef: RefObject<HTMLElement | null>
  topMargin?: number
}

export function useScrollTopSentinel({
  enabled,
  onTrigger,
  rootRef,
  targetRef,
  topMargin = 120,
}: UseScrollTopSentinelOptions) {
  const onTriggerRef = useRef(onTrigger)

  onTriggerRef.current = onTrigger

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return
    }

    const root = rootRef.current
    const target = targetRef.current
    if (!root || !target) {
      return
    }

    let didTrigger = false
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting || didTrigger) {
          return
        }

        didTrigger = true
        onTriggerRef.current()
      },
      {
        root,
        threshold: 0,
        rootMargin: `${topMargin}px 0px 0px 0px`,
      },
    )

    observer.observe(target)

    return () => {
      observer.disconnect()
    }
  }, [enabled, rootRef, targetRef, topMargin])
}
