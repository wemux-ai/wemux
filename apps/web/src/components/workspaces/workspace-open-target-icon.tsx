import { useEffect, useState } from 'react'
import { type WorkspaceOpenTarget } from '@shared/workspace-open-command'
import { Code2, FolderOpen, TerminalSquare } from 'lucide-react'
import { BrandIcon } from '../runtime/runtime-icons'
import { cn } from '../../lib/utils'

type WorkspaceOpenTargetIconProps = {
  target: WorkspaceOpenTarget
  size?: number
  className?: string
  iconClassName?: string
}

const SIMPLE_ICONS_CDN_BASE = 'https://cdn.simpleicons.org'

const simpleIconSlugByTarget: Partial<Record<WorkspaceOpenTarget, string>> = {
  cursor: 'cursor',
  windsurf: 'windsurf',
  zed: 'zedindustries',
  intellij: 'intellijidea',
  xcode: 'xcode',
  ghostty: 'ghostty',
  iterm: 'iterm2',
  warp: 'warp',
}

const renderFallbackIcon = (
  target: WorkspaceOpenTarget,
  size: number,
  className?: string,
) => {
  const iconClassName = cn('shrink-0 text-zinc-400', className)
  const style = { height: size, width: size }

  if (target === 'finder') {
    return <FolderOpen className={iconClassName} style={style} />
  }

  if (target === 'ghostty' || target === 'terminal' || target === 'iterm' || target === 'warp') {
    return <TerminalSquare className={iconClassName} style={style} />
  }

  return <Code2 className={iconClassName} style={style} />
}

const buildSimpleIconUrl = (slug: string) => `${SIMPLE_ICONS_CDN_BASE}/${slug}?viewbox=auto`

export function WorkspaceOpenTargetIcon({
  target,
  size = 16,
  className,
  iconClassName,
}: WorkspaceOpenTargetIconProps) {
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    setLoadFailed(false)
  }, [target])

  if (target === 'vscode') {
    return (
      <BrandIcon
        id="vscode"
        size={size}
        className={className}
        iconClassName={iconClassName}
      />
    )
  }

  if (target === 'vscode-insiders') {
    return (
      <span className={cn('relative inline-flex shrink-0', className)}>
        <BrandIcon id="vscode" size={size} iconClassName={iconClassName} />
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-[#09090b] bg-indigo-400 shadow-[0_0_0_1px_rgba(129,140,248,0.35)]" />
      </span>
    )
  }

  const simpleIconSlug = simpleIconSlugByTarget[target]
  if (!simpleIconSlug || loadFailed) {
    return renderFallbackIcon(target, size, cn(className, iconClassName))
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-white p-[2px] ring-1 ring-inset ring-white/10',
        className,
      )}
      style={{ height: size, width: size }}
    >
      <img
        alt=""
        aria-hidden="true"
        src={buildSimpleIconUrl(simpleIconSlug)}
        className={cn('h-full w-full object-contain', iconClassName)}
        onError={() => setLoadFailed(true)}
      />
    </span>
  )
}
