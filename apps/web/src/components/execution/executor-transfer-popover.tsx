import { useState } from 'react'
import { ArrowRightLeft, Check, Folder, Loader2 } from 'lucide-react'
import type { ExecutorRecord } from '@shared/types'
import type { CollaborationWorkspace } from '../../lib/api'
import { api } from '../../lib/api'
import { formatExecutorLatency } from '../../lib/executor-latency'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { toast } from 'sonner'

interface ExecutorTransferPopoverProps {
  executor: ExecutorRecord
  executorWorkspaces: CollaborationWorkspace[]
  executors: ExecutorRecord[]
  disabled?: boolean
  onTransferred: () => void
}

const getStatusTone = (executor: ExecutorRecord) => {
  if (executor.status !== 'online') return 'offline'
  return 'online'
}

const toneDotClassName: Record<string, string> = {
  online: 'bg-emerald-400',
  offline: 'bg-zinc-600',
}

const toneBadgeClassName: Record<string, string> = {
  online: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  offline: 'border-zinc-700 bg-zinc-800 text-zinc-400',
}

export function ExecutorTransferPopover({
  executor,
  executorWorkspaces,
  executors,
  disabled,
  onTransferred,
}: ExecutorTransferPopoverProps) {
  const { language, t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [selectedTargetId, setSelectedTargetId] = useState('')
  const [busy, setBusy] = useState(false)

  const currentName = executor.name || executor.machineName || executor.executorId

  const availableTargets = executors.filter(
    (e) => e.executorId !== executor.executorId && e.status === 'online',
  )

  const selectedTarget = executors.find((e) => e.executorId === selectedTargetId)

  const handleTransfer = async () => {
    if (!selectedTargetId || busy) return

    setBusy(true)
    try {
      const response = await api.transferExecutorSessions(executor.executorId, {
        targetExecutorNodeId: selectedTargetId,
      })
      toast.success(response.message)
      setOpen(false)
      setSelectedTargetId('')
      onTransferred()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('execution.transfer.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setSelectedTargetId('')
        }
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={t('execution.transfer.tooltip')}
          className="flex h-7 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950/80 px-2 text-xs text-zinc-200 transition-colors hover:bg-zinc-900 hover:text-zinc-50 disabled:pointer-events-none disabled:opacity-50"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t('execution.transfer.title')}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        className="w-[min(24rem,calc(100vw-1.5rem))] max-h-[min(28rem,calc(100vh-8rem))] flex flex-col overflow-hidden rounded-lg border-zinc-800/80 bg-[#0f0f11] p-0 text-zinc-100 shadow-2xl shadow-black/50"
      >
        {/* Header */}
        <div className="border-b border-zinc-800/80 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <ArrowRightLeft className="h-3 w-3 text-zinc-600" />
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-zinc-500">
              {t('execution.transfer.title')}
            </p>
          </div>
        </div>

        {/* Current executor + workspace list */}
        <div className="border-b border-zinc-800/80 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-zinc-600">{t('execution.transfer.sourceNode')}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className={cn('h-1.5 w-1.5 rounded-full', toneDotClassName[getStatusTone(executor)])} />
            <span className="text-xs font-medium text-zinc-200">{currentName}</span>
          </div>
          {executorWorkspaces.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {executorWorkspaces.map((ws) => (
                <span key={ws.id} className="inline-flex items-center gap-1 rounded-md border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300">
                  <Folder className="h-2.5 w-2.5" />
                  {ws.name}
                </span>
              ))}
            </div>
          ) : null}
          <p className="mt-1.5 text-[10px] text-zinc-500">
            {language === 'zh'
              ? `${executorWorkspaces.length} 个工作区会话将被转接`
              : `${executorWorkspaces.length} workspace session(s) will be transferred`}
          </p>
        </div>

        {/* Target executor list */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
          <p className="px-2.5 pb-1 text-[10px] uppercase tracking-wider text-zinc-600">{t('execution.transfer.selectTarget')}</p>
          {availableTargets.length === 0 ? (
            <div className="px-2.5 py-4 text-center text-xs text-zinc-500">
              {t('execution.transfer.noTargets')}
            </div>
          ) : (
            <div className="space-y-0.5">
              {availableTargets.map((target) => {
                const isSelected = selectedTargetId === target.executorId
                const latency = formatExecutorLatency(target.presence?.latency)
                const hasLatency = latency && latency !== '-'
                const tone = getStatusTone(target)

                return (
                  <button
                    key={target.executorId}
                    type="button"
                    disabled={busy}
                    onClick={() => setSelectedTargetId(target.executorId)}
                    className={cn(
                      'group flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-all duration-150',
                      isSelected
                        ? 'bg-zinc-800/90 text-zinc-50 shadow-sm shadow-black/20'
                        : 'text-zinc-300 hover:bg-zinc-900/60 hover:text-zinc-100',
                      busy && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', toneDotClassName[tone])} />
                      <span className="min-w-0 flex-1 overflow-hidden">
                        <span className="block truncate text-xs font-medium leading-tight">
                          {target.name || target.machineName}
                        </span>
                        {hasLatency ? (
                          <span className="mt-0.5 block text-[11px] leading-tight text-zinc-500">
                            {t('execution.transfer.nodeLatency', { latency })}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {isSelected ? (
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/10">
                          <Check className="h-3 w-3 text-emerald-400" />
                        </span>
                      ) : null}
                      <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px] font-medium', toneBadgeClassName[tone])}>
                        {hasLatency ? latency : t('execution.transfer.online')}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {availableTargets.length > 0 ? (
          <div className="border-t border-zinc-800/80 px-3 py-2">
            <p className="mb-2 text-[11px] leading-relaxed text-zinc-500">
              {t('execution.transfer.description')}
            </p>
            <Button
              type="button"
              size="sm"
              disabled={!selectedTargetId || busy}
              onClick={handleTransfer}
              className="w-full h-7 text-xs"
            >
              {busy ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t('execution.transfer.transferring')}
                </>
              ) : (
                <>
                  <ArrowRightLeft className="h-3 w-3" />
                  {t('execution.transfer.confirm')}
                </>
              )}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
