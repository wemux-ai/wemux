import { useTranslation } from '../lib/i18n/react'

export const NotFound = () => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="max-w-lg rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">{t('errors.notFound')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('errors.notFoundDescription')}</p>
      </div>
    </div>
  )
}
