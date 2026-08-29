import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, Cloud, Copy, Cpu, Eye, Folder, LogOut, MoreHorizontal, Pencil, ShieldAlert, TerminalSquare, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Checkbox } from '../ui/checkbox'
import type { DistributedTask, ExecutorLatencySnapshot, ExecutorRecord, ProjectBinding } from '@shared/types'
import { useAppDialog } from '../ui/app-dialog-provider'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { SearchableSelect } from '../ui/searchable-select'
import { Textarea } from '../ui/textarea'
import { resolveApiUrl, type CollaborationWorkspace, type ManagedCloudUsageResponse } from '../../lib/api'
import { formatExecutorLatency, resolveExecutorLatencyTone } from '../../lib/executor-latency'
import { useTranslation } from '../../lib/i18n/react'
import { CURRENT_APP_VERSION, isNodeVersionOutdated } from '../../lib/node-version'
import type { WorkerLocalInstallTarget, WorkerRunMode } from '../../lib/worker-connect-command'
import {
  getExecutorNetworkTypeBadgeClassName,
  getExecutorNetworkTypeDescription,
  getExecutorNetworkTypeLabel,
  resolveExecutorNetworkType,
  type ExecutorNetworkType,
} from './executor-network-type'
import { ExecutionExecutorTerminalDialog } from './execution-executor-terminal-dialog'
import { ExecutorDetailDialog } from './execution-executor-detail-dialog'
import { ExecutorTransferPopover } from './executor-transfer-popover'
import { ConnectionPill } from './execution-shared'
import { getExecutorMeshDisplayState, getExecutorMeshStatusBadgeClassName } from './executor-mesh-display'
import { getMeshRemediation } from './mesh-remediation'
import { formatDate } from '../../lib/utils'

const tr = (language: string, zh: string, en: string) => language === 'zh' ? zh : en
const panelClassName = 'rounded-xl border border-zinc-800/80 bg-zinc-950/60 shadow-sm shadow-black/20'
const executorTableBadgeClassName = 'whitespace-nowrap'
const latencyToneClassName = {
  fast: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  medium: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
  slow: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
  unknown: 'border-zinc-700 bg-zinc-900/70 text-zinc-500',
}

const isManagedCloudExecutorRecord = (executor: Pick<ExecutorRecord, 'executorSource' | 'managedBy'>) => (
  executor.executorSource === 'managed-cloud' || executor.managedBy === 'vibemux'
)

const isDockerWorkerRoot = (workspaceRoot?: string) => (
  workspaceRoot?.trim().replace(/\/+$/, '') === '/data/vibemux-worker'
)

const getExecutorRunMode = (executor: Pick<ExecutorRecord, 'labels'> & { workspaceRoot?: string }): WorkerRunMode => {
  if (executor.labels.some((label) => /^runtime:(docker|container)$/i.test(label.trim()))) {
    return 'docker'
  }

  return isDockerWorkerRoot(executor.workspaceRoot) ? 'docker' : 'local'
}

const getExecutorRunModeLabel = (executor: Pick<ExecutorRecord, 'labels'> & { workspaceRoot?: string }, language: string) => (
  getExecutorRunMode(executor) === 'docker'
    ? tr(language, 'Docker', 'Docker')
    : tr(language, '本机', 'Local')
)

const getExecutorPublicIp = (executor: Pick<ExecutorRecord, 'previewIngressDetectedPublicIp' | 'previewIngressBaseUrl'>) => {
  const detectedPublicIp = executor.previewIngressDetectedPublicIp?.trim() || ''
  if (detectedPublicIp) {
    return detectedPublicIp
  }

  const previewIngressBaseUrl = executor.previewIngressBaseUrl?.trim() || ''
  if (!previewIngressBaseUrl) {
    return ''
  }

  try {
    return new URL(previewIngressBaseUrl).hostname
  } catch {
    return ''
  }
}

const getExecutorRegionLabel = (executor: Pick<ExecutorRecord, 'labels' | 'platform' | 'machineName'>) => {
  const labels = executor.labels.filter((label) => /region|zone|edge|location|country/i.test(label))
  if (labels[0]) {
    return labels[0].replace(/^(region|zone|edge|location|country)[:=_-]/i, '')
  }

  return executor.platform || executor.machineName || ''
}

const getPreviewExposureModeFromNetworkType = (networkType: ExecutorNetworkType): 'private' | 'public-ingress' => (
  networkType === 'public' ? 'public-ingress' : 'private'
)

const getExecutorPreviewAccessLabel = (
  executor: Pick<ExecutorRecord, 'previewExposureMode' | 'previewIngressReachable'>,
  language: string,
) => {
  if (executor.previewExposureMode === 'public-ingress') {
    return executor.previewIngressReachable
      ? tr(language, '公网预览可达', 'Public Preview Ready')
      : tr(language, '公网预览待检查', 'Public Preview Pending')
  }
  return tr(language, '私有预览链路', 'Private Preview Tunnel')
}

const getExecutorPreviewAccessBadgeClassName = (
  executor: Pick<ExecutorRecord, 'previewExposureMode' | 'previewIngressReachable'>,
) => {
  if (executor.previewExposureMode === 'public-ingress') {
    return executor.previewIngressReachable
      ? `border-sky-300/50 bg-sky-500/20 text-white ${executorTableBadgeClassName}`
      : `border-amber-300/50 bg-amber-500/20 text-amber-50 ${executorTableBadgeClassName}`
  }
  return `border-zinc-500/70 bg-zinc-900/80 text-zinc-50 ${executorTableBadgeClassName}`
}

const getExecutorMeshIp = (executor: Pick<ExecutorRecord, 'presence'>) => (
  executor.presence?.mesh?.meshIpv4?.trim() || ''
)

const getExecutorStatusDotClassName = (status: ExecutorRecord['status']) => {
  if (status === 'online') return 'bg-emerald-400'
  if (status === 'paired' || status === 'pairing') return 'bg-amber-400'
  if (status === 'disabled') return 'bg-rose-400'
  return 'bg-zinc-500'
}

type ExecutorMeshNode = {
  executor: ExecutorRecord
  x: number
  y: number
  running: number
  queued: number
}

type ExecutorMeshPath = {
  executorId: string
  d: string
}

function getExecutorMeshNodes(executors: ExecutorRecord[]): ExecutorMeshNode[] {
  const count = executors.length
  if (count === 0) {
    return []
  }

  const getLaneY = (laneCount: number, laneIndex: number) => {
    if (laneCount <= 1) {
      return 50
    }

    const top = laneCount >= 5 ? 16 : laneCount >= 3 ? 24 : 34
    const bottom = laneCount >= 5 ? 84 : laneCount >= 3 ? 76 : 66
    return top + ((bottom - top) * laneIndex) / (laneCount - 1)
  }

  const buildNode = (executor: ExecutorRecord, x: number, y: number): ExecutorMeshNode => ({
    executor,
    x,
    y,
    running: executor.presence?.runningTaskIds.length ?? 0,
    queued: executor.presence?.queuedTaskIds.length ?? 0,
  })

  if (count === 1) {
    return [buildNode(executors[0], 74, 50)]
  }

  const leftCount = Math.ceil(count / 2)
  const rightCount = count - leftCount

  return executors.map((executor, index) => {
    const isLeft = index < leftCount
    const sideIndex = isLeft ? index : index - leftCount
    const sideCount = isLeft ? leftCount : rightCount
    const x = isLeft ? 22 : 78
    const y = getLaneY(sideCount, sideIndex)
    return buildNode(executor, x, y)
  })
}

function getExecutorMeshTone(executor: ExecutorRecord) {
  if (executor.status === 'online') {
    return {
      dot: 'bg-emerald-400',
      line: 'rgba(16,185,129,0.72)',
      lineSoft: 'rgba(16,185,129,0.18)',
      particle: 'rgba(187,247,208,0.96)',
      card: 'border-emerald-400/25 bg-zinc-950/90 shadow-emerald-950/20',
      badge: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
      labelZh: '在线',
      labelEn: 'Online',
    }
  }

  if (executor.status === 'paired' || executor.status === 'pairing') {
    return {
      dot: 'bg-amber-400',
      line: 'rgba(245,158,11,0.6)',
      lineSoft: 'rgba(245,158,11,0.15)',
      particle: 'rgba(253,230,138,0.92)',
      card: 'border-amber-400/25 bg-zinc-950/90 shadow-amber-950/20',
      badge: 'border-amber-500/25 bg-amber-500/10 text-amber-200',
      labelZh: executor.status === 'pairing' ? '配对中' : '已配对',
      labelEn: executor.status === 'pairing' ? 'Pairing' : 'Paired',
    }
  }

  return {
    dot: 'bg-zinc-500',
    line: 'rgba(161,161,170,0.5)',
    lineSoft: 'rgba(113,113,122,0.2)',
    particle: 'rgba(161,161,170,0.72)',
    card: 'border-zinc-800 bg-zinc-950/85 shadow-zinc-950/20',
    badge: 'border-zinc-800 bg-zinc-900/80 text-zinc-400',
    labelZh: executor.status === 'disabled' ? '禁用' : '离线',
    labelEn: executor.status === 'disabled' ? 'Disabled' : 'Offline',
  }
}

function getExecutorMeshNodeAnimation(executor: ExecutorRecord) {
  if (executor.status === 'online') {
    return {
      dot: 'animate-pulse',
      line: 'executor-mesh-dash 4s linear infinite',
      flowDuration: '3.2s',
    }
  }

  if (executor.status === 'paired' || executor.status === 'pairing') {
    return {
      dot: executor.status === 'pairing' ? 'animate-pulse' : '',
      line: 'executor-mesh-dash 7s linear infinite',
      flowDuration: executor.status === 'pairing' ? '4.2s' : '6.8s',
    }
  }

  return {
    dot: '',
    line: '',
    flowDuration: '',
  }
}

function getExecutorMeshLocation(executor: ExecutorRecord) {
  if (getExecutorRunMode(executor) === 'docker') {
    return executor.platform || executor.machineName || 'worker'
  }

  return getExecutorRegionLabel(executor) || 'worker'
}

function ExecutorMeshPanel({
  executors,
  selectedExecutorId,
  language,
  onSelectExecutor,
}: {
  executors: ExecutorRecord[]
  selectedExecutorId: string
  language: string
  onSelectExecutor: (executorId: string) => void
}) {
  const meshNodes = useMemo(() => getExecutorMeshNodes(executors.slice(0, 12)), [executors])
  const onlineCount = executors.filter((executor) => executor.status === 'online').length
  const pairedCount = executors.filter((executor) => executor.status === 'paired' || executor.status === 'pairing').length
  const offlineCount = executors.length - onlineCount - pairedCount
  const hiddenCount = Math.max(0, executors.length - meshNodes.length)
  const totalRunning = executors.reduce((sum, executor) => sum + (executor.presence?.runningTaskIds.length ?? 0), 0)
  const totalQueued = executors.reduce((sum, executor) => sum + (executor.presence?.queuedTaskIds.length ?? 0), 0)
  const readyMeshCount = executors.filter((executor) => executor.presence?.mesh?.status === 'ready').length
  const meshCanvasRef = useRef<HTMLDivElement | null>(null)
  const cloudCardRef = useRef<HTMLDivElement | null>(null)
  const nodeCardRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [meshCanvasSize, setMeshCanvasSize] = useState({ width: 100, height: 100 })
  const [meshPaths, setMeshPaths] = useState<ExecutorMeshPath[]>([])

  const updateMeshPaths = useCallback(() => {
    const canvas = meshCanvasRef.current
    const cloudCard = cloudCardRef.current
    if (!canvas || !cloudCard) {
      setMeshPaths([])
      return
    }

    const canvasRect = canvas.getBoundingClientRect()
    const cloudRect = cloudCard.getBoundingClientRect()
    const nextPaths = meshNodes.flatMap((node) => {
      const nodeCard = nodeCardRefs.current[node.executor.executorId]
      if (!nodeCard) {
        return []
      }

      const nodeRect = nodeCard.getBoundingClientRect()
      const isLeft = nodeRect.left + nodeRect.width / 2 < cloudRect.left + cloudRect.width / 2
      const startX = (isLeft ? nodeRect.right : nodeRect.left) - canvasRect.left
      const startY = nodeRect.top + nodeRect.height / 2 - canvasRect.top
      const endX = (isLeft ? cloudRect.left : cloudRect.right) - canvasRect.left
      const endY = cloudRect.top + cloudRect.height / 2 - canvasRect.top
      const distance = Math.max(48, Math.abs(endX - startX))
      const bend = Math.min(180, distance * 0.42)
      const controlStartX = startX + (isLeft ? bend : -bend)
      const controlEndX = endX + (isLeft ? -bend : bend)
      return [{
        executorId: node.executor.executorId,
        d: `M ${startX} ${startY} C ${controlStartX} ${startY} ${controlEndX} ${endY} ${endX} ${endY}`,
      }]
    })

    setMeshCanvasSize({
      width: Math.max(1, canvasRect.width),
      height: Math.max(1, canvasRect.height),
    })
    setMeshPaths(nextPaths)
  }, [meshNodes])

  useLayoutEffect(() => {
    updateMeshPaths()
    const animationFrame = window.requestAnimationFrame(updateMeshPaths)
    return () => {
      window.cancelAnimationFrame(animationFrame)
    }
  }, [updateMeshPaths, language, selectedExecutorId])

  useEffect(() => {
    const canvas = meshCanvasRef.current
    if (!canvas) {
      return
    }

    const resizeObserver = new ResizeObserver(() => updateMeshPaths())
    resizeObserver.observe(canvas)
    if (cloudCardRef.current) {
      resizeObserver.observe(cloudCardRef.current)
    }
    Object.values(nodeCardRefs.current).forEach((nodeCard) => {
      if (nodeCard) {
        resizeObserver.observe(nodeCard)
      }
    })

    window.addEventListener('resize', updateMeshPaths)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateMeshPaths)
    }
  }, [meshNodes, updateMeshPaths])

  return (
    <div className="executor-mesh-panel mb-5 overflow-hidden rounded-lg border border-zinc-800/80 bg-[#050507] shadow-sm shadow-black/25">
      <style>{`
        @keyframes executor-mesh-dash {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: -16; }
        }
        @keyframes executor-mesh-node-in {
          from { opacity: 0; transform: translate(-50%, -45%) scale(0.92); filter: blur(4px); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); filter: blur(0); }
        }
        @keyframes executor-mesh-node-float {
          0%, 100% { transform: translate(-50%, -50%) translateY(0); }
          50% { transform: translate(-50%, -50%) translateY(-2px); }
        }
        @keyframes executor-mesh-core-breathe {
          0%, 100% { box-shadow: 0 0 0 1px rgba(63,63,70,0.72), 0 0 40px rgba(16,185,129,0.09); }
          50% { box-shadow: 0 0 0 1px rgba(16,185,129,0.24), 0 0 56px rgba(16,185,129,0.16); }
        }
        @keyframes executor-mesh-scanline {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(260%); }
        }
      `}</style>
      <div className="executor-mesh-header flex flex-col gap-3 border-b border-zinc-900 bg-[#070708] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-100">{tr(language, '节点 Mesh', 'Executor Mesh')}</h3>
            <span className="text-xs text-zinc-600">{tr(language, '点击节点查看详情', 'Click a node for details')}</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {tr(language, '控制面与已配对 worker 的连接视图。', 'Connection view between the control plane and paired workers.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            {onlineCount} {tr(language, '在线', 'online')}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-amber-200">
            <span className="size-1.5 rounded-full bg-amber-400" />
            {pairedCount} {tr(language, '已配对', 'paired')}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-zinc-400">
            <span className="size-1.5 rounded-full bg-zinc-500" />
            {offlineCount} {tr(language, '离线', 'offline')}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div ref={meshCanvasRef} className="executor-mesh-canvas relative min-h-[360px] min-w-[760px] overflow-hidden bg-[radial-gradient(circle_at_50%_50%,rgba(16,185,129,0.08),transparent_30%),linear-gradient(180deg,rgba(9,9,11,0.96),rgba(5,5,7,1))]">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(63,63,70,0.13)_1px,transparent_1px),linear-gradient(to_bottom,rgba(63,63,70,0.10)_1px,transparent_1px)] bg-[size:40px_40px] opacity-25" />
          <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-gradient-to-b from-transparent via-emerald-300/20 to-transparent" />
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-[17rem] -translate-x-1/2 -translate-y-1/2 rounded-[2rem] bg-emerald-400/5 blur-3xl" />
          <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-zinc-800/70 bg-zinc-950/70 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-zinc-600">
            {tr(language, '边缘 Worker', 'Edge workers')}
          </div>
          <div className="pointer-events-none absolute right-4 top-4 rounded-full border border-zinc-800/70 bg-zinc-950/70 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-zinc-600">
            {tr(language, '执行节点', 'Executors')}
          </div>

          {meshNodes.length === 0 ? (
            <div className="relative flex h-[360px] items-center justify-center">
              <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/80 px-5 py-4 text-center text-sm text-zinc-500">
                {tr(language, '暂无可视化节点，先新增并配对一台 Worker。', 'No visualized executors yet. Add and pair a worker first.')}
              </div>
            </div>
          ) : (
            <>
              <svg
                className="pointer-events-none absolute inset-0 size-full"
                aria-hidden="true"
                viewBox={`0 0 ${meshCanvasSize.width} ${meshCanvasSize.height}`}
                preserveAspectRatio="none"
              >
                <defs>
                  <filter id="mesh-line-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="0.65" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {meshNodes.map((node, nodeIdx) => {
                  const meshPath = meshPaths.find((path) => path.executorId === node.executor.executorId)
                  if (!meshPath) {
                    return null
                  }
                  const tone = getExecutorMeshTone(node.executor)
                  const animation = getExecutorMeshNodeAnimation(node.executor)
                  const isConnected = node.executor.status === 'online' || node.executor.status === 'pairing' || node.executor.status === 'paired'
                  const activeStrokeWidth = isConnected ? '3' : '2'
                  return (
                    <g key={node.executor.executorId}>
                      <path
                        d={meshPath.d}
                        fill="none"
                        stroke={tone.lineSoft}
                        strokeLinecap="round"
                        strokeWidth="7"
                      />
                      <path
                        d={meshPath.d}
                        fill="none"
                        stroke={tone.line}
                        strokeLinecap="round"
                        strokeWidth={activeStrokeWidth}
                        strokeDasharray={isConnected ? '16 14' : '7 14'}
                        filter={isConnected ? 'url(#mesh-line-glow)' : undefined}
                        style={{ animation: animation.line }}
                      />
                      {isConnected ? (
                        <>
                          <circle r={node.executor.status === 'online' ? '5' : '4'} fill={tone.particle} filter="url(#mesh-line-glow)">
                            <animateMotion dur={animation.flowDuration} repeatCount="indefinite" begin={`${nodeIdx * 0.2}s`} path={meshPath.d} />
                          </circle>
                          {(node.executor.status === 'online' || node.executor.status === 'pairing') ? (
                            <circle r="2.3" fill="rgba(255,255,255,0.82)">
                              <animateMotion dur={animation.flowDuration} repeatCount="indefinite" begin={`${0.72 + nodeIdx * 0.18}s`} path={meshPath.d} />
                            </circle>
                          ) : null}
                        </>
                      ) : null}
                    </g>
                  )
                })}
              </svg>

              <div
                ref={cloudCardRef}
                className="absolute left-1/2 top-1/2 z-10 flex w-44 -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/95 p-3 text-left motion-reduce:animate-none"
                style={{ animation: 'executor-mesh-core-breathe 4.8s ease-in-out infinite' }}
              >
                <div className="pointer-events-none absolute left-0 top-0 h-full w-10 bg-gradient-to-r from-transparent via-emerald-300/10 to-transparent [animation:executor-mesh-scanline_5.6s_ease-in-out_infinite] motion-reduce:animate-none" />
                <span className="absolute left-0 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-400/30 bg-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.45)]" />
                <span className="absolute right-0 top-1/2 h-2 w-2 -translate-y-1/2 translate-x-1/2 rounded-full border border-emerald-400/30 bg-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.45)]" />
                <div className="flex items-center gap-2">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-zinc-100 text-zinc-950 shadow-sm shadow-emerald-950/40">
                    <Cloud className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-100">Hosted Cloud</p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-emerald-300/80">Mesh</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1.5 text-[10px] text-zinc-500">
                  <span className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-2 py-1">
                    <span className="block text-zinc-300">{onlineCount}</span>
                    {tr(language, '在线', 'online')}
                  </span>
                  <span className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-2 py-1">
                    <span className="block text-zinc-300">{readyMeshCount}</span>
                    Mesh
                  </span>
                  <span className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-2 py-1">
                    <span className="block text-zinc-300">{totalRunning}/{totalQueued}</span>
                    {tr(language, '负载', 'load')}
                  </span>
                </div>
              </div>

              {meshNodes.map((node, index) => {
                const tone = getExecutorMeshTone(node.executor)
                const animation = getExecutorMeshNodeAnimation(node.executor)
                const selected = selectedExecutorId === node.executor.executorId
                const staggerDelay = index * 80
                const meshIp = getExecutorMeshIp(node.executor)
                const meshDisplayState = getExecutorMeshDisplayState(node.executor, language)
                const portClassName = node.x < 50
                  ? 'right-0 translate-x-1/2'
                  : 'left-0 -translate-x-1/2'
                return (
                  <button
                    ref={(element) => {
                      nodeCardRefs.current[node.executor.executorId] = element
                    }}
                    key={node.executor.executorId}
                    type="button"
                    className={`absolute z-20 w-52 rounded-lg border px-3 py-2.5 text-left shadow-lg transition-all hover:-translate-y-0.5 hover:border-zinc-500 hover:shadow-[0_18px_42px_rgba(0,0,0,0.38)] focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-zinc-950 motion-reduce:animate-none ${tone.card} ${selected ? 'ring-2 ring-emerald-300 ring-offset-2 ring-offset-zinc-950' : ''}`}
                    style={{
                      left: `${node.x}%`,
                      top: `${node.y}%`,
                      animation: `executor-mesh-node-in 500ms ease-out ${staggerDelay}ms both, executor-mesh-node-float ${5 + index * 0.5}s ease-in-out ${staggerDelay + 500}ms infinite`,
                    }}
                    onClick={() => onSelectExecutor(node.executor.executorId)}
                  >
                    <span className={`absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border border-zinc-950 bg-zinc-500 shadow-[0_0_10px_rgba(161,161,170,0.35)] ${portClassName} ${node.executor.status === 'online' ? 'bg-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.45)]' : ''}`} />
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`size-2.5 shrink-0 rounded-full ${tone.dot} ${animation.dot}`} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-zinc-100">{node.executor.name}</p>
                          <p className="mt-0.5 truncate text-[11px] text-zinc-500">{node.executor.machineName}</p>
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${tone.badge}`}>
                        {tr(language, tone.labelZh, tone.labelEn)}
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between gap-3 text-[11px] text-zinc-500">
                      <span className="inline-flex items-center gap-1.5">
                        <Cpu className="size-3.5" />
                        {formatExecutorLatency(node.executor.presence?.latency)}
                      </span>
                      <span className="inline-flex items-center gap-1.5 tabular-nums">
                        <Activity className="size-3.5" />
                        {node.running}/{node.queued}
                      </span>
                      <span className="truncate">{getExecutorMeshLocation(node.executor)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${getExecutorMeshStatusBadgeClassName(meshDisplayState)}`}>
                        {meshDisplayState.label}
                      </span>
                      {meshIp ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-200" title={tr(language, 'Mesh 内网 IP', 'Mesh private IP')}>
                          {meshIp}
                        </span>
                      ) : null}
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${getExecutorPreviewAccessBadgeClassName(node.executor)}`}>
                        {getExecutorPreviewAccessLabel(node.executor, language)}
                      </span>
                    </div>
                  </button>
                )
              })}

              {hiddenCount > 0 ? (
                <div className="absolute bottom-4 right-4 z-30 rounded-full border border-zinc-800 bg-zinc-950/90 px-3 py-1.5 text-xs text-zinc-500 shadow-sm">
                  +{hiddenCount} {tr(language, '个节点在下方列表', 'more in the list')}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-900 bg-[#070708] px-4 py-2 text-xs text-zinc-500">
        <span>{tr(language, '运行 / 排队', 'Running / queued')}: <span className="text-zinc-300">{totalRunning}/{totalQueued}</span></span>
        <span className="hidden h-3 w-px bg-zinc-800 sm:inline-block" />
        <span>{tr(language, '最多展示 12 个节点，完整信息见下方列表。', 'Showing up to 12 nodes. Full details stay in the list below.')}</span>
      </div>
    </div>
  )
}

function ExecutorLatencyBadge({
  latency,
  language,
}: {
  latency?: ExecutorLatencySnapshot
  language: string
}) {
  const label = formatExecutorLatency(latency)
  const tone = resolveExecutorLatencyTone(latency)

  return (
    <span
      title={tr(language, 'Worker 到云控制面的最近一次 WebSocket 往返延迟', 'Latest worker-to-control-plane WebSocket round-trip latency')}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${latencyToneClassName[tone]}`}
    >
      {tr(language, '延迟', 'Latency')} {label}
    </span>
  )
}

export function ExecutorsTab({
  executors,
  distributedTasks,
  projectBindings,
  managedCloudUsage: _managedCloudUsage,
  workspaces,
  defaultWorkspaceId,
  pairingCode,
  connectCommand,
  installerConnectCommand,
  pairingExpiresAt,
  pairingVisibility,
  pairingWorkspaceId,
  pairingWorkspaceIds,
  pairingLabel,
  pairingRunMode,
  pairingInstallTarget,
  pairingBusy,
  autoOpenCreateDialog,
  autoOpenEditExecutorId,
  autoOpenTerminalExecutorId,
  executorLoading,
  busy,
  onPairingVisibilityChange,
  onPairingWorkspaceIdChange,
  onPairingWorkspaceIdsChange,
  onPairingLabelChange,
  onPairingRunModeChange,
  onPairingInstallTargetChange,
  onCreatePairingCode,
  onCreateDialogOpenChange,
  onEditDialogOpenChange,
  onOpenTerminal,
  onCloseTerminal,
  onUpdateExecutor,
  onRefreshExecutor,
  onDeleteExecutor,
  onShutdownExecutor,
}: {
  executors: ExecutorRecord[]
  distributedTasks: DistributedTask[]
  projectBindings: ProjectBinding[]
  managedCloudUsage: ManagedCloudUsageResponse | null
  workspaces: CollaborationWorkspace[]
  defaultWorkspaceId?: string
  pairingCode: string
  connectCommand: string
  installerConnectCommand: string
  pairingExpiresAt: string
  pairingVisibility: 'private' | 'workspace'
  pairingWorkspaceId: string
  pairingWorkspaceIds: string[]
  pairingLabel: string
  pairingRunMode: WorkerRunMode
  pairingInstallTarget: WorkerLocalInstallTarget
  pairingBusy: boolean
  autoOpenCreateDialog: boolean
  autoOpenEditExecutorId?: string
  autoOpenTerminalExecutorId?: string
  executorLoading: boolean
  busy: boolean
  onPairingVisibilityChange: (value: 'private' | 'workspace') => void
  onPairingWorkspaceIdChange: (value: string) => void
  onPairingWorkspaceIdsChange: (value: string[]) => void
  onPairingLabelChange: (value: string) => void
  onPairingRunModeChange: (value: WorkerRunMode) => void
  onPairingInstallTargetChange: (value: WorkerLocalInstallTarget) => void
  onCreatePairingCode: (payload: { previewExposureMode: 'private' | 'public-ingress' }) => void
  onCreateDialogOpenChange: (open: boolean) => void
  onEditDialogOpenChange: (executorId?: string) => void
  onOpenTerminal: (executorId: string) => void
  onCloseTerminal: () => void
  onUpdateExecutor: (executorId: string, payload: {
    name?: string
    note?: string
    maxConcurrency?: number
    previewExposureMode?: 'private' | 'public-ingress'
    previewIngressPort?: number
    visibility?: 'private' | 'workspace'
    workspaceId?: string
    workspaceIds?: string[]
  }) => Promise<void>
  onRefreshExecutor: (executorId: string) => Promise<void>
  onDeleteExecutor: (executorId: string) => Promise<void>
  onShutdownExecutor: (executorId: string) => Promise<void>
}) {
  const { language } = useTranslation()
  const { confirm } = useAppDialog()
  const [editingExecutor, setEditingExecutor] = useState<ExecutorRecord | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createNetworkType, setCreateNetworkType] = useState<ExecutorNetworkType>('internal')
  const [editName, setEditName] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editConcurrency, setEditConcurrency] = useState('1')
  const [editNetworkType, setEditNetworkType] = useState<ExecutorNetworkType>('internal')
  const [editPreviewIngressPort, setEditPreviewIngressPort] = useState('38080')
  const [editVisibility, setEditVisibility] = useState<'private' | 'workspace'>('private')
  const [editWorkspaceId, setEditWorkspaceId] = useState('')
  const [editWorkspaceIds, setEditWorkspaceIds] = useState<string[]>([])
  const [savingExecutor, setSavingExecutor] = useState(false)
  const [deletingExecutorId, setDeletingExecutorId] = useState('')
  const [shuttingDownExecutorId, setShuttingDownExecutorId] = useState('')
  const [selectedExecutorId, setSelectedExecutorId] = useState('')
  const [refreshingExecutorId, setRefreshingExecutorId] = useState('')
  const [filterWorkspaceId, setFilterWorkspaceId] = useState('')
  const resolveWorkspaceName = (workspaceId?: string) => workspaces.find((workspace) => workspace.id === workspaceId)?.name || workspaceId || '-'
  const getExecutorWorkspaceIds = (executor: Pick<ExecutorRecord, 'workspaceIds' | 'teamId'>) => {
    const workspaceIds = executor.workspaceIds?.filter((value) => typeof value === 'string' && value.trim().length > 0) ?? []
    return workspaceIds.length > 0 ? workspaceIds : (executor.teamId ? [executor.teamId] : [])
  }
  const userManagedExecutors = useMemo(
    () => executors.filter((executor) => !isManagedCloudExecutorRecord(executor)),
    [executors],
  )
  const workspacesByExecutorId = useMemo(() => {
    const map = new Map<string, CollaborationWorkspace[]>()
    for (const workspace of workspaces) {
      if (workspace.activeExecutorNodeId) {
        const list = map.get(workspace.activeExecutorNodeId) ?? []
        list.push(workspace)
        map.set(workspace.activeExecutorNodeId, list)
      }
    }
    return map
  }, [workspaces])
  const filteredExecutors = useMemo(() => {
    if (!filterWorkspaceId) return userManagedExecutors
    const targetWorkspace = workspaces.find((w) => w.id === filterWorkspaceId)
    if (!targetWorkspace?.activeExecutorNodeId) return []
    return userManagedExecutors.filter((e) => e.executorId === targetWorkspace.activeExecutorNodeId)
  }, [userManagedExecutors, filterWorkspaceId, workspaces])
  const pairingRunModeOptions = [
    { value: 'local' as const, label: tr(language, '本机运行', 'Local'), detail: tr(language, '安装为系统服务。', 'Install as a system service.') },
    { value: 'docker' as const, label: tr(language, 'Docker 容器', 'Docker'), detail: tr(language, 'Node Linux 容器。', 'Node Linux container.') },
  ]
  const pairingInstallTargetOptions = [
    { value: 'unix' as const, label: tr(language, 'macOS / Linux', 'macOS / Linux'), detail: tr(language, 'Bash 安装脚本。', 'Bash installer.') },
    { value: 'windows' as const, label: 'Windows', detail: tr(language, 'PowerShell 安装脚本。', 'PowerShell installer.') },
  ]
  const selectedConnectTargetLabel = pairingRunMode === 'docker'
    ? tr(language, 'Docker 容器', 'Docker container')
    : pairingInstallTarget === 'windows'
      ? tr(language, 'Windows PowerShell', 'Windows PowerShell')
      : tr(language, 'macOS / Linux Bash', 'macOS / Linux Bash')

  const resetEditForm = (executor: ExecutorRecord) => {
    const workspaceIds = getExecutorWorkspaceIds(executor)
    setEditingExecutor(executor)
    setEditName(executor.name)
    setEditNote(executor.note || '')
    setEditConcurrency(String(executor.maxConcurrency || 1))
    setEditNetworkType(resolveExecutorNetworkType(executor))
    setEditPreviewIngressPort(String(executor.previewIngressPort ?? 38080))
    setEditVisibility(executor.visibility === 'team' ? 'workspace' : 'private')
    setEditWorkspaceId(workspaceIds[0] || defaultWorkspaceId || '')
    setEditWorkspaceIds(workspaceIds.length > 0 ? workspaceIds : (defaultWorkspaceId ? [defaultWorkspaceId] : []))
  }

  useEffect(() => {
    if (autoOpenCreateDialog) {
      setCreateNetworkType('internal')
      setCreateDialogOpen(true)
    }
  }, [autoOpenCreateDialog])

  useEffect(() => {
    if (!autoOpenEditExecutorId) {
      return
    }

    const targetExecutor = executors.find((executor) => executor.executorId === autoOpenEditExecutorId)
    if (!targetExecutor || editingExecutor?.executorId === targetExecutor.executorId) {
      return
    }

    resetEditForm(targetExecutor)
  }, [autoOpenEditExecutorId, editingExecutor?.executorId, executors, defaultWorkspaceId])

  const openEditDialog = (executor: ExecutorRecord) => {
    resetEditForm(executor)
    onEditDialogOpenChange(executor.executorId)
  }

  const selectedExecutor = selectedExecutorId
    ? executors.find((executor) => executor.executorId === selectedExecutorId) ?? null
    : null
  const terminalExecutor = autoOpenTerminalExecutorId
    ? executors.find((executor) => executor.executorId === autoOpenTerminalExecutorId) ?? null
    : null

  const openCreateDialog = () => {
    setCreateNetworkType('internal')
    setCreateDialogOpen(true)
    onCreateDialogOpenChange(true)
  }

  const handleShutdownExecutor = async (executor: ExecutorRecord, blocked: boolean) => {
    if (blocked) {
      return
    }

    const confirmed = await confirm({
      title: tr(language, `确认让节点「${executor.name}」退出？`, `Quit executor "${executor.name}"?`),
      description: tr(
        language,
        '这会通知这台 Worker 主动退出；如果它由 PM2 托管，PM2 会自动重新拉起新进程。',
        'This tells the worker to exit. If it is managed by PM2, PM2 will automatically start it again.',
      ),
      confirmText: tr(language, '退出节点', 'Quit Executor'),
      cancelText: tr(language, '取消', 'Cancel'),
    })
    if (!confirmed) {
      return
    }

    setShuttingDownExecutorId(executor.executorId)
    try {
      await onShutdownExecutor(executor.executorId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr(language, '退出节点失败', 'Failed to quit executor'))
    } finally {
      setShuttingDownExecutorId('')
    }
  }

  const handleDeleteExecutor = async (executor: ExecutorRecord, blocked: boolean) => {
    if (blocked) {
      return
    }

    const confirmed = await confirm({
      title: tr(language, `确认删除节点「${executor.name}」？`, `Delete executor "${executor.name}"?`),
      description: tr(language, '这会清理它的项目绑定和默认节点引用。', 'This removes its project bindings and default executor references.'),
      confirmText: tr(language, '删除节点', 'Delete Executor'),
      cancelText: tr(language, '取消', 'Cancel'),
      tone: 'danger',
    })
    if (!confirmed) {
      return
    }

    setDeletingExecutorId(executor.executorId)
    try {
      await onDeleteExecutor(executor.executorId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr(language, '删除节点失败', 'Failed to delete executor'))
    } finally {
      setDeletingExecutorId('')
    }
  }

  const renderExecutorMoreMenu = (executor: ExecutorRecord, input: { deleteBlocked: boolean; shutdownBlocked: boolean }) => {
    const shuttingDown = shuttingDownExecutorId === executor.executorId
    const deleting = deletingExecutorId === executor.executorId
    const terminalBlocked = executor.status !== 'online'

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            aria-label={tr(language, '更多操作', 'More actions')}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => setSelectedExecutorId(executor.executorId)}>
            <Eye className="h-4 w-4" />
            {tr(language, '查看详情', 'View Details')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openEditDialog(executor)}>
            <Pencil className="h-4 w-4" />
            {tr(language, '编辑节点', 'Edit Executor')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpenTerminal(executor.executorId)} disabled={terminalBlocked}>
            <TerminalSquare className="h-4 w-4" />
            {tr(language, '打开终端', 'Open Terminal')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void handleShutdownExecutor(executor, input.shutdownBlocked)}
            disabled={shuttingDown || input.shutdownBlocked}
            className="text-amber-300 focus:bg-amber-500/10 focus:text-amber-100"
          >
            <LogOut className="h-4 w-4" />
            {shuttingDown ? tr(language, '退出中...', 'Quitting...') : tr(language, '退出', 'Quit')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void handleDeleteExecutor(executor, input.deleteBlocked)}
            disabled={deleting || input.deleteBlocked}
            className="text-rose-300 focus:bg-rose-500/10 focus:text-rose-100"
          >
            <Trash2 className="h-4 w-4" />
            {deleting ? tr(language, '删除中...', 'Deleting...') : tr(language, '删除', 'Delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div className="space-y-6">
      <Card className={panelClassName}>
        <CardContent className="p-5">
          <ExecutorMeshPanel
            executors={userManagedExecutors}
            selectedExecutorId={selectedExecutorId}
            language={language}
            onSelectExecutor={setSelectedExecutorId}
          />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <h3 className="text-lg font-medium text-zinc-50">{tr(language, '节点列表', 'Executors')}</h3>
              <p className="mt-1 text-sm text-zinc-400">
                {filterWorkspaceId
                  ? tr(language, `${filteredExecutors.length} / ${userManagedExecutors.length} 个节点`, `${filteredExecutors.length} / ${userManagedExecutors.length} executors`)
                  : tr(language, `${userManagedExecutors.length} 个已配对节点`, `${userManagedExecutors.length} paired executors`)}
              </p>
            </div>
            <div className="flex items-center gap-2 sm:shrink-0">
              {workspaces.some((w) => w.activeExecutorNodeId) ? (
                <NativeSelect
                  value={filterWorkspaceId}
                  onChange={(e) => setFilterWorkspaceId(e.target.value)}
                  className="h-8 text-xs"
                >
                  <option value="">{tr(language, '全部工作区', 'All workspaces')}</option>
                  {workspaces.filter((w) => w.activeExecutorNodeId).map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </NativeSelect>
              ) : null}
              <Button
                type="button"
                size="sm"
                onClick={openCreateDialog}
                className="bg-zinc-100 text-zinc-950 hover:bg-white"
              >
                {tr(language, '新增节点', 'Add Executor')}
              </Button>
            </div>
          </div>

          {executorLoading ? (
            <p className="mt-8 text-center text-sm text-zinc-500">{tr(language, '加载中...', 'Loading...')}</p>
          ) : filteredExecutors.length === 0 ? (
            <p className="mt-8 text-center text-sm text-zinc-500">
              {filterWorkspaceId
                ? tr(language, '该工作区暂无活跃节点', 'No active executor for this workspace')
                : tr(language, '暂无节点', 'No executors')}
            </p>
          ) : (
            <div className="mt-4 grid justify-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredExecutors.map((executor) => {
                const running = executor.presence?.runningTaskIds.length ?? 0
                const queued = executor.presence?.queuedTaskIds.length ?? 0
                const lastSeen = executor.presence?.lastHeartbeatAt || executor.lastSeenAt
                const executorPublicIp = getExecutorPublicIp(executor)
                const executorMeshIp = getExecutorMeshIp(executor)
                const executorMeshError = executor.presence?.mesh?.errorMessage?.trim() || ''
                const meshRemediation = getMeshRemediation(executor, language)
                const executorRegionLabel = getExecutorRegionLabel(executor)
                const networkType = resolveExecutorNetworkType(executor)
                const activeTaskCount = distributedTasks.filter((task) => task.executorNodeId === executor.executorId && ['assigned', 'preparing', 'executing', 'syncing_back'].includes(task.status)).length
                const deleteBlocked = activeTaskCount > 0
                const shutdownBlocked = activeTaskCount > 0 || executor.status !== 'online'
                const outdated = isNodeVersionOutdated(executor.version)
                const meshDisplayState = getExecutorMeshDisplayState(executor, language)

                return (
                  <div key={executor.executorId} className="group relative flex flex-col rounded-xl border border-zinc-800/60 bg-zinc-950/80 p-4 transition-all hover:border-zinc-700 hover:bg-zinc-950">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`size-2 shrink-0 rounded-full ${getExecutorStatusDotClassName(executor.status)}`} />
                          <h4 className="truncate text-sm font-semibold text-zinc-50">{executor.name}</h4>
                          {outdated ? (
                            <button
                              type="button"
                              onClick={() => setSelectedExecutorId(executor.executorId)}
                              title={tr(
                                language,
                                `版本 v${executor.version || '-'} 过旧（控制面 v${CURRENT_APP_VERSION}），重启节点后更新`,
                                `Version v${executor.version || '-'} is outdated (control plane v${CURRENT_APP_VERSION}); restart the node to update`,
                              )}
                              aria-label={tr(language, '节点版本过旧，需要重启更新', 'Outdated node version, restart to update')}
                              className="inline-flex shrink-0 items-center rounded-md border border-amber-400/20 bg-amber-500/10 p-1 text-amber-300 transition-colors hover:bg-amber-500/20 hover:text-amber-100"
                            >
                              <AlertTriangle className="size-3" />
                            </button>
                          ) : null}
                          {meshRemediation || executorMeshError ? (
                            <button
                              type="button"
                              onClick={() => setSelectedExecutorId(executor.executorId)}
                              title={meshRemediation?.title || tr(language, 'Mesh 异常，点击查看详情', 'Mesh issue, click for details')}
                              aria-label={tr(language, 'Mesh 需要修复', 'Mesh needs attention')}
                              className="inline-flex shrink-0 items-center rounded-md border border-amber-400/20 bg-amber-500/10 p-1 text-amber-300 transition-colors hover:bg-amber-500/20 hover:text-amber-100"
                            >
                              <ShieldAlert className="size-3" />
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
                          <span>{executorRegionLabel || executor.machineName || 'worker'}</span>
                          {executor.presence?.latency ? (
                            <>
                              <span>·</span>
                              <span className={resolveExecutorLatencyTone(executor.presence.latency) === 'fast' ? 'text-emerald-400' : resolveExecutorLatencyTone(executor.presence.latency) === 'medium' ? 'text-amber-400' : 'text-zinc-500'}>
                                {formatExecutorLatency(executor.presence.latency)}
                              </span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      {renderExecutorMoreMenu(executor, { deleteBlocked, shutdownBlocked })}
                    </div>

                    {(workspacesByExecutorId.get(executor.executorId) ?? []).length > 0 ? (
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {(workspacesByExecutorId.get(executor.executorId) ?? []).map((ws) => (
                          <span key={ws.id} className="inline-flex items-center gap-1 rounded-md border border-cyan-500/20 bg-cyan-500/8 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300">
                            <Folder className="size-2.5" />
                            {ws.name}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-2 text-center">
                        <p className="text-lg font-bold tabular-nums text-zinc-200">{executor.maxConcurrency}</p>
                        <p className="mt-0.5 text-[10px] text-zinc-600">{tr(language, '槽位', 'Slots')}</p>
                      </div>
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2 text-center">
                        <p className="text-lg font-bold tabular-nums text-emerald-400">{running}</p>
                        <p className="mt-0.5 text-[10px] text-zinc-600">{tr(language, '运行', 'Running')}</p>
                      </div>
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-center">
                        <p className="text-lg font-bold tabular-nums text-amber-400">{queued}</p>
                        <p className="mt-0.5 text-[10px] text-zinc-600">{tr(language, '排队', 'Queued')}</p>
                      </div>
                    </div>

                    <div className="mt-3 space-y-1 text-[11px]">
                      {executorMeshIp ? (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-zinc-600">Mesh IP</span>
                          <span className="font-mono text-emerald-400">{executorMeshIp}</span>
                        </div>
                      ) : null}
                      {executorPublicIp ? (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-zinc-600">{tr(language, '公网 IP', 'Public IP')}</span>
                          <span className="font-mono text-zinc-300">{executorPublicIp}</span>
                        </div>
                      ) : null}
                      {meshDisplayState.peerCountLabel !== '0 个远端节点' && meshDisplayState.peerCountLabel !== '0 peers' ? (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-zinc-600">{tr(language, '远端节点', 'Peers')}</span>
                          <span className="text-zinc-300">{meshDisplayState.peerCountLabel}</span>
                        </div>
                      ) : null}
                    </div>

                    {executor.note ? (
                      <p className="mt-2 line-clamp-1 text-[11px] text-zinc-400" title={executor.note}>{executor.note}</p>
                    ) : null}

                    <div className="mt-auto flex items-center justify-between gap-2 border-t border-zinc-800/60 pt-3">
                      <span className="min-w-0 truncate text-[11px] text-zinc-600">
                        {tr(language, '版本', 'Version')} <span className="font-mono text-zinc-300">{executor.version || '-'}</span>
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedExecutorId(executor.executorId)}
                          className="h-7 rounded-lg px-2.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-50"
                        >
                          <Eye className="size-3.5" />
                          {tr(language, '详情', 'Details')}
                        </Button>
                        <ExecutorTransferPopover
                          executor={executor}
                          executorWorkspaces={workspacesByExecutorId.get(executor.executorId) ?? []}
                          executors={executors}
                          disabled={busy}
                          onTransferred={() => {}}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ExecutorDetailDialog
        open={Boolean(selectedExecutor)}
        executor={selectedExecutor}
        workspaces={workspaces}
        distributedTasks={distributedTasks}
        projectBindings={projectBindings}
        refreshing={Boolean(selectedExecutorId) && refreshingExecutorId === selectedExecutorId}
        onRefreshExecutor={async (executorId) => {
          setRefreshingExecutorId(executorId)
          try {
            await onRefreshExecutor(executorId)
            toast.success(tr(language, '节点状态已刷新', 'Executor status refreshed'))
          } catch (error) {
            toast.error(error instanceof Error ? error.message : tr(language, '刷新节点状态失败', 'Failed to refresh executor status'))
          } finally {
            setRefreshingExecutorId('')
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedExecutorId('')
          }
        }}
      />

      <ExecutionExecutorTerminalDialog
        open={Boolean(terminalExecutor)}
        executor={terminalExecutor}
        onOpenChange={(open) => {
          if (!open) {
            onCloseTerminal()
          }
        }}
      />

      <Dialog open={createDialogOpen} onOpenChange={(open) => {
        setCreateDialogOpen(open)
        onCreateDialogOpenChange(open)
      }}>
        <DialogContent className="flex max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-[560px] flex-col overflow-hidden border-zinc-800 bg-[#09090b] p-0 text-zinc-100 sm:max-h-[calc(100vh-2rem)] sm:w-full">
          <DialogHeader className="shrink-0">
            <DialogTitle>{tr(language, '新增节点', 'Add Executor')}</DialogTitle>
            <DialogDescription className="text-zinc-500">{tr(language, '选择节点类型，生成命令后在目标机器运行。', 'Choose the node type, then run the generated command on the target machine.')}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4 sm:px-6">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-400">
              <p className="font-medium text-zinc-100">{tr(language, '怎么新增一台节点', 'How to add an executor')}</p>
              <ol className="mt-2 space-y-1 text-sm leading-6">
                <li>{tr(language, '1. 选择节点类型。', '1. Choose the node type.')}</li>
                <li>{tr(language, '2. 生成并运行连接命令。', '2. Generate and run the connect command.')}</li>
                <li>{tr(language, '3. 等待节点上线。', '3. Wait for the executor to come online.')}</li>
              </ol>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">{tr(language, '节点网络类型', 'Node network type')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(['internal', 'public'] as const).map((networkType) => {
                  const active = createNetworkType === networkType
                  return (
                    <button
                      key={networkType}
                      type="button"
                      onClick={() => setCreateNetworkType(networkType)}
                      className={`rounded-xl border px-4 py-3 text-left transition ${
                        active
                          ? 'border-zinc-100 bg-zinc-100 text-zinc-950'
                          : 'border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900'
                      }`}
                    >
                      <span className="block text-sm font-medium">{getExecutorNetworkTypeLabel(networkType, language)}</span>
                      <span className={`mt-2 block text-xs leading-5 ${active ? 'text-zinc-700' : 'text-zinc-500'}`}>
                        {getExecutorNetworkTypeDescription(networkType, language)}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="text-xs leading-5 text-zinc-500">
                {createNetworkType === 'public'
                  ? tr(language, '公网节点使用公网回源。', 'Public nodes use public ingress.')
                  : tr(language, '内网节点走私有链路。', 'Internal nodes use the private tunnel.')}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">{tr(language, '运行方式', 'Run mode')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {pairingRunModeOptions.map((option) => {
                  const active = pairingRunMode === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onPairingRunModeChange(option.value)}
                      className={`rounded-xl border px-4 py-3 text-left transition ${
                        active
                          ? 'border-zinc-100 bg-zinc-100 text-zinc-950'
                          : 'border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900'
                      }`}
                    >
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className={`mt-2 block text-xs leading-5 ${active ? 'text-zinc-700' : 'text-zinc-500'}`}>{option.detail}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            {pairingRunMode === 'local' ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">{tr(language, '目标系统', 'Target OS')}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {pairingInstallTargetOptions.map((option) => {
                    const active = pairingInstallTarget === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onPairingInstallTargetChange(option.value)}
                        className={`rounded-xl border px-4 py-3 text-left transition ${
                          active
                            ? 'border-zinc-100 bg-zinc-100 text-zinc-950'
                            : 'border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900'
                        }`}
                      >
                        <span className="block text-sm font-medium">{option.label}</span>
                        <span className={`mt-2 block text-xs leading-5 ${active ? 'text-zinc-700' : 'text-zinc-500'}`}>{option.detail}</span>
                      </button>
                    )
                  })}
                </div>
                {pairingInstallTarget === 'windows' ? (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <p className="text-xs leading-5 text-amber-200/80">
                      {tr(language,
                        '当前版本在 Windows 原生环境下兼容性较差，建议使用 WSL (Windows Subsystem for Linux) 环境安装，或选择 macOS / Linux 目标。',
                        'The current version has limited compatibility with native Windows. We recommend installing in WSL (Windows Subsystem for Linux), or selecting the macOS / Linux target.')}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">{tr(language, '可见性', 'Visibility')}</p>
              <NativeSelect value={pairingVisibility} onChange={(e) => onPairingVisibilityChange(e.target.value as 'private' | 'workspace')}>
                <option value="private">{tr(language, '仅自己可见', 'Private only')}</option>
                <option value="workspace">{tr(language, '共享到组织', 'Share to organization')}</option>
              </NativeSelect>
            </div>
            {pairingVisibility === 'workspace' && (
              <div className="space-y-2">
                <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  {workspaces.map((workspace) => {
                    const checked = pairingWorkspaceIds.includes(workspace.id)
                    return (
                      <label key={workspace.id} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-zinc-200 hover:bg-zinc-900/60">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(nextChecked) => {
                            const nextWorkspaceIds = nextChecked
                              ? [...pairingWorkspaceIds, workspace.id]
                              : pairingWorkspaceIds.filter((workspaceId) => workspaceId !== workspace.id)
                            onPairingWorkspaceIdsChange(Array.from(new Set(nextWorkspaceIds)))
                            onPairingWorkspaceIdChange(nextWorkspaceIds[0] || '')
                          }}
                          className="border-zinc-700 data-[state=checked]:border-zinc-100 data-[state=checked]:bg-zinc-100 data-[state=checked]:text-zinc-950"
                        />
                        <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                      </label>
                    )
                  })}
                </div>
                {pairingWorkspaceIds.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {pairingWorkspaceIds.map((workspaceId) => (
                      <Badge key={workspaceId} variant="outline" className="border-zinc-700 bg-zinc-950/70 text-zinc-300">
                        {resolveWorkspaceName(workspaceId)}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
                {tr(language, '显示名称', 'Display Name')}
              </label>
              <input
                value={pairingLabel}
                onChange={(e) => onPairingLabelChange(e.target.value)}
                placeholder={tr(language, '例如：办公室 Worker', 'For example: Office Worker')}
                className="h-11 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-700"
              />
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                {tr(language, '仅用于列表展示。', 'Used only in lists.')}
              </p>
            </div>
            <Button
              type="button"
              disabled={busy || pairingBusy || (pairingVisibility === 'workspace' && pairingWorkspaceIds.length === 0)}
              onClick={() => onCreatePairingCode({ previewExposureMode: getPreviewExposureModeFromNetworkType(createNetworkType) })}
              className="w-full rounded-xl bg-zinc-100 text-zinc-950 hover:bg-white"
            >
              {pairingBusy ? tr(language, '生成中...', 'Generating...') : tr(language, '生成连接命令', 'Generate Connect Command')}
            </Button>
            {pairingCode ? (
              <div className="space-y-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-emerald-300">{tr(language, '连接命令', 'Connect Command')}</p>
                    <span className="rounded border border-emerald-500/20 bg-black/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-emerald-100/80">
                      {tr(language, '当前目标', 'Selected target')}: {selectedConnectTargetLabel}
                    </span>
                  </div>
                  <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-emerald-500/20 bg-[#050507] p-3 font-mono text-xs leading-6 text-emerald-50">
                    <code>{connectCommand}</code>
                  </pre>
                  <p className="mt-3 text-xs text-zinc-500">{tr(language, '配对码有效期', 'Pairing code expires')} {formatDate(pairingExpiresAt)}</p>
                  <p className="mt-1 font-mono text-xs text-emerald-100/80">{tr(language, '当前配对码', 'Current pairing code')}: {pairingCode}</p>
                </div>
                {installerConnectCommand ? (
                  <div>
                    <p className="text-xs text-emerald-300">
                      {pairingRunMode === 'local'
                        ? (pairingInstallTarget === 'windows'
                            ? tr(language, 'macOS / Linux 备用命令', 'macOS / Linux fallback command')
                            : tr(language, 'Windows 备用命令', 'Windows fallback command'))
                        : tr(language, '安装并启动命令', 'Install And Start Command')}
                    </p>
                    <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-emerald-500/20 bg-[#050507] p-3 font-mono text-xs leading-6 text-emerald-50">
                      <code>{installerConnectCommand}</code>
                    </pre>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <Button type="button" variant="outline" onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(connectCommand)
                      toast.success(tr(language, '已复制', 'Copied'))
                    } catch {
                      toast.error(tr(language, '复制失败', 'Copy failed'))
                    }
                  }} className="border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800">
                    <Copy className="h-4 w-4" />
                    {tr(language, '复制连接命令', 'Copy Connect Command')}
                  </Button>
                  {installerConnectCommand ? (
                    <Button type="button" variant="outline" onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(installerConnectCommand)
                        toast.success(tr(language, '已复制', 'Copied'))
                      } catch {
                        toast.error(tr(language, '复制失败', 'Copy failed'))
                      }
                    }} className="border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800">
                      <Copy className="h-4 w-4" />
                      {tr(language, '复制安装命令', 'Copy Install Command')}
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(pairingCode)
                      toast.success(tr(language, '已复制', 'Copied'))
                    } catch {
                      toast.error(tr(language, '复制失败', 'Copy failed'))
                    }
                  }} className="border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800">
                    {tr(language, '复制配对码', 'Copy Pairing Code')}
                  </Button>
                </div>
                <p className="text-xs leading-5 text-zinc-500">{tr(language, '推荐直接运行上面的命令；也可只复制配对码去本地 Console 配对。', 'Run the command above, or copy only the pairing code and pair in the local Console.')}</p>
                {installerConnectCommand ? (
                  <p className="text-xs leading-5 text-zinc-500">
                    {pairingRunMode === 'local'
                      ? tr(language, '上面是当前目标系统的推荐命令；这里额外给出另一套本机安装命令，方便你在不同系统之间切换。', 'The command above is the recommended path for the selected OS; this extra command gives you the other local install path in case you need to switch systems.')
                      : tr(language, '安装命令会直接从当前后端下载这个版本的 worker，再自动配对并启动服务。', 'The install command downloads this worker version from the current server, then pairs and starts the service automatically.')}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <DialogFooter className="shrink-0 border-t border-zinc-800 bg-[#09090b] px-4 py-4 sm:px-6">
            <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)} className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50">{tr(language, '关闭', 'Close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingExecutor)} onOpenChange={(open) => {
        if (!open) {
          setEditingExecutor(null)
          onEditDialogOpenChange(undefined)
        }
      }}>
        <DialogContent className="max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-[560px] overflow-hidden border-zinc-800 bg-[#09090b] p-0 text-zinc-100 sm:max-h-[calc(100vh-2rem)] sm:w-full">
          <DialogHeader>
            <DialogTitle>{tr(language, '编辑节点', 'Edit Executor')}</DialogTitle>
            <DialogDescription className="text-zinc-500">{tr(language, '调整显示名称、备注、并发数和共享设置。机器名称和机器 ID 来自这台电脑本身，用于稳定识别同一台设备。', 'Adjust display name, note, concurrency, and sharing settings. Machine name and machine ID come from this computer and identify the device consistently.')}</DialogDescription>
          </DialogHeader>
          {editingExecutor ? (
            <div className="space-y-4 overflow-y-auto px-4 pb-4 sm:px-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{tr(language, '机器名称', 'Machine Name')}</p>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300">{editingExecutor.machineName}</div>
                </div>
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{tr(language, '机器 ID', 'Machine ID')}</p>
                  <div className="truncate rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300" title={editingExecutor.machineId}>{editingExecutor.machineId}</div>
                </div>
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{tr(language, '公网 IP', 'Public IP')}</p>
                  <div className="truncate rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300" title={getExecutorPublicIp(editingExecutor) || '-'}>
                    {getExecutorPublicIp(editingExecutor) || '-'}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{tr(language, '区域', 'Region')}</p>
                  <div className="truncate rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300" title={getExecutorRegionLabel(editingExecutor) || '-'}>
                    {getExecutorRegionLabel(editingExecutor) || '-'}
                  </div>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{tr(language, '节点名称', 'Executor Name')}</p>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={tr(language, '例如 上海 Mac mini', 'Example: Shanghai Mac mini')} className="border-zinc-800 bg-zinc-950 text-zinc-100" />
              </div>
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{tr(language, '备注', 'Note')}</p>
                <Textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder={tr(language, '例如 主力编译机 / 家里书房 / 仅白天在线', 'Example: main build machine / home office / daytime only')} className="min-h-[96px] border-zinc-800 bg-zinc-950 text-zinc-100" />
              </div>
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{tr(language, '并发数', 'Concurrency')}</p>
                <Input value={editConcurrency} onChange={(e) => setEditConcurrency(e.target.value)} type="number" min="1" max="32" className="border-zinc-800 bg-zinc-950 text-zinc-100" />
                <p className="mt-2 text-xs text-zinc-500">{tr(language, '用于表示这台节点允许同时运行多少个 Agent 执行槽位。', 'Controls how many agent execution slots this executor can run concurrently.')}</p>
              </div>
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{tr(language, '节点网络类型', 'Node network type')}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(['internal', 'public'] as const).map((networkType) => {
                    const active = editNetworkType === networkType
                    return (
                      <button
                        key={networkType}
                        type="button"
                        onClick={() => setEditNetworkType(networkType)}
                        className={`rounded-xl border px-4 py-3 text-left transition ${
                          active
                            ? 'border-zinc-100 bg-zinc-100 text-zinc-950'
                            : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900'
                        }`}
                      >
                        <span className="block text-sm font-medium">{getExecutorNetworkTypeLabel(networkType, language)}</span>
                        <span className={`mt-2 block text-xs leading-5 ${active ? 'text-zinc-700' : 'text-zinc-500'}`}>
                          {getExecutorNetworkTypeDescription(networkType, language)}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  {tr(language, '只需判断这台机器是公网还是内网。', 'Decide whether this machine is public or internal.')}
                </p>
              </div>
              {editNetworkType === 'public' ? (
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{tr(language, 'Preview 入口端口', 'Preview Ingress Port')}</p>
                  <Input
                    value={editPreviewIngressPort}
                    onChange={(e) => setEditPreviewIngressPort(e.target.value)}
                    type="number"
                    min="1"
                    max="65535"
                    className="border-zinc-800 bg-zinc-950 text-zinc-100"
                  />
                  <p className="mt-2 text-xs text-zinc-500">
                    {tr(language, '默认 38080；公网节点需放行此 TCP 端口。', 'Default 38080; public nodes must open this TCP port.')}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-xs leading-5 text-zinc-500">
                  {tr(language, '内网节点走私有链路，不需要公网入口端口。', 'Internal nodes use the private tunnel and need no public ingress port.')}
                </div>
              )}
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{tr(language, '可见性', 'Visibility')}</p>
                <NativeSelect value={editVisibility} onChange={(e) => setEditVisibility(e.target.value as 'private' | 'workspace')}>
                  <option value="private">{tr(language, '仅自己可用', 'Private only')}</option>
                  <option value="workspace">{tr(language, '共享到组织', 'Share to organization')}</option>
                </NativeSelect>
              </div>
              {editVisibility === 'workspace' && (
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{tr(language, '共享组织', 'Shared Organizations')}</p>
                  <div className="space-y-2">
                    <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                      {workspaces.map((workspace) => {
                        const checked = editWorkspaceIds.includes(workspace.id)
                        return (
                          <label key={workspace.id} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-zinc-200 hover:bg-zinc-900/60">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(nextChecked) => {
                                const nextWorkspaceIds = nextChecked
                                  ? [...editWorkspaceIds, workspace.id]
                                  : editWorkspaceIds.filter((workspaceId) => workspaceId !== workspace.id)
                                const normalizedWorkspaceIds = Array.from(new Set(nextWorkspaceIds))
                                setEditWorkspaceIds(normalizedWorkspaceIds)
                                setEditWorkspaceId(normalizedWorkspaceIds[0] || '')
                              }}
                              className="border-zinc-700 data-[state=checked]:border-zinc-100 data-[state=checked]:bg-zinc-100 data-[state=checked]:text-zinc-950"
                            />
                            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                          </label>
                        )
                      })}
                    </div>
                    {editWorkspaceIds.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {editWorkspaceIds.map((workspaceId) => (
                          <Badge key={workspaceId} variant="outline" className="border-zinc-700 bg-zinc-950/70 text-zinc-300">
                            {resolveWorkspaceName(workspaceId)}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter className="border-t border-zinc-800 bg-[#09090b] px-4 py-4 sm:px-6">
            <Button type="button" variant="outline" onClick={() => {
              setEditingExecutor(null)
              onEditDialogOpenChange(undefined)
            }} className="w-full border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50 sm:w-auto">{tr(language, '取消', 'Cancel')}</Button>
            <Button
              type="button"
              disabled={!editingExecutor || savingExecutor || !editName.trim() || Number(editConcurrency) <= 0 || (editVisibility === 'workspace' && editWorkspaceIds.length === 0)}
              onClick={async () => {
                if (!editingExecutor) return
                setSavingExecutor(true)
                try {
                  const nextPreviewIngressPort = Number(editPreviewIngressPort)
                  await onUpdateExecutor(editingExecutor.executorId, {
                    name: editName.trim(),
                    note: editNote.trim(),
                    maxConcurrency: Math.max(1, Number(editConcurrency) || 1),
                    previewExposureMode: getPreviewExposureModeFromNetworkType(editNetworkType),
                    previewIngressPort: Number.isInteger(nextPreviewIngressPort) && nextPreviewIngressPort > 0 && nextPreviewIngressPort <= 65535
                      ? nextPreviewIngressPort
                      : undefined,
                    visibility: editVisibility,
                    workspaceId: editVisibility === 'workspace' ? editWorkspaceId : undefined,
                    workspaceIds: editVisibility === 'workspace' ? editWorkspaceIds : undefined,
                  })
                  setEditingExecutor(null)
                  onEditDialogOpenChange(undefined)
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : tr(language, '更新节点失败', 'Failed to update executor'))
                } finally {
                  setSavingExecutor(false)
                }
              }}
              className="w-full bg-zinc-100 text-zinc-950 hover:bg-white sm:w-auto"
            >
              {savingExecutor ? tr(language, '保存中...', 'Saving...') : tr(language, '保存修改', 'Save Changes')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
