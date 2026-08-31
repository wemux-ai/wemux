import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bot, ChevronRight, Cpu, Layers3, MessageSquare, Radio, Send, Settings2, ShieldCheck } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { Switch } from '../ui/switch'
import { Textarea } from '../ui/textarea'
import { useTranslation } from '../../lib/i18n/react'
import {
  buildPrimaryAgentConfig,
  countConfiguredChannels,
  hasEnabledWemuxMcp,
  parsePrimaryAgentConfig,
  WEMUX_MCP_SERVER_ID,
  WEMUX_MCP_SERVER_NAME,
  type McpServerPolicy,
  type PrimaryAgentDraft,
  type SkillPolicy,
} from '../../lib/agent-config'
import { cn } from '../../lib/utils'

type SettingsTab = 'overview' | 'skills' | 'channels' | 'advanced'

const skillPresets = [
  { name: 'planning', tags: ['planning', 'coordination'] },
  { name: 'requirement-clarifier', tags: ['discovery'] },
  { name: 'code-review', tags: ['coding', 'review'] },
  { name: 'delivery-tracker', tags: ['delivery'] },
]

const tabs: Array<{ id: SettingsTab; icon: typeof Settings2 }> = [
  { id: 'overview', icon: Layers3 },
  { id: 'skills', icon: Bot },
  { id: 'channels', icon: Radio },
  { id: 'advanced', icon: ShieldCheck },
]

function createId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function serializeAdvancedDraft(draft: PrimaryAgentDraft) {
  return JSON.stringify(buildPrimaryAgentConfig(draft), null, 2)
}

function statusTone(enabled: boolean, ready = true) {
  if (!enabled) {
    return 'border-zinc-800 bg-zinc-950 text-zinc-400'
  }

  if (!ready) {
    return 'border-amber-500/20 bg-amber-500/10 text-amber-200'
  }

  return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
}

export function PrimaryAgentSettingsPanel({
  busy,
  draft,
  globalMcpServers,
  primaryAgentName,
  onChange,
  onSave,
}: {
  busy: boolean
  draft: PrimaryAgentDraft
  globalMcpServers: McpServerPolicy[]
  primaryAgentName: string | null
  onChange: (updater: (current: PrimaryAgentDraft) => PrimaryAgentDraft) => void
  onSave: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<SettingsTab>('overview')
  const [activePrimaryChannel, setActivePrimaryChannel] = useState<'telegram' | 'feishu' | null>(null)
  const [skillQuery, setSkillQuery] = useState('')
  const [selectedSkillId, setSelectedSkillId] = useState('')
  const [newSkillName, setNewSkillName] = useState('')
  const [advancedJson, setAdvancedJson] = useState(() => serializeAdvancedDraft(draft))
  const [advancedError, setAdvancedError] = useState('')

  const config = useMemo(() => buildPrimaryAgentConfig(draft), [draft])
  const enabledSkills = config.skills.filter((item) => item.enabled).length
  const enabledMcpServers = globalMcpServers.filter((item) => item.enabled).length
  const configuredChannels = countConfiguredChannels(config)
  const wemuxMcp = globalMcpServers.find((item) => item.id === WEMUX_MCP_SERVER_ID || item.name === WEMUX_MCP_SERVER_NAME) ?? null
  const wemuxEnabled = hasEnabledWemuxMcp({ ...config, mcpServers: globalMcpServers })

  const filteredSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase()
    if (!query) {
      return draft.skills
    }

    return draft.skills.filter((item) => {
      return item.name.toLowerCase().includes(query) || item.tags.some((tag) => tag.toLowerCase().includes(query))
    })
  }, [draft.skills, skillQuery])

  const selectedSkill = filteredSkills.find((item) => item.id === selectedSkillId) ?? filteredSkills[0] ?? null

  useEffect(() => {
    if (selectedSkill?.id && selectedSkill.id !== selectedSkillId) {
      setSelectedSkillId(selectedSkill.id)
    }
  }, [selectedSkill?.id, selectedSkillId])

  useEffect(() => {
    setAdvancedJson(serializeAdvancedDraft(draft))
    setAdvancedError('')
  }, [draft])

  const updateSkill = (skillId: string, updater: (current: SkillPolicy) => SkillPolicy) => {
    onChange((current) => ({
      ...current,
      skills: current.skills.map((item) => (item.id === skillId ? updater(item) : item)),
    }))
  }

  const addSkill = (name: string, tags: string[] = []) => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      return
    }

    onChange((current) => {
      if (current.skills.some((item) => item.name.toLowerCase() === trimmedName.toLowerCase())) {
        return current
      }

      const nextSkill: SkillPolicy = {
        id: createId('skill'),
        name: trimmedName,
        enabled: true,
        scope: 'agent',
        approvalMode: 'auto',
        tags,
      }

      return { ...current, skills: [...current.skills, nextSkill] }
    })
    setNewSkillName('')
  }

  const applyAdvancedJson = () => {
    try {
      const parsed = JSON.parse(advancedJson) as Record<string, unknown>
      onChange((current) => {
        const next = buildDraftFromAdvanced(current, parsed)
        return next
      })
      setAdvancedError('')
    } catch (error) {
      setAdvancedError(error instanceof Error ? error.message : t('agents.primary.errors.parseJsonFailed'))
    }
  }

  const translateTransport = (transport: McpServerPolicy['transport']) => t(`agents.primary.transport.${transport}`)
  const translateCapabilityMode = (mode: McpServerPolicy['capabilityMode']) => t(`agents.primary.capabilityMode.${mode}`)

  return (
    <Card className="rounded-lg border-zinc-800 bg-zinc-950/75 text-zinc-100 shadow-none">
      <CardContent className="space-y-6 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold text-zinc-50"><Settings2 size={18} />{t('agents.primary.title')}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{t('agents.primary.description')}</p>
          </div>
          <Button disabled={busy} onClick={() => void onSave()} className="rounded-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200">
            {t('agents.primary.actions.savePrimary')}
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          <OverviewCard label={t('agents.primary.overview.primaryAgent')} value={primaryAgentName || draft.name || t('agents.primary.overview.defaultPrimaryAgent')} />
          <OverviewCard label={t('agents.primary.overview.enabledSkills')} value={String(enabledSkills)} />
          <OverviewCard label={t('agents.primary.overview.enabledMcp')} value={String(enabledMcpServers)} />
          <OverviewCard label={t('agents.primary.overview.channels')} value={String(configuredChannels)} />
        </div>

        <div className="flex flex-wrap gap-2 rounded-lg border border-zinc-800 bg-[#09090b] p-2">
          {tabs.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors',
                activeTab === id ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
              )}
            >
              <Icon size={15} />
              {t(`agents.primary.tabs.${id}`)}
            </button>
          ))}
        </div>

        {activeTab === 'overview' ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <section className="space-y-4 rounded-lg border border-zinc-800 bg-[#09090b] p-4">
              <SectionTitle icon={<Cpu className="h-4 w-4" />} title={t('agents.primary.sections.agentProfile')} />
              <Input value={draft.name} onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))} placeholder={t('agents.primary.placeholders.primaryAgentName')} />
              <Input value={draft.endpoint} onChange={(event) => onChange((current) => ({ ...current, endpoint: event.target.value }))} placeholder={t('agents.primary.placeholders.endpointOptional')} />
              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard label={t('agents.primary.sections.agentSkills')} value={t('agents.primary.count.items', { count: draft.skills.length })} helper={t('agents.primary.helpers.agentSkills')} />
                <MetricCard label={t('agents.primary.sections.mcpAccess')} value={t('agents.primary.count.items', { count: globalMcpServers.length })} helper={t('agents.primary.helpers.systemMcpManaged')} />
                <MetricCard label={t('agents.primary.sections.channelRouting')} value={t('agents.primary.count.items', { count: configuredChannels })} helper={t('agents.primary.helpers.channelRouting')} />
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-zinc-100">{t('agents.primary.wemuxMcp.title')}</p>
                    <p className="mt-1 text-xs text-zinc-500">{t('agents.primary.wemuxMcp.description')}</p>
                  </div>
                  <Badge className={statusTone(Boolean(wemuxMcp), wemuxEnabled)}>{wemuxEnabled ? t('agents.primary.status.enabled') : t('agents.primary.status.disabled')}</Badge>
                </div>
              </div>
            </section>

            <section className="space-y-4 rounded-lg border border-zinc-800 bg-[#09090b] p-4">
              <SectionTitle icon={<Layers3 className="h-4 w-4" />} title={t('agents.primary.sections.capabilitySummary')} />
              <PreviewList
                title={t('agents.primary.tabs.skills')}
                items={draft.skills.map((item) => ({
                  id: item.id,
                  title: item.name,
                  subtitle: `${t(`agents.primary.scope.${item.scope}`)} · ${item.approvalMode === 'approval' ? t('agents.primary.approval.approval') : t('agents.primary.approval.auto')}`,
                  tone: statusTone(item.enabled),
                  badgeLabel: item.enabled ? t('agents.primary.status.enabled') : t('agents.primary.status.disabled'),
                }))}
                empty={t('agents.primary.empty.skills')}
              />
              <PreviewList
                title={t('agents.primary.tabs.mcp')}
                items={globalMcpServers.map((item) => ({
                  id: item.id,
                  title: item.name,
                  subtitle: `${translateTransport(item.transport)} · ${translateCapabilityMode(item.capabilityMode)}`,
                  tone: statusTone(item.enabled, Boolean(item.target.trim())),
                  badgeLabel: item.enabled ? (item.target.trim() ? t('agents.primary.status.configured') : t('agents.primary.status.incomplete')) : t('agents.primary.status.disabled'),
                }))}
                empty={t('agents.primary.empty.mcp')}
              />
            </section>
          </div>
        ) : null}

        {activeTab === 'skills' ? (
          <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
            <section className="space-y-4 rounded-lg border border-zinc-800 bg-[#09090b] p-4">
              <SectionTitle icon={<Bot className="h-4 w-4" />} title={t('agents.primary.sections.agentSkills')} />
              <Input value={skillQuery} onChange={(event) => setSkillQuery(event.target.value)} placeholder={t('agents.primary.placeholders.searchSkill')} />
              <div className="flex flex-wrap gap-2">
                {skillPresets.map((preset) => (
                  <Button key={preset.name} type="button" variant="outline" onClick={() => addSkill(preset.name, preset.tags)} className="rounded-full border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900">
                    + {preset.name}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input value={newSkillName} onChange={(event) => setNewSkillName(event.target.value)} placeholder={t('agents.primary.placeholders.addCustomSkill')} />
                <Button type="button" onClick={() => addSkill(newSkillName)} className="rounded-xl bg-zinc-100 text-zinc-950 hover:bg-zinc-200">{t('common.add')}</Button>
              </div>
              <div className="space-y-2">
                {filteredSkills.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedSkillId(item.id)}
                    className={cn(
                      'w-full rounded-lg border px-3 py-3 text-left transition-colors',
                      selectedSkill?.id === item.id ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-800 bg-zinc-950/70 hover:border-zinc-700',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-zinc-100">{item.name}</span>
                      <Badge className={statusTone(item.enabled)}>{item.enabled ? t('agents.primary.status.enabled') : t('agents.primary.status.disabled')}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{t(`agents.primary.scope.${item.scope}`)} · {item.approvalMode === 'approval' ? t('agents.primary.approval.required') : t('agents.primary.approval.autoAvailable')}</p>
                  </button>
                ))}
                {filteredSkills.length === 0 ? <EmptyState text={t('agents.primary.empty.noMatchedSkill')} /> : null}
              </div>
            </section>

            <section className="space-y-4 rounded-lg border border-zinc-800 bg-[#09090b] p-4">
              <SectionTitle icon={<ShieldCheck className="h-4 w-4" />} title={t('agents.primary.sections.skillPolicy')} />
              {selectedSkill ? (
                <>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
                    <div>
                      <p className="font-medium text-zinc-100">{selectedSkill.name}</p>
                      <p className="mt-1 text-xs text-zinc-500">{t('agents.primary.helpers.skillPolicy')}</p>
                    </div>
                    <Switch checked={selectedSkill.enabled} onCheckedChange={(checked) => updateSkill(selectedSkill.id, (current) => ({ ...current, enabled: checked }))} />
                  </div>
                  <Field label={t('agents.primary.fields.skillName')}>
                    <Input value={selectedSkill.name} onChange={(event) => updateSkill(selectedSkill.id, (current) => ({ ...current, name: event.target.value }))} />
                  </Field>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label={t('agents.primary.fields.scope')}>
                      <NativeSelect
                        value={selectedSkill.scope}
                        onChange={(event) => updateSkill(selectedSkill.id, (current) => ({ ...current, scope: event.target.value as SkillPolicy['scope'] }))}
                      >
                        <option value="agent">{t('agents.primary.scope.agent')}</option>
                        <option value="project">{t('agents.primary.scope.project')}</option>
                        <option value="workspace">{t('agents.primary.scope.workspace')}</option>
                      </NativeSelect>
                    </Field>
                    <Field label={t('agents.primary.fields.approval')}>
                      <NativeSelect
                        value={selectedSkill.approvalMode}
                        onChange={(event) => updateSkill(selectedSkill.id, (current) => ({ ...current, approvalMode: event.target.value as SkillPolicy['approvalMode'] }))}
                      >
                        <option value="auto">{t('agents.primary.approval.auto')}</option>
                        <option value="approval">{t('agents.primary.approval.approval')}</option>
                      </NativeSelect>
                    </Field>
                  </div>
                  <Field label={t('agents.primary.fields.tags')}>
                    <Input
                      value={selectedSkill.tags.join(', ')}
                      onChange={(event) => updateSkill(selectedSkill.id, (current) => ({
                        ...current,
                        tags: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                      }))}
                      placeholder={t('agents.primary.placeholders.tags')}
                    />
                  </Field>
                  <div className="flex items-center justify-between rounded-lg border border-rose-500/10 bg-rose-500/5 p-4">
                    <div>
                      <p className="font-medium text-zinc-100">{t('agents.primary.actions.removeSkillTitle')}</p>
                      <p className="mt-1 text-xs text-zinc-500">{t('agents.primary.helpers.removeSkill')}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onChange((current) => ({ ...current, skills: current.skills.filter((item) => item.id !== selectedSkill.id) }))}
                      className="text-rose-300 hover:bg-zinc-900 hover:text-rose-200"
                    >
                      {t('common.remove')}
                    </Button>
                  </div>
                </>
              ) : (
                <EmptyState text={t('agents.primary.empty.addSkillFirst')} />
              )}
            </section>
          </div>
        ) : null}

        {activeTab === 'channels' ? (
          <div className="space-y-4 rounded-lg border border-zinc-800 bg-[#09090b] p-4">
            <SectionTitle icon={<Radio className="h-4 w-4" />} title={t('agents.primary.sections.channelRouting')} />
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { key: 'telegram' as const, name: 'Telegram', icon: Send, color: '#229ED9', description: t('agents.primary.channels.telegramDescription'), enabled: draft.telegramEnabled, configured: Boolean(draft.telegramBotToken.trim()) },
                { key: 'feishu' as const, name: '飞书', icon: MessageSquare, color: '#3370FF', description: t('agents.primary.channels.feishuDescription'), enabled: draft.feishuEnabled, configured: Boolean(draft.feishuWebhookUrl.trim()) },
              ].map((channel) => (
                <button
                  key={channel.key}
                  type="button"
                  onClick={() => setActivePrimaryChannel(channel.key)}
                  className="group flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-left transition-colors hover:border-zinc-600 hover:bg-zinc-900"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900" style={{ color: channel.color }}>
                    <channel.icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                      {channel.name}
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] leading-none ${!channel.configured ? 'border-zinc-700 text-zinc-500' : channel.enabled ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/25 bg-amber-500/10 text-amber-300'}`}>
                        {!channel.configured ? t('agents.primary.channels.notConfigured') : channel.enabled ? t('agents.primary.channels.connected') : t('agents.primary.channels.disabled')}
                      </span>
                    </span>
                    <span className="mt-1 line-clamp-2 block text-xs leading-4 text-zinc-500">{channel.description}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>

            <Dialog open={Boolean(activePrimaryChannel)} onOpenChange={(open) => { if (!open) setActivePrimaryChannel(null) }}>
              <DialogContent className="w-[calc(100vw-2rem)] max-w-md border-zinc-800 bg-[#0c0c0f] p-0 text-zinc-100 shadow-2xl shadow-black/60">
                <DialogHeader className="text-left">
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900" style={{ color: activePrimaryChannel === 'telegram' ? '#229ED9' : '#3370FF' }}>
                      {activePrimaryChannel === 'telegram' ? <Send className="size-4.5" /> : <MessageSquare className="size-4.5" />}
                    </span>
                    <div className="min-w-0">
                      <DialogTitle className="text-base">配置 {activePrimaryChannel === 'telegram' ? 'Telegram' : '飞书'}</DialogTitle>
                      <DialogDescription className="mt-1 text-xs leading-5 text-zinc-500">{activePrimaryChannel === 'telegram' ? t('agents.primary.channels.telegramDescription') : t('agents.primary.channels.feishuDescription')}</DialogDescription>
                    </div>
                  </div>
                </DialogHeader>
                <div className="space-y-4 px-5 py-4">
                  <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
                    <span className="text-sm text-zinc-200">启用</span>
                    <Switch
                      checked={activePrimaryChannel === 'telegram' ? draft.telegramEnabled : draft.feishuEnabled}
                      onCheckedChange={(checked) => onChange((current) => ({ ...current, [activePrimaryChannel === 'telegram' ? 'telegramEnabled' : 'feishuEnabled']: checked }))}
                    />
                  </div>
                  {activePrimaryChannel === 'telegram' ? (
                    <>
                      <Input value={draft.telegramBotToken} onChange={(event) => onChange((current) => ({ ...current, telegramBotToken: event.target.value }))} placeholder={t('agents.primary.placeholders.telegramBotToken')} />
                      <Input value={draft.telegramMainChatId} onChange={(event) => onChange((current) => ({ ...current, telegramMainChatId: event.target.value }))} placeholder={t('agents.primary.placeholders.telegramMainChatId')} />
                      <Input value={draft.telegramWebhookUrl} onChange={(event) => onChange((current) => ({ ...current, telegramWebhookUrl: event.target.value }))} placeholder={t('agents.primary.placeholders.webhookUrl')} />
                    </>
                  ) : (
                    <Input value={draft.feishuWebhookUrl} onChange={(event) => onChange((current) => ({ ...current, feishuWebhookUrl: event.target.value }))} placeholder={t('agents.primary.placeholders.webhookUrl')} />
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
        ) : null}

        {activeTab === 'advanced' ? (
          <div className="space-y-4 rounded-lg border border-zinc-800 bg-[#09090b] p-4">
            <SectionTitle icon={<ShieldCheck className="h-4 w-4" />} title={t('agents.primary.sections.advancedRawConfig')} />
            <p className="text-sm leading-6 text-zinc-400">{t('agents.primary.helpers.advancedRawConfig')}</p>
            <Textarea value={advancedJson} onChange={(event) => setAdvancedJson(event.target.value)} rows={18} className="font-mono text-xs" />
            {advancedError ? <p className="text-sm text-rose-300">{advancedError}</p> : null}
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={applyAdvancedJson} className="rounded-full border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-900">{t('agents.primary.actions.applyJson')}</Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function buildDraftFromAdvanced(current: PrimaryAgentDraft, parsed: Record<string, unknown>): PrimaryAgentDraft {
  const currentConfig = buildPrimaryAgentConfig(current)
  const nextConfig = parsePrimaryAgentConfig({
    skills: Array.isArray(parsed.skills) ? parsed.skills : currentConfig.skills,
    mcpServers: Array.isArray(parsed.mcpServers) ? parsed.mcpServers : currentConfig.mcpServers,
    channels: typeof parsed.channels === 'object' && parsed.channels !== null ? parsed.channels : currentConfig.channels,
  })

  return {
    ...current,
    skills: nextConfig.skills,
    mcpServers: nextConfig.mcpServers,
    telegramEnabled: nextConfig.channels.telegram.enabled,
    telegramBotToken: nextConfig.channels.telegram.botToken,
    telegramMainChatId: nextConfig.channels.telegram.mainChatId,
    telegramWebhookUrl: nextConfig.channels.telegram.webhookUrl,
    feishuEnabled: nextConfig.channels.feishu.enabled,
    feishuWebhookUrl: nextConfig.channels.feishu.webhookUrl,
  }
}

function OverviewCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="rounded-lg border-zinc-800 bg-zinc-950/75 text-zinc-100 shadow-none">
      <CardContent className="p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">{label}</p>
        <p className="mt-2 text-lg font-semibold text-zinc-50">{value}</p>
      </CardContent>
    </Card>
  )
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{label}</p>
      <p className="mt-2 text-base font-semibold text-zinc-50">{value}</p>
      <p className="mt-2 text-xs leading-5 text-zinc-500">{helper}</p>
    </div>
  )
}

function PreviewList({
  title,
  items,
  empty,
}: {
  title: string
  items: Array<{ id: string; title: string; subtitle: string; badgeLabel: string; tone: string }>
  empty: string
}) {
  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-zinc-100">{title}</p>
        <Badge className="border-zinc-800 bg-zinc-950 text-zinc-300">{items.length}</Badge>
      </div>
      {items.length === 0 ? <p className="text-sm text-zinc-500">{empty}</p> : null}
      {items.slice(0, 4).map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-3">
          <div>
            <p className="font-medium text-zinc-100">{item.title}</p>
            <p className="mt-1 text-xs text-zinc-500">{item.subtitle}</p>
          </div>
          <Badge className={item.tone}>{item.badgeLabel}</Badge>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/50 px-4 py-6 text-sm text-zinc-500">{text}</p>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{label}</p>
      {children}
    </div>
  )
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-300">{icon}</span>
      <span>{title}</span>
    </div>
  )
}
