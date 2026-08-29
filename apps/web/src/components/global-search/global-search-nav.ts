// [INPUT]: 全局搜索结果 + 键盘事件
// [OUTPUT]: 分组扁平化、选中移动、快捷键判定等纯函数
// [POS]: Global Search 面板的纯逻辑层（可单测，不依赖 DOM/React）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import type { GlobalSearchResult, GlobalSearchType } from '@shared/types'

/** 结果分组展示顺序（决定分组标题顺序）。 */
export const GLOBAL_SEARCH_GROUP_ORDER: GlobalSearchType[] = [
  'chat',
  'workspace',
  'agent',
  'contact',
  'project',
  'task',
  'drive',
  'skill',
]

export const GLOBAL_SEARCH_GROUP_LABELS: Record<GlobalSearchType, { zh: string; en: string }> = {
  chat: { zh: '会话', en: 'Chats' },
  workspace: { zh: '工作区', en: 'Workspaces' },
  agent: { zh: 'Agent', en: 'Agents' },
  contact: { zh: '联系人', en: 'Contacts' },
  project: { zh: '项目', en: 'Projects' },
  task: { zh: '任务', en: 'Tasks' },
  drive: { zh: '云盘', en: 'Drive' },
  skill: { zh: '技能', en: 'Skills' },
}

export type GlobalSearchFlatEntry = {
  group: GlobalSearchType
  result: GlobalSearchResult
}

/** 侧边栏搜索按钮等外部入口触发的打开事件（window.dispatchEvent 触发，palette 监听）。 */
export const GLOBAL_SEARCH_OPEN_EVENT = 'Wemux:global-search-open'

/** 从侧边栏按钮等入口打开面板。 */
export const requestGlobalSearchOpen = () => {
  window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_OPEN_EVENT))
}

/** 按固定分组顺序把结果拍平（组内保持服务端顺序）。 */
export const flattenGroupedResults = (results: GlobalSearchResult[]): GlobalSearchFlatEntry[] => {
  const byType = new Map<GlobalSearchType, GlobalSearchResult[]>()
  for (const result of results) {
    const bucket = byType.get(result.type) ?? []
    bucket.push(result)
    byType.set(result.type, bucket)
  }

  const flat: GlobalSearchFlatEntry[] = []
  for (const group of GLOBAL_SEARCH_GROUP_ORDER) {
    for (const result of byType.get(group) ?? []) {
      flat.push({ group, result })
    }
  }
  return flat
}

/** 选中索引在扁平列表内循环移动（delta = ±1）。空列表返回 -1。 */
export const moveSelectionIndex = (current: number, length: number, delta: number): number => {
  if (length <= 0) {
    return -1
  }
  if (current < 0) {
    return delta > 0 ? 0 : length - 1
  }
  return (current + delta + length) % length
}

/** 面板打开时把首项设为选中（组内有结果时）。 */
export const resolveInitialSelectionIndex = (length: number): number => (length > 0 ? 0 : -1)

type ShortcutEventLike = {
  defaultPrevented?: boolean
  isComposing?: boolean
  repeat?: boolean
  key?: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  target?: EventTarget | { tagName?: string; isContentEditable?: boolean } | null
}

const isEditableTarget = (target: ShortcutEventLike['target']): boolean => {
  if (!target || typeof target !== 'object') {
    return false
  }
  if ('tagName' in target && target.tagName) {
    const tagName = target.tagName.toUpperCase()
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
      return true
    }
  }
  if ('isContentEditable' in target && target.isContentEditable) {
    return true
  }
  return false
}

export type GlobalSearchShortcutAction = 'toggle' | null

/**
 * 全局快捷键判定：
 * - Cmd/Ctrl+K：任意非输入态打开/切换面板（Ctrl+F 之外的主要入口）
 * - Ctrl+F：仅在焦点不在可编辑元素时接管（避免劫持输入框内的浏览器查找）
 */
export const resolveGlobalSearchShortcut = (event: ShortcutEventLike): GlobalSearchShortcutAction => {
  if (event.defaultPrevented || event.isComposing || event.repeat) {
    return null
  }

  const key = event.key?.toLowerCase()
  const code = event.code

  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && (key === 'k' || code === 'KeyK')) {
    return 'toggle'
  }

  if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (key === 'f' || code === 'KeyF')) {
    if (isEditableTarget(event.target)) {
      return null
    }
    return 'toggle'
  }

  return null
}
