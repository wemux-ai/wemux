import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  WorkspaceDesktopSandboxAction,
  WorkspaceDesktopSandboxDisplayProfile,
  WorkspaceDesktopSandboxDto,
} from '@shared/types'
import { resolveWorkspaceDesktopSandboxDisplaySettings } from '@shared/types'
import {
  AppWindow,
  Copy,
  ExternalLink,
  FolderOpen,
  Loader2,
  Monitor,
  Play,
  RefreshCw,
  SendHorizontal,
  Signal,
  Square,
  StickyNote,
  Terminal,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { NativeSelect } from '../ui/native-select'
import { Textarea } from '../ui/textarea'
import { readDesktopSandboxClientNetworkHint } from '../../lib/desktop-sandbox-display-profile'
import { cn } from '../../lib/utils'
import { useWorkspaceSidePanelHeaderActions } from './workspace-side-panel-header-actions'
import { useWorkbenchResource } from './workbench-resource-registry'

export type WorkspaceDesktopSandboxBusyAction =
  | null
  | 'open'
  | 'refresh'
  | 'stop'
  | 'action'
  | 'command'

type WorkspaceDesktopSandboxPanelProps = {
  busyAction: WorkspaceDesktopSandboxBusyAction
  desktop: WorkspaceDesktopSandboxDto | null
  displayProfile: WorkspaceDesktopSandboxDisplayProfile
  resourceKey?: string
  resourceActive?: boolean
  onAction: (action: WorkspaceDesktopSandboxAction) => void
  onCommand: (command: string) => void
  onOpen: () => void
  onOpenExternal: (url?: string) => void
  onDisplayProfileChange: (profile: WorkspaceDesktopSandboxDisplayProfile) => void
  onRefresh: () => void
  onStop: () => void
}

const DESKTOP_ACTIONS: Array<{
  action: WorkspaceDesktopSandboxAction
  label: string
  icon: typeof Terminal
}> = [
  { action: 'terminal', label: 'Terminal', icon: Terminal },
  { action: 'file-manager', label: 'Files', icon: FolderOpen },
  { action: 'note', label: 'Note', icon: StickyNote },
  { action: 'demo-window', label: 'Demo', icon: AppWindow },
]

const DISPLAY_PROFILE_OPTIONS: Array<{
  value: WorkspaceDesktopSandboxDisplayProfile
  label: string
}> = [
  { value: 'auto', label: 'Auto' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' },
]

const resolveStatusLabel = (desktop: WorkspaceDesktopSandboxDto | null) => {
  if (!desktop) return '未连接'
  if (desktop.phase === 'ready') return 'Ready'
  if (desktop.phase === 'starting' || desktop.phase === 'creating') return 'Starting'
  if (desktop.phase === 'stopped') return 'Stopped'
  if (desktop.phase === 'error') return 'Error'
  return 'Idle'
}

const resolveStatusClassName = (desktop: WorkspaceDesktopSandboxDto | null) => {
  if (desktop?.phase === 'ready') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
  if (desktop?.phase === 'starting' || desktop?.phase === 'creating') return 'border-sky-500/20 bg-sky-500/10 text-sky-200'
  if (desktop?.phase === 'error') return 'border-rose-500/20 bg-rose-500/10 text-rose-200'
  return 'border-zinc-800 bg-zinc-950 text-zinc-400'
}

const resolveProviderLabel = (desktop: WorkspaceDesktopSandboxDto | null) => {
  if (desktop?.provider === 'aio') return 'AIO'
  if (desktop?.provider === 'opensandbox') return 'OpenSandbox'
  return 'Default'
}

const resolveDesktopTitle = (desktop: WorkspaceDesktopSandboxDto | null) => `${resolveProviderLabel(desktop)} Desktop`

const resolveSandboxRuntimeSummary = (desktop: WorkspaceDesktopSandboxDto | null) => {
  if (!desktop) return 'Provider will be selected by the worker.'

  const segments = [
    desktop.provider ? `provider:${desktop.provider}` : '',
    desktop.platform ? `platform:${desktop.platform}` : '',
    desktop.sandboxId ? `id:${desktop.sandboxId.slice(0, 12)}` : '',
    desktop.mountedCwd ? `mount:${desktop.mountedCwd}` : desktop.cwd ? `cwd:${desktop.cwd}` : '',
    desktop.previewHost ? `host:${desktop.previewHost}` : '',
  ].filter(Boolean)

  return segments.join(' · ') || 'Worker desktop sandbox runtime.'
}

const isBusy = (busyAction: WorkspaceDesktopSandboxBusyAction, action: NonNullable<WorkspaceDesktopSandboxBusyAction>) => busyAction === action

const resolveDesktopViewSessionKey = (desktop: WorkspaceDesktopSandboxDto | null, url: string) => {
  if (desktop?.previewId) return `preview:${desktop.previewId}`
  if (desktop?.previewHost) return `host:${desktop.previewHost}`
  if (desktop?.sandboxId) return `sandbox:${desktop.sandboxId}`

  try {
    const parsed = new URL(url)
    return `url:${parsed.origin}`
  } catch {
    return url ? `url:${url}` : ''
  }
}

const resolveNoVncDisplaySettingsForBrowser = (profile: WorkspaceDesktopSandboxDisplayProfile) => (
  resolveWorkspaceDesktopSandboxDisplaySettings({
    profile,
    network: profile === 'auto'
      ? readDesktopSandboxClientNetworkHint()
      : undefined,
  })
)

const applyDisplayProfileToNoVncUrl = (url: string, profile: WorkspaceDesktopSandboxDisplayProfile) => {
  if (!url) {
    return url
  }

  const displaySettings = resolveNoVncDisplaySettingsForBrowser(profile)
  try {
    const nextUrl = new URL(url)
    nextUrl.searchParams.set('quality', String(displaySettings.noVncQuality))
    nextUrl.searchParams.set('compression', String(displaySettings.noVncCompression))
    return nextUrl.toString()
  } catch {
    return url
  }
}

const isLocalDesktopStreamUrl = (url: string) => {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}

const canUseDirectDesktopStreamUrl = (url?: string) => {
  if (!url || !isLocalDesktopStreamUrl(url)) {
    return false
  }

  try {
    const parsed = new URL(url)
    const pageHostname = typeof window === 'undefined' ? '' : window.location.hostname.toLowerCase()
    const pageIsLoopback = pageHostname === 'localhost' || pageHostname === '127.0.0.1' || pageHostname === '[::1]' || pageHostname === '::1'
    if (!pageIsLoopback) {
      return false
    }
    if (parsed.protocol === 'https:') {
      return true
    }
    return typeof window === 'undefined' || window.location.protocol !== 'https:'
  } catch {
    return false
  }
}

export function WorkspaceDesktopSandboxPanel({
  busyAction,
  desktop,
  displayProfile,
  resourceKey = 'desktop:workspace',
  resourceActive = true,
  onAction,
  onCommand,
  onOpen,
  onOpenExternal,
  onDisplayProfileChange,
  onRefresh,
  onStop,
}: WorkspaceDesktopSandboxPanelProps) {
  const headerActions = useWorkspaceSidePanelHeaderActions()
  const resourceStatus = useWorkbenchResource({
    resourceKey,
    type: 'desktop',
    active: resourceActive,
  })
  const [commandDraft, setCommandDraft] = useState('pwd')
  const viewSessionKeyRef = useRef('')
  const [stableStreamUrl, setStableStreamUrl] = useState('')
  const directStreamUrl = desktop?.streamUrl || ''
  const candidateStreamUrl = canUseDirectDesktopStreamUrl(directStreamUrl)
    ? directStreamUrl
    : desktop?.viewUrl || desktop?.streamRedirectUrl || directStreamUrl
  const streamUrl = desktop?.phase === 'ready'
    ? (stableStreamUrl || candidateStreamUrl)
    : ''
  const connected = desktop?.phase === 'ready' && Boolean(streamUrl)
  const output = desktop?.output || desktop?.lastOutput || desktop?.cli?.lastOutput || desktop?.error || ''
  const shortMessage = desktop?.message || 'Desktop Sandbox 还没有启动。'
  const desktopTitle = resolveDesktopTitle(desktop)
  const runtimeSummary = resolveSandboxRuntimeSummary(desktop)
  const displaySettings = resolveNoVncDisplaySettingsForBrowser(displayProfile)
  const displaySummary = `q${displaySettings.noVncQuality} / c${displaySettings.noVncCompression}`
  const commandPlaceholder = useMemo(() => [
    'npm install',
    'npm run dev',
    'python -m pytest',
    'git diff --stat',
  ].join('\n'), [])

  useEffect(() => {
    if (desktop?.phase !== 'ready' || !candidateStreamUrl) {
      viewSessionKeyRef.current = ''
      setStableStreamUrl('')
      return
    }

    const nextSessionKey = resolveDesktopViewSessionKey(desktop, candidateStreamUrl)
    if (viewSessionKeyRef.current === nextSessionKey && stableStreamUrl) {
      return
    }

    viewSessionKeyRef.current = nextSessionKey
    setStableStreamUrl(candidateStreamUrl)
  }, [
    candidateStreamUrl,
    desktop?.phase,
    desktop?.previewHost,
    desktop?.previewId,
    desktop?.sandboxId,
    stableStreamUrl,
  ])

  useEffect(() => {
    if (!stableStreamUrl) {
      return
    }

    const nextStreamUrl = applyDisplayProfileToNoVncUrl(stableStreamUrl, displayProfile)
    if (nextStreamUrl !== stableStreamUrl) {
      setStableStreamUrl(nextStreamUrl)
    }
  }, [displayProfile, stableStreamUrl])

  const copyText = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(successMessage)
    } catch {
      toast.error('复制失败，请手动复制。')
    }
  }

  const runCommand = () => {
    const command = commandDraft.trim()
    if (!command) {
      return
    }
    onCommand(command)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#09090b]">
      <div className="flex h-full min-h-0 flex-col overflow-hidden border border-zinc-800 bg-zinc-950/70 text-zinc-100">
        <div className="flex min-w-0 items-center gap-2 border-b border-zinc-900 px-2 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-cyan-200">
              <Monitor className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="truncate text-xs font-medium text-zinc-100">{desktopTitle}</div>
                <Badge variant="outline" className="shrink-0 rounded-md border-zinc-800 bg-zinc-950 px-1.5 py-0 text-[10px] text-zinc-500">
                  {resolveProviderLabel(desktop)}
                </Badge>
              </div>
              <div className="truncate text-[11px] text-zinc-500">{shortMessage}</div>
            </div>
          </div>
          <Badge variant="outline" className={cn('shrink-0 rounded-md px-1.5 py-0 text-[10px]', resolveStatusClassName(desktop))}>
            {resolveStatusLabel(desktop)}
          </Badge>
          {headerActions}
        </div>

        <div className="flex flex-wrap items-center gap-1 border-b border-zinc-900 bg-[#070708] px-2 py-1.5">
          <Button
            type="button"
            size="sm"
            onClick={onOpen}
            disabled={Boolean(busyAction)}
            className="h-7 rounded-md bg-zinc-100 px-2 text-xs text-zinc-950 hover:bg-zinc-200"
          >
            {isBusy(busyAction, 'open') ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
            启动
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={Boolean(busyAction)}
            className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
          >
            {isBusy(busyAction, 'refresh') ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            刷新
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onStop}
            disabled={Boolean(busyAction) || !desktop || desktop.phase === 'stopped' || desktop.phase === 'idle'}
            className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
          >
            {isBusy(busyAction, 'stop') ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Square className="mr-1.5 h-3.5 w-3.5" />}
            停止
          </Button>
          <div className="ml-auto flex min-w-0 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/90 px-1.5 py-1">
            <Signal className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <NativeSelect
              aria-label="Desktop Sandbox 清晰度"
              value={displayProfile}
              onValueChange={(value) => onDisplayProfileChange(value as WorkspaceDesktopSandboxDisplayProfile)}
              disabled={Boolean(busyAction)}
              options={DISPLAY_PROFILE_OPTIONS}
              className="h-6 w-[5.75rem] rounded-md border-zinc-800 bg-zinc-950 px-2 pr-2 text-[11px] focus:ring-0"
              wrapperClassName="w-auto"
            />
            <span className="hidden whitespace-nowrap text-[11px] text-zinc-500 md:inline">
              {displaySummary}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenExternal(streamUrl || desktop?.streamUrl || desktop?.controlUrl)}
            disabled={!streamUrl && !desktop?.streamUrl && !desktop?.controlUrl}
            className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
          >
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            外部打开
          </Button>
        </div>

        <div className="flex min-h-7 min-w-0 items-center gap-2 border-b border-zinc-900 bg-[#080809] px-2 text-[11px] text-zinc-500">
          <span className="shrink-0 text-zinc-600">Runtime</span>
          <span className="truncate">{runtimeSummary}</span>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
          <div className="relative min-h-0 overflow-hidden bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.08),transparent_28%),linear-gradient(180deg,#09090b_0%,#050506_100%)]">
            {connected && resourceStatus !== 'disposed' ? (
              <iframe
                key={streamUrl}
                src={streamUrl}
                title={desktopTitle}
                className="h-full w-full border-0 bg-black"
                allow="clipboard-read; clipboard-write; fullscreen"
              />
            ) : (
              <div className="flex h-full min-h-[18rem] items-center justify-center p-6">
                <div className="max-w-sm text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
                    <Monitor className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-zinc-100">启动可视化调试桌面</h3>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">
                    Worker 会按当前配置选择 Desktop Sandbox provider，并把 noVNC 桌面嵌入到这个工作区侧栏。
                  </p>
                  <Button
                    type="button"
                    onClick={onOpen}
                    disabled={Boolean(busyAction)}
                    className="mt-4 h-8 rounded-md bg-zinc-100 px-3 text-xs text-zinc-950 hover:bg-zinc-200"
                  >
                    {isBusy(busyAction, 'open') ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                    启动 Desktop Sandbox
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-zinc-900 bg-[#070708]">
            <div className="flex flex-wrap items-center gap-1 border-b border-zinc-900 px-2 py-1.5">
              {DESKTOP_ACTIONS.map((item) => {
                const Icon = item.icon
                return (
                  <Button
                    key={item.action}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onAction(item.action)}
                    disabled={Boolean(busyAction) || !desktop || desktop.phase === 'stopped' || desktop.phase === 'idle'}
                    className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
                  >
                    {isBusy(busyAction, 'action') ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Icon className="mr-1.5 h-3.5 w-3.5" />}
                    {item.label}
                  </Button>
                )
              })}
            </div>

            <div className="grid gap-2 p-2">
              <div className="grid gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">Sandbox Command</span>
                  {desktop?.agentUsageHint ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void copyText(desktop.agentUsageHint, '已复制 Agent 使用提示。')}
                      className="h-6 rounded-md px-2 text-[11px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                    >
                      <Copy className="mr-1 h-3 w-3" />
                      Agent Hint
                    </Button>
                  ) : null}
                </div>
                <div className="flex min-w-0 gap-1.5">
                  <Textarea
                    value={commandDraft}
                    onChange={(event) => setCommandDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault()
                        runCommand()
                      }
                    }}
                    placeholder={commandPlaceholder}
                    className="min-h-[3.25rem] flex-1 resize-none rounded-md border-zinc-800 bg-zinc-950 font-mono text-xs text-zinc-100 placeholder:text-zinc-700"
                  />
                  <Button
                    type="button"
                    onClick={runCommand}
                    disabled={Boolean(busyAction) || !commandDraft.trim()}
                    className="h-auto w-10 rounded-md bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                    aria-label="运行命令"
                    title="运行命令"
                  >
                    {isBusy(busyAction, 'command') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizontal className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
              <pre className="max-h-32 min-h-12 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-900 bg-black/45 p-2 font-mono text-[11px] leading-5 text-zinc-400">
                {output || '命令输出会显示在这里。Agent 更适合通过 worker CLI 走 command/file API，GUI 用来观察和接管。'}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
