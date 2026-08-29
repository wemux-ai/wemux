import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import type { Project } from '@shared/types'
import { useTranslation } from '../lib/i18n/react'
import { cn } from '../lib/utils'

type ProjectCloneStatusBadgeProps = {
  project: Pick<Project, 'repositoryCloneStatus' | 'repositoryCloneMessage' | 'updatedAt'>
  className?: string
  compact?: boolean
}

const formatElapsed = (startedAt: string | undefined, now: number) => {
  if (!startedAt?.trim()) {
    return ''
  }

  const timestamp = Date.parse(startedAt)
  if (Number.isNaN(timestamp)) {
    return ''
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  if (minutes < 60) {
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}:${String(remainingMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function ProjectCloneStatusBadge({
  project,
  className,
  compact = false,
}: ProjectCloneStatusBadgeProps) {
  const { t } = useTranslation()
  const cloning = project.repositoryCloneStatus === 'cloning'
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!cloning) {
      return
    }

    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [cloning])

  const elapsedLabel = useMemo(() => (
    cloning ? formatElapsed(project.updatedAt, now) : ''
  ), [cloning, now, project.updatedAt])

  if (cloning) {
    const message = project.repositoryCloneMessage?.trim() || t('projectsPage.cloneStatus.cloningDescription')
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center text-amber-300/90',
          compact ? 'gap-1 text-[10px]' : 'gap-1.5 text-xs',
          className,
        )}
        title={elapsedLabel
          ? t('projectsPage.cloneStatus.cloningDescriptionWithElapsed', { message, elapsed: elapsedLabel })
          : message}
      >
        <span className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        </span>
        {elapsedLabel ? (
          <span className="font-medium tabular-nums text-amber-300/90">
            {t('projectsPage.cloneStatus.cloningWithElapsed', { elapsed: elapsedLabel })}
          </span>
        ) : (
          <span className="font-medium text-amber-300/90">
            {t('projectsPage.cloneStatus.cloning')}
          </span>
        )}
      </span>
    )
  }

  if (project.repositoryCloneStatus === 'failed') {
    const message = project.repositoryCloneMessage?.trim() || t('projectsPage.cloneStatus.failed')
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center text-rose-300/90',
          compact ? 'gap-1 text-[10px]' : 'gap-1.5 text-xs',
          className,
        )}
        title={project.repositoryCloneMessage?.trim()
          ? t('projectsPage.cloneStatus.failedDescription', { message: project.repositoryCloneMessage })
          : message}
      >
        <span className="relative isolate flex h-2.5 w-2.5 items-center justify-center">
          <span className="absolute inset-[-2px] rounded-full bg-rose-500/20" />
          <AlertCircle className="relative h-2.5 w-2.5 text-rose-300" />
        </span>
        <span className="font-medium">
          {t('projectsPage.cloneStatus.failed')}
        </span>
      </span>
    )
  }

  return null
}
