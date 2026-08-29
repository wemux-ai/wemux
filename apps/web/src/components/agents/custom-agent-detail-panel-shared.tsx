/**
 * [INPUT]: Custom Agent draft data and control callbacks shared by its detail panels.
 * [OUTPUT]: The shared configuration-tab contract and reusable Agent-detail helpers.
 * [POS]: Keeps Agent settings navigation consistent across the Agent control-center surface.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { ReactNode } from 'react'
import { AGENT_TYPES, VISIBLE_AGENT_TYPES, getRuntimeDescriptor } from '@shared/agent-type'
import type { SkillRecord } from '@shared/skill'
import type { AppState, CollaborationWorkspace, RuntimeId } from '@shared/types'
import { Activity, BrainCircuit, Cable, Cpu, FolderOpen, Inbox, Layers3, MessageSquareText, Radio, Sparkles, Waypoints } from 'lucide-react'
import type { CustomAgentAuditEntry, CustomAgentAuditSummary } from './custom-agent-activity-panel'
import { RuntimeLabel } from '../runtime/runtime-icons'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'
import { Textarea } from '../ui/textarea'
import {
  type CustomAgentDraft,
  type CustomAgentDraftValidation,
} from '../../lib/custom-agent'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import type {
  AgentHeartbeatRecord,
  AgentRecord,
  AgentTaskRecord,
  AgentWorkdirFileEntry,
  AgentWorkdirReadResult,
  AgentWorkdirSummary,
} from '../../lib/api'

export type SettingsTab = 'overview' | 'model' | 'advanced' | 'runtime' | 'skills' | 'mcp' | 'channels' | 'workspace' | 'workdir' | 'files' | 'mind' | 'heartbeat' | 'chat' | 'inbox' | 'activity'

export type CustomAgentDetailPanelProps = {
  creating: boolean
  selectedAgent: AgentRecord | null
  selectedAgentId: string
  telegramWebhookUrl: string
  feishuEventCallbackUrl: string
  wecomCallbackUrl: string
  whatsappCallbackUrl: string
  telegramWebhookInfo: {
    url: string
    hasCustomCertificate: boolean
    pendingUpdateCount: number
    lastErrorDate?: number
    lastErrorMessage: string
    maxConnections?: number
    allowedUpdates: string[]
  } | null
  workdirSummary: AgentWorkdirSummary | null
  workdirFiles: AgentWorkdirFileEntry[]
  workdirLoading: boolean
  workdirRefreshing: boolean
  draft: CustomAgentDraft
  validation: CustomAgentDraftValidation
  activeTab: SettingsTab
  availableSkills: SkillRecord[]
  suggestedSkills: SkillRecord[]
  suggestedMcpServers: AppState['config']['mcpServers']
  avatarStorage: { configured: boolean; driver: string; bucket: string; maxFileSizeMb: number; acceptedTypes: string[] }
  avatarBusy: boolean
  manualSkillName: string
  manualMcpName: string
  manualMcpTarget: string
  collaborationWorkspaces: CollaborationWorkspace[]
  state: AppState
  tasks: AgentTaskRecord[]
  heartbeats: AgentHeartbeatRecord[]
  auditEntries: CustomAgentAuditEntry[]
  auditSummary: CustomAgentAuditSummary
  skillQuery: string
  mcpQuery: string
  onTabChange: (tab: SettingsTab) => void
  onSave: () => Promise<void>
  onDraftChange: (updater: (current: CustomAgentDraft) => CustomAgentDraft) => void
  onSkillQueryChange: (value: string) => void
  onUploadAvatar: (file: File) => Promise<void>
  onManualSkillNameChange: (value: string) => void
  onAddManualSkill: () => void
  onAddSkillFromCatalog: (skill: SkillRecord) => void
  onUpdateSkill: (skillId: string, updater: (current: CustomAgentDraft['skills'][number]) => CustomAgentDraft['skills'][number]) => void
  onRemoveSkill: (skillId: string) => void
  onMcpQueryChange: (value: string) => void
  onManualMcpNameChange: (value: string) => void
  onManualMcpTargetChange: (value: string) => void
  onAddManualMcp: () => void
  onAddMcpFromGlobal: (server: AppState['config']['mcpServers'][number]) => void
  onUpdateMcp: (serverId: string, updater: (current: CustomAgentDraft['mcpServers'][number]) => CustomAgentDraft['mcpServers'][number]) => void
  onRemoveMcp: (serverId: string) => void
  onToggleProjectId: (projectId: string) => void
  onToggleWorkspaceId: (workspaceId: string) => void
  onDeleteTelegramWebhook: () => void
  onDisconnectFeishu: () => Promise<boolean>
  onDisconnectWechat: () => Promise<boolean>
  onEnsureWorkdir: () => Promise<void>
  onRefreshWorkdir: () => Promise<void>
  onCleanupWorkdir: () => Promise<void>
  onReadWorkdirFile: (relativePath: string) => Promise<AgentWorkdirReadResult>
  onDownloadWorkdirFile: (relativePath: string) => Promise<void>
  onDeleteWorkdirFile: (relativePath: string) => Promise<void>
}

export function buildCustomAgentTabs(t: (key: string) => string): Array<{ id: SettingsTab; label: string; icon: typeof Layers3 }> {
  return [
    { id: 'overview', label: t('agents.custom.tabs.overview'), icon: Layers3 },
    { id: 'model', label: t('agents.custom.tabs.model'), icon: Cpu },
    { id: 'advanced', label: t('agents.custom.tabs.overview'), icon: Layers3 },
    { id: 'runtime', label: t('agents.custom.tabs.runtime'), icon: Cpu },
    { id: 'skills', label: t('agents.custom.tabs.skills'), icon: BrainCircuit },
    { id: 'mcp', label: t('agents.custom.tabs.mcp'), icon: Cable },
    { id: 'channels', label: t('agents.custom.tabs.channels'), icon: Radio },
    { id: 'workdir', label: t('agents.custom.tabs.workdir'), icon: Waypoints },
    { id: 'chat', label: t('agents.custom.tabs.chat'), icon: MessageSquareText },
    { id: 'inbox', label: 'Inbox', icon: Inbox },
    { id: 'activity', label: t('agents.custom.tabs.activity'), icon: Activity },
  ]
}

export function buildCustomAgentRuntimeOptions(
  t: (key: string) => string,
  extraRuntimeIds: RuntimeId[] = [],
): Array<{ value: RuntimeId; label: ReactNode }> {
  const runtimeOptions: Array<{ value: RuntimeId; label: ReactNode }> = VISIBLE_AGENT_TYPES.map((runtimeId) => ({
    value: runtimeId,
    label: <RuntimeLabel runtime={runtimeId} size={14} />,
  }))

  const supportedRuntimeIds = new Set<RuntimeId>(AGENT_TYPES)
  const unavailableRuntimeOptions: Array<{ value: RuntimeId; label: ReactNode }> = Array.from(new Set(extraRuntimeIds))
    .filter((runtimeId) => !supportedRuntimeIds.has(runtimeId))
    .map((runtimeId) => ({
      value: runtimeId,
      label: (
        <span className="inline-flex items-center gap-1.5">
          <RuntimeLabel runtime={runtimeId} size={14} />
          <span>{t('agents.custom.runtimeOptions.unavailableSuffix')}</span>
        </span>
      ),
    }))

  return [...runtimeOptions, ...unavailableRuntimeOptions]
}

export function buildCustomAgentSkillScopeLabels(t: (key: string) => string): Record<'agent' | 'project' | 'workspace', string> {
  return {
    agent: t('agents.custom.skillScope.agent'),
    project: t('agents.custom.skillScope.project'),
    workspace: t('agents.custom.skillScope.workspace'),
  }
}

export function buildCustomAgentSkillApprovalLabels(t: (key: string) => string): Record<'auto' | 'approval', string> {
  return {
    auto: t('agents.custom.skillApproval.auto'),
    approval: t('agents.custom.skillApproval.approval'),
  }
}

export function buildCustomAgentMcpTransportLabels(): Record<'http' | 'sse' | 'stdio' | 'custom', string> {
  return {
    http: 'http',
    sse: 'sse',
    stdio: 'stdio',
    custom: 'custom',
  }
}

export function buildCustomAgentMcpCapabilityLabels(): Record<'resources' | 'resources+tools', string> {
  return {
    resources: 'resources',
    'resources+tools': 'resources + tools',
  }
}

export const getAgentInitials = (name: string) => {
  const normalized = name.trim()
  return (normalized || 'Agent').slice(0, 2).toUpperCase()
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      {children}
    </label>
  )
}

export function ToggleField({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-zinc-100">{title}</p>
          <Badge
            variant="outline"
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px]',
              checked
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : 'border-zinc-700 bg-zinc-900 text-zinc-400',
            )}
          >
            {checked ? t('agents.custom.detail.status.enabled') : t('agents.custom.detail.status.disabled')}
          </Badge>
        </div>
        <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
      </div>
      <div className="flex shrink-0 items-center">
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          aria-label={title}
          className={cn(
            'border border-zinc-700 bg-zinc-900 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]',
            checked
              ? 'data-[state=checked]:border-emerald-400/40 data-[state=checked]:bg-emerald-500'
              : 'data-[state=unchecked]:bg-zinc-800',
          )}
        />
      </div>
    </div>
  )
}

export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-[#09090b] px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{value}</p>
    </div>
  )
}

export function SectionHeader({
  description,
  icon,
  title,
}: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        {icon}
        {title}
      </h3>
      {description ? <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p> : null}
    </div>
  )
}

export function NoticeBlock({
  title,
  tone,
  items,
}: {
  title: string
  tone: 'warning' | 'error'
  items: string[]
}) {
  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-3',
        tone === 'error'
          ? 'border-rose-500/20 bg-rose-500/10 text-rose-100'
          : 'border-amber-500/20 bg-amber-500/10 text-amber-100',
      )}
    >
      <p className="text-sm font-medium">{title}</p>
      <div className="mt-2 space-y-1 text-xs leading-5">
        {items.map((item) => (
          <p key={item}>- {item}</p>
        ))}
      </div>
    </div>
  )
}

export function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-5 text-sm text-zinc-500">
      {text}
    </div>
  )
}

export function CreateWizardPanel({
  draft,
  onCreate,
  onDraftChange,
}: {
  draft: CustomAgentDraft
  onCreate: () => Promise<void>
  onDraftChange: (updater: (current: CustomAgentDraft) => CustomAgentDraft) => void
}) {
  const { language, t } = useTranslation()
  const canCreate = Boolean(draft.name.trim() && (draft.allowedMention || draft.allowedDelegate))

  return (
    <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-4">
      <SectionHeader
        icon={<Sparkles className="h-4 w-4" />}
        title={t('agents.custom.wizard.title')}
        description={t('agents.custom.wizard.description')}
      />

      {/* 基本信息 */}
      <div className="mt-4 space-y-3">
        <Field label={`${language === 'zh' ? 'Agent 名称' : 'Agent name'} *`}>
          <Input
            value={draft.name}
            onChange={(event) => onDraftChange((current) => ({ ...current, name: event.target.value }))}
            placeholder={language === 'zh' ? '例如：发布检查员' : 'Example: Release reviewer'}
          />
        </Field>
        <Field label={language === 'zh' ? '角色定位（可选）' : 'Role (optional)'}>
          <Input
            value={draft.role}
            onChange={(event) => onDraftChange((current) => ({ ...current, role: event.target.value }))}
            placeholder={language === 'zh' ? '例如：测试验证 Agent' : 'Example: QA verification agent'}
          />
        </Field>
        <Field label={language === 'zh' ? '长期指令（可选）' : 'Instructions (optional)'}>
          <Textarea
            value={draft.instructions}
            onChange={(event) => onDraftChange((current) => ({ ...current, instructions: event.target.value }))}
            rows={5}
            placeholder={language === 'zh'
              ? '告诉这个 Agent 它平时怎么工作、优先做什么、遵守什么边界。'
              : 'Describe how this agent works, what it prioritizes, and its boundaries.'}
          />
        </Field>
      </div>

      {/* 调用方式 */}
      <div className="mt-5 space-y-3 border-t border-zinc-800 pt-4">
        <p className="text-sm font-medium text-zinc-100">{language === 'zh' ? '调用方式' : 'Access'}</p>
        <div className="grid gap-2 md:grid-cols-2">
          <label className="flex items-center justify-between gap-3 border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200">
            <span className="min-w-0">
              <span className="block">{language === 'zh' ? '允许在对话中 @ 调用' : 'Allow @ mentions'}</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-zinc-500">
                {language === 'zh' ? '工作区对话里 @ 它即可协作。' : 'Mention it in workspace chat to collaborate.'}
              </span>
            </span>
            <Switch
              checked={draft.allowedMention}
              onCheckedChange={(checked) => onDraftChange((current) => ({ ...current, allowedMention: checked }))}
            />
          </label>
          <label className="flex items-center justify-between gap-3 border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200">
            <span className="min-w-0">
              <span className="block">{language === 'zh' ? '允许正式委派任务' : 'Allow task delegation'}</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-zinc-500">
                {language === 'zh' ? '可被正式委派到任务里独立执行。' : 'Can be delegated to run tasks independently.'}
              </span>
            </span>
            <Switch
              checked={draft.allowedDelegate}
              onCheckedChange={(checked) => onDraftChange((current) => ({ ...current, allowedDelegate: checked }))}
            />
          </label>
        </div>
      </div>

      {/* 创建 */}
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-zinc-800 pt-4">
        <p className="text-xs text-zinc-500">
          {canCreate
            ? (language === 'zh' ? '创建后可直接开始对话，其余配置在设置里随时可改。' : 'Chat right after creation; edit the rest in settings later.')
            : (language === 'zh' ? '填好名称、保留至少一种调用方式即可创建。' : 'Enter a name and keep at least one access mode to create.')}
        </p>
        <Button type="button" disabled={!canCreate} onClick={() => void onCreate()} className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200">
          {language === 'zh' ? '创建并开始对话' : 'Create and start chatting'}
        </Button>
      </div>
    </div>
  )
}
