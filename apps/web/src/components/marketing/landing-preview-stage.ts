import { useEffect, useRef, useState } from 'react'

export function useScaledPreviewStage({
  minHeight,
  width,
}: {
  minHeight: number
  width: number
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [metrics, setMetrics] = useState({
    canvasHeight: minHeight,
    scale: 1,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const updateMetrics = () => {
      if (!container.clientWidth) return

      const nextScale = Math.min(container.clientWidth / width, 1)
      const nextCanvasHeight = canvas.offsetHeight

      setMetrics((currentMetrics) => {
        if (Math.abs(currentMetrics.scale - nextScale) < 0.001 && currentMetrics.canvasHeight === nextCanvasHeight) {
          return currentMetrics
        }

        return {
          canvasHeight: nextCanvasHeight,
          scale: nextScale,
        }
      })
    }

    const canvasObserver = new ResizeObserver(updateMetrics)
    const containerObserver = new ResizeObserver(updateMetrics)
    canvasObserver.observe(canvas)
    containerObserver.observe(container)
    updateMetrics()

    return () => {
      canvasObserver.disconnect()
      containerObserver.disconnect()
    }
  }, [minHeight, width])

  return { ...metrics, canvasRef, containerRef }
}
