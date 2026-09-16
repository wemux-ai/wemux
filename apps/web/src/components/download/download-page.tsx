// [INPUT]: R2 桌面端 downloads.json 与构建时 fallback manifest
// [OUTPUT]: 首页风格桌面端下载页，主推网页端登录入口
// [POS]: 商业桌面端分发入口；R2 是唯一当前发布源
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useMemo, useState } from 'react'
import { ArrowDownToLine, BadgeCheck, Check, RefreshCw, ShieldCheck } from 'lucide-react'

import { useTranslation } from '../../lib/i18n/react'
import { SupportEmailText } from '../marketing/marketing-page-layout'
import type { Language } from '../../lib/i18n'

const DOWNLOAD_MANIFEST_URL = 'https://downloads.wemux.ai/desktop/downloads.json'
const DOWNLOAD_BASE_URL = 'https://downloads.wemux.ai/desktop'
const loginPath = '/login'

export type R2DownloadFile = {
  name: string
  size: number
  sha512: string
}

export type R2DownloadsManifest = {
  version: string
  generatedAt: string
  files: R2DownloadFile[]
}

export type DesktopDownloadsManifest = R2DownloadsManifest

type PlatformInfo = {
  id: string
  os: 'macos' | 'windows' | 'linux'
  label: string
  labelEn: string
  arch: 'arm64' | 'x64'
  file: R2DownloadFile
  recommended: boolean
  kind: 'dmg' | 'exe' | 'appimage'
}

const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const detectOS = (): 'macos' | 'windows' | 'other' => {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent.toLowerCase()
  if (userAgent.includes('mac')) return 'macos'
  if (userAgent.includes('win')) return 'windows'
  return 'other'
}

// Browser user agents intentionally hide Apple Silicon details in most cases.
// Keep the recommendation conservative so Intel users are never sent to an
// incompatible build; both Mac variants remain explicit download choices.
const detectArch = async (): Promise<'arm64' | 'x64' | null> => {
  if (typeof navigator === 'undefined') return null
  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('arm') || userAgent.includes('aarch64')) return 'arm64'
  if (userAgent.includes('intel') || userAgent.includes('x86_64')) return 'x64'
  try {
    const userAgentData = (navigator as Navigator & {
      userAgentData?: { getHighEntropyValues: (hints: string[]) => Promise<{ architecture?: string }> }
    }).userAgentData
    const platform = userAgentData?.getHighEntropyValues
      ? await userAgentData.getHighEntropyValues(['architecture'])
      : null
    if (platform?.architecture?.toLowerCase().includes('arm')) return 'arm64'
    if (platform?.architecture?.toLowerCase().includes('86')) return 'x64'
  } catch {
    // Some browsers reject high entropy hints; leave the recommendation unset.
  }
  return null
}

const parsePlatforms = (manifest: R2DownloadsManifest, currentArch: 'arm64' | 'x64' | null): PlatformInfo[] => {
  const currentOS = detectOS()
  const arm64Dmg = manifest.files.find((file) => file.name.endsWith('-arm64.dmg'))
  const x64Dmg = manifest.files.find((file) => file.name.endsWith('-x64.dmg'))
  const windows = manifest.files.find((file) => file.name.endsWith('.exe'))
  const linux = manifest.files.find((file) => file.name.endsWith('.AppImage'))

  return [
    arm64Dmg && {
      id: 'macos-arm64', os: 'macos' as const, label: 'macOS · Apple Silicon', labelEn: 'macOS · Apple Silicon', arch: 'arm64' as const, file: arm64Dmg, recommended: currentOS === 'macos' && currentArch === 'arm64', kind: 'dmg' as const,
    },
    x64Dmg && {
      id: 'macos-x64', os: 'macos' as const, label: 'macOS · Intel', labelEn: 'macOS · Intel', arch: 'x64' as const, file: x64Dmg, recommended: currentOS === 'macos' && currentArch === 'x64', kind: 'dmg' as const,
    },
    windows && {
      id: 'windows-x64', os: 'windows' as const, label: 'Windows · x64', labelEn: 'Windows · x64', arch: 'x64' as const, file: windows, recommended: currentOS === 'windows', kind: 'exe' as const,
    },
    linux && {
      id: 'linux-x64', os: 'linux' as const, label: 'Linux · AppImage', labelEn: 'Linux · AppImage', arch: 'x64' as const, file: linux, recommended: false, kind: 'appimage' as const,
    },
  ].filter(Boolean) as PlatformInfo[]
}

// 与首页一致的设计语言：纯黑底、白色主按钮、mono eyebrow、white/[0.07] 分隔线。
const headerNav = [
  { href: '/', label: '首页', labelEn: 'Home' },
  { href: '/#agents', label: 'Agent', labelEn: 'Agents' },
  { href: '/pricing', label: '定价', labelEn: 'Pricing' },
  { href: '/faq', label: '常见问题', labelEn: 'FAQ' },
  { href: '/docs', label: '文档', labelEn: 'Docs' },
]

function DownloadHeader({ language }: { language: Language }) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-white/[0.07] bg-black/[0.88] backdrop-blur-xl">
      <div className="mx-auto flex h-11 max-w-[1440px] items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <a className="text-[11px] font-black uppercase tracking-[0.18em] text-white" href="/">
            Wemux
          </a>
          <nav className="hidden items-center gap-7 lg:flex">
            {headerNav.map((item) => (
              <a
                key={item.href}
                className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 transition hover:text-white"
                href={item.href}
              >
                {language === 'zh' ? item.label : item.labelEn}
              </a>
            ))}
          </nav>
        </div>
        <a
          className="rounded-lg bg-white px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-black transition hover:bg-zinc-200"
          href={loginPath}
        >
          {language === 'zh' ? '开始使用' : 'Get Started'}
        </a>
      </div>
    </header>
  )
}

function PlatformCard({ language, platform }: { language: Language; platform: PlatformInfo }) {
  const url = `${DOWNLOAD_BASE_URL}/${encodeURIComponent(platform.file.name)}`
  const actionLabel = platform.kind === 'dmg' ? (language === 'zh' ? '下载 DMG' : 'Download DMG') : language === 'zh' ? '下载' : 'Download'
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-black/40 p-6">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-white/20" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">{platform.arch}</p>
          <h3 className="mt-2 text-lg font-medium tracking-[-0.03em] text-white">{language === 'zh' ? platform.label : platform.labelEn}</h3>
        </div>
        {platform.recommended ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-emerald-300">
            <Check className="size-3" />
            {language === 'zh' ? '当前设备' : 'Your device'}
          </span>
        ) : null}
      </div>
      <p className="mt-5 truncate font-mono text-[10px] text-zinc-500" title={platform.file.name}>{platform.file.name}</p>
      <a
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        href={url}
        rel="noopener noreferrer"
      >
        <ArrowDownToLine className="size-4" />
        {actionLabel}
        <span className="text-zinc-500">{formatSize(platform.file.size)}</span>
      </a>
      <details className="mt-4">
        <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600 transition hover:text-zinc-300">SHA-512</summary>
        <p className="mt-2 break-all rounded-lg border border-white/[0.07] bg-black/30 p-2 font-mono text-[9px] leading-5 text-zinc-600">{platform.file.sha512}</p>
      </details>
    </article>
  )
}

function PlatformSection({ children, description, title }: { children: React.ReactNode; description: string; title: string }) {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="text-2xl font-medium tracking-[-0.04em] text-white">{title}</h2>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{description}</p>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

export function DownloadPage({ manifest: fallbackManifest }: { manifest: DesktopDownloadsManifest }) {
  const { language } = useTranslation()
  const [manifest, setManifest] = useState<R2DownloadsManifest>(fallbackManifest)
  const [live, setLive] = useState(false)
  const [currentArch, setCurrentArch] = useState<'arm64' | 'x64' | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(DOWNLOAD_MANIFEST_URL, { cache: 'no-store' })
      .then((response) => { if (!response.ok) throw new Error(`downloads.json ${response.status}`); return response.json() as Promise<R2DownloadsManifest> })
      .then((next) => { if (!cancelled && next?.version && Array.isArray(next.files) && next.files.length > 0) { setManifest(next); setLive(true) } })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    detectArch().then((arch) => {
      if (!cancelled) setCurrentArch(arch)
    })
    return () => { cancelled = true }
  }, [])

  const platforms = useMemo(() => parsePlatforms(manifest, currentArch), [currentArch, manifest])
  const macPlatforms = platforms.filter((platform) => platform.os === 'macos')
  const otherPlatforms = platforms.filter((platform) => platform.os !== 'macos')

  return (
    <main className="min-h-screen overflow-hidden bg-[#0a0a0a] font-sans text-zinc-100 selection:bg-white/40">
      <DownloadHeader language={language} />
      <div aria-hidden="true" className="h-11" />

      <section className="relative mx-auto max-w-[1440px] px-4 pb-20 pt-20 text-center sm:px-6 sm:pt-28">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(255,255,255,0.06),transparent)]" />
        <div className="relative mx-auto max-w-5xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_16px_rgba(52,211,153,0.7)]" />
            v{manifest.version} · {language === 'zh' ? 'macOS 与 Windows 可用' : 'macOS & Windows available'}
          </div>
          <h1 className="mt-8 text-balance text-5xl font-medium leading-[1.05] tracking-[-0.065em] text-white sm:text-6xl lg:text-7xl">
            {language === 'zh' ? '现在就在浏览器里开始。' : 'Start right now, in your browser.'}
          </h1>
          <p className="mx-auto mt-7 max-w-3xl text-balance text-lg leading-8 text-zinc-300">
            {language === 'zh'
              ? '无需等待下载，打开网页端即可创建任务、指挥 Agent 干活。桌面端已就绪，适合把整个工作流装进一个窗口。'
              : 'No download required. Open the web app to create tasks and put Agents to work immediately. The desktop app is ready when you want everything in one window.'}
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              href={loginPath}
            >
              {language === 'zh' ? '先从网页端开始' : 'Start on the Web'}
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 17L17 7M7 7h10v10" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            <a
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.14] px-6 py-3 text-sm font-medium text-zinc-200 transition hover:border-white/30 hover:text-white"
              href="#downloads"
            >
              <ArrowDownToLine className="size-4" aria-hidden="true" />
              {language === 'zh' ? '下载桌面端' : 'Download the desktop app'}
            </a>
          </div>
          <div className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-6 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            <span>{language === 'zh' ? '开源' : 'Open Source'}</span>
            <span className="hidden h-1 w-1 rounded-full bg-emerald-400 sm:block" />
            <span>{language === 'zh' ? '自动更新' : 'Auto Updates'}</span>
            <span className="hidden h-1 w-1 rounded-full bg-emerald-400 sm:block" />
            <span>{language === 'zh' ? 'SHA-512 校验' : 'SHA-512 Verified'}</span>
            <span className="hidden h-1 w-1 rounded-full bg-emerald-400 sm:block" />
            <span>{live ? (language === 'zh' ? 'R2 实时清单' : 'Live R2 manifest') : (language === 'zh' ? '缓存清单' : 'Cached manifest')}</span>
          </div>
        </div>
      </section>

      <div className="space-y-16 pb-24" id="downloads">
        <PlatformSection
          description={language === 'zh' ? `v${manifest.version} · Apple Silicon 与 Intel` : `v${manifest.version} · Apple Silicon and Intel`}
          title="macOS"
        >
          {macPlatforms.map((platform) => <PlatformCard key={platform.id} language={language} platform={platform} />)}
        </PlatformSection>

        {otherPlatforms.length > 0 ? (
          <PlatformSection
            description={language === 'zh' ? '当前发布清单中的其他平台构建' : 'Other builds in the current release manifest'}
            title={language === 'zh' ? '其他平台' : 'Other platforms'}
          >
            {otherPlatforms.map((platform) => <PlatformCard key={platform.id} language={language} platform={platform} />)}
          </PlatformSection>
        ) : null}

        <section className="mx-auto grid w-full max-w-6xl gap-4 px-4 md:grid-cols-3 sm:px-6">
          {[
            {
              icon: <RefreshCw className="size-4" />,
              title: language === 'zh' ? '自动更新' : 'Auto updates',
              body: language === 'zh' ? '新版本发布后，客户端会从同一 feed 检查更新。' : 'The app checks the same feed for new builds.',
            },
            {
              icon: <ShieldCheck className="size-4" />,
              title: language === 'zh' ? '官方云服务' : 'Official cloud',
              body: language === 'zh' ? '商业桌面端预配置 wemux.ai，开箱即用。' : 'Preconfigured for wemux.ai and ready to use.',
            },
            {
              icon: <BadgeCheck className="size-4" />,
              title: language === 'zh' ? '校验与发布' : 'Verified release',
              body: language === 'zh' ? '每个安装包都由发布清单提供 SHA-512。' : 'Every artifact includes a SHA-512 checksum.',
            },
          ].map((item) => (
            <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-black/40 p-6" key={item.title}>
              <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-white/20" />
              <div className="flex size-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-200">{item.icon}</div>
              <h3 className="mt-4 text-sm font-medium text-white">{item.title}</h3>
              <p className="mt-2 text-xs leading-6 text-zinc-500">{item.body}</p>
            </div>
          ))}
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-black/40 p-6 sm:p-8">
            <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-white/20" />
            <h2 className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-400">{language === 'zh' ? '发布说明' : 'Release notes'}</h2>
            <div className="mt-4 space-y-3 text-sm leading-7 text-zinc-400">
              <p>
                {language === 'zh'
                  ? '桌面端锁定官方云服务 wemux.ai；自托管用户可以继续使用 Web UI 或从开源仓库自行构建。'
                  : 'The desktop app is locked to wemux.ai. Self-hosted users can use the Web UI or build from the open-source repository.'}
              </p>
              <p>
                {language === 'zh'
                  ? '当前 macOS 包尚未完成 Developer ID 公证，首次安装可能需要在系统设置中允许打开。'
                  : 'The current macOS artifacts are not yet notarized with Developer ID; macOS may ask you to allow the first launch.'}
              </p>
            </div>
          </div>
        </section>
      </div>

      <footer className="border-t border-white/[0.07] bg-[#060607] px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto flex max-w-[1368px] flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <img alt="" className="h-8 w-8 shrink-0" src="/logo.svg" />
            <span className="text-lg font-semibold tracking-[-0.04em] text-white">Wemux</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-500">
            <a className="transition-colors hover:text-white" href="/">{language === 'zh' ? '首页' : 'Home'}</a>
            <a className="transition-colors hover:text-white" href="/pricing">{language === 'zh' ? '定价' : 'Pricing'}</a>
            <a className="transition-colors hover:text-white" href="/faq">{language === 'zh' ? '常见问题' : 'FAQ'}</a>
            <a className="transition-colors hover:text-white" href="https://github.com/wemux-ai/wemux" rel="noreferrer" target="_blank">GitHub</a>
            <a className="transition-colors hover:text-white" href={loginPath}>{language === 'zh' ? '登录' : 'Sign in'}</a>
          </div>
          <SupportEmailText className="text-sm text-zinc-500" />
        </div>
        <div className="mx-auto mt-8 flex max-w-[1368px] flex-col gap-3 border-t border-white/[0.07] pt-5 font-mono text-[10px] tracking-[0.12em] text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
          <span>{language === 'zh' ? 'AI 原生组织操作系统' : 'AI-native organization OS'}</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <a className="transition-colors hover:text-zinc-300" href="/privacy">{language === 'zh' ? '隐私政策' : 'Privacy'}</a>
            <a className="transition-colors hover:text-zinc-300" href="/terms">{language === 'zh' ? '服务条款' : 'Terms'}</a>
            <span>
              {language === 'zh' ? '构建者' : 'Built by'}{' '}
              <a className="transition-colors hover:text-zinc-300" href="https://zijiekyro.com" rel="author" target="_blank">Zijie Kyro</a>
            </span>
          </div>
        </div>
      </footer>
    </main>
  )
}
