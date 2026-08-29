import type { AppState, TeamActivity, TeamRole } from '@shared/types'
import type { ProjectAssignee, Team, TeamExecutorRecord, TeamInvitation, TeamMember } from '../types'
import { normalizeTeamActivity, request } from '../client'

export const teamsMethods = {
  listTeams: () => request<{ teams: Team[] }>('/api/auth/teams'),
  createTeam: (name: string, options?: { sourceWorkspaceId?: string }) =>
    request<{ team: Team }>('/api/auth/teams', {
      method: 'POST',
      body: JSON.stringify({ name, sourceWorkspaceId: options?.sourceWorkspaceId }),
    }),
  getTeam: (teamId: string) => request<{ team: Team }>(`/api/auth/teams/${teamId}`),
  updateTeam: (teamId: string, payload: { name?: string; description?: string; avatarUrl?: string }) => request<{ team: Team }>(`/api/auth/teams/${teamId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  getTeamMembers: (teamId: string) => request<{ members: TeamMember[] }>(`/api/auth/teams/${teamId}/members`),
  getProjectAssignees: (projectId: string) => request<{ assignees: ProjectAssignee[] }>(`/api/projects/${projectId}/assignees`),
  addTeamMember: (teamId: string, email: string) => request<{ ok: boolean }>(`/api/auth/teams/${teamId}/members`, { method: 'POST', body: JSON.stringify({ email }) }),
  removeTeamMember: (teamId: string, userId: string) => request<{ ok: boolean }>(`/api/auth/teams/${teamId}/members/${userId}`, { method: 'DELETE' }),
  updateTeamMemberRole: (teamId: string, userId: string, role: TeamRole) => request<{ ok: boolean }>(`/api/auth/teams/${teamId}/members/${userId}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  getMyTeamInvitations: () => request<{ invitations: Array<TeamInvitation & { teamName?: string }> }>('/api/auth/teams/invitations/mine'),
  getTeamInvitations: (teamId: string) => request<{ invitations: TeamInvitation[] }>(`/api/auth/teams/${teamId}/invitations`),
  createTeamInvitation: (teamId: string, payload: { email: string; role: TeamRole }) => request<{ invitation: TeamInvitation; inviteUrl: string }>(`/api/auth/teams/${teamId}/invitations`, { method: 'POST', body: JSON.stringify(payload) }),
  cancelTeamInvitation: (invitationId: string) => request<{ ok: boolean }>(`/api/auth/teams/invitations/${invitationId}`, { method: 'DELETE' }),
  getTeamProjects: (teamId: string) => request<{ projects: AppState['projects'] }>(`/api/auth/teams/${teamId}/projects`),
  getTeamExecutors: (teamId: string) => request<{ executors: TeamExecutorRecord[] }>(`/api/auth/teams/${teamId}/executors`),
  addTeamProject: (teamId: string, projectId: string) => request<{ ok: boolean }>(`/api/auth/teams/${teamId}/projects`, { method: 'POST', body: JSON.stringify({ projectId }) }),
  removeTeamProject: (teamId: string, projectId: string) => request<{ ok: boolean }>(`/api/auth/teams/${teamId}/projects/${projectId}`, { method: 'DELETE' }),
  getTeamActivities: async (teamId: string, limit = 20) => {
    const response = await request<{ activities: TeamActivity[] }>(`/api/auth/teams/${teamId}/activities?limit=${limit}`)
    return {
      ...response,
      activities: response.activities.map(normalizeTeamActivity),
    }
  },
  verifyInvitation: (token: string) => request<{ valid: boolean; message?: string; invitation?: TeamInvitation & { teamName?: string } }>('/api/auth/teams/invitations/verify', { method: 'POST', body: JSON.stringify({ token }) }),
  acceptInvitation: (token: string) => request<{ ok: boolean }>(`/api/auth/teams/invitations/${token}/accept`, { method: 'POST' }),
}
