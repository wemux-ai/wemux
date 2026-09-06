// [INPUT]: 下载清单 manifest
// [OUTPUT]: 桌面端下载页
// [POS]: 下载页（feature 桌面端分发）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useState } from 'react'
import { Download, CheckCircle2 } from 'lucide-react'

import { MarketingPageLayout } from '../marketing/marketing-page-layout'
import { useTranslation } from '../../lib/i18n/react'

/** 商业版下载清单（R2 分发） */
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

// Fallback manifest（构建时从 R2 拷贝的快照）
export type DesktopDownloadsManifest = R2DownloadsManifest

const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

type PlatformInfo = {
  id: string
  os: 'macos' | 'windows'
  label: string
  labelEn: string
  arch: string
  recommended: boolean
  file: R2DownloadFile
}

function detectOS(): 'macos' | 'windows' | 'other' {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('win')) return 'windows'
  return 'other'
}

function detectArch(): 'arm64' | 'x64' {
  // 简单检测：M1/M2 Mac 或其他
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('arm') || ua.includes('aarch64')) return 'arm64'
  return 'x64'
}

function parsePlatforms(manifest: R2DownloadsManifest): PlatformInfo[] {
  const platforms: PlatformInfo[] = []
  
  // macOS arm64
  const macArm64Dmg = manifest.files.find(f => f.name.includes('arm64.dmg'))
  if (macArm64Dmg) {
    platforms.push({
      id: 'macos-arm64',
      os: 'macos',
      label: 'macOS（Apple Silicon）',
      labelEn: 'macOS (Apple Silicon)',
      arch: 'arm64',
      recommended: detectOS() === 'macos' && detectArch() === 'arm64',
      file: macArm64Dmg,
    })
  }

  // macOS x64
  const macX64Dmg = manifest.files.find(f => f.name.includes('x64.dmg') || (f.name.includes('mac.zip') && !f.name.includes('arm64')))
  if (macX64Dmg) {
    platforms.push({
      id: 'macos-x64',
      os: 'macos',
      label: 'macOS（Intel）',
      labelEn: 'macOS (Intel)',
      arch: 'x64',
      recommended: detectOS() === 'macos' && detectArch() === 'x64',
      file: macX64Dmg,
    })
  }

  // Windows x64
  const winExe = manifest.files.find(f => f.name.endsWith('.exe'))
  if (winExe) {
    platforms.push({
      id: 'windows-x64',
      os: 'windows',
      label: 'Windows（x64）',
      labelEn: 'Windows (x64)',
      arch: 'x64',
      recommended: detectOS() === 'windows',
      file: winExe,
    })
  }

  return platforms
}

function PlatformCard({ platform, language }: { platform: PlatformInfo; language: 'zh' | 'en' }) {
  const downloadUrl = `${DOWNLOAD_BASE_URL}/${platform.file.name}`
  const size = formatSize(platform.file.size)

  return (
    <article className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-black/40 p-6 transition hover:border-white/[0.15] hover:bg-black/60">
      {/* 推荐标签 */}
      {platform.recommended && (
        <div className="absolute right-4 top-4">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            {language === 'zh' ? '推荐' : 'Recommended'}
          </span>
        </div>
      )}

      {/* 平台信息 */}
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-white">
          {language === 'zh' ? platform.label : platform.labelEn}
        </h3>
        <p className="mt-1 font-mono text-xs text-zinc-500">{platform.file.name}</p>
      </div>

      {/* 下载按钮 */}
      <a
        href={downloadUrl}
        className="group/btn inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-zinc-100"
        rel="noopener noreferrer"
      >
        <Download className="h-4 w-4 transition group-hover/btn:translate-y-0.5" />
        <span>{language === 'zh' ? '下载' : 'Download'}</span>
        <span className="text-zinc-600">{size}</span>
      </a>

      {/* SHA512 校验码（折叠显示） */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-400">
          {language === 'zh' ? '查看 SHA-512' : 'Show SHA-512'}
        </summary>
        <p className="mt-2 break-all rounded bg-black/60 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-zinc-600">
          {platform.file.sha512}
        </p>
      </details>
    </article>
  )
}

export function DownloadPage({ manifest: fallbackManifest }: { manifest: DesktopDownloadsManifest }) {
  const { language } = useTranslation()
  const [manifest, setManifest] = useState<R2DownloadsManifest>(fallbackManifest)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(DOWNLOAD_MANIFEST_URL, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<R2DownloadsManifest>
      })
      .then((liveManifest) => {
        if (!cancelled && liveManifest?.files?.length) {
          setManifest(liveManifest)
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch live manifest:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const platforms = parsePlatforms(manifest)
  const macPlatforms = platforms.filter((p) => p.os === 'macos')
  const winPlatforms = platforms.filter((p) => p.os === 'windows')

  const detectedOS = detectOS()
  const recommendedPlatform = platforms.find((p) => p.recommended)

  return (
    <MarketingPageLayout
      description={
        language === 'zh'
          ? '下载 Wemux 桌面客户端，支持 macOS 和 Windows。'
          : 'Download the Wemux desktop client for macOS and Windows.'
      }
      eyebrow={language === 'zh' ? '下载' : 'Download'}
      title={language === 'zh' ? '下载 Wemux 桌面端' : 'Download Wemux Desktop'}
    >
      {/* Hero 区域 */}
      <section className="mb-16">
        <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-black/60 to-black/40 p-8 sm:p-12">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(52,211,153,0.6)]" />
              {language === 'zh' ? `最新版本 v${manifest.version}` : `Latest v${manifest.version}`}
            </div>
            
            <h2 className="mb-4 text-2xl font-bold text-white sm:text-3xl">
              {language === 'zh'
                ? '原生桌面体验，锁定官方云服务'
                : 'Native Desktop Experience, Official Cloud Only'}
            </h2>
            
            <p className="mb-8 text-sm leading-relaxed text-zinc-400 sm:text-base">
              {language === 'zh'
                ? '商业版桌面端预配置官方云服务（wemux.ai），开箱即用。支持 macOS（Apple Silicon / Intel）与 Windows。'
                : 'Commercial desktop app pre-configured for official cloud (wemux.ai), ready out of the box. Supports macOS (Apple Silicon / Intel) and Windows.'}
            </p>

            {/* 快速下载按钮 */}
            {recommendedPlatform && (
              <a
                href={`${DOWNLOAD_BASE_URL}/${recommendedPlatform.file.name}`}
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-zinc-100"
              >
                <Download className="h-4 w-4" />
                <span>
                  {language === 'zh'
                    ? `下载 ${recommendedPlatform.label}`
                    : `Download for ${recommendedPlatform.labelEn}`}
                </span>
                <span className="text-zinc-600">{formatSize(recommendedPlatform.file.size)}</span>
              </a>
            )}
          </div>
        </div>
      </section>

      {/* macOS 下载区 */}
      {macPlatforms.length > 0 && (
        <section className="mb-12">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-white">macOS</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {language === 'zh'
                ? '支持 Apple Silicon（M1/M2/M3）与 Intel 芯片'
                : 'Supports Apple Silicon (M1/M2/M3) and Intel chips'}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {macPlatforms.map((platform) => (
              <PlatformCard key={platform.id} language={language} platform={platform} />
            ))}
          </div>
        </section>
      )}

      {/* Windows 下载区 */}
      {winPlatforms.length > 0 && (
        <section className="mb-12">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-white">Windows</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {language === 'zh' ? '支持 Windows 10/11（x64）' : 'Supports Windows 10/11 (x64)'}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {winPlatforms.map((platform) => (
              <PlatformCard key={platform.id} language={language} platform={platform} />
            ))}
          </div>
        </section>
      )}

      {/* 说明区 */}
      <section className="rounded-xl border border-white/[0.08] bg-black/20 p-6">
        <h3 className="mb-3 text-sm font-semibold text-white">
          {language === 'zh' ? '📦 商业版说明' : '📦 Commercial Edition Notes'}
        </h3>
        <ul className="space-y-2 text-sm leading-relaxed text-zinc-400">
          <li>
            {language === 'zh'
              ? '• 桌面端已锁定官方云服务（wemux.ai），无法切换其他服务器'
              : '• Desktop app is locked to official cloud (wemux.ai), cannot switch servers'}
          </li>
          <li>
            {language === 'zh'
              ? '• 自托管用户请使用 Web 界面或从开源仓库源码自行构建'
              : '• Self-hosted users: use Web UI or build from open-source repository'}
          </li>
          <li>
            {language === 'zh'
              ? '• macOS 需要 macOS 11 或更高版本；Windows 需要 Windows 10 或更高版本'
              : '• macOS requires macOS 11+; Windows requires Windows 10+'}
          </li>
        </ul>
      </section>
    </MarketingPageLayout>
  )
}
