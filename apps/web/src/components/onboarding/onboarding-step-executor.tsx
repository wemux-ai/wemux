import { LoaderCircle, Copy, Server, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { ExecutorRecord } from '@shared/types'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import type { WorkerLocalInstallTarget, WorkerRunMode } from '../../lib/worker-connect-command'
import { Button } from '../ui/button'

export function OnboardingStepExecutor({
  executors,
  loading,
  pairingCode,
  connectCommand,
  pairingExpiresAt,
  pairingRunMode,
  pairingInstallTarget,
  pairingDisplayName,
  pairingBusy,
  onPairingRunModeChange,
  onPairingInstallTargetChange,
  onPairingDisplayNameChange,
  onCreatePairingCode,
  onCopyConnectCommand,
}: {
  executors: ExecutorRecord[]
  loading: boolean
  pairingCode: string
  connectCommand: string
  pairingExpiresAt: string
  pairingRunMode: WorkerRunMode
  pairingInstallTarget: WorkerLocalInstallTarget
  pairingDisplayName: string
  pairingBusy: boolean
  onPairingRunModeChange: (value: WorkerRunMode) => void
  onPairingInstallTargetChange: (value: WorkerLocalInstallTarget) => void
  onPairingDisplayNameChange: (value: string) => void
  onCreatePairingCode: () => void
  onCopyConnectCommand: () => void
}) {
  const { t, language } = useTranslation()
  const readyExecutors = executors.filter((executor) => executor.status === 'online' || executor.status === 'paired')
  const hasReadyExecutor = readyExecutors.length > 0
  const locale = language === 'zh' ? 'zh-CN' : 'en-US'
  const signalState: 'waiting' | 'pairing' | 'connected' = hasReadyExecutor ? 'connected' : (pairingCode ? 'pairing' : 'waiting')
  const selectedConnectTargetLabel = pairingRunMode === 'docker'
    ? (language === 'zh' ? 'Docker 容器' : 'Docker container')
    : pairingInstallTarget === 'windows'
      ? 'Windows PowerShell'
      : 'macOS / Linux Bash'

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <SimpleConnectionDiagram state={signalState} />
      </div>

      {hasReadyExecutor ? (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-300" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-emerald-100">{t('onboarding.executor.readyTitle')}</p>
              <p className="text-sm leading-6 text-emerald-200/80">
                {t('onboarding.executor.readyDescription', { name: readyExecutors[0]?.name || readyExecutors[0]?.machineName || t('onboarding.executor.connectedNode') })}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <Server className="h-4 w-4 text-emerald-300" />
              {t('onboarding.executor.stepsTitle')}
            </div>
            <ol className="mt-4 space-y-3">
              {[
                t('onboarding.executor.steps.step1'),
                t('onboarding.executor.steps.step2'),
                t('onboarding.executor.steps.step3'),
                t('onboarding.executor.steps.step4'),
              ].map((step, index) => (
                <li key={step} className="flex gap-3 text-sm leading-6 text-zinc-400">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-700 text-[11px] text-zinc-500">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 border-t border-zinc-800 pt-4 text-xs leading-5 text-zinc-500">{t('onboarding.executor.consoleFallback')}</p>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-zinc-100">{t('onboarding.executor.connectCommandTitle')}</p>
              {pairingCode ? (
                <span className="rounded border border-zinc-800 bg-[#09090b] px-2 py-1 font-mono text-[11px] text-zinc-500">{pairingCode}</span>
              ) : null}
            </div>

            <div className="mt-3 space-y-2">
              <label className="block text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
                {t('onboarding.executor.displayNameLabel')}
              </label>
              <input
                value={pairingDisplayName}
                onChange={(event) => onPairingDisplayNameChange(event.target.value)}
                placeholder={t('onboarding.executor.displayNamePlaceholder')}
                className="h-10 w-full rounded-lg border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-zinc-700"
              />
              <p className="text-xs leading-5 text-zinc-500">{t('onboarding.executor.displayNameHint')}</p>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-zinc-800 bg-[#09090b] p-1">
              {([
                { value: 'local' as const, label: language === 'zh' ? '本机运行' : 'Local', detail: language === 'zh' ? '系统服务' : 'Service' },
                { value: 'docker' as const, label: language === 'zh' ? 'Docker 容器' : 'Docker', detail: language === 'zh' ? 'Node Linux 容器' : 'Node Linux' },
              ]).map((option) => {
                const active = pairingRunMode === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onPairingRunModeChange(option.value)}
                    className={`rounded-md px-3 py-2 text-left transition ${active ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'}`}
                  >
                    <span className="block text-xs font-medium">{option.label}</span>
                    <span className={`mt-1 block text-[11px] ${active ? 'text-zinc-600' : 'text-zinc-500'}`}>{option.detail}</span>
                    </button>
                  )
                })}
            </div>
            {pairingRunMode === 'local' ? (
              <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-zinc-800 bg-[#09090b] p-1">
                {([
                  { value: 'unix' as const, label: language === 'zh' ? 'macOS / Linux' : 'macOS / Linux', detail: language === 'zh' ? 'Bash 安装脚本' : 'Bash installer' },
                  { value: 'windows' as const, label: 'Windows', detail: language === 'zh' ? 'PowerShell 安装脚本' : 'PowerShell installer' },
                ]).map((option) => {
                  const active = pairingInstallTarget === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onPairingInstallTargetChange(option.value)}
                      className={`rounded-md px-3 py-2 text-left transition ${active ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'}`}
                    >
                      <span className="block text-xs font-medium">{option.label}</span>
                      <span className={`mt-1 block text-[11px] ${active ? 'text-zinc-600' : 'text-zinc-500'}`}>{option.detail}</span>
                    </button>
                  )
                })}
              </div>
            ) : null}
            {pairingRunMode === 'local' && pairingInstallTarget === 'windows' ? (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                <p className="text-[11px] leading-5 text-amber-200/80">
                  {language === 'zh'
                    ? '当前版本在 Windows 原生环境下兼容性较差，建议使用 WSL (Windows Subsystem for Linux) 环境安装，或选择 macOS / Linux 目标。'
                    : 'The current version has limited compatibility with native Windows. We recommend installing in WSL (Windows Subsystem for Linux), or selecting the macOS / Linux target.'}
                </p>
              </div>
            ) : null}

            <div className="mt-3 inline-flex rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              {(language === 'zh' ? '当前目标' : 'Selected target')}: {selectedConnectTargetLabel}
            </div>
            <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-zinc-800 bg-[#09090b] p-3 font-mono text-xs leading-6 text-zinc-100">
              <code>{connectCommand || t('onboarding.executor.connectCommandEmpty')}</code>
            </pre>

            <div className="mt-3 space-y-2 text-xs text-zinc-500">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  {pairingExpiresAt
                    ? t('onboarding.executor.expiresAt', { time: new Date(pairingExpiresAt).toLocaleString(locale) })
                    : t('onboarding.executor.autoCopyHint')}
                </span>
                {pairingRunMode === 'docker' ? (
                  <span>
                    {language === 'zh'
                      ? 'Docker 隔离运行'
                      : 'Runs in Docker'}
                  </span>
                ) : null}
              </div>
              <p>{t('onboarding.executor.restartHint')}</p>
            </div>

            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                className="flex-1 bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                onClick={onCreatePairingCode}
                disabled={pairingBusy}
              >
                {pairingBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                {t('onboarding.executor.generatePairingCode')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                onClick={onCopyConnectCommand}
                disabled={!connectCommand}
              >
                <Copy className="h-4 w-4" />
                <span className="sr-only">{t('onboarding.executor.copyConnectCommand')}</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SimpleConnectionDiagram({
  state,
}: {
  state: 'waiting' | 'pairing' | 'connected'
}) {
  const connected = state === 'connected'
  const pairing = state === 'pairing'
  const statusText = connected ? '已连接' : pairing ? '等待接入' : '未连接'

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-zinc-100">节点连接状态</div>
          <div className="mt-1 text-xs text-zinc-500">节点在线后才可以继续</div>
        </div>
        <div
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs',
            connected && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
            pairing && 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
            !connected && !pairing && 'border-zinc-800 bg-zinc-900 text-zinc-400',
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-emerald-400' : pairing ? 'bg-cyan-300 animate-pulse' : 'bg-zinc-500')} />
          {statusText}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] lg:items-center">
        <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-[#09090b] px-4 py-5 lg:col-span-2">
          <div className="grid gap-3 lg:grid-cols-[11rem_minmax(0,1fr)_11rem] lg:gap-0 lg:items-center">
            <EndpointBox
              title="Worker Node"
              status={connected ? 'online' : pairing ? 'pending' : 'offline'}
              active={connected || pairing}
            />

            <div className="relative h-12">
              <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-zinc-800" />
              <div
                className={cn(
                  'absolute left-0 top-1/2 h-px -translate-y-1/2 transition-all duration-500',
                  connected ? 'w-full bg-emerald-400' : pairing ? 'w-2/3 bg-cyan-300/90' : 'w-0 bg-zinc-700',
                )}
              />
              {!connected ? (
                <span
                  className={cn(
                    'absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full ring-4 ring-[#09090b]',
                    pairing ? 'left-[66%] bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,0.45)]' : 'left-0 bg-zinc-500 animate-[executor-travel_2.6s_ease-in-out_infinite]',
                  )}
                />
              ) : (
                <span className="absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(74,222,128,0.5)] ring-4 ring-[#09090b]" />
              )}
            </div>

            <CloudBox connected={connected} pairing={pairing} />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes executor-travel {
          0% { left: 0%; opacity: 0.35; }
          50% { opacity: 1; }
          100% { left: calc(100% - 10px); opacity: 0.35; }
        }
      `}</style>
    </div>
  )
}

function EndpointBox({
  title,
  status,
  active,
}: {
  title: string
  status: string
  active: boolean
}) {
  return (
    <div className="w-full rounded-lg border border-zinc-800 bg-[#09090b] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-100">{title}</span>
        <span className={cn('h-2 w-2 rounded-full', active ? 'bg-emerald-400' : 'bg-zinc-600')} />
      </div>
      <div className="mt-1 text-xs text-zinc-500">{status}</div>
    </div>
  )
}

function CloudBox({
  connected,
  pairing,
}: {
  connected: boolean
  pairing: boolean
}) {
  return (
    <div className="w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-100">Hosted Cloud</span>
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
      </div>
      <div className="mt-1 text-xs text-zinc-500">
        {connected ? 'linked' : pairing ? 'ready' : 'ready'}
      </div>
    </div>
  )
}
