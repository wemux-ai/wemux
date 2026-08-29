// [INPUT]: 快捷键输入
// [OUTPUT]: 快捷键定义
// [POS]: 工作区路由快捷键
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

type ShortcutTargetLike = {
  closest?: (selector: string) => unknown
  isContentEditable?: boolean
  tagName?: string
}

type WorkspaceRouteKeyboardShortcutEvent = {
  altKey: boolean
  code?: string
  ctrlKey: boolean
  defaultPrevented?: boolean
  isComposing?: boolean
  key?: string
  metaKey: boolean
  repeat?: boolean
  shiftKey: boolean
  target?: EventTarget | ShortcutTargetLike | null
}

export function matchesToggleWorkspaceTerminalShortcut(event: WorkspaceRouteKeyboardShortcutEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.repeat) {
    return false
  }

  if (event.altKey || event.shiftKey) {
    return false
  }

  if (!event.metaKey && !event.ctrlKey) {
    return false
  }

  const normalizedKey = event.key?.toLowerCase()
  return normalizedKey === 'j' || event.code === 'KeyJ'
}

const getShortcutTarget = (target: EventTarget | ShortcutTargetLike | null | undefined): ShortcutTargetLike | null => {
  if (!target || typeof target !== 'object') {
    return null
  }

  const candidate = target as ShortcutTargetLike
  if (
    typeof candidate.closest === 'function'
    || typeof candidate.tagName === 'string'
    || typeof candidate.isContentEditable === 'boolean'
  ) {
    return candidate
  }

  return null
}

const isEditableShortcutTarget = (target: ShortcutTargetLike | null): boolean => {
  const tagName = target?.tagName?.toUpperCase()
  return tagName === 'INPUT'
    || tagName === 'TEXTAREA'
    || tagName === 'SELECT'
    || Boolean(target?.isContentEditable)
}

const isWorkspaceTerminalShortcutTarget = (target: ShortcutTargetLike | null): boolean => (
  typeof target?.closest === 'function'
  && Boolean(target.closest('[data-workspace-terminal-root]'))
)

export function shouldHandleToggleWorkspaceTerminalShortcut(event: WorkspaceRouteKeyboardShortcutEvent): boolean {
  if (!matchesToggleWorkspaceTerminalShortcut(event)) {
    return false
  }

  const target = getShortcutTarget(event.target)
  if (!isEditableShortcutTarget(target)) {
    return true
  }

  return isWorkspaceTerminalShortcutTarget(target)
}
