import type { ReactNode } from 'react'
import { Bot, Check, LoaderCircle, Plus, Server } from 'lucide-react'
import type { ExecutionModelOption, Task } from '@shared/types'
import { findProviderTemplate } from '../models/provider-templates'
import { BrandIcon, RuntimeIcon } from '../runtime/runtime-icons'
import { cn, formatExecutionModelLabel } from '../../lib/utils'
import { Button } from '../ui/button'

type RuntimeAgentType = Task['agentType']
type RuntimeSetupMode = 'node' | 'manual'
type RuntimeAgentDetectionStatus = 'ready' | 'needs-model' | 'missing'
type RuntimeAgentDetection = {
  value: RuntimeAgentType
  label: string
  description: string
  status: RuntimeAgentDetectionStatus
  modelCount: number
  defaultModel: string
  models: ExecutionModelOption[]
  reason: string
}
type ManualRuntimeModelDraft = {
  providerId: string
  modelId: string
  baseUrl: string
  apiToken: string
}

export function OnboardingStepRuntime({
  mode,
  onModeChange,
  agentOptions,
  detectedExecutorName,
  detectionLoading,
  discoveryMessage,
  selectedAgentType,
  onSelectAgentType,
  modelOptions,
  selectedModel,
  defaultModel,
  onSelectModel,
  manualModelDraft,
  onManualModelDraftChange,
  modelLoading,
  saving,
}: {
  mode: RuntimeSetupMode
  onModeChange: (mode: RuntimeSetupMode) => void
  agentOptions: RuntimeAgentDetection[]
  detectedExecutorName?: string
  detectionLoading: boolean
  discoveryMessage: string
  selectedAgentType: RuntimeAgentType
  onSelectAgentType: (agentType: RuntimeAgentType) => void
  modelOptions: ExecutionModelOption[]
  selectedModel: string
  defaultModel: string
  onSelectModel: (model: string) => void
  manualModelDraft: ManualRuntimeModelDraft
  onManualModelDraftChange: (draft: ManualRuntimeModelDraft) => void
  modelLoading: boolean
  saving: boolean
}) {
  const selectedAgent = agentOptions.find((option) => option.value === selectedAgentType) ?? agentOptions[0] ?? null
  const matchedProviderTemplate = findProviderTemplate(manualModelDraft.providerId, manualModelDraft.baseUrl)
  const providerIconId = resolveProviderIconId(manualModelDraft.providerId, manualModelDraft.baseUrl)

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-zinc-50">先确认 coding agent 和模型</h2>
        <p className="text-sm leading-6 text-zinc-400">
          这一步可以直接从节点读取本机配置，也可以手动补一个模型进系统。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onModeChange('node')}
          className={cn(
            'rounded-lg border px-4 py-4 text-left transition',
            mode === 'node'
              ? 'border-emerald-500/30 bg-emerald-500/10'
              : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-[#09090b] text-zinc-200">
                <Server className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-100">从节点获取</div>
                <div className="mt-1 text-xs text-zinc-500">
                  {detectedExecutorName ? `检查 ${detectedExecutorName} 上已有的 agent 和模型` : '节点连上后自动检查本机状态'}
                </div>
              </div>
            </div>
            {mode === 'node' ? <Check className="h-4 w-4 text-emerald-300" /> : null}
          </div>
        </button>

        <button
          type="button"
          onClick={() => onModeChange('manual')}
          className={cn(
            'rounded-lg border px-4 py-4 text-left transition',
            mode === 'manual'
              ? 'border-emerald-500/30 bg-emerald-500/10'
              : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-[#09090b] text-zinc-200">
                <Plus className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-100">手动添加模型</div>
                <div className="mt-1 text-xs text-zinc-500">
                  节点上没有现成配置时，直接补一个模型进系统模型库
                </div>
              </div>
            </div>
            {mode === 'manual' ? <Check className="h-4 w-4 text-emerald-300" /> : null}
          </div>
        </button>
      </div>

      {mode === 'node' ? (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-zinc-100">节点探测结果</div>
              {detectionLoading ? <LoaderCircle className="h-4 w-4 animate-spin text-zinc-500" /> : null}
            </div>
            <div className="mt-3 space-y-2">
              {agentOptions.map((option) => {
                const active = selectedAgentType === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onSelectAgentType(option.value)}
                    className={cn(
                      'w-full rounded-lg border px-3 py-3 text-left transition',
                      active
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-zinc-50'
                        : 'border-zinc-800 bg-[#09090b] text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <RuntimeIcon runtime={option.value} size={16} />
                        <span className="text-sm font-medium">{option.label}</span>
                      </div>
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10px]',
                        option.status === 'ready' && 'bg-emerald-500/15 text-emerald-200',
                        option.status === 'needs-model' && 'bg-amber-500/15 text-amber-200',
                        option.status === 'missing' && 'bg-zinc-800 text-zinc-500',
                      )}
                      >
                        {option.status === 'ready' ? '可用' : option.status === 'needs-model' ? '待补模型' : '未检测到'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{option.reason}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-zinc-100">模型</div>
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin text-zinc-500" /> : null}
            </div>

            <div className="mt-3 rounded-lg border border-zinc-800 bg-[#09090b] p-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950">
                  {selectedAgent ? <RuntimeIcon runtime={selectedAgent.value} size={18} /> : <Bot className="h-4 w-4 text-zinc-200" />}
                </div>
                <div className="min-w-0">
                  <div className="text-sm text-zinc-100">
                    {selectedModel ? formatExecutionModelLabel(selectedModel) : (defaultModel ? formatExecutionModelLabel(defaultModel) : '未检测到默认模型')}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    当前 agent：{selectedAgent?.label || selectedAgentType}
                  </div>
                </div>
              </div>
            </div>

            {discoveryMessage ? (
              <p className="mt-3 text-xs leading-5 text-zinc-500">{discoveryMessage}</p>
            ) : null}

            {selectedAgent?.status === 'missing' ? (
              <div className="mt-3 rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-3 text-sm text-zinc-400">
                这台机器上还没有可直接使用的 {selectedAgent?.label}。可以切到“手动添加模型”，或者先去节点本机完成安装 / 登录。
              </div>
            ) : selectedAgent?.status === 'needs-model' ? (
              <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
                已检测到 {selectedAgent?.label}，但还没有可直接使用的模型。你可以先补本机配置，或者切到“手动添加模型”。
              </div>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant={!selectedModel ? 'default' : 'outline'}
                  className={!selectedModel
                    ? 'justify-start bg-zinc-100 text-zinc-950 hover:bg-zinc-200'
                    : 'justify-start border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50'}
                  onClick={() => onSelectModel('')}
                >
                  默认模型
                </Button>
                {modelOptions.slice(0, 6).map((option) => {
                  const active = selectedModel === option.id
                  return (
                    <Button
                      key={option.id}
                      type="button"
                      variant={active ? 'default' : 'outline'}
                      className={active
                        ? 'justify-start bg-zinc-100 text-zinc-950 hover:bg-zinc-200'
                        : 'justify-start border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50'}
                      onClick={() => onSelectModel(option.id)}
                      disabled={modelLoading}
                    >
                      {formatExecutionModelLabel(option.id)}
                    </Button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <div className="mb-4 rounded-lg border border-zinc-800 bg-[#09090b] p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950">
                {providerIconId ? <BrandIcon id={providerIconId} size={20} /> : <Bot className="h-4 w-4 text-zinc-300" />}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-100">
                  {manualModelDraft.providerId.trim() && manualModelDraft.modelId.trim()
                    ? `${manualModelDraft.providerId.trim()}/${manualModelDraft.modelId.trim()}`
                    : '系统模型库'}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {matchedProviderTemplate
                    ? `${matchedProviderTemplate.label} · 加入后所有 coding agent 都能选`
                    : '添加后会进入系统模型库，所有 coding agent 都能使用'}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider">
              <input
                value={manualModelDraft.providerId}
                onChange={(event) => onManualModelDraftChange({ ...manualModelDraft, providerId: event.target.value })}
                className="h-10 w-full rounded-lg border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-zinc-700"
                placeholder="openai"
              />
            </Field>
            <Field label="Model ID">
              <input
                value={manualModelDraft.modelId}
                onChange={(event) => onManualModelDraftChange({ ...manualModelDraft, modelId: event.target.value })}
                className="h-10 w-full rounded-lg border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-zinc-700"
                placeholder="gpt-5"
              />
            </Field>
            <Field label="Base URL">
              <input
                value={manualModelDraft.baseUrl}
                onChange={(event) => onManualModelDraftChange({ ...manualModelDraft, baseUrl: event.target.value })}
                className="h-10 w-full rounded-lg border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-zinc-700"
                placeholder="https://api.openai.com/v1"
              />
            </Field>
          </div>

          <Field label="API Token" className="mt-4">
            <input
              type="password"
              value={manualModelDraft.apiToken}
              onChange={(event) => onManualModelDraftChange({ ...manualModelDraft, apiToken: event.target.value })}
              className="h-10 w-full rounded-lg border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-zinc-700"
              placeholder="可选"
            />
          </Field>

          <p className="mt-3 text-xs leading-5 text-zinc-500">
            保存后会把这个模型写入系统模型库，并同步给所有 coding agent 使用。
          </p>
        </div>
      )}
    </div>
  )
}

function resolveProviderIconId(providerId?: string, baseUrl?: string) {
  const matchedTemplate = findProviderTemplate(providerId, baseUrl) ?? findProviderTemplate(providerId)
  if (!matchedTemplate) {
    return null
  }

  if (matchedTemplate.providerId === 'anthropic') return 'claude'
  if (matchedTemplate.providerId === 'openai') return 'openai'
  if (matchedTemplate.providerId === 'pi') return 'pi'
  return 'opencode'
}

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="text-xs font-medium text-zinc-500">{label}</div>
      {children}
    </div>
  )
}
