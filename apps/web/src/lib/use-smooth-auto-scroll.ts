import { useCallback, useEffect, useRef, useState } from 'react'

type ScrollMode = 'instant' | 'smooth'
type ScrollShortcutTarget = 'top' | 'bottom'

interface UseSmoothAutoScrollOptions {
  threshold?: number
}

const easeOutCubic = (progress: number) => 1 - (1 - progress) ** 3

export const useSmoothAutoScroll = ({ threshold = 56 }: UseSmoothAutoScrollOptions = {}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const selectionLockedRef = useRef(false)
  const pointerSelectionPendingRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const autoScrollTopRef = useRef<number | null>(null)
  const lastScrollTopRef = useRef(0)
  const lastScrollShortcutTargetRef = useRef<ScrollShortcutTarget>('bottom')
  const [isSelectionLocked, setIsSelectionLocked] = useState(false)
  const [isPointerSelectionPending, setIsPointerSelectionPending] = useState(false)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const [scrollShortcutTarget, setScrollShortcutTarget] = useState<ScrollShortcutTarget | null>(null)

  const cancelAutoScroll = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [])

  const setStickiness = useCallback((shouldStick: boolean) => {
    shouldStickToBottomRef.current = shouldStick
    setShowJumpToBottom(!shouldStick)
    if (shouldStick) {
      setScrollShortcutTarget(null)
    }
  }, [])

  const getTargetTop = useCallback((node: HTMLDivElement) => {
    return Math.max(node.scrollHeight - node.clientHeight, 0)
  }, [])

  const writeScrollTop = useCallback((node: HTMLDivElement, top: number) => {
    autoScrollTopRef.current = top
    lastScrollTopRef.current = top
    node.scrollTop = top
  }, [])

  const syncScrollState = useCallback((node: HTMLDivElement) => {
    const delta = node.scrollTop - lastScrollTopRef.current
    if (Math.abs(delta) > 2) {
      lastScrollShortcutTargetRef.current = delta < 0 ? 'top' : 'bottom'
    }
    lastScrollTopRef.current = node.scrollTop

    const distanceToTop = node.scrollTop
    const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    const shouldStick = distanceToBottom < threshold
    shouldStickToBottomRef.current = shouldStick
    setShowJumpToBottom(!shouldStick)

    if (shouldStick || distanceToTop < threshold) {
      setScrollShortcutTarget(null)
      return
    }

    setScrollShortcutTarget(lastScrollShortcutTargetRef.current)
  }, [threshold])

  const isSelectionInsideViewport = useCallback(() => {
    const node = scrollRef.current
    const selection = window.getSelection()
    if (!node || !selection || selection.isCollapsed) {
      return false
    }

    const anchorNode = selection.anchorNode
    const focusNode = selection.focusNode
    if (!anchorNode || !focusNode) {
      return false
    }

    return node.contains(anchorNode) || node.contains(focusNode)
  }, [])

  const releaseStickinessForSelection = useCallback(() => {
    const node = scrollRef.current
    if (!node) {
      return
    }

    cancelAutoScroll()
    shouldStickToBottomRef.current = false
    syncScrollState(node)
  }, [cancelAutoScroll, syncScrollState])

  const resumeAutoScroll = useCallback(() => {
    if (selectionLockedRef.current) {
      return
    }

    setStickiness(true)
  }, [setStickiness])

  const scrollToBottom = useCallback((mode: ScrollMode = 'smooth') => {
    const node = scrollRef.current
    if (!node) {
      return
    }

    if (selectionLockedRef.current) {
      releaseStickinessForSelection()
      return
    }

    setStickiness(true)
    cancelAutoScroll()

    const startTop = node.scrollTop
    const targetTop = getTargetTop(node)
    if (mode === 'instant' || Math.abs(targetTop - startTop) < 4) {
      writeScrollTop(node, targetTop)
      return
    }

    const duration = Math.min(260, Math.max(140, Math.abs(targetTop - startTop) * 0.2))
    const startedAt = window.performance.now()

    const step = (now: number) => {
      const currentNode = scrollRef.current
      if (!currentNode || !shouldStickToBottomRef.current) {
        cancelAutoScroll()
        return
      }

      const latestTargetTop = getTargetTop(currentNode)
      const progress = Math.min((now - startedAt) / duration, 1)
      const nextTop = startTop + (latestTargetTop - startTop) * easeOutCubic(progress)
      writeScrollTop(currentNode, nextTop)

      if (progress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(step)
        return
      }

      writeScrollTop(currentNode, latestTargetTop)
      cancelAutoScroll()
    }

    animationFrameRef.current = window.requestAnimationFrame(step)
  }, [cancelAutoScroll, getTargetTop, releaseStickinessForSelection, setStickiness, writeScrollTop])

  const scrollToTop = useCallback((mode: ScrollMode = 'smooth') => {
    const node = scrollRef.current
    if (!node) {
      return
    }

    cancelAutoScroll()
    shouldStickToBottomRef.current = false
    setShowJumpToBottom(true)
    setScrollShortcutTarget(null)
    lastScrollShortcutTargetRef.current = 'top'
    autoScrollTopRef.current = null

    if (mode === 'instant') {
      lastScrollTopRef.current = 0
      node.scrollTop = 0
      return
    }

    node.scrollTo({ top: 0, behavior: 'smooth' })
  }, [cancelAutoScroll])

  const autoScrollToBottom = useCallback((mode: ScrollMode = 'smooth') => {
    if (!shouldStickToBottomRef.current) {
      return
    }

    scrollToBottom(mode)
  }, [scrollToBottom])

  const updateStickiness = useCallback(() => {
    const node = scrollRef.current
    if (!node) {
      return
    }

    if (animationFrameRef.current !== null) {
      if (autoScrollTopRef.current !== null && node.scrollTop + 2 < autoScrollTopRef.current) {
        cancelAutoScroll()
        setStickiness(false)
      }
      return
    }

    syncScrollState(node)
  }, [cancelAutoScroll, setStickiness, syncScrollState])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return
      }

      pointerSelectionPendingRef.current = true
      setIsPointerSelectionPending(true)
      releaseStickinessForSelection()
    }

    const clearPendingPointerSelection = () => {
      if (!pointerSelectionPendingRef.current) {
        return
      }

      pointerSelectionPendingRef.current = false
      setIsPointerSelectionPending(false)
      if (selectionLockedRef.current) {
        return
      }

      const currentNode = scrollRef.current
      if (currentNode) {
        syncScrollState(currentNode)
      }
    }

    node.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('pointerup', clearPendingPointerSelection)
    window.addEventListener('pointercancel', clearPendingPointerSelection)

    return () => {
      node.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointerup', clearPendingPointerSelection)
      window.removeEventListener('pointercancel', clearPendingPointerSelection)
    }
  }, [releaseStickinessForSelection, syncScrollState])

  useEffect(() => {
    const handleSelectionChange = () => {
      const nextLocked = isSelectionInsideViewport()
      if (selectionLockedRef.current === nextLocked) {
        return
      }

      selectionLockedRef.current = nextLocked
      setIsSelectionLocked(nextLocked)
      if (nextLocked) {
        pointerSelectionPendingRef.current = false
        setIsPointerSelectionPending(false)
        releaseStickinessForSelection()
        return
      }

      const node = scrollRef.current
      if (node) {
        syncScrollState(node)
      }
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [isSelectionInsideViewport, releaseStickinessForSelection, syncScrollState])

  useEffect(() => {
    return () => {
      cancelAutoScroll()
    }
  }, [cancelAutoScroll])

  return {
    autoScrollToBottom,
    isSelectionGestureActive: isSelectionLocked || isPointerSelectionPending,
    isSelectionLocked,
    resumeAutoScroll,
    scrollRef,
    scrollShortcutTarget,
    scrollToTop,
    scrollToBottom,
    showJumpToBottom,
    updateStickiness,
  }
}
