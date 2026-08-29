// [INPUT]: GitHub App 安装状态 + 官方连接器 MCP 配置
// [OUTPUT]: 集成列表页（已安装 / 即将推出）
// [POS]: Integrations 页——产品化"插件"心智，MCP/Skill 保留为高级设置
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useState } from 'react'
import { GitPullRequest, Mail, MessageSquare, Plug, Rocket, StickyNote, CalendarDays } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { OFFICIAL_CONNECTOR_MCP_SERVER_ID } from '@shared/mcp'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import { api } from '../../lib/api'
import { useApp } from '../../lib/app-provider'
import { useExperimentalSettings } from '../../lib/use-experimental-settings'
import { ConnectorConnectionsDialog } from './connector-connections-dialog'
import { ConnectorProviderMarket } from './connector-provider-market'
import { RailwayIntegrationCard } from './railway-integration-card'

type GithubInstallationSummary = {
  installations: unknown[]
  configured: boolean
  appSlug?: string
}

const connectorTone = 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
const warningTone = 'border-amber-500/20 bg-amber-500/10 text-amber-300'
const idleTone = 'border-zinc-700 bg-zinc-900 text-zinc-300'

export function IntegrationsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { settingsDraft } = useApp()
  const experimentalSettings = useExperimentalSettings()
  const connectorEnabled = experimentalSettings.openConnector
  const [github, setGithub] = useState<GithubInstallationSummary | null>(null)
  const [connectionsOpen, setConnectionsOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api.listUserGitHubAppInstallations()
      .then((response) => {
        if (!cancelled) {
          setGithub({ installations: response.installations, configured: response.configured, appSlug: response.appSlug })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGithub({ installations: [], configured: false })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const connectorServer = settingsDraft.mcpServers?.find(
    (server) => server.id === OFFICIAL_CONNECTOR_MCP_SERVER_ID || server.name === 'official-connector',
  )

  const githubConnected = Boolean(github?.configured && (github.installations?.length ?? 0) > 0)
  const githubConfiguredOnly = Boolean(github?.configured && (github.installations?.length ?? 0) === 0)
  const githubInstallationCount = github?.installations?.length ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-zinc-900 px-5 py-4">
        <div>
          <h1 className="text-sm font-semibold text-zinc-100">{t('integrations.title')}</h1>
          <p className="mt-1 text-xs text-zinc-500">{t('integrations.subtitle')}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {t('integrations.installed')}
          </h2>

          {/* GitHub —— 深度集成 */}
          <div className="flex items-center justify-between gap-4 rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900">
                <GitPullRequest className="h-4 w-4 text-zinc-300" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200">{t('integrations.github.name')}</span>
                  <Badge className={cn('rounded-md px-1.5 py-0 text-[10px] font-medium', githubConnected ? connectorTone : githubConfiguredOnly ? warningTone : idleTone)}>
                    {githubConnected
                      ? t('integrations.github.connected', { count: githubInstallationCount })
                      : githubConfiguredOnly
                        ? t('integrations.github.configuredNotInstalled')
                        : t('integrations.github.notConfigured')}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">{t('integrations.github.desc')}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => void navigate({
                  to: '/settings' as never,
                  search: { section: 'git' } as never,
                })}
              >
                {githubConnected ? t('integrations.github.manage') : t('integrations.github.connect')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => void navigate({ to: '/review' as never, search: {} as never })}
              >
                {t('integrations.github.openReviews')}
              </Button>
            </div>
          </div>

          {/* Official Connector —— 全部 provider 应用市场，默认展开、点击即连（紧凑 header + 市场）
              实验性 flag 门控：未开启时显示锁定态，开启后才渲染连接器市场/管理入口 */}

          <RailwayIntegrationCard />

          {!connectorEnabled ? (
            <div className="flex items-center justify-between gap-4 rounded-md border border-zinc-900 bg-zinc-950/60 p-3 opacity-70">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/60">
                  <Plug className="h-4 w-4 text-zinc-500" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-400">{t('integrations.connector.name')}</span>
                    <Badge className="rounded-md border-zinc-800 bg-zinc-900 px-1.5 py-0 text-[10px] font-medium text-zinc-500">
                      {t('integrations.connector.experimentalOff')}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-600">{t('integrations.connector.desc')}</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 text-xs"
                onClick={() => void navigate({
                  to: '/settings' as never,
                  search: { section: 'experimental' } as never,
                })}
              >
                {t('integrations.connector.experimentalEnable')}
              </Button>
            </div>
          ) : null}

          {connectorEnabled && connectorServer ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200">{t('integrations.connector.name')}</span>
                  <Badge className={cn('rounded-md px-1.5 py-0 text-[10px] font-medium', connectorTone)}>
                    {t('integrations.connector.enabled')}
                  </Badge>
                  <span className="hidden truncate text-xs text-zinc-600 sm:inline">{t('integrations.connector.desc')}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setConnectionsOpen(true)}
                  >
                    {t('integrations.connector.accounts')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => void navigate({ to: '/mcp' })}
                  >
                    {t('integrations.connector.manage')}
                  </Button>
                </div>
              </div>
              <ConnectorProviderMarket />
            </div>
          ) : null}
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {t('integrations.comingSoon')}
          </h2>

          {[
            { icon: Mail, nameKey: 'integrations.gmail.name', descKey: 'integrations.gmail.desc' },
            { icon: MessageSquare, nameKey: 'integrations.slack.name', descKey: 'integrations.slack.desc' },
            { icon: StickyNote, nameKey: 'integrations.notion.name', descKey: 'integrations.notion.desc' },
            { icon: CalendarDays, nameKey: 'integrations.calendar.name', descKey: 'integrations.calendar.desc' },
          ].map((item) => {
            const Icon = item.icon
            return (
              <div
                key={item.nameKey}
                className="flex items-center justify-between gap-4 rounded-md border border-zinc-900 bg-zinc-950/60 p-3 opacity-60"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/60">
                    <Icon className="h-4 w-4 text-zinc-500" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-400">{t(item.nameKey)}</span>
                      <Badge className="rounded-md border-zinc-800 bg-zinc-900 px-1.5 py-0 text-[10px] font-medium text-zinc-500">
                        <Rocket className="mr-0.5 h-2.5 w-2.5" />
                        {t('integrations.comingSoonTag')}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-600">{t(item.descKey)}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </section>
      </div>

      <ConnectorConnectionsDialog open={connectionsOpen} onOpenChange={setConnectionsOpen} />
    </div>
  )
}
