import { CheckCircle2, Copy, Mail, Trash2 } from 'lucide-react'
import { api, type TeamRole } from '../../lib/api'
import { isImeComposingKeyboardEvent } from '../../lib/ime-keyboard'
import { formatDate } from '../../lib/utils'
import type { WorkspaceAdminPanelState } from './use-workspace-admin-panel-state'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { Checkbox } from '../ui/checkbox'

export function WorkspaceAdminPanelDialogs({
  workspaceAdmin,
}: {
  workspaceAdmin: WorkspaceAdminPanelState
}) {
  const {
    busy,
    copiedLinkId,
    createDialogOpen,
    createName,
    executorPickerOpen,
    editDescription,
    editDialogOpen,
    editName,
    bindableExecutors,
    handleCopyInviteLink,
    handleBindExecutors,
    handleSendInvitation,
    inviteDialogOpen,
    inviteEmail,
    inviteRole,
    invitations,
    loadTeams,
    runBusyAction,
    selectedTeamId,
    selectedExecutorIds,
    setCreateDialogOpen,
    setCreateName,
    setExecutorPickerOpen,
    setEditDescription,
    setEditDialogOpen,
    setEditName,
    setInviteDialogOpen,
    setInviteEmail,
    setInviteRole,
    setSelectedExecutorIds,
    t,
    teamDetail,
  } = workspaceAdmin

  return (
    <>
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40">
          <DialogHeader>
            <DialogTitle>{t('teamsPage.dialogs.create.title')}</DialogTitle>
            <DialogDescription className="text-zinc-500">{t('teamsPage.dialogs.create.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-5 py-4">
            <label className="text-sm font-medium text-zinc-300">{t('teamsPage.fields.teamName')}</label>
            <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder={t('teamsPage.fields.teamNamePlaceholder')} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)} className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50">
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!createName.trim() || busy}
              onClick={() =>
                void runBusyAction(async () => {
                  const response = await api.createTeam(createName.trim(), {
                    sourceWorkspaceId: selectedTeamId || undefined,
                  })
                  setCreateName('')
                  setCreateDialogOpen(false)
                  await loadTeams(response.team.id)
                })
              }
              className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
            >
              {t('teamsPage.actions.createTeam')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40">
          <DialogHeader>
            <DialogTitle>{t('teamsPage.dialogs.edit.title')}</DialogTitle>
            <DialogDescription className="text-zinc-500">{t('teamsPage.dialogs.edit.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-5 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">{t('teamsPage.fields.teamName')}</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t('teamsPage.fields.teamName')} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">{t('teamsPage.fields.teamDescription')}</label>
              <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder={t('teamsPage.fields.teamDescription')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50">
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!teamDetail || !editName.trim() || busy}
              onClick={() =>
                void runBusyAction(async () => {
                  if (!teamDetail) return
                  await api.updateTeam(teamDetail.id, {
                    name: editName.trim(),
                    description: editDescription.trim(),
                    avatarUrl: teamDetail.avatarUrl || undefined,
                  })
                  setEditDialogOpen(false)
                  await loadTeams(teamDetail.id)
                })
              }
              className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
            >
              {t('teamsPage.actions.saveChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>{t('teamsPage.dialogs.invite.title')}</DialogTitle>
            <DialogDescription className="text-zinc-500">{t('teamsPage.dialogs.invite.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-5 py-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                className="min-w-0 flex-1"
                placeholder={t('teamsPage.fields.emailPlaceholder')}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (isImeComposingKeyboardEvent(e)) {
                    return
                  }

                  if (e.key === 'Enter' && selectedTeamId && inviteEmail.trim()) {
                    void handleSendInvitation()
                  }
                }}
              />
              <NativeSelect
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as TeamRole)}
                wrapperClassName="shrink-0 sm:w-28"
              >
                <option value="admin">{t('teamsPage.roles.admin')}</option>
                <option value="member">{t('teamsPage.roles.member')}</option>
                <option value="viewer">{t('teamsPage.roles.viewer')}</option>
              </NativeSelect>
            </div>
            <Button
              disabled={!selectedTeamId || !inviteEmail.trim() || busy}
              onClick={() => void handleSendInvitation()}
              className="w-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
            >
              <Mail className="mr-2 h-4 w-4" />
              {t('teamsPage.actions.sendInvite')}
            </Button>

            {invitations.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-medium text-zinc-400">{t('teamsPage.pendingInvitations')}</p>
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {invitations.map((invitation) => (
                    <div
                      key={invitation.id}
                      className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-zinc-200">{invitation.email}</p>
                        <p className="text-xs text-zinc-500">{t(`teamsPage.roles.${invitation.role}`)} · {formatDate(invitation.expiresAt)}</p>
                      </div>
                      <div className="ml-0 flex items-center gap-1 sm:ml-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void handleCopyInviteLink(invitation)}
                          className="h-8 w-8 rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                        >
                          {copiedLinkId === invitation.id ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg text-rose-400 hover:bg-zinc-800 hover:text-rose-300"
                          onClick={() =>
                            void runBusyAction(async () => {
                              await api.cancelTeamInvitation(invitation.id)
                              await loadTeams(selectedTeamId)
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={executorPickerOpen} onOpenChange={setExecutorPickerOpen}>
        <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>{t('teamsPage.actions.addExecutor')}</DialogTitle>
            <DialogDescription className="text-zinc-500">勾选当前用户拥有的执行节点，确认后直接绑定到这个组织。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-5 py-4">
            {bindableExecutors.length > 0 ? (
              <div className="max-h-[24rem] space-y-2 overflow-y-auto">
                {bindableExecutors.map((executor) => {
                  const checked = selectedExecutorIds.includes(executor.executorId)
                  return (
                    <label
                      key={executor.executorId}
                      className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-3 hover:border-zinc-700 hover:bg-zinc-900/60"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) => {
                          setSelectedExecutorIds((current) => {
                            if (nextChecked) {
                              return Array.from(new Set([...current, executor.executorId]))
                            }
                            return current.filter((item) => item !== executor.executorId)
                          })
                        }}
                        className="mt-0.5 border-zinc-700 data-[state=checked]:border-zinc-100 data-[state=checked]:bg-zinc-100 data-[state=checked]:text-zinc-950"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-100">{executor.name}</p>
                        <p className="mt-1 truncate text-xs text-zinc-500">{executor.machineName} · {executor.status}</p>
                        {executor.workspaceIds && executor.workspaceIds.length > 0 ? (
                          <p className="mt-1 text-xs text-zinc-600">已共享到 {executor.workspaceIds.length} 个组织</p>
                        ) : null}
                      </div>
                    </label>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 px-4 py-10 text-center text-sm text-zinc-500">
                当前没有可添加的执行节点。你可以先到节点管理创建节点，或编辑已有节点共享范围。
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedExecutorIds([])
                setExecutorPickerOpen(false)
              }}
              className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
            >
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!selectedTeamId || selectedExecutorIds.length === 0 || busy}
              onClick={() => void handleBindExecutors()}
              className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
            >
              添加已选节点
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
