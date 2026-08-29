// [INPUT]: Model profile inventory, agent runtime config draft, executor inventory, usage summary APIs.
// [OUTPUT]: Model center page with three scoped tabs: inventory, defaults, and usage.
// [POS]: Models-page assembly; owns data loading, dialogs, and tab switching.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentConfig, ModelProfile } from '@shared/types'
import {
  COLLABORATION_WORKSPACE_CHANGE_EVENT,
  getStoredCollaborationWorkspaceId,
  resolveCollaborationWorkspaceId,
} from '../../lib/collaboration-workspace'
import { cn } from '../../lib/utils'
import { api, type CollaborationWorkspace, type Team } from '../../lib/api'
import { useTranslation } from '../../lib/i18n/react'
import { useApp } from '../../lib/app-provider'
import { Button } from '../ui/button'
import { ModelAddDialog } from './model-add-dialog'
import { ModelCreateDialog, ModelEditDialog } from './model-profile-dialog'
import { ModelCenterRuntimePanel } from './model-center-runtime-panel'
import { ModelUsagePanel } from './model-usage-panel'
import { StatCard } from './models-stat-card'
import { ModelInventoryTab } from './model-inventory-tab'
import { useModelCenterRuntimeState } from './use-model-center-runtime-state'
import { AccountStatusDot, ApiKeyConnectDialog, ChatgptConnectDialog, ClaudeConnectDialog, OpenrouterConnectDialog } from './account-connect-dialogs'
import { getAuthProviderTemplate } from './provider-auth-templates'

export type ModelsTabId = 'models' | 'defaults' | 'usage'

type ModelUsagePeriod = '7d' | '30d' | 'all'

const tabOptions: Array<{ id: ModelsTabId, zh: string, en: string }> = [
  { id: 'models', zh: '模型', en: 'Models' },
  { id: 'defaults', zh: '默认配置', en: 'Defaults' },
  { id: 'usage', zh: '用量', en: 'Usage' },
]

export function ModelsPage({
  tab,
  onTabChange,
}: {
  tab: ModelsTabId
  onTabChange: (tab: ModelsTabId) => void
}) {
  const { language, t } = useTranslation()
  const { busy: appBusy, runMutation, setSettingsDraft, settingsDraft } = useApp()
  const [profiles, setProfiles] = useState<ModelProfile[]>([])
  const [workspaces, setWorkspaces] = useState<CollaborationWorkspace[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [executors, setExecutors] = useState<Awaited<ReturnType<typeof api.listModelProfiles>>['executors']>([])
  const [usageSummary, setUsageSummary] = useState<Awaited<ReturnType<typeof api.getModelUsageSummary>>['summary'] | null>(null)
  const [defaultWorkspaceId, setDefaultWorkspaceId] = useState('')
  const [loading, setLoading] = useState(true)
  const [pageBusy, setPageBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editingProfileId, setEditingProfileId] = useState('')
  const [usagePeriod, setUsagePeriod] = useState<ModelUsagePeriod>('30d')
  const [chatgptDialogOpen, setChatgptDialogOpen] = useState(false)
  const [claudeDialogOpen, setClaudeDialogOpen] = useState(false)
  const [openrouterDialogOpen, setOpenrouterDialogOpen] = useState(false)
  const [apiKeyDialogTemplateId, setApiKeyDialogTemplateId] = useState('')
  const [chatgptConnected, setChatgptConnected] = useState(false)
  const [claudeConnected, setClaudeConnected] = useState(false)
  const [openrouterConnected, setOpenrouterConnected] = useState(false)
  const {
    activeRuntimeTab,
    executors: allExecutors,
    modelLoading,
    modelOptions,
    onlineExecutors,
    setActiveRuntimeTab,
  } = useModelCenterRuntimeState({
    config: settingsDraft,
    executors,
    onConfigChange: setSettingsDraft,
  })

  const loadProfiles = async () => {
    const [profileResponse, workspaceResponse, teamResponse] = await Promise.all([
      api.listModelProfiles(),
      api.listCollaborationWorkspaces().catch(() => ({ workspaces: [] })),
      api.listTeams().catch(() => ({ teams: [] })),
    ])
    setProfiles(profileResponse.profiles)
    setExecutors(profileResponse.executors)
    setWorkspaces(workspaceResponse.workspaces)
    setTeams(teamResponse.teams)
    setDefaultWorkspaceId((current) => resolveCollaborationWorkspaceId(
      workspaceResponse.workspaces,
      current || getStoredCollaborationWorkspaceId(),
    ))
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        await loadProfiles()
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : t('models.page.toasts.loadFailed'))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (tab !== 'usage') {
      return
    }
    let cancelled = false
    void api.getModelUsageSummary(usagePeriod)
      .then((response) => {
        if (!cancelled) {
          setUsageSummary(response?.summary ?? null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUsageSummary(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [tab, usagePeriod])

  useEffect(() => {
    const handleWorkspaceChange = (event: Event) => {
      const workspaceId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId
      setDefaultWorkspaceId(resolveCollaborationWorkspaceId(workspaces, workspaceId || getStoredCollaborationWorkspaceId()))
    }
    window.addEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
    return () => window.removeEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
  }, [workspaces])

  const editingProfile = profiles.find((p) => p.id === editingProfileId) ?? null

  // 账号连接状态（菜单与模型列表状态条共用）
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        if (onlineExecutors[0]?.executorId) {
          const accounts = await api.listCodexAccounts(onlineExecutors[0].executorId)
          if (!cancelled) {
            setChatgptConnected(accounts.accounts.length > 0)
          }
        }
      } catch {
        // worker 不可达时保持未连接
      }
      try {
        const status = await api.getClaudeAccountStatus()
        if (!cancelled) {
          setClaudeConnected(status.connected)
        }
      } catch {
        // 忽略
      }
      try {
        const status = await api.getOpenrouterAccountStatus()
        if (!cancelled) {
          setOpenrouterConnected(status.connected)
        }
      } catch {
        // 忽略
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [onlineExecutors])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Page header: title + actions + tabs */}
      <div className="shrink-0 border-b border-zinc-900 bg-[#060607]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5 lg:px-6">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-zinc-100">{t('models.page.title')}</h1>
            <p className="mt-0.5 text-[11px] leading-5 text-zinc-500">{t('models.page.subtitle')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              {language === 'zh' ? '新增' : 'Add'}
            </Button>
          </div>
        </div>
        <div className="flex items-end gap-1 overflow-x-auto px-3 sm:px-4 lg:px-5">
          {tabOptions.map((option) => {
            const active = tab === option.id
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onTabChange(option.id)}
                className={cn(
                  'shrink-0 rounded-t-lg border border-b-0 px-2.5 py-1.5 text-xs transition-colors',
                  active
                    ? 'border-zinc-800 bg-[#09090b] text-zinc-100'
                    : 'border-zinc-900 bg-zinc-950/70 text-zinc-500 hover:border-zinc-800 hover:text-zinc-200',
                )}
              >
                {language === 'zh' ? option.zh : option.en}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1">
        <div className={cn('h-full', tab !== 'models' && 'hidden')}>
          {loading ? (
            <div className="flex h-full items-center justify-center p-6">
              <p className="text-sm text-zinc-500">{t('models.page.loading')}</p>
            </div>
          ) : (
            <ModelInventoryTab
              profiles={profiles}
              sourceExecutors={executors}
              onlineExecutors={onlineExecutors}
              accountStatus={{ chatgpt: chatgptConnected, claude: claudeConnected, openrouter: openrouterConnected }}
              busy={pageBusy}
              onEdit={setEditingProfileId}
              onDeleted={() => void loadProfiles()}
            />
          )}
        </div>

        <div className={cn('h-full overflow-auto', tab !== 'defaults' && 'hidden')}>
          <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
            <ModelCenterRuntimePanel
              activeRuntimeTab={activeRuntimeTab}
              busy={pageBusy || appBusy}
              config={settingsDraft}
              language={language}
              modelLoading={modelLoading}
              modelOptions={modelOptions}
              executors={allExecutors}
              onConfigChange={setSettingsDraft}
              onRuntimeTabChange={setActiveRuntimeTab}
              onSave={(config: AgentConfig) => {
                setSettingsDraft(config)
                void runMutation(() => api.saveSettings(config))
              }}
            />
          </div>
        </div>

        <div className={cn('h-full overflow-auto', tab !== 'usage' && 'hidden')}>
          <div className="space-y-5 px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
            <div className="rounded-lg border border-zinc-900 bg-[#09090b]">
              <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
                {([
                  { value: '7d', zh: '最近 7 天', en: 'Last 7 Days' },
                  { value: '30d', zh: '最近 30 天', en: 'Last 30 Days' },
                  { value: 'all', zh: '全部', en: 'All Time' },
                ] as const).map((option) => {
                  const active = usagePeriod === option.value
                  return (
                    <Button
                      key={option.value}
                      type="button"
                      size="sm"
                      variant="ghost"
                      className={cn(
                        'h-7 rounded-md px-2 py-1 text-[11px] font-medium',
                        active
                          ? 'bg-zinc-100 text-zinc-950'
                          : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
                      )}
                      onClick={() => setUsagePeriod(option.value)}
                    >
                      {language === 'zh' ? option.zh : option.en}
                    </Button>
                  )
                })}
              </div>
            </div>

            {usageSummary ? (
              <div className="grid gap-3 md:grid-cols-3">
                <StatCard
                  label={language === 'zh' ? '累计 Token' : 'Total Tokens'}
                  value={usageSummary.totals.totalTokens.toLocaleString()}
                  hint={language === 'zh' ? '仅统计已记录 usage 的执行' : 'Recorded usage only'}
                />
                <StatCard
                  label={language === 'zh' ? '模型调用次数' : 'Model Runs'}
                  value={usageSummary.totals.runCount.toLocaleString()}
                  hint={language === 'zh' ? '包含工作区与任务执行' : 'Workspace and task runs'}
                />
                <StatCard
                  label={language === 'zh' ? '已记录 Token 的调用' : 'Tracked Token Runs'}
                  value={usageSummary.totals.recordedTokenRunCount.toLocaleString()}
                  hint={language === 'zh' ? '具备 provider usage 明细' : 'Runs with provider usage detail'}
                />
              </div>
            ) : null}

            <ModelUsagePanel summary={usageSummary} language={language} />
          </div>
        </div>
      </div>

      <ModelAddDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        chatgptConnected={chatgptConnected}
        claudeConnected={claudeConnected}
        openrouterConnected={openrouterConnected}
        chatgptDisabled={!onlineExecutors[0]?.executorId}
        onSelectCustom={() => {
          setAddOpen(false)
          setCreateOpen(true)
        }}
        onSelectChatgpt={() => {
          setAddOpen(false)
          setChatgptDialogOpen(true)
        }}
        onSelectClaude={() => {
          setAddOpen(false)
          setClaudeDialogOpen(true)
        }}
        onSelectOpenrouter={() => {
          setAddOpen(false)
          setOpenrouterDialogOpen(true)
        }}
        onSelectApiKeyTemplate={(templateId) => {
          setAddOpen(false)
          setApiKeyDialogTemplateId(templateId)
        }}
      />

      <ModelCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultWorkspaceId={defaultWorkspaceId}
        workspaces={workspaces}
        teams={teams}
        busy={pageBusy}
        onCreate={async (payload) => {
          setPageBusy(true)
          try {
            const response = await api.createModelProfile(payload)
            toast.success(response.message || t('models.page.toasts.created'))
            setCreateOpen(false)
            await loadProfiles()
          } catch (error) {
            toast.error(error instanceof Error ? error.message : t('models.page.toasts.createFailed'))
          } finally {
            setPageBusy(false)
          }
        }}
      />

      <ModelEditDialog
        open={Boolean(editingProfile)}
        onOpenChange={(open) => {
          if (!open) setEditingProfileId('')
        }}
        profile={editingProfile}
        workspaces={workspaces}
        teams={teams}
        sourceExecutors={executors}
        busy={pageBusy}
        onSave={async (profileId, payload) => {
          setPageBusy(true)
          try {
            const response = await api.updateModelProfile(profileId, payload)
            toast.success(response.message || t('models.page.toasts.updated'))
            setEditingProfileId('')
            await loadProfiles()
          } catch (error) {
            toast.error(error instanceof Error ? error.message : t('models.page.toasts.updateFailed'))
          } finally {
            setPageBusy(false)
          }
        }}
      />

      <ChatgptConnectDialog
        open={chatgptDialogOpen}
        onOpenChange={setChatgptDialogOpen}
        onlineExecutors={onlineExecutors}
        onConnected={(accounts) => {
          setChatgptConnected(accounts.length > 0)
        }}
      />

      <ClaudeConnectDialog
        open={claudeDialogOpen}
        onOpenChange={setClaudeDialogOpen}
        onConnected={() => setClaudeConnected(true)}
      />

      <OpenrouterConnectDialog
        open={openrouterDialogOpen}
        onOpenChange={setOpenrouterDialogOpen}
        onConnected={() => {
          setOpenrouterConnected(true)
          void loadProfiles()
        }}
      />

      <ApiKeyConnectDialog
        open={Boolean(apiKeyDialogTemplateId)}
        onOpenChange={(next) => {
          if (!next) {
            setApiKeyDialogTemplateId('')
          }
        }}
        template={getAuthProviderTemplate(apiKeyDialogTemplateId)}
        onCreated={() => void loadProfiles()}
      />
    </div>
  )
}
