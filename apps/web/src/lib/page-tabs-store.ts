import { useSyncExternalStore } from 'react'
import { Store } from '@tanstack/react-store'
import { safeLocalStorageSetItem, safeSessionStorageSetItem } from './browser-storage'

export type PageTabScope = 'main' | 'workspace'

export type PageTab = {
  id: string
  scope: PageTabScope
  pathname: string
  href: string
  title: string
  subtitle?: string
  openedAt: number
  lastActiveAt: number
  dirty?: boolean
}

type PageTabsState = {
  tabs: PageTab[]
}

type OpenPageTabOptions = {
  id: string
  scope?: PageTabScope
  pathname: string
  href: string
  title: string
  subtitle?: string
  dirty?: boolean
}

const PAGE_TABS_STORAGE_KEY = 'vibemux.page-tabs'
const PAGE_TABS_SESSION_STORAGE_KEY = 'vibemux.session.page-tabs'
const MAX_PAGE_TABS = 12

let inMemoryPageTabs: PageTab[] = []

const normalizeText = (value?: string) => value?.trim().replace(/\s+/g, ' ') || ''

const normalizeHref = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) {
    return '/'
  }

  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`
  }

  return trimmed
}

export const buildWorkspacePageTabId = ({
  launchId,
  pathname,
  taskId,
  workspaceId,
  workspaceSessionId,
}: {
  pathname: '/workspace' | '/workspaces'
  workspaceId?: string
  taskId?: string
  workspaceSessionId?: string
  launchId?: string
}) => {
  const prefix = pathname === '/workspace' ? 'workspace-detail' : 'workspace-list'
  const normalizedWorkspaceId = normalizeText(workspaceId)
  if (normalizedWorkspaceId) {
    return `${prefix}:${normalizedWorkspaceId}`
  }

  const normalizedWorkspaceSessionId = normalizeText(workspaceSessionId)
  if (normalizedWorkspaceSessionId) {
    return `${prefix}:session:${normalizedWorkspaceSessionId}`
  }

  const normalizedTaskId = normalizeText(taskId)
  if (normalizedTaskId) {
    return `${prefix}:task:${normalizedTaskId}`
  }

  const normalizedLaunchId = normalizeText(launchId)
  if (normalizedLaunchId) {
    return `${prefix}:launch:${normalizedLaunchId}`
  }

  return pathname
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const parseWorkspaceTabIdFromHref = (pathname: string, href: string) => {
  try {
    const url = new URL(href, 'https://wemux.local')
    const routePathname = url.pathname === '/workspace' || url.pathname === '/workspaces'
      ? url.pathname
      : pathname
    if (routePathname !== '/workspace' && routePathname !== '/workspaces') {
      return null
    }

    return buildWorkspacePageTabId({
      pathname: routePathname,
      workspaceId: url.searchParams.get('workspaceId')?.trim() || undefined,
      taskId: url.searchParams.get('taskId')?.trim() || undefined,
      workspaceSessionId: url.searchParams.get('workspaceSessionId')?.trim() || undefined,
      launchId: url.searchParams.get('launchId')?.trim() || undefined,
    })
  } catch {
    return null
  }
}

const normalizeTab = (value: unknown): PageTab | null => {
  if (!isRecord(value)) {
    return null
  }

  let id = normalizeText(typeof value.id === 'string' ? value.id : '')
  const pathname = normalizeHref(typeof value.pathname === 'string' ? value.pathname : '')
  const href = normalizeHref(typeof value.href === 'string' ? value.href : pathname)
  const title = normalizeText(typeof value.title === 'string' ? value.title : '')
  if (!id || !pathname || !title) {
    return null
  }

  if (id.startsWith('workspace:')) {
    const migratedId = parseWorkspaceTabIdFromHref(pathname, href)
    if (!migratedId || migratedId === pathname) {
      return null
    }
    id = migratedId
  }

  const openedAt = typeof value.openedAt === 'number' && Number.isFinite(value.openedAt)
    ? value.openedAt
    : Date.now()
  const lastActiveAt = typeof value.lastActiveAt === 'number' && Number.isFinite(value.lastActiveAt)
    ? value.lastActiveAt
    : openedAt
  const scope = value.scope === 'workspace' ? 'workspace' : 'main'
  const subtitle = normalizeText(typeof value.subtitle === 'string' ? value.subtitle : '')

  return {
    id,
    scope,
    pathname,
    href,
    title,
    subtitle: subtitle || undefined,
    openedAt,
    lastActiveAt,
    dirty: Boolean(value.dirty),
  }
}

const compactPageTabs = (tabs: PageTab[]) => {
  const tabsById = new Map<string, PageTab>()
  for (const tab of tabs) {
    if (tab.id.startsWith('workspace:')) {
      continue
    }

    tabsById.set(tab.id, tab)
  }

  return [...tabsById.values()].sort((left, right) => left.openedAt - right.openedAt)
}

const readStoredPageTabs = () => {
  if (typeof window === 'undefined') {
    return inMemoryPageTabs
  }

  const readStorage = (storage: Storage | undefined, key: string) => {
    if (!storage) {
      return null
    }

    try {
      const raw = storage.getItem(key)
      if (!raw) {
        return null
      }

      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) {
        storage.removeItem(key)
        return null
      }

      return compactPageTabs(parsed
        .map((item) => normalizeTab(item))
        .filter((item): item is PageTab => Boolean(item)))
        .slice(-MAX_PAGE_TABS)
    } catch {
      try {
        storage.removeItem(key)
      } catch {
        // Ignore storage cleanup failures; tabs are recoverable UI state.
      }
      return null
    }
  }

  return (
    readStorage(window.sessionStorage, PAGE_TABS_SESSION_STORAGE_KEY)
    ?? readStorage(window.localStorage, PAGE_TABS_STORAGE_KEY)
    ?? inMemoryPageTabs
  )
}

const persistPageTabs = (tabs: PageTab[]) => {
  inMemoryPageTabs = tabs

  if (typeof window === 'undefined') {
    return
  }

  const raw = JSON.stringify(tabs)
  if (safeLocalStorageSetItem(PAGE_TABS_STORAGE_KEY, raw, {
    clearRecoverableLocalStorageOnQuota: true,
  })) {
    try {
      window.sessionStorage.removeItem(PAGE_TABS_SESSION_STORAGE_KEY)
    } catch {
      // Ignore storage cleanup failures; localStorage already has the canonical copy.
    }
    return
  }

  try {
    window.localStorage.removeItem(PAGE_TABS_STORAGE_KEY)
  } catch {
    // Ignore storage cleanup failures.
  }
  safeSessionStorageSetItem(PAGE_TABS_SESSION_STORAGE_KEY, raw)
}

const pageTabsStore = new Store<PageTabsState>({
  tabs: readStoredPageTabs(),
})

const setPageTabsState = (updater: (current: PageTabsState) => PageTabsState) => {
  pageTabsStore.setState((current) => {
    const next = updater(current)
    if (next !== current) {
      const compactedTabs = limitOpenTabs(compactPageTabs(next.tabs))
      persistPageTabs(compactedTabs)
      return {
        ...next,
        tabs: compactedTabs,
      }
    }
    return next
  })
}

const limitOpenTabs = (tabs: PageTab[]) => {
  if (tabs.length <= MAX_PAGE_TABS) {
    return tabs
  }

  return tabs
    .sort((left, right) => left.openedAt - right.openedAt)
    .slice(Math.max(0, tabs.length - MAX_PAGE_TABS))
}

export const usePageTabsStore = <TSelected,>(
  selector: (state: PageTabsState) => TSelected,
) => {
  const getSnapshot = () => selector(pageTabsStore.state)
  return useSyncExternalStore(
    (listener) => {
      const subscription = pageTabsStore.subscribe(() => {
        listener()
      }) as unknown as (() => void) | { unsubscribe: () => void }
      return typeof subscription === 'function'
        ? subscription
        : () => subscription.unsubscribe()
    },
    getSnapshot,
    getSnapshot,
  )
}

export const openPageTab = (options: OpenPageTabOptions) => {
  const id = normalizeText(options.id)
  const pathname = normalizeHref(options.pathname)
  const href = normalizeHref(options.href)
  const title = normalizeText(options.title)
  if (!id || !pathname || !title) {
    return
  }

  setPageTabsState((current) => {
    const now = Date.now()
    const existingTab = current.tabs.find((tab) => tab.id === id)
    const nextScope = options.scope ?? existingTab?.scope ?? 'main'
    const nextSubtitle = normalizeText(options.subtitle) || undefined
    const nextDirty = options.dirty ?? existingTab?.dirty
    if (
      existingTab
      && existingTab.scope === nextScope
      && existingTab.pathname === pathname
      && existingTab.href === href
      && existingTab.title === title
      && existingTab.subtitle === nextSubtitle
      && existingTab.dirty === nextDirty
    ) {
      return current
    }

    const nextTab: PageTab = existingTab
      ? {
          ...existingTab,
          scope: nextScope,
          pathname,
          href,
          title,
          subtitle: nextSubtitle,
          dirty: nextDirty,
          lastActiveAt: now,
        }
      : {
          id,
          scope: nextScope,
          pathname,
          href,
          title,
          subtitle: nextSubtitle,
          openedAt: now,
          lastActiveAt: now,
          dirty: nextDirty,
        }

    return {
      tabs: limitOpenTabs([
        ...current.tabs.filter((tab) => tab.id !== id),
        nextTab,
      ].sort((left, right) => left.openedAt - right.openedAt)),
    }
  })
}

export const closePageTab = (id: string) => {
  const normalizedId = normalizeText(id)
  if (!normalizedId) {
    return
  }

  setPageTabsState((current) => {
    const nextTabs = current.tabs.filter((tab) => tab.id !== normalizedId)
    return nextTabs.length === current.tabs.length ? current : { tabs: nextTabs }
  })
}
