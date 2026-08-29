// [INPUT]: 官方连接器 provider catalog + 已配置连接
// [OUTPUT]: 连接管理对话框（api_key 连接创建/删除）
// [POS]: Integrations 页连接管理 UI——代理经 Wemux server，凭据不落 web
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useMemo, useState } from 'react'
import { KeyRound, Link2, Loader2, Search, Trash2 } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import { getStoredCollaborationWorkspaceId } from '../../lib/collaboration-workspace'
import {
  api,
} from '../../lib/api'
import type {
  ConnectorConnectionRecord,
  ConnectorProviderRecord,
} from '../../lib/api/methods/connector'

const tr = (language: string, zh: string, en: string) => (language === 'zh' ? zh : en)

export function ConnectorConnectionsDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { open, onOpenChange } = props
  const { t, language } = useTranslation()
  const [providers, setProviders] = useState<ConnectorProviderRecord[]>([])
  const [connections, setConnections] = useState<ConnectorConnectionRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ConnectorProviderRecord | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // 添加连接时的归属选择
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
    if (open) {
      setSelected(null)
      setApiKey('')
      setQuery('')
      setError('')
      setNotice('')
      void reload()
    }
  }, [open, language])

  const visibleConnections = useMemo(
    () => connections.filter((connection) => connection.authType !== 'no_auth'),
    [connections],
  )

  const filteredProviders = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return []
    }
    return providers
      .filter((provider) => (
        provider.displayName.toLowerCase().includes(normalized)
        || provider.service.toLowerCase().includes(normalized)
      ))
      .filter((provider) => provider.authTypes?.includes('api_key'))
      .slice(0, 12)
  }, [providers, query])

  const handleConnect = async () => {
    if (!selected || !apiKey.trim()) {
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await api.createConnectorConnection(selected.service, {
        authType: 'api_key',
        values: { apiKey: apiKey.trim() },
        workspaceId: shareToWorkspace ? currentWorkspaceId ?? undefined : undefined,
      })
      setNotice(tr(language, `已连接 ${selected.displayName}`, `Connected ${selected.displayName}`))
      setSelected(null)
      setApiKey('')
      setQuery('')
      await reload()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(tr(language, `连接失败：${message}`, `Connection failed: ${message}`))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (connection: ConnectorConnectionRecord) => {
    setError('')
    try {
      await api.deleteConnectorConnection(connection.id)
      await reload()
    } catch (cause) {
      setError(tr(language, '删除失败：' + String(cause), 'Delete failed: ' + String(cause)))
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

  const authField = selected?.auth?.find((field) => field.type === 'api_key')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('integrations.connector.connectionsTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          {error ? (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
          ) : null}
          {notice ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</div>
          ) : null}

          {/* 已连接账号 */}
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t('integrations.connector.connectedAccounts')}</p>
            <div className="mt-2 space-y-1.5">
              {loading ? (
                <div className="flex items-center gap-2 px-1 py-2 text-xs text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('common.loading')}
                </div>
              ) : visibleConnections.length === 0 ? (
                <p className="px-1 py-2 text-xs text-zinc-600">{t('integrations.connector.noConnections')}</p>
              ) : (
                visibleConnections.map((connection) => (
                  <div
                    key={connection.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Link2 className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      <span className="truncate text-xs text-zinc-200">{connection.service}</span>
                      <Badge className={cn('rounded-md px-1.5 py-0 text-[10px] font-medium', connection.visibility === 'workspace' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-zinc-700 bg-zinc-900 text-zinc-300')}>
                        {connection.visibility === 'workspace' ? tr(language, '组织共享', 'Organization shared') : tr(language, '个人', 'Personal')}
                      </Badge>
                      {connection.ownerUserId ? (
                        <span className="truncate text-[11px] text-zinc-600" title="owner">
                          · {connection.ownerUserId.slice(0, 6)}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {connection.visibility === 'personal' && currentWorkspaceId ? (
                        <button
                          type="button"
                          onClick={() => void handleUpdateScope(connection, 'workspace')}
                          className="rounded-md px-1.5 py-1 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-emerald-300"
                        >
                          {tr(language, '共享到组织', 'Share to organization')}
                        </button>
                      ) : null}
                      {connection.visibility === 'workspace' ? (
                        <button
                          type="button"
                          onClick={() => void handleUpdateScope(connection, 'personal')}
                          className="rounded-md px-1.5 py-1 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-amber-300"
                        >
                          {tr(language, '设为私人', 'Make personal')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleDelete(connection)}
                        className="rounded-md p-1 text-zinc-600 transition-colors hover:bg-zinc-900 hover:text-rose-300"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 添加连接 */}
          <div className="border-t border-zinc-900 pt-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t('integrations.connector.addConnection')}</p>
            <div className="mt-2 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={tr(language, '搜索 provider（GitHub / Notion / …）', 'Search provider (GitHub / Notion / …)')}
                  className="h-8 border-zinc-800 bg-zinc-950 pl-8 text-xs text-zinc-200 placeholder:text-zinc-600"
                />
              </div>

              {query.trim() && filteredProviders.length > 0 ? (
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {filteredProviders.map((provider) => (
                    <button
                      key={provider.service}
                      type="button"
                      onClick={() => {
                        setSelected(provider)
                        setApiKey('')
                      }}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-left transition-colors',
                        selected?.service === provider.service
                          ? 'border-zinc-600 bg-zinc-900'
                          : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900/60',
                      )}
                    >
                      <span className="text-xs text-zinc-200">{provider.displayName}</span>
                      <span className="text-[10px] text-zinc-600">{provider.service}</span>
                    </button>
                  ))}
                </div>
              ) : query.trim() ? (
                <p className="px-1 text-[11px] text-zinc-600">{t('integrations.connector.noProviders')}</p>
              ) : null}

              {selected ? (
                <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-200">{selected.displayName}</span>
                    <KeyRound className="h-3.5 w-3.5 text-zinc-500" />
                  </div>
                  {authField?.description ? (
                    <p className="text-[11px] leading-relaxed text-zinc-500">{authField.description}</p>
                  ) : null}
                  {currentWorkspaceId ? (
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
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
                  <Input
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={authField?.placeholder ?? tr(language, '粘贴 API Key', 'Paste API Key')}
                    className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-200 placeholder:text-zinc-600"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => setSelected(null)}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={saving || !apiKey.trim()}
                      onClick={() => void handleConnect()}
                    >
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {t('integrations.connector.connect')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
