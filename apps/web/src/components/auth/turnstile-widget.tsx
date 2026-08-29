import { useCallback, useEffect, useRef } from 'react'

type TurnstileWidgetProps = {
  expiredMessage: string
  resetKey: number
  siteKey: string
  scriptErrorMessage: string
  widgetErrorMessage: string
  onError: (message: string) => void
  onTokenChange: (token: string) => void
}

type TurnstileRenderOptions = {
  callback?: (token: string) => void
  size?: 'compact' | 'flexible' | 'normal'
  theme?: 'auto' | 'dark' | 'light'
  'error-callback'?: () => void
  'expired-callback'?: () => void
}

type TurnstileApi = {
  ready: (callback: () => void) => void
  render: (container: HTMLElement, options: TurnstileRenderOptions & { sitekey: string }) => string
  remove: (widgetId: string) => void
  reset: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const TURNSTILE_SCRIPT_ID = 'vibemux-turnstile-script'

export function TurnstileWidget({
  expiredMessage,
  resetKey,
  siteKey,
  scriptErrorMessage,
  widgetErrorMessage,
  onError,
  onTokenChange,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const onErrorRef = useRef(onError)
  const onTokenChangeRef = useRef(onTokenChange)
  const expiredMessageRef = useRef(expiredMessage)
  const scriptErrorMessageRef = useRef(scriptErrorMessage)
  const widgetErrorMessageRef = useRef(widgetErrorMessage)

  useEffect(() => {
    onErrorRef.current = onError
    onTokenChangeRef.current = onTokenChange
    expiredMessageRef.current = expiredMessage
    scriptErrorMessageRef.current = scriptErrorMessage
    widgetErrorMessageRef.current = widgetErrorMessage
  }, [expiredMessage, onError, onTokenChange, scriptErrorMessage, widgetErrorMessage])

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile || widgetIdRef.current) {
      return
    }

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      size: 'flexible',
      theme: 'dark',
      callback: (token) => {
        onTokenChangeRef.current(token)
      },
      'expired-callback': () => {
        onTokenChangeRef.current('')
        onErrorRef.current(expiredMessageRef.current)
      },
      'error-callback': () => {
        onTokenChangeRef.current('')
        onErrorRef.current(widgetErrorMessageRef.current)
      },
    })
  }, [siteKey])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const existingScript = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null
    const handleLoad = () => {
      renderWidget()
    }
    const handleError = () => {
      onErrorRef.current(scriptErrorMessageRef.current)
    }

    if (window.turnstile) {
      renderWidget()
      return
    }

    if (existingScript) {
      existingScript.addEventListener('load', handleLoad)
      existingScript.addEventListener('error', handleError)
    } else {
      const script = document.createElement('script')
      script.id = TURNSTILE_SCRIPT_ID
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.addEventListener('load', handleLoad)
      script.addEventListener('error', handleError)
      document.head.appendChild(script)
    }

    return () => {
      const script = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null
      script?.removeEventListener('load', handleLoad)
      script?.removeEventListener('error', handleError)
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [renderWidget])

  useEffect(() => {
    if (!widgetIdRef.current || !window.turnstile) {
      return
    }

    onTokenChangeRef.current('')
    window.turnstile.reset(widgetIdRef.current)
  }, [resetKey])

  return <div className="min-w-0 max-w-full" ref={containerRef} />
}
