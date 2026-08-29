/**
 * [INPUT]: TanStack Router errors, route reset support, and localized recovery copy.
 * [OUTPUT]: A recoverable application-wide page error surface with technical details.
 * [POS]: Root route error boundary; restores route data or reloads the current application build.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { useState } from 'react'
import { RefreshCw, RotateCcw } from 'lucide-react'
import { useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { Button } from './ui/button'
import { useTranslation } from '../lib/i18n/react'

export type PageErrorKind = 'invalid-render-data' | 'stale-assets' | 'unexpected'

export const classifyPageError = (error: Error): PageErrorKind => {
  const message = error.message || ''

  if (/react\.dev\/errors\/31\b|objects are not valid as a react child/i.test(message)) {
    return 'invalid-render-data'
  }

  if (/chunkloaderror|loading chunk|failed to fetch dynamically imported module|importing a module script failed|unable to preload css/i.test(message)) {
    return 'stale-assets'
  }

  return 'unexpected'
}

export const DefaultCatchBoundary = ({ error, info, reset }: ErrorComponentProps) => {
  const { t } = useTranslation()
  const router = useRouter()
  const [retrying, setRetrying] = useState(false)
  const errorKind = classifyPageError(error)
  const summary = errorKind === 'invalid-render-data'
    ? t('errors.invalidRenderData')
    : errorKind === 'stale-assets'
      ? t('errors.staleAssets')
      : t('errors.pageLoadRecovery')

  const handleRetry = async () => {
    setRetrying(true)
    try {
      await router.invalidate()
      reset()
    } catch {
      window.location.reload()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-md border border-rose-500/40 bg-[#09090b] p-5 shadow-sm">
        <h1 className="text-base font-semibold text-zinc-100">{t('errors.pageLoadFailed')}</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">{summary}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
            disabled={retrying}
            onClick={() => void handleRetry()}
          >
            <RotateCcw className={retrying ? 'size-3.5 animate-spin' : 'size-3.5'} />
            {t('errors.retry')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-md border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="size-3.5" />
            {t('errors.refreshPage')}
          </Button>
        </div>

        <details className="mt-4 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
          <summary className="cursor-pointer select-none text-zinc-400 hover:text-zinc-200">
            {t('errors.technicalDetails')}
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-950 p-3 font-mono text-[11px] leading-5 text-zinc-500">
            {error.message || t('errors.unknown')}
            {info?.componentStack ? `\n\n${info.componentStack}` : ''}
          </pre>
        </details>
      </div>
    </div>
  )
}
