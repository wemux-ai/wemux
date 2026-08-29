import 'virtual:commercial-extension'
import './lib/polyfills'
import './lib/i18n'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { Download, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { AppDialogProvider } from './components/ui/app-dialog-provider'
import { getDefaultDocumentTitle } from './lib/document-title'
import { AppProvider } from './lib/app-provider'
import { AuthProvider } from './lib/auth-context'
import { queryClient } from './lib/query-client'
import { getRouter } from './router'
import { registerServiceWorker } from './lib/register-service-worker'
import {
  getPendingNativeUpdate,
  installUpdateNative,
  isDesktopNativeClient,
  restartNativeApp,
  setupNativeDeepLinkListener,
  setupNativeUpdateListener,
  type NativeUpdateEvent,
} from './lib/native-client'
import i18n from './lib/i18n'
import './index.css'

const router = getRouter()
const APP_UPDATE_TOAST_ID = 'app-update-available'
const NATIVE_UPDATE_TOAST_ID = 'native-update-available'

if (import.meta.env.DEV) {
  void import('react-grep')
}

document.title = getDefaultDocumentTitle()

function AppUpdateToast({
  toastId,
  activateUpdate,
}: {
  toastId: string | number
  activateUpdate: () => void
}) {
  return (
    <div className="pointer-events-auto w-[min(400px,calc(100vw-32px))] overflow-hidden rounded-lg border border-zinc-800/90 bg-[#09090b]/95 text-zinc-100 shadow-[0_18px_50px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur">
      <div className="flex items-start gap-3 px-3 py-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-sky-500/20 bg-sky-500/10 text-sky-300">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold leading-5 text-zinc-100">
              {i18n.t('app.updateAvailable')}
            </p>
            <button
              type="button"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
              aria-label={i18n.t('app.updateLater')}
              onClick={() => toast.dismiss(toastId)}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            {i18n.t('app.updateAvailableDescription')}
          </p>
          <div className="mt-2.5 flex items-center justify-end gap-1.5">
            <button
              type="button"
              className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
              onClick={() => toast.dismiss(toastId)}
            >
              {i18n.t('app.updateLater')}
            </button>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
              onClick={() => {
                toast.dismiss(toastId)
                activateUpdate()
              }}
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              {i18n.t('app.refresh')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

registerServiceWorker({
  onUpdateAvailable: ({ activateUpdate }) => {
    toast.custom((toastId) => <AppUpdateToast toastId={toastId} activateUpdate={activateUpdate} />, {
      id: APP_UPDATE_TOAST_ID,
      position: 'bottom-right',
      duration: Number.POSITIVE_INFINITY,
      unstyled: true,
    })
  },
})

// ---------- 桌面端自动更新（Electron updater 闭环） ----------

type NativeUpdateUiState =
  | { phase: 'idle' }
  | { phase: 'available'; version?: string }
  | { phase: 'downloading'; received?: number; total?: number }
  | { phase: 'installed' }
  | { phase: 'error'; message?: string }

let nativeUpdateState: NativeUpdateUiState = { phase: 'idle' }

function NativeUpdateToast({
  state,
  onUpdateNow,
  onRestartNow,
}: {
  state: NativeUpdateUiState
  onUpdateNow: () => void
  onRestartNow: () => void
}) {
  const progress =
    state.phase === 'downloading' && state.total
      ? Math.min(100, Math.round(((state.received ?? 0) / state.total) * 100))
      : undefined

  let title = i18n.t('app.nativeUpdateAvailable')
  let description = i18n.t('app.nativeUpdateAvailableDescription')
  let action: React.ReactNode = null
  if (state.phase === 'available') {
    title = state.version
      ? `${i18n.t('app.nativeUpdateAvailable')} v${state.version}`
      : i18n.t('app.nativeUpdateAvailable')
    action = (
      <button
        type="button"
        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
        onClick={onUpdateNow}
      >
        <Download className="h-3 w-3" aria-hidden="true" />
        {i18n.t('app.nativeUpdateNow')}
      </button>
    )
  } else if (state.phase === 'downloading') {
    title = i18n.t('app.nativeUpdating')
    description =
      progress !== undefined
        ? `${progress}%`
        : i18n.t('app.nativeUpdatingDescription')
  } else if (state.phase === 'installed') {
    title = i18n.t('app.nativeUpdateInstalled')
    description = i18n.t('app.nativeUpdateInstalledDescription')
    action = (
      <button
        type="button"
        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
        onClick={onRestartNow}
      >
        <RefreshCw className="h-3 w-3" aria-hidden="true" />
        {i18n.t('app.nativeRestart')}
      </button>
    )
  } else if (state.phase === 'error') {
    title = i18n.t('app.nativeUpdateFailed')
    description = state.message || i18n.t('app.nativeUpdateFailedDescription')
    action = (
      <button
        type="button"
        className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
        onClick={onUpdateNow}
      >
        {i18n.t('app.retry')}
      </button>
    )
  }

  return (
    <div className="pointer-events-auto w-[min(400px,calc(100vw-32px))] overflow-hidden rounded-lg border border-zinc-800/90 bg-[#09090b]/95 text-zinc-100 shadow-[0_18px_50px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur">
      <div className="flex items-start gap-3 px-3 py-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-sky-500/20 bg-sky-500/10 text-sky-300">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold leading-5 text-zinc-100">{title}</p>
            <button
              type="button"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
              aria-label={i18n.t('app.updateLater')}
              onClick={() => toast.dismiss(NATIVE_UPDATE_TOAST_ID)}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-400">{description}</p>
          {progress !== undefined ? (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-sky-400 transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : null}
          {action ? (
            <div className="mt-2.5 flex items-center justify-end gap-1.5">{action}</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const renderNativeUpdateToast = (state: NativeUpdateUiState) => {
  nativeUpdateState = state
  toast.custom(
    (toastId) => (
      <NativeUpdateToast
        state={state}
        onUpdateNow={() => {
          toast.dismiss(toastId)
          void installUpdateNative().catch(() => {
            // 下载/安装失败由 Rust 经 wemux-update error 事件派发，这里不重复提示
          })
        }}
        onRestartNow={() => {
          toast.dismiss(toastId)
          restartNativeApp()
        }}
      />
    ),
    {
      id: NATIVE_UPDATE_TOAST_ID,
      position: 'bottom-right',
      duration: Number.POSITIVE_INFINITY,
      unstyled: true,
    },
  )
}

const handleNativeUpdateEvent = (event: NativeUpdateEvent) => {
  switch (event.type) {
    case 'available':
      renderNativeUpdateToast({ phase: 'available', version: event.version })
      break
    case 'downloading':
      renderNativeUpdateToast({ phase: 'downloading', received: event.received, total: event.total })
      break
    case 'installed':
      renderNativeUpdateToast({ phase: 'installed' })
      break
    case 'error':
      renderNativeUpdateToast({ phase: 'error', message: event.message })
      break
    case 'none':
      // 无可用更新：不打扰
      break
  }
}

// 桌面端自动更新：启动后 Rust 静默检查 + 用户手动检查 + 下载/安装进度 → 提示条
setupNativeUpdateListener(handleNativeUpdateEvent)

// web 刷新后恢复：如已有待装新版本（Rust UpdateState），重新弹提示
if (isDesktopNativeClient()) {
  void getPendingNativeUpdate().then((pending) => {
    if (pending) {
      renderNativeUpdateToast({ phase: 'available', version: pending.version })
    }
  })
}

// native 深链：Electron / React Native 壳收到 Wemux:// 深链后导航到对应路由。
setupNativeDeepLinkListener((route) => {
  router.history.push(route)
})

const rootElement = document.getElementById('root')!
const app = (
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppProvider>
          <AppDialogProvider>
            <RouterProvider router={router} />
          </AppDialogProvider>
        </AppProvider>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
)

if (rootElement.hasChildNodes()) {
  ReactDOM.hydrateRoot(rootElement, app)
} else {
  ReactDOM.createRoot(rootElement).render(app)
}
