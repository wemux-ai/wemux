import type { RuntimeId } from '@shared/types'
import { Bot, Library, PencilLine, Trash2 } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Badge } from '../ui/badge'
import { Card, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { ScrollArea } from '../ui/scroll-area'
import {
  CUSTOM_AGENT_CATEGORY_OPTIONS,
  type CustomAgentProfile,
  type CustomAgentTemplateLibraryItem,
} from '../../lib/custom-agent'
import { getAgentAvatarAccent } from '../../lib/agent-avatar'
import { useTranslation } from '../../lib/i18n/react'
import { getAgentLiveStatus, useAgentLiveStatuses } from '../../lib/agent-live-status'
import { cn, formatDate } from '../../lib/utils'
import { resolveMediaUrl, type AgentRecord } from '../../lib/api'

export type AgentRegistryStatusFilter = 'all' | 'archived'
export type AgentRegistryRuntimeFilter = 'all' | RuntimeId
export type AgentRegistryCategoryFilter = 'all' | CustomAgentProfile['category']
export type TemplateLibraryCategoryFilter = 'all' | CustomAgentProfile['category']

const getAgentInitials = (name: string) => (name.trim() || 'Agent').slice(0, 2).toUpperCase()

export function CustomAgentRegistrySidebar({
  loading,
  registryCount,
  filteredAgents,
  creating,
  selectedAgentId,
  query,
  statusFilter,
  runtimeFilter,
  categoryFilter,
  templateLibrary,
  filteredTemplateLibrary,
  selectedTemplateLibraryId,
  templateQuery,
  templateCategoryFilter,
  onQueryChange,
  onStatusFilterChange,
  onRuntimeFilterChange,
  onCategoryFilterChange,
  onSelectAgent,
  onTemplateQueryChange,
  onTemplateCategoryFilterChange,
  onSelectTemplateLibraryItem,
  onApplyTemplateLibraryItem,
  onUpdateTemplateLibraryItem,
  onDeleteTemplateLibraryItem,
}: {
  loading: boolean
  registryCount: number
  filteredAgents: Array<{ agent: AgentRecord; profile: CustomAgentProfile }>
  creating: boolean
  selectedAgentId: string
  query: string
  statusFilter: AgentRegistryStatusFilter
  runtimeFilter: AgentRegistryRuntimeFilter
  categoryFilter: AgentRegistryCategoryFilter
  templateLibrary: CustomAgentTemplateLibraryItem[]
  filteredTemplateLibrary: CustomAgentTemplateLibraryItem[]
  selectedTemplateLibraryId: string
  templateQuery: string
  templateCategoryFilter: TemplateLibraryCategoryFilter
  onQueryChange: (value: string) => void
  onStatusFilterChange: (value: AgentRegistryStatusFilter) => void
  onRuntimeFilterChange: (value: AgentRegistryRuntimeFilter) => void
  onCategoryFilterChange: (value: AgentRegistryCategoryFilter) => void
  onSelectAgent: (agentId: string) => void
  onTemplateQueryChange: (value: string) => void
  onTemplateCategoryFilterChange: (value: TemplateLibraryCategoryFilter) => void
  onSelectTemplateLibraryItem: (itemId: string) => void
  onApplyTemplateLibraryItem: (itemId: string) => void
  onUpdateTemplateLibraryItem: (itemId: string) => void
  onDeleteTemplateLibraryItem: (itemId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const runtimeOptions: Array<{ value: RuntimeId; label: string }> = [
    { value: 'OpenCode', label: 'OpenCode' },
    { value: 'Codex', label: 'Codex' },
    { value: 'ClaudeCode', label: 'Claude Code' },
    { value: 'Pi', label: 'Pi' },
  ]
  const selectedTemplateLibraryItem = filteredTemplateLibrary.find((item) => item.id === selectedTemplateLibraryId)
    ?? templateLibrary.find((item) => item.id === selectedTemplateLibraryId)
    ?? null
  const liveStatuses = useAgentLiveStatuses()

  return (
    <Card className="overflow-hidden rounded-xl border-zinc-800 bg-zinc-950/75 text-zinc-100 shadow-none">
      <CardHeader className="space-y-4 border-b border-zinc-800">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot size={16} />
            {t('agents.custom.registry.title')}
          </CardTitle>
          <Badge variant="outline" className="border-zinc-800 bg-zinc-950 text-zinc-400">
            {filteredAgents.length} / {registryCount}
          </Badge>
        </div>

        <div className="space-y-3">
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t('agents.custom.registry.searchAgent')}
            className="border-zinc-800 bg-zinc-950/70 text-zinc-100 placeholder:text-zinc-500"
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <NativeSelect value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as AgentRegistryStatusFilter)}>
              <option value="all">{t('agents.custom.registry.filters.allStatus')}</option>
              <option value="archived">{t('agents.custom.registry.filters.archivedOnly')}</option>
            </NativeSelect>
            <NativeSelect value={runtimeFilter} onChange={(event) => onRuntimeFilterChange(event.target.value as AgentRegistryRuntimeFilter)}>
              <option value="all">{t('agents.custom.registry.filters.allRuntime')}</option>
              {runtimeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </NativeSelect>
            <NativeSelect value={categoryFilter} onChange={(event) => onCategoryFilterChange(event.target.value as AgentRegistryCategoryFilter)}>
              <option value="all">{t('agents.custom.registry.filters.allCategory')}</option>
              {CUSTOM_AGENT_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </NativeSelect>
          </div>
        </div>
      </CardHeader>

      <ScrollArea className="h-[calc(100vh-24rem)] min-h-[28rem]">
        <div className="space-y-2 p-3">
          {loading ? (
            <EmptyCard text={t('common.loading')} />
          ) : filteredAgents.length === 0 ? (
            <EmptyCard text={registryCount === 0 ? t('agents.custom.registry.empty.noAgents') : t('agents.custom.registry.empty.noMatchedAgents')} />
          ) : (
            filteredAgents.map(({ agent, profile }) => {
              const isActive = !creating && selectedAgentId === agent.id
              const liveStatus = getAgentLiveStatus(liveStatuses, agent.id, agent.name)
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => onSelectAgent(agent.id)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors',
                    isActive
                      ? 'border-zinc-700 bg-zinc-900 text-zinc-50'
                      : 'border-zinc-800 bg-[#09090b] text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900/70',
                  )}
                >
                  <span className="relative shrink-0">
                    <Avatar className="h-10 w-10 rounded-full border border-zinc-800 bg-zinc-900">
                      <AvatarImage src={resolveMediaUrl(profile.avatarUrl)} />
                      <AvatarFallback className={cn(
                        'rounded-full bg-gradient-to-br text-xs font-black text-zinc-950',
                        getAgentAvatarAccent(agent.id),
                      )}>
                        {getAgentInitials(agent.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      className={cn(
                        'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#09090b]',
                        agent.status === 'online' ? 'bg-emerald-400' : agent.status === 'error' ? 'bg-rose-400' : 'bg-zinc-600',
                      )}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="block truncate text-sm font-medium">{agent.name}</span>
                      {liveStatus && liveStatus.workingCount > 0 ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                          {t('agents.custom.registry.working', { defaultValue: '运行中' })}
                          {liveStatus.workingCount > 1 ? ` ${liveStatus.workingCount}` : ''}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block truncate text-xs text-zinc-500">{profile.role || t('agents.custom.registry.undefinedRole')}</span>
                  </span>
                </button>
              )
            })
          )}
        </div>

        <div className="border-t border-zinc-800 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <Library size={15} />
              {t('agents.custom.registry.templateLibrary')}
            </div>
            <Badge variant="outline" className="border-zinc-800 bg-zinc-950 text-zinc-400">
              {filteredTemplateLibrary.length} / {templateLibrary.length}
            </Badge>
          </div>

          <div className="space-y-3">
            <Input
              value={templateQuery}
              onChange={(event) => onTemplateQueryChange(event.target.value)}
              placeholder={t('agents.custom.registry.searchTemplate')}
              className="border-zinc-800 bg-zinc-950/70 text-zinc-100 placeholder:text-zinc-500"
            />
            <NativeSelect value={templateCategoryFilter} onChange={(event) => onTemplateCategoryFilterChange(event.target.value as TemplateLibraryCategoryFilter)}>
              <option value="all">{t('agents.custom.registry.filters.allTemplateCategory')}</option>
              {CUSTOM_AGENT_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </NativeSelect>

            {templateLibrary.length === 0 ? (
              <EmptyCard text={t('agents.custom.registry.empty.noTemplates')} />
            ) : filteredTemplateLibrary.length === 0 ? (
              <EmptyCard text={t('agents.custom.registry.empty.noMatchedTemplates')} />
            ) : (
              filteredTemplateLibrary.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    'rounded-xl border px-3 py-3',
                    selectedTemplateLibraryId === item.id
                      ? 'border-zinc-700 bg-zinc-900'
                      : 'border-zinc-800 bg-[#09090b]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectTemplateLibraryItem(item.id)}
                    className="w-full text-left"
                  >
                    <p className="truncate text-sm font-medium text-zinc-100">{item.package.template.name}</p>
                  </button>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Badge variant="outline" className="border-zinc-800 bg-zinc-950 text-[10px] text-zinc-400">
                      {CUSTOM_AGENT_CATEGORY_OPTIONS.find((option) => option.value === item.package.template.category)?.label || item.package.template.category}
                    </Badge>
                    <Badge variant="outline" className="border-zinc-800 bg-zinc-950 text-[10px] text-zinc-400">
                      v{item.version}
                    </Badge>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onApplyTemplateLibraryItem(item.id)}
                        className="text-xs text-zinc-300 transition-colors hover:text-zinc-100"
                      >
                        {t('agents.custom.wizard.applyTemplate')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateTemplateLibraryItem(item.id)}
                        className="text-zinc-500 transition-colors hover:text-zinc-100"
                        aria-label={t('agents.custom.registry.updateTemplate')}
                      >
                        <PencilLine size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteTemplateLibraryItem(item.id)}
                        className="text-zinc-500 transition-colors hover:text-rose-300"
                        aria-label={t('agents.custom.registry.deleteTemplate')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}

            {selectedTemplateLibraryItem ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3">
                <p className="text-sm font-medium text-zinc-100">{t('agents.custom.registry.templatePreview')}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <TemplateMeta label={t('agents.custom.registry.meta.version')} value={`v${selectedTemplateLibraryItem.version}`} />
                  <TemplateMeta label={t('agents.custom.registry.meta.updated')} value={formatDate(selectedTemplateLibraryItem.updatedAt)} />
                  <TemplateMeta label="Skills" value={String(selectedTemplateLibraryItem.package.draft.config.skills.filter((item) => item.enabled).length)} />
                  <TemplateMeta label="MCP" value={String(selectedTemplateLibraryItem.package.draft.config.mcpServers.filter((item) => item.enabled).length)} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </ScrollArea>
    </Card>
  )
}

function EmptyCard({
  text,
}: {
  text: string
}) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-5 text-sm text-zinc-500">
      {text}
    </div>
  )
}

function TemplateMeta({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-[#09090b] px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-zinc-300">{value}</p>
    </div>
  )
}
