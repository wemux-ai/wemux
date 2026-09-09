// [INPUT]: R2 桌面端 downloads.json 与构建时 fallback manifest
// [OUTPUT]: 带真实下载链接的桌面端下载页
// [POS]: 商业桌面端分发入口；R2 是唯一当前发布源
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useMemo, useState } from 'react'
import { ArrowDownToLine, Check, ExternalLink, RefreshCw } from 'lucide-react'

import { MarketingPageLayout, MarketingSection } from '../marketing/marketing-page-layout'
import { useTranslation } from '../../lib/i18n/react'

const DOWNLOAD_MANIFEST_URL = 'https://downloads.wemux.ai/desktop/downloads.json'
const DOWNLOAD_BASE_URL = 'https://downloads.wemux.ai/desktop'

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

function PlatformCard({ platform, language }: { platform: PlatformInfo; language: 'zh' | 'en' }) {
  const url = `${DOWNLOAD_BASE_URL}/${encodeURIComponent(platform.file.name)}`
  const actionLabel = platform.kind === 'dmg' ? (language === 'zh' ? '下载 DMG' : 'Download DMG') : language === 'zh' ? '下载' : 'Download'
  return (
    <article className="group relative overflow-hidden rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors duration-200 hover:border-violet-500/40">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/70 to-transparent opacity-60" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-violet-300">{platform.arch}</p>
          <h3 className="mt-2 text-lg font-medium tracking-[-0.03em] text-zinc-100">{language === 'zh' ? platform.label : platform.labelEn}</h3>
        </div>
        {platform.recommended ? <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-emerald-300"><Check className="size-3" />{language === 'zh' ? '当前设备' : 'Your device'}</span> : null}
      </div>
      <p className="mt-5 truncate font-mono text-[10px] text-zinc-500" title={platform.file.name}>{platform.file.name}</p>
      <a className="mt-5 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-zinc-100 px-4 py-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-950 transition-colors duration-200 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400" href={url} rel="noopener noreferrer"><ArrowDownToLine className="size-4" />{actionLabel}<span className="text-zinc-500">{formatSize(platform.file.size)}</span></a>
      <details className="mt-4"><summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600 transition hover:text-zinc-300">SHA-512</summary><p className="mt-2 break-all rounded-lg border border-zinc-900 bg-black/30 p-2 font-mono text-[9px] leading-5 text-zinc-600">{platform.file.sha512}</p></details>
    </article>
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
  const recommended = platforms.find((platform) => platform.recommended)
  const macPlatforms = platforms.filter((platform) => platform.os === 'macos')
  const otherPlatforms = platforms.filter((platform) => platform.os !== 'macos')

  return (
    <MarketingPageLayout description={language === 'zh' ? '原生桌面端把 Agent 聊天、工作区、任务和本地 Worker 放进同一个窗口。' : 'Keep Agent chat, workspaces, tasks, and the local worker in one focused desktop window.'} eyebrow={language === 'zh' ? '桌面端下载' : 'Desktop download'} title={language === 'zh' ? '把 Wemux 带到你的桌面。' : 'Bring Wemux to your desktop.'}>
      <section className="relative overflow-hidden rounded-2xl border border-zinc-800/90 bg-[linear-gradient(135deg,rgba(24,24,27,0.98),rgba(17,12,29,0.94))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] sm:p-10"><div className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-violet-600/15 blur-3xl" /><div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between"><div className="max-w-2xl"><div className="inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-violet-200"><span className="size-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.8)]" />v{manifest.version} · {live ? 'live R2' : 'cached manifest'}</div><h2 className="mt-5 max-w-xl text-3xl font-medium tracking-[-0.06em] text-white sm:text-4xl">{language === 'zh' ? '一扇窗口，连接你的 Agent 工作流。' : 'One window for your Agent workflow.'}</h2><p className="mt-4 max-w-xl text-sm leading-7 text-zinc-400">{language === 'zh' ? '商业桌面端已连接 wemux.ai，下载后即可登录使用。更新包和自动更新 feed 均来自同一发布源。' : 'The commercial desktop app connects to wemux.ai. Download, sign in, and keep your workflow in one place.'}</p></div>{recommended ? <a className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-violet-500 px-5 py-3.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-white transition-colors duration-200 hover:bg-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 lg:w-auto" href={`${DOWNLOAD_BASE_URL}/${encodeURIComponent(recommended.file.name)}`} rel="noopener noreferrer"><ArrowDownToLine className="size-4" />{language === 'zh' ? '下载当前版本' : 'Download current build'}</a> : <a className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-violet-500 px-5 py-3.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-white transition-colors duration-200 hover:bg-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 lg:w-auto" href="#macos-downloads"><ArrowDownToLine className="size-4" />{language === 'zh' ? '选择 macOS 构建' : 'Choose a macOS build'}</a>}</div></section>
      <div id="macos-downloads"><MarketingSection description={language === 'zh' ? `v${manifest.version} · Apple Silicon 和 Intel 均可用` : `v${manifest.version} · available for Apple Silicon and Intel`} title="macOS"><div className="grid gap-4 sm:grid-cols-2">{macPlatforms.map((platform) => <PlatformCard key={platform.id} language={language} platform={platform} />)}</div></MarketingSection></div>
      {otherPlatforms.length > 0 ? <MarketingSection description={language === 'zh' ? '当前发布清单中的其他平台构建。' : 'Other builds in the current release manifest.'} title={language === 'zh' ? '其他平台' : 'Other platforms'}><div className="grid gap-4 sm:grid-cols-2">{otherPlatforms.map((platform) => <PlatformCard key={platform.id} language={language} platform={platform} />)}</div></MarketingSection> : null}
      <section className="grid gap-4 md:grid-cols-3">{[
        { icon: <RefreshCw className="size-4" />, title: language === 'zh' ? '自动更新' : 'Auto updates', body: language === 'zh' ? '新版本发布后，客户端会从同一 feed 检查更新。' : 'The app checks the same feed for new builds.' },
        { icon: <Check className="size-4" />, title: language === 'zh' ? '官方云服务' : 'Official cloud', body: language === 'zh' ? '商业桌面端预配置 wemux.ai，开箱即用。' : 'Preconfigured for wemux.ai and ready to use.' },
        { icon: <ExternalLink className="size-4" />, title: language === 'zh' ? '校验与发布' : 'Verified release', body: language === 'zh' ? '每个安装包都由发布清单提供 SHA-512。' : 'Every artifact includes a SHA-512 checksum.' },
      ].map((item) => <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4" key={item.title}><div className="flex size-8 items-center justify-center rounded-lg border border-violet-400/20 bg-violet-400/10 text-violet-300">{item.icon}</div><h3 className="mt-4 text-sm font-medium text-zinc-100">{item.title}</h3><p className="mt-2 text-xs leading-6 text-zinc-500">{item.body}</p></div>)}</section>
      <MarketingSection title={language === 'zh' ? '发布说明' : 'Release notes'}><div className="space-y-3 text-sm leading-7 text-zinc-400"><p>{language === 'zh' ? '桌面端锁定官方云服务 wemux.ai；自托管用户可以继续使用 Web UI 或从开源仓库自行构建。' : 'The desktop app is locked to wemux.ai. Self-hosted users can use the Web UI or build from the open-source repository.'}</p><p>{language === 'zh' ? '当前 macOS 包尚未完成 Developer ID 公证，首次安装可能需要在系统设置中允许打开。' : 'The current macOS artifacts are not yet notarized with Developer ID; macOS may ask you to allow the first launch.'}</p></div></MarketingSection>
    </MarketingPageLayout>
  )
}
