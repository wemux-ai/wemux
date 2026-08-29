import { useEffect, useState } from 'react'
import { ArrowLeft, Camera, Cloud, ExternalLink, Loader2, RotateCcw, Save, Send, ServerCog, Sparkles, Users2 } from 'lucide-react'
import type { UserNotificationSettings } from '@shared/user-notification-settings'
import { getWorkspaceOpenTargetLabel, listWorkspaceOpenTargets } from '@shared/workspace-open-command'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { Switch } from '../ui/switch'
import { Textarea } from '../ui/textarea'
import { ConnectionsPanel } from './connections-panel'
import { cn } from '../../lib/utils'
import { resolveMediaUrl } from '../../lib/api'
import { resolveLocalWorkerEndpoints } from '../../lib/browser-local-network-access'
import { getAutostartEnabled, isDesktopNativeClient, setAutostartEnabled } from '../../lib/native-client'
import { useTranslation } from '../../lib/i18n/react'
import { ModelUsagePanel } from '../models/model-usage-panel'
import { GitIdentitySettings } from './git-identity-settings'
import { isFloatingChatEnabled, setFloatingChatEnabled, subscribeFloatingChatEnabled } from '../floating-agent-chat/floating-chat-visibility'
import { AccountSecurityPanel } from './account-security-panel'
import { ApiTokensPanel } from './api-tokens-panel'
import { EXPERIMENTAL_FLAG_META } from './experimental-flag-meta'
import { useTheme } from '../theme-provider'
import { FieldBlock, MenuPanel, SettingsMenuList, type SettingsMenuId, type SettingsPageProps, StatCard } from './settings-page-shared'
import { useSettingsPageState } from './use-settings-page-state'
import { WorkspaceAdminPanel } from './workspace-admin-panel'
import { getSettingsSection } from './commercial-settings-gate'

export type { SettingsPageProps } from './settings-page-shared'


type NotificationCategoryKey = 'inboxMention' | 'groupChatMention' | 'groupChatMessage' | 'taskCompletion'
type NotificationCategoryField = 'browserEnabled' | 'soundEnabled'

const NOTIFICATION_CATEGORY_META: Array<{
  key: NotificationCategoryKey
  zhTitle: string
  enTitle: string
  zhDescription: string
  enDescription: string
  zhSound: string
  enSound: string
}> = [
  {
    key: 'inboxMention',
    zhTitle: '收件箱 @/指派',
    enTitle: 'Inbox mentions & assignments',
    zhDescription: '收件箱里有人 @你、指派任务或交接给你时，向当前浏览器发送系统通知。',
    enDescription: 'Send a browser notification when someone mentions you, assigns a task, or hands off work to you.',
    zhSound: '@ 提示音',
    enSound: 'Mention sound',
  },
  {
    key: 'groupChatMention',
    zhTitle: '群聊 @你',
    enTitle: 'Group chat @mentions',
    zhDescription: '工作区群聊里有人 @你时，向当前浏览器发送系统通知。',
    enDescription: 'Send a browser notification when someone @mentions you in a workspace group chat.',
    zhSound: '@ 提示音',
    enSound: 'Mention sound',
  },
  {
    key: 'groupChatMessage',
    zhTitle: '群聊新消息',
    enTitle: 'Group chat messages',
    zhDescription: '群聊里收到非 @ 的新消息时也弹通知（默认关闭，避免刷屏）。',
    enDescription: 'Also notify on new non-@ group chat messages (off by default to avoid noise).',
    zhSound: '消息提示音',
    enSound: 'Message sound',
  },
  {
    key: 'taskCompletion',
    zhTitle: '任务完成/失败',
    enTitle: 'Task completion',
    zhDescription: '任务执行完成或失败时，向当前浏览器发送系统通知。',
    enDescription: 'Send a browser notification when a task finishes or fails.',
    zhSound: '完成提示音',
    enSound: 'Completion sound',
  },
]

export function GlassRangeSetting({
  id,
  label,
  hint,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  id: string
  label: string
  hint: string
  value: number
  min: number
  max: number
  unit: string
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <label htmlFor={id} className="text-sm font-medium text-zinc-200">{label}</label>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{hint}</p>
        </div>
        <output htmlFor={id} className="shrink-0 rounded-md border border-zinc-800/80 bg-zinc-900/60 px-2 py-1 text-xs tabular-nums text-zinc-300">
          {value}{unit}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer accent-emerald-400"
      />
      <div className="flex justify-between text-[10px] tabular-nums text-zinc-600" aria-hidden="true">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  )
}

function NotificationCategoryRows(props: {
  language: 'zh' | 'en'
  settings: UserNotificationSettings
  onChange: (category: NotificationCategoryKey, field: NotificationCategoryField, checked: boolean) => void
}) {
  const { language, settings, onChange } = props
  return (
    <>
      {NOTIFICATION_CATEGORY_META.map((meta) => {
        const category = settings[meta.key]
        return (
          <div
            key={meta.key}
            className="rounded-[1.35rem] border border-zinc-800/90 bg-[linear-gradient(180deg,rgba(15,15,17,0.98),rgba(10,10,12,0.94))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">{language === 'zh' ? meta.zhTitle : meta.enTitle}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {language === 'zh' ? meta.zhDescription : meta.enDescription}
                </p>
              </div>
              <Switch
                checked={category.browserEnabled}
                onCheckedChange={(checked) => onChange(meta.key, 'browserEnabled', checked)}
              />
            </div>

            <div className="mt-4 flex items-start justify-between gap-4 border-t border-zinc-900 pt-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">{language === 'zh' ? meta.zhSound : meta.enSound}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {language === 'zh' ? '浏览器通知触发时额外播放一段短提示音。' : 'Play a short sound when the browser notification fires.'}
                </p>
              </div>
              <Switch
                checked={category.soundEnabled}
                onCheckedChange={(checked) => onChange(meta.key, 'soundEnabled', checked)}
              />
            </div>
          </div>
        )
      })}
    </>
  )
}

export function SettingsPage({
  user,
  config,
  notificationSettings,
  experimentalSettings,
  browserNotificationPermission,
  localNetworkAccessStatus,
  localWorkerHealthProbe,
  localWorkerHealthChecking,
  avatarStorage,
  busy,
  profileBusy,
  avatarBusy,
  teams,
  requestedSection,
  requestedWorkspaceId,
  onSectionChange,
  onWorkspaceSelectionChange,
  onSaveProfile,
  onUploadAvatar,
  onSave,
  onSaveNotificationSettings,
  onSaveExperimentalSettings,
  onRequestBrowserNotificationPermission,
  onTestBrowserNotification,
  onTestFeishuNotification,
  onTestPushNotification,
  onRequestLocalNetworkAccess,
  onRefreshLocalNetworkAccessStatus,
  onProbeLocalWorkerHealth,
  onReset,
}: SettingsPageProps) {
  const { t, language } = useTranslation()
  const { theme, setTheme, glass, updateGlass, resetGlass } = useTheme()
  const {
    activeMenu, draft,
    fileInputRef, isMobile, profileDraft, sections,
    notificationSettingsDraft, experimentalSettingsDraft, setActiveMenu, setDraft,
    setExperimentalSettingsDraft, setMobileView, setProfileDraft,
    setNotificationSettingsDraft, showMenuDetail, showMenuList,
  } = useSettingsPageState({
    config,
    notificationSettings,
    experimentalSettings,
    requestedSection,
    teams,
    user,
  })
  const [floatingChatEnabled, setFloatingChatEnabledState] = useState(isFloatingChatEnabled())

  // 设置页打开期间订阅开关变化（例如其它入口联动），保持 Switch 与真实状态一致。
  useEffect(() => subscribeFloatingChatEnabled(setFloatingChatEnabledState), [])

  const handleFloatingChatToggle = (checked: boolean) => {
    setFloatingChatEnabled(checked)
    setFloatingChatEnabledState(checked)
  }

  const updateNotificationCategory = (category: NotificationCategoryKey, field: NotificationCategoryField, checked: boolean) => {
    setNotificationSettingsDraft((current) => ({
      ...current,
      [category]: {
        ...current[category],
        [field]: checked,
      },
    }))
  }

  const [autostartEnabled, setAutostartEnabledState] = useState<boolean | null>(null)
  const [autostartBusy, setAutostartBusy] = useState(false)

  useEffect(() => {
    void getAutostartEnabled().then((value) => {
      if (value !== null) {
        setAutostartEnabledState(value)
      }
    })
  }, [])

  const handleAutostartToggle = (checked: boolean) => {
    setAutostartBusy(true)
    void setAutostartEnabled(checked).then((value) => {
      if (value !== null) {
        setAutostartEnabledState(value)
      }
      setAutostartBusy(false)
    })
  }

  const checkoutComingSoonLabel = language === 'zh' ? '即将到来' : 'Coming Soon'
  const localNetworkAccessStatusLabel = localNetworkAccessStatus === 'granted'
    ? (language === 'zh' ? '已允许' : 'Granted')
    : localNetworkAccessStatus === 'denied'
      ? (language === 'zh' ? '已拒绝' : 'Denied')
      : localNetworkAccessStatus === 'unsupported'
        ? (language === 'zh' ? '不支持' : 'Unsupported')
        : (language === 'zh' ? '未知' : 'Unknown')
  const localNetworkAccessStatusClassName = localNetworkAccessStatus === 'granted'
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
    : localNetworkAccessStatus === 'denied'
      ? 'border-rose-500/20 bg-rose-500/10 text-rose-200'
      : localNetworkAccessStatus === 'unsupported'
        ? 'border-zinc-800 bg-zinc-950 text-zinc-400'
        : 'border-amber-500/20 bg-amber-500/10 text-amber-100'
  const localWorkerHealthProbeLabel = !localWorkerHealthProbe
    ? (language === 'zh' ? '尚未测试' : 'Not tested')
    : localWorkerHealthProbe.ok
      ? localWorkerHealthProbe.readable
        ? (language === 'zh' ? '可达，响应可读' : 'Reachable, readable')
        : (language === 'zh' ? '可达，响应不可读' : 'Reachable, opaque response')
      : (language === 'zh' ? '不可达' : 'Unreachable')
  const localWorkerHealthProbeClassName = !localWorkerHealthProbe
    ? 'border-zinc-800 bg-zinc-950 text-zinc-400'
    : localWorkerHealthProbe.ok
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
      : 'border-rose-500/20 bg-rose-500/10 text-rose-200'
  const localNetworkAccessSettingsUrl = (() => {
    if (typeof window === 'undefined') {
      return 'chrome://settings/content/localNetworkAccess'
    }

    const browserSettingsScheme = navigator.userAgent.includes('Edg/') ? 'edge' : 'chrome'
    return `${browserSettingsScheme}://settings/content/siteDetails?site=${encodeURIComponent(window.location.origin)}`
  })()
  const localWorkerHealthUrl = localWorkerHealthProbe?.url ?? resolveLocalWorkerEndpoints()[0]?.healthUrl ?? 'http://127.0.0.1:48100/api/health'
  const workspaceOpenTargets = listWorkspaceOpenTargets()
  const workspaceOpenPanel = (
    <MenuPanel
      title={t('settings.workspaceOpen.title')}
      mobile={isMobile}
      onBack={isMobile ? () => setMobileView('menu') : undefined}
    >
      <div className="space-y-4">
        <FieldBlock
          label={t('settings.workspaceOpen.defaultTarget')}
          hint={t('settings.workspaceOpen.defaultTargetHint')}
        >
          <div className="space-y-3">
            <NativeSelect
              value={draft.workspaceOpenSettings.defaultTarget}
              onChange={(event) => setDraft((current) => ({
                ...current,
                workspaceOpenSettings: {
                  ...current.workspaceOpenSettings,
                  defaultTarget: event.target.value as typeof current.workspaceOpenSettings.defaultTarget,
                },
              }))}
            >
              {workspaceOpenTargets.map((target) => (
                <option key={target.value} value={target.value}>{target.label}</option>
              ))}
            </NativeSelect>
            <p className="text-xs leading-5 text-zinc-500">
              {t('settings.workspaceOpen.defaultTargetDescription', {
                target: getWorkspaceOpenTargetLabel(draft.workspaceOpenSettings.defaultTarget),
              })}
            </p>
          </div>
        </FieldBlock>

        <FieldBlock
          label={t('settings.workspaceOpen.customCommand')}
          hint={t('settings.workspaceOpen.customCommandHint')}
        >
          <div className="space-y-3">
            <Input
              value={draft.workspaceOpenSettings.customCommand}
              onChange={(event) => setDraft((current) => ({
                ...current,
                workspaceOpenSettings: {
                  ...current.workspaceOpenSettings,
                  customCommand: event.target.value,
                },
              }))}
              placeholder={t('settings.workspaceOpen.customCommandPlaceholder')}
            />
            <p className="text-xs leading-5 text-zinc-500">
              {t('settings.workspaceOpen.customCommandDescription')}
            </p>
          </div>
        </FieldBlock>

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => onSave(draft)} disabled={busy} className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200">
            <Save className="mr-2 h-4 w-4" />
            {t('settings.workspaceOpen.save')}
          </Button>
        </div>
      </div>
    </MenuPanel>
  )

  const selectMenu = (sectionId: SettingsMenuId) => {
    setActiveMenu(sectionId)
    onSectionChange?.(sectionId)
    if (isMobile) {
      setMobileView('detail')
    }
  }

  return (
    <div className="wemux-page-outer-frame flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[15rem_minmax(0,1fr)]">
          {showMenuList ? (
            <SettingsMenuList
              activeMenu={activeMenu}
              isMobile={isMobile}
              sections={sections}
              onSelect={(sectionId) => {
                selectMenu(sectionId as SettingsMenuId)
              }}
            />
          ) : null}

          {showMenuDetail ? (
            <div className={cn('mobile-bottom-nav-safe min-h-0 min-w-0 xl:h-full', activeMenu === 'workspace' ? 'overflow-hidden' : 'overflow-auto')}>
              <div className={cn('mx-auto flex h-full w-full min-w-0 max-w-[1120px] flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5', activeMenu === 'workspace' ? 'h-full' : 'min-h-full')}>
          {activeMenu === 'profile' ? (
            <MenuPanel
              title={t('settings.profile.title')}
              mobile={isMobile}
              onBack={isMobile ? () => setMobileView('menu') : undefined}
            >
              <div className="flex flex-col items-center gap-3">
                <Avatar className="h-20 w-20 rounded-2xl border border-zinc-800 bg-zinc-950">
                  <AvatarImage src={resolveMediaUrl(user?.avatarUrl)} />
                  <AvatarFallback className="rounded-2xl bg-zinc-900 text-2xl font-semibold text-zinc-100">{(profileDraft.name || user?.email || 'U').slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    void onUploadAvatar(file)
                  }
                  event.target.value = ''
                }} />
                <Button type="button" size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={!avatarStorage.configured || avatarBusy} className="h-7 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
                  {avatarBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Camera className="mr-1 h-3 w-3" />}
                  上传头像
                </Button>
                <p className="text-sm font-medium text-zinc-100">{profileDraft.name || t('settings.profile.unnamedUser')}</p>
                <p className="text-xs text-zinc-500">{user?.email ?? t('settings.profile.accountUnavailable')}</p>
              </div>

              <div className="space-y-2.5">
                <FieldBlock label={t('settings.profile.nickname')}>
                  <Input value={profileDraft.name} onChange={(e) => setProfileDraft((current) => ({ ...current, name: e.target.value }))} placeholder={t('settings.profile.nicknamePlaceholder')} className="h-9" />
                </FieldBlock>
                <FieldBlock label={t('settings.profile.userId')}>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-sm text-zinc-500">@</span>
                    <Input
                      value={profileDraft.username}
                      onChange={(e) => setProfileDraft((current) => ({ ...current, username: e.target.value.trim().toLowerCase() }))}
                      placeholder={t('settings.profile.userIdPlaceholder')}
                      className="h-9 pl-7"
                    />
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-zinc-500">
                    {user?.usernameUpdatedAt
                      ? `${t('settings.profile.userIdHint')} ${t('settings.profile.userIdCooldown')}`
                      : user?.username
                        ? t('settings.profile.userIdAutoAssigned', { username: user.username })
                        : t('settings.profile.userIdHint')}
                  </p>
                </FieldBlock>
                <FieldBlock label={t('settings.profile.loginEmail')}>
                  <Input value={user?.email ?? ''} disabled className="h-9" />
                </FieldBlock>
                <FieldBlock label={t('settings.profile.bio')}>
                  <Textarea rows={3} value={profileDraft.bio} onChange={(e) => setProfileDraft((current) => ({ ...current, bio: e.target.value }))} placeholder={t('settings.profile.bioPlaceholder')} className="min-h-[5rem]" />
                </FieldBlock>
              </div>

              <div className="flex items-center gap-2 rounded-lg border border-zinc-800/90 bg-[#09090b] px-3 py-2 text-xs text-zinc-400">
                <Cloud className="h-3.5 w-3.5 text-emerald-400" />
                <span>{avatarStorage.configured ? t('settings.profile.avatarStorageConnected', { bucket: avatarStorage.bucket }) : t('settings.profile.avatarStorageMissing')}</span>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onSaveProfile({ name: profileDraft.name.trim(), bio: profileDraft.bio.trim() || undefined, username: profileDraft.username.trim() || undefined })} disabled={profileBusy || !profileDraft.name.trim()} className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200">
                  {profileBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {t('settings.profile.saveProfile')}
                </Button>
              </div>
            </MenuPanel>
          ) : null}

          {activeMenu === 'connections' ? (
            <MenuPanel
              title={language === 'zh' ? '好友与连接' : 'Friends & Connections'}
              mobile={isMobile}
              onBack={isMobile ? () => setMobileView('menu') : undefined}
            >
              <ConnectionsPanel language={language} />
            </MenuPanel>
          ) : null}

          {activeMenu === 'security' ? (
            <AccountSecurityPanel
              language={language}
              mobile={isMobile}
              onBack={isMobile ? () => setMobileView('menu') : undefined}
            />
          ) : null}

          {(() => {
            const BillingSection = getSettingsSection('settings.billing')
            return (activeMenu as string) === 'billing' && BillingSection ? (
              <MenuPanel
                title="Bill & Usage"
                mobile={isMobile}
                onBack={isMobile ? () => setMobileView('menu') : undefined}
              >
                {BillingSection({})}
              </MenuPanel>
            ) : null
          })()}

          {activeMenu === 'workspace' ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-none border border-zinc-800/90 bg-zinc-950/80">
              {isMobile ? (
                <div className="shrink-0 border-b border-zinc-800/80 px-5 py-4">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setMobileView('menu')}
                    className="mb-2 h-7 rounded-lg px-0 text-zinc-500 hover:bg-transparent hover:text-zinc-100"
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    {t('settings.menu.back')}
                  </Button>
                  <h2 className="text-sm font-medium text-zinc-50">{t('teamsPage.title')}</h2>
                </div>
              ) : null}
              <WorkspaceAdminPanel
                initialTeams={teams}
                requestedWorkspaceId={requestedWorkspaceId}
                onWorkspaceSelectionChange={onWorkspaceSelectionChange}
              />
            </div>
          ) : null}

          {activeMenu === 'workspaceOpen' ? workspaceOpenPanel : null}

          {activeMenu === 'localNetworkAccess' ? (
            <MenuPanel
              title={language === 'zh' ? '本地网络访问' : 'Local Network Access'}
              mobile={isMobile}
              onBack={isMobile ? () => setMobileView('menu') : undefined}
            >
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-[1.15rem] border border-zinc-800/90 bg-[#09090b] px-4 py-3">
                    <p className="text-xs text-zinc-500">LNA Status</p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <Badge className={cn('border px-2 py-0.5 text-xs', localNetworkAccessStatusClassName)}>
                        {localNetworkAccessStatus}
                      </Badge>
                      <span className="text-xs text-zinc-400">{localNetworkAccessStatusLabel}</span>
                    </div>
                  </div>
                  <div className="rounded-[1.15rem] border border-zinc-800/90 bg-[#09090b] px-4 py-3">
                    <p className="text-xs text-zinc-500">{language === 'zh' ? '本机 Worker 健康检查' : 'Local Worker Health'}</p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <Badge className={cn('border px-2 py-0.5 text-xs', localWorkerHealthProbeClassName)}>
                        {localWorkerHealthProbeLabel}
                      </Badge>
                      {localWorkerHealthProbe?.status ? (
                        <span className="text-xs tabular-nums text-zinc-400">{localWorkerHealthProbe.status}</span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="settings-lna-experiment rounded-[1.35rem] border border-zinc-800/90 bg-[linear-gradient(180deg,rgba(15,15,17,0.98),rgba(10,10,12,0.94))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                  <p className="text-sm font-medium text-zinc-100">{language === 'zh' ? '本地节点连通性实验' : 'Local Node Connectivity Test'}</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    {language === 'zh'
                      ? 'Request Access 会请求本机 Worker 健康状态，用一次真实的本地网络访问触发浏览器权限流程。若状态已经是 denied，需要到浏览器站点设置里手动开启。'
                      : 'Request Access checks the local worker health endpoint with a real local-network request. If the status is denied, enable it manually in browser site settings.'}
                  </p>
                  <div className="mt-4 rounded-lg border border-zinc-900 bg-zinc-950/70 px-3 py-3 text-xs leading-5 text-zinc-400">
                    <p className="font-medium text-zinc-200">{language === 'zh' ? '如何申请权限' : 'How to request access'}</p>
                    <ol className="mt-2 list-decimal space-y-1 pl-4">
                      <li>{language === 'zh' ? '点击 Request Access。' : 'Click Request Access.'}</li>
                      <li>{language === 'zh' ? '浏览器弹出 Local Network Access 权限框时选择允许。' : 'Choose Allow in the browser Local Network Access prompt.'}</li>
                      <li>{language === 'zh' ? '如果已经是 denied，请打开下面的站点设置链接，手动允许 Local Network Access。' : 'If it is already denied, open the site settings link below and allow Local Network Access manually.'}</li>
                      <li>{language === 'zh' ? '回到 Wemux 后刷新整个页面，再点 Refresh Status 或测试本机节点。' : 'Return to Wemux, reload the page, then click Refresh Status or test the local worker.'}</li>
                    </ol>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <a
                        href={localNetworkAccessSettingsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 items-center rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-100 hover:bg-zinc-800"
                      >
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        {language === 'zh' ? '打开站点设置' : 'Open Site Settings'}
                      </a>
                      <code className="min-w-0 flex-1 truncate rounded-md border border-zinc-900 bg-[#09090b] px-2 py-1.5 text-[11px] text-zinc-400">
                        {localNetworkAccessSettingsUrl}
                      </code>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 text-xs text-zinc-400">
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-900 bg-zinc-950/70 px-3 py-2">
                      <span>Endpoint</span>
                      <a
                        href={localWorkerHealthUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 truncate font-mono text-zinc-300 underline decoration-zinc-700 underline-offset-4 hover:text-zinc-100"
                      >
                        {localWorkerHealthUrl}
                      </a>
                    </div>
                    {localWorkerHealthProbe ? (
                      <>
                        <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-900 bg-zinc-950/70 px-3 py-2">
                          <span>{language === 'zh' ? '检查时间' : 'Checked At'}</span>
                          <span className="truncate text-zinc-300">{new Date(localWorkerHealthProbe.checkedAt).toLocaleString()}</span>
                        </div>
                        {localWorkerHealthProbe.executorId ? (
                          <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-900 bg-zinc-950/70 px-3 py-2">
                            <span>Executor</span>
                            <code className="truncate text-zinc-300">{localWorkerHealthProbe.executorId}</code>
                          </div>
                        ) : null}
                        {localWorkerHealthProbe.error ? (
                          <div className="rounded-lg border border-rose-500/20 bg-rose-500/8 px-3 py-2 text-rose-200">
                            {localWorkerHealthProbe.error}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>

                {localNetworkAccessStatus === 'denied' ? (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 p-3 text-xs leading-5 text-amber-100">
                    <p className="font-medium">{language === 'zh' ? '浏览器已经拒绝本地网络访问' : 'Local Network Access is denied'}</p>
                    <p className="mt-1">
                      {language === 'zh'
                        ? '页面无法重新弹出权限框。请打开站点设置，在权限列表里把“本地网络”改为允许；如果你已经改过了，请刷新整个 Wemux 页面让 Chrome 重新加载权限状态。'
                        : 'This page cannot reopen the permission prompt. Open site settings and change Local Network Access to Allow. If you already changed it, reload the Wemux page so Chrome reloads the permission state.'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => window.location.reload()}
                        className="h-7 border-amber-400/30 bg-amber-400/10 px-2 text-[11px] text-amber-50 hover:bg-amber-400/20 hover:text-amber-50"
                      >
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />
                        {language === 'zh' ? '刷新 Wemux 页面' : 'Reload Wemux'}
                      </Button>
                      <a
                        href={localWorkerHealthUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 items-center rounded-md border border-amber-400/30 bg-amber-400/10 px-2 text-[11px] font-medium text-amber-50 hover:bg-amber-400/20"
                      >
                        <ExternalLink className="mr-1 h-3.5 w-3.5" />
                        {language === 'zh' ? '打开本机健康检查' : 'Open Local Health'}
                      </a>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    onClick={onRequestLocalNetworkAccess}
                    disabled={localWorkerHealthChecking || localNetworkAccessStatus === 'denied'}
                    className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                  >
                    {localWorkerHealthChecking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Request Access
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onRefreshLocalNetworkAccessStatus}
                    className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Refresh Status
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onProbeLocalWorkerHealth}
                    disabled={localWorkerHealthChecking}
                    className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                  >
                    {localWorkerHealthChecking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ServerCog className="mr-2 h-4 w-4" />}
                    {language === 'zh' ? '测试本机节点' : 'Test Local Worker'}
                  </Button>
                </div>
              </div>
            </MenuPanel>
          ) : null}

          {activeMenu === 'desktop' ? (
            <MenuPanel
              title={language === 'zh' ? '桌面端' : 'Desktop'}
              mobile={isMobile}
              onBack={isMobile ? () => setMobileView('menu') : undefined}
            >
              <div className="space-y-4">
                <div className="rounded-[1.35rem] border border-zinc-800/90 bg-[linear-gradient(180deg,rgba(15,15,17,0.98),rgba(10,10,12,0.94))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-100">{language === 'zh' ? '开机自启动' : 'Launch at login'}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        {language === 'zh'
                          ? '登录系统后自动在后台启动 Wemux（托盘常驻）。'
                          : 'Start Wemux automatically in the background after login.'}
                      </p>
                    </div>
                    {!isDesktopNativeClient() ? (
                      <span className="shrink-0 text-xs text-zinc-500">{language === 'zh' ? '仅桌面客户端可用' : 'Desktop client only'}</span>
                    ) : autostartEnabled === null ? (
                      <span className="shrink-0 text-xs text-zinc-500">{language === 'zh' ? '加载中…' : 'Loading…'}</span>
                    ) : (
                      <Switch
                        checked={autostartEnabled}
                        disabled={autostartBusy}
                        onCheckedChange={handleAutostartToggle}
                        aria-label={language === 'zh' ? '开机自启动' : 'Launch at login'}
                      />
                    )}
                  </div>
                </div>

                <div className="rounded-[1.35rem] border border-zinc-800/90 bg-[linear-gradient(180deg,rgba(15,15,17,0.98),rgba(10,10,12,0.94))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                  <p className="text-sm font-medium text-zinc-100">{language === 'zh' ? '全局快捷键' : 'Global shortcut'}</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    {language === 'zh'
                      ? '按 ⌘/Ctrl + Shift + W 快速显示或隐藏主窗口（关闭到托盘后也能唤起）。'
                      : 'Press Cmd/Ctrl + Shift + W to show or hide the main window, even after closing to the tray.'}
                  </p>
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 py-1.5 font-mono text-xs text-zinc-300">
                    <span>⌘</span><span className="text-zinc-600">/</span><span>Ctrl</span>
                    <span className="text-zinc-600">+</span>
                    <span>Shift</span>
                    <span className="text-zinc-600">+</span>
                    <span>W</span>
                  </div>
                </div>
              </div>
            </MenuPanel>
          ) : null}

          {activeMenu === 'floatingChat' ? (
            <MenuPanel
              title={language === 'zh' ? '悬浮聊天' : 'Floating Chat'}
              mobile={isMobile}
              onBack={isMobile ? () => setMobileView('menu') : undefined}
            >
              <div className="rounded-[1.35rem] border border-zinc-800/90 bg-[linear-gradient(180deg,rgba(15,15,17,0.98),rgba(10,10,12,0.94))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-100">{language === 'zh' ? '显示悬浮聊天按钮' : 'Show floating chat button'}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      {language === 'zh'
                        ? '在页面右下角显示悬浮入口，可随时展开完整聊天或便签笔记。关闭后入口立即隐藏，可在本页随时重新开启。'
                        : 'Show the floating entry at the bottom-right corner for quick access to the full chat and sticky notes. Turn it off to hide the entry immediately; you can re-enable it here anytime.'}
                    </p>
                  </div>
                  <Switch
                    checked={floatingChatEnabled}
                    onCheckedChange={handleFloatingChatToggle}
                    aria-label={language === 'zh' ? '显示悬浮聊天按钮' : 'Show floating chat button'}
                  />
                </div>
              </div>
            </MenuPanel>
          ) : null}

          {activeMenu === 'git' ? (
            <MenuPanel
              title="Git 身份治理"
              mobile={isMobile}
              onBack={isMobile ? () => setMobileView('menu') : undefined}
            >
              <GitIdentitySettings />
            </MenuPanel>
          ) : null}

          {activeMenu === 'appearance' ? (
            <MenuPanel title={language === 'zh' ? '外观' : 'Appearance'} mobile={isMobile} onBack={isMobile ? () => setMobileView('menu') : undefined}>
              <p className="text-sm text-zinc-400">{language === 'zh' ? '选择应用的颜色主题。设置会同步到你的账户。' : 'Choose the application color theme. Your choice is synced to your account.'}</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {(['dark', 'light', 'system'] as const).map((option) => (
                  <Button key={option} type="button" variant={theme === option ? 'default' : 'outline'} onClick={() => setTheme(option)} className="h-11 justify-start">
                    {option === 'dark' ? (language === 'zh' ? '深色' : 'Dark') : option === 'light' ? (language === 'zh' ? '浅色' : 'Light') : (language === 'zh' ? '跟随系统' : 'System')}
                  </Button>
                ))}
              </div>
              <div className="rounded-[1.15rem] border border-zinc-800/80 bg-zinc-950/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-zinc-100">{language === 'zh' ? '毛玻璃效果' : 'Glass effect'}</h3>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      {language === 'zh' ? '调整桌面端半透明壳层的暗度、模糊和边缘高光，改动会实时预览。' : 'Tune the desktop shell tint, blur, saturation, and edge highlight with a live preview.'}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={resetGlass} className="shrink-0 text-zinc-400 hover:text-zinc-100">
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    {language === 'zh' ? '恢复默认' : 'Reset'}
                  </Button>
                </div>
                <div className="mt-5 grid gap-5 md:grid-cols-2">
                  <GlassRangeSetting
                    id="glass-opacity"
                    label={language === 'zh' ? '黑色浓度' : 'Dark tint'}
                    hint={language === 'zh' ? '越高越接近不透明的黑色。' : 'Higher values make the shell darker and less transparent.'}
                    value={glass.opacity}
                    min={20}
                    max={90}
                    unit="%"
                    onChange={(value) => updateGlass({ opacity: value })}
                  />
                  <GlassRangeSetting
                    id="glass-blur"
                    label={language === 'zh' ? '模糊强度' : 'Blur strength'}
                    hint={language === 'zh' ? '控制背景透过玻璃时的柔化程度。' : 'Controls how softly the background shows through.'}
                    value={glass.blur}
                    min={0}
                    max={64}
                    unit="px"
                    onChange={(value) => updateGlass({ blur: value })}
                  />
                  <GlassRangeSetting
                    id="glass-saturation"
                    label={language === 'zh' ? '色彩饱和度' : 'Color saturation'}
                    hint={language === 'zh' ? '控制背景颜色的鲜明程度。' : 'Controls the color intensity behind the glass.'}
                    value={glass.saturation}
                    min={80}
                    max={160}
                    unit="%"
                    onChange={(value) => updateGlass({ saturation: value })}
                  />
                  <GlassRangeSetting
                    id="glass-border-opacity"
                    label={language === 'zh' ? '边缘高光' : 'Edge highlight'}
                    hint={language === 'zh' ? '控制细边框和顶边高光的亮度。' : 'Controls the brightness of hairline borders and highlights.'}
                    value={glass.borderOpacity}
                    min={0}
                    max={20}
                    unit="%"
                    onChange={(value) => updateGlass({ borderOpacity: value })}
                  />
                </div>
              </div>
            </MenuPanel>
          ) : null}

          {activeMenu === 'notifications' ? (
            <MenuPanel
              title={language === 'zh' ? '通知设置' : 'Notifications'}
              mobile={isMobile}
              onBack={isMobile ? () => setMobileView('menu') : undefined}
            >
              <div className="rounded-[1.15rem] border border-zinc-800/90 bg-[#09090b] px-4 py-3 text-sm text-zinc-300">
                {language === 'zh'
                  ? `浏览器通知权限：${browserNotificationPermission === 'granted' ? '已允许' : browserNotificationPermission === 'denied' ? '已拒绝' : browserNotificationPermission === 'default' ? '未决定' : '当前浏览器不支持'}`
                  : `Browser notification permission: ${browserNotificationPermission === 'granted' ? 'Granted' : browserNotificationPermission === 'denied' ? 'Denied' : browserNotificationPermission === 'default' ? 'Not decided' : 'Unsupported'}`}
              </div>

              <div className="rounded-[1.15rem] border border-zinc-800/90 bg-[#09090b] px-4 py-3 text-sm leading-6 text-zinc-300">
                {language === 'zh'
                  ? '实时通知：仅当前页面未聚焦、或你不在该会话时弹出；同类通知 30 秒内最多 1 条，避免刷屏。' 
                  : 'Realtime notifications pop only when the page is unfocused or you are not viewing that session, rate-limited to 1 per type per 30s.'}
              </div>

              <NotificationCategoryRows
                language={language}
                settings={notificationSettingsDraft}
                onChange={updateNotificationCategory}
              />

              <div className="rounded-[1.35rem] border border-zinc-800/90 bg-[linear-gradient(180deg,rgba(15,15,17,0.98),rgba(10,10,12,0.94))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-zinc-100">{language === 'zh' ? '工作区会话完成' : 'Workspace session completion'}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      {language === 'zh'
                        ? '工作区会话从运行态进入完成、待确认或出错时，向当前浏览器发送系统通知。'
                        : 'Send a browser notification when a workspace session finishes, needs confirmation, or errors.'}
                    </p>
                  </div>
                  <Switch
                    checked={notificationSettingsDraft.workspaceSessionCompletion.browserEnabled}
                    onCheckedChange={(checked) => setNotificationSettingsDraft((current) => ({
                      ...current,
                      workspaceSessionCompletion: {
                        ...current.workspaceSessionCompletion,
                        browserEnabled: checked,
                      },
                    }))}
                  />
                </div>

                <div className="mt-4 flex items-start justify-between gap-4 border-t border-zinc-900 pt-4">
                  <div>
                    <p className="text-sm font-medium text-zinc-100">{language === 'zh' ? '完成提示音' : 'Completion sound'}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      {language === 'zh'
                        ? '浏览器通知触发时额外播放一段短提示音。'
                        : 'Play a short sound when the browser notification fires.'}
                    </p>
                  </div>
                  <Switch
                    checked={notificationSettingsDraft.workspaceSessionCompletion.soundEnabled}
                    onCheckedChange={(checked) => setNotificationSettingsDraft((current) => ({
                      ...current,
                      workspaceSessionCompletion: {
                        ...current.workspaceSessionCompletion,
                        soundEnabled: checked,
                      },
                    }))}
                  />
                </div>

                <div className="mt-4 border-t border-zinc-900 pt-4">
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onTestBrowserNotification}
                      className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {language === 'zh' ? '测试通知权限' : 'Test notification permission'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onTestPushNotification}
                      className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {language === 'zh' ? '测试 Web Push' : 'Test Web Push'}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.35rem] border border-zinc-800/90 bg-[linear-gradient(180deg,rgba(15,15,17,0.98),rgba(10,10,12,0.94))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-zinc-100">{language === 'zh' ? '飞书完成通知' : 'Feishu completion notification'}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      {language === 'zh'
                        ? '当工作区会话结束时，由服务端按你的个人 webhook 主动推送一条消息。'
                        : 'Send a server-side Feishu webhook message when a workspace session reaches a terminal state.'}
                    </p>
                  </div>
                  <Switch
                    checked={notificationSettingsDraft.workspaceSessionCompletion.feishuEnabled}
                    onCheckedChange={(checked) => setNotificationSettingsDraft((current) => ({
                      ...current,
                      workspaceSessionCompletion: {
                        ...current.workspaceSessionCompletion,
                        feishuEnabled: checked,
                      },
                    }))}
                  />
                </div>

                <FieldBlock
                  label="Feishu Webhook URL"
                  hint={language === 'zh' ? '这是用户级配置，只给你自己的工作区完成提醒使用。' : 'This is user-scoped and only used for your own workspace completion alerts.'}
                >
                  <Input
                    value={notificationSettingsDraft.channels.feishuWebhookUrl}
                    onChange={(e) => setNotificationSettingsDraft((current) => ({
                      ...current,
                      channels: {
                        ...current.channels,
                        feishuWebhookUrl: e.target.value,
                      },
                    }))}
                    placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </FieldBlock>

                <div className="mt-4 border-t border-zinc-900 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onTestFeishuNotification(notificationSettingsDraft)}
                    className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                  >
                    <Send className="mr-2 h-4 w-4" />
                    {language === 'zh' ? '测试飞书通知' : 'Test Feishu notification'}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onRequestBrowserNotificationPermission}
                  className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                >
                  <Send className="mr-2 h-4 w-4" />
                  {language === 'zh' ? '请求浏览器权限' : 'Request browser permission'}
                </Button>
                <Button
                  type="button"
                  onClick={() => onSaveNotificationSettings(notificationSettingsDraft)}
                  className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                >
                  <Save className="mr-2 h-4 w-4" />
                  {language === 'zh' ? '保存通知设置' : 'Save notification settings'}
                </Button>
              </div>
            </MenuPanel>
          ) : null}

          {activeMenu === 'experimental' ? (
            <MenuPanel
              title={language === 'zh' ? '实验性功能' : 'Experimental Features'}
              mobile={isMobile}
              onBack={isMobile ? () => setMobileView('menu') : undefined}
            >
              <div className="rounded-[1.15rem] border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm leading-6 text-amber-200/90">
                {language === 'zh'
                  ? '实验性功能可能不稳定，仅供测试评估；开启后新会话生效，正在运行的会话不受影响。'
                  : 'Experimental features may be unstable and are for evaluation only. Changes apply to new sessions; running sessions are unaffected.'}
              </div>

              {EXPERIMENTAL_FLAG_META.map((meta) => {
                const checked = experimentalSettingsDraft[meta.key]
                return (
                  <div key={meta.key} className="rounded-[1.35rem] border border-zinc-800/90 bg-[linear-gradient(180deg,rgba(15,15,17,0.98),rgba(10,10,12,0.94))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-zinc-100">{t(`settings.experimental.flags.${meta.i18nKey}.title`)}</p>
                          <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-200">
                            {language === 'zh' ? '实验性' : 'Experimental'}
                          </Badge>
                          {!meta.wired ? (
                            <Badge className="border-zinc-800 bg-zinc-950 text-zinc-400">
                              {language === 'zh' ? '能力建设中' : 'In development'}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{t(`settings.experimental.flags.${meta.i18nKey}.desc`)}</p>
                        {meta.risk === 'high' ? (
                          <p className="mt-1 text-[11px] leading-4 text-amber-400/70">{t('settings.experimental.riskHigh')}</p>
                        ) : null}
                      </div>
                      <Switch
                        checked={checked}
                        onCheckedChange={(next) => setExperimentalSettingsDraft((current) => ({
                          ...current,
                          [meta.key]: next,
                        }))}
                      />
                    </div>
                  </div>
                )
              })}

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const allOff = Object.fromEntries(EXPERIMENTAL_FLAG_META.map((meta) => [meta.key, false])) as unknown as typeof experimentalSettingsDraft
                    setExperimentalSettingsDraft(allOff)
                    onSaveExperimentalSettings(allOff)
                  }}
                  className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {language === 'zh' ? '关闭全部实验功能' : 'Disable all experimental features'}
                </Button>
                <Button
                  type="button"
                  onClick={() => onSaveExperimentalSettings(experimentalSettingsDraft)}
                  className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                >
                  <Save className="mr-2 h-4 w-4" />
                  {language === 'zh' ? '保存实验设置' : 'Save experimental settings'}
                </Button>
              </div>
            </MenuPanel>
          ) : null}

          {activeMenu === 'apiTokens' ? (
            <MenuPanel
              title={language === 'zh' ? 'API 令牌' : 'API Tokens'}
              mobile={isMobile}
              onBack={isMobile ? () => setMobileView('menu') : undefined}
            >
              <ApiTokensPanel />
            </MenuPanel>
          ) : null}

              </div>
          </div>
        ) : null}
      </div>
      </div>
    </div>
  )
}
