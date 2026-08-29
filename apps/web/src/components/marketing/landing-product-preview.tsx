import type { ReactNode } from 'react'

import { useScaledPreviewStage } from './landing-preview-stage'
import { RealProductShell, type ShellViewId } from './landing-real-product-shell'
import type { LandingText } from './landing-page-content'
import type { Language } from '../../lib/i18n'

const PREVIEW_CANVAS_WIDTH = 1440
const PREVIEW_CANVAS_MIN_HEIGHT = 708

export function LandingProductPreview({
  language,
  onPreviewViewChange,
  overlay,
  previewView,
  text,
}: {
  language: Language
  /** 外壳内部导航（侧栏 / 顶栏标签）回传给父级（hero tab）的当前视图。 */
  onPreviewViewChange?: (view: ShellViewId) => void
  overlay?: ReactNode
  /** 父级（hero tab）控制的当前视图，与外壳内部状态双向联动。 */
  previewView?: ShellViewId
  text: LandingText
}) {
  const { canvasHeight, canvasRef, containerRef, scale } = useScaledPreviewStage({
    minHeight: PREVIEW_CANVAS_MIN_HEIGHT,
    width: PREVIEW_CANVAS_WIDTH,
  })
  const scaledHeight = canvasHeight * scale
  const scaledWidth = PREVIEW_CANVAS_WIDTH * scale

  return (
    <div className="mt-24 w-full" id="console" ref={containerRef}>
      <div className="relative mx-auto" style={{ height: `${scaledHeight}px`, width: `${scaledWidth}px` }}>
        {/* 背景图片 - 模拟桌面壁纸 */}
        <div
          className="absolute inset-0 rounded-[14px] overflow-hidden"
          style={{
            backgroundImage: 'url(https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1600&q=80)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />

        {/* macOS 窗口外壳 - 真实的毛玻璃效果 */}
        <div
          aria-label="Product preview"
          id="console-preview"
          role="tabpanel"
          className="relative h-full w-full overflow-hidden rounded-[14px] border border-white/[0.15] shadow-[0_0_0_0.5px_rgba(255,255,255,0.1),0_32px_90px_rgba(0,0,0,0.65),0_8px_24px_rgba(0,0,0,0.45)]"
          style={{
            background: 'rgba(18, 18, 20, 0.65)',
            backdropFilter: 'blur(60px) saturate(180%)',
            WebkitBackdropFilter: 'blur(60px) saturate(180%)',
          }}
        >
          {/* 顶部高光效果 */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

          {/* 真实产品界面（红绿灯随外壳一起缩放，与侧栏同一坐标系） */}
          <div
            className="absolute left-0 top-0 origin-top-left"
            ref={canvasRef}
            style={{ transform: `scale(${scale})`, width: `${PREVIEW_CANVAS_WIDTH}px` }}
          >
            <RealProductShell language={language} onPreviewViewChange={onPreviewViewChange} previewView={previewView} />
          </div>
        </div>
        {overlay}
      </div>
    </div>
  )
}
