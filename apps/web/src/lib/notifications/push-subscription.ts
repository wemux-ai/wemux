/**
 * [INPUT]: Service Worker registration + VAPID public key + 浏览器通知权限。
 * [OUTPUT]: PushSubscription 的创建/复用/退订 + 服务端 upsert/删除（多设备）。
 * [POS]: Web Push 前端接入层（feature P3）。DEV 不订阅（对齐 register-service-worker）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { api } from '../api'
import { isNativeClient } from '../native-client'

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

const isSecureContext = () => {
  return typeof window !== 'undefined' && (window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
}

const resolvePushSupported = () => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false
  }
  if (isNativeClient()) {
    return false
  }
  // DEV 模式 SW 未注册（register-service-worker 会 unregister），不订阅。
  if (import.meta.env.DEV) {
    return false
  }
  return true
}

export const isPushSupported = () => resolvePushSupported()

/** 读取服务端 VAPID 公钥（用于 PushManager.subscribe）。 */
const resolveVapidPublicKey = async (): Promise<string | null> => {
  try {
    const response = await api.getMyPushVapidKey()
    return response.publicKey || null
  } catch {
    return null
  }
}

/**
 * 保证当前设备有一条有效订阅：
 * - 已订阅（PushManager.getSubscription）→ 服务端 upsert 后返回；
 * - 未订阅且权限 granted → 新建订阅并 upsert。
 * 返回 null 表示无法订阅（不支持/权限未授予/非安全上下文）。
 */
export const ensurePushSubscription = async (): Promise<PushSubscription | null> => {
  if (!resolvePushSupported() || !isSecureContext()) {
    return null
  }
  if (Notification.permission !== 'granted') {
    return null
  }

  const publicKey = await resolveVapidPublicKey()
  if (!publicKey) {
    return null
  }

  const registration = await navigator.serviceWorker.ready
  const pushManager = registration.pushManager
  let subscription = await pushManager.getSubscription()
  if (!subscription) {
    try {
      subscription = await pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
    } catch {
      return null
    }
  }

  const rawSubscription = subscription as unknown as {
    endpoint: string
    getKey: (name: 'p256dh' | 'auth') => ArrayBuffer | null
  }
  const p256dh = rawSubscription.getKey('p256dh')
  const auth = rawSubscription.getKey('auth')
  if (!p256dh || !auth) {
    return null
  }

  const encodeBase64Url = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  try {
    await api.saveMyPushSubscription({
      endpoint: rawSubscription.endpoint,
      p256dh: encodeBase64Url(p256dh),
      auth: encodeBase64Url(auth),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    })
  } catch {
    return null
  }

  return subscription
}

/** 退订并删除服务端记录。 */
export const removePushSubscription = async (): Promise<boolean> => {
  if (!resolvePushSupported()) {
    return false
  }
  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) {
      const endpoint = subscription.endpoint
      await subscription.unsubscribe()
      await api.deleteMyPushSubscriptionByEndpoint({ endpoint }).catch(() => undefined)
    }
    return true
  } catch {
    return false
  }
}

/** 测试推送（设置页按钮）。 */
export const testPushSubscription = async (): Promise<{ ok: boolean; message: string }> => {
  if (!resolvePushSupported() || !isSecureContext()) {
    return { ok: false, message: '当前环境不支持 Web Push（需要 HTTPS 且已注册 Service Worker）。' }
  }
  if (Notification.permission !== 'granted') {
    return { ok: false, message: '请先授予浏览器通知权限。' }
  }
  const subscription = await ensurePushSubscription()
  if (!subscription) {
    return { ok: false, message: '订阅创建失败，请检查浏览器设置。' }
  }
  try {
    const response = await api.testMyPushSubscription()
    return { ok: true, message: response.message || '测试推送已发送。' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '测试推送失败。' }
  }
}
