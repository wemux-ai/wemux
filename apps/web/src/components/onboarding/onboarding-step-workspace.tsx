import { Building2 } from 'lucide-react'
import { Input } from '../ui/input'
import { useTranslation } from '../../lib/i18n/react'

export function OnboardingStepWorkspace({
  workspaceName,
  onWorkspaceNameChange,
  saving,
}: {
  workspaceName: string
  onWorkspaceNameChange: (value: string) => void
  saving: boolean
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-zinc-50">{t('onboarding.workspace.title')}</h2>
        <p className="text-sm leading-6 text-zinc-400">{t('onboarding.workspace.description')}</p>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="flex items-center gap-2 text-zinc-100">
          <Building2 className="h-4 w-4 text-emerald-300" />
          <span>{t('onboarding.workspace.label')}</span>
        </div>
        <Input
          value={workspaceName}
          onChange={(event) => onWorkspaceNameChange(event.target.value)}
          placeholder={t('onboarding.workspace.placeholder')}
          className="mt-3 border-zinc-800 bg-zinc-900 text-zinc-100"
          disabled={saving}
          autoFocus
        />
        <p className="mt-3 text-sm leading-6 text-zinc-400">{t('onboarding.workspace.note')}</p>
      </div>
    </div>
  )
}
