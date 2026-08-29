// [INPUT]: 当前登录用户的实验性设置。
// [OUTPUT]: UserExperimentalSettings 状态。
// [POS]: Web 侧实验性开关读取 hook（flag 门控用）。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useCallback, useEffect, useState } from 'react'
import { defaultUserExperimentalSettings, type UserExperimentalSettings } from '@shared/user-experimental-settings'
import { api } from './api'

/** 实验性设置保存成功后的全局变更事件（供各消费方自动刷新）。 */
export const EXPERIMENTAL_SETTINGS_CHANGED_EVENT = 'vibemux:experimental-settings-changed'

export const notifyExperimentalSettingsChanged = (): void => {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new CustomEvent(EXPERIMENTAL_SETTINGS_CHANGED_EVENT))
}

export const useExperimentalSettings = (): UserExperimentalSettings => {
  const [settings, setSettings] = useState<UserExperimentalSettings>(defaultUserExperimentalSettings())

  const refresh = useCallback(() => {
    void api.getMyExperimentalSettings()
      .then((response) => setSettings(response.settings))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, refresh)
    return () => {
      window.removeEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, refresh)
    }
  }, [refresh])

  return settings
}
