// [INPUT]: Railway 连接状态 + 实验性开关。
// [OUTPUT]: Integrations 页 Railway 卡片（连接/同步/断开 + webhook 收口说明）。
// [POS]: Railway 插件连接 UI（flag 门控，Token 加密由 server 负责）。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, RefreshCw, Rocket } from 'lucide-react'
import type { RailwayConnectionSummary } from '@shared/types'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import { api } from '../../lib/api'
import { useExperimentalSettings } from '../../lib/use-experimental-settings'
import { resolveAbsoluteApiUrl } from '../../lib/runtime-config'

const connectedTone = 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
const errorTone = 'border-red-500/20 bg-red-500/10 text-red-300'
const idleTone = 'border-zinc-700 bg-zinc-900 text-zinc-300'

export function RailwayIntegrationCard() {
  const { t } = useTranslation()
  const experimentalSettings = useExperimentalSettings()
  const railwayEnabled = experimentalSettings.railway

  const [connection, setConnection] = useState<RailwayConnectionSummary | null>(null)
  const [projectCount, setProjectCount] = useState(0)
  const [token, setToken] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const webhookUrl = resolveAbsoluteApiUrl('/api/railway/webhook')

  const refresh = useCallback(() => {
    void api.getRailwayConnection()
      .then((response) => {
        setConnection(response.connection)
        setProjectCount(response.projectCount ?? 0)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (railwayEnabled) {
      refresh()
    }
  }, [railwayEnabled, refresh])

  if (!railwayEnabled) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-md border border-zinc-900 bg-zinc-950/60 p-3 opacity-70">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/60">
            <Rocket className="h-4 w-4 text-zinc-500" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-400">{t('integrations.railway.name')}</span>
              <Badge className="rounded-md border-zinc-800 bg-zinc-900 px-1.5 py-0 text-[10px] font-medium text-zinc-500">
                {t('integrations.railway.experimentalOff')}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-zinc-600">{t('integrations.railway.desc')}</p>
          </div>
        </div>
      </div>
    )
  }

  const connected = Boolean(connection)
  const hasError = Boolean(connection?.status === 'error' || error)

  const handleConnect = async () => {
    if (!token.trim()) return
    setConnecting(true)
    setError(null)
    try {
      const response = await api.connectRailway(token.trim())
      setConnection(response.connection)
      setProjectCount(response.projectCount ?? 0)
      setToken('')
      if (response.sync && !response.sync.ok) {
        setError(response.sync.message ?? t('integrations.railway.syncFailed'))
      }
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : t('integrations.railway.connectFailed'))
    } finally {
      setConnecting(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    setError(null)
    try {
      const result = await api.syncRailway()
      if (!result.ok) {
        setError(result.message ?? t('integrations.railway.syncFailed'))
      }
      refresh()
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : t('integrations.railway.syncFailed'))
    } finally {
      setSyncing(false)
    }
  }

  const handleDisconnect = async () => {
    setError(null)
    try {
      await api.disconnectRailway()
      setConnection(null)
      setProjectCount(0)
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : t('integrations.railway.disconnectFailed'))
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用则忽略
    }
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900">
            <Rocket className="h-4 w-4 text-zinc-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-200">{t('integrations.railway.name')}</span>
              <Badge className={cn('rounded-md px-1.5 py-0 text-[10px] font-medium', connected ? connectedTone : hasError ? errorTone : idleTone)}>
                {connected
                  ? t('integrations.railway.connected', { count: projectCount })
                  : t('integrations.railway.notConnected')}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">{t('integrations.railway.desc')}</p>
            {connected && connection?.accountEmail ? (
              <p className="mt-1 text-[11px] text-zinc-600">
                {t('integrations.railway.account')}: {connection.accountEmail}
                {connection.lastSyncedAt ? ` · ${t('integrations.railway.lastSync')} ${new Date(connection.lastSyncedAt).toLocaleString()}` : ''}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {connected ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => void handleSync()}
                disabled={syncing}
              >
                <RefreshCw className={cn('mr-1 h-3 w-3', syncing && 'animate-spin')} />
                {t('integrations.railway.sync')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => void handleDisconnect()}
              >
                {t('integrations.railway.disconnect')}
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={t('integrations.railway.tokenPlaceholder')}
                className="h-8 w-56 text-xs"
                autoComplete="off"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleConnect()
                  }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => void handleConnect()}
                disabled={connecting || !token.trim()}
              >
                {t('integrations.railway.connect')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {hasError ? (
        <p className="mt-2 text-[11px] text-red-400">{error ?? connection?.lastError}</p>
      ) : null}

      <div className="mt-3 flex flex-col gap-1 rounded-md border border-zinc-900 bg-zinc-950/60 p-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
          <ExternalLink className="h-3 w-3" />
          {t('integrations.railway.webhookTitle')}
        </div>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-zinc-900 px-2 py-1 text-[11px] text-zinc-400">{webhookUrl}</code>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 text-xs"
            onClick={() => void handleCopy()}
          >
            {copied ? <Check className="mr-1 h-3 w-3 text-emerald-400" /> : <Copy className="mr-1 h-3 w-3" />}
            {t('integrations.railway.copy')}
          </Button>
        </div>
        <p className="text-[11px] leading-4 text-zinc-600">{t('integrations.railway.webhookHint')}</p>
      </div>
    </div>
  )
}
