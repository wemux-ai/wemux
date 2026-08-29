/**
 * [INPUT]: 悬浮聊天开关的读写请求。
 * [OUTPUT]: localStorage 持久化的启用状态 + 同标签页订阅通知。
 * [POS]: 悬浮聊天 FAB 显示与否的本地偏好（默认开启）；与 FAB 位置一样按浏览器本地保存，
 *       不进入服务端设置。设置页与 FAB 同标签页联动靠订阅，不靠 storage 事件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

export const FLOATING_CHAT_ENABLED_STORAGE_KEY = 'vibemux.floating-chat.enabled'

type EnabledListener = (enabled: boolean) => void

const listeners = new Set<EnabledListener>()

export const isFloatingChatEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return true
  }

  try {
    const raw = window.localStorage.getItem(FLOATING_CHAT_ENABLED_STORAGE_KEY)
    if (raw === null) {
      return true
    }
    return raw !== '0' && raw !== 'false'
  } catch {
    // 存储不可用时保持默认开启，避免用户看不到入口。
    return true
  }
}

export const setFloatingChatEnabled = (enabled: boolean): void => {
  if (typeof window !== 'undefined') {
    try {
      if (enabled) {
        window.localStorage.removeItem(FLOATING_CHAT_ENABLED_STORAGE_KEY)
      } else {
        window.localStorage.setItem(FLOATING_CHAT_ENABLED_STORAGE_KEY, '0')
      }
    } catch {
      // 存储失败仅影响持久化，本次会话内仍按新状态生效。
    }
  }

  listeners.forEach((listener) => listener(enabled))
}

export const subscribeFloatingChatEnabled = (listener: EnabledListener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
