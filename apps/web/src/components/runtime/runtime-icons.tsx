import { getRuntimeDescriptor, isAgentType, isRuntimeId, type AgentType, type RuntimeId } from '@shared/agent-type'
import { agentMeta, cn } from '../../lib/utils'

type BrandIconId = 'claude' | 'openai' | 'opencode' | 'pi' | 'vscode'

type BrandIconProps = {
  id: BrandIconId
  size?: number | string
  className?: string
  iconClassName?: string
  fullBleed?: boolean
}

type RuntimeLabelProps = {
  runtime: AgentType | RuntimeId
  size?: number | string
  className?: string
  iconClassName?: string
  labelClassName?: string
  showLabel?: boolean
}

type RuntimeIconProps = Omit<RuntimeLabelProps, 'labelClassName' | 'showLabel'> & {
  fullBleed?: boolean
}

const brandIconSrc: Record<BrandIconId, string> = {
  claude: '/brand-icons/claude.svg',
  openai: '/brand-icons/openai.svg',
  opencode: '/brand-icons/opencode.svg',
  pi: '/brand-icons/pi.svg',
  vscode: '/brand-icons/vscode.svg',
}

const brandIconTone: Record<BrandIconId, string> = {
  claude: 'bg-[#f7dacc] p-[2px]',
  openai: 'bg-white p-[2px]',
  opencode: 'bg-transparent p-0 ring-0',
  pi: 'bg-zinc-950 p-[2px]',
  vscode: 'bg-white p-[2px]',
}

const brandIconFullBleedTone: Record<BrandIconId, string> = {
  claude: 'bg-[#f7dacc] p-0 ring-0',
  openai: 'bg-white p-0 ring-0',
  opencode: 'bg-transparent p-0 ring-0',
  pi: 'bg-zinc-950 p-0 ring-0',
  vscode: 'bg-white p-0 ring-0',
}

const brandIconByRuntime: Record<AgentType | RuntimeId, BrandIconId> = {
  ClaudeCode: 'claude',
  Codex: 'openai',
  OpenCode: 'opencode',
  Pi: 'pi',
}

const getRuntimeLabelText = (runtime: AgentType | RuntimeId) => {
  if (isAgentType(runtime)) {
    return agentMeta[runtime].label
  }

  if (isRuntimeId(runtime)) {
    return getRuntimeDescriptor(runtime).label
  }

  return runtime
}

export function BrandIcon({
  id,
  size = 16,
  className,
  iconClassName,
  fullBleed = false,
}: BrandIconProps) {
  return (
    <span
      className={cn(
        fullBleed
          ? 'flex h-full w-full shrink-0 items-center justify-center overflow-hidden'
          : 'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[4px] ring-1 ring-inset ring-white/10',
        fullBleed ? brandIconFullBleedTone[id] : brandIconTone[id],
        className,
      )}
      style={{ height: size, width: size }}
    >
      <img
        alt=""
        aria-hidden="true"
        src={brandIconSrc[id]}
        className={cn(fullBleed ? 'h-full w-full object-contain' : 'h-full w-full object-contain', iconClassName)}
      />
    </span>
  )
}

export function RuntimeIcon({
  runtime,
  size = 16,
  className,
  iconClassName,
  fullBleed = false,
}: RuntimeIconProps) {
  return (
    <BrandIcon
      id={brandIconByRuntime[runtime]}
      size={size}
      className={className}
      iconClassName={iconClassName}
      fullBleed={fullBleed}
    />
  )
}

export function RuntimeLabel({
  runtime,
  size = 16,
  className,
  iconClassName,
  labelClassName,
  showLabel = true,
}: RuntimeLabelProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <RuntimeIcon runtime={runtime} size={size} iconClassName={iconClassName} />
      {showLabel ? <span className={cn('truncate', labelClassName)}>{getRuntimeLabelText(runtime)}</span> : null}
    </span>
  )
}

export function VSCodeLabel({
  size = 16,
  className,
  iconClassName,
  labelClassName,
  showLabel = true,
}: Omit<RuntimeLabelProps, 'runtime'>) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <BrandIcon id="vscode" size={size} iconClassName={iconClassName} />
      {showLabel ? <span className={cn('truncate', labelClassName)}>VS Code</span> : null}
    </span>
  )
}
