import { getWorkspaceOpenTargetLabel, listWorkspaceOpenTargets, type WorkspaceOpenTarget } from '@shared/workspace-open-command'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { cn } from '../../lib/utils'
import { WorkspaceOpenTargetIcon } from './workspace-open-target-icon'

type WorkspaceOpenActionProps = {
  busy?: boolean
  disabled?: boolean
  activeTarget: WorkspaceOpenTarget
  onOpen: (target: WorkspaceOpenTarget) => void
  buttonClassName?: string
  menuClassName?: string
}

const renderTargetIcon = (target: WorkspaceOpenTarget) => {
  return <WorkspaceOpenTargetIcon target={target} size={14} />
}

export function WorkspaceOpenAction({
  busy = false,
  disabled = false,
  activeTarget,
  onOpen,
  buttonClassName,
  menuClassName,
}: WorkspaceOpenActionProps) {
  const mainTitle = busy
    ? `正在打开 ${getWorkspaceOpenTargetLabel(activeTarget)}，请稍候`
    : `用 ${getWorkspaceOpenTargetLabel(activeTarget)} 打开`

  return (
    <div className={cn('hidden items-center sm:inline-flex', buttonClassName)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => onOpen(activeTarget)}
        disabled={disabled || busy}
        className={cn(menuClassName, 'rounded-r-none border-r-0')}
        aria-label={mainTitle}
        aria-busy={busy}
        title={mainTitle}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : renderTargetIcon(activeTarget)}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled || busy}
            className={cn(menuClassName, 'rounded-l-none px-1.5')}
            aria-label="选择打开方式"
            title="选择打开方式"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {listWorkspaceOpenTargets().map((target) => (
            <DropdownMenuItem key={target.value} onSelect={() => onOpen(target.value)}>
              <span className="flex w-full items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2">
                  {renderTargetIcon(target.value)}
                  <span>{target.label}</span>
                </span>
                {target.value === activeTarget ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <span className="h-3.5 w-3.5" />}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
