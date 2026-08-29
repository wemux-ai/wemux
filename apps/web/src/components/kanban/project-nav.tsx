import { ChevronRight, Plus } from 'lucide-react'
import { getProjectColor } from '@shared/project-color'
import { useState } from 'react'
import { getProjectSourceDisplay, getProjectVersionControlLabel } from '../../lib/project-form'
import { cn } from '../../lib/utils'
import type { Project } from '@shared/types'
import { ProjectCloneStatusBadge } from '../project-clone-status-badge'
import { Button } from '../ui/button'
import { CreateProjectModal } from './create-project-modal'
import { useTranslation } from '../../lib/i18n/react'

interface ProjectNavItemProps {
  project: Project
  isActive: boolean
  onClick: () => void
  t: (key: string) => string
}

export function ProjectNavItem({ project, isActive, onClick, t }: ProjectNavItemProps) {
  const color = getProjectColor(project)
  const versionControlLabel = getProjectVersionControlLabel(project, t)
  const sourceDisplay = getProjectSourceDisplay(project, t)

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all duration-200',
        isActive
          ? 'border-zinc-700 bg-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
          : 'border-transparent hover:border-zinc-800 hover:bg-zinc-950'
      )}
    >
      <div
        className={cn(
          'h-3.5 w-3.5 shrink-0 rounded-sm'
        )}
        style={{ backgroundColor: color }}
      >
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-medium', isActive ? 'text-zinc-100' : 'text-zinc-300')}>
          {project.name}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
          <ProjectCloneStatusBadge project={project} compact />
          <span className="truncate">{versionControlLabel}</span>
          <span className="text-zinc-700">·</span>
          <span className="truncate">{sourceDisplay}</span>
        </div>
      </div>
      {isActive ? <ChevronRight size={14} className="text-zinc-500" /> : null}
    </button>
  )
}

interface ProjectNavProps {
  projects: Project[]
  currentProject: Project
  onSelectProject: (id: string) => void
}

export function ProjectNav({ projects, currentProject, onSelectProject }: ProjectNavProps) {
  const { t } = useTranslation()
  const [createModalOpen, setCreateModalOpen] = useState(false)

  return (
    <aside className="hidden w-72 shrink-0 border-r border-zinc-900 bg-[#050506] xl:flex xl:flex-col">
      <div className="flex items-center justify-between border-b border-zinc-900 px-5 py-5">
        <div>
          <h1 className="text-lg font-semibold text-zinc-50">{t('nav.projects')}</h1>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-zinc-500">Project List</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
          onClick={() => setCreateModalOpen(true)}
        >
          <Plus size={16} />
        </Button>
      </div>

      <div className="flex-1 space-y-1.5 overflow-auto px-4 py-4">
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
          {t('projectsPage.title')}
        </p>
        {projects.map((p) => (
          <ProjectNavItem
            key={p.id}
            project={p}
            isActive={p.id === currentProject.id}
            onClick={() => onSelectProject(p.id)}
            t={t}
          />
        ))}
      </div>

      <div className="border-t border-zinc-900 bg-[#09090b] p-4">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <ChevronRight size={14} className="rotate-180" />
          <span className="truncate">{getProjectVersionControlLabel(currentProject, t)} · {getProjectSourceDisplay(currentProject, t)}</span>
        </div>
      </div>

      <CreateProjectModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
      />
    </aside>
  )
}
