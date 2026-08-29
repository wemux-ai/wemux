/**
 * [INPUT]: Custom Agent draft, collaboration workspace/project scope catalog, mounted capabilities, execution state, and activity records.
 * [OUTPUT]: Task-oriented Agent views with visual sharing controls, configuration, model settings, advanced settings, and runs.
 * [POS]: Main Agent detail surface inside the Web control center.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { MANAGED_CLOUD_AUTO_EXECUTOR_ID } from '@shared/managed-cloud'
import { isExecutorEffectivelyOnline } from '../../lib/managed-cloud-executor'
import type { RuntimeId } from '@shared/types'
import { Activity, Bot, BrainCircuit, Cable, CalendarClock, Camera, Check, ChevronRight, Cpu, FolderOpen, Inbox, Loader2, Lock, MessageSquareText, Radio, Settings2, ShieldCheck, Sparkles, Unplug, Users, Waypoints } from 'lucide-react'
import { CustomAgentActivityPanel, type CustomAgentAuditEntry, type CustomAgentAuditSummary } from './custom-agent-activity-panel'
import { AgentRunOverview } from './agent-run-overview'
import { CustomAgentChatPanel } from './custom-agent-chat-panel'
import { AgentMindPanel } from './agent-mind-panel'
import { AgentFilesPanel } from './agent-files-panel'
import { AgentHeartbeatSchedulePanel } from './agent-heartbeat-schedule-panel'
import { CustomAgentInboxPanel } from './custom-agent-inbox-panel'
import { FeishuQrBindingDialog } from './feishu-qr-binding-dialog'
import { WechatQrBindingDialog } from './wechat-qr-binding-dialog'
import { ChannelConfigDialog } from './channel-config-dialog'
import { CHANNEL_METAS, type AgentChannelKey } from './channel-metadata'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { SearchableSelect } from '../ui/searchable-select'
import { Separator } from '../ui/separator'
import { Switch } from '../ui/switch'
import { Textarea } from '../ui/textarea'
import { CapabilityCard } from '../capabilities/capability-card'
import { CapabilityEmptyState } from '../capabilities/capability-empty-state'
import { CapabilitySummaryStrip } from '../capabilities/capability-summary-strip'
import {
  buildCustomAgentConfig,
  applyDelegatePresetToDraft,
  CUSTOM_AGENT_DELEGATE_BASE_BRANCH_MODE_OPTIONS,
  CUSTOM_AGENT_DELEGATE_PRESET_UI_OPTIONS,
  CUSTOM_AGENT_DELEGATE_SESSION_MODE_OPTIONS,
  CUSTOM_AGENT_DELEGATE_WORKING_DIRECTORY_MODE_OPTIONS,
  SUB_AGENT_SESSION_ROLE_OPTIONS,
  type CustomAgentDraft,
  type CustomAgentDraftValidation,
  type CustomAgentTemplateId,
  type CustomAgentTemplateOption,
  type CustomAgentTemplateRecommendation,
} from '../../lib/custom-agent'
import { BUILT_IN_AGENT_AVATARS, getAgentAvatarAccent } from '../../lib/agent-avatar'
import { normalizeLookupKey } from '../../lib/custom-agent/helpers'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import { api, resolveMediaUrl } from '../../lib/api'
import { ExecutorSelect } from '../ui/executor-select'
import { compatibilityMeta, sourceMeta, trustMeta } from '../skills/skill-page-utils'
import {
  buildCustomAgentMcpCapabilityLabels,
  buildCustomAgentMcpTransportLabels,
  buildCustomAgentRuntimeOptions,
  buildCustomAgentSkillApprovalLabels,
  buildCustomAgentSkillScopeLabels,
  CreateWizardPanel,
  Field,
  getAgentInitials,
  type CustomAgentDetailPanelProps,
  NoticeBlock,
  SectionHeader,
  SettingsTab,
  ToggleField,
} from './custom-agent-detail-panel-shared'
import { useCustomAgentDetailState } from './use-custom-agent-detail-state'

export function CustomAgentDetailPanel({
  creating,
  selectedAgent,
  selectedAgentId,
  telegramWebhookUrl,
  feishuEventCallbackUrl,
  wecomCallbackUrl,
  whatsappCallbackUrl,
  telegramWebhookInfo,
  workdirSummary,
  workdirFiles,
  workdirLoading,
  workdirRefreshing,
  draft,
  validation,
  activeTab,
  availableSkills,
  suggestedSkills,
  suggestedMcpServers,
  avatarStorage,
  avatarBusy,
  manualSkillName,
  manualMcpName,
  manualMcpTarget,
  collaborationWorkspaces,
  state,
  tasks,
  heartbeats,
  auditEntries,
  auditSummary,
  skillQuery,
  mcpQuery,
  onTabChange,
  onSave,
  onDraftChange,
  onSkillQueryChange,
  onUploadAvatar,
  onManualSkillNameChange,
  onAddManualSkill,
  onAddSkillFromCatalog,
  onUpdateSkill,
  onRemoveSkill,
  onMcpQueryChange,
  onManualMcpNameChange,
  onManualMcpTargetChange,
  onAddManualMcp,
  onAddMcpFromGlobal,
  onUpdateMcp,
  onRemoveMcp,
  onToggleProjectId,
  onToggleWorkspaceId,
  onDeleteTelegramWebhook,
  onDisconnectFeishu,
  onDisconnectWechat,
  onEnsureWorkdir,
  onRefreshWorkdir,
  onCleanupWorkdir,
  onReadWorkdirFile,
  onDownloadWorkdirFile,
  onDeleteWorkdirFile,
}: CustomAgentDetailPanelProps) {
  const { language, t } = useTranslation()
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const { preferredModelOptions } = useCustomAgentDetailState({ draft, state })
  const [executors, setExecutors] = useState<Array<{ executorId: string; name: string; status: string; executorSource?: string; managedBy?: string }>>([])
  const [executorMenuOpen, setExecutorMenuOpen] = useState(false)
  const [feishuBindOpen, setFeishuBindOpen] = useState(false)
  const [feishuDisconnecting, setFeishuDisconnecting] = useState(false)
  const [wechatBindOpen, setWechatBindOpen] = useState(false)
  const [wechatDisconnecting, setWechatDisconnecting] = useState(false)
  const [activeChannel, setActiveChannel] = useState<AgentChannelKey | null>(null)

  useEffect(() => {
    let cancelled = false
    api.listExecutors().then((response) => {
      if (!cancelled) {
        setExecutors(response.executors.map((e) => ({
          executorId: e.executorId,
          name: e.name,
          status: e.status,
          executorSource: e.executorSource,
          managedBy: e.managedBy,
        })))
      }
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const runtimeOptions = buildCustomAgentRuntimeOptions(t)
  const skillScopeLabel = buildCustomAgentSkillScopeLabels(t)
  const skillApprovalLabel = buildCustomAgentSkillApprovalLabels(t)
  const mcpTransportLabel = buildCustomAgentMcpTransportLabels()
  const mcpCapabilityLabel = buildCustomAgentMcpCapabilityLabels()
  const delegatePresetLabels = {
    custom: t('agents.custom.detail.options.delegatePresets.custom'),
    executor: t('agents.custom.detail.options.delegatePresets.executor'),
    tester: t('agents.custom.detail.options.delegatePresets.tester'),
    reviewer: t('agents.custom.detail.options.delegatePresets.reviewer'),
    'doc-writer': t('agents.custom.detail.options.delegatePresets.docWriter'),
    researcher: t('agents.custom.detail.options.delegatePresets.researcher'),
  } satisfies Record<CustomAgentDraft['delegatePreset'], string>
  const sessionRoleLabels = {
    general: t('agents.custom.detail.options.sessionRoles.general'),
    tester: t('agents.custom.detail.options.sessionRoles.tester'),
    'doc-writer': t('agents.custom.detail.options.sessionRoles.docWriter'),
    reviewer: t('agents.custom.detail.options.sessionRoles.reviewer'),
    researcher: t('agents.custom.detail.options.sessionRoles.researcher'),
  } satisfies Record<CustomAgentDraft['defaultDelegateSessionRole'], string>
  const delegateSessionModeLabels = {
    'new-session': t('agents.custom.detail.options.delegateSessionModes.newSession'),
    'reuse-current': t('agents.custom.detail.options.delegateSessionModes.reuseCurrent'),
  } satisfies Record<CustomAgentDraft['delegateSessionMode'], string>
  const delegateBaseBranchModeLabels = {
    task: t('agents.custom.detail.options.delegateBaseBranchModes.task'),
    'project-default': t('agents.custom.detail.options.delegateBaseBranchModes.projectDefault'),
    custom: t('agents.custom.detail.options.delegateBaseBranchModes.custom'),
  } satisfies Record<CustomAgentDraft['delegateBaseBranchMode'], string>
  const delegateWorkingDirectoryModeLabels = {
    inherit: t('agents.custom.detail.options.delegateWorkingDirectoryModes.inherit'),
    worktree: t('agents.custom.detail.options.delegateWorkingDirectoryModes.worktree'),
    'original-dir': t('agents.custom.detail.options.delegateWorkingDirectoryModes.originalDir'),
  } satisfies Record<CustomAgentDraft['delegateWorkingDirectoryMode'], string>
  const selectedWorkspaceIds = useMemo(
    () => new Set(draft.workspaceIdsText.split('\n').map((item) => item.trim()).filter(Boolean)),
    [draft.workspaceIdsText],
  )
  const selectedProjectIds = useMemo(
    () => new Set(draft.projectIdsText.split('\n').map((item) => item.trim()).filter(Boolean)),
    [draft.projectIdsText],
  )
  const collaborationWorkspaceIds = useMemo(
    () => new Set(collaborationWorkspaces.map((workspace) => workspace.id)),
    [collaborationWorkspaces],
  )
  const projectIds = useMemo(() => new Set(state.projects.map((project) => project.id)), [state.projects])
  const unknownWorkspaceIds = useMemo(
    () => [...selectedWorkspaceIds].filter((workspaceId) => !collaborationWorkspaceIds.has(workspaceId)),
    [collaborationWorkspaceIds, selectedWorkspaceIds],
  )
  const unknownProjectIds = useMemo(
    () => [...selectedProjectIds].filter((projectId) => !projectIds.has(projectId)),
    [projectIds, selectedProjectIds],
  )
  const mountedSkills = useMemo(() => {
    return draft.skills.map((skill) => {
      const resolved = availableSkills.find((candidate) => {
        const candidateKeys = [
          normalizeLookupKey(candidate.id),
          normalizeLookupKey(candidate.slug),
          normalizeLookupKey(candidate.name),
        ].filter(Boolean)
        const mountedKeys = [skill.skillId, skill.slug, skill.name]
          .map((item) => normalizeLookupKey(item ?? ''))
          .filter(Boolean)

        return mountedKeys.some((key) => candidateKeys.includes(key))
      }) ?? null

      return {
        skill,
        resolved,
        unresolved: !resolved,
      }
    })
  }, [availableSkills, draft.skills])
  const mountedMcpServers = useMemo(() => {
    return draft.mcpServers.map((server) => {
      const target = server.target.trim()
      const resolved = state.config.mcpServers.find((candidate) => {
        const byComposite = normalizeLookupKey(`${candidate.name}::${candidate.target}`) === normalizeLookupKey(`${server.name}::${target}`)
        const byTarget = target ? normalizeLookupKey(candidate.target) === normalizeLookupKey(target) : false
        return byComposite || byTarget
      }) ?? null

      const unresolved = !server.managedBySystem && !resolved
      const piToolReady = draft.preferredRuntime === 'Pi'
        && server.enabled
        && server.capabilityMode === 'resources+tools'
        && (Boolean(target) || server.managedBySystem)

      return {
        server,
        resolved,
        unresolved,
        piToolReady,
      }
    })
  }, [draft.mcpServers, draft.preferredRuntime, state.config.mcpServers])
  const skillSummaryItems = useMemo(() => {
    const enabled = mountedSkills.filter(({ skill }) => skill.enabled).length
    const unresolved = mountedSkills.filter((item) => item.unresolved).length
    const approvalRequired = mountedSkills.filter(({ skill }) => skill.approvalMode === 'approval').length
    return [
      { label: language === 'zh' ? '已挂载' : 'Mounted', value: String(mountedSkills.length) },
      { label: language === 'zh' ? '已启用' : 'Enabled', value: String(enabled) },
      { label: language === 'zh' ? '未解析' : 'Unresolved', value: String(unresolved), className: unresolved > 0 ? 'border-amber-500/20 bg-amber-500/10' : undefined },
      { label: language === 'zh' ? '需审批' : 'Approval required', value: String(approvalRequired) },
    ]
  }, [language, mountedSkills])
  const mcpSummaryItems = useMemo(() => {
    const enabled = mountedMcpServers.filter(({ server }) => server.enabled).length
    const unresolved = mountedMcpServers.filter((item) => item.unresolved).length
    const toolsCapable = mountedMcpServers.filter(({ server }) => server.enabled && server.capabilityMode === 'resources+tools').length
    const piToolReady = mountedMcpServers.filter((item) => item.piToolReady).length
    return [
      { label: language === 'zh' ? '已挂载' : 'Mounted', value: String(mountedMcpServers.length) },
      { label: language === 'zh' ? '已启用' : 'Enabled', value: String(enabled) },
      { label: language === 'zh' ? '未解析' : 'Unresolved', value: String(unresolved), className: unresolved > 0 ? 'border-amber-500/20 bg-amber-500/10' : undefined },
      { label: language === 'zh' ? '可暴露工具' : 'Tools-capable', value: String(toolsCapable) },
      { label: language === 'zh' ? 'Pi 已就绪' : 'Pi tool-ready', value: String(piToolReady), className: piToolReady > 0 ? 'border-emerald-500/20 bg-emerald-500/10' : undefined },
    ]
  }, [language, mountedMcpServers])
  const primaryView = activeTab === 'chat' ? 'use' : activeTab === 'inbox' ? 'inbox' : activeTab === 'activity' ? 'runs' : 'configure'
  const primaryNavigation = [
    { id: 'use', label: language === 'zh' ? '聊天' : 'Chat', icon: MessageSquareText, tab: 'chat' as SettingsTab },
    { id: 'inbox', label: 'Inbox', icon: Inbox, tab: 'inbox' as SettingsTab },
    { id: 'configure', label: language === 'zh' ? '配置' : 'Configure', icon: Settings2, tab: 'overview' as SettingsTab },
    { id: 'runs', label: language === 'zh' ? '运行' : 'Runs', icon: Activity, tab: 'activity' as SettingsTab },
  ] as const
  const configNavigation = [
    { id: 'overview', label: language === 'zh' ? '基本信息' : 'Basics', icon: Bot },
    { id: 'mind', label: language === 'zh' ? '灵魂与记忆' : 'Soul & Memory', icon: Sparkles },
    { id: 'files', label: language === 'zh' ? '文件' : 'Files', icon: FolderOpen },
    { id: 'model', label: t('agents.custom.tabs.model'), icon: Cpu },
    { id: 'heartbeat', label: language === 'zh' ? '定时心跳' : 'Heartbeat', icon: CalendarClock },
    { id: 'skills', label: 'Skills', icon: BrainCircuit },
    { id: 'mcp', label: 'MCP', icon: Cable },
    { id: 'channels', label: language === 'zh' ? '渠道' : 'Channels', icon: Radio },
    { id: 'advanced', label: language === 'zh' ? '高级设置' : 'Advanced', icon: Settings2 },
  ] as const
  const isConfigureView = primaryView === 'configure'
  const isConfigNavItemActive = (id: (typeof configNavigation)[number]['id']) => {
    if (id === 'model') {
      return activeTab === 'model' || activeTab === 'runtime'
    }

    return activeTab === id
  }
  const draftChannels: Record<AgentChannelKey, Record<string, unknown>> = {
    telegram: { enabled: draft.telegramEnabled, botToken: draft.telegramBotToken, chatId: draft.telegramChatId, threadId: draft.telegramThreadId, webhookSecret: draft.telegramWebhookSecret },
    feishu: { enabled: draft.feishuEnabled, appId: draft.feishuAppId, appSecret: draft.feishuAppSecret, encryptKey: draft.feishuEncryptKey, verificationToken: draft.feishuVerificationToken },
    wechat: { enabled: draft.wechatEnabled, botToken: draft.wechatBotToken },
    discord: { enabled: draft.discordEnabled, botToken: draft.discordBotToken, guildId: draft.discordGuildId },
    slack: { enabled: draft.slackEnabled, botToken: draft.slackBotToken, appToken: draft.slackAppToken },
    wecom: { enabled: draft.wecomEnabled, corpId: draft.wecomCorpId, agentId: draft.wecomAgentId, secret: draft.wecomSecret, callbackToken: draft.wecomCallbackToken, encodingAesKey: draft.wecomEncodingAesKey, defaultTouser: draft.wecomDefaultTouser },
    whatsapp: { enabled: draft.whatsappEnabled, phoneNumberId: draft.whatsappPhoneNumberId, accessToken: draft.whatsappAccessToken, verifyToken: draft.whatsappVerifyToken },
    dingtalk: { enabled: draft.dingtalkEnabled, appKey: draft.dingtalkAppKey, appSecret: draft.dingtalkAppSecret },
  }
  const chatBlockedReason = creating
    ? ''
    : draft.archived
      ? language === 'zh' ? '归档后的 Agent 不会出现在可调用列表中。' : 'Archived agents are hidden from invocation lists.'
      : !draft.enabled
        ? language === 'zh' ? '启用后，它才会出现在可调用列表中。' : 'Enable it before it can be invoked.'
        : validation.errors[0] || ''

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#09090b] text-zinc-100">
      {/* 外层 shell 的布局模式恒定，不随 tab 切换而改变，否则会整页跳动。 */}
      <div className="mobile-bottom-nav-safe flex min-h-0 flex-1 flex-col overflow-hidden">
        {!creating && validation.errors.length > 0 ? (
          <div className="shrink-0 px-4 pt-4">
            <NoticeBlock title={t('agents.custom.detail.validationTitle')} tone="error" items={validation.errors} />
          </div>
        ) : null}

        <div className="flex shrink-0 items-center gap-1 border-b border-zinc-900 px-4 py-2">
          {primaryNavigation.map(({ id, label, icon: Icon, tab }) => (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(tab)}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors [&_svg]:size-4',
                primaryView === id ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
              )}
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>

        {isConfigureView ? (
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[12rem_minmax(0,1fr)]">
          <aside className="md:sticky md:top-0 md:self-start">
            <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
              {configNavigation.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onTabChange(id)}
                  className={cn(
                    'inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-xs transition-colors md:w-full [&_svg]:size-3.5',
                    isConfigNavItemActive(id)
                      ? 'bg-zinc-900 text-zinc-100'
                      : 'text-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-200',
                  )}
                >
                  <Icon />
                  {label}
                </button>
              ))}
            </nav>
          </aside>

          <div className="min-w-0 space-y-4">
        {activeTab === 'overview' ? (
          <section className="space-y-3 border border-zinc-800 bg-[#09090b] p-3">
            {!creating && selectedAgentId ? (
              <div className="mx-auto w-full max-w-4xl">
                <AgentRunOverview
                  agentId={selectedAgentId}
                  name={selectedAgent?.name ?? draft.name}
                  status={selectedAgent?.status ?? 'offline'}
                  model={draft.preferredModel}
                  runtime={draft.preferredRuntime}
                  executorLabel={draft.defaultExecutorId || undefined}
                />
              </div>
            ) : null}
            {creating ? (
              <CreateWizardPanel
                draft={draft}
                onCreate={onSave}
                onDraftChange={onDraftChange}
              />
            ) : null}
            {!creating ? (
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 py-2">
                <SectionHeader icon={<Bot className="h-4 w-4" />} title={t('agents.custom.detail.sections.identityTitle')} description={t('agents.custom.detail.sections.identityDescription')} />
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void onUploadAvatar(file)
                    event.target.value = ''
                  }}
                />
                <div className="flex flex-col gap-4 border border-zinc-800 bg-zinc-950/50 p-3">
                  <div className="flex items-center gap-4">
                    <Avatar className="size-16 rounded-lg border border-zinc-800 bg-zinc-950">
                      <AvatarImage src={resolveMediaUrl(draft.avatarUrl)} className="object-cover" />
                      <AvatarFallback className={cn('rounded-lg text-lg font-black text-zinc-950', getAgentAvatarAccent(selectedAgent?.id || draft.name || 'agent-draft'))}>
                        {getAgentInitials(draft.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col gap-1.5">
                      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{language === 'zh' ? '当前头像' : 'Current avatar'}</p>
                      <Button type="button" variant="outline" size="sm" onClick={() => avatarInputRef.current?.click()} disabled={!selectedAgent || !avatarStorage.configured || avatarBusy} className="w-fit border-zinc-800 bg-zinc-950 text-zinc-100 hover:bg-zinc-900 hover:text-zinc-100">
                        {avatarBusy ? <Loader2 className="animate-spin" /> : <Camera />}
                        {avatarBusy ? t('agents.custom.detail.actions.uploadingAvatar') : t('agents.custom.detail.actions.uploadAvatar')}
                      </Button>
                    </div>
                  </div>
                  <Separator className="bg-zinc-800" />
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{language === 'zh' ? '内置头像' : 'Built-in avatars'}</p>
                    <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 lg:grid-cols-10">
                      {BUILT_IN_AGENT_AVATARS.map((avatar) => (
                        <button key={avatar.id} type="button" title={t(avatar.labelKey)} onClick={() => onDraftChange((current) => ({ ...current, avatarUrl: avatar.url }))} className={cn('size-9 overflow-hidden rounded-md border bg-zinc-950 p-0.5', draft.avatarUrl === avatar.url ? 'border-zinc-100' : 'border-zinc-800 hover:border-zinc-600')}>
                          <img src={resolveMediaUrl(avatar.url)} alt="" className="size-full rounded object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <Field label={t('agents.custom.detail.fields.name')}>
                  <Input value={draft.name} onChange={(event) => onDraftChange((current) => ({ ...current, name: event.target.value }))} placeholder={t('agents.custom.detail.placeholders.name')} />
                </Field>
                <Field label={t('agents.custom.detail.fields.instructions')}>
                  <Textarea value={draft.instructions} onChange={(event) => onDraftChange((current) => ({ ...current, instructions: event.target.value }))} rows={8} placeholder={t('agents.custom.detail.placeholders.instructions')} />
                </Field>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeTab === 'mind' && !creating && selectedAgentId ? (
          <AgentMindPanel agentId={selectedAgentId} />
        ) : null}

        {activeTab === 'files' && !creating && selectedAgentId ? (
          <AgentFilesPanel
            agentId={selectedAgentId}
            defaultExecutorId={draft.defaultExecutorId}
            executors={executors}
            workdirSummary={workdirSummary}
            workdirFiles={workdirFiles}
            workdirLoading={workdirLoading}
            workdirRefreshing={workdirRefreshing}
            onEnsureWorkdir={onEnsureWorkdir}
            onRefreshWorkdir={onRefreshWorkdir}
            onCleanupWorkdir={onCleanupWorkdir}
            onReadWorkdirFile={onReadWorkdirFile}
            onDownloadWorkdirFile={onDownloadWorkdirFile}
            onDeleteWorkdirFile={onDeleteWorkdirFile}
          />
        ) : null}

        {activeTab === 'heartbeat' && !creating && selectedAgentId ? (
          <AgentHeartbeatSchedulePanel agentId={selectedAgentId} />
        ) : null}

        {activeTab === 'model' || activeTab === 'runtime' ? (
          <section className="space-y-4 border border-zinc-800 bg-[#09090b] p-4">
            <SectionHeader
              icon={<Cpu className="h-4 w-4" />}
              title={t('agents.custom.tabs.model')}
              description={language === 'zh'
                ? '设置这个 Agent 的默认模型、执行端和执行节点。'
                : 'Set this agent’s default model, runtime, and executor.'}
            />
            <Field label={t('agents.custom.detail.runtime.preferredModel')}>
              <SearchableSelect
                value={draft.preferredModel}
                options={preferredModelOptions}
                placeholder={t('agents.custom.detail.placeholders.selectModel')}
                searchPlaceholder={t('agents.custom.detail.placeholders.searchModel')}
                emptyText={t('agents.custom.detail.empty.noMatchedModels')}
                onChange={(value) => onDraftChange((current) => ({ ...current, preferredModel: value }))}
              />
            </Field>
            <Field label={t('agents.custom.detail.runtime.preferredRuntime')}>
              <NativeSelect value={draft.preferredRuntime} onChange={(event) => onDraftChange((current) => ({ ...current, preferredRuntime: event.target.value as RuntimeId }))}>
                {runtimeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t('agents.custom.detail.runtime.defaultExecutor', { defaultValue: '默认执行节点' })}>
              <ExecutorSelect
                open={executorMenuOpen}
                onOpenChange={setExecutorMenuOpen}
                value={draft.defaultExecutorId || MANAGED_CLOUD_AUTO_EXECUTOR_ID}
                placeholder={t('agents.custom.detail.runtime.noDefaultExecutor', { defaultValue: '不指定（会话创建时手动选择）' })}
                emptyText={t('agents.custom.detail.runtime.noExecutors', { defaultValue: '暂无可用执行节点' })}
                searchPlaceholder={t('agents.custom.detail.runtime.searchExecutors', { defaultValue: '搜索执行节点...' })}
                options={[
                  {
                    value: MANAGED_CLOUD_AUTO_EXECUTOR_ID,
                    label: t('agents.custom.detail.runtime.managedCloudDefault', { defaultValue: 'Hosted Cloud' }),
                    description: t('agents.custom.detail.runtime.managedCloudDefaultHint', { defaultValue: '官方云节点（默认）' }),
                    statusTone: 'online' as const,
                  },
                  ...executors
                    .filter((executor) => executor.executorId !== MANAGED_CLOUD_AUTO_EXECUTOR_ID)
                    .map((executor) => ({
                      value: executor.executorId,
                      label: executor.name || executor.executorId,
                      statusTone: (isExecutorEffectivelyOnline(executor) ? 'online' : executor.status === 'busy' ? 'busy' : 'offline') as 'online' | 'busy' | 'offline',
                    })),
                  {
                    value: '',
                    label: t('agents.custom.detail.runtime.noDefaultExecutor', { defaultValue: '不指定' }),
                    description: t('agents.custom.detail.runtime.noDefaultExecutorHint', { defaultValue: '会话创建时手动选择' }),
                    statusTone: 'neutral' as const,
                  },
                ]}
                onChange={(value) => onDraftChange((current) => ({ ...current, defaultExecutorId: value }))}
              />
            </Field>
          </section>
        ) : null}

        {activeTab === 'advanced' ? (
          <section className="space-y-4 border border-zinc-800 bg-[#09090b] p-4">
            <SectionHeader
              icon={<Settings2 className="h-4 w-4" />}
              title={language === 'zh' ? '高级设置' : 'Advanced settings'}
              description={language === 'zh'
                ? '管理 Agent 的治理权限。'
                : 'Manage agent governance permissions.'}
            />
            <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <SectionHeader
                icon={<ShieldCheck className="h-4 w-4" />}
                title={t('agents.custom.detail.runtime.governanceTitle')}
                description={t('agents.custom.detail.runtime.governanceDescription')}
              />
            </div>
          </section>
        ) : null}

        {activeTab === 'skills' ? (
          <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
            <section className="space-y-4 border border-zinc-800 bg-[#09090b] p-4">
              <SectionHeader icon={<BrainCircuit className="h-4 w-4" />} title={t('agents.custom.detail.sections.skillsSourceTitle')} description={t('agents.custom.detail.sections.skillsSourceDescription')} />
              <Input value={skillQuery} onChange={(event) => onSkillQueryChange(event.target.value)} placeholder={t('agents.custom.detail.placeholders.searchInstalledSkills')} />
              <div className="flex gap-2">
                <Input value={manualSkillName} onChange={(event) => onManualSkillNameChange(event.target.value)} placeholder={t('agents.custom.detail.placeholders.manualSkillName')} />
                <Button type="button" onClick={onAddManualSkill} className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200">
                  {t('agents.custom.detail.actions.createAndMount')}
                </Button>
              </div>
              <div className="space-y-2">
                {suggestedSkills.slice(0, 12).map((skill) => (
                  <CapabilityCard
                    key={skill.id}
                    onClick={() => onAddSkillFromCatalog(skill)}
                    title={skill.name}
                    description={skill.description || skill.slug}
                    meta={skill.slug}
                    actionLabel={t('agents.custom.detail.attach')}
                    status={compatibilityMeta(skill, language === 'zh' ? 'zh' : 'en')}
                    badges={[
                      sourceMeta(skill.sourceType, language === 'zh' ? 'zh' : 'en'),
                      trustMeta(skill, language === 'zh' ? 'zh' : 'en'),
                    ]}
                  />
                ))}
                {suggestedSkills.length === 0 ? (
                  <CapabilityEmptyState
                    icon={<BrainCircuit className="h-5 w-5" />}
                    title={t('agents.custom.detail.empty.noMoreSkillsTitle')}
                    description={t('agents.custom.detail.empty.noMoreSkills')}
                  />
                ) : null}
              </div>
            </section>

            <section className="space-y-4 border border-zinc-800 bg-[#09090b] p-4">
              <SectionHeader icon={<ShieldCheck className="h-4 w-4" />} title={t('agents.custom.detail.sections.skillsPolicyTitle')} description={t('agents.custom.detail.sections.skillsPolicyDescription')} />
              <CapabilitySummaryStrip items={skillSummaryItems} className="xl:grid-cols-4" />
              {draft.preferredRuntime === 'Pi' ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-xs leading-5 text-zinc-500">
                  {t('agents.custom.detail.hints.piSkillSnapshot')}
                </div>
              ) : null}
              {draft.skills.length === 0 ? (
                <CapabilityEmptyState
                  icon={<BrainCircuit className="h-5 w-5" />}
                  title={t('agents.custom.detail.empty.noMountedSkillsTitle')}
                  description={t('agents.custom.detail.empty.noMountedSkills')}
                />
              ) : (
                <div className="space-y-4">
                  {mountedSkills.map(({ skill, resolved, unresolved }) => (
                    <CapabilityCard
                      key={skill.id}
                      title={skill.name}
                      description={skill.description || resolved?.description || skill.slug || skill.skillId || t('agents.custom.detail.empty.unboundSkillRecord')}
                      meta={skill.slug || skill.skillId}
                      status={unresolved
                        ? { label: t('agents.custom.detail.status.unresolved'), className: 'border-amber-500/20 bg-amber-500/10 text-amber-100' }
                        : skill.enabled
                          ? { label: t('agents.custom.detail.status.enabled'), className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' }
                          : { label: t('agents.custom.detail.status.disabled'), className: 'border-zinc-800 bg-zinc-950 text-zinc-400' }}
                      badges={[
                        { label: skillScopeLabel[skill.scope], className: 'border-zinc-800 bg-zinc-950 text-zinc-300' },
                        { label: skillApprovalLabel[skill.approvalMode], className: skill.approvalMode === 'approval' ? 'border-amber-500/20 bg-amber-500/10 text-amber-100' : 'border-zinc-800 bg-zinc-950 text-zinc-300' },
                        ...(resolved ? [
                          sourceMeta(resolved.sourceType, language === 'zh' ? 'zh' : 'en'),
                          trustMeta(resolved, language === 'zh' ? 'zh' : 'en'),
                        ] : []),
                      ]}
                      warning={unresolved ? t('agents.custom.detail.hints.unresolvedSkillWarning') : undefined}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs text-zinc-500">
                          {draft.preferredRuntime === 'Pi'
                            ? t('agents.custom.detail.hints.piMountSnapshot')
                            : t('agents.custom.detail.hints.mountPolicySaved')}
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch checked={skill.enabled} onCheckedChange={(checked) => onUpdateSkill(skill.id, (current) => ({ ...current, enabled: checked }))} />
                          <Button type="button" variant="outline" onClick={() => onRemoveSkill(skill.id)} className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900">
                            {t('common.remove')}
                          </Button>
                        </div>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <Field label={t('agents.custom.detail.fields.displayName')}>
                          <Input value={skill.name} onChange={(event) => onUpdateSkill(skill.id, (current) => ({ ...current, name: event.target.value }))} />
                        </Field>
                        <Field label={t('agents.custom.detail.fields.skillTags')}>
                          <Input
                            value={skill.tags.join(', ')}
                            onChange={(event) => onUpdateSkill(skill.id, (current) => ({
                              ...current,
                              tags: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                            }))}
                            placeholder={t('agents.custom.detail.placeholders.skillTags')}
                          />
                        </Field>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <Field label={t('agents.custom.detail.fields.skillScope')}>
                          <NativeSelect value={skill.scope} onChange={(event) => onUpdateSkill(skill.id, (current) => ({ ...current, scope: event.target.value as typeof current.scope }))}>
                            <option value="agent">{skillScopeLabel.agent}</option>
                            <option value="project">{skillScopeLabel.project}</option>
                            <option value="workspace">{skillScopeLabel.workspace}</option>
                          </NativeSelect>
                        </Field>
                        <Field label={t('agents.custom.detail.fields.skillApproval')}>
                          <NativeSelect value={skill.approvalMode} onChange={(event) => onUpdateSkill(skill.id, (current) => ({ ...current, approvalMode: event.target.value as typeof current.approvalMode }))}>
                            <option value="auto">{skillApprovalLabel.auto}</option>
                            <option value="approval">{skillApprovalLabel.approval}</option>
                          </NativeSelect>
                        </Field>
                      </div>
                    </CapabilityCard>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}

        {activeTab === 'mcp' ? (
          <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
            <section className="space-y-4 border border-zinc-800 bg-[#09090b] p-4">
              <SectionHeader icon={<Cable className="h-4 w-4" />} title={t('agents.custom.detail.sections.mcpSourceTitle')} description={t('agents.custom.detail.sections.mcpSourceDescription')} />
              <Input value={mcpQuery} onChange={(event) => onMcpQueryChange(event.target.value)} placeholder={t('agents.custom.detail.placeholders.searchSystemMcp')} />
              <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                <Input value={manualMcpName} onChange={(event) => onManualMcpNameChange(event.target.value)} placeholder={t('agents.custom.detail.placeholders.manualMcpName')} />
                <Input value={manualMcpTarget} onChange={(event) => onManualMcpTargetChange(event.target.value)} placeholder={t('agents.custom.detail.placeholders.manualMcpTarget')} />
                <Button onClick={onAddManualMcp} className="w-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200">
                  {t('agents.custom.detail.actions.createAndMountMcp')}
                </Button>
              </div>
              <div className="space-y-2">
                {suggestedMcpServers.slice(0, 12).map((server) => (
                  <CapabilityCard
                    key={`${server.name}:${server.target}`}
                    onClick={() => onAddMcpFromGlobal(server)}
                    title={server.name}
                    description={server.target}
                    actionLabel={t('agents.custom.detail.attach')}
                    status={server.enabled
                      ? { label: t('agents.custom.detail.status.enabled'), className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' }
                      : { label: t('agents.custom.detail.status.disabled'), className: 'border-zinc-800 bg-zinc-950 text-zinc-400' }}
                    badges={[
                      { label: server.transport, className: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-200' },
                      { label: server.capabilityMode, className: server.capabilityMode === 'resources+tools' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-zinc-700 bg-zinc-900 text-zinc-200' },
                      { label: server.managedBySystem ? t('agents.custom.detail.status.system') : t('agents.custom.detail.status.custom'), className: 'border-zinc-800 bg-zinc-950 text-zinc-300' },
                    ]}
                    warning={draft.preferredRuntime === 'Pi' && server.capabilityMode !== 'resources+tools'
                      ? t('agents.custom.detail.hints.piMcpModeWarning')
                      : undefined}
                  />
                ))}
                {suggestedMcpServers.length === 0 ? (
                  <CapabilityEmptyState
                    icon={<Cable className="h-5 w-5" />}
                    title={t('agents.custom.detail.empty.noMoreMcpTitle')}
                    description={t('agents.custom.detail.empty.noMoreMcp')}
                  />
                ) : null}
              </div>
            </section>

            <section className="space-y-4 border border-zinc-800 bg-[#09090b] p-4">
              <SectionHeader icon={<ShieldCheck className="h-4 w-4" />} title={t('agents.custom.detail.sections.mcpPolicyTitle')} description={t('agents.custom.detail.sections.mcpPolicyDescription')} />
              <CapabilitySummaryStrip items={mcpSummaryItems} className="xl:grid-cols-5" />
              {draft.mcpServers.length === 0 ? (
                <CapabilityEmptyState
                  icon={<Cable className="h-5 w-5" />}
                  title={t('agents.custom.detail.empty.noMountedMcpTitle')}
                  description={t('agents.custom.detail.empty.noMountedMcp')}
                />
              ) : (
                <div className="space-y-4">
                  {mountedMcpServers.map(({ server, unresolved, piToolReady }) => (
                    <CapabilityCard
                      key={server.id}
                      title={server.name}
                      description={server.target}
                      status={unresolved
                        ? { label: t('agents.custom.detail.status.unresolved'), className: 'border-amber-500/20 bg-amber-500/10 text-amber-100' }
                        : server.enabled
                          ? { label: t('agents.custom.detail.status.enabled'), className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' }
                          : { label: t('agents.custom.detail.status.disabled'), className: 'border-zinc-800 bg-zinc-950 text-zinc-400' }}
                      badges={[
                        { label: server.transport, className: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-200' },
                        { label: server.capabilityMode, className: server.capabilityMode === 'resources+tools' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-zinc-700 bg-zinc-900 text-zinc-200' },
                        ...(piToolReady ? [{ label: t('agents.custom.detail.status.piToolReady'), className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' }] : []),
                      ]}
                      warning={unresolved
                        ? t('agents.custom.detail.hints.unresolvedMcpWarning')
                        : (draft.preferredRuntime === 'Pi' && server.enabled && server.capabilityMode !== 'resources+tools'
                            ? t('agents.custom.detail.hints.piResourcesOnlyMcp')
                            : undefined)}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs text-zinc-500">
                          {piToolReady
                            ? t('agents.custom.detail.hints.piToolReady')
                            : t('agents.custom.detail.hints.mcpCapabilitySaved')}
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch checked={server.enabled} onCheckedChange={(checked) => onUpdateMcp(server.id, (current) => ({ ...current, enabled: checked }))} />
                          <Button type="button" variant="outline" onClick={() => onRemoveMcp(server.id)} className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900">
                            {t('common.remove')}
                          </Button>
                        </div>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <Field label={t('agents.custom.detail.fields.serverName')}>
                          <Input value={server.name} onChange={(event) => onUpdateMcp(server.id, (current) => ({ ...current, name: event.target.value }))} />
                        </Field>
                        <Field label={t('agents.custom.detail.fields.target')}>
                          <Input value={server.target} onChange={(event) => onUpdateMcp(server.id, (current) => ({ ...current, target: event.target.value }))} />
                        </Field>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <Field label={t('agents.custom.detail.fields.transport')}>
                          <NativeSelect value={server.transport} onChange={(event) => onUpdateMcp(server.id, (current) => ({ ...current, transport: event.target.value as typeof current.transport }))}>
                            <option value="http">{mcpTransportLabel.http}</option>
                            <option value="sse">{mcpTransportLabel.sse}</option>
                            <option value="stdio">{mcpTransportLabel.stdio}</option>
                            <option value="custom">{mcpTransportLabel.custom}</option>
                          </NativeSelect>
                        </Field>
                        <Field label={t('agents.custom.detail.fields.capabilityMode')}>
                          <NativeSelect value={server.capabilityMode} onChange={(event) => onUpdateMcp(server.id, (current) => ({ ...current, capabilityMode: event.target.value as typeof current.capabilityMode }))}>
                            <option value="resources">{mcpCapabilityLabel.resources}</option>
                            <option value="resources+tools">{mcpCapabilityLabel['resources+tools']}</option>
                          </NativeSelect>
                        </Field>
                      </div>
                    </CapabilityCard>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}

        {activeTab === 'channels' ? (
          <div className="space-y-4 border border-zinc-800 bg-[#09090b] p-4">
            <SectionHeader icon={<Radio className="h-4 w-4" />} title="外部渠道" description="点卡片配置渠道；微信/飞书支持扫码一键，Telegram/Discord 支持链接一键。" />
            <div className="grid gap-3 sm:grid-cols-2">
              {CHANNEL_METAS.map((meta) => {
                const channelConfig = draftChannels[meta.key] ?? {}
                const configured = meta.isConfigured(channelConfig)
                const enabled = meta.isEnabled(channelConfig)
                const status = !configured
                  ? '未配置'
                  : enabled
                    ? '已连接'
                    : '未启用'
                const statusClass = !configured
                  ? 'border-zinc-700 text-zinc-500'
                  : enabled
                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-500/25 bg-amber-500/10 text-amber-300'
                return (
                  <button
                    key={meta.key}
                    type="button"
                    onClick={() => setActiveChannel(meta.key)}
                    className="group flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-left transition-colors hover:border-zinc-600 hover:bg-zinc-900"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900" style={{ color: meta.color }}>
                      <meta.icon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                        {meta.name}
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] leading-none ${statusClass}`}>{status}</span>
                      </span>
                      <span className="mt-1 line-clamp-2 block text-xs leading-4 text-zinc-500">{meta.description}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5" />
                  </button>
                )
              })}
            </div>

            {selectedAgent ? (
              <>
                <ChannelConfigDialog
                  channel={activeChannel}
                  open={Boolean(activeChannel)}
                  onOpenChange={(open) => { if (!open) setActiveChannel(null) }}
                  draft={draft}
                  onDraftChange={onDraftChange}
                  selectedAgentId={selectedAgent.id}
                  wecomCallbackUrl={wecomCallbackUrl}
                  whatsappCallbackUrl={whatsappCallbackUrl}
                  onOpenWechatQr={() => setWechatBindOpen(true)}
                  onOpenFeishuQr={() => setFeishuBindOpen(true)}
                  onDisconnectWechat={() => { void onDisconnectWechat().then((ok) => { if (ok) setActiveChannel(null) }) }}
                  onDisconnectFeishu={() => { void onDisconnectFeishu().then((ok) => { if (ok) setActiveChannel(null) }) }}
                />
                <WechatQrBindingDialog agentId={selectedAgent.id} agentName={selectedAgent.name} open={wechatBindOpen} onOpenChange={setWechatBindOpen} onBound={({ enabled, botToken }) => onDraftChange((current) => ({ ...current, wechatEnabled: enabled, wechatBotToken: botToken }))} />
                <FeishuQrBindingDialog agentId={selectedAgent.id} agentName={selectedAgent.name} open={feishuBindOpen} onOpenChange={setFeishuBindOpen} onBound={({ appId, appSecret }) => onDraftChange((current) => ({ ...current, feishuEnabled: true, feishuConnectionMode: 'long-connection', feishuAppId: appId, feishuAppSecret: appSecret, feishuEncryptKey: '', feishuVerificationToken: '' }))} />
              </>
            ) : null}
          </div>
        ) : null}

        {activeTab === 'workspace' ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <section className="space-y-4 border border-zinc-800 bg-[#09090b] p-4">
              <SectionHeader icon={<Waypoints className="h-4 w-4" />} title={t('agents.custom.detail.workspace.title')} description={t('agents.custom.detail.workspace.description')} />
              <ToggleField
                title={t('agents.custom.detail.workspace.allowMentionTitle')}
                description={t('agents.custom.detail.workspace.allowMentionDescription')}
                checked={draft.allowedMention}
                onCheckedChange={(checked) => onDraftChange((current) => ({ ...current, allowedMention: checked }))}
              />
              <ToggleField
                title={t('agents.custom.detail.workspace.allowDelegateTitle')}
                description={t('agents.custom.detail.workspace.allowDelegateDescription')}
                checked={draft.allowedDelegate}
                onCheckedChange={(checked) => onDraftChange((current) => ({ ...current, allowedDelegate: checked }))}
              />
              <div className="flex flex-wrap items-center gap-2 border border-zinc-800 bg-zinc-950/70 px-3 py-2.5">
                <span className="text-xs text-zinc-400">
                  {selectedWorkspaceIds.size === 0 && selectedProjectIds.size === 0
                    ? (selectedAgent?.ownerUserId
                        ? (language === 'zh' ? '未共享：当前仅创建者可使用。' : 'Not shared: only the creator can use this agent.')
                        : (language === 'zh' ? '系统 Agent 未限制作用域。' : 'This system agent is not scope-restricted.'))
                    : (language === 'zh'
                        ? `已共享到 ${selectedWorkspaceIds.size} 个协作组织、${selectedProjectIds.size} 个项目。`
                        : `Shared with ${selectedWorkspaceIds.size} collaboration workspace(s) and ${selectedProjectIds.size} project(s).`)}
                </span>
                {selectedWorkspaceIds.size > 0 ? <Badge variant="outline">Workspace {selectedWorkspaceIds.size}</Badge> : null}
                {selectedProjectIds.size > 0 ? <Badge variant="outline">Project {selectedProjectIds.size}</Badge> : null}
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  {language === 'zh' ? '可见性' : 'Visibility'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onDraftChange((current) => ({ ...current, visibility: 'private' }))}
                    className={cn(
                      'flex items-start gap-2 border px-3 py-2 text-left text-xs transition-colors',
                      draft.visibility === 'private'
                        ? 'border-violet-500/40 bg-violet-500/10 text-violet-100'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900',
                    )}
                  >
                    <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span className="min-w-0">
                      <span className="block font-medium">{language === 'zh' ? '私有' : 'Private'}</span>
                      <span className="block text-[10px] text-zinc-500">{language === 'zh' ? '仅创建者本人可见' : 'Visible only to the creator'}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDraftChange((current) => ({ ...current, visibility: 'workspace' }))}
                    className={cn(
                      'flex items-start gap-2 border px-3 py-2 text-left text-xs transition-colors',
                      draft.visibility === 'workspace'
                        ? 'border-violet-500/40 bg-violet-500/10 text-violet-100'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900',
                    )}
                  >
                    <Users className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span className="min-w-0">
                      <span className="block font-medium">{language === 'zh' ? '组织共享' : 'Organization shared'}</span>
                      <span className="block text-[10px] text-zinc-500">{language === 'zh' ? '归属组织的所有成员可见' : 'Visible to all members of the organization'}</span>
                    </span>
                  </button>
                </div>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <Field label={t('agents.custom.detail.fields.delegatePreset')}>
                  <NativeSelect
                    value={draft.delegatePreset}
                    onChange={(event) => onDraftChange((current) => applyDelegatePresetToDraft(current, event.target.value as CustomAgentDraft['delegatePreset']))}
                  >
                    {CUSTOM_AGENT_DELEGATE_PRESET_UI_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{delegatePresetLabels[option.value]}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label={t('agents.custom.detail.fields.defaultDelegateRole')}>
                  <NativeSelect
                    value={draft.defaultDelegateSessionRole}
                    onChange={(event) => onDraftChange((current) => ({
                      ...current,
                      delegatePreset: 'custom',
                      defaultDelegateSessionRole: event.target.value as CustomAgentDraft['defaultDelegateSessionRole'],
                    }))}
                  >
                    {SUB_AGENT_SESSION_ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{sessionRoleLabels[option.value]}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label={t('agents.custom.detail.fields.defaultDelegatePrompt')}>
                  <Textarea
                    value={draft.defaultDelegatePrompt}
                    onChange={(event) => onDraftChange((current) => ({
                      ...current,
                      delegatePreset: 'custom',
                      defaultDelegatePrompt: event.target.value,
                    }))}
                    rows={6}
                    placeholder={t('agents.custom.detail.placeholders.delegatePrompt')}
                  />
                </Field>
              </div>
              <div className="grid gap-4 xl:grid-cols-3">
                <Field label={t('agents.custom.detail.fields.delegateSessionMode')}>
                  <NativeSelect
                    value={draft.delegateSessionMode}
                    onChange={(event) => onDraftChange((current) => ({
                      ...current,
                      delegateSessionMode: event.target.value as CustomAgentDraft['delegateSessionMode'],
                    }))}
                  >
                    {CUSTOM_AGENT_DELEGATE_SESSION_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{delegateSessionModeLabels[option.value]}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label={t('agents.custom.detail.fields.delegateBaseBranchMode')}>
                  <NativeSelect
                    value={draft.delegateBaseBranchMode}
                    onChange={(event) => onDraftChange((current) => ({
                      ...current,
                      delegateBaseBranchMode: event.target.value as CustomAgentDraft['delegateBaseBranchMode'],
                    }))}
                  >
                    {CUSTOM_AGENT_DELEGATE_BASE_BRANCH_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{delegateBaseBranchModeLabels[option.value]}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label={t('agents.custom.detail.fields.delegateWorkingDirectoryMode')}>
                  <NativeSelect
                    value={draft.delegateWorkingDirectoryMode}
                    onChange={(event) => onDraftChange((current) => ({
                      ...current,
                      delegateWorkingDirectoryMode: event.target.value as CustomAgentDraft['delegateWorkingDirectoryMode'],
                    }))}
                  >
                    {CUSTOM_AGENT_DELEGATE_WORKING_DIRECTORY_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{delegateWorkingDirectoryModeLabels[option.value]}</option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              {draft.delegateBaseBranchMode === 'custom' ? (
                <Field label={t('agents.custom.detail.fields.customBaseBranch')}>
                  <Input
                    value={draft.delegateBaseBranch}
                    onChange={(event) => onDraftChange((current) => ({
                      ...current,
                      delegateBaseBranch: event.target.value,
                    }))}
                    placeholder={t('agents.custom.detail.placeholders.customBaseBranch')}
                  />
                </Field>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {CUSTOM_AGENT_DELEGATE_PRESET_UI_OPTIONS.filter((option) => option.value !== 'custom').map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onDraftChange((current) => applyDelegatePresetToDraft(current, option.value))}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs transition-colors',
                      draft.delegatePreset === option.value
                        ? 'border-zinc-100 bg-zinc-100 text-zinc-950'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900',
                    )}
                  >
                    {delegatePresetLabels[option.value]}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-4">
              <Card className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-none">
                <CardContent className="space-y-4 p-4">
                  <SectionHeader icon={<Radio className="h-4 w-4" />} title={t('agents.custom.detail.workspace.quickProjectTitle')} description={t('agents.custom.detail.workspace.quickProjectDescription')} />
                  <div className="space-y-1.5">
                    {state.projects.map((project) => {
                      const selected = selectedProjectIds.has(project.id)
                      return (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => onToggleProjectId(project.id)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 border px-3 py-2 text-left text-xs transition-colors',
                          selected
                            ? 'border-sky-500/40 bg-sky-500/10 text-sky-100'
                            : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{project.name}</span>
                          <span className="block truncate text-[10px] text-zinc-500">{project.id}</span>
                        </span>
                        {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-sky-300" /> : null}
                      </button>
                      )
                    })}
                    {state.projects.length === 0 ? (
                      <p className="px-1 text-xs text-zinc-500">{language === 'zh' ? '当前没有可绑定的项目。' : 'No projects are available to bind.'}</p>
                    ) : null}
                  </div>
                  <Separator className="bg-zinc-800" />
                  <SectionHeader icon={<Waypoints className="h-4 w-4" />} title={t('agents.custom.detail.workspace.quickWorkspaceTitle')} description={t('agents.custom.detail.workspace.quickWorkspaceDescription')} />
                  <div className="space-y-1.5">
                    {collaborationWorkspaces.map((workspace) => {
                      const selected = selectedWorkspaceIds.has(workspace.id)
                      const scopedProjectCount = state.projects.filter((project) => project.workspaceId === workspace.id).length
                      return (
                      <button
                        key={workspace.id}
                        type="button"
                        onClick={() => onToggleWorkspaceId(workspace.id)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 border px-3 py-2 text-left text-xs transition-colors',
                          selected
                            ? 'border-violet-500/40 bg-violet-500/10 text-violet-100'
                            : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{workspace.name}</span>
                          <span className="block truncate text-[10px] text-zinc-500">
                            {workspace.id}{scopedProjectCount > 0 ? ` · ${scopedProjectCount} Projects` : ''}
                          </span>
                        </span>
                        {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-violet-300" /> : null}
                      </button>
                      )
                    })}
                    {collaborationWorkspaces.length === 0 ? <p className="text-xs text-zinc-500">{t('agents.custom.detail.workspace.noKnownWorkspaceIds')}</p> : null}
                  </div>
                  {(unknownWorkspaceIds.length > 0 || unknownProjectIds.length > 0) ? (
                    <>
                      <Separator className="bg-zinc-800" />
                      <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-amber-400/80">
                          {language === 'zh' ? '历史或未知作用域' : 'Legacy or unknown scopes'}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {unknownWorkspaceIds.map((workspaceId) => (
                            <button key={workspaceId} type="button" onClick={() => onToggleWorkspaceId(workspaceId)} className="border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-200">
                              Workspace · {workspaceId} ×
                            </button>
                          ))}
                          {unknownProjectIds.map((projectId) => (
                            <button key={projectId} type="button" onClick={() => onToggleProjectId(projectId)} className="border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-200">
                              Project · {projectId} ×
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            </section>
          </div>
        ) : null}

          </div>
        </div>
        ) : null}

        {activeTab === 'chat' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <CustomAgentChatPanel
                agent={selectedAgent}
                blockedReason={chatBlockedReason}
                workdirSummary={workdirSummary}
                workdirFiles={workdirFiles}
                workdirLoading={workdirLoading}
                workdirRefreshing={workdirRefreshing}
                onRefreshWorkdir={onRefreshWorkdir}
                onDownloadWorkdirFile={onDownloadWorkdirFile}
              />
            </div>
          </div>
        ) : null}

        {activeTab === 'inbox' ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <CustomAgentInboxPanel agentId={selectedAgentId} />
          </div>
        ) : null}

        {activeTab === 'activity' ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <CustomAgentActivityPanel
              selectedAgentId={selectedAgentId}
              tasks={tasks}
              heartbeats={heartbeats}
              auditEntries={auditEntries}
              auditSummary={auditSummary}
            />
          </div>
        ) : null}

      </div>
    </div>
  )
}
