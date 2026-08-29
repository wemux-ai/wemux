// [INPUT]: Model profiles, source executors, and edit/delete callbacks.
// [OUTPUT]: Searchable model inventory with a resizable list + detail split view.
// [POS]: Models-page "模型" tab; owns selection, search, and source filtering.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useMemo, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { Cpu, Globe, Pencil, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ExecutorRecord, ModelProfile } from '@shared/types'
import { cn, formatDate } from '../../lib/utils'
import { api } from '../../lib/api'
import { useTranslation } from '../../lib/i18n/react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { ScrollArea } from '../ui/scroll-area'
import {
  formatBindingsSummary,
  groupProfileBindings,
  resolveModelProfileSourceWorkerName,
  type GroupedBinding,
  type ModelProfileSourceExecutor,
} from './models-utils'
import { AccountStatusDot } from './account-connect-dialogs'
import { ProviderLogo } from './provider-logo'

type TokenTone = 'bg-zinc-600' | 'bg-emerald-400' | 'bg-amber-400'

const modelPreviewLimit = 4

const resolveTokenTone = (
  configuredTokenCount: number,
  providerCount: number,
): TokenTone => {
  if (configuredTokenCount === 0) {
    return 'bg-zinc-600'
  }
  return configuredTokenCount === providerCount ? 'bg-emerald-400' : 'bg-amber-400'
}

function ProviderBindingCard({ binding, language }: { binding: GroupedBinding, language: string }) {
  const { t } = useTranslation()
  const previewModelIds = binding.modelIds.slice(0, modelPreviewLimit)
  const hiddenModelCount = Math.max(binding.modelIds.length - previewModelIds.length, 0)
  const baseUrlLabel = binding.baseUrl?.trim() || t('models.page.labels.defaultBaseUrl', {
    defaultValue: language === 'zh' ? '使用默认 Base URL' : 'Using default base URL',
  })
  const modelCountLabel = t('models.page.labels.modelsCount', {
    count: binding.modelIds.length,
    defaultValue: language === 'zh' ? `${binding.modelIds.length} 个模型` : `${binding.modelIds.length} models`,
  })

  return (
    <div className="rounded-lg border border-zinc-900 bg-zinc-950/40 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <ProviderLogo providerId={binding.providerId} size={18} />
        <span className="min-w-0 truncate font-mono text-xs font-medium text-zinc-200">{binding.providerId}</span>
        <span className="shrink-0 text-[10px] text-zinc-600">·</span>
        <span className="shrink-0 text-[10px] font-medium text-zinc-500">{modelCountLabel}</span>
        <span
          className={cn(
            'ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium',
            binding.hasApiToken
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-zinc-800 bg-zinc-900/60 text-zinc-500',
          )}
        >
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', binding.hasApiToken ? 'bg-emerald-400' : 'bg-zinc-600')} />
          {binding.hasApiToken
            ? (language === 'zh' ? '已配置 Token' : 'Token configured')
            : (language === 'zh' ? '未配置 Token' : 'Token not configured')}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-zinc-600">
        <Globe className="h-3 w-3 shrink-0" />
        <span className="truncate">{baseUrlLabel}</span>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1">
        {previewModelIds.map((modelId) => (
          <span
            key={`${binding.providerId}-${modelId}`}
            className="rounded border border-zinc-800/70 bg-zinc-900/50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
          >
            {modelId}
          </span>
        ))}
        {hiddenModelCount > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="rounded border border-zinc-800 bg-zinc-900/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
              >
                {`+${hiddenModelCount}`}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[360px] max-w-[calc(100vw-2rem)] rounded-lg border-zinc-800 bg-[#09090b] p-0 text-zinc-100 shadow-2xl shadow-black/40"
            >
              <div className="flex items-center gap-2 border-b border-zinc-900 px-3 py-2.5">
                <span className="min-w-0 truncate font-mono text-xs font-medium text-zinc-200">{binding.providerId}</span>
                <span className="shrink-0 text-[10px] text-zinc-600">·</span>
                <span className="shrink-0 text-[10px] font-medium text-zinc-500">{modelCountLabel}</span>
              </div>
              <ScrollArea className="max-h-72">
                <div className="flex flex-wrap gap-1 p-3">
                  {binding.modelIds.map((modelId) => (
                    <span
                      key={`${binding.providerId}-full-${modelId}`}
                      className="rounded border border-zinc-800/70 bg-zinc-900/50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                    >
                      {modelId}
                    </span>
                  ))}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </div>
  )
}

function ProfileListItem({
  profile,
  selected,
  sourceLabel,
  language,
  onClick,
}: {
  profile: ModelProfile
  selected: boolean
  sourceLabel: Record<ModelProfile['source'], string>
  language: string
  onClick: () => void
}) {
  const { t } = useTranslation()
  const groupedBindings = groupProfileBindings(profile)
  const providerCount = groupedBindings.length
  const configuredTokenCount = groupedBindings.filter((binding) => binding.hasApiToken).length
  const modelCount = groupedBindings.reduce((sum, binding) => sum + binding.modelIds.length, 0)
  const tokenTone = resolveTokenTone(configuredTokenCount, providerCount)
  const secondaryLine = profile.description?.trim()
    || formatBindingsSummary(profile)

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
        selected ? 'bg-zinc-900/80' : 'hover:bg-zinc-900/40',
      )}
    >
      <ProviderLogo providerId={groupedBindings[0]?.providerId} size={18} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tokenTone)} />
          <div className="min-w-0 truncate text-sm font-medium text-zinc-100">{profile.name}</div>
        </div>
        <div className="mt-0.5 truncate text-[11px] leading-4 text-zinc-500">{secondaryLine}</div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span
            className={cn(
              'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
              profile.source === 'worker-import'
                ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
            )}
          >
            {sourceLabel[profile.source]}
          </span>
          <span className="text-[10px] text-zinc-600">
            {t('models.page.labels.modelsCount', {
              count: modelCount,
              defaultValue: language === 'zh' ? `${modelCount} 个模型` : `${modelCount} models`,
            })}
          </span>
        </div>
      </div>
    </button>
  )
}

function ModelDetailPanel({
  profile,
  sourceLabel,
  visibilityMeta,
  sourceExecutors,
  busy,
  onEdit,
  onDeleted,
}: {
  profile: ModelProfile
  sourceLabel: Record<ModelProfile['source'], string>
  visibilityMeta: Record<ModelProfile['visibility'], string>
  sourceExecutors: ModelProfileSourceExecutor[]
  busy: boolean
  onEdit: (profileId: string) => void
  onDeleted: () => void
}) {
  const { t, language } = useTranslation()
  const groupedBindings = groupProfileBindings(profile)
  const providerCount = groupedBindings.length
  const configuredTokenCount = groupedBindings.filter((binding) => binding.hasApiToken).length
  const hasPartialTokenCoverage = configuredTokenCount > 0 && configuredTokenCount < providerCount
  const sourceWorkerName = resolveModelProfileSourceWorkerName(profile, sourceExecutors)
  const modelCount = groupedBindings.reduce((sum, binding) => sum + binding.modelIds.length, 0)

  const statusTone = hasPartialTokenCoverage
    ? { dot: 'bg-amber-400', text: 'text-amber-300', bar: 'bg-amber-400/70' }
    : configuredTokenCount > 0
      ? { dot: 'bg-emerald-400', text: 'text-emerald-300', bar: 'bg-emerald-400/70' }
      : { dot: 'bg-zinc-600', text: 'text-zinc-400', bar: 'bg-zinc-800' }

  const statusText = configuredTokenCount === 0
    ? t('models.page.tokenNotConfigured')
    : configuredTokenCount === providerCount
      ? t('models.page.tokenConfigured')
      : t('models.page.labels.tokenPartiallyConfigured', {
        defaultValue: language === 'zh' ? '部分已配置' : 'Partially configured',
      })

  const coverageText = t('models.page.labels.tokenCoverage', {
    configured: configuredTokenCount,
    total: providerCount,
    defaultValue: language === 'zh'
      ? `${configuredTokenCount} / ${providerCount} 个 Provider 已配置 Token`
      : `${configuredTokenCount} / ${providerCount} providers configured`,
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-900 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-zinc-100">{profile.name}</h2>
          {profile.description ? (
            <p className="mt-0.5 truncate text-[11px] text-zinc-500">{profile.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            disabled={busy}
            onClick={() => onEdit(profile.id)}
          >
            <Pencil className="h-3.5 w-3.5" />
            {t('models.page.actions.edit')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-rose-300"
            disabled={busy}
            onClick={async () => {
              try {
                const response = await api.deleteModelProfile(profile.id)
                toast.success(response.message || t('models.page.toasts.deleted'))
                onDeleted()
              } catch (error) {
                toast.error(error instanceof Error ? error.message : t('models.page.toasts.deleteFailed'))
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="border-zinc-800 bg-zinc-950/80 text-zinc-400">
              {visibilityMeta[profile.visibility]}
            </Badge>
            <span
              className={cn(
                'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                profile.source === 'worker-import'
                  ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
              )}
            >
              {sourceLabel[profile.source]}
            </span>
            {sourceWorkerName ? (
              <span className="text-[10px] text-zinc-600">
                {t('models.page.labels.importedFromWorker', {
                  name: sourceWorkerName,
                  defaultValue: language === 'zh' ? `来自 ${sourceWorkerName}` : `From ${sourceWorkerName}`,
                })}
              </span>
            ) : null}
            <span className="ml-auto text-[11px] text-zinc-500">
              {t('models.page.table.updatedAt')} · {formatDate(profile.updatedAt)}
            </span>
          </div>

          <section className="rounded-lg border border-zinc-900 bg-[#09090b] px-4 py-3.5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', statusTone.dot)} />
                <div className="min-w-0">
                  <p className={cn('text-xs font-medium', statusTone.text)}>{statusText}</p>
                  <p className="mt-0.5 truncate text-[11px] text-zinc-500">{coverageText}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <div className="text-right">
                  <p className="text-lg font-semibold leading-none text-zinc-100">{providerCount}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-600">
                    {language === 'zh' ? '供应商' : 'Providers'}
                  </p>
                </div>
                <div className="h-7 w-px bg-zinc-800" />
                <div className="text-right">
                  <p className="text-lg font-semibold leading-none text-zinc-100">{modelCount}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-600">
                    {language === 'zh' ? '模型' : 'Models'}
                  </p>
                </div>
              </div>
            </div>
            {providerCount > 0 ? (
              <div className="mt-3 flex gap-1">
                {groupedBindings.map((binding, index) => (
                  <div
                    key={`${binding.providerId}-${index}`}
                    className={cn('h-1 flex-1 rounded-full', binding.hasApiToken ? statusTone.bar : 'bg-zinc-800')}
                  />
                ))}
              </div>
            ) : null}
          </section>

          <section className="space-y-2.5">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              {t('models.page.table.providerModel')}
            </h3>
            {groupedBindings.map((binding) => (
              <ProviderBindingCard
                key={`${profile.id}-${binding.providerId}-${binding.baseUrl || 'default'}`}
                binding={binding}
                language={language}
              />
            ))}
          </section>
        </div>
      </div>
    </div>
  )
}

export function ModelInventoryTab({
  profiles,
  sourceExecutors,
  onlineExecutors,
  accountStatus,
  busy,
  onEdit,
  onDeleted,
}: {
  profiles: ModelProfile[]
  sourceExecutors: ModelProfileSourceExecutor[]
  onlineExecutors: ExecutorRecord[]
  accountStatus: { chatgpt: boolean, claude: boolean, openrouter: boolean }
  busy: boolean
  onEdit: (profileId: string) => void
  onDeleted: () => void
}) {
  const { t, language } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)

  const visibilityMeta: Record<ModelProfile['visibility'], string> = {
    private: t('models.visibility.private'),
    team: t('models.visibility.team'),
    workspace: t('models.visibility.workspace', { defaultValue: '组织共享' }),
  }

  const sourceLabel: Record<ModelProfile['source'], string> = {
    manual: t('models.source.manual'),
    'worker-import': t('models.source.workerImport'),
    hosted: t('models.source.hosted', { defaultValue: '官方托管' }),
  }

  const filteredProfiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return profiles.filter((profile) => {
      if (!query) {
        return true
      }
      const haystack = [
        profile.name,
        profile.description ?? '',
        ...profile.bindings.flatMap((binding) => [binding.providerId, binding.modelId, binding.label]),
      ].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [profiles, searchQuery])

  useEffect(() => {
    if (selectedProfileId && !profiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(filteredProfiles[0]?.id ?? null)
    } else if (!selectedProfileId && filteredProfiles.length > 0) {
      setSelectedProfileId(filteredProfiles[0].id)
    }
  }, [profiles, filteredProfiles, selectedProfileId])

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null

  return (
    <Group orientation="horizontal" className="h-full min-h-0">
      <Panel defaultSize="30%" minSize="24%" maxSize="38%">
        <div className="flex h-full min-h-0 flex-col border-r border-zinc-900 bg-[#060607]">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-900 px-3 py-2.5">
            <span className="text-sm font-semibold text-zinc-200">{t('models.page.title')}</span>
            <span className="text-[11px] text-zinc-500">{profiles.length}</span>
          </div>

          {/* 账号接入状态（连接入口在页面右上角「新增」菜单） */}
          <div className="flex shrink-0 items-center gap-3 border-b border-zinc-900 px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
              <ProviderLogo providerId="openai" size={14} />
              <span>ChatGPT</span>
              <AccountStatusDot connected={accountStatus.chatgpt} />
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
              <ProviderLogo providerId="anthropic" size={14} />
              <span>Claude</span>
              <AccountStatusDot connected={accountStatus.claude} />
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
              <ProviderLogo providerId="openrouter" size={14} />
              <span>OpenRouter</span>
              <AccountStatusDot connected={accountStatus.openrouter} />
            </span>
          </div>

          <div className="shrink-0 border-b border-zinc-900 px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-7 w-full rounded-md border border-zinc-800 bg-zinc-950 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
                placeholder={language === 'zh' ? '搜索模型 / 供应商 / 模型 ID' : 'Search models / providers / model IDs'}
              />
            </div>
          </div>

          {filteredProfiles.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="text-center">
                <Cpu className="mx-auto h-7 w-7 text-zinc-700" />
                <p className="mt-3 text-xs leading-5 text-zinc-500">
                  {profiles.length === 0
                    ? t('models.page.empty.title')
                    : (language === 'zh' ? '没有匹配的模型' : 'No matching models')}
                </p>
                {profiles.length === 0 ? (
                  <p className="mt-1 text-[11px] text-zinc-600">{t('models.page.empty.description')}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-0.5 px-1.5 py-1.5">
                {filteredProfiles.map((profile) => (
                  <ProfileListItem
                    key={profile.id}
                    profile={profile}
                    selected={profile.id === selectedProfileId}
                    sourceLabel={sourceLabel}
                    language={language}
                    onClick={() => setSelectedProfileId(profile.id)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </Panel>

      <Separator className="w-px bg-zinc-900" />

      <Panel defaultSize="70%" minSize="50%">
        {selectedProfile ? (
          <ModelDetailPanel
            profile={selectedProfile}
            sourceLabel={sourceLabel}
            visibilityMeta={visibilityMeta}
            sourceExecutors={sourceExecutors}
            busy={busy}
            onEdit={onEdit}
            onDeleted={onDeleted}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <div className="text-center">
              <Cpu className="mx-auto h-8 w-8 text-zinc-700" />
              <p className="mt-3 text-sm text-zinc-500">
                {language === 'zh' ? '从左侧选择一个模型查看详情' : 'Select a model from the list to view details'}
              </p>
            </div>
          </div>
        )}
      </Panel>
    </Group>
  )
}
