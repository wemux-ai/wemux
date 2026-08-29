/**
 * [INPUT]: Agent registry state, draft mutations, and portable package actions.
 * [OUTPUT]: The Agent control center shell and its focused primary actions.
 * [POS]: Web Agent surface; separates daily use from configuration and management.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { Archive, Download, FilePlus2, MoreHorizontal, Orbit, PackagePlus, Plus, Save, Trash2, Upload } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { duplicateCustomAgentDraft, parseCustomAgentProfile } from '../../lib/custom-agent'
import { getAgentAvatarAccent } from '../../lib/agent-avatar'
import { getAgentLiveStatus, useAgentLiveStatuses } from '../../lib/agent-live-status'
import { resolveMediaUrl } from '../../lib/api'
import { useTranslation } from '../../lib/i18n/react'
import { useAgentsContentState } from '../../routes/-use-agents-content-state'
import { cn } from '../../lib/utils'
import { CustomAgentDetailPanel } from './custom-agent-detail-panel'
import type { SettingsTab } from './custom-agent-detail-panel-shared'
import { CustomAgentTemplateLibraryPanel } from './custom-agent-template-library-panel'

const getAgentInitials = (name: string) => (name.trim() || 'Agent').slice(0, 2).toUpperCase()

export function AgentsPage({
  requestedAgentId,
  requestedTab,
  createToken,
}: {
  requestedAgentId?: string
  requestedTab?: SettingsTab
  createToken?: string
}) {
  const { language, t } = useTranslation()
  const {
    activeTab,
    addManualMcp,
    addManualSkill,
    addMcpFromGlobal,
    addSkillFromCatalog,
    applyImportAsDraft,
    applyTemplateLibraryItem,
    archiveAgent,
    auditEntries,
    auditSummary,
    availableSkills,
    avatarBusy,
    avatarStorage,
    channelWebhookUrls,
    cleanupWorkdir,
    confirmImportAgent,
    creating,
    deleteAgent,
    deleteWorkdirFile,
    deleting,
    deleteTemplateLibraryEntry,
    disconnectFeishu,
    disconnectWechat,
    deleteTelegramWebhook,
    draft,
    downloadWorkdirFile,
    ensureWorkdir,
    exporting,
    exportingTemplate,
    exportSelectedAgent,
    exportTemplatePackage,
    filteredTemplateLibrary,
    heartbeats,
    importAgentFile,
    importing,
    importInputRef,
    loading,
    collaborationWorkspaces,
    manualMcpName,
    manualMcpTarget,
    manualSkillName,
    mcpQuery,
    openTemplateExportDialog,
    openTemplateUpdateDialog,
    pendingImportDraft,
    pendingImportReport,
    pendingPackageKind,
    pendingPackageName,
    pendingPortablePackage,
    pendingPrimarySummary,
    toggleProjectId,
    toggleWorkspaceId,
    readWorkdirFile,
    refreshWorkdir,
    removeMcp,
    removeSkill,
    saveAgent,
    savePendingTemplateToLibrary,
    saveTemplateToLibrary,
    saving,
    selectedAgent,
    selectedAgentId,
    selectedTemplateLibraryId,
    selectedTemplateLibraryItem,
    setActiveTab,
    setDraft,
    setManualMcpName,
    setManualMcpTarget,
    setManualSkillName,
    setMcpQuery,
    setPendingPortablePackage,
    setSelectedTemplateLibraryId,
    setSkillQuery,
    setTemplateCategoryFilter,
    setTemplateExportDraft,
    setTemplateExportOpen,
    setTemplateExportTargetId,
    setTemplateQuery,
    skillQuery,
    startCreate,
    state,
    suggestedMcpServers,
    suggestedSkills,
    tasks,
    telegramWebhookInfo,
    templateCategoryFilter,
    templateDiffSummary,
    templateExportDraft,
    templateExportOpen,
    templateExportTargetId,
    templateLibrary,
    templateQuery,
    updateMcp,
    updateSkill,
    uploadAgentAvatar,
    validation,
    workdirFiles,
    workdirLoading,
    workdirRefreshing,
    workdirSummary,
  } = useAgentsContentState({ requestedAgentId, requestedTab, createToken })
  const selectedProfile = selectedAgent ? parseCustomAgentProfile(selectedAgent) : null
  const liveStatuses = useAgentLiveStatuses()
  const selectedAgentLiveStatus = selectedAgent ? getAgentLiveStatus(liveStatuses, selectedAgent.id, selectedAgent.name) : undefined
  const agentDisplayName = creating
    ? (language === 'zh' ? '新建 Agent' : 'New agent')
    : selectedAgent?.name || (language === 'zh' ? '选择一个 Agent' : 'Select an agent')
  const agentStatus = creating
    ? { label: language === 'zh' ? '草稿' : 'Draft', dotClassName: 'bg-zinc-500' }
    : draft.archived
      ? { label: language === 'zh' ? '已归档' : 'Archived', dotClassName: 'bg-rose-400' }
      : !draft.enabled
        ? { label: language === 'zh' ? '已停用' : 'Disabled', dotClassName: 'bg-amber-400' }
        : selectedAgent?.status === 'online'
          ? { label: language === 'zh' ? '在线' : 'Online', dotClassName: 'bg-emerald-400' }
          : { label: language === 'zh' ? '已就绪' : 'Ready', dotClassName: 'bg-sky-400' }
  // 只有真正的配置 tab 才显示保存；聊天/Inbox/运行都是只读视图。
  const isConfiguringAgent = activeTab !== 'chat' && activeTab !== 'inbox' && activeTab !== 'activity'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#050505]">
      <section className="shrink-0 border-b border-zinc-900 bg-[#070708] px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex w-full min-w-0 items-center gap-3 sm:flex-1">
            <Avatar className="size-10 shrink-0 rounded-lg border border-zinc-800 bg-zinc-950">
                <AvatarImage src={resolveMediaUrl(draft.avatarUrl)} className="object-cover" />
                <AvatarFallback className={cn(
                  'rounded-lg text-xs font-bold',
                  selectedAgent
                    ? `text-zinc-950 ${getAgentAvatarAccent(selectedAgent.id)}`
                    : 'bg-zinc-800 text-zinc-400',
                )}>
                  {getAgentInitials(agentDisplayName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h1 className="truncate text-base font-semibold text-zinc-50 sm:text-lg">{agentDisplayName}</h1>
                  <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-400">
                    <span className={`size-1.5 rounded-full ${agentStatus.dotClassName}`} />
                    {agentStatus.label}
                  </span>
                  {selectedAgentLiveStatus && selectedAgentLiveStatus.workingCount > 0 ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                      {language === 'zh' ? '正在工作' : 'Working'}
                      {selectedAgentLiveStatus.workingCount > 1 ? ` ${selectedAgentLiveStatus.workingCount}` : ''}
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-xs text-zinc-500">{selectedProfile?.role || (creating ? t('agents.custom.page.context.creatingAgent') : t('agents.custom.page.context.editingAgentConfig'))}</p>
              </div>
            </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  void importAgentFile(event)
                }}
              />
              <Link
                to={'/universe' as never}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-zinc-50"
              >
                <Orbit size={14} />
                {language === 'zh' ? '宇宙视图' : 'Universe'}
              </Link>
              {!creating ? (
                <Button variant="outline" onClick={() => startCreate()} className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50">
                  <Plus size={16} />
                  {t('agents.custom.page.actions.createAgent')}
                </Button>
              ) : null}
              {isConfiguringAgent && !creating ? (
                <Button onClick={() => void saveAgent()} disabled={saving} className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200">
                  <Save size={16} />
                  {saving ? t('agents.custom.page.actions.saving') : t('common.save')}
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={language === 'zh' ? '更多 Agent 操作' : 'More agent actions'}
                    className="border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-50"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>{language === 'zh' ? '管理 Agent' : 'Manage agent'}</DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem disabled={importing} onSelect={() => importInputRef.current?.click()}>
                      <Upload />
                      {importing ? t('agents.custom.page.actions.processing') : t('agents.custom.page.actions.importPackage')}
                    </DropdownMenuItem>
                    {!creating && selectedAgent ? (
                      <>
                        <DropdownMenuItem disabled={exporting} onSelect={() => void exportSelectedAgent()}>
                          <Download />
                          {exporting ? t('agents.custom.page.actions.exporting') : t('agents.custom.page.actions.export')}
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={exportingTemplate} onSelect={openTemplateExportDialog}>
                          <FilePlus2 />
                          {exportingTemplate ? t('agents.custom.page.actions.processing') : t('agents.custom.page.actions.exportTemplate')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => startCreate(duplicateCustomAgentDraft(draft))}>
                          <PackagePlus />
                          {t('common.copy')}
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuGroup>
                  {!creating && selectedAgent ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem disabled={saving} onSelect={() => void archiveAgent(!draft.archived)}>
                          <Archive />
                          {draft.archived ? t('agents.custom.page.actions.restore') : t('agents.custom.page.actions.archive')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={deleting}
                          onSelect={() => void deleteAgent()}
                          className="text-rose-300 focus:bg-rose-500/10 focus:text-rose-100"
                        >
                          <Trash2 />
                          {deleting ? t('agents.custom.page.actions.deleting') : t('common.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
        </div>
      </section>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {creating && templateLibrary.length > 0 ? (
            <div className="shrink-0 px-3 pt-3 sm:px-4 sm:pt-4">
              <CustomAgentTemplateLibraryPanel
                templateLibrary={templateLibrary}
                filteredTemplateLibrary={filteredTemplateLibrary}
                selectedTemplateLibraryId={selectedTemplateLibraryId}
                templateQuery={templateQuery}
                templateCategoryFilter={templateCategoryFilter}
                onTemplateQueryChange={setTemplateQuery}
                onTemplateCategoryFilterChange={setTemplateCategoryFilter}
                onSelectTemplateLibraryItem={setSelectedTemplateLibraryId}
                onApplyTemplateLibraryItem={applyTemplateLibraryItem}
                onUpdateTemplateLibraryItem={openTemplateUpdateDialog}
                onDeleteTemplateLibraryItem={deleteTemplateLibraryEntry}
              />
            </div>
          ) : null}

          <div className="min-h-0 flex-1">
            {loading ? (
              <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#09090b]">
                <div className="flex items-center gap-2 border-b border-zinc-900 px-4 py-2">
                  <div className="h-8 w-24 animate-pulse rounded-md bg-zinc-900" />
                  <div className="h-8 w-16 animate-pulse rounded-md bg-zinc-900/60" />
                </div>
                <div className="flex-1 space-y-4 p-4">
                  <div className="h-24 animate-pulse rounded-xl border border-zinc-900 bg-zinc-950/60" />
                  <div className="h-40 animate-pulse rounded-xl border border-zinc-900 bg-zinc-950/60" />
                  <div className="h-28 animate-pulse rounded-xl border border-zinc-900 bg-zinc-950/60" />
                </div>
              </div>
            ) : (
            <CustomAgentDetailPanel
              creating={creating}
              selectedAgent={selectedAgent}
              selectedAgentId={selectedAgentId}
              telegramWebhookUrl={channelWebhookUrls.telegram}
              feishuEventCallbackUrl={channelWebhookUrls.feishu}
              wecomCallbackUrl={channelWebhookUrls.wecom}
              whatsappCallbackUrl={channelWebhookUrls.whatsapp}
              telegramWebhookInfo={telegramWebhookInfo}
              workdirSummary={workdirSummary}
              workdirFiles={workdirFiles}
              workdirLoading={workdirLoading}
              workdirRefreshing={workdirRefreshing}
              draft={draft}
              validation={validation}
              activeTab={activeTab}
              availableSkills={availableSkills}
              suggestedSkills={suggestedSkills}
              suggestedMcpServers={suggestedMcpServers}
              avatarStorage={avatarStorage}
              avatarBusy={avatarBusy}
              manualSkillName={manualSkillName}
              manualMcpName={manualMcpName}
              manualMcpTarget={manualMcpTarget}
              collaborationWorkspaces={collaborationWorkspaces}
              state={state}
              tasks={tasks}
              heartbeats={heartbeats}
              auditEntries={auditEntries}
              auditSummary={auditSummary}
              skillQuery={skillQuery}
              mcpQuery={mcpQuery}
              onTabChange={setActiveTab}
              onSave={saveAgent}
              onDraftChange={(updater) => setDraft((current) => updater(current))}
              onSkillQueryChange={setSkillQuery}
              onManualSkillNameChange={setManualSkillName}
              onUploadAvatar={uploadAgentAvatar}
              onAddManualSkill={addManualSkill}
              onAddSkillFromCatalog={addSkillFromCatalog}
              onUpdateSkill={updateSkill}
              onRemoveSkill={removeSkill}
              onMcpQueryChange={setMcpQuery}
              onManualMcpNameChange={setManualMcpName}
              onManualMcpTargetChange={setManualMcpTarget}
              onAddManualMcp={addManualMcp}
              onAddMcpFromGlobal={addMcpFromGlobal}
              onUpdateMcp={updateMcp}
              onRemoveMcp={removeMcp}
              onToggleProjectId={toggleProjectId}
              onToggleWorkspaceId={toggleWorkspaceId}
              onDeleteTelegramWebhook={deleteTelegramWebhook}
              onDisconnectFeishu={disconnectFeishu}
              onDisconnectWechat={disconnectWechat}
              onEnsureWorkdir={ensureWorkdir}
              onRefreshWorkdir={refreshWorkdir}
              onCleanupWorkdir={cleanupWorkdir}
              onReadWorkdirFile={readWorkdirFile}
              onDownloadWorkdirFile={downloadWorkdirFile}
              onDeleteWorkdirFile={deleteWorkdirFile}
            />
            )}
          </div>
        </div>

      <Dialog open={Boolean(pendingPortablePackage)} onOpenChange={(open) => {
        if (!open && !importing) {
          setPendingPortablePackage(null)
        }
      }}>
        <DialogContent className="max-w-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>{t('agents.custom.dialogs.importPreview.title')}</DialogTitle>
            <DialogDescription className="text-zinc-400">
              {pendingPackageKind === 'vibemux-custom-agent-template'
                ? t('agents.custom.dialogs.importPreview.templateDescription')
                : t('agents.custom.dialogs.importPreview.agentDescription')}
            </DialogDescription>
          </DialogHeader>

          {pendingPortablePackage && pendingImportDraft && pendingImportReport ? (
            <div className="space-y-4 px-5 py-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="rounded-2xl border-zinc-800 bg-[#09090b] text-zinc-100 shadow-none">
                  <CardContent className="space-y-3 p-4">
                    <p className="text-sm font-semibold text-zinc-100">
                      {pendingPackageKind === 'vibemux-custom-agent-template'
                        ? t('agents.custom.dialogs.importPreview.templateContentTitle')
                        : t('agents.custom.dialogs.importPreview.packageContentTitle')}
                    </p>
                    <ImportPreviewRow label={t('agents.custom.dialogs.importPreview.fields.name')} value={pendingPackageName} />
                    <ImportPreviewRow label={t('agents.custom.dialogs.importPreview.fields.role')} value={pendingImportDraft.role || t('agents.custom.dialogs.importPreview.unset')} />
                    <ImportPreviewRow label={t('agents.custom.dialogs.importPreview.fields.category')} value={pendingImportDraft.category} />
                    <ImportPreviewRow
                      label={pendingPackageKind === 'vibemux-custom-agent-template'
                        ? t('agents.custom.dialogs.importPreview.fields.templateSummary')
                        : t('agents.custom.dialogs.importPreview.fields.invocationMode')}
                      value={pendingPrimarySummary}
                    />
                    <ImportPreviewRow label={t('agents.custom.dialogs.importPreview.fields.skills')} value={`${pendingImportDraft.skills.filter((item) => item.enabled).length}`} />
                    <ImportPreviewRow label={t('agents.custom.dialogs.importPreview.fields.mcp')} value={`${pendingImportDraft.mcpServers.filter((item) => item.enabled).length}`} />
                  </CardContent>
                </Card>

                <Card className="rounded-2xl border-zinc-800 bg-[#09090b] text-zinc-100 shadow-none">
                  <CardContent className="space-y-3 p-4">
                    <p className="text-sm font-semibold text-zinc-100">{t('agents.custom.dialogs.importPreview.checkTitle')}</p>
                    <ImportPreviewRow label={t('agents.custom.dialogs.importPreview.fields.readinessScore')} value={`${pendingImportReport.score}`} />
                    <ImportPreviewRow
                      label={t('agents.custom.dialogs.importPreview.fields.status')}
                      value={pendingImportReport.status === 'ready'
                        ? t('agents.custom.dialogs.importPreview.status.ready')
                        : pendingImportReport.status === 'blocked'
                          ? t('agents.custom.dialogs.importPreview.status.blocked')
                          : t('agents.custom.dialogs.importPreview.status.review')}
                    />
                    <ImportPreviewRow
                      label={t('agents.custom.dialogs.importPreview.fields.missingSkills')}
                      value={pendingImportReport.missingSkillNames.length > 0 ? pendingImportReport.missingSkillNames.join(' / ') : t('agents.custom.dialogs.importPreview.none')}
                    />
                    <ImportPreviewRow
                      label={t('agents.custom.dialogs.importPreview.fields.unresolvedMcp')}
                      value={pendingImportReport.unresolvedMcpNames.length > 0 ? pendingImportReport.unresolvedMcpNames.join(' / ') : t('agents.custom.dialogs.importPreview.none')}
                    />
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-2xl border-zinc-800 bg-[#09090b] text-zinc-100 shadow-none">
                <CardContent className="space-y-3 p-4">
                  <p className="text-sm font-semibold text-zinc-100">{t('agents.custom.dialogs.importPreview.remindersTitle')}</p>
                  <div className="space-y-2 text-xs leading-5">
                    {pendingImportReport.issues.length > 0 ? pendingImportReport.issues.map((issue) => (
                      <div
                        key={issue.code}
                        className={
                          issue.level === 'error'
                            ? 'rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-3 text-rose-100'
                            : issue.level === 'warning'
                              ? 'rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-amber-100'
                              : 'rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3 text-zinc-300'
                        }
                      >
                        - {issue.message}
                      </div>
                    )) : (
                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-3 text-emerald-100">
                        - {t('agents.custom.dialogs.importPreview.noBlockingIssues')}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={importing}
              onClick={() => setPendingPortablePackage(null)}
              className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
            >
              {t('common.cancel')}
            </Button>
            <div className="flex flex-wrap gap-2">
              {pendingPackageKind === 'vibemux-custom-agent-template' ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={importing || !pendingPortablePackage}
                  onClick={savePendingTemplateToLibrary}
                  className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                >
                  {t('agents.custom.dialogs.templateExport.saveToLibrary')}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={importing || !pendingImportDraft}
                onClick={applyImportAsDraft}
                className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
              >
                {pendingPackageKind === 'vibemux-custom-agent-template'
                  ? t('agents.custom.dialogs.importPreview.createDraftFromTemplate')
                  : t('agents.custom.dialogs.importPreview.applyAsDraft')}
              </Button>
              {pendingPackageKind === 'vibemux-custom-agent' ? (
                <Button
                  type="button"
                  disabled={importing || !pendingPortablePackage}
                  onClick={() => void confirmImportAgent()}
                  className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                >
                  {importing ? t('agents.custom.dialogs.importPreview.importing') : t('agents.custom.dialogs.importPreview.importAsNewAgent')}
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={templateExportOpen} onOpenChange={(open) => {
        if (!exportingTemplate) {
          setTemplateExportOpen(open)
          if (!open) {
            setTemplateExportTargetId(null)
          }
        }
      }}>
        <DialogContent className="max-w-2xl border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>{templateExportTargetId ? t('agents.custom.dialogs.templateExport.updateTitle') : t('agents.custom.dialogs.templateExport.exportTitle')}</DialogTitle>
            <DialogDescription className="text-zinc-400">
              {templateExportTargetId
                ? t('agents.custom.dialogs.templateExport.updateDescription', { name: selectedTemplateLibraryItem?.package.template.name || t('agents.custom.dialogs.templateExport.unnamedTemplate') })
                : t('agents.custom.dialogs.templateExport.exportDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-5 py-4">
            {templateExportTargetId && selectedTemplateLibraryItem ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="rounded-2xl border-zinc-800 bg-[#09090b] text-zinc-100 shadow-none">
                  <CardContent className="space-y-3 p-4">
                    <p className="text-sm font-semibold text-zinc-100">{t('agents.custom.dialogs.templateExport.currentTemplateTitle')}</p>
                    <ImportPreviewRow label={t('agents.custom.dialogs.templateExport.fields.version')} value={`v${selectedTemplateLibraryItem.version}`} />
                    <ImportPreviewRow label={t('agents.custom.dialogs.templateExport.fields.updatedAt')} value={selectedTemplateLibraryItem.updatedAt} />
                    <ImportPreviewRow label={t('agents.custom.dialogs.templateExport.fields.templateName')} value={selectedTemplateLibraryItem.package.template.name} />
                    <ImportPreviewRow label={t('agents.custom.dialogs.templateExport.fields.draftName')} value={selectedTemplateLibraryItem.package.draft.name} />
                  </CardContent>
                </Card>
                <Card className="rounded-2xl border-zinc-800 bg-[#09090b] text-zinc-100 shadow-none">
                  <CardContent className="space-y-3 p-4">
                    <p className="text-sm font-semibold text-zinc-100">{t('agents.custom.dialogs.templateExport.nextPreviewTitle')}</p>
                    <ImportPreviewRow label={t('agents.custom.dialogs.templateExport.fields.nextVersion')} value={`v${selectedTemplateLibraryItem.version + 1}`} />
                    <ImportPreviewRow label={t('agents.custom.dialogs.templateExport.fields.templateName')} value={templateExportDraft.templateName || t('agents.custom.dialogs.templateExport.unfilled')} />
                    <ImportPreviewRow label={t('agents.custom.dialogs.templateExport.fields.draftName')} value={templateExportDraft.draftName || t('agents.custom.dialogs.templateExport.unfilled')} />
                    <ImportPreviewRow label={t('agents.custom.dialogs.templateExport.fields.templateSummary')} value={templateExportDraft.templateSummary || t('agents.custom.dialogs.templateExport.unfilled')} />
                  </CardContent>
                </Card>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-zinc-200">{t('agents.custom.dialogs.templateExport.fields.templateName')}</span>
                <Input
                  value={templateExportDraft.templateName}
                  onChange={(event) => setTemplateExportDraft((current) => ({ ...current, templateName: event.target.value }))}
                  placeholder={t('agents.custom.dialogs.templateExport.placeholders.templateName')}
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-zinc-200">{t('agents.custom.dialogs.templateExport.fields.draftName')}</span>
                <Input
                  value={templateExportDraft.draftName}
                  onChange={(event) => setTemplateExportDraft((current) => ({ ...current, draftName: event.target.value }))}
                  placeholder={t('agents.custom.dialogs.templateExport.placeholders.draftName')}
                />
              </label>
            </div>

            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-200">{t('agents.custom.dialogs.templateExport.fields.templateSummary')}</span>
              <Input
                value={templateExportDraft.templateSummary}
                onChange={(event) => setTemplateExportDraft((current) => ({ ...current, templateSummary: event.target.value }))}
                placeholder={t('agents.custom.dialogs.templateExport.placeholders.templateSummary')}
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-200">{t('agents.custom.dialogs.templateExport.fields.templateDescription')}</span>
              <Textarea
                value={templateExportDraft.templateDescription}
                onChange={(event) => setTemplateExportDraft((current) => ({ ...current, templateDescription: event.target.value }))}
                rows={5}
                placeholder={t('agents.custom.dialogs.templateExport.placeholders.templateDescription')}
              />
            </label>

            {templateDiffSummary ? (
              <div className="rounded-2xl border border-zinc-800 bg-[#09090b] px-4 py-4">
                <p className="text-sm font-medium text-zinc-100">{t('agents.custom.dialogs.templateExport.diffTitle')}</p>
                <div className="mt-3 space-y-1 text-xs leading-5 text-zinc-400">
                  {templateDiffSummary.changed ? templateDiffSummary.lines.map((line) => (
                    <p key={line}>- {line}</p>
                  )) : (
                    <p>- {t('agents.custom.dialogs.templateExport.noDiff')}</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={exportingTemplate}
              onClick={() => setTemplateExportOpen(false)}
              className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
            >
              {t('common.cancel')}
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={exportingTemplate}
                onClick={() => void saveTemplateToLibrary()}
                className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
              >
                {exportingTemplate
                  ? t('agents.custom.page.actions.processing')
                  : templateExportTargetId
                    ? t('agents.custom.dialogs.templateExport.overwriteSave')
                    : t('agents.custom.dialogs.templateExport.saveToLibrary')}
              </Button>
              <Button
                type="button"
                disabled={exportingTemplate}
                onClick={() => void exportTemplatePackage()}
                className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
              >
                {exportingTemplate ? t('agents.custom.page.actions.exporting') : t('agents.custom.dialogs.templateExport.exportPackage')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ImportPreviewRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-1 text-sm text-zinc-200">{value}</p>
    </div>
  )
}
