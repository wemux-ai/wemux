/**
 * [INPUT]: Workspace/executor terminal metadata, session commands, and the active panel key.
 * [OUTPUT]: A cached terminal UI that preserves pane state and live terminal attachments across workspace switches.
 * [POS]: Shared terminal surface for workspace detail, workspace list, and executor terminal views.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { WorkspaceTerminalSessionDescriptor } from '@shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from 'xterm'
import { ChevronDown, Loader2, Maximize2, Minimize2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import 'xterm/css/xterm.css'
import { api, resolveApiUrl } from '../../lib/api'
import { readLocalWorkerExecutor, type LocalWorkerEndpoint } from '../../lib/browser-local-network-access'
import { formatLatencyValue } from '../../lib/executor-latency'
import { resolveApiWebSocketUrlWithBase } from '../../lib/runtime-config'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import {
  buildPublicTerminalGatewayWsUrl,
  buildLocalDirectTerminalWsUrl,
  buildLocalTerminalMeshBridgeWsUrl,
  canUseLocalDirectTerminal,
  resolveActiveTerminalTransport,
  resolveLocalDirectTerminalUnavailableDetail,
  resolveTerminalRemoteTransportKind,
  resolveTerminalRemoteTransportUnavailableDetail,
  resolveTerminalRemoteTransportName,
  resolveTerminalTransportLabel,
  resolveTerminalTransportOptions,
  shouldUseExecutorRealtimeBaseUrlForTerminal,
  type TerminalTransportProbeSnapshot,
  type TerminalTransport,
  type TerminalTransportPreference,
} from '../../lib/workspace-terminal-local-direct'
import { workspaceQueryKeys } from '../../lib/workspace-query-keys'
import { useWorkbenchResource } from './workbench-resource-registry'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader } from '../ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'

type TerminalConnectionStatus = 'connecting' | 'ready' | 'closed' | 'error'

type TerminalPaneRecord = {
  id: string
  terminalId: string
  terminalKey?: string
  connectionTitle: string
  title: string
  backend?: WorkspaceTerminalSessionDescriptor['backend']
  persistent?: boolean
  bindingKey?: WorkspaceTerminalCommandRequest['bindingKey']
  lastCommand?: string
  exitedAt?: string
  exitCode?: number
}

type WorkspaceTerminalPanelProps = {
  collapsed: boolean
  cwd?: string
  executorId?: string
  executorName: string
  executorRealtimeBaseUrl?: string
  projectId?: string
  installCommand?: string
  startCommand?: string
  logsCommand?: string
  maximized?: boolean
  isMobile?: boolean
  panelKey: string
  resourceActive?: boolean
  shouldLoadSessions?: boolean
  workspaceId?: string
  workspaceName?: string
  commandRequest?: WorkspaceTerminalCommandRequest | null
  onCollapsedChange: (collapsed: boolean) => void
  onMaximizedChange?: (maximized: boolean) => void
  onOpenStateChange?: (open: boolean) => void
  onOpenWorkspaceTarget: () => Promise<void>
}

export type WorkspaceTerminalCommandRequest = {
  id: string
  bindingKey?: 'environment'
  command?: string
  kind: 'command' | 'focus' | 'interrupt'
  successMessage?: string
  workspaceId?: string
}

type WorkspaceTerminalInstanceProps = {
  active: boolean
  paused: boolean
  closed: boolean
  cwd?: string
  executorId?: string
  executorName: string
  executorRealtimeBaseUrl?: string
  projectId?: string
  terminalId: string
  terminalScope: 'workspace' | 'executor'
  terminalTitle: string
  transport: TerminalTransport
  transportPreference: TerminalTransportPreference
  localWorkerEndpoint?: LocalWorkerEndpoint
  localWorkerExecutorId?: string
  workspaceId?: string
  onCommandSubmit: (command: string) => void
  onStatusChange: (status: TerminalConnectionStatus) => void
  onTransportChange: (transport: TerminalTransport) => void
  onTransportFailure: (transport: TerminalTransport, message: string) => void
}

type WorkspaceTerminalInstanceHandle = {
  focus: () => void
  sendInput: (input: string) => boolean
}

const tr = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

const TERMINAL_TRANSPORT_PROBE_TIMEOUT_MS = 5000

const resolveTransportStatusDotTone = (status: 'idle' | 'probing' | 'ok' | 'error' | 'unavailable', available: boolean) => {
  if (!available || status === 'unavailable') {
    return 'bg-zinc-700'
  }
  if (status === 'error') {
    return 'bg-rose-400'
  }
  if (status === 'ok') {
    return 'bg-emerald-400'
  }
  if (status === 'probing') {
    return 'bg-sky-400'
  }
  return 'bg-zinc-500'
}

const normalizeTerminalCommandTitle = (command: string) => command.trim().replace(/\s+/g, ' ')

const reduceTerminalCommandDraft = (draft: string, input: string) => {
  if (input.startsWith('\u001b')) {
    return { draft }
  }

  let nextDraft = draft
  let submittedCommand = ''

  for (const char of input) {
    if (char === '\r' || char === '\n') {
      const command = normalizeTerminalCommandTitle(nextDraft)
      if (command) {
        submittedCommand = command
      }
      nextDraft = ''
      continue
    }

    if (char === '\u0003') {
      nextDraft = ''
      continue
    }

    if (char === '\u007f') {
      nextDraft = nextDraft.slice(0, -1)
      continue
    }

    if (char === '\t') {
      nextDraft += ' '
      continue
    }

    if (char >= ' ') {
      nextDraft += char
    }
  }

  return { draft: nextDraft, submittedCommand }
}

const fitTerminal = (xterm: Terminal, fitAddon: FitAddon) => {
  if (!xterm.element) {
    return
  }

  try {
    fitAddon.fit()
  } catch {
    // ignore fit timing issues during mount/unmount
  }
}

const createTerminalPaneTitle = (index: number, language = 'zh') => tr(language, `终端 ${index + 1}`, `Terminal ${index + 1}`)

const buildTerminalPane = (
  index: number,
  language = 'zh',
  terminalId = index === 0 ? 'default' : `terminal-${crypto.randomUUID()}`,
): TerminalPaneRecord => {
  const title = createTerminalPaneTitle(index, language)
  return {
    id: terminalId,
    terminalId,
    connectionTitle: title,
    title,
  }
}

const buildTerminalPaneFromSession = (
  session: WorkspaceTerminalSessionDescriptor,
  index: number,
  language = 'zh',
  existing?: TerminalPaneRecord,
): TerminalPaneRecord => {
  const fallbackTitle = createTerminalPaneTitle(index, language)
  const sessionTitle = session.title?.trim() || ''
  const title = sessionTitle || existing?.title || fallbackTitle

  return {
    id: session.terminalId,
    terminalId: session.terminalId,
    terminalKey: session.terminalKey,
    connectionTitle: existing?.connectionTitle || sessionTitle || fallbackTitle,
    title,
    backend: session.backend ?? existing?.backend,
    persistent: session.persistent ?? existing?.persistent,
    bindingKey: existing?.bindingKey,
    lastCommand: existing?.lastCommand,
    exitedAt: session.exitedAt,
    exitCode: session.exitCode,
  }
}

const upsertTerminalPaneFromSession = (
  panes: TerminalPaneRecord[],
  session: WorkspaceTerminalSessionDescriptor,
  language: string,
) => {
  const existingIndex = panes.findIndex((pane) => pane.terminalId === session.terminalId)
  if (existingIndex === -1) {
    return [...panes, buildTerminalPaneFromSession(session, panes.length, language)]
  }

  return panes.map((pane, index) => (
    pane.terminalId === session.terminalId
      ? buildTerminalPaneFromSession(session, index, language, pane)
      : pane
  ))
}

const resolveTerminalScope = (workspaceId?: string) => workspaceId ? 'workspace' as const : 'executor' as const

const resolveTerminalBackendLabel = (pane: TerminalPaneRecord, language: string) => {
  if (pane.backend === 'zellij') {
    return pane.persistent === false
      ? tr(language, 'PTY', 'PTY')
      : 'zellij'
  }
  if (pane.backend === 'node-pty' || pane.backend === 'python-pty') {
    return 'PTY'
  }
  if (pane.backend === 'pipe') {
    return 'pipe'
  }
  return ''
}

const buildTerminalServerWsUrl = (params: {
  cwd?: string
  executorId?: string
  executorRealtimeBaseUrl?: string
  ignoreExecutorRealtimeBaseUrl?: boolean
  projectId?: string
  terminalId: string
  terminalScope: 'workspace' | 'executor'
  terminalTitle: string
  workspaceId?: string
}) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  if (!token || !params.executorId) {
    return ''
  }

  const path = `/api/control-plane/executors/${params.executorId}/terminal/ws`
  const base = resolveApiUrl(path)
  const useRealtimeBaseUrl = !params.ignoreExecutorRealtimeBaseUrl
    && shouldUseExecutorRealtimeBaseUrlForTerminal({
      executorRealtimeBaseUrl: params.executorRealtimeBaseUrl,
    })
  const baseUrl = useRealtimeBaseUrl
    ? resolveApiWebSocketUrlWithBase(params.executorRealtimeBaseUrl!, path)
    : base
  const url = new URL(baseUrl, typeof window !== 'undefined' ? window.location.origin : undefined)
  url.searchParams.set('token', token)
  if (params.projectId) {
    url.searchParams.set('projectId', params.projectId)
  }
  if (params.workspaceId) {
    url.searchParams.set('workspaceId', params.workspaceId)
  }
  if (params.cwd) {
    url.searchParams.set('cwd', params.cwd)
  }
  url.searchParams.set('terminalId', params.terminalId)
  url.searchParams.set('terminalScope', params.terminalScope)
  if (params.terminalTitle.trim()) {
    url.searchParams.set('terminalTitle', params.terminalTitle.trim())
  }
  return url.protocol === 'https:' ? url.toString().replace('https://', 'wss://') : url.toString().replace('http://', 'ws://')
}

const probeTerminalTransportSocket = (url: string): Promise<TerminalTransportProbeSnapshot> => {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()

  return new Promise((resolve) => {
    let settled = false
    let socket: WebSocket | null = null
    let timeout = 0

    const settle = (snapshot: TerminalTransportProbeSnapshot) => {
      if (settled) {
        return
      }
      settled = true
      window.clearTimeout(timeout)
      try {
        socket?.close(1000, 'terminal transport probe complete')
      } catch {
        // ignore close races
      }
      resolve(snapshot)
    }

    timeout = window.setTimeout(() => {
      settle({
        status: 'error',
        error: '探测超时',
      })
    }, TERMINAL_TRANSPORT_PROBE_TIMEOUT_MS)

    try {
      socket = new WebSocket(url)
      socket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; message?: string }
          if (message.type === 'ready') {
            const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
            settle({
              status: 'ok',
              roundTripMs: Math.max(0, Math.round(endedAt - startedAt)),
            })
          } else if (message.type === 'error') {
            settle({
              status: 'error',
              error: message.message || '连接不可用',
            })
          }
        } catch {
          // Ignore non-control output during probe.
        }
      })
      socket.addEventListener('error', () => {
        settle({
          status: 'error',
          error: '连接失败',
        })
      })
      socket.addEventListener('close', () => {
        settle({
          status: 'error',
          error: '连接已关闭',
        })
      })
    } catch (error) {
      settle({
        status: 'error',
        error: error instanceof Error ? error.message : '连接失败',
      })
    }
  })
}

const buildBoundTerminalPaneTitle = (
  bindingKey: WorkspaceTerminalCommandRequest['bindingKey'],
  language: string,
  command?: string,
) => {
  if (bindingKey === 'environment') {
    const label = tr(language, '运行环境', 'Runtime Env')
    const normalizedCommand = command?.trim()
    return normalizedCommand ? `${label} · ${normalizedCommand}` : label
  }

  return command?.trim() || tr(language, '终端', 'Terminal')
}

const WorkspaceTerminalInstance = forwardRef<WorkspaceTerminalInstanceHandle, WorkspaceTerminalInstanceProps>(function WorkspaceTerminalInstance({
  active,
  paused,
  closed,
  cwd,
  executorId,
  executorName,
  executorRealtimeBaseUrl,
  projectId,
  terminalId,
  terminalScope,
  terminalTitle,
  transport,
  transportPreference,
  localWorkerEndpoint,
  localWorkerExecutorId,
  workspaceId,
  onCommandSubmit,
  onStatusChange,
  onTransportChange,
  onTransportFailure,
}, ref) {
  const { language, t } = useTranslation()
  const remoteTransportKind = resolveTerminalRemoteTransportKind({
    executorRealtimeBaseUrl,
    currentPageOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
  })
  const remoteTransportLabel = resolveTerminalRemoteTransportName(remoteTransportKind)
  const mountRef = useRef<HTMLDivElement | null>(null)
  const statusChangeRef = useRef(onStatusChange)
  const socketRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const readyRef = useRef(false)
  const modeRef = useRef<'pty' | 'pipe'>('pty')
  const connectVersionRef = useRef(0)
  const initializedRef = useRef(false)
  const cleanupRef = useRef<() => void>(() => {})
  const commandDraftRef = useRef('')
  const commandSubmitRef = useRef(onCommandSubmit)
  const remoteRenderStartedRef = useRef(false)
  const snapshotRenderedRef = useRef(false)
  const reconnectTimerRef = useRef(0)
  const shouldReconnectRef = useRef(true)
  const closeStatusRef = useRef<TerminalConnectionStatus>('closed')
  const terminalTransportRef = useRef<TerminalTransport>('server')
  // Sticky for the life of this pane: once the executor's realtime endpoint has
  // proven unreachable, stop re-deriving the socket URL from it. Otherwise every
  // reconnect burns another connect timeout on a host we know is dead.
  const realtimeBaseUrlFailedRef = useRef(false)

  useEffect(() => {
    commandSubmitRef.current = onCommandSubmit
  }, [onCommandSubmit])

  const recordCommandInput = useCallback((input: string) => {
    const next = reduceTerminalCommandDraft(commandDraftRef.current, input)
    commandDraftRef.current = next.draft
    if (next.submittedCommand) {
      commandSubmitRef.current(next.submittedCommand)
    }
  }, [])

  useImperativeHandle(ref, () => ({
    focus: () => {
      xtermRef.current?.focus()
    },
    sendInput: (input: string) => {
      const socket = socketRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN || !readyRef.current) {
        return false
      }

      recordCommandInput(input)
      socket.send(JSON.stringify({ type: 'input', input }))
      return true
    },
  }), [recordCommandInput])

  useEffect(() => {
    statusChangeRef.current = onStatusChange
  }, [onStatusChange])

  const transportChangeRef = useRef(onTransportChange)
  useEffect(() => {
    transportChangeRef.current = onTransportChange
  }, [onTransportChange])
  const transportFailureRef = useRef(onTransportFailure)
  useEffect(() => {
    transportFailureRef.current = onTransportFailure
  }, [onTransportFailure])

  useEffect(() => {
    if (active && !closed) {
      const xterm = xtermRef.current
      const fitAddon = fitAddonRef.current
      window.requestAnimationFrame(() => {
        if (!xterm || !fitAddon) {
          return
        }

        fitTerminal(xterm, fitAddon)
        xterm.focus()
        if (readyRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'resize', cols: xterm.cols, rows: xterm.rows }))
        }
      })
    }
  }, [active, closed])

  useEffect(() => {
    const mountNode = mountRef.current
    if (!mountNode) {
      return
    }

    if (closed) {
      cleanupRef.current()
      statusChangeRef.current('closed')
      return
    }

    if (paused) {
      return
    }

    if (initializedRef.current) {
      return
    }

    if (!executorId || !terminalId) {
      readyRef.current = false
      statusChangeRef.current('error')
      return
    }

    initializedRef.current = true
    mountNode.replaceChildren()

    const xterm = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.45,
      theme: {
        background: '#050506',
        foreground: '#e4e4e7',
        cursor: '#fafafa',
        black: '#18181b',
        brightBlack: '#52525b',
        red: '#fb7185',
        brightRed: '#fecdd3',
        green: '#4ade80',
        brightGreen: '#bbf7d0',
        yellow: '#facc15',
        brightYellow: '#fef08a',
        blue: '#60a5fa',
        brightBlue: '#bfdbfe',
        magenta: '#c084fc',
        brightMagenta: '#e9d5ff',
        cyan: '#22d3ee',
        brightCyan: '#a5f3fc',
        white: '#f4f4f5',
        brightWhite: '#ffffff',
      },
    })
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xtermRef.current = xterm
    fitAddonRef.current = fitAddon
    readyRef.current = false
    modeRef.current = 'pty'
    remoteRenderStartedRef.current = false
    snapshotRenderedRef.current = false
    closeStatusRef.current = 'closed'

    const connectVersion = ++connectVersionRef.current
    let disposed = false
    let socket: WebSocket | null = null
    let rafId = 0
    let resizeObserver: ResizeObserver | null = null
    let disposeInput: { dispose: () => void } | null = null

    const cleanup = () => {
      if (disposed) {
        return
      }

      disposed = true
      shouldReconnectRef.current = false
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = 0
      window.cancelAnimationFrame(rafId)
      resizeObserver?.disconnect()
      resizeObserver = null
      disposeInput?.dispose()
      disposeInput = null
      readyRef.current = false
      modeRef.current = 'pty'
      initializedRef.current = false

      try {
        if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
          socket.close()
        }
      } catch {
        // ignore close races
      }

      try {
        xterm.dispose()
      } catch {
        // ignore dispose races
      }

      if (socketRef.current === socket) {
        socketRef.current = null
      }
      xtermRef.current = null
      fitAddonRef.current = null
      cleanupRef.current = () => {}
      mountNode.replaceChildren()
    }
    cleanupRef.current = cleanup

    const resolvePreferredTerminalWsUrl = async (): Promise<{ url: string; serverUrl: string; transport: TerminalTransport }> => {
      const serverUrl = buildTerminalServerWsUrl({
        cwd,
        executorId,
        executorRealtimeBaseUrl,
        ignoreExecutorRealtimeBaseUrl: realtimeBaseUrlFailedRef.current,
        projectId,
        terminalId,
        terminalScope,
        terminalTitle,
        workspaceId,
      })
      if (!serverUrl) {
        return { url: '', serverUrl, transport: 'server' }
      }

      if (transport === 'server') {
        return { url: serverUrl, serverUrl, transport: 'server' }
      }

      if (transport === 'public-gateway') {
        try {
          const ticket = await api.createExecutorTerminalLocalAttachTicket(executorId, {
            terminalId,
            workspaceId,
            scope: terminalScope,
            cwd,
            transport: 'public-gateway',
          })
          const publicGatewayUrl = ticket.ok && ticket.ticket
            ? buildPublicTerminalGatewayWsUrl({
                ticket: ticket.ticket,
                wsUrl: ticket.wsUrl,
              })
            : ''
          return publicGatewayUrl
            ? { url: publicGatewayUrl, serverUrl, transport: 'public-gateway' }
            : transportPreference === 'auto'
              ? { url: serverUrl, serverUrl, transport: 'server' }
              : { url: '', serverUrl, transport: 'public-gateway' }
        } catch {
          return transportPreference === 'auto'
            ? { url: serverUrl, serverUrl, transport: 'server' }
            : { url: '', serverUrl, transport: 'public-gateway' }
        }
      }

      try {
        const ticket = await api.createExecutorTerminalLocalAttachTicket(executorId, {
          terminalId,
          workspaceId,
          scope: terminalScope,
          cwd,
          meshSourceExecutorId: localWorkerExecutorId,
          transport: executorId && localWorkerExecutorId && executorId !== localWorkerExecutorId ? 'mesh' : 'local-direct',
        })
        if (!ticket.ok || !ticket.ticket) {
          return transportPreference === 'auto'
            ? { url: serverUrl, serverUrl, transport: 'server' }
            : { url: '', serverUrl, transport: 'local-direct' }
        }
        const localUrl = ticket.wsUrl?.includes('/api/terminal-mesh/ws')
            ? buildLocalTerminalMeshBridgeWsUrl({
              ticket: ticket.ticket,
              targetWsUrl: ticket.wsUrl,
              endpoint: localWorkerEndpoint,
            })
            : buildLocalDirectTerminalWsUrl({
              ticket: ticket.ticket,
              wsUrl: ticket.wsUrl,
            })
        return localUrl
          ? { url: localUrl, serverUrl, transport: 'local-direct' }
          : transportPreference === 'auto'
            ? { url: serverUrl, serverUrl, transport: 'server' }
            : { url: '', serverUrl, transport: 'local-direct' }
      } catch {
        return transportPreference === 'auto'
          ? { url: serverUrl, serverUrl, transport: 'server' }
          : { url: '', serverUrl, transport: 'local-direct' }
      }
    }

    const openTerminalSocket = (
      wsUrl: string,
      transport: TerminalTransport,
      serverFallbackUrl: string,
      allowFallback: boolean,
      serverOriginFallbackUrl = '',
    ) => {
      terminalTransportRef.current = transport
      transportChangeRef.current(transport)
      const currentSocket = new WebSocket(wsUrl)
      let currentConnectTimer = 0
      let currentReadyTimer = 0
      socket = currentSocket
      socketRef.current = socket
      shouldReconnectRef.current = true
      closeStatusRef.current = 'closed'
      statusChangeRef.current('connecting')

      // A `server` socket built against the executor's realtime base URL (the
      // connected node's registered `url`) is a permanent dead end when that URL is
      // stale or unreachable — every other API call still works, so the terminal
      // looks uniquely broken. Retry once against the page origin before giving up.
      const fallbackToServerOrigin = () => {
        if (transport !== 'server' || !serverOriginFallbackUrl || readyRef.current || disposed) {
          return false
        }
        try {
          if (currentSocket.readyState === WebSocket.OPEN || currentSocket.readyState === WebSocket.CONNECTING) {
            currentSocket.close()
          }
        } catch {
          // ignore close races
        }
        realtimeBaseUrlFailedRef.current = true
        const fallbackMessage = tr(
          language,
          '执行节点的实时入口地址不可达，已改用当前站点地址重试。请检查该节点的 WEMUX_NODE_URL 配置。',
          'The executor realtime endpoint is unreachable; retrying via the current site origin. Check that node\'s WEMUX_NODE_URL.',
        )
        xterm.writeln(`\r\n[terminal] ${fallbackMessage}`)
        openTerminalSocket(serverOriginFallbackUrl, 'server', '', false)
        return true
      }

      const fallbackToServer = () => {
        if (fallbackToServerOrigin()) {
          return true
        }
        if (!allowFallback || (transport !== 'local-direct' && transport !== 'public-gateway') || !serverFallbackUrl || readyRef.current || disposed) {
          return false
        }
        try {
          if (currentSocket.readyState === WebSocket.OPEN || currentSocket.readyState === WebSocket.CONNECTING) {
            currentSocket.close()
          }
        } catch {
          // ignore close races
        }
        const fallbackMessage = transport === 'public-gateway'
          ? tr(language, `公网终端入口不可用，已切回 ${remoteTransportLabel}。`, `Public terminal gateway is unavailable, falling back to ${remoteTransportLabel}.`)
          : tr(language, `本地直连不可用，已切回 ${remoteTransportLabel}。`, `Local direct is unavailable, falling back to ${remoteTransportLabel}.`)
        transportFailureRef.current(transport, fallbackMessage)
        xterm.writeln(`\r\n[terminal] ${fallbackMessage}`)
        terminalTransportRef.current = 'server'
        transportChangeRef.current('server')
        openTerminalSocket(serverFallbackUrl, 'server', '', false, serverOriginFallbackUrl)
        return true
      }

      currentConnectTimer = window.setTimeout(() => {
        if (disposed || connectVersionRef.current !== connectVersion) {
          return
        }

        if (currentSocket.readyState === WebSocket.CONNECTING) {
          if (fallbackToServer()) {
            return
          }
          readyRef.current = false
          statusChangeRef.current('error')
          xterm.writeln(`\r\n[terminal connect timeout] ${t('workspace.terminal.connectError', { defaultValue: '终端连接失败，但不代表任务执行失败。' })}`)
          try {
            currentSocket.close()
          } catch {
            // ignore close races
          }
        }
      }, 5000)

      currentSocket.addEventListener('open', () => {
        if (disposed || connectVersionRef.current !== connectVersion) {
          return
        }

        window.clearTimeout(currentConnectTimer)
        currentReadyTimer = window.setTimeout(() => {
          if (!disposed && currentSocket.readyState === WebSocket.OPEN && !readyRef.current) {
            if (fallbackToServer()) {
              return
            }
            xterm.writeln(`\r\n[terminal ready timeout] ${t('workspace.terminal.readyTimeout', { defaultValue: '终端暂时不可用，请确认 worker 已重启到最新版本并且节点在线。任务本身可能仍在继续执行。' })}`)
            readyRef.current = false
            statusChangeRef.current('error')
          }
        }, 5000)
      })

      const beginRemoteRender = () => {
        if (remoteRenderStartedRef.current) {
          return
        }
        remoteRenderStartedRef.current = true
        try {
          xterm.reset()
        } catch {
          // ignore reset timing issues
        }
      }

      currentSocket.addEventListener('message', (event) => {
        if (disposed || connectVersionRef.current !== connectVersion) {
          return
        }

        try {
          const message = JSON.parse(String(event.data)) as
            | { type: 'snapshot'; snapshot: { session: WorkspaceTerminalSessionDescriptor; chunks: Array<{ stream: 'stdout' | 'stderr' | 'system'; chunk: string; at: string }> }; at: string }
            | { type: 'ready'; cwd?: string; mode?: 'pty' | 'pipe'; at: string }
            | { type: 'output'; output: { stream: 'stdout' | 'stderr' | 'system'; chunk: string; terminalId: string; terminalKey: string } }
            | { type: 'exit'; exitCode: number; at: string }
            | { type: 'unavailable'; message?: string; at: string }
            | { type: 'error'; message: string }

          switch (message.type) {
            case 'snapshot':
              beginRemoteRender()
              snapshotRenderedRef.current = message.snapshot.chunks.length > 0
              for (const chunk of message.snapshot.chunks) {
                xterm.write(chunk.chunk)
              }
              if (message.snapshot.session.exitedAt) {
                readyRef.current = false
                statusChangeRef.current('closed')
              }
              return
            case 'ready':
              window.clearTimeout(currentConnectTimer)
              window.clearTimeout(currentReadyTimer)
              readyRef.current = true
              modeRef.current = message.mode ?? 'pty'
              statusChangeRef.current('ready')
              if (!snapshotRenderedRef.current) {
                beginRemoteRender()
                xterm.writeln(`\r\n${tr(language, '已连接到', 'Connected to')} ${message.cwd || cwd || executorName}${modeRef.current === 'pipe' ? tr(language, '（兼容模式）', ' (compat mode)') : ''} · ${resolveTerminalTransportLabel(terminalTransportRef.current, remoteTransportKind)}`)
              }
              fitTerminal(xterm, fitAddon)
              xterm.focus()
              if (currentSocket.readyState === WebSocket.OPEN) {
                currentSocket.send(JSON.stringify({ type: 'resize', cols: xterm.cols, rows: xterm.rows }))
              }
              return
            case 'output':
              beginRemoteRender()
              xterm.write(message.output.chunk)
              return
            case 'exit':
              readyRef.current = false
              shouldReconnectRef.current = false
              closeStatusRef.current = 'closed'
              statusChangeRef.current('closed')
              xterm.writeln(`\r\n${tr(language, `[会话已退出，退出码 ${message.exitCode}]`, `[session exited with code ${message.exitCode}]`)}`)
              return
            case 'unavailable':
              readyRef.current = false
              shouldReconnectRef.current = false
              closeStatusRef.current = 'error'
              statusChangeRef.current('error')
              xterm.writeln(`\r\n${tr(
                language,
                `[会话暂时不可用] ${message.message || 'worker 重连后未恢复该终端会话。'}`,
                `[session unavailable] ${message.message || 'the worker reconnected without restoring this terminal session.'}`,
              )}`)
              return
            case 'error':
              if (fallbackToServer()) {
                return
              }
              readyRef.current = false
              closeStatusRef.current = 'error'
              statusChangeRef.current('error')
              xterm.writeln(`\r\n[error] ${message.message}`)
              return
          }
        } catch {
          xterm.writeln(String(event.data))
        }
      })

      currentSocket.addEventListener('close', () => {
        if (disposed || connectVersionRef.current !== connectVersion) {
          return
        }

        window.clearTimeout(currentConnectTimer)
        window.clearTimeout(currentReadyTimer)
        if (fallbackToServer()) {
          return
        }
        readyRef.current = false
        statusChangeRef.current(closeStatusRef.current)
        if (!closed && shouldReconnectRef.current) {
          remoteRenderStartedRef.current = false
          snapshotRenderedRef.current = false
          reconnectTimerRef.current = window.setTimeout(() => {
            if (!disposed && connectVersionRef.current === connectVersion) {
              connectSocket()
            }
          }, 1500)
        }
      })

      currentSocket.addEventListener('error', () => {
        if (disposed || connectVersionRef.current !== connectVersion) {
          return
        }

        window.clearTimeout(currentConnectTimer)
        window.clearTimeout(currentReadyTimer)
        if (fallbackToServer()) {
          return
        }
        readyRef.current = false
        closeStatusRef.current = 'error'
        statusChangeRef.current('error')
        xterm.writeln(`\r\n[terminal connection error] ${t('workspace.terminal.connectError', { defaultValue: '终端连接失败，但不代表任务执行失败。' })}`)
      })
    }

    const buildServerOriginFallbackUrl = (serverUrl: string) => {
      const originUrl = buildTerminalServerWsUrl({
        cwd,
        executorId,
        executorRealtimeBaseUrl,
        ignoreExecutorRealtimeBaseUrl: true,
        projectId,
        terminalId,
        terminalScope,
        terminalTitle,
        workspaceId,
      })
      return originUrl && originUrl !== serverUrl ? originUrl : ''
    }

    const connectSocket = () => {
      void resolvePreferredTerminalWsUrl().then(({ url: wsUrl, serverUrl, transport }) => {
        if (disposed || connectVersionRef.current !== connectVersion) {
          return
        }

        if (!wsUrl) {
          statusChangeRef.current('error')
          xterm.writeln(transport === 'local-direct'
            ? tr(language, `本机直连不可用，请切回自动选择或 ${remoteTransportLabel}。`, `Local direct is unavailable. Switch back to Auto or ${remoteTransportLabel}.`)
            : transport === 'public-gateway'
              ? tr(language, `公网终端入口不可用，请切回自动选择或 ${remoteTransportLabel}。`, `Public terminal gateway is unavailable. Switch back to Auto or ${remoteTransportLabel}.`)
            : t('workspace.terminal.notLoggedIn', { defaultValue: '未登录，无法连接远程终端。' }))
          return
        }

        openTerminalSocket(
          wsUrl,
          transport,
          serverUrl,
          transportPreference === 'auto',
          buildServerOriginFallbackUrl(serverUrl),
        )
      })
    }

    const handleResize = () => {
      const currentTerminal = xtermRef.current
      const currentFitAddon = fitAddonRef.current
      if (!currentTerminal || !currentFitAddon || !currentTerminal.element) {
        return
      }

      fitTerminal(currentTerminal, currentFitAddon)
      if (!readyRef.current) {
        return
      }

      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols: currentTerminal.cols, rows: currentTerminal.rows }))
      }
    }

    const openWhenSized = () => {
      if (disposed || connectVersionRef.current !== connectVersion) {
        return
      }

      if (!mountNode.isConnected) {
        return
      }

      if (mountNode.clientWidth === 0 || mountNode.clientHeight === 0) {
        rafId = window.requestAnimationFrame(openWhenSized)
        return
      }

      xterm.open(mountNode)
      fitTerminal(xterm, fitAddon)
      xterm.focus()
      resizeObserver = new ResizeObserver(() => handleResize())
      resizeObserver.observe(mountNode)
      connectSocket()
    }

    rafId = window.requestAnimationFrame(openWhenSized)
    xterm.writeln(`${tr(language, '正在连接到', 'Connecting to')} ${executorName}...`)

    disposeInput = xterm.onData((input) => {
      if (!readyRef.current || socket?.readyState !== WebSocket.OPEN) {
        return
      }

      recordCommandInput(input)
      socket.send(JSON.stringify({ type: 'input', input }))
    })
  }, [closed, cwd, executorId, executorName, executorRealtimeBaseUrl, language, localWorkerEndpoint, localWorkerExecutorId, paused, projectId, recordCommandInput, remoteTransportKind, remoteTransportLabel, t, terminalId, terminalScope, terminalTitle, transport, transportPreference, workspaceId])

  useEffect(() => () => {
    cleanupRef.current()
  }, [])

  return <div ref={mountRef} className="h-full w-full p-2" />
})

function WorkspaceTerminalPanelContent({
  collapsed,
  cwd,
  executorId,
  executorName,
  executorRealtimeBaseUrl,
  projectId,
  workspaceId,
  logsCommand = '',
  maximized = false,
  installCommand = '',
  isMobile = false,
  panelKey,
  resourceActive = true,
  shouldLoadSessions = true,
  commandRequest = null,
  workspaceName,
  onCollapsedChange,
  onMaximizedChange,
  onOpenStateChange,
}: WorkspaceTerminalPanelProps) {
  const { language, t } = useTranslation()
  const queryClient = useQueryClient()
  const resourceStatus = useWorkbenchResource({
    resourceKey: `terminal:${panelKey}`,
    type: 'terminal',
    active: resourceActive && !collapsed,
  })
  const terminalScope = resolveTerminalScope(workspaceId)
  const terminalSessionsQueryKey = useMemo(() => (
    executorId ? workspaceQueryKeys.terminalSessions(executorId, workspaceId, terminalScope) : null
  ), [executorId, terminalScope, workspaceId])
  const [panes, setPanes] = useState<TerminalPaneRecord[]>([])
  const [activePaneId, setActivePaneId] = useState('')
  const [paneStatuses, setPaneStatuses] = useState<Record<string, TerminalConnectionStatus>>({})
  const [paneTransports, setPaneTransports] = useState<Record<string, TerminalTransport>>({})
  const [paneTransportPreferences, setPaneTransportPreferences] = useState<Record<string, TerminalTransportPreference>>({})
  const [paneTransportProbes, setPaneTransportProbes] = useState<Record<string, Partial<Record<TerminalTransport, TerminalTransportProbeSnapshot>>>>({})
  const [paneTransportVersions, setPaneTransportVersions] = useState<Record<string, number>>({})
  const [localWorkerExecutorId, setLocalWorkerExecutorId] = useState<string>()
  const [localWorkerEndpoint, setLocalWorkerEndpoint] = useState<LocalWorkerEndpoint>()
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const [loadingPanes, setLoadingPanes] = useState(false)
  const paneHandleMapRef = useRef(new Map<string, WorkspaceTerminalInstanceHandle | null>())
  const bindingPaneIdsRef = useRef<Record<string, string>>({})
  const dismissedCommandRequestIdRef = useRef('')
  const lastHandledCommandRequestIdRef = useRef('')
  const activePaneIdRef = useRef('')
  const panesRef = useRef<TerminalPaneRecord[]>([])
  const loadRequestVersionRef = useRef(0)
  const panelGenerationRef = useRef(0)
  const hasLoadedTerminalSessionsRef = useRef(false)
  const terminalSessionLoadInFlightRef = useRef(false)
  // Parent callbacks are often inline route setters; keep the latest version without
  // letting their changing identity restart terminal session creation.
  const onCollapsedChangeRef = useRef(onCollapsedChange)
  const onMaximizedChangeRef = useRef(onMaximizedChange)
  const onOpenStateChangeRef = useRef(onOpenStateChange)

  useEffect(() => {
    onCollapsedChangeRef.current = onCollapsedChange
    onMaximizedChangeRef.current = onMaximizedChange
    onOpenStateChangeRef.current = onOpenStateChange
  }, [onCollapsedChange, onMaximizedChange, onOpenStateChange])

  useEffect(() => {
    activePaneIdRef.current = activePaneId
  }, [activePaneId])

  useEffect(() => {
    if (resourceStatus !== 'active') {
      return
    }

    let cancelled = false
    void readLocalWorkerExecutor({
      expectedExecutorId: executorId,
    }).then((localWorker) => {
      if (!cancelled) {
        setLocalWorkerExecutorId(localWorker.executorId)
        setLocalWorkerEndpoint(localWorker.endpoint)
      }
    })
    return () => {
      cancelled = true
    }
  }, [executorId, resourceStatus])

  useEffect(() => {
    panesRef.current = panes
  }, [panes])

  const syncPanesFromSessions = useCallback((sessions: WorkspaceTerminalSessionDescriptor[]) => {
    const sortedSessions = [...sessions].sort((left, right) => {
      const leftTime = Date.parse(left.createdAt || '')
      const rightTime = Date.parse(right.createdAt || '')
      return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0)
    })

    setPanes((current) => sortedSessions.map((session, index) => {
      const existing = current.find((pane) => pane.terminalId === session.terminalId)
      return buildTerminalPaneFromSession(session, index, language, existing)
    }))
    setPaneStatuses((current) => Object.fromEntries(
      Object.entries(current).filter(([terminalId]) => sortedSessions.some((session) => session.terminalId === terminalId)),
    ))
    setPaneTransports((current) => Object.fromEntries(
      Object.entries(current).filter(([terminalId]) => sortedSessions.some((session) => session.terminalId === terminalId)),
    ))
    setPaneTransportPreferences((current) => Object.fromEntries(
      Object.entries(current).filter(([terminalId]) => sortedSessions.some((session) => session.terminalId === terminalId)),
    ))
    setPaneTransportProbes((current) => Object.fromEntries(
      Object.entries(current).filter(([terminalId]) => sortedSessions.some((session) => session.terminalId === terminalId)),
    ))
    setPaneTransportVersions((current) => Object.fromEntries(
      Object.entries(current).filter(([terminalId]) => sortedSessions.some((session) => session.terminalId === terminalId)),
    ))
    setActivePaneId((current) => (
      current && sortedSessions.some((session) => session.terminalId === current)
        ? current
        : sortedSessions[0]?.terminalId || ''
    ))
  }, [language])

  const writeTerminalSessionsCache = useCallback((sessions: WorkspaceTerminalSessionDescriptor[]) => {
    if (!terminalSessionsQueryKey) {
      return
    }
    queryClient.setQueryData(terminalSessionsQueryKey, {
      ok: true,
      sessions,
    })
  }, [queryClient, terminalSessionsQueryKey])

  const mergeTerminalSessionCache = useCallback((
    session: WorkspaceTerminalSessionDescriptor,
    sessions?: WorkspaceTerminalSessionDescriptor[],
  ) => {
    if (sessions?.length) {
      writeTerminalSessionsCache(sessions)
      return
    }
    if (!terminalSessionsQueryKey) {
      return
    }
    queryClient.setQueryData(
      terminalSessionsQueryKey,
      (current: Awaited<ReturnType<typeof api.listExecutorTerminalSessions>> | undefined) => {
        const currentSessions = current?.sessions ?? []
        return {
          ok: true,
          sessions: currentSessions.some((item) => item.terminalId === session.terminalId)
            ? currentSessions.map((item) => item.terminalId === session.terminalId ? session : item)
            : [...currentSessions, session],
        }
      },
    )
  }, [queryClient, terminalSessionsQueryKey, writeTerminalSessionsCache])

  const removeTerminalSessionsCache = useCallback((terminalIds: string[]) => {
    if (!terminalSessionsQueryKey) {
      return
    }
    const terminalIdSet = new Set(terminalIds)
    queryClient.setQueryData(
      terminalSessionsQueryKey,
      (current: Awaited<ReturnType<typeof api.listExecutorTerminalSessions>> | undefined) => ({
        ok: true,
        sessions: (current?.sessions ?? []).filter((session) => !terminalIdSet.has(session.terminalId)),
      }),
    )
  }, [queryClient, terminalSessionsQueryKey])

  const createTerminalSession = useCallback(async (params: {
    terminalId: string
    title: string
    select?: boolean
  }) => {
    const panelGeneration = panelGenerationRef.current

    if (!executorId) {
      throw new Error(t('workspace.terminal.notReady', { defaultValue: '终端还没准备好，请稍后再试。' }))
    }

    const result = await api.createExecutorTerminalSession(executorId, {
      terminalId: params.terminalId,
      workspaceId,
      scope: terminalScope,
      title: params.title,
      cwd,
    })

    if (!result.ok || !result.session) {
      throw new Error(result.message || t('workspace.terminal.connectError', { defaultValue: '终端连接失败，但不代表任务执行失败。' }))
    }
    if (panelGenerationRef.current !== panelGeneration) {
      return result.session
    }

    mergeTerminalSessionCache(result.session, result.sessions)
    if (result.sessions?.length) {
      syncPanesFromSessions(result.sessions)
    } else {
      setPanes((current) => upsertTerminalPaneFromSession(current, result.session!, language))
    }
    if (params.select !== false) {
      setActivePaneId(result.session.terminalId)
    }
    onOpenStateChangeRef.current?.(true)
    return result.session
  }, [cwd, executorId, language, mergeTerminalSessionCache, syncPanesFromSessions, t, terminalScope, workspaceId])

  const ensureDefaultPane = useCallback(async () => {
    const session = await createTerminalSession({
      terminalId: 'default',
      title: createTerminalPaneTitle(0, language),
      select: true,
    })
    hasLoadedTerminalSessionsRef.current = true
    return session
  }, [createTerminalSession, language])

  const handleTerminalSessionLoadError = useCallback((error: unknown) => {
    hasLoadedTerminalSessionsRef.current = true
    toast.error(error instanceof Error ? error.message : t('workspace.terminal.connectError', { defaultValue: '终端连接失败，但不代表任务执行失败。' }))
    setPanes([])
    setActivePaneId('')
    setPaneStatuses({})
    setPaneTransports({})
    setPaneTransportPreferences({})
    setPaneTransportProbes({})
    setPaneTransportVersions({})
    setLoadingPanes(false)
    onOpenStateChangeRef.current?.(false)
  }, [t])

  const loadTerminalSessions = useCallback(async (options?: { createDefaultIfEmpty?: boolean; force?: boolean }) => {
    const requestVersion = ++loadRequestVersionRef.current

    if (!executorId) {
      if (loadRequestVersionRef.current === requestVersion) {
        setPanes([])
        setActivePaneId('')
        setPaneStatuses({})
        onOpenStateChangeRef.current?.(false)
      }
      return []
    }

    if (loadRequestVersionRef.current === requestVersion) {
      setLoadingPanes(true)
    }
    try {
      if (terminalSessionsQueryKey && options?.force) {
        await queryClient.invalidateQueries({ queryKey: terminalSessionsQueryKey, exact: true })
      }
      const result = terminalSessionsQueryKey
        ? await queryClient.fetchQuery({
            queryKey: terminalSessionsQueryKey,
            queryFn: () => api.listExecutorTerminalSessions(executorId, {
              workspaceId,
              scope: terminalScope,
            }),
            staleTime: 5_000,
          })
        : await api.listExecutorTerminalSessions(executorId, {
            workspaceId,
            scope: terminalScope,
          })
      let sessions = result.sessions ?? []
      if (sessions.length === 0 && options?.createDefaultIfEmpty !== false) {
        const created = await api.createExecutorTerminalSession(executorId, {
          terminalId: 'default',
          workspaceId,
          scope: terminalScope,
          title: createTerminalPaneTitle(0, language),
          cwd,
        })
        sessions = created.session ? [created.session] : []
        if (created.session) {
          mergeTerminalSessionCache(created.session, created.sessions ?? sessions)
        }
      }
      if (loadRequestVersionRef.current !== requestVersion) {
        return sessions
      }
      writeTerminalSessionsCache(sessions)
      syncPanesFromSessions(sessions)
      onOpenStateChangeRef.current?.(sessions.length > 0)
      hasLoadedTerminalSessionsRef.current = true
      return sessions
    } catch (error) {
      if (loadRequestVersionRef.current !== requestVersion) {
        return []
      }
      hasLoadedTerminalSessionsRef.current = true
      toast.error(error instanceof Error ? error.message : t('workspace.terminal.connectError', { defaultValue: '终端连接失败，但不代表任务执行失败。' }))
      setPanes([])
      setActivePaneId('')
      setPaneStatuses({})
      onOpenStateChangeRef.current?.(false)
      return []
    } finally {
      if (loadRequestVersionRef.current === requestVersion) {
        setLoadingPanes(false)
      }
    }
  }, [
    cwd,
    executorId,
    language,
    mergeTerminalSessionCache,
    queryClient,
    syncPanesFromSessions,
    t,
    terminalScope,
    terminalSessionsQueryKey,
    workspaceId,
    writeTerminalSessionsCache,
  ])

  useEffect(() => {
    panelGenerationRef.current += 1
    loadRequestVersionRef.current += 1
    hasLoadedTerminalSessionsRef.current = false
    terminalSessionLoadInFlightRef.current = false
    paneHandleMapRef.current.clear()
    bindingPaneIdsRef.current = {}
    dismissedCommandRequestIdRef.current = ''
    lastHandledCommandRequestIdRef.current = ''
    setCloseConfirmOpen(false)
    setPanes([])
    setActivePaneId('')
    setPaneStatuses({})
    setPaneTransports({})
    setPaneTransportPreferences({})
    setPaneTransportProbes({})
    setPaneTransportVersions({})
    setLoadingPanes(false)
  }, [executorId, panelKey, terminalScope, workspaceId])

  useEffect(() => {
    if (resourceStatus !== 'active') {
      return
    }

    if (shouldLoadSessions === false) {
      hasLoadedTerminalSessionsRef.current = false
      setLoadingPanes(false)
      return
    }

    if (hasLoadedTerminalSessionsRef.current || terminalSessionLoadInFlightRef.current) {
      return
    }

    // Loading may create the default terminal. Guard it so an offline executor or
    // parent open-state update cannot loop into repeated POST /terminal-sessions.
    terminalSessionLoadInFlightRef.current = true
    void loadTerminalSessions({ createDefaultIfEmpty: true })
      .finally(() => {
        terminalSessionLoadInFlightRef.current = false
      })
  }, [loadTerminalSessions, panelKey, resourceStatus, shouldLoadSessions])

  const terminalClosed = !loadingPanes && panes.length === 0

  useEffect(() => {
    if (collapsed || terminalClosed) {
      setCloseConfirmOpen(false)
    }
  }, [collapsed, terminalClosed])

  useEffect(() => {
    if (panes.length === 0) {
      return
    }

    if (!activePaneId || !panes.some((pane) => pane.id === activePaneId)) {
      setActivePaneId(panes[0]?.id || '')
    }
  }, [activePaneId, panes])

  useEffect(() => {
    if (!collapsed) {
      return
    }

    paneHandleMapRef.current.clear()
    setPaneStatuses({})
    setPaneTransports({})
    setPaneTransportPreferences({})
    setPaneTransportProbes({})
    setPaneTransportVersions({})
  }, [collapsed])

  const resolvePaneDisplayStatus = useCallback((pane: TerminalPaneRecord): TerminalConnectionStatus => {
    const runtimeStatus = paneStatuses[pane.id]
    if (runtimeStatus) {
      return runtimeStatus
    }

    if (pane.exitedAt) {
      return 'closed'
    }

    return collapsed ? 'ready' : 'closed'
  }, [collapsed, paneStatuses])

  const activePane = panes.find((pane) => pane.id === activePaneId)
  const activeRuntimeStatus = paneStatuses[activePaneId] ?? 'closed'
  const activeStatus = terminalClosed
    ? 'closed'
    : loadingPanes
      ? 'connecting'
      : activePane
        ? resolvePaneDisplayStatus(activePane)
        : 'closed'
  const terminalStatusLabel = activeStatus === 'connecting'
    ? t('workspace.terminal.status.connecting', { defaultValue: '连接中' })
    : activeStatus === 'ready'
      ? t('workspace.terminal.status.ready', { defaultValue: '已连接' })
      : activeStatus === 'closed'
        ? t('workspace.terminal.status.closed', { defaultValue: '已关闭' })
        : t('workspace.terminal.status.error', { defaultValue: '终端异常' })
  const canControlTerminal = !collapsed && !terminalClosed && activeRuntimeStatus === 'ready'
  const canRunWorkspaceCommand = canControlTerminal && Boolean(cwd)
  const canRunLogsWorkspaceCommand = canRunWorkspaceCommand && Boolean(logsCommand.trim())
  const canOpenAnotherTerminal = Boolean(executorId)
  const activeServerWsUrl = activePane ? buildTerminalServerWsUrl({
    cwd,
    executorId,
    executorRealtimeBaseUrl,
    projectId,
    terminalId: activePane.terminalId,
    terminalScope,
    terminalTitle: activePane.connectionTitle,
    workspaceId,
  }) : ''
  const activeTransportPreference = activePane ? paneTransportPreferences[activePane.id] ?? 'auto' : 'auto'
  const activeTransportProbes = activePane ? paneTransportProbes[activePane.id] : undefined
  const activeCanUseLocalDirect = canUseLocalDirectTerminal({
    workspaceExecutorId: executorId,
    localWorkerExecutorId,
  }) || Boolean(executorId && localWorkerExecutorId && workspaceId && executorId !== localWorkerExecutorId)
  const activeCanUsePublicGateway = activeTransportProbes?.['public-gateway']?.status === 'ok'
  const activeRemoteTransportKind = resolveTerminalRemoteTransportKind({
    executorRealtimeBaseUrl,
    currentPageOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
  })
  const activeTransport = activePane
    ? resolveActiveTerminalTransport({
        preference: activeTransportPreference,
        serverAvailable: Boolean(activeServerWsUrl),
        localDirectAvailable: activeCanUseLocalDirect && activeTransportProbes?.['local-direct']?.status === 'ok',
        publicGatewayAvailable: activeCanUsePublicGateway,
        transportProbes: activeTransportProbes,
      })
    : 'server'
  const activeTransportLabel = resolveTerminalTransportLabel(activeTransport, activeRemoteTransportKind)
  const activeTransportLatencyMs = activeTransportProbes?.[activeTransport]?.roundTripMs
  const inactiveRemoteTransportKind = activeRemoteTransportKind === 'gateway' ? 'tunnel' : 'gateway'
  const inactiveRemoteTransportLabel = resolveTerminalRemoteTransportName(inactiveRemoteTransportKind)
  const localDirectUnavailableDetail = executorId && localWorkerExecutorId && executorId !== localWorkerExecutorId
    ? '本机 Worker 会尝试通过 EasyTier Mesh 连接远端执行节点'
    : resolveLocalDirectTerminalUnavailableDetail({
        workspaceExecutorId: executorId,
        localWorkerExecutorId,
      })
  const activeTransportOptions = resolveTerminalTransportOptions({
    remoteTransport: activeRemoteTransportKind,
    localDirectDetail: localWorkerEndpoint?.terminalDirectWsUrl,
    localDirectUnavailableDetail,
    publicGatewayDetail: '公网终端入口直连，不经过云端 Tunnel',
    publicGatewayUnavailableDetail: resolveTerminalRemoteTransportUnavailableDetail('gateway'),
    serverUrl: activeServerWsUrl,
    transportProbes: activeTransportProbes,
  })
  const activeTransportOption = activeTransportOptions.find((option) => option.transport === activeTransport)
  const activeTransportProbeKey = activePane
    ? [
        activePane.id,
        activeServerWsUrl,
        executorId || '',
        localWorkerEndpoint?.terminalDirectWsUrl || '',
        localWorkerExecutorId || '',
        terminalScope,
        workspaceId || '',
      ].join(':')
    : ''
  const workspaceDisplayName = workspaceName?.trim() || workspaceId || panelKey

  useEffect(() => {
    if (resourceStatus !== 'active' || !activePane || collapsed || terminalClosed || !executorId) {
      return
    }

    let cancelled = false
    const paneId = activePane.id
    const serverUrl = activeServerWsUrl
    const canProbeLocalDirect = activeCanUseLocalDirect
    const canProbePublicGateway = Boolean(executorId)

    setPaneTransportProbes((current) => ({
      ...current,
      [paneId]: {
        server: serverUrl ? { status: 'probing' } : { status: 'unavailable' },
        'local-direct': canProbeLocalDirect ? { status: 'probing' } : { status: 'unavailable' },
        'public-gateway': canProbePublicGateway ? { status: 'probing' } : { status: 'unavailable' },
      },
    }))

    if (serverUrl) {
      void probeTerminalTransportSocket(serverUrl).then((snapshot) => {
        if (cancelled) {
          return
        }
        setPaneTransportProbes((current) => ({
          ...current,
          [paneId]: {
            ...current[paneId],
            server: snapshot,
          },
        }))
      })
    }

    if (canProbeLocalDirect) {
      void api.createExecutorTerminalLocalAttachTicket(executorId, {
        terminalId: activePane.terminalId,
        workspaceId,
        scope: terminalScope,
        cwd,
        meshSourceExecutorId: localWorkerExecutorId,
        transport: executorId && localWorkerExecutorId && executorId !== localWorkerExecutorId ? 'mesh' : 'local-direct',
      }).then(async (ticket) => {
        if (!ticket.ok || !ticket.ticket) {
          return {
            status: 'error',
            error: ticket.message || '本机直连票据不可用',
          } satisfies TerminalTransportProbeSnapshot
        }
        const localUrl = ticket.wsUrl?.includes('/api/terminal-mesh/ws')
            ? buildLocalTerminalMeshBridgeWsUrl({
              ticket: ticket.ticket,
              targetWsUrl: ticket.wsUrl,
              endpoint: localWorkerEndpoint,
            })
            : buildLocalDirectTerminalWsUrl({
              ticket: ticket.ticket,
              wsUrl: ticket.wsUrl,
            })
        if (!localUrl) {
          return {
            status: 'error',
            error: '本机直连地址不可用',
          } satisfies TerminalTransportProbeSnapshot
        }
        return probeTerminalTransportSocket(localUrl)
      }).catch((error) => ({
        status: 'error',
        error: error instanceof Error ? error.message : '本机直连探测失败',
      }) satisfies TerminalTransportProbeSnapshot).then((snapshot) => {
        if (cancelled) {
          return
        }
        setPaneTransportProbes((current) => ({
          ...current,
          [paneId]: {
            ...current[paneId],
            'local-direct': snapshot,
          },
        }))
      })
    }

    if (canProbePublicGateway) {
      void api.createExecutorTerminalLocalAttachTicket(executorId, {
        terminalId: activePane.terminalId,
        workspaceId,
        scope: terminalScope,
        cwd,
        transport: 'public-gateway',
      }).then(async (ticket) => {
        if (!ticket.ok || !ticket.ticket) {
          return {
            status: 'unavailable',
            error: ticket.message || '当前节点未配置公网终端入口',
          } satisfies TerminalTransportProbeSnapshot
        }
        const publicGatewayUrl = buildPublicTerminalGatewayWsUrl({
          ticket: ticket.ticket,
          wsUrl: ticket.wsUrl,
        })
        if (!publicGatewayUrl) {
          return {
            status: 'unavailable',
            error: '公网终端入口不可用',
          } satisfies TerminalTransportProbeSnapshot
        }
        return probeTerminalTransportSocket(publicGatewayUrl)
      }).catch((error) => ({
        status: 'error',
        error: error instanceof Error ? error.message : '公网终端入口探测失败',
      }) satisfies TerminalTransportProbeSnapshot).then((snapshot) => {
        if (cancelled) {
          return
        }
        setPaneTransportProbes((current) => ({
          ...current,
          [paneId]: {
            ...current[paneId],
            'public-gateway': snapshot,
          },
        }))
      })
    }

    return () => {
      cancelled = true
    }
  }, [activeTransportProbeKey, collapsed, resourceStatus, terminalClosed])

  const renderPaneStatusDot = (pane: TerminalPaneRecord) => {
    const status = terminalClosed ? 'closed' : resolvePaneDisplayStatus(pane)

    if (status === 'connecting') {
      return <Loader2 className="h-3 w-3 animate-spin text-sky-300" />
    }

    return (
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'ready'
            ? 'bg-emerald-400'
            : status === 'error'
              ? 'bg-rose-400'
              : 'bg-zinc-500',
        )}
      />
    )
  }

  const renderPaneBindingBadge = (pane: TerminalPaneRecord, active: boolean) => {
    if (pane.bindingKey !== 'environment') {
      return null
    }

    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center rounded-full px-1 py-0 text-[9px] font-semibold tracking-[0.1em]',
          active
            ? 'bg-emerald-500/18 text-emerald-300'
            : 'bg-emerald-500/10 text-emerald-400/90',
        )}
      >
        {tr(language, 'Dev', 'DEV')}
      </span>
    )
  }

  const renderPaneBackendBadge = (pane: TerminalPaneRecord, active: boolean) => {
    const label = resolveTerminalBackendLabel(pane, language)
    if (!label) {
      return null
    }

    const persistentTitle = pane.backend === 'zellij' && pane.persistent !== false
      ? tr(language, 'zellij 持久终端，worker 重启后会尝试恢复', 'zellij persistent terminal, restored after worker restarts when possible')
      : tr(language, '普通终端，worker 重启后不会保留进程', 'Regular terminal, process is not kept across worker restarts')

    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center rounded-sm border px-1 py-0 text-[9px] font-medium',
          active
            ? 'border-zinc-700 bg-zinc-900 text-zinc-300'
            : 'border-zinc-800 bg-zinc-950 text-zinc-500',
        )}
        title={persistentTitle}
      >
        {label}
      </span>
    )
  }

  const renderHeaderInfoBar = () => {
    if (!activePane) {
      return null
    }

    return (
      <div className="flex h-6 min-w-[18rem] max-w-[34rem] shrink-0 items-center gap-2 border-r border-zinc-900 bg-[#0b0c0d] px-2 text-[10px] text-zinc-500">
        <span className="flex min-w-0 max-w-[10rem] items-center gap-1" title={executorName}>
          <span className="shrink-0 text-zinc-600">节点</span>
          <span className="truncate text-zinc-300">{executorName}</span>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex h-5 min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] transition-colors',
                activeTransport === 'local-direct'
                  ? 'text-emerald-400 hover:text-emerald-300'
                  : 'text-zinc-400 hover:text-zinc-200',
              )}
              title={resolveTerminalTransportLabel(activeTransport, activeRemoteTransportKind)}
              aria-label={t('workspace.terminal.transport', { defaultValue: '切换终端连接方式' })}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', resolveTransportStatusDotTone(activeTransportOption?.status ?? 'idle', Boolean(activeTransportOption?.available)))} />
              <span className="font-medium">{activeTransportLabel}</span>
              <ChevronDown className="h-2.5 w-2.5 opacity-40" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={6} className="w-60 rounded-lg p-1">
            <DropdownMenuLabel className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              连接方式
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={activeTransportPreference}
              onValueChange={(value) => {
                if (value !== 'auto' && value !== 'local-direct' && value !== 'public-gateway' && value !== 'server') {
                  return
                }
                handleTransportPreferenceChange(activePane.id, value)
              }}
            >
              <DropdownMenuRadioItem value="auto" className="gap-2.5 rounded-lg px-2 py-2">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950">
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-zinc-100">自动选择</span>
                    <span className="block truncate text-[11px] leading-4 text-zinc-500">
                      使用延迟最低的可用链路
                    </span>
                  </span>
                </span>
              </DropdownMenuRadioItem>
              {activeTransportOptions.map((option) => (
                <DropdownMenuRadioItem
                  key={option.transport}
                  value={option.transport}
                  disabled={!option.available}
                  className="gap-2.5 rounded-lg px-2 py-2"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950">
                      <span className={cn('h-1.5 w-1.5 rounded-full', resolveTransportStatusDotTone(option.status, option.available))} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-zinc-100">{option.label}</span>
                        <span className="shrink-0 font-mono text-[11px] text-zinc-600">{formatLatencyValue(option.latencyMs)}</span>
                      </span>
                      <span className="block truncate text-[11px] leading-4 text-zinc-500">
                        {option.available
                          ? option.status === 'error' ? option.error || '连接异常' : '可用'
                          : option.detail}
                      </span>
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {inactiveRemoteTransportLabel && (
              <>
                <DropdownMenuSeparator className="my-1" />
                <div className="flex items-center gap-2 rounded-lg px-2 py-2 opacity-50">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-zinc-900 bg-zinc-950">
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-zinc-500">{inactiveRemoteTransportLabel}</span>
                    <span className="block truncate text-[11px] leading-4 text-zinc-600">不可用</span>
                  </span>
                </div>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="flex min-w-0 flex-1 items-center gap-1" title={workspaceDisplayName}>
          <span className="shrink-0 text-zinc-600">工作区</span>
          <span className="truncate text-zinc-300">{workspaceDisplayName}</span>
        </span>
      </div>
    )
  }

  const dismissActiveCommandRequest = useCallback(() => {
    if (commandRequest?.id) {
      dismissedCommandRequestIdRef.current = commandRequest.id
    }
  }, [commandRequest])

  const dropPaneBindings = useCallback((paneId: string) => {
    for (const [bindingKey, boundPaneId] of Object.entries(bindingPaneIdsRef.current)) {
      if (boundPaneId === paneId) {
        delete bindingPaneIdsRef.current[bindingKey]
      }
    }
  }, [])

  const applyOptimisticPaneState = useCallback((nextPanes: TerminalPaneRecord[], options?: {
    removedPaneId?: string
  }) => {
    loadRequestVersionRef.current += 1
    setLoadingPanes(false)
    setCloseConfirmOpen(false)

    if (options?.removedPaneId) {
      dropPaneBindings(options.removedPaneId)
      paneHandleMapRef.current.delete(options.removedPaneId)
      setPaneStatuses((current) => {
        const next = { ...current }
        delete next[options.removedPaneId!]
        return next
      })
      setPaneTransports((current) => {
        const next = { ...current }
        delete next[options.removedPaneId!]
        return next
      })
      setPaneTransportPreferences((current) => {
        const next = { ...current }
        delete next[options.removedPaneId!]
        return next
      })
      setPaneTransportVersions((current) => {
        const next = { ...current }
        delete next[options.removedPaneId!]
        return next
      })
    } else {
      bindingPaneIdsRef.current = {}
      paneHandleMapRef.current.clear()
      setPaneStatuses({})
      setPaneTransports({})
      setPaneTransportPreferences({})
      setPaneTransportProbes({})
      setPaneTransportVersions({})
    }

    const nextActivePaneId = nextPanes.length === 0
      ? ''
      : activePaneIdRef.current && nextPanes.some((pane) => pane.id === activePaneIdRef.current)
        ? activePaneIdRef.current
        : (nextPanes[0]?.id || '')

    setPanes(nextPanes)
    setActivePaneId(nextActivePaneId)

    if (nextPanes.length === 0) {
      panelGenerationRef.current += 1
      dismissActiveCommandRequest()
      onMaximizedChangeRef.current?.(false)
      onOpenStateChangeRef.current?.(false)
      onCollapsedChangeRef.current(true)
    }

    return nextPanes
  }, [dismissActiveCommandRequest, dropPaneBindings])

  const handlePaneCommandSubmit = useCallback((paneId: string, command: string) => {
    setPanes((current) => current.map((pane) => (
      pane.id === paneId
        ? pane.bindingKey
          ? {
              ...pane,
              lastCommand: command,
              title: buildBoundTerminalPaneTitle(pane.bindingKey, language, command),
            }
          : {
              ...pane,
              lastCommand: command,
              title: command,
            }
        : pane
    )))
  }, [language])

  const sendTerminalInput = useCallback((input: string, paneId?: string) => {
    const targetPaneId = paneId || activePaneId
    const paneHandle = paneHandleMapRef.current.get(targetPaneId) ?? null

    if (!paneHandle?.sendInput(input)) {
      toast.error(t('workspace.terminal.notReady', { defaultValue: '终端还没准备好，请稍后再试。' }))
      return false
    }

    return true
  }, [activePaneId, t])

  const runWorkspaceCommand = useCallback((
    command: string,
    successMessage: string,
    options?: {
      paneId?: string
    },
  ) => {
    if (!cwd) {
      toast.error(t('workspace.terminal.noCwd', { defaultValue: '当前终端还没有可执行命令的目录。' }))
      return false
    }

    const targetPaneId = options?.paneId || activePaneId
    const terminalCommand = command

    if (sendTerminalInput(`${terminalCommand}\r`, targetPaneId)) {
      toast.success(successMessage)
      return true
    }

    return false
  }, [activePaneId, cwd, sendTerminalInput, t])

  const interruptWorkspaceCommand = useCallback((successMessage: string, paneId?: string) => {
    if (sendTerminalInput('\u0003', paneId)) {
      toast.success(successMessage)
      return true
    }

    return false
  }, [sendTerminalInput])

  useEffect(() => {
    if (!commandRequest) {
      return
    }

    if (lastHandledCommandRequestIdRef.current === commandRequest.id) {
      return
    }

    if (dismissedCommandRequestIdRef.current === commandRequest.id) {
      return
    }

    const boundPaneId = commandRequest.bindingKey ? bindingPaneIdsRef.current[commandRequest.bindingKey] : undefined
    const fallbackPaneId = activePaneId || panes[0]?.id || ''
    const focusPaneId = boundPaneId && panes.some((pane) => pane.id === boundPaneId)
      ? boundPaneId
      : fallbackPaneId
    const readyPaneId = boundPaneId && paneStatuses[boundPaneId] === 'ready'
      ? boundPaneId
      : paneStatuses[activePaneId] === 'ready'
        ? activePaneId
        : undefined

    if (collapsed) {
      return
    }

    if (terminalClosed) {
      onOpenStateChangeRef.current?.(true)
      if (terminalSessionLoadInFlightRef.current || !hasLoadedTerminalSessionsRef.current) {
        return
      }
      dismissedCommandRequestIdRef.current = commandRequest.id
      return
    }

    if (commandRequest.kind === 'focus') {
      if (!focusPaneId) {
        return
      }

      setActivePaneId(focusPaneId)
      paneHandleMapRef.current.get(focusPaneId)?.focus()
      lastHandledCommandRequestIdRef.current = commandRequest.id
      return
    }

    if (!readyPaneId) {
      return
    }

    const actionOk = commandRequest.kind === 'interrupt'
      ? interruptWorkspaceCommand(
          commandRequest.successMessage || t('workspace.terminal.stopSent', { defaultValue: '已向终端发送停止信号。' }),
          readyPaneId,
        )
      : commandRequest.command?.trim()
        ? runWorkspaceCommand(
          commandRequest.command.trim(),
          commandRequest.successMessage || tr(
              language,
              `已在当前终端执行 ${commandRequest.command.trim()}。`,
              `Started ${commandRequest.command.trim()} in the current terminal.`,
            ),
            {
              paneId: readyPaneId,
            },
          )
        : false

    if (actionOk) {
      if (commandRequest.kind === 'command' && commandRequest.bindingKey) {
        bindingPaneIdsRef.current[commandRequest.bindingKey] = readyPaneId
        setPanes((current) => current.map((pane) => (
          pane.id === readyPaneId
            ? {
                ...pane,
                bindingKey: commandRequest.bindingKey,
                lastCommand: commandRequest.command?.trim() || pane.lastCommand,
                title: buildBoundTerminalPaneTitle(commandRequest.bindingKey, language, commandRequest.command),
              }
            : pane
        )))
      }
      lastHandledCommandRequestIdRef.current = commandRequest.id
      setActivePaneId(readyPaneId)
    }
  }, [activePaneId, collapsed, commandRequest, interruptWorkspaceCommand, language, paneStatuses, panes, runWorkspaceCommand, t, terminalClosed])

  const toggleTerminalMaximized = () => {
    if (collapsed) {
      if (terminalClosed) {
        void ensureDefaultPane().catch(handleTerminalSessionLoadError)
      }
      onOpenStateChange?.(true)
      onCollapsedChange(false)
    }
    onMaximizedChange?.(!maximized)
  }

  const closeAllTerminals = useCallback(async () => {
    if (terminalClosed) {
      return
    }

    if (!executorId) {
      return
    }

    const panesToClose = panesRef.current
    applyOptimisticPaneState([])
    writeTerminalSessionsCache([])

    try {
      const results = await Promise.allSettled(panesToClose.map((pane) => api.closeExecutorTerminalSession(executorId, {
        terminalId: pane.terminalId,
        workspaceId,
        scope: terminalScope,
      })))
      const failedResult = results.find((result) => result.status === 'rejected')
      if (failedResult?.status === 'rejected') {
        throw failedResult.reason
      }
      toast.success(tr(language, '终端已关闭。', 'Terminal closed.'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr(language, '关闭终端失败。', 'Failed to close terminal.'))
      void loadTerminalSessions({ createDefaultIfEmpty: false, force: true })
    }
  }, [applyOptimisticPaneState, executorId, language, loadTerminalSessions, terminalClosed, terminalScope, workspaceId, writeTerminalSessionsCache])

  const handleCloseTerminalPanel = () => {
    if (terminalClosed) {
      setCloseConfirmOpen(false)
      onMaximizedChange?.(false)
      onOpenStateChange?.(false)
      onCollapsedChange(true)
    }
  }

  const handleNewTerminal = () => {
    if (!executorId) {
      toast.error(t('workspace.terminal.notReady', { defaultValue: '终端还没准备好，请稍后再试。' }))
      return
    }

    const terminalId = `terminal-${crypto.randomUUID()}`
    const title = createTerminalPaneTitle(panes.length, language)
    setCloseConfirmOpen(false)
    onCollapsedChange(false)
    void createTerminalSession({
      terminalId,
      title,
      select: true,
    }).catch((error) => {
      toast.error(error instanceof Error ? error.message : tr(language, '新终端创建失败。', 'Failed to create a new terminal.'))
    })
  }

  const handleSelectPane = (paneId: string) => {
    setCloseConfirmOpen(false)
    setActivePaneId(paneId)
    onOpenStateChange?.(true)
    if (collapsed) {
      onCollapsedChange(false)
    }
  }

  const handleTransportPreferenceChange = useCallback((paneId: string, preference: TerminalTransportPreference) => {
    setPaneTransportPreferences((current) => ({
      ...current,
      [paneId]: preference,
    }))
    setPaneTransportVersions((current) => ({
      ...current,
      [paneId]: (current[paneId] ?? 0) + 1,
    }))
    setPaneStatuses((current) => ({
      ...current,
      [paneId]: 'connecting',
    }))
  }, [])

  const handleClosePane = useCallback(async (paneId: string) => {
    if (!executorId) {
      return
    }

    const pane = panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const nextPanes = panesRef.current.filter((item) => item.id !== paneId)
    applyOptimisticPaneState(nextPanes, { removedPaneId: paneId })
    removeTerminalSessionsCache([pane.terminalId])

    try {
      await api.closeExecutorTerminalSession(executorId, {
        terminalId: pane.terminalId,
        workspaceId,
        scope: terminalScope,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr(language, '关闭终端失败。', 'Failed to close terminal.'))
      void loadTerminalSessions({ createDefaultIfEmpty: false, force: true })
    }
  }, [applyOptimisticPaneState, executorId, loadTerminalSessions, removeTerminalSessionsCache, terminalScope, workspaceId])

  const paneContent = useMemo(() => panes.map((pane) => {
    const isActivePane = pane.id === activePaneId
    const transportPreference = paneTransportPreferences[pane.id] ?? 'auto'
    const transportVersion = paneTransportVersions[pane.id] ?? 0
    const serverWsUrl = buildTerminalServerWsUrl({
      cwd,
      executorId,
      executorRealtimeBaseUrl,
      projectId,
      terminalId: pane.terminalId,
      terminalScope,
      terminalTitle: pane.connectionTitle,
      workspaceId,
    })
    const transportProbes = paneTransportProbes[pane.id]
    const transport = resolveActiveTerminalTransport({
      preference: transportPreference,
      serverAvailable: Boolean(serverWsUrl),
      localDirectAvailable: (
        canUseLocalDirectTerminal({
          workspaceExecutorId: executorId,
          localWorkerExecutorId,
        })
        || Boolean(executorId && localWorkerExecutorId && workspaceId && executorId !== localWorkerExecutorId)
      ) && transportProbes?.['local-direct']?.status === 'ok',
      publicGatewayAvailable: transportProbes?.['public-gateway']?.status === 'ok',
      transportProbes,
    })

    return (
      <div
        key={`${pane.id}:${transportVersion}:${transport}`}
        className={cn(
          'absolute inset-0 min-h-0 overflow-hidden bg-[#050506]',
          isActivePane ? 'block' : 'hidden',
        )}
      >
        <WorkspaceTerminalInstance
          ref={(handle) => {
            paneHandleMapRef.current.set(pane.id, handle)
          }}
          active={resourceStatus === 'active' && isActivePane && !collapsed}
          // Cached workspace panels stay connected while hidden. The active flag below
          // prevents focus and resize work until the user returns to that workspace.
          paused={false}
          closed={terminalClosed || resourceStatus === 'disposed'}
          cwd={cwd}
          executorId={executorId}
          executorName={executorName}
          executorRealtimeBaseUrl={executorRealtimeBaseUrl}
          projectId={projectId}
          terminalId={pane.terminalId}
          terminalScope={terminalScope}
          terminalTitle={pane.connectionTitle}
          transport={transport}
          transportPreference={transportPreference}
          localWorkerEndpoint={localWorkerEndpoint}
          localWorkerExecutorId={localWorkerExecutorId}
          workspaceId={workspaceId}
          onCommandSubmit={(command) => handlePaneCommandSubmit(pane.id, command)}
          onStatusChange={(status) => {
            setPaneStatuses((current) => ({
              ...current,
              [pane.id]: status,
            }))
          }}
          onTransportChange={(transport) => {
            setPaneTransports((current) => current[pane.id] === transport
              ? current
              : {
                  ...current,
                  [pane.id]: transport,
                })
          }}
          onTransportFailure={(transport, message) => {
            if (transport !== 'local-direct' && transport !== 'public-gateway') {
              return
            }
            setPaneTransportProbes((current) => ({
              ...current,
              [pane.id]: {
                ...current[pane.id],
                [transport]: {
                  status: 'error',
                  error: message,
                },
              },
            }))
          }}
        />
      </div>
    )
  }), [activePaneId, collapsed, cwd, executorId, executorName, executorRealtimeBaseUrl, handlePaneCommandSubmit, localWorkerEndpoint, localWorkerExecutorId, paneTransportPreferences, paneTransportProbes, paneTransportVersions, panes, projectId, resourceStatus, terminalClosed, terminalScope, workspaceId])

  return (
    <Card
      data-workspace-terminal-root
      className={collapsed ? 'w-full overflow-hidden rounded-none border-zinc-800 bg-zinc-950/60 text-zinc-100 shadow-none' : 'flex h-full min-h-0 w-full flex-col overflow-hidden rounded-none border-zinc-800 bg-zinc-950/70 text-zinc-100 shadow-none'}
    >
      <CardHeader className={collapsed ? 'w-full rounded-none bg-[#09090b] p-0' : 'w-full rounded-none border-b border-zinc-800 bg-[#09090b] p-0'}>
        <div className={cn('flex min-h-6 w-full items-stretch', isMobile ? 'flex-col' : 'flex-row')}>
          <div
            role="tablist"
            aria-label={t('workspace.terminal.tabs', { defaultValue: '终端标签' })}
            className="scrollbar-subtle flex min-w-0 flex-1 overflow-x-auto"
          >
            {panes.map((pane) => {
              const isActivePane = pane.id === activePaneId
              return (
                <div
                  key={pane.id}
                  className={cn(
                    'group flex h-6 min-w-[9rem] items-center border-r border-zinc-900 text-[11px] transition-colors',
                    isActivePane ? 'max-w-[22rem]' : 'max-w-[16rem]',
                    isActivePane
                      ? 'bg-[#151719] text-zinc-100'
                      : 'bg-[#0b0c0d] text-zinc-500 hover:bg-[#111315] hover:text-zinc-200',
                  )}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActivePane}
                    onClick={() => handleSelectPane(pane.id)}
                    className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2.5 text-left"
                  >
                    {renderPaneStatusDot(pane)}
                    {renderPaneBindingBadge(pane, isActivePane)}
                    {renderPaneBackendBadge(pane, isActivePane)}
                    <span className="min-w-0 flex-1 truncate font-medium" title={pane.title}>{pane.title}</span>
                  </button>
                  {panes.length > 1 ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleClosePane(pane.id)
                      }}
                      className="mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-600 opacity-0 transition-opacity hover:bg-zinc-800 hover:text-zinc-100 group-hover:opacity-100"
                      aria-label={t('workspace.terminal.closeTab', { defaultValue: '关闭终端标签' })}
                      title={t('workspace.terminal.closeTab', { defaultValue: '关闭终端标签' })}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              )
            })}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleNewTerminal}
              disabled={!canOpenAnotherTerminal}
              className="h-6 w-8 shrink-0 rounded-none border-r border-zinc-900 bg-[#0b0c0d] text-zinc-400 hover:bg-[#151719] hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={tr(language, '新终端', 'New Terminal')}
              title={tr(language, '新终端', 'New Terminal')}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            {renderHeaderInfoBar()}
          </div>
          <div className={cn(
            'flex shrink-0 items-center gap-1 border-zinc-900 bg-[#09090b] px-1.5',
            isMobile ? 'justify-end border-t py-1' : 'border-l',
          )}>
            {!isMobile && logsCommand.trim() ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { void runWorkspaceCommand(
                  logsCommand.trim(),
                  tr(language, '已在当前终端打开环境日志命令。', 'Opened the environment logs command in the current terminal.'),
                ) }}
                disabled={!canRunLogsWorkspaceCommand}
                className="h-5 gap-1 rounded-sm bg-transparent px-1.5 text-[10px] text-zinc-600 hover:bg-zinc-900/70 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                logs
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggleTerminalMaximized}
              className="h-5 w-5 rounded-sm bg-transparent text-zinc-600 hover:bg-zinc-900/70 hover:text-zinc-300"
              aria-label={maximized ? t('workspace.terminal.restoreSize', { defaultValue: '还原终端大小' }) : t('workspace.terminal.maximize', { defaultValue: '展开到最大' })}
              title={maximized ? t('workspace.terminal.restoreSize', { defaultValue: '还原终端大小' }) : t('workspace.terminal.maximize', { defaultValue: '展开到最大' })}
            >
              {maximized ? <Minimize2 className="h-2.5 w-2.5" /> : <Maximize2 className="h-2.5 w-2.5" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                setCloseConfirmOpen(false)
                if (collapsed) {
                  if (terminalClosed) {
                    void ensureDefaultPane().catch(handleTerminalSessionLoadError)
                  }
                  onOpenStateChange?.(true)
                } else if (maximized) {
                  onMaximizedChange?.(false)
                }
                onCollapsedChange(!collapsed)
              }}
              className="h-5 w-5 rounded-sm bg-transparent text-zinc-600 hover:bg-zinc-900/70 hover:text-zinc-300"
              aria-label={collapsed ? t('workspace.terminal.expand', { defaultValue: '展开' }) : t('workspace.terminal.collapse', { defaultValue: '折叠' })}
              title={collapsed ? t('workspace.terminal.expand', { defaultValue: '展开' }) : t('workspace.terminal.collapse', { defaultValue: '折叠' })}
            >
              <ChevronDown className={collapsed ? 'h-2.5 w-2.5 rotate-180' : 'h-2.5 w-2.5'} />
            </Button>
            {terminalClosed && collapsed ? null : (
              <Popover open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={terminalClosed ? handleCloseTerminalPanel : undefined}
                    className="h-5 w-5 rounded-sm bg-transparent text-zinc-600 hover:bg-zinc-900/70 hover:text-rose-300"
                    aria-label={t('workspace.terminal.close', { defaultValue: '关闭' })}
                    title={t('workspace.terminal.close', { defaultValue: '关闭' })}
                  >
                    <X className="h-2.5 w-2.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  side="bottom"
                  sideOffset={8}
                  className="w-[13.5rem] rounded-xl border-zinc-800 bg-[#09090b] p-3 text-zinc-100 shadow-2xl shadow-black/50"
                >
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-zinc-50">
                        {tr(language, '关闭所有终端？', 'Close all terminals?')}
                      </p>
                      <p className="text-[11px] leading-5 text-zinc-400">
                        {tr(language, '会断开当前连接。', 'This disconnects the current terminals.')}
                      </p>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCloseConfirmOpen(false)}
                        className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-50"
                      >
                        {tr(language, '取消', 'Cancel')}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => { void closeAllTerminals() }}
                        className="h-8 rounded-md border border-rose-500/40 bg-rose-500/14 px-3 text-xs font-medium text-rose-200 hover:border-rose-400/60 hover:bg-rose-500/22 hover:text-rose-50"
                      >
                        {tr(language, '确认关闭', 'Close')}
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className={collapsed ? 'hidden' : 'min-h-0 w-full flex-1 overflow-hidden p-0'}>
        <div className="relative h-full w-full bg-[#050506] p-0">
          {collapsed ? null : paneContent}
        </div>
      </CardContent>
    </Card>
  )
}

type WorkspaceTerminalPanelCacheEntry = Pick<
  WorkspaceTerminalPanelProps,
  'cwd' | 'executorId' | 'executorName' | 'executorRealtimeBaseUrl' | 'installCommand' | 'isMobile' | 'logsCommand' | 'panelKey' | 'projectId' | 'shouldLoadSessions' | 'startCommand' | 'workspaceId' | 'workspaceName'
>

const MAX_CACHED_WORKSPACE_TERMINAL_PANELS = 16

const touchWorkspaceTerminalPanelKey = (panelKeys: string[], activePanelKey: string) => (
  [...panelKeys.filter((panelKey) => panelKey !== activePanelKey), activePanelKey]
    .slice(-MAX_CACHED_WORKSPACE_TERMINAL_PANELS)
)

const buildWorkspaceTerminalPanelCacheEntry = (
  props: WorkspaceTerminalPanelProps,
): WorkspaceTerminalPanelCacheEntry => ({
  cwd: props.cwd,
  executorId: props.executorId,
  executorName: props.executorName,
  executorRealtimeBaseUrl: props.executorRealtimeBaseUrl,
  installCommand: props.installCommand,
  isMobile: props.isMobile,
  logsCommand: props.logsCommand,
  panelKey: props.panelKey,
  projectId: props.projectId,
  shouldLoadSessions: props.shouldLoadSessions,
  startCommand: props.startCommand,
  workspaceId: props.workspaceId,
  workspaceName: props.workspaceName,
})

type WorkspaceTerminalPanelCache = {
  panelKeys: string[]
  panels: Record<string, WorkspaceTerminalPanelCacheEntry>
}

const noopCollapsedChange = () => {}
const noopOpenWorkspaceTarget = async () => {}

export function WorkspaceTerminalPanel(props: WorkspaceTerminalPanelProps) {
  const activeCommandRequest = props.commandRequest && (
    !props.commandRequest.workspaceId || props.commandRequest.workspaceId === props.panelKey
  )
    ? props.commandRequest
    : null
  const [panelCache, setPanelCache] = useState<WorkspaceTerminalPanelCache>(() => ({
    panelKeys: [props.panelKey],
    panels: {
      [props.panelKey]: buildWorkspaceTerminalPanelCacheEntry(props),
    },
  }))

  useEffect(() => {
    setPanelCache((current) => {
      const panelKeys = touchWorkspaceTerminalPanelKey(current.panelKeys, props.panelKey)
      const retainedPanelKeys = new Set(panelKeys)
      const panels = Object.fromEntries(
        Object.entries(current.panels).filter(([panelKey]) => retainedPanelKeys.has(panelKey)),
      )
      panels[props.panelKey] = buildWorkspaceTerminalPanelCacheEntry(props)
      return { panelKeys, panels }
    })
  }, [
    props.cwd,
    props.executorId,
    props.executorName,
    props.executorRealtimeBaseUrl,
    props.installCommand,
    props.isMobile,
    props.logsCommand,
    props.panelKey,
    props.projectId,
    props.shouldLoadSessions,
    props.startCommand,
    props.workspaceId,
    props.workspaceName,
  ])
  const visiblePanelKeys = touchWorkspaceTerminalPanelKey(panelCache.panelKeys, props.panelKey)
  const activePanel = buildWorkspaceTerminalPanelCacheEntry(props)

  return (
    <>
      {visiblePanelKeys.map((panelKey) => {
        const isActivePanel = panelKey === props.panelKey
        const cachedPanel = isActivePanel ? activePanel : panelCache.panels[panelKey]
        if (!cachedPanel) {
          return null
        }

        return (
          <div key={panelKey} className={isActivePanel ? 'h-full w-full' : 'hidden'}>
            <WorkspaceTerminalPanelContent
              {...cachedPanel}
              resourceActive={isActivePanel}
              collapsed={isActivePanel ? props.collapsed : false}
              commandRequest={isActivePanel ? activeCommandRequest : null}
              maximized={isActivePanel ? props.maximized : false}
              onCollapsedChange={isActivePanel ? props.onCollapsedChange : noopCollapsedChange}
              onMaximizedChange={isActivePanel ? props.onMaximizedChange : undefined}
              onOpenStateChange={isActivePanel ? props.onOpenStateChange : undefined}
              onOpenWorkspaceTarget={isActivePanel ? props.onOpenWorkspaceTarget : noopOpenWorkspaceTarget}
            />
          </div>
        )
      })}
    </>
  )
}
