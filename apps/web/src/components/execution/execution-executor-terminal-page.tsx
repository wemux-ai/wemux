import { ArrowLeft, Loader2, TerminalSquare } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ExecutorRecord } from '@shared/types'
import { setMobileBottomNavHidden, setMobileSiteHeaderHidden } from '../../lib/mobile-bottom-nav'
import { useTranslation } from '../../lib/i18n/react'
import { ExecutorTerminalPanel } from '../terminal/executor-terminal-panel'
import { Button } from '../ui/button'

const tr = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

export function ExecutionExecutorTerminalPage({
  executor,
  loading,
  onBack,
}: {
  executor: ExecutorRecord | null
  loading: boolean
  onBack: () => void
}) {
  const { language } = useTranslation()
  const [terminalCollapsed, setTerminalCollapsed] = useState(false)
  const [terminalMaximized, setTerminalMaximized] = useState(false)

  useEffect(() => {
    setMobileBottomNavHidden(true)
    setMobileSiteHeaderHidden(true)

    return () => {
      setMobileBottomNavHidden(false)
      setMobileSiteHeaderHidden(false)
    }
  }, [])

  useEffect(() => {
    setTerminalCollapsed(false)
    setTerminalMaximized(false)
  }, [executor?.executorId])

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#050506]">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 bg-[#09090b] px-3 py-2.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-8 shrink-0 rounded-lg border border-zinc-800 bg-zinc-950 px-2 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
        >
          <ArrowLeft className="h-4 w-4" />
          {tr(language, '返回', 'Back')}
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-100">
            {executor
              ? tr(language, `节点终端 · ${executor.name}`, `Executor Terminal · ${executor.name}`)
              : tr(language, '节点终端', 'Executor Terminal')}
          </p>
          {executor?.workspaceRoot ? (
            <p className="truncate font-mono text-[11px] text-zinc-500">{executor.workspaceRoot}</p>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading && !executor ? (
          <div className="flex flex-1 items-center justify-center px-6 text-sm text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {tr(language, '正在加载节点终端...', 'Loading executor terminal...')}
          </div>
        ) : executor ? (
          <ExecutorTerminalPanel
            collapsed={terminalCollapsed}
            cwd={executor.workspaceRoot}
            executorId={executor.executorId}
            executorName={executor.name}
            isMobile
            maximized={terminalMaximized}
            panelKey={`execution-mobile:${executor.executorId}`}
            onCollapsedChange={setTerminalCollapsed}
            onMaximizedChange={setTerminalMaximized}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="rounded-full border border-zinc-800 bg-zinc-900/70 p-3 text-zinc-500">
              <TerminalSquare className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-200">{tr(language, '节点不存在或已不可访问', 'Executor not found or no longer accessible')}</p>
              <p className="mt-1 text-xs text-zinc-500">{tr(language, '返回节点列表后重新选择一个在线节点。', 'Go back to the executor list and select an online executor again.')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
