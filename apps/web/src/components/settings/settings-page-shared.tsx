import type { ReactNode } from 'react'
import type { AgentConfig } from '@shared/types'
import type { UserNotificationSettings } from '@shared/user-notification-settings'
import type { UserExperimentalSettings } from '@shared/user-experimental-settings'
import { ArrowLeft, BellRing, Bot, FlaskConical, FolderCog, FolderOpen, GitBranch, Monitor, Network, UserRound, Palette } from 'lucide-react'

import { RuntimeLabel } from '../runtime/runtime-icons'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import type { Team } from '../../lib/api'
import type { ModelUsageSummaryResponse } from '../../lib/api/types'
import type { LocalNetworkAccessStatus, LocalWorkerHealthProbeResult } from '../../lib/browser-local-network-access'

export type SettingsPageProps = {
  user: { id: string; email: string; name: string; username?: string; usernameUpdatedAt?: string; avatarUrl?: string; bio?: string; isInternal?: boolean } | null
  config: AgentConfig
  notificationSettings: UserNotificationSettings
  experimentalSettings: UserExperimentalSettings
  browserNotificationPermission: 'default' | 'granted' | 'denied' | 'unsupported'
  localNetworkAccessStatus: LocalNetworkAccessStatus
  localWorkerHealthProbe: LocalWorkerHealthProbeResult | null
  localWorkerHealthChecking: boolean
  avatarStorage: { configured: boolean; driver: string; bucket: string; maxFileSizeMb: number; acceptedTypes: string[] }
  busy: boolean
  profileBusy: boolean
  avatarBusy: boolean
  modelUsageSummary?: ModelUsageSummaryResponse['summary'] | null
  modelUsagePeriod?: '7d' | '30d' | 'all'
  teams: Team[]
  requestedSection?: SettingsMenuId
  requestedWorkspaceId?: string
  onSectionChange?: (section: SettingsMenuId) => void
  onWorkspaceSelectionChange?: (workspaceId?: string) => void
  onSaveProfile: (payload: { name: string; bio?: string; username?: string }) => void
  onUploadAvatar: (file: File) => Promise<void>
  onSave: (config: AgentConfig) => void
  onSaveNotificationSettings: (settings: UserNotificationSettings) => void
  onSaveExperimentalSettings: (settings: UserExperimentalSettings) => void
  onRequestBrowserNotificationPermission: () => void
  onTestBrowserNotification: () => void
  onTestFeishuNotification: (settings: UserNotificationSettings) => void
  onTestPushNotification: () => void
  onRequestLocalNetworkAccess: () => void
  onRefreshLocalNetworkAccessStatus: () => void
  onProbeLocalWorkerHealth: () => void
  onModelUsagePeriodChange?: (period: '7d' | '30d' | 'all') => void
  onReset: () => void
}

export type RuntimeTabId = 'OpenCode' | 'Codex' | 'ClaudeCode' | 'Pi'
export type SettingsMenuId = 'profile' | 'connections' | 'security' | 'git' | 'workspace' | 'workspaceOpen' | 'runtime' | 'usage' | 'notifications' | 'localNetworkAccess' | 'desktop' | 'floatingChat' | 'apiTokens' | 'experimental' | 'appearance'

export const buildRuntimeTabs = (): Array<{ id: RuntimeTabId; label: string; badgeLabel?: string }> => [
  { id: 'Pi', label: 'Pi' },
  { id: 'OpenCode', label: 'OpenCode' },
  { id: 'Codex', label: 'Codex' },
  { id: 'ClaudeCode', label: 'Claude Code' },
]

export const buildCodexConfigPlaceholder = (settings: AgentConfig['agentSettings']['Codex']) => [
  '# ~/.codex/config.toml',
  `model = "${settings.defaultModel.trim() || 'gpt-5.4'}"`,
  `approval_policy = "${settings.approval}"`,
  `sandbox_mode = "${settings.sandbox}"`,
  '',
  '# Reasoning',
  `model_reasoning_effort = "${settings.reasoningEffort}"`,
  `model_reasoning_summary = "${settings.reasoningSummary}"`,
  '',
  '# MCP server',
  '[mcp_servers.openaiDeveloperDocs]',
  'url = "https://developers.openai.com/mcp"',
].join('\n')

export const buildClaudeCodeConfigPlaceholder = (settings: AgentConfig['agentSettings']['ClaudeCode']) => {
  const permissionMode = settings.planMode ? 'plan' : settings.permissionMode
  return [
    '{',
    '  "$schema": "https://json.schemastore.org/claude-code-settings.json",',
    `  "model": "${settings.defaultModel.trim() || 'sonnet'}",`,
    '  "permissions": {',
    `    "defaultMode": "${permissionMode}",`,
    '    "allow": ["Bash(npm run lint)", "Bash(npm run test *)"],',
    '    "deny": ["Read(./.env)", "Read(./secrets/**)"]',
    '  },',
    '  "env": {',
    '    "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"',
    '  }',
    '}',
  ].join('\n')
}

export const buildCodexAuthPlaceholder = () => [
  '{',
  '  "OPENAI_API_KEY": "your_api_key",',
  '  "OPENAI_BASE_URL": "https://api.openai.com/v1"',
  '}',
].join('\n')

export const codexReasoningEffortOptions: AgentConfig['agentSettings']['Codex']['reasoningEffort'][] = ['low', 'medium', 'high', 'xhigh']

export function MenuPanel({
  title,
  children,
  mobile = false,
  onBack,
}: {
  title: string
  children: ReactNode
  mobile?: boolean
  onBack?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="wemux-page-outer-frame flex h-full flex-col overflow-hidden">
      <div className="border-b border-zinc-800/80 px-5 py-4 sm:px-6">
        {mobile && onBack ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            className="mb-2 h-7 rounded-lg px-0 text-zinc-500 hover:bg-transparent hover:text-zinc-100"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('settings.menu.back')}
          </Button>
        ) : null}
        <h2 className="text-sm font-medium text-zinc-50">{title}</h2>
      </div>
      <div className="mobile-bottom-nav-safe flex-1 space-y-5 overflow-auto px-5 py-5 sm:px-6 sm:py-6">
        {children}
      </div>
    </div>
  )
}

export function FieldBlock({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div>
        <label className="text-sm font-medium text-zinc-200">{label}</label>
        {hint ? <p className="mt-1 text-xs leading-5 text-zinc-500">{hint}</p> : null}
      </div>
      <div>{children}</div>
    </div>
  )
}

export function IdentityCard({
  title,
  hint,
  configured,
  hasToken,
  showTokenStatus = true,
  showTokenInput = true,
  name,
  email,
  token,
  onChange,
}: {
  title: string
  hint: string
  configured: boolean
  hasToken: boolean
  showTokenStatus?: boolean
  showTokenInput?: boolean
  name: string
  email: string
  token: string
  onChange: (field: 'name' | 'email' | 'token', value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="rounded-[1.35rem] border border-zinc-800/90 bg-[linear-gradient(180deg,rgba(15,15,17,0.98),rgba(10,10,12,0.94))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-100">{title}</p>
          <p className="mt-1 text-xs text-zinc-500">{hint}</p>
        </div>
        <div className="flex gap-2">
          <Badge className={configured ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-zinc-800 bg-zinc-950 text-zinc-400'}>{configured ? t('settings.identity.status.identityReady') : t('settings.identity.status.identityPending')}</Badge>
          {showTokenStatus ? <Badge className={hasToken ? 'border-sky-500/20 bg-sky-500/10 text-sky-200' : 'border-zinc-800 bg-zinc-950 text-zinc-400'}>{hasToken ? t('settings.identity.status.tokenReady') : t('settings.identity.status.tokenMissing')}</Badge> : null}
        </div>
      </div>
      <div className="mt-3 space-y-2.5">
        <Input value={name} onChange={(e) => onChange('name', e.target.value)} placeholder={t('settings.identity.placeholders.gitUserName')} className="h-10" />
        <Input value={email} onChange={(e) => onChange('email', e.target.value)} placeholder={t('settings.identity.placeholders.gitUserEmail')} className="h-10" />
        {showTokenInput ? <Input type="password" value={token} onChange={(e) => onChange('token', e.target.value)} placeholder={t('settings.identity.placeholders.temporaryToken')} className="h-10" /> : null}
      </div>
    </div>
  )
}

export function StatCard({ label, value, subtext }: { label: string; value: string; subtext: string }) {
  return (
    <div className="rounded-[1.15rem] border border-zinc-800/90 bg-zinc-950/80 px-3.5 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">{label}</p>
      <p className="mt-1.5 line-clamp-1 text-base font-semibold text-zinc-50">{value}</p>
      <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-zinc-500">{subtext}</p>
    </div>
  )
}

export function SettingsMenuList({
  activeMenu,
  isMobile,
  sections,
  onSelect,
}: {
  activeMenu: string
  isMobile: boolean
  sections: Array<{ id: string; label: string; group?: string }>
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  const icons: Record<string, ReactNode> = {
    profile: <UserRound className="h-4 w-4" />,
    git: <GitBranch className="h-4 w-4" />,
    workspace: <FolderCog className="h-4 w-4" />,
    workspaceOpen: <FolderOpen className="h-4 w-4" />,
    notifications: <BellRing className="h-4 w-4" />,
    experimental: <FlaskConical className="h-4 w-4" />,
    appearance: <Palette className="h-4 w-4" />,
    localNetworkAccess: <Network className="h-4 w-4" />,
    desktop: <Monitor className="h-4 w-4" />,
    floatingChat: <Bot className="h-4 w-4" />,
  }
  const groupedSections = sections.reduce<Array<{ title: string; items: typeof sections }>>((groups, section) => {
    const title = section.group ?? '设置'
    const current = groups.find((group) => group.title === title)
    if (current) {
      current.items.push(section)
      return groups
    }
    groups.push({ title, items: [section] })
    return groups
  }, [])

  return (
    <aside className="wemux-page-leading-panel flex h-full flex-col overflow-hidden rounded-none border border-zinc-800/90 bg-zinc-950/80 shadow-[0_18px_60px_rgba(0,0,0,0.2)]">
      <div className="border-b border-zinc-800/80 px-3 py-2.5">
        <p className="text-sm font-medium tracking-tight text-zinc-50">{t('settings.title')}</p>
      </div>
      <div className="mobile-bottom-nav-safe flex-1 space-y-3 overflow-y-auto px-2 py-2">
        {groupedSections.map((group) => (
          <div key={group.title}>
            {!isMobile ? <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">{group.title}</p> : null}
            <div className="space-y-0.5">
              {group.items.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onSelect(section.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                    activeMenu === section.id
                      ? 'bg-zinc-800/80 text-zinc-50'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
                  )}
                >
                  <span className={cn(
                    'inline-flex h-4 w-4 shrink-0 items-center justify-center',
                    activeMenu === section.id ? 'text-zinc-200' : 'text-zinc-500',
                  )}
                  >
                    {icons[section.id] ?? <UserRound className="h-4 w-4" />}
                  </span>
                  <span className="truncate text-[13px]">{section.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}

export function JumpCard({ title, description, icon }: { title: string; description: string; icon: ReactNode }) {
  return (
    <div className="rounded-[1.15rem] border border-zinc-800/90 bg-[linear-gradient(180deg,rgba(15,15,17,0.98),rgba(10,10,12,0.94))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center gap-2 text-zinc-200">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950">{icon}</span>
        <span className="font-medium">{title}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-zinc-500">{description}</p>
    </div>
  )
}

export function RuntimeTabs({
  activeTab,
  onSelect,
  tabs,
}: {
  activeTab: RuntimeTabId
  onSelect: (tab: RuntimeTabId) => void
  tabs: Array<{ id: RuntimeTabId; label: string; badgeLabel?: string }>
}) {
  return (
    <div
      role="tablist"
      aria-label="运行时配置分页"
      className="flex gap-1 rounded-lg bg-zinc-900/50 p-0.5"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
              isActive
                ? 'bg-zinc-100 text-zinc-950 shadow-sm'
                : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200',
            )}
          >
            <RuntimeLabel runtime={tab.id} size={14} labelClassName="block" />
            {tab.badgeLabel ? (
              <span className={cn(
                'rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                isActive
                  ? 'border-zinc-950/10 bg-zinc-950/10 text-zinc-700'
                  : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
              )}
              >
                {tab.badgeLabel}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export function ImportedRuntimeConfigPreview({
  importedAgentRuntimeConfig,
  runtime,
}: {
  importedAgentRuntimeConfig: {
    executorId: string
    executorName: string
    opencodeConfigContent: string
    codexConfigContent: string
    codexAuthContent: string
    claudeCodeConfigContent: string
    defaultModel: string
    agentSettings: AgentConfig['agentSettings']
    at: string
  } | null
  runtime: RuntimeTabId
}) {
  const { t } = useTranslation()
  if (!importedAgentRuntimeConfig) {
    return null
  }

  const runtimeConfig = runtime === 'OpenCode'
    ? importedAgentRuntimeConfig.opencodeConfigContent || t('settings.runtimePreview.empty.openCode')
    : runtime === 'Codex'
      ? [
          '# ~/.codex/config.toml',
          importedAgentRuntimeConfig.codexConfigContent || t('settings.runtimePreview.empty.codex'),
          '',
          '# runtime env',
          importedAgentRuntimeConfig.codexAuthContent || '{}',
        ].join('\n')
      : runtime === 'ClaudeCode'
        ? importedAgentRuntimeConfig.claudeCodeConfigContent || t('settings.runtimePreview.empty.claudeCode')
        : [
            t('settings.runtimePreview.empty.piIntro'),
            '',
            `defaultModel = ${importedAgentRuntimeConfig.agentSettings.Pi.defaultModel || '(auto)'}`,
            `agentDir = ${importedAgentRuntimeConfig.agentSettings.Pi.agentDir || '(default)'}`,
          ].join('\n')

  return (
    <div className="mt-3 rounded-[1.05rem] border border-zinc-800/90 bg-zinc-950/70 p-3.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span className="font-medium text-zinc-300">{t('settings.runtimePreview.title')}</span>
        <span>{t('settings.runtimePreview.source', { name: importedAgentRuntimeConfig.executorName })}</span>
        <span>{t('settings.runtimePreview.pulledAt', { value: new Date(importedAgentRuntimeConfig.at).toLocaleString() })}</span>
        {runtime === 'OpenCode' && importedAgentRuntimeConfig.defaultModel ? <span>{t('settings.runtimePreview.openCodeModel', { model: importedAgentRuntimeConfig.defaultModel })}</span> : null}
        {runtime === 'Pi' && importedAgentRuntimeConfig.agentSettings.Pi.defaultModel ? <span>{t('settings.runtimePreview.piModel', { model: importedAgentRuntimeConfig.agentSettings.Pi.defaultModel })}</span> : null}
      </div>
      <div className="mt-2.5">
        <Textarea rows={8} value={runtimeConfig} readOnly className="min-h-[11rem] font-mono text-xs" />
      </div>
    </div>
  )
}

export function RuntimeConfigKeySummary({ keys }: { keys: string[] }) {
  const { t } = useTranslation()
  return (
    <div className="mt-3 rounded-[1.05rem] border border-zinc-800/90 bg-zinc-950/70 p-3.5">
      <p className="text-xs font-medium text-zinc-300">{t('settings.runtimePreview.keySummary')}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {keys.map((key) => (
          <span key={key} className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-300">
            {key}
          </span>
        ))}
      </div>
    </div>
  )
}
