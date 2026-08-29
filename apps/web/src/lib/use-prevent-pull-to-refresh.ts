import { useEffect, useRef, type RefObject } from 'react'

type UsePreventPullToRefreshParams<T extends HTMLElement> = {
  enabled?: boolean
  scrollRef: RefObject<T | null>
}

export const usePreventPullToRefresh = <T extends HTMLElement>({
  enabled = true,
  scrollRef,
}: UsePreventPullToRefreshParams<T>) => {
  const touchStartYRef = useRef(0)

  useEffect(() => {
    if (!enabled) {
      return
    }

    const node = scrollRef.current
    if (!node) {
      return
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        return
      }

      touchStartYRef.current = event.touches[0]?.clientY ?? 0
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        return
      }

      const currentY = event.touches[0]?.clientY ?? 0
      const isPullingDownFromTop = currentY > touchStartYRef.current && node.scrollTop <= 0
      if (!isPullingDownFromTop || !event.cancelable) {
        return
      }

      event.preventDefault()
    }

    node.addEventListener('touchstart', handleTouchStart, { passive: true })
    node.addEventListener('touchmove', handleTouchMove, { passive: false })

    return () => {
      node.removeEventListener('touchstart', handleTouchStart)
      node.removeEventListener('touchmove', handleTouchMove)
    }
  }, [enabled, scrollRef])
}
