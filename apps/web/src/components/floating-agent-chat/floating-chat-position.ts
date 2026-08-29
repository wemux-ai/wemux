/**
 * [INPUT]: FAB 拖动的起点、位移与视口尺寸。
 * [OUTPUT]: 吸附在视口内的新位置 + localStorage 持久化读写。
 * [POS]: 悬浮聊天 FAB 的位置计算与持久化纯函数；不负责渲染。
 * [PROTOCOL]: Update this header when changing this responsibility, then check AGENTS.md.
 */

export const FAB_POSITION_STORAGE_KEY = 'vibemux.floating-chat.position'
export const FAB_SIZE = 48
export const FAB_MARGIN = 8
export const FAB_DRAG_THRESHOLD = 4

export type FabPosition = { x: number; y: number }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const clampFabPosition = (params: {
  startLeft: number
  startTop: number
  deltaX: number
  deltaY: number
  viewportWidth: number
  viewportHeight: number
}): FabPosition => {
  const maxLeft = Math.max(FAB_MARGIN, params.viewportWidth - FAB_SIZE - FAB_MARGIN)
  const maxTop = Math.max(FAB_MARGIN, params.viewportHeight - FAB_SIZE - FAB_MARGIN)
  return {
    x: clamp(params.startLeft + params.deltaX, FAB_MARGIN, maxLeft),
    y: clamp(params.startTop + params.deltaY, FAB_MARGIN, maxTop),
  }
}

export const readPersistedFabPosition = (): FabPosition | null => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(FAB_POSITION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FabPosition>
    if (
      typeof parsed?.x === 'number' && Number.isFinite(parsed.x)
      && typeof parsed?.y === 'number' && Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y }
    }
  } catch {
    // 忽略损坏的持久化值，退回默认位置。
  }
  return null
}

export const writePersistedFabPosition = (position: FabPosition) => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(FAB_POSITION_STORAGE_KEY, JSON.stringify(position))
  } catch {
    // 存储失败不阻断交互，位置仅在本次会话内生效。
  }
}
