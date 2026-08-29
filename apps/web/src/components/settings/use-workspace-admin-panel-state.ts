import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { api, type Team, type TeamActivity, type TeamExecutorRecord, type TeamInvitation, type TeamMember, type TeamRole, type WorkspaceBrainBillingAccess, type WorkspaceBrainConfig, type WorkspaceChatAgentOption } from '../../lib/api'
import { useApp } from '../../lib/app-provider'
import { useAuth } from '../../lib/auth-context'
import { getStoredCollaborationWorkspaceId, setStoredCollaborationWorkspaceId } from '../../lib/collaboration-workspace'
import { useTranslation } from '../../lib/i18n/react'
import { resolveAppUrl } from '../../lib/runtime-config'
import { useAppDialog } from '../ui/app-dialog-provider'
import { useSidebar } from '../ui/sidebar'

const normalizeWorkspaceAdminId = (value?: string) => value?.trim() || ''

const resolveWorkspaceAdminId = (teams: Team[], ...candidateIds: Array<string | undefined>) => {
  for (const candidateId of candidateIds) {
    const normalizedCandidateId = normalizeWorkspaceAdminId(candidateId)
    if (normalizedCandidateId && teams.some((team) => team.id === normalizedCandidateId)) {
      return normalizedCandidateId
    }
  }

  return teams[0]?.id ?? ''
}

export function useWorkspaceAdminPanelState({
  initialTeams = [],
  requestedWorkspaceId,
  onWorkspaceSelectionChange,
}: {
  initialTeams?: Team[]
  requestedWorkspaceId?: string
  onWorkspaceSelectionChange?: (workspaceId?: string) => void
}) {
  const { language, t } = useTranslation()
  const navigate = useNavigate()
  const { isMobile } = useSidebar()
  const { state, busy, setBusy } = useApp()
  const { user } = useAuth()
  const { openValueDialog } = useAppDialog()
  const [teams, setTeams] = useState<Team[]>(initialTeams)
  const requestedWorkspaceAdminId = normalizeWorkspaceAdminId(requestedWorkspaceId)
  const persistedWorkspaceAdminIdRef = useRef(normalizeWorkspaceAdminId(getStoredCollaborationWorkspaceId()))
  const [selectedTeamId, setSelectedTeamId] = useState(
    resolveWorkspaceAdminId(initialTeams, requestedWorkspaceAdminId, persistedWorkspaceAdminIdRef.current),
  )
  const [teamDetail, setTeamDetail] = useState<Team | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invitations, setInvitations] = useState<TeamInvitation[]>([])
  const [projects, setProjects] = useState<typeof state.projects>([])
  const [activities, setActivities] = useState<TeamActivity[]>([])
  const [executors, setExecutors] = useState<TeamExecutorRecord[]>([])
  const [availableExecutors, setAvailableExecutors] = useState<typeof executors>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<TeamRole>('member')
  const [projectId, setProjectId] = useState('')
  const [copiedLinkId, setCopiedLinkId] = useState('')
  const [brainConfig, setBrainConfig] = useState<WorkspaceBrainConfig | null>(null)
  const [brainBilling, setBrainBilling] = useState<WorkspaceBrainBillingAccess | null>(null)
  const [brainAgents, setBrainAgents] = useState<WorkspaceChatAgentOption[]>([])
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [executorPickerOpen, setExecutorPickerOpen] = useState(false)
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')
  const [createName, setCreateName] = useState('')
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [selectedExecutorIds, setSelectedExecutorIds] = useState<string[]>([])
  const requestedWorkspaceAdminIdRef = useRef(requestedWorkspaceAdminId)
  const selectedTeamIdRef = useRef(selectedTeamId)
  const busyActionRef = useRef(false)

  useEffect(() => {
    requestedWorkspaceAdminIdRef.current = requestedWorkspaceAdminId
  }, [requestedWorkspaceAdminId])

  useEffect(() => {
    const normalizedRequestedWorkspaceAdminId = normalizeWorkspaceAdminId(requestedWorkspaceId)
    if (!normalizedRequestedWorkspaceAdminId) {
      return
    }

    persistedWorkspaceAdminIdRef.current = normalizedRequestedWorkspaceAdminId
    setStoredCollaborationWorkspaceId(normalizedRequestedWorkspaceAdminId)
  }, [requestedWorkspaceId])

  useEffect(() => {
    selectedTeamIdRef.current = selectedTeamId
  }, [selectedTeamId])

  useEffect(() => {
    const normalizedSelectedTeamId = normalizeWorkspaceAdminId(selectedTeamId)
    persistedWorkspaceAdminIdRef.current = normalizedSelectedTeamId
    setStoredCollaborationWorkspaceId(normalizedSelectedTeamId || undefined)

    if (normalizedSelectedTeamId === requestedWorkspaceAdminIdRef.current) {
      return
    }

    onWorkspaceSelectionChange?.(normalizedSelectedTeamId || undefined)
  }, [onWorkspaceSelectionChange, selectedTeamId])

  useEffect(() => {
    if (initialTeams.length === 0) {
      return
    }

    setTeams((current) => (current.length > 0 ? current : initialTeams))
    setSelectedTeamId((current) => resolveWorkspaceAdminId(
      initialTeams,
      requestedWorkspaceAdminIdRef.current,
      persistedWorkspaceAdminIdRef.current,
      current,
    ))
  }, [initialTeams])

  const selectedTeam = useMemo(() => teams.find((team) => team.id === selectedTeamId) ?? null, [selectedTeamId, teams])
  const pendingInvitations = useMemo(
    () => invitations.filter((invitation) => invitation.status === 'pending'),
    [invitations],
  )
  const ownedExecutors = useMemo(
    () => availableExecutors.filter((executor) => executor.ownerUserId === user?.id),
    [availableExecutors, user?.id],
  )
  const bindableExecutors = useMemo(() => {
    const selectedWorkspaceId = normalizeWorkspaceAdminId(selectedTeamId)
    return ownedExecutors.filter((executor) => {
      const workspaceIds = executor.workspaceIds?.filter((value) => value.trim().length > 0) ?? (executor.teamId ? [executor.teamId] : [])
      return !selectedWorkspaceId || !workspaceIds.includes(selectedWorkspaceId)
    })
  }, [ownedExecutors, selectedTeamId])

  const resetTeamDetail = useCallback(() => {
    setTeamDetail(null)
    setMembers([])
    setInvitations([])
    setProjects([])
    setActivities([])
    setExecutors([])
  }, [])

  const loadTeams = useCallback(async (teamId?: string) => {
    const teamResponse = await api.listTeams()
    setTeams(teamResponse.teams)
    const nextTeamId = resolveWorkspaceAdminId(
      teamResponse.teams,
      teamId,
      requestedWorkspaceAdminIdRef.current,
      persistedWorkspaceAdminIdRef.current,
      selectedTeamIdRef.current,
    )
    setSelectedTeamId(nextTeamId)

    if (!nextTeamId) {
      resetTeamDetail()
      return
    }

    const [detail, teamMembers, teamInvitations, teamProjects, teamActivities, teamExecutors, executorResponse, brainResult, groupOptions] = await Promise.all([
      api.getTeam(nextTeamId),
      api.getTeamMembers(nextTeamId),
      api.getTeamInvitations(nextTeamId),
      api.getTeamProjects(nextTeamId),
      api.getTeamActivities(nextTeamId),
      api.getTeamExecutors(nextTeamId),
      api.listExecutors(),
      api.getWorkspaceBrainConfig(nextTeamId).catch(() => null),
      api.getWorkspaceChatGroupOptions(nextTeamId).catch(() => null),
    ])

    setTeamDetail(detail.team)
    setMembers(teamMembers.members)
    setInvitations(teamInvitations.invitations)
    setProjects(teamProjects.projects)
    setActivities(teamActivities.activities)
    setExecutors(teamExecutors.executors)
    setBrainConfig(brainResult?.config ?? null)
    setBrainBilling(brainResult?.billing ?? null)
    setBrainAgents(groupOptions?.agents ?? [])
    setAvailableExecutors(teamExecutors.executors.concat(
      executorResponse.executors.filter((executor) => !teamExecutors.executors.some((item) => item.executorId === executor.executorId)).map((executor) => ({
        ...executor,
        sharedProjectIds: [],
        sharedWorkspaceIds: executor.workspaceIds ?? (executor.teamId ? [executor.teamId] : []),
      })),
    ))
  }, [resetTeamDetail])

  useEffect(() => {
    void loadTeams(requestedWorkspaceAdminId || undefined)
  }, [loadTeams, requestedWorkspaceAdminId])

  useEffect(() => {
    if (selectedTeamId) {
      void loadTeams(selectedTeamId)
    }
  }, [loadTeams, selectedTeamId])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && selectedTeamIdRef.current) {
        void loadTeams(selectedTeamIdRef.current)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleVisibilityChange)
    }
  }, [loadTeams])

  useEffect(() => {
    if (!teamDetail) return
    setEditName(teamDetail.name)
    setEditDescription(teamDetail.description || '')
  }, [teamDetail])

  useEffect(() => {
    if (!isMobile) {
      setMobileView('list')
      return
    }

    if (selectedTeamId) {
      setMobileView('detail')
    }
  }, [isMobile, selectedTeamId])

  const runBusyAction = useCallback(async (action: () => Promise<void>) => {
    if (busyActionRef.current) {
      return
    }

    busyActionRef.current = true
    setBusy(true)
    try {
      await action()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (language === 'zh' ? '操作失败' : 'Action failed'))
    } finally {
      busyActionRef.current = false
      setBusy(false)
    }
  }, [language, setBusy])

  const handleSendInvitation = useCallback(async () => {
    const normalizedTeamId = normalizeWorkspaceAdminId(selectedTeamId)
    const normalizedEmail = inviteEmail.trim()
    if (!normalizedTeamId || !normalizedEmail) {
      return
    }

    await runBusyAction(async () => {
      await api.createTeamInvitation(normalizedTeamId, { email: normalizedEmail, role: inviteRole })
      setInviteEmail('')
      await loadTeams(normalizedTeamId)
      toast.success(language === 'zh' ? '邀请已发送' : 'Invitation sent')
    })
  }, [inviteEmail, inviteRole, language, loadTeams, runBusyAction, selectedTeamId])

  const handleCopyInviteLink = useCallback(async (invitation: TeamInvitation) => {
    const link = resolveAppUrl(`/invite/${invitation.token}`)
    try {
      await navigator.clipboard.writeText(link)
      setCopiedLinkId(invitation.id)
      window.setTimeout(() => setCopiedLinkId((current) => (current === invitation.id ? '' : current)), 1800)
    } catch {
      await openValueDialog({
        title: language === 'zh' ? '手动复制邀请链接' : 'Copy invite link manually',
        description: t('teamsPage.copyInviteLinkFailedPrompt'),
        value: link,
        label: language === 'zh' ? '邀请链接' : 'Invite link',
        closeText: language === 'zh' ? '我知道了' : 'Got it',
        copyText: language === 'zh' ? '再试一次复制' : 'Try copying again',
      })
    }
  }, [language, openValueDialog, t])

  const openCreateExecutor = useCallback((teamId: string) => {
    setSelectedExecutorIds([])
    setExecutorPickerOpen(true)
  }, [])

  const openEditExecutor = useCallback((executorId: string, teamId: string) => {
    void navigate({
      to: '/execution',
      search: {
        createExecutor: undefined,
        editExecutorId: executorId,
        terminalExecutorId: undefined,
        workspaceId: teamId,
        teamId: undefined,
      },
    })
  }, [navigate])

  const handleBindExecutors = useCallback(async () => {
    const normalizedTeamId = normalizeWorkspaceAdminId(selectedTeamId)
    if (!normalizedTeamId || selectedExecutorIds.length === 0) {
      return
    }

    await runBusyAction(async () => {
      await api.addTeamExecutorBindings(normalizedTeamId, { executorIds: selectedExecutorIds })
      setSelectedExecutorIds([])
      setExecutorPickerOpen(false)
      await loadTeams(normalizedTeamId)
      toast.success(language === 'zh' ? '执行节点已添加到当前组织' : 'Executors added to this organization')
    })
  }, [language, loadTeams, runBusyAction, selectedExecutorIds, selectedTeamId])

  const handleRemoveExecutor = useCallback(async (executorId: string) => {
    const normalizedTeamId = normalizeWorkspaceAdminId(selectedTeamId)
    if (!normalizedTeamId) {
      return
    }

    await runBusyAction(async () => {
      await api.removeTeamExecutorBinding(normalizedTeamId, executorId)
      await loadTeams(normalizedTeamId)
      toast.success(language === 'zh' ? '执行节点已从当前组织移除' : 'Executor removed from this organization')
    })
  }, [language, loadTeams, runBusyAction, selectedTeamId])

  return {
    activities,
    busy,
    copiedLinkId,
    createDialogOpen,
    createName,
    editDescription,
    editDialogOpen,
    editName,
    executorPickerOpen,
    executors,
    bindableExecutors,
    handleCopyInviteLink,
    handleBindExecutors,
    handleRemoveExecutor,
    handleSendInvitation,
    inviteDialogOpen,
    inviteEmail,
    inviteRole,
    invitations,
    isMobile,
    loadTeams,
    members,
    mobileView,
    openCreateExecutor,
    openEditExecutor,
    pendingInvitations,
    projectId,
    projects,
    runBusyAction,
    selectedTeam,
    selectedTeamId,
    selectedExecutorIds,
    setCreateDialogOpen,
    setCreateName,
    setEditDescription,
    setEditDialogOpen,
    setEditName,
    setExecutorPickerOpen,
    setInviteDialogOpen,
    setInviteEmail,
    setInviteRole,
    setMobileView,
    setProjectId,
    setSelectedExecutorIds,
    setSelectedTeamId,
    state,
    t,
    teamDetail,
    teams,
    brainAgents,
    brainBilling,
    brainConfig,
    setBrainConfig,
    saveBrainConfig: async (config: Partial<WorkspaceBrainConfig>) => {
      if (!selectedTeamId) return null
      const result = await api.saveWorkspaceBrainConfig(selectedTeamId, config)
      setBrainConfig(result.config)
      setBrainBilling(result.billing)
      return result
    },
  }
}

export type WorkspaceAdminPanelState = ReturnType<typeof useWorkspaceAdminPanelState>
