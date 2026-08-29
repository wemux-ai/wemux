import React, { useEffect, useMemo, useState } from 'react'
import { AgentSessionsPanel } from './components/agent-sessions-panel'
import { ConnectionSettingsPanel } from './components/connection-settings-panel'
import { DoctorPanel } from './components/doctor-panel'
import { McpStatusPanel } from './components/mcp-status-panel'
import { ProjectBindingsPanel } from './components/project-bindings-panel'
import { RuntimeOverviewPanel } from './components/runtime-overview-panel'
import { WorkerConsoleHeader } from './components/worker-console-header'
import { WorkerConsoleTabs } from './components/worker-console-tabs'
import { dictionary, LOCALE_KEY } from './worker-console-copy'
import { formatMessage, formatTimestamp, fromLines, maskMiddle, sanitizeDisplayJson, toLines } from './worker-console-utils'
import type { AgentSessionsPayload, AgentSessionDetail, AgentSessionSummary, ConsoleAction, ConsoleDetail, ConsoleMetric, ConsoleTabId, Locale, StatusTone, WorkerConfig, WorkerDoctorPayload, WorkerMcpStatus, WorkerProjectBinding, WorkerRuntimeState } from './worker-console-types'

const fetchJson = async <T,>(url: string, options?: RequestInit) => {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error((payload as { message?: string }).message || 'Request failed.')
  }

  return payload as T
}

const formatRouteAssignment = (runtime: WorkerRuntimeState | null, fallback: string) => {
  const routeSelection = runtime?.routeSelection
  if (!routeSelection) {
    return fallback
  }

  const routeId = routeSelection.matchedRouteId?.trim() || 'default'
  const regionHint = [routeSelection.countryCode, routeSelection.continentCode].filter(Boolean).join(' / ')
  const target = routeSelection.selectedCloudUrl?.trim() || routeSelection.assignedCloudUrl?.trim() || fallback
  const parts = [routeId]
  if (regionHint) {
    parts.push(regionHint)
  }
  if (target) {
    parts.push(target)
  }
  if (routeSelection.resolutionError?.trim()) {
    parts.push(`fallback (${routeSelection.resolutionError.trim()})`)
  }

  return parts.join(' | ')
}

const formatRouteProbeSummary = (runtime: WorkerRuntimeState | null, fallback: string) => {
  const probeResults = runtime?.routeSelection?.candidateResults ?? []
  if (probeResults.length === 0) {
    return fallback
  }

  return probeResults
    .map((result) => {
      const latency = typeof result.latencyMs === 'number' ? `${result.latencyMs}ms` : 'n/a'
      const status = result.reachable ? latency : (result.error?.trim() || `HTTP ${result.statusCode ?? 'error'}`)
      return `${result.id}: ${status}`
    })
    .join(' | ')
}

const getMeshStatusLabel = (runtime: WorkerRuntimeState | null, copy: (typeof dictionary)[Locale]) => {
  const status = runtime?.mesh?.status
  if (status === 'installing') return copy.meshInstalling
  if (status === 'connecting') return copy.meshConnecting
  if (status === 'ready') return copy.meshReady
  if (status === 'degraded') return copy.meshDegraded
  if (status === 'error') return copy.meshError
  return copy.meshDisabled
}

const getMeshStatusTone = (runtime: WorkerRuntimeState | null): StatusTone => {
  const status = runtime?.mesh?.status
  if (status === 'ready') return 'success'
  if (status === 'installing' || status === 'connecting' || status === 'degraded') return 'warning'
  if (status === 'error') return 'danger'
  return 'neutral'
}

export const WorkerConsoleApp = () => {
  const [locale, setLocale] = useState<Locale>('en')
  const [activeTab, setActiveTab] = useState<ConsoleTabId>('overview')
  const [config, setConfig] = useState<WorkerConfig | null>(null)
  const [runtime, setRuntime] = useState<WorkerRuntimeState | null>(null)
  const [mcp, setMcp] = useState<WorkerMcpStatus | null>(null)
  const [doctor, setDoctor] = useState<WorkerDoctorPayload | null>(null)
  const [sessionsPayload, setSessionsPayload] = useState<AgentSessionsPayload | null>(null)
  const [activeSessionKey, setActiveSessionKey] = useState('')
  const [activeSessionDetail, setActiveSessionDetail] = useState<AgentSessionDetail | null>(null)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null)
  const [pairingCode, setPairingCode] = useState('')
  const [pairingName, setPairingName] = useState('')
  const [pendingAction, setPendingAction] = useState<'saveConfig' | 'pair' | 'connect' | 'disconnect' | null>(null)
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false)
  const [connectionFlash, setConnectionFlash] = useState<{ title: string; body: string; tone: StatusTone } | null>(null)
  const [didAutoSelectInitialTab, setDidAutoSelectInitialTab] = useState(false)

  const copy = dictionary[locale]
  const hasPairingCode = pairingCode.trim().length > 0

  const showToast = (message: string, ok = true) => {
    setToast({ message, ok })
  }

  const showConnectionFlash = (title: string, body: string, tone: StatusTone) => {
    setConnectionFlash({ title, body, tone })
  }

  const patchConfig = (patch: Partial<WorkerConfig>) => {
    setConfig((current) => current ? { ...current, ...patch } : current)
  }

  useEffect(() => {
    localStorage.setItem(LOCALE_KEY, 'en')
    document.documentElement.lang = 'en'
  }, [])

  useEffect(() => {
    if (!toast) {
      return
    }

    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!connectionFlash || pendingAction) {
      return
    }

    const timer = window.setTimeout(() => setConnectionFlash(null), 4200)
    return () => window.clearTimeout(timer)
  }, [connectionFlash, pendingAction])

  const refresh = async () => {
    const [configPayload, statusPayload] = await Promise.all([
      fetchJson<{ config: WorkerConfig }>('/api/config'),
      fetchJson<{ runtime: WorkerRuntimeState; mcp: WorkerMcpStatus }>('/api/status'),
    ])

    setConfig(configPayload.config)
    setRuntime(statusPayload.runtime)
    setMcp(statusPayload.mcp)
    setPairingName((current) => current || configPayload.config.executorName || configPayload.config.machineName || '')
  }

  const persistConfig = async () => {
    if (!config) {
      return null
    }

    const payload = await fetchJson<{ config: WorkerConfig }>('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })

    setConfig(payload.config)
    return payload.config
  }

  const loadSessionDetail = async (session: AgentSessionSummary) => {
    const payload = await fetchJson<{ session: AgentSessionDetail }>(`/api/agent-sessions/detail?source=${encodeURIComponent(session.source)}&id=${encodeURIComponent(session.id)}`)
    setActiveSessionDetail(payload.session)
    setActiveSessionKey(`${session.source}:${session.id}`)
  }

  const loadSessions = async (preferredSession?: AgentSessionSummary) => {
    setSessionsLoading(true)

    try {
      const payload = await fetchJson<AgentSessionsPayload>('/api/agent-sessions')
      setSessionsPayload(payload)

      const selectedSession = preferredSession
        || payload.sessions.find((session) => `${session.source}:${session.id}` === activeSessionKey)
        || payload.sessions[0]

      if (!selectedSession) {
        setActiveSessionDetail(null)
        setActiveSessionKey('')
        return
      }

      await loadSessionDetail(selectedSession)
    } finally {
      setSessionsLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
      .then(() => fetchJson<WorkerDoctorPayload>('/api/doctor').then(setDoctor))
      .catch((error: Error) => showToast(error.message, false))

    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined)
    }, 5000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (activeTab !== 'sessions' || sessionsPayload) {
      return
    }

    void loadSessions().catch((error: Error) => showToast(error.message, false))
  }, [activeTab, sessionsPayload])

  useEffect(() => {
    if (!runtime || didAutoSelectInitialTab) {
      return
    }

    setActiveTab(runtime.connected ? 'overview' : 'settings')
    setDidAutoSelectInitialTab(true)
  }, [didAutoSelectInitialTab, runtime])

  useEffect(() => {
    if (!runtime?.connected && activeTab !== 'settings' && activeTab !== 'doctor') {
      setActiveTab('settings')
    }
  }, [activeTab, runtime?.connected])

  const bindings = config?.projectBindings || []

  const updateBinding = (index: number, key: keyof WorkerProjectBinding, value: string) => {
    if (!config) return
    const nextBindings = [...bindings]
    nextBindings[index] = {
      ...nextBindings[index],
      [key]: value,
    }
    setConfig({ ...config, projectBindings: nextBindings })
  }

  const handleRefresh = async () => {
    await refresh()
    showToast(copy.refreshed)
  }

  const saveConfig = async () => {
    if (!config) return

    setPendingAction('saveConfig')

    try {
      await persistConfig()
      showToast(copy.configSaved)
    } catch (error) {
      const message = error instanceof Error ? error.message : copy.configSaved
      showToast(message, false)
    } finally {
      setPendingAction(null)
    }
  }

  const pairWorker = async () => {
    const trimmedPairingCode = pairingCode.trim()

    if (!trimmedPairingCode) {
      showConnectionFlash(copy.connectionFailedTitle, copy.pairingCodeRequired, 'danger')
      showToast(copy.pairingCodeRequired, false)
      return
    }

    setPendingAction('pair')

    try {
      await persistConfig()

      const payload = await fetchJson<{ config: WorkerConfig; message?: string }>('/api/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode: trimmedPairingCode,
          name: pairingName.trim() || config?.executorName || config?.machineName || '',
        }),
      })

      setConfig(payload.config)
      setPairingCode('')
      await refresh()
      setShowAdvancedSettings(false)
      showConnectionFlash(copy.pairingSuccessTitle, copy.pairingSuccessBody, 'success')
      showToast(payload.message || copy.pairDone)
    } catch (error) {
      const message = error instanceof Error ? error.message : copy.pairDone
      showConnectionFlash(copy.connectionFailedTitle, message, 'danger')
      showToast(message, false)
    } finally {
      setPendingAction(null)
    }
  }

  const runDoctor = async () => {
    const payload = await fetchJson<WorkerDoctorPayload>('/api/doctor')
    setDoctor(payload)
    showToast(copy.doctorDone, Boolean(payload.summary?.ok))
  }

  const bootstrapRuntime = async () => {
    const payload = await fetchJson<{ doctor: WorkerDoctorPayload; report?: { ok?: boolean; message?: string } }>('/api/bootstrap-runtime', { method: 'POST' })
    setDoctor(payload.doctor)
    await refresh()
    showToast(payload.report?.message || copy.runtimeReady, Boolean(payload.report?.ok))
  }

  const resetWorker = async () => {
    await fetchJson('/api/reset', { method: 'POST' })
    await refresh()
    showToast(copy.resetDone)
  }

  const connectWorker = async () => {
    if (!runtime?.paired) {
      showConnectionFlash(copy.cloudDisconnectedTitle, copy.cloudDisconnectedBody, 'warning')
      setActiveTab('settings')
      return
    }

    if (!config?.cloudUrl.trim()) {
      showConnectionFlash(copy.connectionFailedTitle, copy.cloudUrlRequired, 'danger')
      showToast(copy.cloudUrlRequired, false)
      return
    }

    setPendingAction('connect')

    try {
      await persistConfig()
      const payload = await fetchJson<{ message?: string }>('/api/connect', { method: 'POST' })
      await refresh()
      setShowAdvancedSettings(false)
      showConnectionFlash(copy.cloudConnectedTitle, copy.cloudConnectedBody, 'success')
      showToast(payload.message || copy.connectDone)
    } catch (error) {
      const message = error instanceof Error ? error.message : copy.connectDone
      showConnectionFlash(copy.connectionFailedTitle, message, 'danger')
      showToast(message, false)
    } finally {
      setPendingAction(null)
    }
  }

  const disconnectWorker = async () => {
    setPendingAction('disconnect')

    try {
      const payload = await fetchJson<{ message?: string; runtime?: WorkerRuntimeState }>('/api/disconnect', { method: 'POST' })
      if (payload.runtime) {
        setRuntime(payload.runtime)
      }
      void refresh().catch(() => undefined)
      showConnectionFlash(copy.cloudDisconnectedTitle, copy.cloudDisconnectedPairedBody, 'warning')
      showToast(payload.message || copy.disconnectDone)
    } catch (error) {
      const message = error instanceof Error ? error.message : copy.disconnectDone
      showConnectionFlash(copy.connectionFailedTitle, message, 'danger')
      showToast(message, false)
    } finally {
      setPendingAction(null)
    }
  }

  const saveBindings = async () => {
    if (!config) return
    const nextBindings = bindings.filter((item) => item.localPath.trim())
    const payload = await fetchJson<{ config: WorkerConfig }>('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...config, projectBindings: nextBindings }),
    })
    setConfig(payload.config)
    showToast(copy.bindingsSaved)
  }

  const formattedHeartbeat = formatTimestamp(runtime?.lastHeartbeatAt, locale, copy.na)
  const formattedConnectAttempt = formatTimestamp(runtime?.lastConnectAttemptAt, locale, copy.na)
  const formattedRouteSelectionAt = formatTimestamp(runtime?.routeSelection?.updatedAt, locale, copy.na)
  const formattedDisconnect = formatTimestamp(runtime?.lastDisconnectAt, locale, copy.na)
  const formattedTaskAt = formatTimestamp(runtime?.lastTaskAt, locale, copy.na)

  const daemonTone: StatusTone = runtime?.daemonMode === 'running' ? 'success' : 'warning'
  const pairingTone: StatusTone = runtime?.paired ? 'success' : 'warning'
  const cloudTone: StatusTone = runtime?.connected ? 'success' : 'danger'
  const doctorTone: StatusTone = doctor?.summary?.ok ? 'success' : (doctor?.summary ? 'warning' : 'neutral')
  const meshTone = getMeshStatusTone(runtime)
  const showConnectionFirst = runtime ? !runtime.connected : false
  const isBusy = pendingAction !== null
  const failedDoctorItems = (doctor?.items || []).filter((item) => !item.ok)
  const passedDoctorItems = (doctor?.items || []).filter((item) => item.ok)
  const sanitizedDoctor = useMemo(() => sanitizeDisplayJson(doctor), [doctor])

  const headerStatuses: ConsoleMetric[] = showConnectionFirst
    ? [
        { label: copy.statusPairing, value: runtime?.paired ? copy.paired : copy.waitingPairing, tone: pairingTone },
        { label: copy.statusCloud, value: runtime?.connected ? copy.online : copy.offline, tone: cloudTone },
      ]
    : [
        { label: copy.statusPairing, value: runtime?.paired ? copy.paired : copy.waitingPairing, tone: pairingTone },
        { label: copy.statusCloud, value: runtime?.connected ? copy.online : copy.offline, tone: cloudTone },
        { label: copy.statusDaemon, value: runtime?.daemonMode || copy.na, tone: daemonTone },
        { label: copy.statusDoctor, value: doctor?.summary?.ok ? copy.ready : doctor?.summary ? copy.check : copy.na, tone: doctorTone },
      ]

  const overviewMetrics: ConsoleMetric[] = [
    { label: copy.statusDaemon, value: runtime?.daemonMode || copy.na, tone: daemonTone },
    { label: copy.statusCloud, value: runtime?.connected ? copy.online : copy.offline, tone: cloudTone },
    { label: copy.statusPairing, value: runtime?.paired ? copy.paired : copy.waitingPairing, tone: pairingTone },
    { label: copy.meshStatusLabel, value: getMeshStatusLabel(runtime, copy), tone: meshTone },
    {
      label: copy.runningQueued,
      value: `${runtime?.runningTaskIds.length || 0} / ${runtime?.queuedTaskIds.length || 0}`,
      tone: ((runtime?.queuedTaskIds.length || 0) > 0 ? 'warning' : 'neutral') as StatusTone,
    },
  ]

  const mcpModeLabel = mcp?.actingUserMode === 'request-scoped'
    ? copy.mcpScopeDynamic
    : mcp?.actingUserMode === 'pairing-required'
      ? copy.mcpScopeNeedsPairing
      : copy.mcpScopeDisabled

  const mcpOverviewMetrics: ConsoleMetric[] = [
    { label: copy.mcpConfigured, value: String(mcp?.configuredCount || 0), tone: 'neutral' },
    { label: copy.mcpEnabled, value: String(mcp?.enabledCount || 0), tone: (mcp?.enabledCount || 0) > 0 ? 'success' : 'warning' },
    { label: copy.mcpEffective, value: String(mcp?.materializedCount || 0), tone: (mcp?.materializedCount || 0) > 0 ? 'success' : 'warning' },
    { label: copy.mcpActingUserMode, value: mcpModeLabel, tone: mcp?.actingUserMode === 'request-scoped' ? 'success' : mcp?.actingUserMode === 'pairing-required' ? 'warning' : 'neutral' },
  ]

  const overviewDetails: ConsoleDetail[] = [
    { label: copy.cloudUrlLabel, value: config?.cloudUrl || copy.na },
    { label: copy.effectiveCloudUrlLabel, value: runtime?.effectiveCloudUrl || runtime?.routeSelection?.selectedCloudUrl || copy.na },
    { label: copy.routeAssignmentLabel, value: formatRouteAssignment(runtime, copy.na) },
    { label: copy.routeProbesLabel, value: formatRouteProbeSummary(runtime, copy.na) },
    { label: copy.meshIpLabel, value: runtime?.mesh?.meshIpv4 || copy.na },
    { label: copy.meshRouteLabel, value: runtime?.mesh?.routeMode || copy.na },
    { label: copy.meshPeersLabel, value: String(runtime?.mesh?.peers?.length ?? 0) },
    { label: copy.meshReportedAtLabel, value: formatTimestamp(runtime?.mesh?.reportedAt, locale, copy.na) },
    { label: copy.workspaceRootLabel, value: config?.workspaceRoot || copy.na },
    { label: copy.machineNameLabel, value: config?.machineName || copy.na },
    { label: copy.executorIdLabel, value: maskMiddle(config?.executorId || runtime?.executorId, copy.na) },
    { label: copy.lastConnectAttempt, value: formattedConnectAttempt },
    { label: copy.lastRouteSelection, value: formattedRouteSelectionAt },
    { label: copy.lastHeartbeatLabel, value: formattedHeartbeat },
  ]

  const mcpDetails: ConsoleDetail[] = [
    {
      label: copy.mcpBuiltIn,
      value: mcp?.builtinEnabled
        ? (mcp.builtinReady ? copy.mcpBuiltinReady : copy.mcpBuiltinPending)
        : copy.mcpBuiltinDisabled,
    },
    {
      label: copy.mcpActingUserLabel,
      value: mcpModeLabel,
    },
    {
      label: copy.mcpHeadersLabel,
      value: mcp?.servers
        .flatMap((server) => server.headerKeys)
        .filter((value, index, values) => values.indexOf(value) === index)
        .join(', ') || '—',
    },
    {
      label: copy.mcpTransportLabel,
      value: mcp?.servers
        .filter((server) => server.enabled)
        .map((server) => server.transport)
        .filter((value, index, values) => values.indexOf(value) === index)
        .join(', ') || '—',
    },
  ]

  const mcpIssues: Array<{ label: string; value: string; tone?: StatusTone }> = []

  if (mcp?.builtinEnabled && !mcp.builtinReady) {
    mcpIssues.push({
      label: copy.mcpBuiltIn,
      value: copy.mcpIssueBuiltinPairing,
      tone: 'warning',
    })
  }

  if ((mcp?.enabledCount || 0) === 0) {
    mcpIssues.push({
      label: copy.mcpEnabled,
      value: copy.mcpIssueNoEnabledServers,
      tone: 'warning',
    })
  }

  const recentIssues: Array<{ label: string; value: string; tone?: StatusTone }> = []

  if (runtime?.lastError && runtime.lastError !== 'none') {
    recentIssues.push({ label: copy.lastError, value: runtime.lastError, tone: 'danger' })
  }

  if (runtime?.mesh?.errorMessage) {
    recentIssues.push({ label: copy.meshStatusLabel, value: runtime.mesh.errorMessage, tone: 'danger' })
  }

  if (runtime?.lastDisconnectAt) {
    recentIssues.push({ label: copy.lastDisconnect, value: formattedDisconnect, tone: 'warning' })
  }

  if (runtime?.lastTaskAt) {
    recentIssues.push({ label: copy.lastTaskActivity, value: formattedTaskAt, tone: 'neutral' })
  }

  const connectionStatus = pendingAction === 'pair'
    ? { title: copy.pairingInProgress, body: copy.pairingSectionBody, tone: 'warning' as StatusTone }
    : pendingAction === 'connect'
      ? { title: copy.cloudConnectingTitle, body: copy.cloudConnectingBody, tone: 'warning' as StatusTone }
      : pendingAction === 'disconnect'
        ? { title: copy.disconnecting, body: copy.cloudDisconnectingBody, tone: 'warning' as StatusTone }
        : connectionFlash
          ? connectionFlash
          : !runtime?.paired
            ? { title: copy.cloudDisconnectedTitle, body: copy.cloudDisconnectedBody, tone: 'warning' as StatusTone }
            : !runtime?.connected
              ? { title: copy.cloudDisconnectedTitle, body: copy.cloudDisconnectedPairedBody, tone: 'warning' as StatusTone }
              : { title: copy.cloudConnectedTitle, body: copy.cloudConnectedBody, tone: 'success' as StatusTone }

  const nextPrimaryAction: ConsoleAction = !runtime?.paired
    ? { label: copy.pair, onClick: () => setActiveTab('settings') }
    : !runtime?.connected
      ? { label: pendingAction === 'connect' ? copy.connecting : copy.connect, onClick: () => void connectWorker(), disabled: isBusy || !runtime?.paired }
      : doctor?.summary && !doctor.summary.ok
        ? { label: copy.reviewDoctor, onClick: () => setActiveTab('doctor'), tone: 'secondary' }
        : { label: copy.refresh, onClick: () => void handleRefresh(), tone: 'secondary' }

  const secondaryHeaderActions: ConsoleAction[] = showConnectionFirst
    ? [
        { label: copy.doctor, onClick: () => void runDoctor(), tone: 'secondary' },
      ]
    : [
        { label: copy.doctor, onClick: () => void runDoctor(), tone: 'secondary' },
        { label: copy.bootstrap, onClick: () => void bootstrapRuntime(), tone: 'secondary' },
      ]

  const overviewActions: ConsoleAction[] = [
    { label: copy.refresh, onClick: () => void handleRefresh(), tone: 'secondary' },
    { label: copy.doctor, onClick: () => void runDoctor(), tone: 'secondary' },
    { label: copy.bootstrap, onClick: () => void bootstrapRuntime(), tone: 'secondary' },
    { label: pendingAction === 'connect' ? copy.connecting : copy.connect, onClick: () => void connectWorker(), disabled: isBusy || !runtime?.paired || runtime?.connected },
    { label: pendingAction === 'disconnect' ? copy.disconnecting : copy.disconnect, onClick: () => void disconnectWorker(), tone: 'danger', disabled: isBusy || !runtime?.connected },
  ]

  const machineDetails = [
    { label: copy.machineIdLabel, value: maskMiddle(config?.machineId, copy.na) },
    { label: copy.executorIdLabel, value: maskMiddle(config?.executorId || runtime?.executorId, copy.na) },
    { label: copy.workspaceRootLabel, value: config?.workspaceRoot || copy.na },
    { label: copy.localServerPortLabel, value: String(config?.localServerPort || copy.na) },
  ]

  const connectionPrimaryActions: ConsoleAction[] = !runtime?.paired || hasPairingCode
    ? [
        { label: pendingAction === 'pair' ? copy.pairingInProgress : copy.pair, onClick: () => void pairWorker(), disabled: isBusy },
        { label: pendingAction === 'saveConfig' ? copy.saving : copy.saveConfig, onClick: () => void saveConfig(), tone: 'secondary', disabled: isBusy },
      ]
    : !runtime?.connected
      ? [
          { label: pendingAction === 'connect' ? copy.connecting : copy.connect, onClick: () => void connectWorker(), disabled: isBusy },
          { label: pendingAction === 'saveConfig' ? copy.saving : copy.saveConfig, onClick: () => void saveConfig(), tone: 'secondary', disabled: isBusy },
        ]
      : [
          { label: pendingAction === 'disconnect' ? copy.disconnecting : copy.disconnect, onClick: () => void disconnectWorker(), tone: 'danger', disabled: isBusy },
          { label: pendingAction === 'saveConfig' ? copy.saving : copy.saveConfig, onClick: () => void saveConfig(), tone: 'secondary', disabled: isBusy },
        ]

  const connectionActions: ConsoleAction[] = runtime?.connected
    ? [
        { label: pendingAction === 'disconnect' ? copy.disconnecting : copy.disconnect, onClick: () => void disconnectWorker(), tone: 'danger', disabled: isBusy },
      ]
    : []

  const dangerActions: ConsoleAction[] = [
    { label: copy.reset, onClick: () => void resetWorker(), tone: 'danger' },
  ]

  const doctorProbeItems = [
    { label: copy.cloudProbe, value: doctor?.cloudProbe?.message || copy.doctorPending },
    { label: copy.officialSite, value: doctor?.officialSiteProbe?.message || copy.officialPending },
  ]

  const tabs: Array<{ id: ConsoleTabId; label: string }> = showConnectionFirst
    ? [
        { id: 'settings', label: copy.tabSettings },
        { id: 'doctor', label: copy.tabDoctor },
      ]
    : [
        { id: 'overview', label: copy.tabOverview },
        { id: 'settings', label: copy.tabSettings },
        { id: 'bindings', label: copy.tabBindings },
        { id: 'doctor', label: copy.tabDoctor },
        { id: 'sessions', label: copy.tabSessions },
      ]

  return (
    <div className="console-shell">
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <WorkerConsoleHeader
          cloudUrl={config?.cloudUrl || copy.na}
          cloudUrlLabel={copy.cloudUrlLabel}
          description=""
          eyebrow={copy.eyebrow}
          languageLabel={copy.language}
          lastHeartbeat={formattedHeartbeat}
          lastHeartbeatLabel={copy.lastHeartbeatLabel}
          locale={locale}
          machineName={config?.machineName || copy.na}
          machineNameLabel={copy.machineNameLabel}
          nextStepLabel={copy.nextStep}
          onLocaleChange={setLocale}
          primaryAction={nextPrimaryAction}
          secondaryActions={secondaryHeaderActions}
          statuses={headerStatuses}
          title={showConnectionFirst ? copy.consoleTitleFocus : copy.consoleTitle}
        />

        <WorkerConsoleTabs activeTab={activeTab} items={tabs} onChange={setActiveTab} />

        {activeTab === 'overview' ? (
          <div className="space-y-4">
            <RuntimeOverviewPanel
              actions={overviewActions}
              actionsBody=""
              actionsTitle={copy.quickActionsTitle}
              description=""
              details={overviewDetails}
              issues={recentIssues}
              issuesBody=""
              issuesTitle={copy.recentIssuesTitle}
              metrics={overviewMetrics}
              noIssuesLabel={copy.noIssues}
              title={copy.runtimeTitle}
            />
            <McpStatusPanel
              actingUserLabel={copy.mcpActingUserLabel}
              commandLabel={copy.mcpCommandLabel}
              configuredLabel={copy.mcpConfiguredLabel}
              description=""
              details={mcpDetails}
              effectiveLabel={copy.mcpEffectiveLabel}
              emptyLabel={copy.mcpEmpty}
              endpointLabel={copy.mcpEndpointLabel}
              headersLabel={copy.mcpHeadersLabel}
              issues={mcpIssues}
              issuesTitle={copy.mcpIssuesTitle}
              kindLabels={{
                builtin: copy.mcpKindBuiltin,
                custom: copy.mcpKindCustom,
                remote: copy.mcpKindRemote,
                stdio: copy.mcpKindStdio,
              }}
              metrics={mcpOverviewMetrics}
              noIssuesLabel={copy.mcpNoIssues}
              scopeDisabledLabel={copy.mcpScopeDisabledLabel}
              scopeEnabledLabel={copy.mcpScopeEnabledLabel}
              servers={mcp?.servers || []}
              serversTitle={copy.mcpServersTitle}
              statusDisabledLabel={copy.mcpStatusDisabled}
              statusEnabledLabel={copy.mcpStatusEnabled}
              targetLabel={copy.mcpTargetLabel}
              title={copy.mcpTitle}
              transportLabel={copy.mcpTransportLabel}
            />
          </div>
        ) : null}

        {activeTab === 'settings' ? (
          <ConnectionSettingsPanel
            advancedBody=""
            advancedExpanded={showAdvancedSettings}
            advancedTitle={copy.advancedSettingsTitle}
            capabilitiesBody=""
            capabilitiesLabel={copy.capabilities}
            capabilitiesPlaceholder={copy.capabilitiesPlaceholder}
            capabilitiesTitle={copy.capabilitiesSectionTitle}
            capabilitiesValue={toLines(config?.capabilities || [])}
            collapseAdvancedLabel={copy.hideAdvancedSettings}
            cloudUrl={config?.cloudUrl || ''}
            cloudUrlLabel={copy.cloudUrlLabel}
            configBody=""
            configTitle={copy.configSectionTitle}
            connectionActions={connectionActions}
            connectionActionsBody=""
            connectionActionsTitle={copy.connectionActionsTitle}
            dangerActions={dangerActions}
            dangerBody=""
            dangerTitle={copy.dangerZoneTitle}
            description=""
            expandAdvancedLabel={copy.showAdvancedSettings}
            labelsLabel={copy.labels}
            labelsPlaceholder={copy.labelsPlaceholder}
            labelsValue={toLines(config?.labels || [])}
            machineBody=""
            machineDetails={machineDetails}
            machineTitle={copy.machineSectionTitle}
            maxConcurrency={config?.maxConcurrency || 5}
            maxConcurrencyLabel={copy.maxConcurrencyLabel}
            onCapabilitiesChange={(value) => patchConfig({ capabilities: fromLines(value) })}
            onCloudUrlChange={(value) => patchConfig({ cloudUrl: value })}
            onLabelsChange={(value) => patchConfig({ labels: fromLines(value) })}
            onMaxConcurrencyChange={(value) => patchConfig({ maxConcurrency: value })}
            onPairingCodeChange={setPairingCode}
            onToggleAdvanced={() => setShowAdvancedSettings((current) => !current)}
            onWorkerNameChange={setPairingName}
            onWorkspaceRootChange={(value) => patchConfig({ workspaceRoot: value })}
            pairingBody=""
            pairingCode={pairingCode}
            pairingCodeLabel={copy.pairingCode}
            pairingCodePlaceholder={copy.pairingCodePlaceholder}
            pairingTitle={copy.pairingSectionTitle}
            primaryActions={connectionPrimaryActions}
            quickConnectBody=""
            rePairingHint=""
            statusBody=""
            statusLabel={copy.cloudStatusLabel}
            statusTitle={connectionStatus.title}
            statusTone={connectionStatus.tone}
            title={copy.settingsTitle}
            workerName={pairingName}
            workerNameLabel={copy.workerName}
            workerNamePlaceholder={copy.workerNamePlaceholder}
            workspaceRoot={config?.workspaceRoot || ''}
            workspaceRootLabel={copy.workspaceRootLabel}
          />
        ) : null}

        {activeTab === 'bindings' ? (
          <ProjectBindingsPanel
            badgeLabel={copy.workspaceFirst}
            bindings={bindings}
            description=""
            emptyLabel={copy.noBindings}
            footerActions={[
              { label: copy.addBinding, onClick: () => undefined, tone: 'secondary' },
              { label: copy.saveBindings, onClick: () => void saveBindings() },
            ]}
            localPathLabel={copy.localPathLabel}
            onAddBinding={() => patchConfig({ projectBindings: [...bindings, { projectId: '', repoUrl: '', localPath: '' }] })}
            onRemoveBinding={(index) => patchConfig({ projectBindings: bindings.filter((_, bindingIndex) => bindingIndex !== index) })}
            onUpdateBinding={updateBinding}
            projectIdLabel={copy.projectIdLabel}
            removeLabel={copy.remove}
            repoUrlLabel={copy.repoUrlLabel}
            title={copy.bindingsTitle}
          />
        ) : null}

        {activeTab === 'doctor' ? (
          <DoctorPanel
            action={{ label: copy.doctor, onClick: () => void runDoctor(), tone: 'secondary' }}
            description=""
            developerDataTitle={copy.developerDataTitle}
            failedItems={failedDoctorItems}
            failedItemsTitle={copy.failedItemsTitle}
            noFailedItemsLabel={copy.noFailedItems}
            passedItems={passedDoctorItems}
            passedItemsTitle={copy.passedItemsTitle}
            probeItems={doctorProbeItems}
            rawJson={sanitizedDoctor}
            rawLabel={copy.viewRaw}
            summaryBadgeLabel={doctor?.summary?.ok ? copy.ready : copy.check}
            summaryBadgeTone={doctor?.summary?.ok ? 'success' : 'warning'}
            summaryText={formatMessage(copy.doctorSummary, {
              failed: doctor?.summary?.failed || 0,
              passed: doctor?.summary?.passed || 0,
              total: doctor?.summary?.total || 0,
            })}
            summaryTitle={doctor?.summary?.ok ? copy.doctorPassed : copy.doctorFailed}
            title={copy.doctorTitle}
          />
        ) : null}

        {activeTab === 'sessions' ? (
          <AgentSessionsPanel
            activeSessionId={activeSessionKey}
            collapseLabel={copy.collapse}
            countLabel={copy.sessionsCount}
            cwdLabel={copy.sessionCwd}
            description=""
            detail={activeSessionDetail}
            emptyLabel={copy.sessionsEmpty}
            expandLabel={copy.expand}
            loading={sessionsLoading}
            loadingLabel={copy.sessionsLoading}
            noEntriesLabel={copy.sessionsNoEntries}
            noSelectionLabel={copy.sessionsNoSelection}
            onRefresh={() => void loadSessions(activeSessionDetail || undefined).catch((error: Error) => showToast(error.message, false))}
            onSelect={(session) => void loadSessionDetail(session).catch((error: Error) => showToast(error.message, false))}
            refreshLabel={copy.refreshSessions}
            sessions={sessionsPayload?.sessions || []}
            sources={{
              claude: { label: copy.sessionSourceClaude, count: sessionsPayload?.counts.claude || 0 },
              opencode: { label: copy.sessionSourceOpencode, count: sessionsPayload?.counts.opencode || 0 },
              codex: { label: copy.sessionSourceCodex, count: sessionsPayload?.counts.codex || 0 },
              pi: { label: copy.sessionSourcePi, count: sessionsPayload?.counts.pi || 0 },
            }}
            startedAtLabel={copy.sessionStartedAt}
            title={copy.sessionsTitle}
            updatedAtLabel={copy.sessionUpdatedAt}
          />
        ) : null}
      </div>

      {toast ? (
        <div className={`fixed bottom-6 right-6 max-w-sm rounded-3xl border px-4 py-3 text-sm shadow-2xl ${toast.ok ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100' : 'border-rose-300/25 bg-rose-400/10 text-rose-100'}`}>
          {toast.message}
        </div>
      ) : null}
    </div>
  )
}
