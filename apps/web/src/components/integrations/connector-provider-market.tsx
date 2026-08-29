// [INPUT]: open-connector provider catalog + 已配置连接
// [OUTPUT]: 官方连接器应用市场（全部 provider 直接展开 + 内联连接/断开）
// [POS]: Integrations 页官方连接器卡片下的应用网格——所有应用默认展开、点击即连
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useMemo, useState } from 'react'
import { Check, ExternalLink, KeyRound, Loader2, Search, Unplug } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import { getStoredCollaborationWorkspaceId } from '../../lib/collaboration-workspace'
import { api } from '../../lib/api'
import type {
  ConnectorConnectionRecord,
  ConnectorProviderRecord,
} from '../../lib/api/methods/connector'

const tr = (language: string, zh: string, en: string) => (language === 'zh' ? zh : en)

// 优先展示的常用分类（其余按 provider 数量补足）
const POPULAR_CATEGORIES = [
  'Productivity',
  'Developer Tools',
  'AI',
  'Marketing',
  'Communication',
  'Finance',
  'Data',
  'Design & Media',
]

const connectorTone = 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'

// 按 service 生成确定性色相，保证同一 provider 永远同色
const providerHue = (service: string) => {
  let hash = 0
  for (let i = 0; i < service.length; i++) {
    hash = (hash * 31 + service.charCodeAt(i)) >>> 0
  }
  return hash % 360
}

function ProviderIcon({ provider }: { provider: ConnectorProviderRecord }) {
  const [failed, setFailed] = useState(false)
  const hue = providerHue(provider.service)
  if (provider.iconUrl && !failed) {
    return (
      <img
        src={provider.iconUrl}
        alt={provider.displayName}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-10 w-10 shrink-0 rounded-md border border-zinc-800 bg-zinc-900 object-contain"
      />
    )
  }
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border text-xs font-bold"
      style={{
        backgroundColor: `hsl(${hue} 28% 18%)`,
        color: `hsl(${hue} 70% 72%)`,
        borderColor: `hsl(${hue} 30% 28%)`,
      }}
    >
      {provider.displayName.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function ConnectorProviderMarket() {
  const { t, language } = useTranslation()
  const [providers, setProviders] = useState<ConnectorProviderRecord[]>([])
  const [connections, setConnections] = useState<ConnectorConnectionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [dialogProvider, setDialogProvider] = useState<ConnectorProviderRecord | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  // 创建连接时的归属选择：true = 共享到当前组织（成员可用），false = 仅自己可见
  const [shareToWorkspace, setShareToWorkspace] = useState(true)

  const currentWorkspaceId = getStoredCollaborationWorkspaceId()?.trim() || undefined

  const reload = async () => {
    setLoading(true)
    setError('')
    try {
      const [providerList, connectionList] = await Promise.all([
        api.listConnectorProviders(),
        api.listConnectorConnections(currentWorkspaceId ?? undefined),
      ])
      setProviders(providerList)
      setConnections(connectionList)
    } catch (cause) {
      setError(tr(language, '连接器 runtime 不可达：' + String(cause), 'Connector runtime unreachable: ' + String(cause)))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connectionsByService = useMemo(() => {
    const map = new Map<string, ConnectorConnectionRecord[]>()
    for (const connection of connections) {
      if (connection.authType === 'no_auth') {
        continue
      }
      const list = map.get(connection.service) ?? []
      list.push(connection)
      map.set(connection.service, list)
    }
    return map
  }, [connections])

  const connectedServices = useMemo(() => new Set(connectionsByService.keys()), [connectionsByService])

  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const provider of providers) {
      for (const c of provider.categories ?? []) {
        counts.set(c, (counts.get(c) ?? 0) + 1)
      }
    }
    const popular = POPULAR_CATEGORIES.filter((c) => counts.has(c))
    const extra = [...counts.entries()]
      .filter(([c]) => !POPULAR_CATEGORIES.includes(c))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([c]) => c)
    return [...popular, ...extra]
  }, [providers])

  const filteredProviders = useMemo(() => {
    const q = query.trim().toLowerCase()
    return providers.filter((provider) => {
      if (category && !(provider.categories ?? []).includes(category)) {
        return false
      }
      if (!q) {
        return true
      }
      return (
        provider.displayName.toLowerCase().includes(q)
        || provider.service.toLowerCase().includes(q)
      )
    })
  }, [providers, query, category])

  // 已连接置顶，其余按名称排序
  const sortedProviders = useMemo(() => {
    const connected: ConnectorProviderRecord[] = []
    const rest: ConnectorProviderRecord[] = []
    for (const provider of filteredProviders) {
      (connectedServices.has(provider.service) ? connected : rest).push(provider)
    }
    rest.sort((a, b) => a.displayName.localeCompare(b.displayName))
    return [...connected, ...rest]
  }, [filteredProviders, connectedServices])

  const canConnectDirectly = (provider: ConnectorProviderRecord) =>
    (provider.authTypes ?? []).includes('api_key')

  const isOAuthOnly = (provider: ConnectorProviderRecord) => {
    const authTypes = provider.authTypes ?? []
    return authTypes.length === 1 && authTypes[0] === 'oauth2'
  }

  const handleConnect = async () => {
    if (!dialogProvider || !apiKey.trim()) {
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await api.createConnectorConnection(dialogProvider.service, {
        authType: 'api_key',
        values: { apiKey: apiKey.trim() },
        workspaceId: shareToWorkspace ? currentWorkspaceId ?? undefined : undefined,
      })
      setNotice(tr(language, `已连接 ${dialogProvider.displayName}`, `Connected ${dialogProvider.displayName}`))
      setDialogProvider(null)
      setApiKey('')
      await reload()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(tr(language, `连接失败：${message}`, `Connection failed: ${message}`))
    } finally {
      setSaving(false)
    }
  }

  const handleDisconnect = async (connection: ConnectorConnectionRecord) => {
    setError('')
    setNotice('')
    try {
      await api.deleteConnectorConnection(connection.id)
      await reload()
    } catch (cause) {
      setError(tr(language, '断开失败：' + String(cause), 'Disconnect failed: ' + String(cause)))
    }
  }

  const handleUpdateScope = async (connection: ConnectorConnectionRecord, visibility: 'personal' | 'workspace') => {
    setError('')
    setNotice('')
    try {
      await api.updateConnectorConnection(connection.id, {
        visibility,
        workspaceId: visibility === 'workspace' ? currentWorkspaceId ?? undefined : undefined,
      })
      setNotice(visibility === 'workspace'
        ? tr(language, '已共享到当前组织', 'Shared to current organization')
        : tr(language, '已设为仅自己可见', 'Set to personal only'))
      await reload()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(tr(language, '切换失败：' + message, `Scope change failed: ${message}`))
    }
  }

  if (loading && providers.length === 0) {
    return (
      <div className="flex items-center gap-2 px-1 py-6 text-xs text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</div>
      ) : null}

      {/* 搜索 + 分类 */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tr(language, '搜索应用（名称 / 服务）', 'Search apps (name / service)')}
            className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-950 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setCategory(null)}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              category === null
                ? 'bg-zinc-100 text-zinc-950'
                : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
            )}
          >
            {t('integrations.connector.all')}
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(category === c ? null : c)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                category === c
                  ? 'bg-zinc-100 text-zinc-950'
                  : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* 应用网格 */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {t('integrations.connector.apps')} · {sortedProviders.length}
        </p>
        {sortedProviders.length === 0 ? (
          <div className="mt-2 rounded-md border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-5 text-center text-xs text-zinc-500">
            {t('integrations.connector.noMatchingApps')}
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 items-start gap-1.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {sortedProviders.map((provider) => {
              const connected = connectedServices.has(provider.service)
              const connectable = canConnectDirectly(provider)
              const oauthOnly = isOAuthOnly(provider)
              const actionCount = provider.execution?.actionCount ?? provider.actions?.length ?? 0
              const disabled = oauthOnly && !connected
              return (
                <div
                  key={provider.service}
                  className={cn(
                    'rounded-md border bg-zinc-950 transition-colors',
                    connected ? 'border-emerald-500/25' : 'border-zinc-800',
                    disabled ? 'opacity-40 cursor-not-allowed' : 'hover:border-zinc-700',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (disabled) return
                      setDialogProvider(provider)
                      setApiKey('')
                      setError('')
                      setNotice('')
                    }}
                    disabled={disabled}
                    className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
                  >
                    <ProviderIcon provider={provider} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-zinc-200">{provider.displayName}</span>
                        {connected ? (
                          <Badge className={cn('shrink-0 rounded-md px-1.5 py-0 text-[10px] font-medium', connectorTone)}>
                            <Check className="h-2.5 w-2.5" />
                            {t('integrations.connector.connected')}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-zinc-600">
                        {(provider.categories ?? []).slice(0, 2).join(' · ') || provider.service}
                        {actionCount > 0 ? ` · ${actionCount} ${tr(language, '个操作', 'actions')}` : ''}
                      </span>
                      {oauthOnly && !connected ? (
                        <span className="mt-1 block text-[10px] text-zinc-600">
                          {t('integrations.connector.oauthNotSupported')}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Dialog for connection */}
      {dialogProvider ? (
        <Dialog open={Boolean(dialogProvider)} onOpenChange={(open) => !open && setDialogProvider(null)}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>
                {connectedServices.has(dialogProvider.service)
                  ? t('integrations.connector.manageConnectionsTitle', { name: dialogProvider.displayName })
                  : t('integrations.connector.connectDialogTitle', { name: dialogProvider.displayName })}
              </DialogTitle>
            </DialogHeader>
            <DialogBody className="space-y-4">
              {error ? (
                <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
              ) : null}
              {notice ? (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</div>
              ) : null}

              {connectedServices.has(dialogProvider.service) ? (
                <>
                  {(connectionsByService.get(dialogProvider.service) ?? []).map((connection) => (
                    <div key={connection.id} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 truncate text-[11px] text-zinc-400">
                          {connection.accountLabel ?? connection.connectionName}
                        </span>
                        <Badge className={cn('shrink-0 rounded-md px-1.5 py-0 text-[10px] font-medium', connection.visibility === 'workspace' ? connectorTone : 'border-zinc-700 bg-zinc-900 text-zinc-300')}>
                          {connection.visibility === 'workspace' ? tr(language, '组织共享', 'Organization') : tr(language, '个人', 'Personal')}
                        </Badge>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {connection.visibility === 'personal' && currentWorkspaceId ? (
                          <button
                            type="button"
                            onClick={() => void handleUpdateScope(connection, 'workspace')}
                            className="rounded-md px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-emerald-300"
                          >
                            {tr(language, '共享到组织', 'Share to organization')}
                          </button>
                        ) : null}
                        {connection.visibility === 'workspace' ? (
                          <button
                            type="button"
                            onClick={() => void handleUpdateScope(connection, 'personal')}
                            className="rounded-md px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-amber-300"
                          >
                            {tr(language, '设为私人', 'Make personal')}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void handleDisconnect(connection)}
                          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-rose-300"
                        >
                          <Unplug className="h-3 w-3" />
                          {t('integrations.connector.disconnect')}
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              ) : canConnectDirectly(dialogProvider) ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <KeyRound className="h-3 w-3 shrink-0 text-zinc-500" />
                    <Input
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={tr(language, '粘贴 API Key', 'Paste API Key')}
                      autoFocus
                      className="h-7 rounded-md border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-200 placeholder:text-zinc-600"
                    />
                  </div>
                  {currentWorkspaceId ? (
                    <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                      <button
                        type="button"
                        onClick={() => setShareToWorkspace(true)}
                        className={cn(
                          'flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors',
                          shareToWorkspace ? 'bg-emerald-500/10 text-emerald-300' : 'hover:bg-zinc-900 hover:text-zinc-300',
                        )}
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', shareToWorkspace ? 'bg-emerald-400' : 'bg-zinc-600')} />
                        {tr(language, '共享到组织（成员可用）', 'Share to organization (members can use)')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShareToWorkspace(false)}
                        className={cn(
                          'flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors',
                          !shareToWorkspace ? 'bg-zinc-100 text-zinc-950' : 'hover:bg-zinc-900 hover:text-zinc-300',
                        )}
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', !shareToWorkspace ? 'bg-zinc-100' : 'bg-zinc-600')} />
                        {tr(language, '仅自己可见', 'Personal only')}
                      </button>
                    </div>
                  ) : null}
                  {dialogProvider.homepageUrl ? (
                    <a
                      href={dialogProvider.homepageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-[10px] text-zinc-600 transition-colors hover:text-zinc-300"
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                      {tr(language, '获取 API Key', 'Get API Key')}
                    </a>
                  ) : null}
                </>
              ) : null}
            </DialogBody>
            {!connectedServices.has(dialogProvider.service) && canConnectDirectly(dialogProvider) ? (
              <DialogFooter>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() => setDialogProvider(null)}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 bg-zinc-100 px-3 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
                  disabled={saving || !apiKey.trim()}
                  onClick={() => void handleConnect()}
                >
                  {saving ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                  {t('integrations.connector.connect')}
                </Button>
              </DialogFooter>
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
