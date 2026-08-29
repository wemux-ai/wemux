import { useEffect, useState } from 'react'
import type { ExecutorRecord } from '@shared/types'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import { ExecutorTerminalPanel } from '../terminal/executor-terminal-panel'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

const tr = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

export function ExecutionExecutorTerminalDialog({
  executor,
  open,
  onOpenChange,
}: {
  executor: ExecutorRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { language } = useTranslation()
  const [terminalCollapsed, setTerminalCollapsed] = useState(false)
  const [terminalMaximized, setTerminalMaximized] = useState(false)

  useEffect(() => {
    if (!open) {
      setTerminalCollapsed(false)
      setTerminalMaximized(false)
    }
  }, [open])

  useEffect(() => {
    setTerminalCollapsed(false)
    setTerminalMaximized(false)
  }, [executor?.executorId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[92vh] max-w-[min(96vw,78rem)] flex-col gap-0 overflow-hidden rounded-[1.25rem] border-zinc-800 bg-[#050506] p-0 text-zinc-100 shadow-[0_24px_72px_rgba(0,0,0,0.52)]',
          terminalCollapsed ? 'h-auto' : terminalMaximized ? 'h-[88vh]' : 'h-[min(78vh,48rem)]',
        )}
      >
        {executor ? (
          <>
            <DialogHeader className="shrink-0 gap-0.5 bg-[#09090b] pr-12">
              <DialogTitle className="text-base">{tr(language, `节点终端 · ${executor.name}`, `Executor Terminal · ${executor.name}`)}</DialogTitle>
              <DialogDescription className="truncate font-mono text-[11px] text-zinc-500" title={executor.workspaceRoot}>
                {executor.workspaceRoot}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ExecutorTerminalPanel
                collapsed={terminalCollapsed}
                cwd={executor.workspaceRoot}
                executorId={executor.executorId}
                executorName={executor.name}
                maximized={terminalMaximized}
                panelKey={`execution:${executor.executorId}`}
                onCollapsedChange={setTerminalCollapsed}
                onMaximizedChange={setTerminalMaximized}
              />
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
