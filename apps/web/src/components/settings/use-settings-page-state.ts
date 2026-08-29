import { useEffect, useRef, useState } from 'react'
import type { UserNotificationSettings } from '@shared/user-notification-settings'
import type { UserExperimentalSettings } from '@shared/user-experimental-settings'
import { useTranslation } from '../../lib/i18n/react'
import { useSidebar } from '../ui/sidebar'
import type { SettingsMenuId, SettingsPageProps } from './settings-page-shared'

export const useSettingsPageState = ({
  user,
  config,
  notificationSettings,
  experimentalSettings,
  teams,
  requestedSection,
}: Pick<SettingsPageProps, 'user' | 'config' | 'notificationSettings' | 'experimentalSettings' | 'teams' | 'requestedSection'>) => {
  const { t, language } = useTranslation()
  const { isMobile } = useSidebar()
  const [draft, setDraft] = useState(config)
  const [notificationSettingsDraft, setNotificationSettingsDraft] = useState<UserNotificationSettings>(notificationSettings)
  const [experimentalSettingsDraft, setExperimentalSettingsDraft] = useState<UserExperimentalSettings>(experimentalSettings)
  const [profileDraft, setProfileDraft] = useState({ name: user?.name ?? '', bio: user?.bio ?? '', username: user?.username ?? '' })
  const [activeMenu, setActiveMenu] = useState<SettingsMenuId>(requestedSection ?? 'profile')
  const [mobileView, setMobileView] = useState<'menu' | 'detail'>('menu')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setDraft(config)
  }, [config])

  useEffect(() => {
    setNotificationSettingsDraft(notificationSettings)
  }, [notificationSettings])

  useEffect(() => {
    setExperimentalSettingsDraft(experimentalSettings)
  }, [experimentalSettings])

  useEffect(() => {
    setProfileDraft({ name: user?.name ?? '', bio: user?.bio ?? '', username: user?.username ?? '' })
  }, [user])

  useEffect(() => {
    setMobileView('menu')
  }, [isMobile])

  const sections = [
    { id: 'profile' as const, label: t('settings.menu.items.profile'), group: t('settings.menu.groups.account') },
    { id: 'connections' as const, label: language === 'zh' ? '好友与连接' : 'Friends & Connections', group: t('settings.menu.groups.account') },
    { id: 'security' as const, label: language === 'zh' ? '账号安全' : 'Account security', group: t('settings.menu.groups.account') },
    { id: 'git' as const, label: t('settings.menu.items.gitIdentity'), group: t('settings.menu.groups.account') },
    { id: 'workspace' as const, label: t('settings.menu.items.workspaceAdmin'), group: t('settings.menu.groups.workspace') },
    { id: 'workspaceOpen' as const, label: t('settings.workspaceOpen.title'), group: t('settings.menu.groups.workspace') },

    { id: 'localNetworkAccess' as const, label: language === 'zh' ? '本地网络访问' : 'Local Network Access', group: t('settings.menu.groups.workspace') },
    { id: 'desktop' as const, label: language === 'zh' ? '桌面端' : 'Desktop', group: t('settings.menu.groups.workspace') },
    { id: 'floatingChat' as const, label: language === 'zh' ? '悬浮聊天' : 'Floating Chat', group: t('settings.menu.groups.workspace') },
    { id: 'notifications' as const, label: language === 'zh' ? '通知' : 'Notifications', group: t('settings.menu.groups.notifications') },
    { id: 'appearance' as const, label: language === 'zh' ? '外观' : 'Appearance', group: t('settings.menu.groups.account') },
    { id: 'experimental' as const, label: t('settings.menu.items.experimental'), group: t('settings.menu.groups.experimental') },
    { id: 'apiTokens' as const, label: language === 'zh' ? 'API 令牌' : 'API Tokens', group: t('settings.menu.groups.account') },
  ]

  const showMenuList = !isMobile || mobileView === 'menu'
  const showMenuDetail = !isMobile || mobileView === 'detail'

  return {
    activeMenu,
    draft,
    fileInputRef,
    experimentalSettingsDraft,
    isMobile,
    mobileView,
    notificationSettingsDraft,
    profileDraft,
    sections,
    setActiveMenu,
    setDraft,
    setExperimentalSettingsDraft,
    setMobileView,
    setNotificationSettingsDraft,
    setProfileDraft,
    showMenuDetail,
    showMenuList,
  }
}
