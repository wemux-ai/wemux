import type { OnboardingStep } from '@shared/onboarding'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'

export function OnboardingProgress({ currentStep }: { currentStep: OnboardingStep }) {
  const { t } = useTranslation()
  const steps: Array<{ id: Exclude<OnboardingStep, 'done'>; label: string }> = [
    { id: 'workspace', label: t('onboarding.progress.workspace') },
    { id: 'executor', label: t('onboarding.progress.executor') },
    { id: 'runtime', label: t('onboarding.progress.runtime') },
    { id: 'project', label: t('onboarding.progress.project') },
    { id: 'first-task', label: t('onboarding.progress.firstTask') },
  ]
  const stepOrder = new Map(steps.map((step, index) => [step.id, index]))
  const currentIndex = currentStep === 'done' ? steps.length - 1 : (stepOrder.get(currentStep) ?? 0)

  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="flex min-w-max gap-2">
        {steps.map((step, index) => {
          const active = index === currentIndex
          const completed = index < currentIndex || currentStep === 'done'

          return (
            <div
              key={step.id}
              className={cn(
                'flex min-w-[6.25rem] flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors',
                active && 'border-emerald-500/35 bg-[linear-gradient(180deg,rgba(16,185,129,0.12),rgba(16,185,129,0.04))] shadow-[0_0_0_1px_rgba(16,185,129,0.06)_inset]',
                completed && !active && 'border-zinc-700/70 bg-zinc-900/60',
                !completed && !active && 'border-zinc-800/70 bg-zinc-950/40',
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-[0.45rem] border text-[10px] font-semibold tabular-nums transition-colors',
                  active && 'border-emerald-400/45 bg-emerald-400/16 text-emerald-200 shadow-[0_0_18px_rgba(16,185,129,0.18)]',
                  completed && !active && 'border-zinc-600 bg-zinc-800 text-zinc-100',
                  !completed && !active && 'border-zinc-700 bg-zinc-900 text-zinc-500',
                )}
              >
                {index + 1}
              </span>
              <span className={cn('truncate text-[12px] font-medium', active || completed ? 'text-zinc-100' : 'text-zinc-500')}>
                {step.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
