import { useEffect, useState } from 'react'
import { api, type AgentRecord } from './api'

const AVAILABLE_AGENTS_CACHE_TTL_MS = 30_000

let cachedAgents: {
  agents: AgentRecord[]
  workspaceId: string
  expiresAt: number
} | null = null
const pendingAgentsRequests = new Map<string, Promise<AgentRecord[]>>()

export const invalidateAvailableAgentsCache = () => {
  cachedAgents = null
}

const resolveForceFlag = (value?: { force?: boolean } | { queryKey?: unknown }) => {
  return Boolean(value && 'force' in value && value.force)
}

const resolveWorkspaceId = (value?: { force?: boolean; workspaceId?: string } | { queryKey?: unknown }) => {
  return value && 'workspaceId' in value && typeof value.workspaceId === 'string'
    ? value.workspaceId.trim()
    : ''
}

export const loadAvailableAgents = async (options?: { force?: boolean; workspaceId?: string } | { queryKey?: unknown }) => {
  const now = Date.now()
  const force = resolveForceFlag(options)
  const workspaceId = resolveWorkspaceId(options)
  if (force) {
    cachedAgents = null
    pendingAgentsRequests.clear()
  }

  if (cachedAgents && cachedAgents.expiresAt > now && cachedAgents.workspaceId === workspaceId) {
    return cachedAgents.agents
  }

  const pending = pendingAgentsRequests.get(workspaceId)
  if (pending) {
    return pending
  }

  const request = api.listAgents(workspaceId || undefined)
    .then((response) => {
      cachedAgents = {
        agents: response.agents,
        workspaceId,
        expiresAt: Date.now() + AVAILABLE_AGENTS_CACHE_TTL_MS,
      }
      return response.agents
    })
    .finally(() => {
      pendingAgentsRequests.delete(workspaceId)
    })
  pendingAgentsRequests.set(workspaceId, request)
  return request
}

export const useAvailableAgents = (filterAgents?: (agents: AgentRecord[]) => AgentRecord[]) => {
  const [agents, setAgents] = useState<AgentRecord[]>(() => {
    const nextAgents = cachedAgents?.agents ?? []
    return filterAgents ? filterAgents(nextAgents) : nextAgents
  })
  const [loading, setLoading] = useState(() => !cachedAgents)

  useEffect(() => {
    let cancelled = false
    const cached = cachedAgents && cachedAgents.expiresAt > Date.now()
      ? cachedAgents.agents
      : null

    if (cached) {
      setAgents(filterAgents ? filterAgents(cached) : cached)
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    setLoading(true)
    void loadAvailableAgents()
      .then((nextAgents) => {
        if (!cancelled) {
          setAgents(filterAgents ? filterAgents(nextAgents) : nextAgents)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAgents([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [filterAgents])

  return { agents, loading }
}
