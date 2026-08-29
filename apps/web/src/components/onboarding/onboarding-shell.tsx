import type { ReactNode } from 'react'
import type { OnboardingStep } from '@shared/onboarding'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { OnboardingProgress } from './onboarding-progress'

type OnboardingShellProps = {
  currentStep: OnboardingStep
  title: string
  description: string
  children: ReactNode
  footerHidden?: boolean
  contentBare?: boolean
  contentClassName?: string
  backDisabled?: boolean
  nextDisabled?: boolean
  nextLabel?: string
  onBack?: () => void
  onNext?: () => void
  onSkip?: () => void
}

export function OnboardingShell({
  currentStep,
  title,
  description,
  children,
  footerHidden,
  contentBare,
  contentClassName,
  backDisabled,
  nextDisabled,
  nextLabel,
  onBack,
  onNext,
  onSkip,
}: OnboardingShellProps) {
  const { t } = useTranslation()

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050506] px-4 py-6 text-zinc-100 sm:px-6 sm:py-8">
      <OnboardingShellAmbientStyle />
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.14),transparent_58%)] opacity-80" />
        <div className="absolute left-[-10rem] top-[18%] h-[22rem] w-[22rem] rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.1),transparent_68%)] blur-3xl animate-[onboarding-ambient-float_20s_ease-in-out_infinite]" />
        <div className="absolute right-[-8rem] top-[42%] h-[18rem] w-[18rem] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.08),transparent_70%)] blur-3xl animate-[onboarding-ambient-float_24s_ease-in-out_infinite_reverse]" />
        <div className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-position:center_center] [background-size:72px_72px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(5,5,6,0.15)_58%,rgba(5,5,6,0.58)_100%)]" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-[68rem] flex-col gap-2.5">
        <section className="rounded-lg border border-zinc-800/50 bg-[#09090b]/68 px-3 py-2.5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-sm sm:px-3.5 sm:py-2.5">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/12 bg-emerald-500/5 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.12em] text-emerald-300/90">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {t('onboarding.shell.badge')}
          </div>
          <div className="mt-1.5 space-y-0.5">
            <h1 className="text-[1.16rem] font-semibold tracking-tight text-zinc-50 sm:text-[1.32rem]">{title}</h1>
            <p className="max-w-md text-[12px] leading-5 text-zinc-500">{description}</p>
          </div>
          <div className="mt-2">
            <OnboardingProgress currentStep={currentStep} />
          </div>
        </section>

        <section
          className={cn(
            contentBare
              ? 'relative min-h-[calc(100vh-20rem)]'
              : 'rounded-2xl border border-zinc-800 bg-[#09090b]/88 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.24)] backdrop-blur-sm sm:p-6',
            contentClassName,
          )}
        >
          {children}
        </section>

        {footerHidden ? null : (
          <section className="rounded-2xl border border-zinc-800 bg-[#09090b]/88 p-4 shadow-[0_20px_70px_rgba(0,0,0,0.2)] backdrop-blur-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                  onClick={onBack}
                  disabled={backDisabled}
                >
                  {t('onboarding.shell.back')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                  onClick={onSkip}
                >
                  {t('onboarding.shell.later')}
                </Button>
              </div>
              <Button
                type="button"
                className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                onClick={onNext}
                disabled={nextDisabled}
              >
                {nextLabel || t('onboarding.shell.next')}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function OnboardingShellAmbientStyle() {
  return (
    <style>{`
      @keyframes onboarding-ambient-float {
        0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
        50% { transform: translate3d(0, -18px, 0) scale(1.05); }
      }
    `}</style>
  )
}
