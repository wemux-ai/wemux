import { Link } from '@tanstack/react-router'
import { ArrowRight, Github, Loader2, PlugZap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useTranslation } from '../../lib/i18n/react'
import { Button } from '../ui/button'

type GitHubAppConnectionStatus = {
  appSlug?: string
  configured: boolean
  connected: boolean
  loading: boolean
}

export function useGitHubAppConnectionStatus() {
  const [status, setStatus] = useState<GitHubAppConnectionStatus>({
    configured: true,
    connected: false,
    loading: true,
  })

  useEffect(() => {
    let cancelled = false

    void api.listUserGitHubAppInstallations()
      .then((response) => {
        if (cancelled) {
          return
        }

        setStatus({
          appSlug: response.appSlug,
          configured: response.configured,
          connected: response.installations.length > 0,
          loading: false,
        })
      })
      .catch(() => {
        if (cancelled) {
          return
        }

        setStatus({
          configured: true,
          connected: false,
          loading: false,
        })
      })

    return () => {
      cancelled = true
    }
  }, [])

  return status
}

export function GitHubAppConnectionLoadingState() {
  const { language } = useTranslation()

  return (
    <div className="flex h-full min-h-0 min-w-0 items-center justify-center bg-[#050505] px-6 text-zinc-100">
      <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 px-5 py-4 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-200" />
        <span>{language === 'zh' ? '正在检查 GitHub App 连接状态…' : 'Checking GitHub App connection...'}</span>
      </div>
    </div>
  )
}

export function GitHubAppConnectionRequiredState({
  appSlug,
  configured,
  sectionLabel,
}: {
  appSlug?: string
  configured: boolean
  sectionLabel: string
}) {
  const { language } = useTranslation()

  return (
    <div className="flex h-full min-h-0 min-w-0 items-center justify-center bg-[#050505] px-6 text-zinc-100">
      <div className="w-full max-w-xl rounded-[1.75rem] border border-zinc-800 bg-[linear-gradient(180deg,rgba(16,16,18,0.98),rgba(8,8,10,0.96))] p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.34)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-100">
          <Github className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-zinc-50">
          {language === 'zh' ? '需要先连接 GitHub App' : 'Connect GitHub App First'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          {configured
            ? (
                language === 'zh'
                  ? `当前还没有连接 GitHub App，因此无法查看右侧的 ${sectionLabel} 内容。先完成 GitHub App 授权，再回来继续。`
                  : `GitHub App is not connected yet, so ${sectionLabel} cannot be shown here. Connect it first, then come back.`
              )
            : (
                language === 'zh'
                  ? '当前环境还没有配置 GitHub App。请先完成配置，或联系管理员启用后再继续。'
                  : 'GitHub App is not configured in this environment yet. Configure it first or ask an admin to enable it.'
              )}
        </p>
        {appSlug ? (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1 text-xs text-zinc-500">
            <PlugZap className="h-3.5 w-3.5" />
            <span>{language === 'zh' ? `目标 App：${appSlug}` : `Target App: ${appSlug}`}</span>
          </div>
        ) : null}
        <div className="mt-7 flex justify-center">
          <Button asChild className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200">
            <Link
              to="/settings"
              search={{
                section: 'git',
                checkout: undefined,
                billingRequestId: undefined,
                workspaceId: undefined,
                billingDebug: undefined,
              } as never}
            >
              {language === 'zh' ? '前往连接 GitHub App' : 'Open Git Settings'}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

export function GitHubAppConnectionOverlay({
  appSlug,
  configured,
  sectionLabel,
}: {
  appSlug?: string
  configured: boolean
  sectionLabel: string
}) {
  const { language } = useTranslation()

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_42%)] opacity-80 blur-3xl" />
      <div className="pointer-events-auto relative w-full max-w-lg overflow-hidden rounded-[1.6rem] border border-zinc-700/70 bg-zinc-950/45 p-6 text-center shadow-[0_30px_90px_rgba(0,0,0,0.28)] backdrop-blur-md">
        <div className="absolute -left-10 top-6 h-24 w-24 rounded-full bg-white/8 blur-3xl" />
        <div className="absolute -right-8 bottom-2 h-20 w-20 rounded-full bg-zinc-200/8 blur-3xl" />
        <div className="relative">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-700/70 bg-zinc-950/70 text-zinc-100">
            <Github className="h-5 w-5" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-zinc-50">
            {language === 'zh' ? '连接 GitHub App 以启用这里的内容' : 'Connect GitHub App to unlock this view'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-300/90">
            {configured
              ? (
                  language === 'zh'
                    ? `当前还没有连接 GitHub App。你可以先浏览这个页面布局，连接后再真正使用 ${sectionLabel}。`
                    : `GitHub App is not connected yet. You can still preview this page layout, then connect it to use ${sectionLabel}.`
                )
              : (
                  language === 'zh'
                    ? '当前环境还没有配置 GitHub App。可以先保留这个视图，等管理员完成配置后再继续。'
                    : 'GitHub App is not configured in this environment yet. Keep this view for now and continue after an admin enables it.'
                )}
          </p>
          {appSlug ? (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-zinc-700/70 bg-zinc-950/55 px-3 py-1 text-xs text-zinc-400">
              <PlugZap className="h-3.5 w-3.5" />
              <span>{language === 'zh' ? `目标 App：${appSlug}` : `Target App: ${appSlug}`}</span>
            </div>
          ) : null}
          <div className="mt-5 flex justify-center">
            <Button asChild className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200">
              <Link
                to="/settings"
                search={{
                  section: 'git',
                  checkout: undefined,
                  billingRequestId: undefined,
                  workspaceId: undefined,
                  billingDebug: undefined,
                } as never}
              >
                {language === 'zh' ? '去连接 GitHub App' : 'Open Git Settings'}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
