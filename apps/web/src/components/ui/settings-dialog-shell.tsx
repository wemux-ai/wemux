import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './dialog'
import { Drawer, DrawerContent } from './drawer'
import { useCompactSettingsDialogLayout } from './use-compact-settings-dialog-layout'

export type SettingsDialogShellSection<T extends string = string> = {
  id: T
  label: string
  description: string
}

interface SettingsDialogShellProps<T extends string = string> {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  closeLabel: string
  sections: Array<SettingsDialogShellSection<T>>
  activeSection: T
  onActiveSectionChange: (section: T) => void
  children: ReactNode
  eyebrow?: string
  menuLabel?: string
  showSectionDescriptions?: boolean
  footer?: ReactNode
  className?: string
  contentClassName?: string
}

export function SettingsDialogShell<T extends string = string>({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  sections,
  activeSection,
  onActiveSectionChange,
  children,
  eyebrow,
  menuLabel = 'Sections',
  showSectionDescriptions = true,
  footer,
  className,
  contentClassName,
}: SettingsDialogShellProps<T>) {
  const usesCompactLayout = useCompactSettingsDialogLayout()

  const shellContent = (
    <>
      <DialogHeader className="shrink-0 text-left">
        <div className="border-b border-zinc-800/80 px-4 py-4 lg:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {eyebrow ? (
                <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500">{eyebrow}</p>
              ) : null}
              <DialogTitle className={cn('text-xl leading-tight text-zinc-50', eyebrow ? 'mt-2' : '')}>
                {title}
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm leading-6 text-zinc-400">
                {description}
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              aria-label={closeLabel}
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4.5 w-4.5" />
            </Button>
          </div>
        </div>
      </DialogHeader>

      <div className="shrink-0 border-b border-zinc-800/80 px-4 lg:hidden">
        <div className="flex gap-5 overflow-x-auto">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => onActiveSectionChange(section.id)}
              className={cn(
                'shrink-0 border-b-2 px-0 py-3 text-sm font-medium transition-colors',
                activeSection === section.id
                  ? 'border-zinc-100 text-zinc-50'
                  : 'border-transparent text-zinc-500 hover:text-zinc-200',
              )}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden border-r border-zinc-800/80 bg-zinc-950/40 lg:block">
          <div className="px-4 py-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">{menuLabel}</p>
            <div className="mt-4 border-t border-zinc-900">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onActiveSectionChange(section.id)}
                  className={cn(
                    'relative w-full border-b border-zinc-900 px-0 py-4 text-left transition-colors',
                    activeSection === section.id
                      ? 'text-zinc-50'
                      : 'text-zinc-500 hover:text-zinc-200',
                  )}
                >
                  {activeSection === section.id ? (
                    <span className="absolute bottom-0 left-[-16px] top-0 w-px bg-zinc-100" aria-hidden="true" />
                  ) : null}
                  <p className="text-sm font-medium">{section.label}</p>
                  {showSectionDescriptions ? (
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{section.description}</p>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y [@supports(-webkit-touch-callout:none)]:[-webkit-overflow-scrolling:touch]', contentClassName)}>
          {children}
        </div>
      </div>

      {footer ? (
        <div className="shrink-0 border-t border-zinc-800/80 bg-[#09090b] px-4 py-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] lg:px-6 lg:pb-3">
          {footer}
        </div>
      ) : null}
    </>
  )

  if (usesCompactLayout) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
        <DrawerContent
          className={cn(
            'border-zinc-800 bg-[#09090b] p-0 text-zinc-100 shadow-2xl shadow-black/40',
            'data-[vaul-drawer-direction=bottom]:inset-0 data-[vaul-drawer-direction=bottom]:h-[100dvh] data-[vaul-drawer-direction=bottom]:max-h-[100dvh] data-[vaul-drawer-direction=bottom]:rounded-none data-[vaul-drawer-direction=bottom]:border-0',
            className,
          )}
        >
          {shellContent}
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          '!flex !flex-col left-0 top-0 h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden border-0 border-zinc-800 bg-[#09090b] p-0 text-zinc-100 lg:left-1/2 lg:top-1/2 lg:h-[min(88vh,56rem)] lg:max-h-[min(88vh,56rem)] lg:w-[min(100vw-3rem,64rem)] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:border',
          className,
        )}
      >
        {shellContent}
      </DialogContent>
    </Dialog>
  )
}
