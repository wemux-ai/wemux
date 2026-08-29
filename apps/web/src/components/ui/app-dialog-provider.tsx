import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from './drawer'
import { Input } from './input'

type ConfirmDialogTone = 'default' | 'danger'

interface ConfirmDialogOptions {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  tone?: ConfirmDialogTone
  mobileLayout?: 'dialog' | 'bottom-sheet'
}

interface ValueDialogOptions {
  title: string
  description?: string
  value: string
  label?: string
  closeText?: string
  copyText?: string
  copySuccessText?: string
  copyErrorText?: string
}

interface AppDialogContextValue {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>
  openValueDialog: (options: ValueDialogOptions) => Promise<void>
}

type DialogRequest =
  | {
    kind: 'confirm'
    options: ConfirmDialogOptions
    resolve: (value: boolean) => void
  }
  | {
    kind: 'value'
    options: ValueDialogOptions
    resolve: () => void
  }

const AppDialogContext = createContext<AppDialogContextValue | null>(null)

const COMPACT_DIALOG_MEDIA_QUERY = '(max-width: 639px)'

const dialogContentClassName = 'w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] rounded-xl border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:w-full sm:max-w-md'
const bottomSheetDrawerContentClassName = 'border-zinc-800 bg-[#09090b] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-zinc-100 shadow-2xl shadow-black/40 data-[vaul-drawer-direction=bottom]:rounded-t-lg'
const valueDialogContentClassName = 'w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] rounded-xl border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-xl'
const dialogSecondaryButtonClassName = 'h-8 w-full border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 sm:w-auto'
const dialogPrimaryButtonClassName = 'h-8 w-full px-3 text-xs sm:w-auto'
const dialogDangerButtonClassName = 'h-8 w-full bg-rose-600 px-3 text-xs text-white hover:bg-rose-500 sm:w-auto'

function getUsesCompactDialogLayout() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.matchMedia(COMPACT_DIALOG_MEDIA_QUERY).matches
}

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const existingContext = useContext(AppDialogContext)

  if (existingContext) {
    return <>{children}</>
  }

  return <AppDialogProviderInner>{children}</AppDialogProviderInner>
}

function AppDialogProviderInner({ children }: { children: ReactNode }) {
  const queueRef = useRef<DialogRequest[]>([])
  const activeRequestRef = useRef<DialogRequest | null>(null)
  const [activeRequest, setActiveRequest] = useState<DialogRequest | null>(null)
  const [usesCompactDialogLayout, setUsesCompactDialogLayout] = useState(getUsesCompactDialogLayout)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const mediaQuery = window.matchMedia(COMPACT_DIALOG_MEDIA_QUERY)
    const handleChange = (event: MediaQueryListEvent) => {
      setUsesCompactDialogLayout(event.matches)
    }

    setUsesCompactDialogLayout(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleChange)

    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  const showNextRequest = useCallback(() => {
    const nextRequest = queueRef.current.shift() ?? null
    activeRequestRef.current = nextRequest
    setActiveRequest(nextRequest)
  }, [])

  const enqueueRequest = useCallback((request: DialogRequest) => {
    queueRef.current.push(request)
    if (!activeRequestRef.current) {
      showNextRequest()
    }
  }, [showNextRequest])

  const closeActiveDialog = useCallback((confirmed = false) => {
    const currentRequest = activeRequestRef.current
    if (!currentRequest) {
      return
    }

    activeRequestRef.current = null
    if (currentRequest.kind === 'confirm') {
      currentRequest.resolve(confirmed)
    } else {
      currentRequest.resolve()
    }

    showNextRequest()
  }, [showNextRequest])

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    return new Promise<boolean>((resolve) => {
      enqueueRequest({
        kind: 'confirm',
        options,
        resolve,
      })
    })
  }, [enqueueRequest])

  const openValueDialog = useCallback((options: ValueDialogOptions) => {
    return new Promise<void>((resolve) => {
      enqueueRequest({
        kind: 'value',
        options,
        resolve,
      })
    })
  }, [enqueueRequest])

  const handleCopyValue = useCallback(async () => {
    if (activeRequestRef.current?.kind !== 'value') {
      return
    }

    const {
      value,
      copySuccessText = '已复制到剪贴板。',
      copyErrorText = '自动复制失败，请手动复制。',
    } = activeRequestRef.current.options

    try {
      await navigator.clipboard.writeText(value)
      toast.success(copySuccessText)
    } catch {
      toast.error(copyErrorText)
    }
  }, [])

  const value = useMemo<AppDialogContextValue>(() => ({
    confirm,
    openValueDialog,
  }), [confirm, openValueDialog])

  const confirmDialogBody = activeRequest?.kind === 'confirm' ? (
    <>
      <DialogHeader className="gap-2 text-left">
        <DialogTitle className="text-base font-semibold text-zinc-50">{activeRequest.options.title}</DialogTitle>
        {activeRequest.options.description ? (
          <DialogDescription className="text-sm leading-6 text-zinc-400">
            {activeRequest.options.description}
          </DialogDescription>
        ) : null}
      </DialogHeader>
      <DialogFooter className="gap-2 sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => closeActiveDialog(false)}
          className={dialogSecondaryButtonClassName}
        >
          {activeRequest.options.cancelText || '取消'}
        </Button>
        <Button
          type="button"
          variant={activeRequest.options.tone === 'danger' ? 'destructive' : 'default'}
          onClick={() => closeActiveDialog(true)}
          className={activeRequest.options.tone === 'danger'
            ? dialogDangerButtonClassName
            : dialogPrimaryButtonClassName}
        >
          {activeRequest.options.confirmText || '确认'}
        </Button>
      </DialogFooter>
    </>
  ) : null

  const confirmBottomSheetBody = activeRequest?.kind === 'confirm' ? (
    <>
      <DrawerHeader className="gap-2 px-0 text-left">
        <DrawerTitle className="text-base font-semibold text-zinc-50">{activeRequest.options.title}</DrawerTitle>
        {activeRequest.options.description ? (
          <DrawerDescription className="text-sm leading-6 text-zinc-400">
            {activeRequest.options.description}
          </DrawerDescription>
        ) : null}
      </DrawerHeader>
      <DrawerFooter className="gap-2 px-0 pt-2 sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => closeActiveDialog(false)}
          className={dialogSecondaryButtonClassName}
        >
          {activeRequest.options.cancelText || '取消'}
        </Button>
        <Button
          type="button"
          variant={activeRequest.options.tone === 'danger' ? 'destructive' : 'default'}
          onClick={() => closeActiveDialog(true)}
          className={activeRequest.options.tone === 'danger'
            ? dialogDangerButtonClassName
            : dialogPrimaryButtonClassName}
        >
          {activeRequest.options.confirmText || '确认'}
        </Button>
      </DrawerFooter>
    </>
  ) : null

  const confirmUsesBottomSheet = activeRequest?.kind === 'confirm'
    && activeRequest.options.mobileLayout === 'bottom-sheet'
    && usesCompactDialogLayout

  return (
    <AppDialogContext.Provider value={value}>
      {children}
      <Dialog
        open={Boolean(activeRequest) && !confirmUsesBottomSheet}
        onOpenChange={(open) => {
          if (!open) {
            closeActiveDialog(false)
          }
        }}
      >
        {activeRequest?.kind === 'confirm' ? (
          <DialogContent
            className={dialogContentClassName}
            showCloseButton={false}
          >
            {confirmDialogBody}
          </DialogContent>
        ) : null}

        {activeRequest?.kind === 'value' ? (
          <DialogContent className={valueDialogContentClassName} showCloseButton={false}>
            <DialogHeader className="gap-2 text-left">
              <DialogTitle className="text-base font-semibold text-zinc-50">{activeRequest.options.title}</DialogTitle>
              {activeRequest.options.description ? (
                <DialogDescription className="text-sm leading-6 text-zinc-400">
                  {activeRequest.options.description}
                </DialogDescription>
              ) : null}
            </DialogHeader>
            <div className="space-y-2 px-5 py-4">
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-zinc-500">
                {activeRequest.options.label || '内容'}
              </p>
              <Input
                readOnly
                value={activeRequest.options.value}
                onFocus={(event) => event.currentTarget.select()}
                className="border-zinc-800 bg-zinc-950 text-zinc-100"
              />
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleCopyValue()}
                className={dialogSecondaryButtonClassName}
              >
                <Copy data-icon="inline-start" />
                {activeRequest.options.copyText || '复制内容'}
              </Button>
              <Button type="button" onClick={() => closeActiveDialog(false)} className={dialogPrimaryButtonClassName}>
                {activeRequest.options.closeText || '关闭'}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
      <Drawer
        open={confirmUsesBottomSheet}
        onOpenChange={(open) => {
          if (!open) {
            closeActiveDialog(false)
          }
        }}
      >
        {confirmUsesBottomSheet ? (
          <DrawerContent className={bottomSheetDrawerContentClassName}>
            {confirmBottomSheetBody}
          </DrawerContent>
        ) : null}
      </Drawer>
    </AppDialogContext.Provider>
  )
}

export function useAppDialog() {
  const context = useContext(AppDialogContext)

  if (!context) {
    throw new Error('useAppDialog must be used within AppDialogProvider')
  }

  return context
}
