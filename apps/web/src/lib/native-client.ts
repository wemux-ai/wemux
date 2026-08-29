// Native 客户端适配层：Electron 桌面端 / React Native 移动端检测 + 深链 + 自动更新桥
//
// [INPUT]: Electron preload bridge 或 React Native WebView bridge 派发的原生事件
// [OUTPUT]: 导航到对应 web 路由 + 更新事件分发（available / downloading / installed / error）
// [POS]: web 的最小跨壳适配面：渲染层不接触 Node.js 或原生模块
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

type NativeShellBridge = {
  platform: string
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
  onDeepLink: (listener: (urls: string[]) => void) => (() => void)
  onUpdate: (listener: (event: NativeUpdateEvent) => void) => (() => void)
}

type NativeShellWindow = Window & {
  __WEMUX_DESKTOP__?: NativeShellBridge
  __WEMUX_MOBILE__?: NativeShellBridge
}

const getElectronDesktopBridge = () => {
  if (typeof window === 'undefined') return undefined
  return (window as NativeShellWindow).__WEMUX_DESKTOP__
}

const getReactNativeMobileBridge = () => {
  if (typeof window === 'undefined') return undefined
  return (window as NativeShellWindow).__WEMUX_MOBILE__
}

const getNativeShellBridge = () => getElectronDesktopBridge() ?? getReactNativeMobileBridge()

export const isElectronDesktopClient = () => Boolean(getElectronDesktopBridge())
export const isReactNativeMobileClient = () => Boolean(getReactNativeMobileBridge())

export const isNativeClient = () => {
  if (typeof window === 'undefined') return false
  return Boolean(getNativeShellBridge())
}

export const isDesktopNativeClient = isElectronDesktopClient

export const isMacNativeClient = () => {
  if (!isDesktopNativeClient()) return false
  const nativePlatform = getNativeShellBridge()?.platform
  if (nativePlatform) return nativePlatform === 'darwin'
  return false
}

if (typeof document !== 'undefined' && isNativeClient()) {
  if (isMacNativeClient()) document.documentElement.classList.add('wemux-native-window')
  if (isElectronDesktopClient()) document.documentElement.classList.add('wemux-electron-window')
}

/**
 * 原生系统通知桥：WKWebView / Android WebView 不支持浏览器 Notification API，
 * 经原生桥的 show_notification 命令弹系统通知（桌面=通知中心，移动=Android 通知）。
 * 返回是否已交给原生壳。
 */
export const showNativeNotification = async (title: string, body: string): Promise<boolean> => {
  if (!isNativeClient() || typeof window === 'undefined') {
    return false
  }
  const invoke = getNativeShellBridge()?.invoke
  if (!invoke) {
    return false
  }
  try {
    await invoke('show_notification', { title, body })
    return true
  } catch {
    return false
  }
}

const invokeNative = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> => {
  if (!isNativeClient() || typeof window === 'undefined') {
    return null
  }
  const invoke = getNativeShellBridge()?.invoke
  if (!invoke) {
    return null
  }
  try {
    return (await invoke(cmd, args)) as T
  } catch {
    return null
  }
}

/** Invoke a command exposed by the active Electron or React Native shell. */
export const invokeNativeShell = <T>(cmd: string, args?: Record<string, unknown>) =>
  invokeNative<T>(cmd, args)

/** 查询桌面端开机自启动状态（非桌面端返回 null） */
export const getAutostartEnabled = () => isDesktopNativeClient()
  ? invokeNative<boolean>('autostart_is_enabled')
  : Promise.resolve(null)

/** 设置桌面端开机自启动；返回设置后的状态（非桌面端返回 null） */
export const setAutostartEnabled = (enabled: boolean) => isDesktopNativeClient()
  ? invokeNative<boolean>('autostart_set_enabled', { enabled })
  : Promise.resolve(null)

/**
 * 解析深链 URL 为 web 路由路径。
 * 支持格式：
 *   Wemux://chat                      → /chat
 *   Wemux:///meeting-records          → /meeting-records
 *   Wemux://workspace?workspaceId=x   → /workspace?workspaceId=x
 */
export const resolveDeepLinkRoute = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl)
    const path = url.host === 'chat' || url.host === 'workspace' || url.host === 'workspaces'
      ? `/${url.host}`
      : url.pathname || '/'
    const query = url.search || ''
    return `${path}${query}`
  } catch {
    return rawUrl.startsWith('/') ? rawUrl : '/chat'
  }
}

/**
 * 注册 native 深链监听，并导航到对应 web 路由。
 * 返回取消函数。
 */
export const setupNativeDeepLinkListener = (navigate: (route: string) => void): (() => void) => {
  if (!isNativeClient() || typeof window === 'undefined') {
    return () => {}
  }

  const nativeBridge = getNativeShellBridge()
  if (!nativeBridge) return () => {}
  return nativeBridge.onDeepLink((urls) => {
    const rawUrl = urls[0]
    if (!rawUrl) return
    navigate(resolveDeepLinkRoute(rawUrl))
  })
}

// ---------- 桌面端自动更新桥 ----------

/** 桌面端自动更新事件，type 区分阶段。 */
export type NativeUpdateEvent =
  | { type: 'available'; currentVersion?: string; version?: string; notes?: string }
  | { type: 'none' }
  | { type: 'downloading'; received?: number; total?: number }
  | { type: 'installed' }
  | { type: 'error'; message?: string }

/** 待安装新版本信息（check_for_update / pending_update 返回） */
export interface NativePendingUpdate {
  currentVersion: string
  version: string
  notes?: string
}

/**
 * 注册 Electron 自动更新监听并把载荷转发给 onEvent 回调。
 */
export const setupNativeUpdateListener = (
  onEvent: (event: NativeUpdateEvent) => void,
): (() => void) => {
  if (!isDesktopNativeClient() || typeof window === 'undefined') {
    return () => {}
  }

  const nativeBridge = getNativeShellBridge()
  return nativeBridge ? nativeBridge.onUpdate(onEvent) : () => {}
}

/** 手动触发桌面端更新检查；返回新版本信息（无更新/非桌面端返回 null） */
export const checkForUpdateNative = () => isDesktopNativeClient()
  ? invokeNative<NativePendingUpdate | null>('check_for_update')
  : Promise.resolve(null)

/** 查询最近一次检查结果（web 刷新后恢复更新提示） */
export const getPendingNativeUpdate = () => isDesktopNativeClient()
  ? invokeNative<NativePendingUpdate | null>('pending_update')
  : Promise.resolve(null)

/**
 * 下载并安装桌面端更新（进度经 wemux-update 事件流回传）。
 * 与 invokeNative 不同：错误向上抛出（调用方需要区分「成功」与「失败」）。
 */
export const installUpdateNative = async (): Promise<void> => {
  if (!isDesktopNativeClient() || typeof window === 'undefined') {
    throw new Error('not in native client')
  }
  const invoke = getNativeShellBridge()?.invoke
  if (!invoke) {
    throw new Error('native invoke unavailable')
  }
  await invoke('install_update')
}

/** 重启桌面应用（安装完成后调用；进程会立即重启，无需 await 结果） */
export const restartNativeApp = (): void => {
  if (!isDesktopNativeClient() || typeof window === 'undefined') {
    return
  }
  const invoke = getNativeShellBridge()?.invoke
  if (!invoke) {
    return
  }
  void invoke('restart_app')
}
