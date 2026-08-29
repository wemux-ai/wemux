import { getProjectColor } from '@shared/project-color'
import type { Project } from '@shared/types'
import { cn } from '../lib/utils'

type ProjectIdentityProps = {
  project: Pick<Project, 'name' | 'color'>
  className?: string
  dotClassName?: string
  nameClassName?: string
}

export function ProjectIdentity({
  project,
  className,
  dotClassName,
  nameClassName,
}: ProjectIdentityProps) {
  const color = getProjectColor(project)

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <span
        aria-hidden
        className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', dotClassName)}
        style={{ backgroundColor: color }}
      />
      <span className={cn('truncate', nameClassName)}>{project.name}</span>
    </span>
  )
}
