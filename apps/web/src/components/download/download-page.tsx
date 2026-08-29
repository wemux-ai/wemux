// [INPUT]: 下载清单 manifest
// [OUTPUT]: 桌面端下载页
// [POS]: 下载页（feature 桌面端分发）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useState } from 'react'

import { MarketingPageLayout, MarketingSection } from '../marketing/marketing-page-layout'

/** 下载清单公开地址（CI 发布时上传为 GitHub Release asset；失败则回退到仓库内 fallback manifest） */
const DOWNLOAD_MANIFEST_URL =
  import.meta.env.VITE_DESKTOP_DOWNLOAD_MANIFEST_URL || 'https://github.com/wemux-ai/wemux/releases/latest/download/downloads.json'

export type DesktopDownloadPlatform = {
  id: string
  os: 'macos' | 'windows' | 'linux'
  label: string
  recommended: boolean
  file: string
  url: string | null
  sizeBytes: number | null
  sha256: string | null
}

export type DesktopDownloadsManifest = {
  schemaVersion: number
  version: string
  publishedAt: string | null
  notes: string
  platforms: DesktopDownloadPlatform[]
}

const formatSize = (bytes: number | null) => {
  if (bytes === null || !Number.isFinite(bytes)) {
    return null
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function PlatformCard({ platform }: { platform: DesktopDownloadPlatform }) {
  const size = formatSize(platform.sizeBytes)

  return (
    <article className="border border-white/[0.08] bg-black/25 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-violet-300">{platform.label}</p>
        {platform.recommended ? (
          <span className="border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-violet-200">
            Recommended
          </span>
        ) : null}
      </div>
      <p className="mt-4 truncate font-mono text-[11px] text-zinc-500" title={platform.file}>
        {platform.file}
      </p>
      <div className="mt-5">
        {platform.url ? (
          <a
            className="inline-flex items-center gap-2 bg-violet-600 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white transition hover:bg-violet-500"
            href={platform.url}
            rel="noopener noreferrer"
          >
            Download
            {size ? <span className="text-violet-200">{size}</span> : null}
          </a>
        ) : (
          <span className="inline-flex items-center gap-2 border border-white/[0.12] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            Coming soon
          </span>
        )}
      </div>
      {platform.sha256 ? (
        <p className="mt-4 break-all font-mono text-[10px] leading-5 text-zinc-600">
          SHA-256 {platform.sha256}
        </p>
      ) : null}
    </article>
  )
}

export function DownloadPage({ manifest: fallbackManifest }: { manifest: DesktopDownloadsManifest }) {
  const [manifest, setManifest] = useState<DesktopDownloadsManifest>(fallbackManifest)

  useEffect(() => {
    let cancelled = false
    fetch(DOWNLOAD_MANIFEST_URL, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`downloads.json ${response.status}`)
        }
        return response.json() as Promise<DesktopDownloadsManifest>
      })
      .then((liveManifest) => {
        if (!cancelled && liveManifest?.platforms?.length) {
          setManifest(liveManifest)
        }
      })
      .catch(() => {
        // 网络失败或 CORS 未配时回退到仓库内 fallback manifest，页面仍可渲染
      })
    return () => {
      cancelled = true
    }
  }, [])

  const macPlatforms = manifest.platforms.filter((platform) => platform.os === 'macos')
  const otherPlatforms = manifest.platforms.filter((platform) => platform.os !== 'macos')

  return (
    <MarketingPageLayout
      description="Download the Wemux desktop client for macOS, Windows, and Linux. The desktop app keeps Agent chat, workspaces, tasks, and the local worker in one window."
      eyebrow="Download"
      title="Get the Wemux desktop app."
    >
      <MarketingSection description={`Mac 版（Apple Silicon / Intel）· 当前版本 v${manifest.version}`} title="Mac 版">
        <div className="grid gap-4 sm:grid-cols-2">
          {macPlatforms.map((platform) => (
            <PlatformCard key={platform.id} platform={platform} />
          ))}
        </div>
      </MarketingSection>

      <MarketingSection description="Windows 和 Linux 版本即将推出" title="其他平台">
        <div className="grid gap-4 sm:grid-cols-2">
          {otherPlatforms.map((platform) => (
            <PlatformCard key={platform.id} platform={platform} />
          ))}
        </div>
      </MarketingSection>

      <MarketingSection description="Release notes for the current desktop build." title="What's new">
        <p className="text-sm leading-7 text-zinc-300">{manifest.notes}</p>
        <div className="mt-5 flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-[0.18em]">
          <a
            className="border border-white/[0.12] px-4 py-3 text-zinc-300 transition hover:border-white/30 hover:text-white"
            href="/changelog"
          >
            Full changelog
          </a>
        </div>
      </MarketingSection>
    </MarketingPageLayout>
  )
}
