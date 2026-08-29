import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Circle, Loader2, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { getRuntimeDescriptor } from '@shared/agent-type'
import type { AgentType, ModelProfile, ModelProfileVisibility } from '@shared/types'
import { resolveCollaborationWorkspace } from '../../lib/collaboration-workspace'
import { cn } from '../../lib/utils'
import { api, type CollaborationWorkspace, type ModelProfileCreatePayload, type ModelProfileUpdatePayload, type Team } from '../../lib/api'
import { useTranslation } from '../../lib/i18n/react'
import {
  findProviderTemplate,
  getProviderTemplate,
  inferProviderCompatibility,
  PROVIDER_TEMPLATES,
  type ProviderTemplateCompatibility,
} from './provider-templates'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { Textarea } from '../ui/textarea'
import { RuntimeIcon } from '../runtime/runtime-icons'
import { resolveModelProfileSourceWorkerName, type ModelProfileSourceExecutor } from './models-utils'

export type BindingAgentType = AgentType

type ValidationErrors = Record<string, Record<string, string>>

type ProviderTestState = {
  status: 'success' | 'error'
  message: string
}

type AgentAvailabilityStatus = 'idle' | 'testing' | 'success' | 'error'

type AgentAvailabilityState = {
  status: AgentAvailabilityStatus
  message?: string
  testedModelId?: string
  executionModel?: string
  latencyMs?: number
  outputPreview?: string
  checkedAt?: string
}

type AgentAvailabilityMap = Partial<Record<AgentType, AgentAvailabilityState>>

type ProviderDraft = {
  key: string
  providerId: string
  modelIdsText: string
  baseUrl: string
  compatibility: ProviderTemplateCompatibility
  apiToken: string
  hasApiToken: boolean
  clearApiToken: boolean
  bindingIds: Partial<Record<AgentType, Record<string, string>>>
  agentAvailability: AgentAvailabilityMap
}

const DEFAULT_PROVIDER_TEMPLATE = getProviderTemplate('openai')
const CUSTOM_PROVIDER_TEMPLATE_ID = 'custom'
const MODEL_PROFILE_AGENT_TEST_TYPES = ['Codex', 'ClaudeCode', 'OpenCode', 'Pi'] as const satisfies readonly AgentType[]

const createProviderDraft = (): ProviderDraft => ({
  key: crypto.randomUUID(),
  providerId: DEFAULT_PROVIDER_TEMPLATE?.providerId ?? 'openai',
  modelIdsText: '',
  baseUrl: DEFAULT_PROVIDER_TEMPLATE?.baseUrl ?? '',
  compatibility: DEFAULT_PROVIDER_TEMPLATE?.compatibility ?? 'openai',
  apiToken: '',
  hasApiToken: false,
  clearApiToken: false,
  bindingIds: {},
  agentAvailability: {},
})

const buildProviderGroupKey = (providerId: string, baseUrl?: string) => `${providerId.trim()}::${baseUrl?.trim() || ''}`

const normalizeModelIds = (value: string) => {
  return Array.from(new Set(
    value
      .split(/[\n,]+/g)
      .map((item) => item.trim())
      .filter(Boolean),
  ))
}

const buildProviderAvailabilitySignature = (provider: ProviderDraft) => JSON.stringify({
  providerId: provider.providerId.trim(),
  baseUrl: provider.baseUrl.trim(),
  compatibility: provider.compatibility,
  modelIds: normalizeModelIds(provider.modelIdsText),
  apiToken: provider.apiToken.trim(),
  hasApiToken: provider.hasApiToken,
  clearApiToken: provider.clearApiToken,
})

const toProviderDrafts = (profile: ModelProfile | null | undefined): ProviderDraft[] => {
  if (!profile) {
    return [createProviderDraft()]
  }

  const grouped = new Map<string, ProviderDraft>()

  for (const binding of profile.bindings) {
    const key = buildProviderGroupKey(binding.providerId, binding.baseUrl)
    const current = grouped.get(key) ?? {
      key,
      providerId: binding.providerId,
      modelIdsText: '',
      baseUrl: binding.baseUrl ?? '',
      compatibility: inferProviderCompatibility(binding.providerId, binding.baseUrl),
      apiToken: '',
      hasApiToken: Boolean(binding.hasApiToken),
      clearApiToken: false,
      bindingIds: {},
      agentAvailability: {},
    }

    const modelIds = normalizeModelIds(current.modelIdsText)
    if (!modelIds.includes(binding.modelId)) {
      current.modelIdsText = [...modelIds, binding.modelId].join('\n')
    }

    current.hasApiToken = current.hasApiToken || Boolean(binding.hasApiToken)
    if (binding.agentType === 'ClaudeCode') {
      current.compatibility = 'anthropic'
    } else if (binding.agentType === 'Codex' && current.compatibility !== 'anthropic') {
      current.compatibility = 'openai'
    }
    current.bindingIds = {
      ...current.bindingIds,
      [binding.agentType]: {
        ...(current.bindingIds[binding.agentType] ?? {}),
        [binding.modelId]: binding.id,
      },
    }
    if (MODEL_PROFILE_AGENT_TEST_TYPES.includes(binding.agentType as (typeof MODEL_PROFILE_AGENT_TEST_TYPES)[number])) {
      current.agentAvailability = {
        ...current.agentAvailability,
        [binding.agentType]: {
          status: 'success',
          testedModelId: binding.modelId,
        },
      }
    }

    grouped.set(key, current)
  }

  return grouped.size > 0 ? Array.from(grouped.values()) : [createProviderDraft()]
}

const buildExpandedBindings = (providers: ProviderDraft[], mode: 'create' | 'edit') => {
  return providers.flatMap((provider) => {
    const modelIds = normalizeModelIds(provider.modelIdsText)
    const availableAgents = MODEL_PROFILE_AGENT_TEST_TYPES.filter((agentType) => provider.agentAvailability[agentType]?.status === 'success')

    return availableAgents.flatMap((agentType) => modelIds.map((modelId) => ({
      ...(mode === 'edit' ? { id: provider.bindingIds[agentType]?.[modelId] } : {}),
      agentType,
      providerId: provider.providerId.trim(),
      modelId,
      label: `${provider.providerId.trim()}/${modelId}`,
      baseUrl: provider.baseUrl.trim() || undefined,
      apiToken: mode === 'edit'
        ? (provider.clearApiToken ? undefined : (provider.apiToken.trim() || undefined))
        : (provider.apiToken.trim() || undefined),
      ...(mode === 'edit' ? { clearApiToken: provider.clearApiToken || undefined } : {}),
    })))
  })
}

const findProviderBindingId = (provider: ProviderDraft) => {
  for (const agentBindings of Object.values(provider.bindingIds)) {
    if (!agentBindings) {
      continue
    }

    const bindingId = Object.values(agentBindings).find(Boolean)
    if (bindingId) {
      return bindingId
    }
  }

  return ''
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{title}</h3>
      <div>{children}</div>
    </div>
  )
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string
  error?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
        {label}
        {required && <span className="text-rose-400">*</span>}
      </label>
      {children}
      {error && <p className="text-[11px] text-rose-400">{error}</p>}
    </div>
  )
}

function ProviderEditorCard({
  canRemove,
  title,
  provider,
  updateProvider,
  onRemove,
  showTokenState,
  errors,
  providerTestState,
  testingProvider,
  testingAgents,
  onTestProvider,
  onTestAgents,
}: {
  canRemove: boolean
  title: string
  provider: ProviderDraft
  updateProvider: (patch: Partial<ProviderDraft>) => void
  onRemove: () => void
  showTokenState: boolean
  errors?: {
    providerId?: string
    modelIdsText?: string
  }
  providerTestState?: ProviderTestState
  testingProvider: boolean
  testingAgents: boolean
  onTestProvider: () => void
  onTestAgents: () => void
}) {
  const { t } = useTranslation()
  const inferredTemplate = findProviderTemplate(provider.providerId)
  const selectedTemplate = provider.baseUrl.trim()
    ? findProviderTemplate(provider.providerId, provider.baseUrl)
    : null
  const activeTemplate = selectedTemplate ?? inferredTemplate ?? DEFAULT_PROVIDER_TEMPLATE
  const templateValue = selectedTemplate?.id ?? CUSTOM_PROVIDER_TEMPLATE_ID
  const providerIdPlaceholder = activeTemplate?.providerId ?? 'openai'
  const baseUrlPlaceholder = activeTemplate?.baseUrl ?? 'https://api.openai.com/v1'
  const modelIdsPlaceholder = activeTemplate?.modelExamples.join('\n') || 'gpt-5\ngpt-5-mini'
  const templateMeta = activeTemplate
    ? `${t(`models.dialog.providerTemplates.compatibility.${activeTemplate.compatibility}`)} · ${t('models.dialog.providerTemplates.examples', { models: activeTemplate.modelExamples.join(', ') })}`
    : null

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-900 bg-zinc-950/60">
      <div className="flex items-center justify-between border-b border-zinc-900 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-200">{title}</span>
          <Badge className="border border-zinc-700 bg-zinc-950 text-zinc-300">{provider.providerId || t('models.dialog.providerFallback')}</Badge>
        </div>
        {canRemove ? (
          <Button type="button" variant="ghost" className="h-7 rounded-md px-2 text-[11px] text-zinc-500 hover:bg-zinc-900 hover:text-rose-300" onClick={onRemove}>
            <Trash2 className="mr-1 h-3 w-3" />
            {t('models.page.actions.delete')}
          </Button>
        ) : null}
      </div>

      <div className="space-y-3.5 px-4 py-3.5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label={t('models.dialog.fields.providerTemplate')}>
            <NativeSelect
              className="h-8 rounded-lg border-zinc-800 bg-zinc-950 text-xs text-zinc-100"
              value={templateValue}
              onChange={(event) => {
                const template = getProviderTemplate(event.target.value)
                if (!template) {
                  return
                }

                updateProvider({
                  providerId: template.providerId,
                  baseUrl: template.baseUrl,
                  compatibility: template.compatibility,
                })
              }}
            >
              <option value={CUSTOM_PROVIDER_TEMPLATE_ID}>{t('models.dialog.providerTemplates.custom')}</option>
              {PROVIDER_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                </option>
              ))}
            </NativeSelect>
            {templateMeta ? <p className="text-[11px] text-zinc-500">{templateMeta}</p> : null}
          </Field>

          <Field label={t('models.dialog.fields.providerProtocol')}>
            <NativeSelect
              className="h-8 rounded-lg border-zinc-800 bg-zinc-950 text-xs text-zinc-100"
              value={provider.compatibility}
              onChange={(event) => updateProvider({ compatibility: event.target.value as ProviderTemplateCompatibility })}
            >
              <option value="openai">{t('models.dialog.providerTemplates.compatibility.openai')}</option>
              <option value="anthropic">{t('models.dialog.providerTemplates.compatibility.anthropic')}</option>
            </NativeSelect>
            <p className="text-[11px] text-zinc-500">{t('models.dialog.providerTemplates.protocolHint')}</p>
          </Field>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label={t('models.dialog.fields.providerId')} error={errors?.providerId} required>
            <Input
              className="h-8 rounded-lg border-zinc-800 bg-zinc-950 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700"
              value={provider.providerId}
              onChange={(event) => updateProvider({ providerId: event.target.value })}
              placeholder={providerIdPlaceholder}
            />
          </Field>
          <Field label={t('models.dialog.fields.baseUrl')}>
            <Input className="h-8 rounded-lg border-zinc-800 bg-zinc-950 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700" value={provider.baseUrl} onChange={(event) => updateProvider({ baseUrl: event.target.value })} placeholder={baseUrlPlaceholder} />
          </Field>
        </div>

        <Field label={t('models.dialog.fields.modelIds')} error={errors?.modelIdsText} required>
          <Textarea
            className="min-h-[88px] rounded-lg border-zinc-800 bg-zinc-950 font-mono text-xs text-zinc-200"
            value={provider.modelIdsText}
            onChange={(event) => updateProvider({ modelIdsText: event.target.value })}
            placeholder={modelIdsPlaceholder}
          />
        </Field>

        <Field label={t('models.dialog.fields.apiToken')}>
          <Input
            className="h-8 rounded-lg border-zinc-800 bg-zinc-950 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700"
            type="password"
            value={provider.apiToken}
            onChange={(event) => updateProvider({ apiToken: event.target.value, clearApiToken: false })}
            placeholder={showTokenState && provider.hasApiToken ? t('models.dialog.placeholders.keepSavedToken') : t('models.dialog.placeholders.apiToken')}
          />
        </Field>

        {showTokenState && provider.hasApiToken ? (
          <div className="flex items-center gap-2 rounded-lg border border-zinc-900 bg-zinc-950 px-3 py-2 text-[11px] text-zinc-400">
            <Switch
              checked={provider.clearApiToken}
              onCheckedChange={(checked) => updateProvider({
                clearApiToken: checked,
                apiToken: checked ? '' : provider.apiToken,
              })}
              className="data-[state=checked]:bg-rose-500 data-[state=unchecked]:bg-zinc-600"
            />
            <span>{t('models.dialog.clearToken')}</span>
          </div>
        ) : null}
      </div>

      {/* 可用性检测：与配置同块，检测通过才保存绑定 */}
      <div className="border-t border-zinc-900 bg-[#09090b] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="text-xs font-medium text-zinc-200">{t('models.dialog.agentTest.title', { defaultValue: '可用性检测' })}</h4>
            <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">
              {t('models.dialog.agentTest.description', { defaultValue: '先测接口是否通，再用 Codex、Claude Code、OpenCode、Pi 真正发起一次短请求。只有检测通过的 Agent 会保存模型绑定。' })}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" size="sm" className="h-7 rounded-md border-zinc-800 bg-zinc-950 px-2.5 text-[11px] text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100" onClick={onTestProvider} disabled={testingProvider || testingAgents}>
              {testingProvider ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              {testingProvider ? t('models.dialog.actions.testingAvailability') : t('models.dialog.actions.testAvailability')}
            </Button>
            <Button type="button" size="sm" className="h-7 rounded-md px-2.5 text-[11px]" onClick={onTestAgents} disabled={testingProvider || testingAgents}>
              {testingAgents ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              {testingAgents
                ? t('models.dialog.actions.testingAgents', { defaultValue: '检测中...' })
                : t('models.dialog.actions.testAgents', { defaultValue: '检测 Agent 可用性' })}
            </Button>
          </div>
        </div>

        {providerTestState ? (
          <div
            className={cn(
              'mt-2.5 rounded-md border px-2.5 py-1.5 text-[11px]',
              providerTestState.status === 'success'
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                : 'border-rose-500/20 bg-rose-500/10 text-rose-200',
            )}
          >
            {providerTestState.message}
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {MODEL_PROFILE_AGENT_TEST_TYPES.map((agentType) => (
            <AgentAvailabilityCard
              key={agentType}
              agentType={agentType}
              state={provider.agentAvailability[agentType]}
            />
          ))}
        </div>
        <AgentAvailabilityLogs availability={provider.agentAvailability} />
      </div>
    </div>
  )
}

function AgentAvailabilityCard({
  agentType,
  state,
}: {
  agentType: AgentType
  state?: AgentAvailabilityState
}) {
  const { t } = useTranslation()
  const descriptor = getRuntimeDescriptor(agentType)
  const status = state?.status ?? 'idle'
  const statusNode = (() => {
    if (status === 'testing') {
      return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-sky-300" />
    }
    if (status === 'success') {
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
    }
    if (status === 'error') {
      return <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-300" />
    }
    return <Circle className="h-3 w-3 shrink-0 text-zinc-600" />
  })()
  const statusLabel = status === 'testing'
    ? t('models.dialog.agentTest.status.testing', { defaultValue: '检测中' })
    : status === 'success'
      ? t('models.dialog.agentTest.status.success', { defaultValue: '可用' })
      : status === 'error'
        ? t('models.dialog.agentTest.status.error', { defaultValue: '不可用' })
        : t('models.dialog.agentTest.status.idle', { defaultValue: '未检测' })

  return (
    <div
      title={statusLabel}
      className={cn(
        'flex items-center gap-2 rounded-md border px-2.5 py-2 transition-colors',
        status === 'success'
          ? 'border-emerald-500/25 bg-emerald-500/5'
          : status === 'error'
            ? 'border-rose-500/25 bg-rose-500/5'
            : status === 'testing'
              ? 'border-sky-500/25 bg-sky-500/5'
              : 'border-zinc-800/80 bg-zinc-950/70',
      )}
    >
      <RuntimeIcon runtime={agentType} size={16} className="shrink-0 rounded" />
      <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{descriptor.label}</span>
      {statusNode}
    </div>
  )
}

function AgentAvailabilityLogs({
  availability,
}: {
  availability: AgentAvailabilityMap
}) {
  const { t } = useTranslation()
  const hasLogs = MODEL_PROFILE_AGENT_TEST_TYPES.some((agentType) => {
    const state = availability[agentType]
    return Boolean(state && state.status !== 'idle')
  })

  if (!hasLogs) {
    return null
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-900 bg-black/50">
      <div className="border-b border-zinc-900 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
        {t('models.dialog.agentTest.logs.title', { defaultValue: 'Coding Agent 检测日志' })}
      </div>
      <div className="max-h-56 space-y-3 overflow-y-auto p-3 font-mono text-[11px] leading-5 text-zinc-300">
        {MODEL_PROFILE_AGENT_TEST_TYPES.map((agentType) => {
          const state = availability[agentType]
          if (!state || state.status === 'idle') {
            return null
          }

          const descriptor = getRuntimeDescriptor(agentType)
          const statusText = state.status === 'testing'
            ? t('models.dialog.agentTest.logs.testing', { defaultValue: 'testing' })
            : state.status === 'success'
              ? t('models.dialog.agentTest.logs.success', { defaultValue: 'success' })
              : t('models.dialog.agentTest.logs.error', { defaultValue: 'error' })
          const tone = state.status === 'success'
            ? 'text-emerald-300'
            : state.status === 'error'
              ? 'text-rose-300'
              : 'text-sky-300'

          return (
            <div key={agentType} className="rounded-md bg-zinc-950/80 px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-zinc-500">[{state.checkedAt || '--:--:--'}]</span>
                <span className="text-zinc-100">{descriptor.label}</span>
                <span className={tone}>{statusText}</span>
              </div>
              {state.testedModelId ? (
                <div className="mt-1 text-zinc-500">
                  model=<span className="text-zinc-300">{state.testedModelId}</span>
                </div>
              ) : null}
              {state.executionModel ? (
                <div className="text-zinc-500">
                  executionModel=<span className="text-zinc-300">{state.executionModel}</span>
                </div>
              ) : null}
              {typeof state.latencyMs === 'number' ? (
                <div className="text-zinc-500">
                  latency=<span className="text-zinc-300">{state.latencyMs}ms</span>
                </div>
              ) : null}
              {state.message ? (
                <div className="mt-1 whitespace-pre-wrap break-words text-zinc-300">{state.message}</div>
              ) : null}
              {state.outputPreview ? (
                <div className="mt-1 whitespace-pre-wrap break-words text-zinc-400">
                  output: {state.outputPreview}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ModelProfileDialog({
  busy,
  mode,
  onCreate,
  onOpenChange,
  onSave,
  open,
  profile,
  defaultWorkspaceId,
  workspaces,
  teams,
  sourceExecutors = [],
}: {
  busy: boolean
  mode: 'create' | 'edit'
  onCreate?: (payload: ModelProfileCreatePayload) => Promise<void>
  onOpenChange: (open: boolean) => void
  onSave?: (profileId: string, payload: ModelProfileUpdatePayload) => Promise<void>
  open: boolean
  profile?: ModelProfile | null
  defaultWorkspaceId?: string
  workspaces: CollaborationWorkspace[]
  teams: Team[]
  sourceExecutors?: ModelProfileSourceExecutor[]
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<ModelProfile['visibility']>('private')
  const [teamId, setTeamId] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [providers, setProviders] = useState<ProviderDraft[]>([createProviderDraft()])
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [testingProviderKey, setTestingProviderKey] = useState('')
  const [testingAgentProviderKey, setTestingAgentProviderKey] = useState('')
  const [providerTestStates, setProviderTestStates] = useState<Record<string, ProviderTestState>>({})
  const isLegacyMultiProvider = providers.length > 1
  const currentWorkspace = useMemo(
    () => resolveCollaborationWorkspace(workspaces, workspaceId || defaultWorkspaceId),
    [defaultWorkspaceId, workspaceId, workspaces],
  )
  const sourceWorkerName = profile
    ? resolveModelProfileSourceWorkerName(profile, sourceExecutors)
    : ''
  const lockWorkspaceSelection = mode === 'create' && Boolean(defaultWorkspaceId?.trim())
  const visibilityOptions = useMemo(() => {
    const options: Array<{ value: ModelProfileVisibility | 'workspace'; label: string }> = [
      { value: 'private', label: t('models.dialog.visibility.private') },
      { value: 'workspace', label: t('models.dialog.visibility.workspace', { defaultValue: '共享到当前组织' }) },
    ]

    if (mode === 'edit' && profile?.visibility === 'team') {
      options.push({
        value: 'team',
        label: t('models.dialog.visibility.team', { defaultValue: '组织共享（旧数据）' }),
      })
    }

    return options
  }, [mode, profile?.visibility, t])
  const providerSchema = useMemo(() => z.object({
    providerId: z.string().min(1, t('models.dialog.validation.providerIdRequired')),
    baseUrl: z.string(),
    compatibility: z.enum(['openai', 'anthropic']),
    modelIdsText: z.string().min(1, t('models.dialog.validation.modelIdsRequired')),
    apiToken: z.string(),
  }), [t])
  const baseInfoSchema = useMemo(() => z.object({
    name: z.string().min(1, t('models.dialog.validation.nameRequired')),
    description: z.string(),
    visibility: z.enum(['private', 'team', 'workspace']),
    teamId: z.string(),
    workspaceId: z.string(),
  }), [t])

  useEffect(() => {
    if (!open) {
      if (mode === 'create') {
        setName('')
        setDescription('')
        setVisibility('private')
        setTeamId('')
        setWorkspaceId(defaultWorkspaceId ?? '')
        setProviders([createProviderDraft()])
        setErrors({})
        setTouched({})
        setTestingProviderKey('')
        setTestingAgentProviderKey('')
        setProviderTestStates({})
      }
      return
    }

    if (mode === 'edit' && profile) {
      setName(profile.name)
      setDescription(profile.description ?? '')
      setVisibility(profile.visibility)
      setTeamId(profile.teamId ?? '')
      setWorkspaceId(profile.workspaceId ?? defaultWorkspaceId ?? '')
      setProviders(toProviderDrafts(profile))
      setErrors({})
      setTouched({})
      setTestingProviderKey('')
      setTestingAgentProviderKey('')
      setProviderTestStates({})
    }
  }, [defaultWorkspaceId, mode, open, profile])

  const validateForm = () => {
    const newErrors: ValidationErrors = {}

    // Validate base info
    const baseResult = baseInfoSchema.safeParse({ name, description, visibility, teamId, workspaceId })
    if (!baseResult.success) {
      for (const issue of baseResult.error.issues) {
        const path = issue.path[0] as string
        if (!newErrors.base) newErrors.base = {}
        newErrors.base[path] = issue.message
      }
    }

    // Validate visibility/team requirement
    if (visibility === 'team' && !teamId) {
      if (!newErrors.base) newErrors.base = {}
      newErrors.base.teamId = t('models.dialog.validation.teamRequired')
    }
    if (visibility === 'workspace' && !workspaceId) {
      if (!newErrors.base) newErrors.base = {}
      newErrors.base.workspaceId = t('models.dialog.validation.workspaceRequired', { defaultValue: '请选择组织' })
    }

    // Validate providers
    providers.forEach((provider, index) => {
      const result = providerSchema.safeParse({
        providerId: provider.providerId,
        baseUrl: provider.baseUrl,
        compatibility: provider.compatibility,
        modelIdsText: provider.modelIdsText,
        apiToken: provider.apiToken,
      })

      if (!result.success) {
        const providerErrors: Record<string, string> = {}
        for (const issue of result.error.issues) {
          const field = issue.path[0] as string
          providerErrors[field] = issue.message
        }
        newErrors[`provider_${index}`] = providerErrors
      }
    })

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const updateProvider = (index: number, patch: Partial<ProviderDraft>) => {
    const targetKey = providers[index]?.key
    const invalidateAvailability = Object.keys(patch).some((key) => key !== 'agentAvailability')
    setProviders((current) => current.map((item, itemIndex) => (itemIndex === index
      ? { ...item, ...patch, ...(invalidateAvailability ? { agentAvailability: {} } : {}) }
      : item)))
    if (targetKey) {
      setProviderTestStates((current) => {
        if (!current[targetKey]) {
          return current
        }

        const next = { ...current }
        delete next[targetKey]
        return next
      })
    }
    // Mark as touched
    setTouched((prev) => ({ ...prev, [`provider_${index}`]: true }))
  }

  const handleTestProvider = async (index: number) => {
    const provider = providers[index]
    if (!provider) {
      return
    }

    const modelIds = normalizeModelIds(provider.modelIdsText)
    if (!provider.providerId.trim()) {
      toast.error(t('models.dialog.validation.providerIdRequired'))
      return
    }
    if (modelIds.length === 0) {
      toast.error(t('models.dialog.validation.modelIdsRequired'))
      return
    }

    const bindingId = findProviderBindingId(provider)
    const useStoredToken = mode === 'edit'
      && provider.hasApiToken
      && !provider.clearApiToken
      && !provider.apiToken.trim()
      && Boolean(bindingId)

    setTestingProviderKey(provider.key)
    try {
      const response = await api.testModelProfile({
        providerId: provider.providerId.trim(),
        baseUrl: provider.baseUrl.trim() || undefined,
        apiToken: provider.apiToken.trim() || undefined,
        bindingId: bindingId || undefined,
        useStoredToken,
        compatibility: provider.compatibility,
        modelIds,
      })
      const message = t('models.dialog.test.success', {
        defaultValue: '检测通过：{{modelId}} · {{latency}}ms',
        modelId: response.testedModelId,
        latency: response.latencyMs,
      })
      setProviderTestStates((current) => ({
        ...current,
        [provider.key]: {
          status: 'success',
          message,
        },
      }))
      toast.success(response.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('models.dialog.test.failed')
      setProviderTestStates((current) => ({
        ...current,
        [provider.key]: {
          status: 'error',
          message,
        },
      }))
      toast.error(message)
    } finally {
      setTestingProviderKey((current) => (current === provider.key ? '' : current))
    }
  }

  const setProviderAgentAvailability = (providerKey: string, patch: AgentAvailabilityMap, expectedSignature?: string) => {
    setProviders((current) => current.map((provider) => (provider.key === providerKey
      && (!expectedSignature || buildProviderAvailabilitySignature(provider) === expectedSignature)
      ? {
          ...provider,
          agentAvailability: {
            ...provider.agentAvailability,
            ...patch,
          },
        }
      : provider)))
  }

  const handleTestAgents = async (index: number) => {
    const provider = providers[index]
    if (!provider) {
      return
    }

    const modelIds = normalizeModelIds(provider.modelIdsText)
    if (!provider.providerId.trim()) {
      toast.error(t('models.dialog.validation.providerIdRequired'))
      return
    }
    if (modelIds.length === 0) {
      toast.error(t('models.dialog.validation.modelIdsRequired'))
      return
    }

    const firstBindingId = findProviderBindingId(provider)
    const providerSignature = buildProviderAvailabilitySignature(provider)
    const useStoredToken = mode === 'edit'
      && provider.hasApiToken
      && !provider.clearApiToken
      && !provider.apiToken.trim()
      && Boolean(firstBindingId)
    const testingState = Object.fromEntries(MODEL_PROFILE_AGENT_TEST_TYPES.map((agentType) => [
      agentType,
      {
        status: 'testing',
        message: t('models.dialog.agentTest.messages.testing', { defaultValue: '正在发送测试请求...' }),
        testedModelId: modelIds[0],
        checkedAt: new Date().toLocaleTimeString(),
      } satisfies AgentAvailabilityState,
    ])) as AgentAvailabilityMap

    setTestingAgentProviderKey(provider.key)
    setProviderAgentAvailability(provider.key, testingState, providerSignature)

    const results = await Promise.all(MODEL_PROFILE_AGENT_TEST_TYPES.map(async (agentType) => {
      const bindingId = provider.bindingIds[agentType]?.[modelIds[0]] || firstBindingId
      const response = await api.testModelProfileAgent({
        agentType,
        providerId: provider.providerId.trim(),
        baseUrl: provider.baseUrl.trim() || undefined,
        apiToken: provider.apiToken.trim() || undefined,
        bindingId: bindingId || undefined,
        useStoredToken,
        modelIds,
      })
      if (response.ok) {
        setProviderAgentAvailability(provider.key, {
          [agentType]: {
            status: 'success',
            message: response.latencyMs
              ? t('models.dialog.agentTest.messages.successWithLatency', { defaultValue: '检测通过 · {{latency}}ms', latency: response.latencyMs })
              : t('models.dialog.agentTest.messages.success', { defaultValue: '检测通过' }),
            testedModelId: response.testedModelId,
            executionModel: response.executionModel,
            latencyMs: response.latencyMs,
            outputPreview: response.outputPreview,
            checkedAt: new Date().toLocaleTimeString(),
          },
        }, providerSignature)
        return { agentType, ok: true as const }
      }
      setProviderAgentAvailability(provider.key, {
        [agentType]: {
          status: 'error',
          message: response.message || `${getRuntimeDescriptor(agentType).label} 检测失败`,
          testedModelId: response.testedModelId || modelIds[0],
          executionModel: response.executionModel,
          latencyMs: response.latencyMs,
          outputPreview: response.outputPreview,
          checkedAt: new Date().toLocaleTimeString(),
        },
      }, providerSignature)
      return { agentType, ok: false as const }
    }))

    const successCount = results.filter((result) => result.ok).length
    if (successCount > 0) {
      toast.success(t('models.dialog.agentTest.messages.completed', {
        defaultValue: 'Coding Agent 检测完成：{{successCount}}/{{totalCount}} 可用',
        successCount,
        totalCount: MODEL_PROFILE_AGENT_TEST_TYPES.length,
      }))
    } else {
      toast.error(t('models.dialog.agentTest.messages.allFailed', { defaultValue: 'Coding Agent 全部检测失败，请检查模型、Key、Base URL 或 worker 状态。' }))
    }
    setTestingAgentProviderKey((current) => (current === provider.key ? '' : current))
  }

  const handleSubmit = async () => {
    // Mark all fields as touched
    setTouched({
      base: true,
      ...Object.fromEntries(providers.map((_, i) => [`provider_${i}`, true])),
    })

    if (!validateForm()) {
      toast.error(t('models.dialog.validation.formInvalid'))
      return
    }

    const bindings = buildExpandedBindings(providers, mode)
    if (bindings.length === 0) {
      toast.error(t('models.dialog.validation.agentRequired', { defaultValue: '请至少检测通过一个 Coding Agent。' }))
      return
    }

    try {
      if (mode === 'create') {
        await onCreate?.({
          name: name.trim(),
          description: description.trim() || undefined,
          bindings,
        })
        return
      }

      if (!profile) {
        return
      }

      await onSave?.(profile.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        visibility,
        teamId: visibility === 'team' ? teamId || undefined : undefined,
        workspaceId: workspaceId || undefined,
        bindings,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('models.dialog.validation.invalidConfig'))
    }
  }

  const getError = (field: string) => {
    if (!touched.base) return undefined
    return errors.base?.[field]
  }

  const getProviderError = (index: number, field: string) => {
    if (!touched[`provider_${index}`]) return undefined
    return errors[`provider_${index}`]?.[field]
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden border-zinc-800 bg-[#09090b] p-0 text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-[640px]">
        <DialogHeader className="px-5 py-3.5">
          <DialogTitle className="text-sm font-semibold text-zinc-100">{mode === 'create' ? t('models.dialog.createTitle') : t('models.dialog.editTitle')}</DialogTitle>
          <DialogDescription className="sr-only">{mode === 'create' ? t('models.dialog.createTitle') : t('models.dialog.editTitle')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#09090b]">
          <div className="space-y-6 p-4 sm:p-5">
            <Section title={t('models.dialog.sections.basicInfo')}>
              <div className="grid gap-3.5">
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <Field label={t('models.dialog.fields.name')} error={getError('name')} required>
                    <Input
                      className="h-8 rounded-lg border-zinc-800 bg-zinc-950 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700"
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value)
                        setTouched((prev) => ({ ...prev, base: true }))
                      }}
                      onBlur={() => setTouched((prev) => ({ ...prev, base: true }))}
                      placeholder={t('models.dialog.placeholders.name')}
                    />
                  </Field>
                  {mode === 'edit' ? (
                    <Field label={t('models.dialog.fields.visibility')}>
                      <NativeSelect className="h-8 rounded-lg border-zinc-800 bg-zinc-950 text-xs text-zinc-100" value={visibility} onChange={(event) => setVisibility(event.target.value as ModelProfile['visibility'])}>
                        {visibilityOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                  ) : null}
                </div>

                {mode === 'edit' ? (
                  <Field
                    label={t('models.dialog.fields.workspace', { defaultValue: '所属组织' })}
                    error={getError('workspaceId')}
                    required={visibility === 'workspace'}
                  >
                    {lockWorkspaceSelection && currentWorkspace ? (
                      <div className="rounded-lg border border-zinc-900 bg-zinc-950 px-3 py-2.5">
                        <div className="text-xs font-medium text-zinc-100">{currentWorkspace.name}</div>
                        <p className="mt-0.5 text-[11px] text-zinc-500">
                          {visibility === 'workspace'
                            ? t('models.dialog.workspaceHints.shared', { defaultValue: '共享后，当前组织成员都能使用这个模型。' })
                            : t('models.dialog.workspaceHints.private', { defaultValue: '模型默认归属当前组织，但先只对你自己可见。' })}
                        </p>
                      </div>
                    ) : (
                      <NativeSelect className="h-8 rounded-lg border-zinc-800 bg-zinc-950 text-xs text-zinc-100" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
                        <option value="">{t('models.dialog.placeholders.selectWorkspace', { defaultValue: '选择组织' })}</option>
                        {workspaces.map((workspace) => (
                          <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                ) : null}

                {visibility === 'team' ? (
                  <Field label={t('models.dialog.fields.team')} error={getError('teamId')} required>
                    <NativeSelect className="h-8 rounded-lg border-zinc-800 bg-zinc-950 text-xs text-zinc-100" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                      <option value="">{t('models.dialog.placeholders.selectTeam')}</option>
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>{team.name}</option>
                      ))}
                    </NativeSelect>
                  </Field>
                ) : null}

                <Field label={t('models.dialog.fields.description')}>
                  <Textarea className="min-h-[64px] rounded-lg border-zinc-800 bg-zinc-950 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('models.dialog.placeholders.description')} />
                </Field>

                {mode === 'edit' ? (
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <Field label={t('models.dialog.fields.source', { defaultValue: '来源' })}>
                      <div className="rounded-lg border border-zinc-900 bg-zinc-950 px-3 py-2.5 text-xs text-zinc-200">
                        {profile?.source === 'worker-import'
                          ? t('models.source.workerImport')
                          : t('models.source.manual')}
                      </div>
                    </Field>
                    {profile?.source === 'worker-import' ? (
                      <Field label={t('models.dialog.fields.importedWorker', { defaultValue: '导入 Worker' })}>
                        <div className="rounded-lg border border-zinc-900 bg-zinc-950 px-3 py-2.5 text-xs text-zinc-200">
                          <span className="break-all">
                            {sourceWorkerName || t('models.dialog.placeholders.unknownWorker', { defaultValue: '未知 Worker' })}
                          </span>
                        </div>
                      </Field>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Section>

            <div className="space-y-4">
              {providers.map((provider, index) => (
                <ProviderEditorCard
                  key={provider.key}
                  canRemove={mode === 'edit' && providers.length > 1}
                  title={isLegacyMultiProvider ? t('models.dialog.providerTitleIndexed', { index: index + 1 }) : t('models.dialog.providerTitle')}
                  provider={provider}
                  showTokenState={mode === 'edit'}
                  errors={{
                    providerId: getProviderError(index, 'providerId'),
                    modelIdsText: getProviderError(index, 'modelIdsText'),
                  }}
                  updateProvider={(patch) => updateProvider(index, patch)}
                  onRemove={() => setProviders((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  providerTestState={providerTestStates[provider.key]}
                  testingProvider={testingProviderKey === provider.key}
                  testingAgents={testingAgentProviderKey === provider.key}
                  onTestProvider={() => void handleTestProvider(index)}
                  onTestAgents={() => void handleTestAgents(index)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-900 bg-[#09090b] px-5 py-3">
          <Button variant="outline" className="h-8 shrink-0 rounded-md border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('models.dialog.actions.cancel')}
          </Button>
          <Button className="h-8 shrink-0 rounded-md px-3 text-xs" disabled={busy} onClick={() => void handleSubmit()}>
            {busy ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                {mode === 'create' ? t('models.dialog.actions.saving') : t('models.dialog.actions.updating')}
              </>
            ) : (
              mode === 'create' ? t('models.dialog.actions.save') : t('models.dialog.actions.saveChanges')
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ModelCreateDialog(props: {
  busy: boolean
  defaultWorkspaceId?: string
  onCreate: (payload: ModelProfileCreatePayload) => Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
  workspaces: CollaborationWorkspace[]
  teams: Team[]
}) {
  return <ModelProfileDialog {...props} mode="create" />
}

export function ModelEditDialog(props: {
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSave: (profileId: string, payload: ModelProfileUpdatePayload) => Promise<void>
  open: boolean
  profile: ModelProfile | null
  workspaces: CollaborationWorkspace[]
  teams: Team[]
  sourceExecutors?: ModelProfileSourceExecutor[]
}) {
  return <ModelProfileDialog {...props} mode="edit" />
}
