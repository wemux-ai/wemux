import { createContext, createElement, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { Store } from '@tanstack/react-store'

export type WorkbenchResourceType = 'iframe' | 'terminal' | 'socket' | 'desktop'
export type WorkbenchResourceStatus = 'active' | 'paused' | 'disposed'

type WorkbenchResourceEntry = {
  key: string
  type: WorkbenchResourceType
  status: WorkbenchResourceStatus
  lastActiveAt: number
}

type WorkbenchResourceRegistryState = {
  entriesByKey: Record<string, WorkbenchResourceEntry>
}

type WorkbenchResourceHandlers = {
  pause?: () => void
  resume?: () => void
  dispose?: () => void
}

const MAX_RETAINED_WORKBENCH_RESOURCES = 16
const registryStore = new Store<WorkbenchResourceRegistryState>({ entriesByKey: {} })
const handlersByKey = new Map<string, WorkbenchResourceHandlers>()
const WorkbenchResourceVisibilityContext = createContext(true)

export const WorkbenchResourceVisibilityProvider = ({
  active,
  children,
}: {
  active: boolean
  children: ReactNode
}) => createElement(WorkbenchResourceVisibilityContext.Provider, { value: active }, children)

export const selectWorkbenchResourceEvictionKeys = (
  entries: WorkbenchResourceEntry[],
  maxRetained = MAX_RETAINED_WORKBENCH_RESOURCES,
) => entries
  .filter((entry) => entry.status === 'paused')
  .sort((left, right) => left.lastActiveAt - right.lastActiveAt)
  .slice(0, Math.max(0, entries.filter((entry) => entry.status !== 'disposed').length - maxRetained))
  .map((entry) => entry.key)

const setWorkbenchResourceActive = (
  key: string,
  type: WorkbenchResourceType,
  active: boolean,
) => {
  const currentEntry = registryStore.state.entriesByKey[key]
  const nextStatus: WorkbenchResourceStatus = active ? 'active' : 'paused'
  if (currentEntry?.status === nextStatus && currentEntry.type === type) {
    return
  }

  const nextEntry: WorkbenchResourceEntry = {
    key,
    type,
    status: nextStatus,
    lastActiveAt: active ? Date.now() : currentEntry?.lastActiveAt ?? Date.now(),
  }
  const entriesByKey = {
    ...registryStore.state.entriesByKey,
    [key]: nextEntry,
  }
  const evictionKeys = selectWorkbenchResourceEvictionKeys(Object.values(entriesByKey))
  for (const evictionKey of evictionKeys) {
    entriesByKey[evictionKey] = {
      ...entriesByKey[evictionKey],
      status: 'disposed',
    }
  }
  registryStore.setState(() => ({ entriesByKey }))

  if (active) {
    handlersByKey.get(key)?.resume?.()
  } else {
    handlersByKey.get(key)?.pause?.()
  }
  for (const evictionKey of evictionKeys) {
    handlersByKey.get(evictionKey)?.dispose?.()
  }
}

export const useWorkbenchResource = (params: {
  resourceKey: string
  type: WorkbenchResourceType
  active: boolean
  handlers?: WorkbenchResourceHandlers
}) => {
  const parentVisible = useContext(WorkbenchResourceVisibilityContext)
  const active = params.active && parentVisible
  const getSnapshot = () => registryStore.state.entriesByKey[params.resourceKey]?.status ?? 'paused'
  const status = useSyncExternalStore(
    (listener) => {
      const subscription = registryStore.subscribe(listener) as unknown as (() => void) | { unsubscribe: () => void }
      return typeof subscription === 'function' ? subscription : () => subscription.unsubscribe()
    },
    getSnapshot,
    getSnapshot,
  )

  useEffect(() => {
    handlersByKey.set(params.resourceKey, params.handlers ?? {})
    setWorkbenchResourceActive(params.resourceKey, params.type, active)
    return () => {
      handlersByKey.get(params.resourceKey)?.dispose?.()
      handlersByKey.delete(params.resourceKey)
      registryStore.setState((current) => {
        const entriesByKey = { ...current.entriesByKey }
        delete entriesByKey[params.resourceKey]
        return { entriesByKey }
      })
    }
  }, [params.resourceKey, params.type])

  useEffect(() => {
    handlersByKey.set(params.resourceKey, params.handlers ?? {})
  }, [params.handlers, params.resourceKey])

  useEffect(() => {
    setWorkbenchResourceActive(params.resourceKey, params.type, active)
  }, [active, params.resourceKey, params.type])

  return status
}
