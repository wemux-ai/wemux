import { useEffect, useState } from 'react'
import { filterEnabledSkills, filterSkillsForProjectContext, type SkillRecord } from '@shared/skill'
import { api } from './api'

const AVAILABLE_SKILLS_CACHE_TTL_MS = 60_000

let cachedSkills: {
  expiresAt: number
  skills: SkillRecord[]
  workspaceId: string
} | null = null
const pendingSkillsRequests = new Map<string, Promise<SkillRecord[]>>()

const getFilteredAvailableSkills = (skills: SkillRecord[], projectId?: string) => {
  return filterSkillsForProjectContext(filterEnabledSkills(skills), projectId)
}

const loadAvailableSkills = async (workspaceId?: string) => {
  const now = Date.now()
  const normalizedWorkspaceId = workspaceId?.trim() || ''
  if (cachedSkills && cachedSkills.expiresAt > now && cachedSkills.workspaceId === normalizedWorkspaceId) {
    return cachedSkills.skills
  }

  const pending = pendingSkillsRequests.get(normalizedWorkspaceId)
  if (pending) {
    return pending
  }

  const request = api.listSkills(normalizedWorkspaceId || undefined)
    .then((response) => {
      cachedSkills = {
        expiresAt: Date.now() + AVAILABLE_SKILLS_CACHE_TTL_MS,
        skills: response.skills,
        workspaceId: normalizedWorkspaceId,
      }
      return response.skills
    })
    .finally(() => {
      pendingSkillsRequests.delete(normalizedWorkspaceId)
    })
  pendingSkillsRequests.set(normalizedWorkspaceId, request)
  return request
}

export const useAvailableSkills = (projectId?: string, options: { enabled?: boolean; workspaceId?: string } = {}) => {
  const enabled = options.enabled ?? true
  const workspaceId = options.workspaceId?.trim() || ''
  const [skills, setSkills] = useState<SkillRecord[]>(() => {
    return cachedSkills ? getFilteredAvailableSkills(cachedSkills.skills, projectId) : []
  })
  const [loading, setLoading] = useState(() => enabled && !cachedSkills)

  useEffect(() => {
    let cancelled = false
    const cached = cachedSkills && cachedSkills.expiresAt > Date.now()
      ? cachedSkills.skills
      : null

    if (!enabled) {
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    if (cached && cachedSkills?.workspaceId === workspaceId) {
      setSkills(getFilteredAvailableSkills(cached, projectId))
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    const loadSkills = async () => {
      setLoading(true)
      try {
        const nextSkills = await loadAvailableSkills(workspaceId)
        if (!cancelled) {
          setSkills(getFilteredAvailableSkills(nextSkills, projectId))
        }
      } catch {
        if (!cancelled) {
          setSkills([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadSkills()

    return () => {
      cancelled = true
    }
  }, [enabled, projectId, workspaceId])

  return { skills, loading }
}
