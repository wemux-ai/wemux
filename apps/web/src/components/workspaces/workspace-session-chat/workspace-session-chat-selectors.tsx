// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// INPUT: executor/model/agent options and their async selection state
// OUTPUT: compact workspace-session composer selectors
// POS: workspace session chat footer's execution target and model controls

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Loader2, Radio, Search, Sparkles } from 'lucide-react'
import type { ExecutionModelOption, ExecutorRecord, Task } from '@shared/types'
import type { TaskAgentOption } from '../../../lib/agent-runtime-options'
import { agentMeta, cn, formatExecutionModelLabel } from '../../../lib/utils'
import { RuntimeLabel } from '../../runtime/runtime-icons'
import { Button } from '../../ui/button'
import { ExecutorSelect, type ExecutorSelectOption } from '../../ui/executor-select'
import { Input } from '../../ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover'
import { formatExecutorLatency } from '../../../lib/executor-latency'
export interface ExecutorCardItem {
  executor: ExecutorRecord
  runningCount: number
  queuedCount: number
  freeSlots: number
  isOnline: boolean
  isBusy: boolean
  isOutdated: boolean
}

export interface GroupedModelOptionGroup {
  providerId: string
  providerLabel: string
  models: ExecutionModelOption[]
}

interface TaskChatExecutorSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId?: string
  busy?: boolean
  switching?: boolean
  executorCards: ExecutorCardItem[]
  effectiveExecutorId: string
  activeExecutorName?: string
  onSelectExecutor: (executor: ExecutorRecord) => void
  onCreateExecutor: () => void
}

interface TaskChatAgentSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy?: boolean
  isSessionBusy?: boolean
  saving: boolean
  modelSaving: boolean
  selectedAgentType: Task['agentType']
  agentOptions: TaskAgentOption[]
  onSelectAgent: (agentType: Task['agentType']) => void | Promise<void>
}

interface TaskChatModelSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled: boolean
  selectedModel: string
  visibleSelectedModel: string
  defaultModel: string
  hasUnavailableSelectedModel: boolean
  groupedModelOptions: GroupedModelOptionGroup[]
  modelSummary: string
  modelSummaryTitle: string
  modelSummaryHint: string
  modelMeta: string
  onSelectModel: (model: string) => void | Promise<void>
}

export function TaskChatExecutorSelector({
  open,
  onOpenChange,
  workspaceId,
  busy,
  switching = false,
  executorCards,
  effectiveExecutorId,
  activeExecutorName,
  onSelectExecutor,
  onCreateExecutor,
}: TaskChatExecutorSelectorProps) {
  const selectedExecutor = executorCards.find((item) => item.executor.executorId === effectiveExecutorId)
  const selectedLabel = selectedExecutor?.executor.name || activeExecutorName || '节点'
  const selectedStatusTone = selectedExecutor
    ? !selectedExecutor.isOnline
      ? 'offline'
      : selectedExecutor.isOutdated || selectedExecutor.isBusy
        ? 'busy'
        : 'online'
    : undefined
  const executorOptions: ExecutorSelectOption[] = executorCards.map(({ executor, freeSlots, isOnline, isBusy: executorBusy, isOutdated }) => {
    const isStarting = executor.status === 'paired'
    const latencyLabel = isOnline ? formatExecutorLatency(executor.presence?.latency) : ''
    const hasLatency = latencyLabel && latencyLabel !== '-'
    const isManagedCloud = executor.executorSource === 'managed-cloud' || executor.managedBy === 'vibemux'
    return {
      value: executor.executorId,
      label: isManagedCloud ? `${executor.name} · 按需` : executor.name,
      description: !isOnline
        ? isManagedCloud
          ? '使用中自动唤醒'
          : undefined
        : isOutdated
          ? `当前版本 v${executor.version || '-'}，请先升级`
          : isStarting
            ? '启动中'
            : undefined,
      statusTone: !isOnline ? 'offline' : isOutdated || executorBusy ? 'busy' : 'online',
      badgeLabel: !isOnline
        ? isManagedCloud
          ? '休眠'
          : '离线'
        : isOutdated
          ? `需升级`
          : isStarting
            ? '启动中'
            : `空闲 ${freeSlots}${hasLatency ? ` · ${latencyLabel}` : ''}`,
    }
  })

  if (executorCards.length > 0) {
    return (
      <ExecutorSelect
        open={open}
        onOpenChange={onOpenChange}
        disabled={busy}
        loading={switching}
        value={effectiveExecutorId}
        options={executorOptions}
        placeholder="选择节点"
        emptyText="还没有可用节点"
        searchable={false}
        compact
        side="top"
        sideOffset={10}
        triggerClassName={cn(
          'w-full min-w-0 max-w-full justify-between gap-2 px-2 py-1 text-zinc-300 [&_span]:min-w-0',
          workspaceId
            ? 'border-zinc-800/60 bg-zinc-900/30 text-zinc-500 hover:border-zinc-700 hover:bg-zinc-800/60 hover:text-zinc-200'
            : 'border-zinc-800/60 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-zinc-200',
        )}
        contentClassName="w-[min(16rem,calc(100vw-1.5rem))] max-h-[min(20rem,calc(100vh-8rem))]"
        selectedLabelOverride={effectiveExecutorId ? selectedLabel : undefined}
        selectedStatusTone={switching ? 'busy' : selectedStatusTone}
        title={switching ? `正在切换到 ${selectedLabel}` : workspaceId ? '切换工作区 worker' : '选择执行节点'}
        headerAction={(
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCreateExecutor}
            className="h-6 text-[10px] text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
          >
            + 新建
          </Button>
        )}
        onChange={(executorId) => {
          const executor = executorCards.find((item) => item.executor.executorId === executorId)?.executor
          if (executor) {
            onSelectExecutor(executor)
          }
        }}
      />
    )
  }

  if (workspaceId && effectiveExecutorId) {
    return (
      <div
        aria-busy={switching || undefined}
        title={switching ? `正在切换到 ${selectedLabel}` : selectedLabel}
        className="flex min-w-max max-w-none shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-800/60 bg-zinc-900/30 px-2 py-1 text-xs text-zinc-500"
      >
        {switching ? (
          <Loader2 className="h-3 w-3 animate-spin text-sky-400 motion-reduce:animate-none" />
        ) : (
          <Radio className={cn(
            'h-3 w-3',
            selectedStatusTone === 'online'
              ? 'text-emerald-500/70'
              : selectedStatusTone === 'busy'
                ? 'text-amber-400/80'
                : 'text-zinc-500',
          )}
          />
        )}
        <span className="max-w-[11rem] truncate whitespace-nowrap">{selectedLabel}</span>
      </div>
    )
  }

  return null
}

export function TaskChatAgentSelector({
  open,
  onOpenChange,
  saving,
  modelSaving,
  selectedAgentType,
  agentOptions,
  onSelectAgent,
}: TaskChatAgentSelectorProps) {
  const disabled = saving || modelSaving

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={agentMeta[selectedAgentType].label}
          className="flex min-w-max max-w-none shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-800/60 bg-zinc-900/50 px-2 py-1 text-xs text-zinc-400 transition-all hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-zinc-200"
        >
          <RuntimeLabel runtime={selectedAgentType} size={14} labelClassName="max-w-[6rem] text-inherit" />
          <ChevronDown className={cn('h-3 w-3 opacity-60 transition-transform', open && 'rotate-180')} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className="w-52 rounded-lg border-zinc-800/60 bg-[#0f0f11] p-1 text-zinc-100 shadow-xl shadow-black/40"
      >
        <div className="mb-1 flex items-center justify-between px-2">
          <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">执行端</p>
          <span className="text-[9px] text-zinc-500">{saving ? '切换中' : ''}</span>
        </div>
        <div className="space-y-px">
          {agentOptions.map((option) => {
            const isSelected = selectedAgentType === option.value
            const optionDisabled = disabled
            return (
              <button
                key={option.value}
                type="button"
                disabled={optionDisabled}
                onClick={() => {
                  void onSelectAgent(option.value as Task['agentType'])
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors',
                  isSelected
                    ? 'bg-zinc-800/80 text-zinc-50'
                    : 'text-zinc-300 hover:bg-zinc-900/50 hover:text-zinc-100',
                  optionDisabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <RuntimeLabel runtime={option.value as Task['agentType']} size={12} labelClassName="block truncate font-medium" />
                    {option.badgeLabel ? (
                      <span className="shrink-0 rounded-full border border-emerald-500/15 bg-emerald-500/8 px-1.5 py-px text-[9px] font-medium text-emerald-400/80">
                        {option.badgeLabel}
                      </span>
                    ) : null}
                  </span>
                </span>
                {isSelected ? <span className="text-[9px] text-emerald-400/80">当前</span> : null}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function TaskChatModelSelector({
  open,
  onOpenChange,
  disabled,
  selectedModel,
  visibleSelectedModel,
  defaultModel,
  hasUnavailableSelectedModel,
  groupedModelOptions,
  modelSummary,
  modelSummaryTitle,
  modelMeta,
  onSelectModel,
}: TaskChatModelSelectorProps) {
  const modelListRef = useRef<HTMLDivElement | null>(null)
  const providerSectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const activeModelRef = useRef<HTMLButtonElement | null>(null)
  const [modelSearchQuery, setModelSearchQuery] = useState('')

  useEffect(() => {
    if (!open) return

    const scrollActive = () => {
      const el = activeModelRef.current
      if (!el) return
      el.scrollIntoView({ block: 'center' })
    }

    const timer = setTimeout(scrollActive, 150)
    return () => clearTimeout(timer)
  }, [open])
  const normalizedModelSearchQuery = modelSearchQuery.trim().toLowerCase()
  const filteredGroupedModelOptions = useMemo(() => {
    if (!normalizedModelSearchQuery) {
      return groupedModelOptions
    }

    return groupedModelOptions.flatMap((group) => {
      const providerMatches = [group.providerId, group.providerLabel]
        .join(' ')
        .toLowerCase()
        .includes(normalizedModelSearchQuery)
      const models = providerMatches
        ? group.models
        : group.models.filter((model) => {
            const haystack = [
              model.id,
              model.providerId,
              model.modelId,
              group.providerLabel,
              formatExecutionModelLabel(model.id),
            ].join(' ').toLowerCase()
            return haystack.includes(normalizedModelSearchQuery)
          })

      return models.length > 0 ? [{ ...group, models }] : []
    })
  }, [groupedModelOptions, normalizedModelSearchQuery])
  const showDefaultModelOption = !normalizedModelSearchQuery || [
    '默认模型',
    'default model',
    'system default model',
    defaultModel,
  ].join(' ').toLowerCase().includes(normalizedModelSearchQuery)
  const showUnavailableSelectedModel = hasUnavailableSelectedModel
    && (!normalizedModelSearchQuery || selectedModel.toLowerCase().includes(normalizedModelSearchQuery))
  const hasModelSearchResults = showDefaultModelOption || showUnavailableSelectedModel || filteredGroupedModelOptions.length > 0

  const handleScrollToProvider = (providerLabel: string) => {
    const modelListElement = modelListRef.current
    const providerSectionElement = providerSectionRefs.current[providerLabel]

    if (!modelListElement || !providerSectionElement) {
      return
    }

    const top = providerSectionElement.offsetTop - modelListElement.offsetTop - 8
    modelListElement.scrollTo({
      top: Math.max(top, 0),
      behavior: 'smooth',
    })
  }
  const handleModelSelectorOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setModelSearchQuery('')
    }
    onOpenChange(nextOpen)
  }
  const handleSelectModel = (model: string) => {
    setModelSearchQuery('')
    void onSelectModel(model)
  }

  return (
    <Popover open={open} onOpenChange={handleModelSelectorOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={modelSummaryTitle}
          className="flex min-w-0 max-w-[min(26rem,calc(100vw-2rem))] shrink-0 items-center gap-1.5 rounded-lg border border-zinc-800/60 bg-zinc-900/50 px-2 py-1 text-xs text-zinc-400 transition-all hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-zinc-200"
        >
          <Sparkles className="h-3 w-3 text-amber-500/70" />
          <span className="min-w-0 truncate">{modelSummary}</span>
          <ChevronDown className={cn('h-3 w-3 opacity-60 transition-transform', open && 'rotate-180')} />
        </button>
      </PopoverTrigger>
      {open ? (
        <PopoverContent
          side="top"
          align="start"
          sideOffset={10}
          avoidCollisions
          collisionPadding={8}
          className="flex max-h-[min(24rem,var(--radix-popover-content-available-height),calc(100dvh-1rem))] w-[min(18rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-lg border-zinc-800/60 bg-[#0f0f11] p-1.5 text-zinc-100 shadow-xl shadow-black/40"
        >
          <div className="mb-1.5 flex items-center justify-between px-2">
            <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">模型</p>
            <span className="text-[9px] text-zinc-500">{modelMeta}</span>
          </div>
          <div className="mb-1.5 px-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-zinc-600" />
              <Input
                value={modelSearchQuery}
                onChange={(event) => setModelSearchQuery(event.target.value)}
                placeholder="搜索模型"
                className="h-6 border-zinc-800/60 bg-zinc-950 pl-7 text-[11px] text-zinc-100 placeholder:text-zinc-600"
              />
            </div>
          </div>
          {filteredGroupedModelOptions.length > 0 ? (
            <div className="mb-1.5 px-1">
              <p className="mb-1 text-[9px] uppercase tracking-[0.2em] text-zinc-500">提供商</p>
              <div className="flex flex-wrap gap-1">
                {filteredGroupedModelOptions.map((group) => (
                  <button
                    key={group.providerLabel}
                    type="button"
                    onClick={() => handleScrollToProvider(group.providerLabel)}
                    className="rounded-md border border-zinc-800/60 bg-zinc-900/50 px-1.5 py-px text-[9px] text-zinc-400 transition-colors hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-zinc-200"
                  >
                    {group.providerLabel}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div ref={modelListRef} className="min-h-[4rem] flex-1 space-y-2 overflow-y-auto overscroll-contain pr-0.5">
            {showDefaultModelOption ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => handleSelectModel('')}
                className={cn(
                  'flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors',
                  !visibleSelectedModel
                    ? 'bg-zinc-800/80 text-zinc-50'
                    : 'text-zinc-300 hover:bg-zinc-900/50 hover:text-zinc-100',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">默认模型</span>
                  <span className="mt-px block text-[9px] text-zinc-500">{defaultModel || '系统默认'}</span>
                </span>
                {!visibleSelectedModel ? <span className="text-[9px] text-emerald-400/80">当前</span> : null}
              </button>
            ) : null}

            {showUnavailableSelectedModel ? (
              <div className="rounded-md border border-amber-500/15 bg-amber-500/8 px-2 py-1.5 text-[9px] text-amber-400/80">
                `{selectedModel}` 不可用
              </div>
            ) : null}

            {!hasModelSearchResults ? (
              <div className="rounded-md border border-zinc-800/60 bg-zinc-950/70 px-2 py-3 text-center text-[11px] text-zinc-500">
                没有匹配的模型
              </div>
            ) : null}

            {filteredGroupedModelOptions.map((group) => (
              <div
                key={group.providerLabel}
                ref={(node) => {
                  providerSectionRefs.current[group.providerLabel] = node
                }}
                className="space-y-px"
              >
                <p className="px-2 text-[9px] uppercase tracking-[0.2em] text-zinc-500">{group.providerLabel}</p>
                {group.models.map((model) => {
                  const isSelected = visibleSelectedModel === model.id

                  return (
                    <button
                      key={model.id}
                      ref={isSelected ? activeModelRef : undefined}
                      type="button"
                      disabled={disabled}
                      onClick={() => handleSelectModel(model.id)}
                      className={cn(
                        'flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors',
                        isSelected
                          ? 'bg-zinc-800/80 text-zinc-50'
                          : 'text-zinc-300 hover:bg-zinc-900/50 hover:text-zinc-100',
                        disabled && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="block truncate font-medium">{model.modelId}</span>
                          {model.source === 'hosted' ? (
                            <span className="shrink-0 rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-px text-[9px] font-medium text-amber-400/80">
                              官方
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-px block text-[9px] text-zinc-500">{formatExecutionModelLabel(model.id)}</span>
                      </span>
                      <span className="shrink-0 text-[9px] text-zinc-500">
                        {isSelected ? '当前' : model.isDefault ? '默认' : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </PopoverContent>
      ) : null}
    </Popover>
  )
}
