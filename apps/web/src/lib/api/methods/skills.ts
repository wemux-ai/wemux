import type { SkillFileDetail, SkillImportResult, SkillScanResult, SkillRecord } from '../types'
import { request } from '../client'

export const skillsMethods = {
  listSkills: (workspaceId?: string) => {
    const suffix = workspaceId?.trim() ? `?workspaceId=${encodeURIComponent(workspaceId.trim())}` : ''
    return request<{ skills: SkillRecord[] }>(`/api/skills${suffix}`)
  },
  getSkill: (id: string) => request<{ skill: SkillRecord }>(`/api/skills/${id}`),
  createSkill: (payload: { name: string; slug?: string; description?: string; markdown?: string; enabled?: boolean; visibility?: 'private' | 'workspace'; workspaceId?: string }) =>
    request<{ skill: SkillRecord }>('/api/skills', { method: 'POST', body: JSON.stringify(payload) }),
  updateSkill: (id: string, payload: { name?: string; slug?: string; description?: string; markdown?: string; enabled?: boolean; visibility?: 'private' | 'workspace'; workspaceId?: string }) =>
    request<{ skill: SkillRecord }>(`/api/skills/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSkill: (id: string) => request<{ ok: boolean }>(`/api/skills/${id}`, { method: 'DELETE' }),
  getSkillFile: (id: string, filePath = 'SKILL.md') =>
    request<SkillFileDetail>(`/api/skills/${id}/files?path=${encodeURIComponent(filePath)}`),
  updateSkillFile: (id: string, payload: { path: string; content: string }) =>
    request<SkillFileDetail>(`/api/skills/${id}/files`, { method: 'PATCH', body: JSON.stringify(payload) }),
  scanSkills: (payload?: { scope?: 'project' | 'global'; projectIds?: string[]; executorId?: string }) =>
    request<SkillScanResult>('/api/skills/scan', { method: 'POST', body: JSON.stringify(payload ?? {}) }),
  importSkills: (payload: { mode: 'git'; url: string; ref?: string; subdirectory?: string } | { mode: 'download'; url: string }) =>
    request<SkillImportResult>('/api/skills/import', { method: 'POST', body: JSON.stringify(payload) }),
}
