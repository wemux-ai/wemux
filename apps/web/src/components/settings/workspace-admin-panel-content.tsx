import { getProjectColor } from '@shared/project-color'
import { Activity, Brain, CheckCircle2, MoreHorizontal, Pencil, Plus, Server, Trash2, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api, resolveMediaUrl, type TeamRole } from '../../lib/api'
import { cn, formatDate } from '../../lib/utils'
import { getSettingsSection, getSettingsAction } from '../settings/commercial-settings-gate'
import { useTranslation } from '../../lib/i18n/react'
import type { WorkspaceAdminPanelState } from './use-workspace-admin-panel-state'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { NativeSelect } from '../ui/native-select'
import { SearchableSelect } from '../ui/searchable-select'

export function WorkspaceAdminPanelContent({
  workspaceAdmin,
}: {
  workspaceAdmin: WorkspaceAdminPanelState
}) {
  const { language } = useTranslation()
  const {
    activities,
    bindableExecutors,
    copiedLinkId,
    executors,
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
    handleRemoveExecutor,
    setCreateDialogOpen,
    setEditDialogOpen,
    setInviteDialogOpen,
    setMobileView,
    setProjectId,
    setSelectedTeamId,
    state,
    t,
    teamDetail,
    teams,
    brainAgents,
    brainBilling,
    brainConfig,
    setBrainConfig,
    saveBrainConfig,
  } = workspaceAdmin

  const showListPanel = !isMobile || mobileView === 'list'
  const showDetailPanel = !isMobile || mobileView === 'detail'

  return (
    <>
      {/* Mobile tabs */}
      {isMobile && teams.length > 0 ? (
        <div className="flex gap-1 border-b border-zinc-900 bg-[#060607] px-2 pt-2">
          <button
            type="button"
            onClick={() => setMobileView('list')}
            className={cn(
              'flex items-center gap-2 rounded-t-lg border border-b-0 px-3 py-2 text-xs transition-colors',
              mobileView === 'list'
                ? 'border-zinc-800 bg-[#09090b] text-zinc-100'
                : 'border-zinc-900 bg-zinc-950/70 text-zinc-500 hover:border-zinc-800 hover:text-zinc-200',
            )}
          >
            {t('teamsPage.listTab')}
          </button>
          <button
            type="button"
            onClick={() => setMobileView('detail')}
            disabled={!selectedTeamId}
            className={cn(
              'flex items-center gap-2 rounded-t-lg border border-b-0 px-3 py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:text-zinc-600',
              mobileView === 'detail'
                ? 'border-zinc-800 bg-[#09090b] text-zinc-100'
                : 'border-zinc-900 bg-zinc-950/70 text-zinc-500 hover:border-zinc-800 hover:text-zinc-200',
            )}
          >
            {t('teamsPage.currentTab')}
          </button>
        </div>
      ) : null}

      {/* Main content */}
      <div className={cn('min-h-0 w-full flex-1', isMobile ? 'flex flex-col' : 'grid grid-cols-[18rem_minmax(0,1fr)]')}>
        {showListPanel ? (
          <div className={cn('flex min-h-0 min-w-0 flex-col bg-[#060607]', isMobile ? 'border border-zinc-900' : 'border-r border-zinc-900')}>
            {/* Sidebar header */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-900 px-3 py-2.5">
              <span className="text-sm font-semibold text-zinc-200">{t('teamsPage.sidebar.title')}</span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setCreateDialogOpen(true)}
                className="h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Team list */}
            <div className="flex-1 min-h-0 overflow-auto">
              <div className="px-1.5 py-1.5">
                {teams.map((team) => {
                  const isActive = team.id === selectedTeamId

                  return (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => {
                        setSelectedTeamId(team.id)
                        if (isMobile) {
                          setMobileView('detail')
                        }
                      }}
                      className={cn(
                        'group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                        isActive
                          ? 'bg-zinc-900/80 text-zinc-100'
                          : 'text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200',
                      )}
                    >
                      <Avatar className="h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950">
                        <AvatarImage src={resolveMediaUrl(team.avatarUrl)} />
                        <AvatarFallback className="rounded-md bg-zinc-900 text-xs text-zinc-100">
                          {team.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{team.name}</p>
                        <p className="mt-0.5 truncate text-[11px] text-zinc-600">{team.description || t('teamsPage.noDescription')}</p>
                      </div>
                      {isActive ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" /> : null}
                    </button>
                  )
                })}

                {teams.length === 0 ? (
                  <div className="border border-dashed border-zinc-800 bg-[#09090b] px-4 py-10 text-center">
                    <Users className="mx-auto h-10 w-10 text-zinc-600" />
                    <p className="mt-3 text-sm text-zinc-400">{t('teamsPage.empty.noTeams')}</p>
                    <p className="mt-1 text-xs text-zinc-500">{t('teamsPage.empty.createFirstTeam')}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {showDetailPanel ? (
          <div className="min-h-0 min-w-0">
            {selectedTeam && teamDetail ? (
              <div className="flex h-full min-h-0 flex-col">
                {/* Detail header */}
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-900 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-8 w-8 rounded-lg border border-zinc-800 bg-zinc-900">
                      <AvatarImage src={resolveMediaUrl(teamDetail.avatarUrl)} />
                      <AvatarFallback className="rounded-lg bg-zinc-900 text-sm font-semibold text-zinc-100">
                        {teamDetail.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-zinc-100">{teamDetail.name}</h2>
                      <p className="truncate text-[11px] text-zinc-600">{teamDetail.description || t('teamsPage.noDescription')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {copiedLinkId ? (
                      <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />
                        {t('teamsPage.inviteLinkCopied')}
                      </div>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditDialogOpen(true)}
                      className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                    >
                      <Pencil className="mr-1.5 h-3 w-3" />
                      {t('teamsPage.editProfile')}
                    </Button>
                  </div>
                </div>

                {/* Detail content */}
                <div className="flex-1 min-h-0 overflow-auto">
                  <div className="space-y-4 px-4 py-4 sm:px-5">
                    {(() => {
                    const BillingSummary = getSettingsSection('workspace.billing.summary')
                    return selectedTeamId && teamDetail && BillingSummary ? (
                      BillingSummary({
                        teamId: selectedTeamId,
                        teamName: teamDetail.name,
                        membersCount: members.length,
                        language: language === 'zh' ? 'zh' : 'en',
                      })
                    ) : null
                  })()}

                    {/* Info stats */}
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2.5">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t('teamsPage.info.members.label')}</p>
                        <p className="mt-1.5 text-lg font-semibold text-zinc-50">{members.length}</p>
                        <p className="mt-0.5 text-[11px] leading-5 text-zinc-500">{t('teamsPage.info.members.subtext')}</p>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2.5">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t('teamsPage.info.pendingInvites.label')}</p>
                        <p className="mt-1.5 text-lg font-semibold text-zinc-50">{pendingInvitations.length}</p>
                        <p className="mt-0.5 text-[11px] leading-5 text-zinc-500">{t('teamsPage.info.pendingInvites.subtext')}</p>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2.5">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t('teamsPage.info.teamProjects.label')}</p>
                        <p className="mt-1.5 text-lg font-semibold text-zinc-50">{projects.length}</p>
                        <p className="mt-0.5 text-[11px] leading-5 text-zinc-500">{t('teamsPage.info.teamProjects.subtext')}</p>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2.5">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t('teamsPage.info.sharedExecutors.label')}</p>
                        <p className="mt-1.5 text-lg font-semibold text-zinc-50">{executors.length}</p>
                        <p className="mt-0.5 text-[11px] leading-5 text-zinc-500">{t('teamsPage.info.sharedExecutors.subtext')}</p>
                      </div>
                    </div>

                    {/* Members section */}
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/75">
                      <div className="flex items-center justify-between border-b border-zinc-900 px-4 py-3">
                        <div>
                          <h3 className="text-sm font-semibold text-zinc-100">{t('teamsPage.sections.members.title')}</h3>
                          <p className="mt-0.5 text-[11px] text-zinc-500">{t('teamsPage.sections.members.description')}</p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => setInviteDialogOpen(true)}
                          className="h-7 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
                        >
                          <UserPlus className="mr-1.5 h-3 w-3" />
                          {t('teamsPage.actions.inviteMember')}
                        </Button>
                      </div>
                      <div className="divide-y divide-zinc-900">
                        {members.map((member) => (
                          <div key={member.id} className="flex items-center justify-between px-4 py-2.5">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Avatar className="h-7 w-7">
                                <AvatarFallback className="bg-zinc-900 text-xs text-zinc-100">{member.name?.slice(0, 2).toUpperCase() || 'U'}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-zinc-100">{member.name}</p>
                                <p className="truncate text-[11px] text-zinc-500">{member.username ? `@${member.username}` : member.email}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <NativeSelect
                                value={member.role}
                                onChange={(event) =>
                                  void runBusyAction(async () => {
                                    await api.updateTeamMemberRole(selectedTeamId, member.id, event.target.value as TeamRole)
                                    await loadTeams(selectedTeamId)
                                  })
                                }
                                className="h-7 min-w-[7rem] text-xs"
                              >
                                <option value="owner">{t('teamsPage.roles.owner')}</option>
                                <option value="admin">{t('teamsPage.roles.admin')}</option>
                                <option value="member">{t('teamsPage.roles.member')}</option>
                                <option value="viewer">{t('teamsPage.roles.viewer')}</option>
                              </NativeSelect>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100">
                                    <MoreHorizontal className="h-3.5 w-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44 border-zinc-800 bg-[#09090b] text-zinc-100">
                                  <DropdownMenuItem
                                    className="text-rose-300 focus:bg-rose-500/10 focus:text-rose-100"
                                    onClick={() =>
                                      void runBusyAction(async () => {
                                        await api.removeTeamMember(selectedTeamId, member.id)
                                        await loadTeams(selectedTeamId)
                                      })
                                    }
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    {t('teamsPage.actions.removeMember')}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        ))}
                        {members.length === 0 ? (
                          <div className="border border-dashed border-zinc-800 bg-[#09090b] px-4 py-10 text-center">
                            <Users className="mx-auto h-10 w-10 text-zinc-600" />
                            <p className="mt-3 text-sm text-zinc-500">{t('teamsPage.empty.noMembers')}</p>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* Member groups section 已迁移到 /overview「分组」tab（2026-08-19） */}

                    {/* Projects section */}
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/75">
                      <div className="flex items-center justify-between border-b border-zinc-900 px-4 py-3">
                        <div>
                          <h3 className="text-sm font-semibold text-zinc-100">{t('teamsPage.sections.projects.title')}</h3>
                          <p className="mt-0.5 text-[11px] text-zinc-500">{t('teamsPage.sections.projects.description')}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-48">
                            <SearchableSelect
                              value={projectId}
                              options={state.projects
                                .filter((project) => !projects.some((teamProject) => teamProject.id === project.id))
                                .map((project) => ({
                                  value: project.id,
                                  label: project.name,
                                  color: getProjectColor(project),
                                }))}
                              placeholder={t('teamsPage.projectSelect.placeholder')}
                              searchPlaceholder={t('teamsPage.projectSelect.searchPlaceholder')}
                              emptyText={t('teamsPage.projectSelect.emptyText')}
                              triggerClassName="h-7 rounded-lg px-2.5 text-xs"
                              onChange={setProjectId}
                            />
                          </div>
                          <Button
                            size="sm"
                            disabled={!selectedTeamId || !projectId}
                            onClick={() =>
                              void runBusyAction(async () => {
                                await api.addTeamProject(selectedTeamId, projectId)
                                setProjectId('')
                                await loadTeams(selectedTeamId)
                              })
                            }
                            className="h-7 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
                          >
                            <Plus className="mr-1.5 h-3 w-3" />
                            {t('teamsPage.actions.addProject')}
                          </Button>
                        </div>
                      </div>
                      <div className="divide-y divide-zinc-900">
                        {projects.map((project, index) => {
                          const nextProjectId = typeof project?.id === 'string' && project.id ? project.id : `unknown-project-${index}`
                          const projectName = typeof project?.name === 'string' && project.name.trim()
                            ? project.name.trim()
                            : nextProjectId
                          const projectInitial = projectName.charAt(0).toUpperCase() || 'P'

                          return (
                            <div key={nextProjectId} className="flex items-center justify-between px-4 py-2.5">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <Avatar className="h-7 w-7">
                                  <AvatarFallback className="bg-zinc-900 text-xs text-zinc-100">{projectInitial}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-zinc-100">{projectName}</p>
                                  <p className="truncate text-[11px] text-zinc-500">{typeof project?.gitUrl === 'string' && project.gitUrl ? project.gitUrl : t('teamsPage.projectNoRepo')}</p>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-md text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                                onClick={() =>
                                  void runBusyAction(async () => {
                                    await api.removeTeamProject(selectedTeamId, nextProjectId)
                                    await loadTeams(selectedTeamId)
                                  })
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )
                        })}
                        {projects.length === 0 ? (
                          <div className="border border-dashed border-zinc-800 bg-[#09090b] px-4 py-10 text-center">
                            <Plus className="mx-auto h-10 w-10 text-zinc-600" />
                            <p className="mt-3 text-sm text-zinc-500">{t('teamsPage.empty.noLinkedProjects')}</p>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* Executors section */}
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/75">
                      <div className="flex items-center justify-between border-b border-zinc-900 px-4 py-3">
                        <div>
                          <h3 className="text-sm font-semibold text-zinc-100">{t('teamsPage.sections.executors.title')}</h3>
                          <p className="mt-0.5 text-[11px] text-zinc-500">{t('teamsPage.sections.executors.description')}</p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => openCreateExecutor(selectedTeamId)}
                          className="h-7 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
                        >
                          <Server className="mr-1.5 h-3 w-3" />
                          {t('teamsPage.actions.addExecutor')}
                        </Button>
                      </div>
                      <div className="divide-y divide-zinc-900">
                        {executors.map((executor) => (
                          <div key={executor.executorId} className="px-4 py-2.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-300">
                                  <Server className="h-3.5 w-3.5" />
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-zinc-100">{executor.name}</p>
                                  <p className="truncate text-[11px] text-zinc-500">
                                    {executor.visibility === 'team' ? t('teamsPage.visibility.teamShared') : t('teamsPage.visibility.private')} · {t(`teamsPage.executorStatus.${executor.status}`)}
                                  </p>
                                </div>
                              </div>
                            <div className="flex items-center gap-2">
                                <Badge className="border-zinc-800 bg-zinc-950 text-zinc-300 text-[10px]">
                                  {t('teamsPage.executorConcurrency', { count: executor.maxConcurrency })}
                                </Badge>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => void handleRemoveExecutor(executor.executorId)}
                                  className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                                >
                                  <Trash2 className="mr-1 h-3 w-3" />
                                  {t('common.remove', { defaultValue: '移除' })}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEditExecutor(executor.executorId, selectedTeamId)}
                                  className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                                >
                                  <Pencil className="mr-1 h-3 w-3" />
                                  {t('teamsPage.actions.editSharing')}
                                </Button>
                              </div>
                            </div>
                            {executor.sharedProjectIds.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-1.5 pl-9">
                                {executor.sharedProjectIds.map((sharedProjectId) => (
                                  <Badge key={sharedProjectId} className="border-zinc-800 bg-zinc-950 text-zinc-400 text-[10px]">
                                    {projects.find((project) => project.id === sharedProjectId)?.name ?? sharedProjectId}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-1.5 pl-9 text-[11px] text-zinc-600">{t('teamsPage.empty.noAuthorizedProjects')}</p>
                            )}
                          </div>
                        ))}
                        {executors.length === 0 ? (
                          <div className="border border-dashed border-zinc-800 bg-[#09090b] px-4 py-10 text-center">
                            <Server className="mx-auto h-10 w-10 text-zinc-600" />
                            <p className="mt-3 text-sm text-zinc-500">{t('teamsPage.empty.noSharedExecutors')}</p>
                            {bindableExecutors.length > 0 ? (
                              <p className="mt-1 text-xs text-zinc-600">{t('teamsPage.actions.addExecutor')}</p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* Agent Brain（feature）：协作空间级配置 —— 开关 + 大脑 Agent + 行为提示词 + 计费门控 */}
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/75">
                      <div className="flex items-center justify-between border-b border-zinc-900 px-4 py-3">
                        <div>
                          <h3 className="text-sm font-semibold text-zinc-100">{t('teamsPage.sections.brain.title')}</h3>
                          <p className="mt-0.5 text-[11px] text-zinc-500">{t('teamsPage.sections.brain.description')}</p>
                        </div>
                        {brainBilling?.enforcementEnabled && brainBilling.requiresPaid && !brainBilling.allowed ? (
                          <Badge className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-300">{t('teamsPage.brain.proRequired')}</Badge>
                        ) : null}
                      </div>
                      <div className="space-y-3 px-4 py-3">
  const _gateUpgradeAvailable = false
                        {brainBilling?.enforcementEnabled && brainBilling.requiresPaid && !brainBilling.allowed ? (
                          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
                            <p className="text-xs leading-5 text-amber-200/90">{brainBilling.message || t('teamsPage.brain.lockedHint')}</p>
                            {getSettingsAction('workspace.billing.checkout') ? (
                              <Button
                                size="sm"
                                onClick={() => { const act = getSettingsAction('workspace.billing.checkout'); act?.({ teamId: selectedTeamId }) }}
                                className="mt-2 h-7 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
                              >
                                {t('teamsPage.brain.upgrade')}
                              </Button>
                            ) : null}
                          </div>
                        ) : null}

                        <label className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={Boolean(brainConfig?.enabled)}
                            disabled={Boolean(brainBilling?.enforcementEnabled && brainBilling.requiresPaid && !brainBilling.allowed)}
                            onChange={(event) =>
                              void runBusyAction(async () => {
                                const result = await workspaceAdmin.saveBrainConfig({ enabled: event.target.checked })
                                if (result?.message) toast.info(result.message)
                              })
                            }
                            className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950"
                          />
                          <span className="text-sm text-zinc-200">{t('teamsPage.brain.enableLabel')}</span>
                        </label>
                        <p className="text-[11px] leading-5 text-zinc-500">{t('teamsPage.brain.enableHint')}</p>

                        <div>
                          <label className="text-xs font-medium text-zinc-300">{t('teamsPage.brain.agentLabel')}</label>
                          <NativeSelect
                            value={brainConfig?.brainAgentId || ''}
                            disabled={!brainConfig?.enabled}
                            onChange={(event) =>
                              void runBusyAction(async () => {
                                await workspaceAdmin.saveBrainConfig({ brainAgentId: event.target.value || undefined })
                              })
                            }
                            className="mt-1 h-8 w-full text-xs"
                          >
                            <option value="">{t('teamsPage.brain.agentAuto')}</option>
                            {brainAgents.map((agent) => (
                              <option key={agent.id} value={agent.id}>{agent.name}</option>
                            ))}
                          </NativeSelect>
                          <p className="mt-1 text-[11px] leading-4 text-zinc-600">{t('teamsPage.brain.agentHint')}</p>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-zinc-300">{t('teamsPage.brain.instructionsLabel')}</label>
                          <textarea
                            value={brainConfig?.brainInstructions ?? ''}
                            disabled={!brainConfig?.enabled}
                            onChange={(event) => setBrainConfig((current) => (current ? { ...current, brainInstructions: event.target.value } : current))}
                            onBlur={() => {
                              const instructions = brainConfig?.brainInstructions?.trim()
                              if (instructions) {
                                void runBusyAction(async () => {
                                  await workspaceAdmin.saveBrainConfig({ brainInstructions: instructions })
                                })
                              }
                            }}
                            rows={8}
                            className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs leading-5 text-zinc-200 outline-none focus:border-zinc-700"
                          />
                          <p className="mt-1 text-[11px] leading-4 text-zinc-600">{t('teamsPage.brain.instructionsHint')}</p>
                        </div>
                      </div>
                    </div>

                    {/* Activities section */}
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/75">
                      <div className="border-b border-zinc-900 px-4 py-3">
                        <h3 className="text-sm font-semibold text-zinc-100">{t('teamsPage.sections.activities.title')}</h3>
                        <p className="mt-0.5 text-[11px] text-zinc-500">{t('teamsPage.sections.activities.description')}</p>
                      </div>
                      <div className="divide-y divide-zinc-900">
                        {activities.map((activity) => (
                          <div key={activity.id} className="flex items-start gap-3 px-4 py-2.5">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-300">
                              <Activity className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-zinc-100">{activity.action}</p>
                              <p className="mt-0.5 text-[11px] text-zinc-500">
                                {activity.targetType ?? activity.entityType} {(activity.targetId ?? activity.entityId) ? `#${activity.targetId ?? activity.entityId}` : ''}
                              </p>
                            </div>
                            <span className="shrink-0 text-[11px] text-zinc-600">{formatDate(activity.createdAt)}</span>
                          </div>
                        ))}
                        {activities.length === 0 ? (
                          <div className="border border-dashed border-zinc-800 bg-[#09090b] px-4 py-10 text-center">
                            <Activity className="mx-auto h-10 w-10 text-zinc-600" />
                            <p className="mt-3 text-sm text-zinc-500">{t('teamsPage.empty.noActivities')}</p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : teams.length > 0 ? (
              <div className="flex h-full min-h-[26rem] flex-col items-center justify-center p-8 text-center">
                <Users className="mb-4 h-16 w-16 text-zinc-600" />
                <h3 className="text-lg font-semibold text-zinc-100">{t('teamsPage.empty.selectTeamTitle')}</h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">{t('teamsPage.empty.selectTeamDescription')}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  )
}
