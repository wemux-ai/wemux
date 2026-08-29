/**
 * [INPUT]: Authenticated Inbox API, Inbox SSE events, and the application router/toast shell.
 * [OUTPUT]: Shared badge, grouped lists, item timelines, mutations, and exactly one user Inbox stream.
 * [POS]: Global frontend Inbox state mounted once inside the authenticated application shell.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { isInboxWakingKind, type InboxGroupSummary, type InboxItem, type InboxQueryScope } from '@shared/inbox'
import { api } from './api'
import { useRealtimeInbox } from './realtime/useRealtime'

export type InboxListState<T> = {
  entries: T[]
  loading: boolean
  loaded: boolean
  error: string
  nextCursor?: string
}

type InboxGroupState = Record<InboxQueryScope, InboxListState<InboxGroupSummary>>
type InboxItemState = Record<string, InboxListState<InboxItem>>

type InboxContextValue = {
  badgeCount: number
  connected: boolean
  groups: InboxGroupState
  getItems: (section: InboxQueryScope, groupKey: string) => InboxListState<InboxItem>
  refreshBadge: () => Promise<void>
  refreshGroups: (section: InboxQueryScope, options?: { silent?: boolean }) => Promise<void>
  loadMoreGroups: (section: InboxQueryScope) => Promise<void>
  refreshItems: (section: InboxQueryScope, groupKey: string, options?: { silent?: boolean }) => Promise<void>
  markGroupRead: (groupKey: string) => Promise<void>
  archiveGroup: (groupKey: string) => Promise<void>
  snoozeGroup: (groupKey: string, until: string) => Promise<void>
  unsnoozeGroup: (groupKey: string) => Promise<void>
  markItemRead: (itemId: string, groupKey: string) => Promise<void>
  archiveItem: (itemId: string, groupKey: string) => Promise<void>
  snoozeItem: (itemId: string, groupKey: string, until: string) => Promise<void>
  unsnoozeItem: (itemId: string, groupKey: string) => Promise<void>
}

const createListState = <T,>(): InboxListState<T> => ({
  entries: [],
  loading: false,
  loaded: false,
  error: '',
})

const createGroupState = (): InboxGroupState => ({
  all: createListState(),
  action: createListState(),
  following: createListState(),
  snoozed: createListState(),
  archived: createListState(),
})

const createItemKey = (section: InboxQueryScope, groupKey: string) => `${section}\u0000${groupKey}`
const EMPTY_ITEM_STATE = createListState<InboxItem>()

const InboxContext = createContext<InboxContextValue | null>(null)

export function InboxProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [badgeCount, setBadgeCount] = useState(0)
  const [connected, setConnected] = useState(false)
  const [groups, setGroups] = useState<InboxGroupState>(createGroupState)
  const [items, setItems] = useState<InboxItemState>({})
  const groupsRef = useRef(groups)
  const itemsRef = useRef(items)
  const groupRefreshesRef = useRef<Partial<Record<InboxQueryScope, Promise<void>>>>({})
  const itemRefreshesRef = useRef<Record<string, Promise<void>>>({})
  const streamRefreshTimerRef = useRef<number | null>(null)

  useEffect(() => {
    groupsRef.current = groups
  }, [groups])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const refreshBadge = useCallback(async () => {
    const response = await api.getInboxBadge()
    setBadgeCount(response.unreadGroups)
  }, [])

  const refreshGroups = useCallback((section: InboxQueryScope, options: { silent?: boolean } = {}) => {
    const pending = groupRefreshesRef.current[section]
    if (pending) return pending

    const request = (async () => {
      if (!options.silent) {
        setGroups((current) => ({ ...current, [section]: { ...current[section], loading: true, error: '' } }))
      }
      try {
        const response = await api.getInboxGroups(section)
        setBadgeCount(response.unreadGroups)
        setGroups((current) => ({
          ...current,
          [section]: {
            entries: response.groups,
            loading: false,
            loaded: true,
            error: '',
            nextCursor: response.nextCursor,
          },
        }))
      } catch (error) {
        setGroups((current) => ({
          ...current,
          [section]: {
            ...current[section],
            loading: false,
            loaded: true,
            error: error instanceof Error ? error.message : 'Failed to load Inbox.',
          },
        }))
        throw error
      } finally {
        delete groupRefreshesRef.current[section]
      }
    })()
    groupRefreshesRef.current[section] = request
    return request
  }, [])

  const loadMoreGroups = useCallback(async (section: InboxQueryScope) => {
    const current = groupsRef.current[section]
    if (!current.nextCursor || current.loading) return
    setGroups((value) => ({ ...value, [section]: { ...value[section], loading: true, error: '' } }))
    try {
      const response = await api.getInboxGroups(section, { cursor: current.nextCursor })
      setBadgeCount(response.unreadGroups)
      setGroups((value) => ({
        ...value,
        [section]: {
          entries: [...value[section].entries, ...response.groups],
          loading: false,
          loaded: true,
          error: '',
          nextCursor: response.nextCursor,
        },
      }))
    } catch (error) {
      setGroups((value) => ({
        ...value,
        [section]: {
          ...value[section],
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load more Inbox groups.',
        },
      }))
      throw error
    }
  }, [])

  const refreshItems = useCallback((section: InboxQueryScope, groupKey: string, options: { silent?: boolean } = {}) => {
    const key = createItemKey(section, groupKey)
    const pending = itemRefreshesRef.current[key]
    if (pending) return pending

    const request = (async () => {
      if (!options.silent) {
        setItems((current) => ({
          ...current,
          [key]: { ...(current[key] ?? createListState()), loading: true, error: '' },
        }))
      }
      try {
        const response = await api.getInboxGroupItems(groupKey, section)
        setBadgeCount(response.unreadGroups)
        setItems((current) => ({
          ...current,
          [key]: {
            entries: response.items,
            loading: false,
            loaded: true,
            error: '',
            nextCursor: response.nextCursor,
          },
        }))
      } catch (error) {
        setItems((current) => ({
          ...current,
          [key]: {
            ...(current[key] ?? createListState()),
            loading: false,
            loaded: true,
            error: error instanceof Error ? error.message : 'Failed to load Inbox timeline.',
          },
        }))
        throw error
      } finally {
        delete itemRefreshesRef.current[key]
      }
    })()
    itemRefreshesRef.current[key] = request
    return request
  }, [])

  const refreshLoadedData = useCallback(async (groupKey?: string) => {
    const groupRefreshes = (Object.keys(groupsRef.current) as InboxQueryScope[])
      .filter((section) => groupsRef.current[section].loaded)
      .map((section) => refreshGroups(section, { silent: true }))
    const itemRefreshes = (Object.keys(itemsRef.current) as string[])
      .filter((key) => (!groupKey || key.endsWith(`\u0000${groupKey}`)) && itemsRef.current[key].loaded)
      .map((key) => {
        const [section, selectedGroupKey] = key.split('\u0000') as [InboxQueryScope, string]
        return refreshItems(section, selectedGroupKey, { silent: true })
      })
    await Promise.allSettled([refreshBadge(), ...groupRefreshes, ...itemRefreshes])
  }, [refreshBadge, refreshGroups, refreshItems])

  const mutateGroup = useCallback(async (groupKey: string, mutation: () => Promise<unknown>) => {
    await mutation()
    await refreshLoadedData(groupKey)
  }, [refreshLoadedData])

  const mutateItem = useCallback(async (groupKey: string, mutation: () => Promise<unknown>) => {
    await mutation()
    await refreshLoadedData(groupKey)
  }, [refreshLoadedData])

  useEffect(() => {
    void Promise.allSettled([refreshBadge(), refreshGroups('action')])
  }, [refreshBadge, refreshGroups])

  const scheduleRefresh = useCallback(() => {
    if (streamRefreshTimerRef.current !== null) return
    streamRefreshTimerRef.current = window.setTimeout(() => {
      streamRefreshTimerRef.current = null
      void refreshLoadedData()
    }, 120)
  }, [refreshLoadedData])

  // 实时流（统一客户端）：连接生命周期/重连/解析归 realtime-client，这里只消费事件。
  useRealtimeInbox({
    onConnectedChange: (connected) => setConnected(connected),
    onItemCreated: (item, unreadGroups) => {
      if (unreadGroups !== undefined) {
        setBadgeCount(unreadGroups)
      }
      if (isInboxWakingKind(item.kind)) {
        toast(item.title || 'New Inbox item', {
          id: `inbox:${item.id}`,
          description: `${item.actorName}: ${item.body}`,
          duration: 6_000,
          action: {
            label: 'Open Inbox',
            onClick: () => void navigate({
              to: '/inbox' as never,
              search: { section: 'all', groupKey: item.groupKey } as never,
            }),
          },
        })
      }
      scheduleRefresh()
    },
    onInboxEvent: () => scheduleRefresh(),
  })

  useEffect(() => {
    return () => {
      if (streamRefreshTimerRef.current !== null) window.clearTimeout(streamRefreshTimerRef.current)
      streamRefreshTimerRef.current = null
    }
  }, [])

  const value = useMemo<InboxContextValue>(() => ({
    badgeCount,
    connected,
    groups,
    getItems: (section, groupKey) => items[createItemKey(section, groupKey)] ?? EMPTY_ITEM_STATE,
    refreshBadge,
    refreshGroups,
    loadMoreGroups,
    refreshItems,
    markGroupRead: (groupKey) => mutateGroup(groupKey, () => api.markInboxGroupRead(groupKey)),
    archiveGroup: (groupKey) => mutateGroup(groupKey, () => api.archiveInboxGroup(groupKey)),
    snoozeGroup: (groupKey, until) => mutateGroup(groupKey, () => api.snoozeInboxGroup(groupKey, { until })),
    unsnoozeGroup: (groupKey) => mutateGroup(groupKey, () => api.unsnoozeInboxGroup(groupKey)),
    markItemRead: (itemId, groupKey) => mutateItem(groupKey, () => api.markInboxItemRead(itemId)),
    archiveItem: (itemId, groupKey) => mutateItem(groupKey, () => api.archiveInboxItem(itemId)),
    snoozeItem: (itemId, groupKey, until) => mutateItem(groupKey, () => api.snoozeInboxItem(itemId, { until })),
    unsnoozeItem: (itemId, groupKey) => mutateItem(groupKey, () => api.unsnoozeInboxItem(itemId)),
  }), [badgeCount, connected, groups, items, loadMoreGroups, mutateGroup, mutateItem, refreshBadge, refreshGroups, refreshItems])

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>
}

export function useInbox() {
  const context = useContext(InboxContext)
  if (!context) throw new Error('useInbox must be used within InboxProvider')
  return context
}
