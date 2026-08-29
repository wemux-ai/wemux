import { FolderGit2, GitFork, Github } from 'lucide-react'
import type { ExecutorRecord } from '@shared/types'
import { useTranslation } from '../../lib/i18n/react'

export function OnboardingStepProject({
  projectCount,
  readyExecutors,
  autoCreating,
  autoCreatedProjectName,
  onCreateLocalProject,
  onCloneProject,
  onConnectGitHubProject,
}: {
  projectCount: number
  readyExecutors: ExecutorRecord[]
  autoCreating: boolean
  autoCreatedProjectName?: string
  onCreateLocalProject: () => void
  onCloneProject: () => void
  onConnectGitHubProject: () => void
}) {
  const { t } = useTranslation()
  const recommendedExecutor = readyExecutors[0]

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-zinc-50">{t('onboarding.project.title')}</h2>
        <p className="text-sm leading-6 text-zinc-400">
          {t('onboarding.project.description')}
        </p>
      </div>

      {autoCreating ? (
        <div className="rounded-lg border border-zinc-700/40 bg-zinc-900/60 px-4 py-4 text-sm text-zinc-300">
          {t('onboarding.project.autoCreating', { name: t('onboarding.project.defaultProjectName') })}
        </div>
      ) : projectCount > 0 ? (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100">
          {autoCreatedProjectName
            ? t('onboarding.project.autoCreated', { name: autoCreatedProjectName })
            : t('onboarding.project.detectedProjects', { count: projectCount })}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          <ProjectOption
            icon={<FolderGit2 className="h-4 w-4 text-emerald-300" />}
            title={t('onboarding.project.localProjectTitle')}
            description={t('onboarding.project.localProjectDescription')}
            onClick={onCreateLocalProject}
          />

          <ProjectOption
            icon={<GitFork className="h-4 w-4 text-emerald-300" />}
            title={t('onboarding.project.cloneProjectTitle')}
            description={t('onboarding.project.cloneProjectDescription')}
            onClick={onCloneProject}
          />

          <ProjectOption
            icon={<Github className="h-4 w-4 text-emerald-300" />}
            title="连接 GitHub 仓库"
            description="连接 GitHub 后直接选择仓库作为第一个项目。"
            onClick={onConnectGitHubProject}
          />
        </div>
      )}

      <p className="text-xs leading-5 text-zinc-500">
        {recommendedExecutor
          ? t('onboarding.project.executorSummary', { name: recommendedExecutor.name || recommendedExecutor.machineName, status: recommendedExecutor.status })
          : t('onboarding.project.noExecutor')}
      </p>
    </div>
  )
}

function ProjectOption({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-4 text-left transition hover:border-zinc-700 hover:bg-zinc-900"
      onClick={onClick}
    >
      <div className="flex items-center gap-2 text-zinc-100">
        {icon}
        <span className="font-medium">{title}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p>
    </button>
  )
}
