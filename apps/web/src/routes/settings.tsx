// [INPUT]: 设置请求
// [OUTPUT]: 设置页
// [POS]: 设置页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { defaultUserNotificationSettings, type UserNotificationSettings } from '@shared/user-notification-settings'
import { defaultUserExperimentalSettings, type UserExperimentalSettings } from '@shared/user-experimental-settings'
import { notifyExperimentalSettingsChanged } from '../lib/use-experimental-settings'
import { SettingsPage } from '../components/settings/settings-page'
import { api, type Team } from '../lib/api'
import { useApp } from '../lib/app-provider'
import { useAuth } from '../lib/auth-context'
import {
  probeLocalWorkerHealth,
  requestLocalNetworkAccessWithWorkerProbe,
  resolveLocalNetworkAccessStatus,
  type LocalNetworkAccessStatus,
  type LocalWorkerHealthProbeResult,
} from '../lib/browser-local-network-access'
import { requestBrowserNotificationPermission, resolveBrowserNotificationPermission, type BrowserNotificationPermission } from '../lib/browser-notification-permission'
import { testPushSubscription } from '../lib/notifications/push-subscription'
import { useTranslation } from '../lib/i18n/react'
import { parseSettingsRouteSearch } from './-settings-route-search'

export const Route = createFileRoute('/settings')({
  validateSearch: parseSettingsRouteSearch,
  component: SettingsRoute,
})

function SettingsRoute() {
  const { language, t } = useTranslation()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { state, settingsDraft, setSettingsDraft, busy, runMutation } = useApp()
  const { user, updateUser } = useAuth()
  const [notificationSettingsDraft, setNotificationSettingsDraft] = useState<UserNotificationSettings>(defaultUserNotificationSettings())
  const [experimentalSettingsDraft, setExperimentalSettingsDraft] = useState<UserExperimentalSettings>(defaultUserExperimentalSettings())
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState<BrowserNotificationPermission>('unsupported')
  const [localNetworkAccessStatus, setLocalNetworkAccessStatus] = useState<LocalNetworkAccessStatus>('unknown')
  const [localWorkerHealthProbe, setLocalWorkerHealthProbe] = useState<LocalWorkerHealthProbeResult | null>(null)
  const [localWorkerHealthChecking, setLocalWorkerHealthChecking] = useState(false)
  const [avatarStorage, setAvatarStorage] = useState({ configured: false, driver: 's3-compatible', bucket: '', maxFileSizeMb: 5, acceptedTypes: [] as string[] })
  const [profileBusy, setProfileBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [teams, setTeams] = useState<Team[]>([])

  const refreshLocalNetworkAccessStatus = () => {
    void resolveLocalNetworkAccessStatus().then(setLocalNetworkAccessStatus)
  }

  const probeLocalWorker = () => {
    setLocalWorkerHealthChecking(true)
    void probeLocalWorkerHealth()
      .then((result) => {
        setLocalWorkerHealthProbe(result)
        if (result.ok) {
          toast.success(language === 'zh' ? '本机 Worker 健康检查有响应。' : 'Local worker health check responded.')
          return
        }

        toast.error(result.error || (language === 'zh' ? '本机 Worker 健康检查失败。' : 'Local worker health check failed.'))
      })
      .finally(() => setLocalWorkerHealthChecking(false))
  }

  useEffect(() => {
    if (search.section !== 'runtime') {
      return
    }

    void navigate({
      to: '/settings',
      search: (current) => ({
        ...current,
        section: 'workspaceOpen',
      }),
      replace: true,
    })
  }, [navigate, search.section])

  return (
    <SettingsPage
      user={user}
      config={settingsDraft}
      notificationSettings={notificationSettingsDraft}
      experimentalSettings={experimentalSettingsDraft}
      browserNotificationPermission={browserNotificationPermission}
      localNetworkAccessStatus={localNetworkAccessStatus}
      localWorkerHealthProbe={localWorkerHealthProbe}
      localWorkerHealthChecking={localWorkerHealthChecking}
      avatarStorage={avatarStorage}
      busy={busy}
      profileBusy={profileBusy}
      avatarBusy={avatarBusy}
      teams={teams}
      requestedSection={search.section}
      requestedWorkspaceId={search.workspaceId}
      onSectionChange={(section) => {
        void navigate({
          to: '/settings',
          search: (current) => ({
            ...current,
            checkout: undefined,
                section: section === 'profile' ? undefined : section,
            workspaceId: section === 'workspace' ? current.workspaceId : undefined,
          }),
          replace: true,
        })
      }}
      onWorkspaceSelectionChange={(workspaceId) => {
        void navigate({
          to: '/settings',
          search: (current) => ({
            ...current,
            checkout: undefined,
                section: 'workspace',
            workspaceId: workspaceId?.trim() || undefined,
          }),
          replace: true,
        })
      }}
      onSaveProfile={(payload) => {
        setProfileBusy(true)
        void api.updateMe(payload)
          .then((response) => {
            updateUser(response.user)
            toast.success(t('settings.profileUpdated'))
          })
          .catch((error) => {
            toast.error(error instanceof Error ? error.message : t('settings.saveProfileFailed'))
          })
          .finally(() => setProfileBusy(false))
      }}
      onUploadAvatar={(file) => {
        setAvatarBusy(true)
        return api.uploadMyAvatar(file)
          .then((response) => {
            updateUser(response.user)
            toast.success(response.message || t('settings.avatarUpdated'))
          })
          .catch((error) => {
            toast.error(error instanceof Error ? error.message : t('settings.avatarUploadFailed'))
            throw error
          })
          .finally(() => setAvatarBusy(false))
      }}
      onSave={(config) => {
        setSettingsDraft(config)
        void runMutation(() => api.saveSettings(config))
      }}
      onSaveNotificationSettings={(settings) => {
        void api.saveMyNotificationSettings(settings)
          .then((response) => {
            setNotificationSettingsDraft(response.settings)
            toast.success(language === 'zh' ? '通知设置已保存。' : 'Notification settings saved.')
          })
          .catch((error) => {
            toast.error(error instanceof Error ? error.message : (language === 'zh' ? '保存通知设置失败。' : 'Failed to save notification settings.'))
          })
      }}
      onSaveExperimentalSettings={(settings) => {
        void api.saveMyExperimentalSettings(settings)
          .then((response) => {
            setExperimentalSettingsDraft(response.settings)
            notifyExperimentalSettingsChanged()
            toast.success(language === 'zh' ? '实验性功能设置已保存。' : 'Experimental settings saved.')
          })
          .catch((error) => {
            toast.error(error instanceof Error ? error.message : (language === 'zh' ? '保存实验性功能设置失败。' : 'Failed to save experimental settings.'))
          })
      }}
      onRequestBrowserNotificationPermission={() => {
        if (resolveBrowserNotificationPermission() === 'unsupported') {
          setBrowserNotificationPermission('unsupported')
          toast.error(language === 'zh' ? '当前浏览器不支持系统通知。' : 'This browser does not support notifications.')
          return
        }

        void requestBrowserNotificationPermission().then((permission) => {
          setBrowserNotificationPermission(permission)
          if (permission === 'granted') {
            toast.success(language === 'zh' ? '浏览器通知权限已开启。' : 'Browser notification permission granted.')
            return
          }

          if (permission === 'denied') {
            toast.error(language === 'zh' ? '浏览器通知权限被拒绝，请到浏览器设置里开启。' : 'Browser notification permission was denied. Enable it in browser settings.')
          }
        })
      }}
      onTestBrowserNotification={() => {
        const permission = resolveBrowserNotificationPermission()
        setBrowserNotificationPermission(permission)
        if (permission === 'unsupported') {
          toast.error(language === 'zh' ? '当前浏览器不支持系统通知。' : 'This browser does not support notifications.')
          return
        }

        if (permission !== 'granted') {
          toast.error(language === 'zh' ? '请先请求并允许浏览器通知权限。' : 'Please request and grant browser notification permission first.')
          return
        }

        try {
          new Notification(language === 'zh' ? 'Wemux 测试通知' : 'Wemux Test Notification', {
            body: language === 'zh' ? '浏览器通知权限工作正常。' : 'Browser notifications are working.',
            tag: 'wemux-browser-notification-test',
          })
          toast.success(language === 'zh' ? '测试通知已弹出。' : 'Test notification sent.')
        } catch {
          toast.error(language === 'zh' ? '测试通知发送失败。' : 'Failed to send test notification.')
        }
      }}
      onTestFeishuNotification={(settings) => {
        if (!settings.channels.feishuWebhookUrl.trim()) {
          toast.error(language === 'zh' ? '请先填写飞书 Webhook URL。' : 'Please enter a Feishu webhook URL first.')
          return
        }

        void api.testMyFeishuNotification(settings)
          .then((response) => {
            if (!response.ok) {
              toast.error(response.message || (language === 'zh' ? '测试飞书通知失败。' : 'Test Feishu notification failed.'))
              return
            }

            toast.success(response.message || (language === 'zh' ? '测试飞书通知已发送。' : 'Test Feishu notification sent.'))
          })
          .catch((error) => {
            toast.error(error instanceof Error ? error.message : (language === 'zh' ? '测试飞书通知失败。' : 'Test Feishu notification failed.'))
          })
      }}
      onTestPushNotification={() => {
        void testPushSubscription().then((result) => {
          if (result.ok) {
            toast.success(result.message || (language === 'zh' ? 'Web Push 测试推送已发送。' : 'Web Push test sent.'))
            return
          }
          toast.error(result.message || (language === 'zh' ? 'Web Push 测试失败。' : 'Web Push test failed.'))
        })
      }}
      onRequestLocalNetworkAccess={() => {
        if (localNetworkAccessStatus === 'denied') {
          toast.error(language === 'zh'
            ? '本地网络访问已被浏览器拒绝，请到浏览器站点设置里手动开启。'
            : 'Local Network Access is denied. Enable it manually in the browser site settings.')
          return
        }

        setLocalWorkerHealthChecking(true)
        void requestLocalNetworkAccessWithWorkerProbe()
          .then((result) => {
            setLocalNetworkAccessStatus(result.status)
            if (result.probe) {
              setLocalWorkerHealthProbe(result.probe)
              if (result.probe.ok) {
                toast.success(language === 'zh' ? '本机 Worker 可达，本地网络访问链路已打通。' : 'Local worker is reachable.')
                return
              }
              toast.error(result.probe.error || (language === 'zh' ? '本机 Worker 探测失败。' : 'Local worker probe failed.'))
            }
          })
          .finally(() => setLocalWorkerHealthChecking(false))
      }}
      onRefreshLocalNetworkAccessStatus={refreshLocalNetworkAccessStatus}
      onProbeLocalWorkerHealth={probeLocalWorker}
      onReset={() => runMutation(() => api.reset())}
    />
  )
}
