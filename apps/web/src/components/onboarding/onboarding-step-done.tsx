import { Button } from '../ui/button'
import { useTranslation } from '../../lib/i18n/react'

export function OnboardingStepDone({
  onGoKanban,
  onGoExecution,
  onGoSettings,
}: {
  onGoKanban: () => void
  onGoExecution: () => void
  onGoSettings: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-zinc-50">{t('onboarding.done.title')}</h2>
        <p className="text-sm leading-6 text-zinc-400">{t('onboarding.done.description')}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Button type="button" className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200" onClick={onGoKanban}>
          {t('onboarding.done.goKanban')}
        </Button>
        <Button type="button" variant="outline" className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50" onClick={onGoExecution}>
          {t('onboarding.done.goExecution')}
        </Button>
        <Button type="button" variant="outline" className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50" onClick={onGoSettings}>
          {t('onboarding.done.goSettings')}
        </Button>
      </div>
    </div>
  )
}
