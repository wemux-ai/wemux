import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Download } from 'lucide-react'

import { LandingGlobalStatus } from './landing-global-status'
import { InteractiveHeroGrid, LandingMotionStyles, useCursorGrid } from './landing-page-effects'
import { LandingProductPreview } from './landing-product-preview'
import type { ShellViewId } from './landing-real-product-shell'
import { SupportEmailText } from './marketing-page-layout'
import {
  agentRoles,
  heroTags,
  landingMeta,
  landingText,
  loginPath,
  navItems,
  nodeStatusClasses,
  scenarios,
  topologyNodePositions,
  workerNodes,
} from './landing-page-content'
import { LanguageSwitcher } from '../language-switcher'
import { CommunityLinkList } from '../community-join-dialog'
import { useTranslation } from '../../lib/i18n/react'
import { useScrollAnimation, useStaggeredAnimation } from './use-scroll-animation'
import type {
  AgentRole,
  BilingualText,
  LandingText,
  Scenario,
  WorkerNode,
} from './landing-page-content'
import type { PreviewViewId } from './landing-product-preview-data'
import type { Language } from '../../lib/i18n'
export function LandingPage() {
  const { language } = useTranslation()
  const meta = landingMeta[language]
  const page = landingText[language]

  useEffect(() => {
    document.title = meta.title

    const metaDescription = document.querySelector('meta[name="description"]')
    if (metaDescription) {
      metaDescription.setAttribute('content', meta.description)
    }
  }, [meta.description, meta.title])

  return (
    <main className="min-h-screen overflow-hidden bg-[#0a0a0a] font-sans text-zinc-100 selection:bg-white/40">
      <LandingMotionStyles />

      <div className="relative">
        <LandingHeader language={language} text={page} />
        <TopAnnouncementBanner language={language} text={page} />
        <div aria-hidden="true" className="h-10 sm:h-11" />
        <HeroSection language={language} text={page} />
        <LandingGlobalStatus language={language} />
        <PainPointSection text={page} />
        <AgentRolesSection language={language} text={page} />
        <WorkersSection language={language} text={page} />
        <OpenSourceSection language={language} />
        <PricingSection language={language} />
        <UseCasesSection language={language} text={page} />
        <FaqSection language={language} text={page} />
        <FinalCtaSection language={language} text={page} />
        <SiteFooter language={language} text={page} />
      </div>
    </main>
  )
}

function LandingHeader({ language, text }: { language: Language; text: LandingText }) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-white/[0.07] bg-black/[0.88] backdrop-blur-xl">
      <div className="mx-auto flex h-11 max-w-[1440px] items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <a className="text-[11px] font-black uppercase tracking-[0.18em] text-white" href="#top">
            Wemux
          </a>
          <nav className="hidden items-center gap-7 lg:flex">
            {navItems.map((item) => (
              <a
                key={item.href}
                className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 transition hover:text-white"
                href={item.href}
              >
                {localize({ zh: item.label, en: item.labelEn }, language)}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600 sm:inline">
            {text.navStatus}
          </span>
          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_16px_rgba(52,211,153,0.7)] animate-pulse" />
          <LanguageSwitcher />
          <a
            className="rounded-lg bg-white px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-black transition hover:bg-zinc-200"
            href={loginPath}
          >
            {text.startCta}
          </a>
        </div>
      </div>
    </header>
  )
}

function TopAnnouncementBanner({ language, text }: { language: Language; text: LandingText }) {
  return (
    <section
      aria-label={language === 'zh' ? 'Alpha 版本提示' : 'Alpha release notice'}
      className="fixed inset-x-0 top-11 z-30 border-b border-white/[0.08] bg-black/85 text-white backdrop-blur-xl"
      role="status"
    >
      <div className="mx-auto flex min-h-8 max-w-[1440px] items-center justify-center gap-2 px-3 py-1.5 text-center sm:gap-3 sm:px-6">
        <span className="inline-flex items-center rounded-sm border border-red-500/50 bg-red-500/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-red-300">
          {text.hero.alphaLabel}
        </span>
        <p className="min-w-0 truncate text-[11px] font-medium tracking-[0.03em] text-white/88 sm:text-xs sm:tracking-[0.08em]">
          <span className="sm:hidden">{language === 'zh' ? '阿尔法版本 / 快速迭代中' : 'Alpha / Rapid iteration'}</span>
          <span className="hidden sm:inline">{text.hero.alphaMessage}</span>
          <span className="mx-2 hidden text-white/20 sm:inline">/</span>
          <span className="hidden text-red-300/90 sm:inline">{language === 'zh' ? '快速迭代中' : 'Rapid iteration'}</span>
        </p>
      </div>
    </section>
  )
}

function HeroSection({ language, text }: { language: Language; text: LandingText }) {
  const cursorGrid = useCursorGrid<HTMLElement>()
  const [activeView, setActiveView] = useState<PreviewViewId>('workspaces')

  /** 预览外壳内部导航回传：侧栏 Agents 与 hero 的 Agent 标签渲染同一份 Developer Agent 视图，归一化高亮。 */
  const handlePreviewViewChange = (view: ShellViewId) => {
    setActiveView(view === 'agents' ? 'agent-developer' : (view as PreviewViewId))
  }

  return (
    <section
      className="relative mx-auto max-w-[1440px] px-4 pb-20 pt-24 sm:px-6 sm:pt-28 lg:pb-28 lg:pt-32"
      id="top"
      onPointerLeave={cursorGrid.onPointerLeave}
      onPointerMove={cursorGrid.onPointerMove}
      ref={cursorGrid.ref}
      style={cursorGrid.style}
    >
      <InteractiveHeroGrid />
      <div className="relative z-20 mx-auto max-w-6xl text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">{text.hero.eyebrow}</p>
        <h1 className="mt-6 text-balance text-5xl font-medium leading-[1.05] tracking-[-0.065em] text-white sm:text-6xl lg:text-[6rem]">
          {text.hero.title}
        </h1>
        <p className="mx-auto mt-8 max-w-4xl text-balance text-lg leading-8 text-zinc-300">
          {text.hero.description}
        </p>
        <p className="mx-auto mt-4 max-w-4xl text-balance text-sm font-medium leading-7 text-zinc-400 sm:text-base">
          {text.hero.secondaryDescription}
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-zinc-100"
            href="/download"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
            </svg>
            {localize({ zh: '下载 macOS 版', en: 'Download macOS' }, language)}
          </a>
          <a
            className="inline-flex items-center gap-2 text-base font-medium text-zinc-300 transition hover:text-white"
            href="https://github.com/wemux-ai/wemux"
            target="_blank"
            rel="noreferrer"
          >
            {localize({ zh: '在 GitHub 上探索', en: 'Explore on GitHub' }, language)}
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </a>
        </div>

        <div className="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-6 text-sm text-zinc-500">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            {localize({ zh: '开源', en: 'Open Source' }, language)}
          </div>
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            {localize({ zh: '隐私优先', en: 'Privacy First' }, language)}
          </div>
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
            </svg>
            {localize({ zh: '私有化部署', en: 'Self-hosted' }, language)}
          </div>
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {localize({ zh: '跨平台', en: 'Cross-platform' }, language)}
          </div>
        </div>

        <HeroTags activeView={activeView} language={language} onSelect={setActiveView} />
      </div>
      <div className="relative z-10">
        <LandingProductPreview
          language={language}
          onPreviewViewChange={handlePreviewViewChange}
          overlay={<HeroAgentsOnPreview />}
          previewView={activeView}
          text={text}
        />
      </div>
    </section>
  )
}

function HeroAgentsOnPreview() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-20 hidden h-0 overflow-visible lg:block">
      <PreviewAgents />
    </div>
  )
}

// ?v=2：这批素材已换成离线烘焙 alpha 的版本，版本参数避免浏览器用旧缓存（旧狗是黑底视频，
// 在黑色页面上会隐形）。以后更新素材时递增版本号。
const AGENT_VIDEO_VERSION = 'v=2'
const agentVideo = (name: string) => `/agents/videos/${name}?${AGENT_VIDEO_VERSION}`

const previewAgentPool = [
  { id: 'agent-05', poster: agentVideo('agent-05-wave-poster.png'), src: agentVideo('agent-05-wave.webm'), tone: 'violet' as const },
  { id: 'agent-13', poster: agentVideo('agent-13-wave-poster.png'), src: agentVideo('agent-13-wave.webm'), tone: 'orange' as const },
  { id: 'agent-11-bunny', poster: agentVideo('agent-11-bunny-wave-poster.png'), src: agentVideo('agent-11-bunny-wave.webm'), tone: 'violet' as const },
  { id: 'agent-19', poster: agentVideo('agent-19-wave-poster.png'), src: agentVideo('agent-19-wave.webm'), tone: 'lime' as const },
]

// 视频素材底部自带透明内边距（逐素材实测：owl ≈2px、dog ≈8px、robot ≈9px，bunny 贴底），
// 按各自边距向下位移，让角色脚部刚好落在预览窗口上边缘、不踩入窗口。
const previewAgentSlots = [
  'left-[2%] bottom-0 h-28 w-28 translate-y-[2px]',
  'left-[30%] bottom-0 h-28 w-28 translate-y-[8px]',
  'left-[58%] bottom-0 h-28 w-28 translate-y-[4px]',
  'left-[86%] bottom-0 h-28 w-28 translate-y-[9px]',
]

// 所有英雄素材均已离线烘焙 VP9 alpha（Mediabunny + WebCodecs，WebM AlphaMode=1），
// 直接走普通 video 路径，无需运行时抠像。

function PreviewAgents() {
  return previewAgentPool.map((agent, index) => (
    <HeroPreviewAgent
      className={previewAgentSlots[index]}
      key={agent.id}
      poster={agent.poster}
      src={agent.src}
      tone={agent.tone}
    />
  ))
}

function HeroPreviewAgent({
  className,
  poster,
  src,
  tone,
}: {
  className: string
  poster: string
  src: string
  tone: 'blue' | 'cyan' | 'lime' | 'orange' | 'violet'
}) {
  const glow = {
    blue: 'drop-shadow-[0_12px_24px_rgba(59,130,246,0.3)]',
    cyan: 'drop-shadow-[0_12px_24px_rgba(34,211,238,0.3)]',
    lime: 'drop-shadow-[0_12px_24px_rgba(114,255,92,0.34)]',
    orange: 'drop-shadow-[0_12px_24px_rgba(249,115,22,0.34)]',
    violet: 'drop-shadow-[0_12px_24px_rgba(168,85,247,0.3)]',
  }[tone]

  return (
    <div aria-hidden="true" className={`absolute overflow-visible ${className}`}>
      <video
        aria-hidden="true"
        autoPlay
        className={`relative h-full w-full object-contain object-bottom ${glow}`}
        loop
        muted
        playsInline
        poster={poster}
        preload="metadata"
      >
        <source src={src} type="video/webm" />
      </video>
    </div>
  )
}

function HeroTags({
  activeView,
  language,
  onSelect,
}: {
  activeView: PreviewViewId
  language: Language
  onSelect: (view: PreviewViewId) => void
}) {
  const tagRefs = useRef<Array<HTMLButtonElement | null>>([])
  const activeIndex = heroTags.findIndex((tag) => tag.viewId === activeView)
  const rovingIndex = activeIndex >= 0 ? activeIndex : 0

  return (
    <div aria-label={language === 'zh' ? '产品功能预览' : 'Product feature preview'} className="relative z-30 mx-auto mt-8 flex max-w-5xl flex-wrap justify-center gap-3" role="tablist">
      {heroTags.map((tag, index) => (
        <button
          aria-controls="console-preview"
          aria-selected={activeView === tag.viewId}
          key={tag.zh}
          className={`rounded-full px-5 py-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] ${
            activeView === tag.viewId
              ? 'bg-white text-black shadow-lg'
              : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200'
          }`}
          onClick={() => onSelect(tag.viewId)}
          onKeyDown={(event) => {
            const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
            if (!direction && event.key !== 'Home' && event.key !== 'End') return
            event.preventDefault()
            const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? heroTags.length - 1 : (index + direction + heroTags.length) % heroTags.length
            onSelect(heroTags[nextIndex].viewId)
            tagRefs.current[nextIndex]?.focus()
          }}
          ref={(element) => {
            tagRefs.current[index] = element
          }}
          role="tab"
          tabIndex={rovingIndex === index ? 0 : -1}
          type="button"
        >
          {localize(tag, language)}
        </button>
      ))}
    </div>
  )
}

function PainPointSection({ text }: { text: LandingText }) {
  const titleAnim = useScrollAnimation('fade-up')
  const cardAnims = useStaggeredAnimation(3, 'fade-up', { staggerDelay: 120 })
  const mobileSupportAnim = useScrollAnimation('fade-up', { delay: 200 })

  return (
    <SectionFrame className="border-y border-white/[0.06] py-24">
      <div ref={titleAnim.ref as any} className={titleAnim.className}>
        <SectionIntro
          description={text.pain.description}
          eyebrow={text.pain.eyebrow}
          kicker={text.pain.kicker}
          title={text.pain.title}
        />
      </div>
      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        {text.pain.cards.map((card, index) => (
          <div key={card.title} ref={cardAnims[index].ref as any} className={cardAnims[index].className}>
            <PainCard card={card} />
          </div>
        ))}
      </div>
      <div ref={mobileSupportAnim.ref as any} className={mobileSupportAnim.className}>
        <PainMobileSupportPanel mobileSupport={text.pain.mobileSupport} />
      </div>
    </SectionFrame>
  )
}

function AgentRolesSection({ language, text }: { language: Language; text: LandingText }) {
  const titleAnim = useScrollAnimation('fade-up')
  const cardAnims = useStaggeredAnimation(6, 'scale', { staggerDelay: 80 })

  return (
    <SectionFrame className="border-y border-white/[0.06] py-24" id="agents">
      <div ref={titleAnim.ref as any} className={titleAnim.className}>
        <SectionIntro
          description={text.agents.description}
          eyebrow={text.agents.eyebrow}
          kicker={text.agents.kicker}
          title={text.agents.title}
        />
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agentRoles.map((role, index) => (
          <div key={role.name} ref={cardAnims[index].ref as any} className={cardAnims[index].className}>
            <AgentRoleCard language={language} role={role} />
          </div>
        ))}
      </div>
    </SectionFrame>
  )
}

function WorkersSection({ language, text }: { language: Language; text: LandingText }) {
  const leftAnim = useScrollAnimation('slide-right')
  const rightAnim = useScrollAnimation('slide-left', { delay: 200 })

  return (
    <SectionFrame className="grid gap-10 py-24 lg:grid-cols-[0.9fr_1.1fr] lg:items-center" id="workers">
      <div ref={leftAnim.ref as any} className={leftAnim.className}>
        <SectionEyebrow>{text.workers.eyebrow}</SectionEyebrow>
        <h2 className="mt-4 max-w-xl text-4xl font-medium tracking-[-0.06em] text-white">{text.workers.title}</h2>
        <p className="mt-5 max-w-2xl text-sm leading-7 text-zinc-400">
          {text.workers.description}
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-500">
          {text.workers.secondaryDescription}
        </p>
      </div>
      <div ref={rightAnim.ref as any} className={rightAnim.className}>
        <WorkerMesh language={language} text={text} />
      </div>
    </SectionFrame>
  )
}

function UseCasesSection({ language, text }: { language: Language; text: LandingText }) {
  const titleAnim = useScrollAnimation('fade-up')
  const cardAnims = useStaggeredAnimation(4, 'fade-up', { staggerDelay: 100 })

  return (
    <SectionFrame className="border-y border-white/[0.06] py-24" id="use-cases">
      <div ref={titleAnim.ref as any} className={titleAnim.className}>
        <SectionIntro
          description={text.useCases.description}
          eyebrow={text.useCases.eyebrow}
          kicker={text.useCases.kicker}
          title={text.useCases.title}
        />
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {scenarios.map((scenario, index) => (
          <div key={scenario.title} ref={cardAnims[index].ref as any} className={cardAnims[index].className}>
            <ScenarioCard language={language} scenario={scenario} />
          </div>
        ))}
      </div>
    </SectionFrame>
  )
}

function OpenSourceSection({ language }: { language: Language }) {
  const t = (zh: string, en: string) => localize({ zh, en }, language)
  const leftAnim = useScrollAnimation('slide-right')
  const rightAnim = useScrollAnimation('slide-left', { delay: 200 })

  return (
    <section className="border-y border-white/[0.06] bg-white/[0.015] px-4 py-24 sm:px-6" id="open-source">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div ref={leftAnim.ref as any} className={leftAnim.className}>
            <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-400">
              {t('开源', 'Open Source')}
            </p>
            <h2 className="mt-5 text-balance text-4xl font-medium tracking-[-0.06em] text-white sm:text-5xl">
              {t('代码开源，自托管自由', 'Open source. Self-hosted. Yours.')}
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-balance text-sm leading-7 text-zinc-400 sm:text-base">
              {t(
                'Wemux 以 Apache-2.0 协议开源。核心编排、执行节点、工作区、聊天与渠道集成全部可自托管；模型密钥留在你自己的机器上，代码在你自己的仓库里执行。',
                'Wemux is open source under the Apache-2.0 license. The control plane, execution nodes, workspaces, chat and channel integrations are fully self-hostable — your model keys stay on your machines, and code runs in your own repositories.',
              )}
            </p>
            <div className="mt-9 flex flex-col items-start gap-3 sm:flex-row">
              <a
                className="rounded-lg bg-white px-7 py-3 text-xs font-bold text-black transition hover:bg-zinc-200"
                href="https://github.com/wemux-ai/wemux"
                target="_blank"
                rel="noreferrer"
              >
                GitHub ↗
              </a>
              <a
                className="rounded-lg border border-white/[0.14] bg-white/[0.03] px-7 py-3 text-xs font-bold text-white transition hover:border-white/25 hover:bg-white/[0.07]"
                href="https://github.com/wemux-ai/wemux#readme"
                target="_blank"
                rel="noreferrer"
              >
                {t('快速开始', 'Quick start')}
              </a>
            </div>
          </div>
          <div ref={rightAnim.ref as any} className={`grid gap-3 ${rightAnim.className}`}>
            {[
              {
                title: t('人类指挥，Agent 执行', 'Humans direct, agents execute'),
                desc: t('你设定目标与优先级，Agent 负责执行与交付，关键结果回到你这里确认。', 'You set goals and priorities. Agents handle execution and delivery. Key results come back for your approval.'),
              },
              {
                title: t('自带模型密钥（BYOK）', 'Bring your own keys'),
                desc: t('OpenCode / Claude Code / Codex 运行时在你自己的机器上配置，密钥不出设备。', 'Configure OpenCode / Claude Code / Codex runtimes on your own machines — keys never leave them.'),
              },
              {
                title: t('多节点组网', 'Multi-node mesh'),
                desc: t('多台机器自由接入，easytier 组网，按能力路由。', 'Connect any machines, mesh them with easytier, and route work by capability.'),
              },
              {
                title: t('社区共建', 'Built with the community'),
                desc: t('Issue、PR、Discussion 都欢迎。贡献指南见 CONTRIBUTING。', 'Issues, PRs and discussions welcome. See CONTRIBUTING for the contribution guide.'),
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-white/[0.08] bg-zinc-950/60 px-5 py-4">
                <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                <p className="mt-1.5 text-xs leading-6 text-zinc-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function PricingSection({ language }: { language: Language }) {
  const titleAnim = useScrollAnimation('fade-up')
  const cardAnim = useScrollAnimation('scale')

  return (
    <SectionFrame className="py-24" id="pricing">
      <div ref={titleAnim.ref as any} className={`mx-auto max-w-4xl text-center ${titleAnim.className}`}>
        <p className="text-sm text-zinc-500">
          {localize({ zh: '高性价比 · 覆盖可用 · 低延迟', en: 'High value · Wide coverage · Low latency' }, language)}
        </p>
        <h2 className="mt-4 text-5xl font-semibold tracking-tight text-white">
          {localize({ zh: '随你成长的定价', en: 'Pricing that grows with you' }, language)}
        </h2>
      </div>

      <div
        ref={cardAnim.ref as any}
        className={`mx-auto mt-16 max-w-2xl rounded-3xl border border-white/[0.06] bg-black/40 px-8 py-20 text-center ${cardAnim.className}`}
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-300">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-40" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
          </span>
          {localize({ zh: '即将推出', en: 'Coming soon' }, language)}
        </span>
        <h3 className="mt-6 text-3xl font-semibold tracking-tight text-white">
          {localize({ zh: '社区版可立即使用', en: 'The community edition is ready' }, language)}
        </h3>
        <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-zinc-400">
          {localize(
            {
              zh: '社区版可免费自托管使用；如需托管服务，请以产品页面公布的可用选项为准。',
              en: 'The community edition is free to self-host. Hosted options, when available, are described on the product pages.',
            },
            language
          )}
        </p>
        <a
          href="/login"
          className="mt-8 inline-block rounded-lg bg-white px-5 py-2.5 text-sm font-semibold leading-6 text-gray-900 shadow-sm transition hover:bg-gray-100"
        >
          {localize({ zh: '免费开始使用', en: 'Start for free' }, language)}
        </a>
      </div>
    </SectionFrame>
  )
}

function FaqSection({ language, text }: { language: Language; text: LandingText }) {
  const leftAnim = useScrollAnimation('slide-right')
  const rightAnim = useScrollAnimation('fade-up', { delay: 200 })

  return (
    <SectionFrame className="py-24" id="faq">
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
        <div ref={leftAnim.ref as any} className={leftAnim.className}>
          <SectionIntro
            description={text.faq.description}
            eyebrow={text.faq.eyebrow}
            kicker={text.faq.kicker}
            title={text.faq.title}
          />
        </div>
        <div ref={rightAnim.ref as any} className={rightAnim.className}>
          <div className="divide-y divide-white/[0.07] border-y border-white/[0.07]">
            {text.faq.items.map((item, index) => (
              <FaqItem answer={item.answer} index={index + 1} key={item.question} question={item.question} />
            ))}
          </div>
          <div className="flex flex-wrap gap-3 border-t border-white/[0.07] pt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            <a className="transition hover:text-white" href="/faq">
              {localize({ zh: '完整 FAQ', en: 'Full FAQ' }, language)}
            </a>
            <a className="transition hover:text-white" href="/compare/ai-chat-vs-ai-delivery">
              {localize({ zh: '为什么不是 AI 聊天工具', en: 'Why not another AI chat tool' }, language)}
            </a>
          </div>
        </div>
      </div>
    </SectionFrame>
  )
}

function FinalCtaSection({ language, text }: { language: Language; text: LandingText }) {
  const ctaAnim = useScrollAnimation('fade-up')

  return (
    <section className="px-4 pb-12 pt-24 sm:px-6 sm:pb-16 sm:pt-28" id="api">
      <div ref={ctaAnim.ref as any} className={ctaAnim.className}>
        <div className="relative mx-auto max-w-[1368px] overflow-hidden rounded-[2rem] border border-white/[0.08] bg-black px-5 py-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:px-9 sm:py-11 lg:px-14 lg:py-14">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-white/30" />
          <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-400">{text.cta.eyebrow}</p>
              <h2 className="mt-5 max-w-4xl whitespace-pre-line text-balance text-4xl font-medium leading-[1.02] tracking-[-0.055em] text-white sm:text-5xl">
                {text.cta.title}
              </h2>
              <p className="mt-5 max-w-3xl text-balance text-sm leading-7 text-zinc-300 sm:text-base">{text.cta.description}</p>
              <p className="mt-2 max-w-3xl text-balance text-sm leading-7 text-zinc-500">{text.cta.secondaryDescription}</p>
              <div className="mt-9 flex flex-wrap items-center gap-4">
                <a
                  className="inline-flex items-center gap-2 rounded-lg bg-white px-7 py-3 text-xs font-bold text-black transition-colors hover:bg-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  href="/download"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  {text.cta.downloadCta}
                </a>
                <a
                  className="inline-flex items-center gap-2 text-sm font-medium text-zinc-300 transition hover:text-white"
                  href="https://github.com/wemux-ai/wemux"
                  target="_blank"
                  rel="noreferrer"
                >
                  {localize({ zh: '在 GitHub 上查看', en: 'View on GitHub' }, language)}
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                </a>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-center">
              <AgentMascotVideo />
            </div>
          </div>
          <div className="relative mt-9 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.08] pt-4 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
            <span>{localize({ zh: 'Agent 与人类协作', en: 'Agents & humans collaborate' }, language)}</span>
            <span className="hidden h-1 w-1 rounded-full bg-emerald-400 sm:block" />
            <span>{localize({ zh: '人类设定目标', en: 'Humans set the goals' }, language)}</span>
            <span className="hidden h-1 w-1 rounded-full bg-emerald-400 sm:block" />
            <span>{localize({ zh: 'Agent 负责执行', en: 'Agents own execution' }, language)}</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function SiteFooter({ language, text }: { language: Language; text: LandingText }) {
  const footerLinkClass = 'text-sm text-zinc-500 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white'

  return (
    <footer className="border-t border-white/[0.07] bg-[#060607] px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-[1368px]">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.35fr)_repeat(3,minmax(0,0.72fr))] lg:gap-8">
          <div className="max-w-sm">
            <a className="inline-flex items-center gap-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white" href="#top">
              <img src="/logo.svg" alt="" className="h-8 w-8 shrink-0" />
              <span className="text-lg font-semibold tracking-[-0.04em]">Wemux</span>
            </a>
            <p className="mt-5 text-sm leading-7 text-zinc-400">{text.footer.summary}</p>
            <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600">
              {localize({ zh: '支持与合规', en: 'Support & compliance' }, language)}
            </p>
            <SupportEmailText className="mt-2 block text-sm text-zinc-300" />
          </div>

          <FooterLinkGroup title={localize({ zh: '产品', en: 'Product' }, language)}>
            <a className={footerLinkClass} href="#console">{localize({ zh: '工作控制台', en: 'Work console' }, language)}</a>
            <a className={footerLinkClass} href="#agents">{localize({ zh: 'Agent 角色', en: 'Agent roles' }, language)}</a>
            <a className={footerLinkClass} href="#workers">{localize({ zh: '执行节点', en: 'Workers' }, language)}</a>
            <a className={footerLinkClass} href="/pricing">{localize({ zh: '定价', en: 'Pricing' }, language)}</a>
          </FooterLinkGroup>

          <FooterLinkGroup title={localize({ zh: '资源', en: 'Resources' }, language)}>
            <a className={footerLinkClass} href="/docs/worker-install">{localize({ zh: '安装 Worker', en: 'Install a worker' }, language)}</a>
            <a className={footerLinkClass} href="/use-cases/ai-coding-delivery">{localize({ zh: '交付场景', en: 'Delivery use case' }, language)}</a>
            <a className={footerLinkClass} href="/faq">{localize({ zh: '常见问题', en: 'FAQ' }, language)}</a>
            <a className={footerLinkClass} href="/blog/why-ai-coding-needs-real-workstations">{localize({ zh: '产品观点', en: 'Product notes' }, language)}</a>
          </FooterLinkGroup>

          <FooterLinkGroup title={localize({ zh: '开放生态', en: 'Open ecosystem' }, language)}>
            <a className={footerLinkClass} href="https://github.com/wemux-ai/wemux" rel="noreferrer" target="_blank">GitHub</a>
            <CommunityLinkList language={language} className={footerLinkClass} />
          </FooterLinkGroup>
        </div>
        <div className="mt-12 flex flex-col gap-4 border-t border-white/[0.07] pt-5 font-mono text-[10px] tracking-[0.12em] text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
          <span>{localize({ zh: 'AI 原生组织操作系统', en: 'AI-native organization OS' }, language)}</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <a className="transition-colors hover:text-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-white" href="/privacy">
              {localize({ zh: '隐私政策', en: 'Privacy' }, language)}
            </a>
            <a className="transition-colors hover:text-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-white" href="/terms">
              {localize({ zh: '服务条款', en: 'Terms' }, language)}
            </a>
            <span>
              {localize({ zh: '构建者', en: 'Built by' }, language)}{' '}
              <a className="transition-colors hover:text-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-white" href="https://zijiekyro.com" rel="author" target="_blank">
                Zijie Kyro
              </a>
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}

function FooterLinkGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <nav aria-label={title} className="flex flex-col items-start gap-3">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">{title}</h2>
      {children}
    </nav>
  )
}

function WorkerMesh({ language, text }: { language: Language; text: LandingText }) {
  return (
    <Panel className="relative overflow-hidden p-5 sm:p-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.04),transparent_34%)]" />
      <div className="relative">
        <WorkerTopology language={language} text={text} />
        <div className="mt-6 flex items-center justify-center gap-4 text-[9px] uppercase tracking-[0.24em] text-zinc-600">
          <div className="h-px w-20 bg-white/10" />
          {text.workers.footer}
          <div className="h-px w-20 bg-white/10" />
        </div>
      </div>
    </Panel>
  )
}

function WorkerTopology({ language, text }: { language: Language; text: LandingText }) {
  return (
    <div className="relative min-h-[25rem] overflow-hidden rounded-xl border border-white/[0.08] bg-black/30 max-sm:min-h-0 max-sm:p-4">
      <MeshConnections />
      <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 max-sm:static max-sm:mb-4 max-sm:translate-x-0 max-sm:translate-y-0">
        <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full border border-white/20 bg-white/5 shadow-[0_0_60px_rgba(255,255,255,0.1)] backdrop-blur transition duration-300 hover:scale-105 hover:border-white/30">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.7)] animate-pulse" />
          <span className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white">Wemux</span>
          <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500">{text.workers.controlNode}</span>
        </div>
      </div>
      {workerNodes.map((node, index) => (
        <TopologyNode key={node.name} index={index} language={language} node={node} text={text} />
      ))}
    </div>
  )
}

function MeshConnections() {
  return (
    <svg aria-hidden="true" className="absolute inset-0 h-full w-full text-zinc-400/25 max-sm:hidden" preserveAspectRatio="none" viewBox="0 0 100 100">
      <line className="wemux-flow-line" stroke="currentColor" strokeDasharray="2 2" strokeWidth="0.5" vectorEffect="non-scaling-stroke" x1="50" x2="18" y1="50" y2="20" />
      <line className="wemux-flow-line" stroke="currentColor" strokeDasharray="2 2" strokeWidth="0.5" vectorEffect="non-scaling-stroke" x1="50" x2="82" y1="50" y2="22" />
      <line className="wemux-flow-line" stroke="currentColor" strokeDasharray="2 2" strokeWidth="0.5" vectorEffect="non-scaling-stroke" x1="50" x2="18" y1="50" y2="78" />
      <line className="wemux-flow-line" stroke="currentColor" strokeDasharray="2 2" strokeWidth="0.5" vectorEffect="non-scaling-stroke" x1="50" x2="82" y1="50" y2="78" />
      <line className="wemux-flow-line" stroke="currentColor" strokeDasharray="2 2" strokeWidth="0.5" vectorEffect="non-scaling-stroke" x1="50" x2="50" y1="50" y2="90" />
      <circle cx="50" cy="50" fill="currentColor" r="1.2" />
    </svg>
  )
}

function TopologyNode({
  index,
  language,
  node,
  text,
}: {
  index: number
  language: Language
  node: WorkerNode
  text: LandingText
}) {
  const position = topologyNodePositions[index] ?? topologyNodePositions[0]

  return (
    <div className={`absolute z-10 w-40 rounded-xl border border-white/[0.08] bg-[#08080a]/95 p-3 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur transition duration-300 hover:-translate-y-1 hover:border-white/40 hover:bg-[#101014] max-sm:static max-sm:mb-3 max-sm:w-full max-sm:translate-x-0 ${position}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="font-mono">
          <p className="text-[10px] uppercase tracking-[0.16em] text-white">{node.name}</p>
          <p className="mt-1 text-[9px] text-zinc-600">{node.ip}</p>
        </div>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full animate-pulse ${nodeStatusClasses[node.status]}`} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[9px] text-zinc-500">
        <span>{text.workers.memoryLabel}</span>
        <span className="text-right text-zinc-300">{node.memory}</span>
        <span>{text.workers.cpuLabel}</span>
        <span className="text-right text-zinc-300">{node.cpu}</span>
      </div>
      <p className="mt-3 truncate text-xs text-zinc-500">{localize(node.task, language)}</p>
    </div>
  )
}

function SectionIntro({
  description,
  eyebrow,
  kicker,
  title,
}: {
  description?: string
  eyebrow: string
  kicker?: string
  title: string
}) {
  return (
    <div className="max-w-4xl">
      <SectionEyebrow>{eyebrow}</SectionEyebrow>
      <h2 className="mt-4 text-balance text-4xl font-medium tracking-[-0.06em] text-white">{title}</h2>
      {kicker ? <p className="mt-3 text-balance text-sm text-zinc-300/70">{kicker}</p> : null}
      {description ? <p className="mt-5 max-w-3xl text-sm leading-7 text-zinc-400">{description}</p> : null}
    </div>
  )
}

function PainCard({ card }: { card: LandingText['pain']['cards'][number] }) {
  return (
    <Panel className="p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{card.eyebrow}</p>
      <h3 className="mt-4 text-xl font-medium tracking-[-0.04em] text-white">{card.title}</h3>
      <p className="mt-4 text-sm leading-7 text-zinc-500">{card.description}</p>
    </Panel>
  )
}

function PainMobileSupportPanel({
  mobileSupport,
}: {
  mobileSupport: LandingText['pain']['mobileSupport']
}) {
  return (
    <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.25fr)]">
      <Panel className="relative flex min-h-[35.5rem] flex-col overflow-hidden p-4 sm:p-5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_100%,rgba(255,255,255,0.03),transparent_32%)]" />
        <div className="relative">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{mobileSupport.eyebrow}</p>
          <h3 className="mt-4 max-w-xl text-balance text-[2rem] font-medium tracking-[-0.05em] text-white sm:text-[2.4rem]">
            {mobileSupport.title}
          </h3>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-zinc-300">{mobileSupport.description}</p>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-500">{mobileSupport.secondaryDescription}</p>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            {mobileSupport.quickActions.map((action, index) => (
              <MobileSupportQuickAction action={action} index={index} key={action} />
            ))}
          </div>
        </div>
        <div className="relative mt-5 flex flex-1 items-end">
          <div className="relative flex min-h-[18.5rem] w-full items-end justify-center overflow-hidden rounded-[1.45rem] border border-white/[0.08] bg-[radial-gradient(circle_at_50%_58%,rgba(255,255,255,0.04),transparent_26%),radial-gradient(circle_at_50%_82%,rgba(37,99,235,0.12),transparent_34%),linear-gradient(180deg,rgba(5,5,9,1)_0%,rgba(9,9,13,1)_100%)] p-3">
            <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:18px_18px]" />
            <MobileSupportPhone mobileSupport={mobileSupport} />
          </div>
        </div>
      </Panel>

      <div className="grid gap-6">
        <Panel className="relative min-h-[17rem] overflow-hidden p-4 sm:p-5 lg:p-6">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_18%,rgba(255,255,255,0.02),transparent_28%)]" />
          <div className="relative">
            <h3 className="max-w-3xl text-balance text-[2rem] font-medium tracking-[-0.05em] text-white sm:text-[2.4rem]">
              {mobileSupport.controlTitle}
            </h3>
            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              {mobileSupport.controlCards.map((card, index) => (
                <MobileSupportControlCard card={card} index={index} key={card.title} />
              ))}
            </div>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="flex min-h-[8rem] flex-col justify-center gap-3 p-5 sm:p-6">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">{mobileSupport.flowLabel}</p>
            <div className="flex flex-wrap items-center gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em]">
              {mobileSupport.flow.map((step, index) => (
                <span className="flex items-center" key={step}>
                  {index > 0 && <span className="mx-3 text-zinc-700">→</span>}
                  <span className={index === mobileSupport.flow.length - 1 ? 'text-emerald-300' : 'text-zinc-300'}>
                    {step}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function MobileSupportPhone({
  mobileSupport,
}: {
  mobileSupport: LandingText['pain']['mobileSupport']
}) {
  return (
    <div className="relative z-10 mx-auto w-full max-w-[12.1rem]">
      <div className="relative aspect-[9/19.5] rounded-[2.85rem] bg-[linear-gradient(180deg,#8d8f98_0%,#5a5d67_10%,#1c1f26_22%,#090b0f_100%)] p-[0.3rem] shadow-[0_28px_90px_rgba(0,0,0,0.58)]">
        <div className="pointer-events-none absolute inset-[0.22rem] rounded-[2.65rem] bg-[linear-gradient(135deg,rgba(255,255,255,0.3)_0%,rgba(255,255,255,0.04)_18%,transparent_36%,transparent_64%,rgba(255,255,255,0.06)_82%,rgba(255,255,255,0.18)_100%)] opacity-70" />

        <div className="relative h-full rounded-[2.56rem] border border-white/[0.08] bg-[#010203] p-[0.18rem] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          <div className="h-full overflow-hidden rounded-[2.36rem] bg-[linear-gradient(180deg,#0d1018_0%,#090b11_45%,#040506_100%)] p-[0.16rem]">
            <div className="relative h-full overflow-hidden rounded-[2.12rem] bg-[linear-gradient(180deg,rgba(14,16,25,0.99)_0%,rgba(10,10,14,1)_42%,rgba(5,5,7,1)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.08),transparent_58%)]" />
              <div className="absolute inset-x-0 top-[0.58rem] z-10 flex justify-center">
                <div className="flex h-6 w-[4.9rem] items-center justify-center rounded-full bg-black shadow-[0_8px_20px_rgba(0,0,0,0.45)]">
                  <div className="h-1.5 w-8 rounded-full bg-zinc-900" />
                  <div className="ml-1.5 h-1.5 w-1.5 rounded-full bg-zinc-950" />
                </div>
              </div>
              <div className="absolute right-[3.58rem] top-[0.9rem] z-10 h-1.5 w-1.5 rounded-full bg-white/20" />

              <div className="absolute inset-x-0 top-[0.9rem] z-10 flex items-center justify-between px-3 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-500">
                <span>09:41</span>
                <div className="flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
                  <span>5G</span>
                  <span>88%</span>
                </div>
              </div>

              <div className="flex h-full flex-col px-3 pb-3 pt-[2.85rem]">
                <div className="rounded-[1.1rem] border border-white/[0.08] bg-white/[0.04] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-zinc-400">{mobileSupport.liveLabel}</p>
                      <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.16em] text-zinc-500">{mobileSupport.deviceLabel}</p>
                    </div>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)] animate-pulse" />
                  </div>
                  <p className="mt-2.5 text-[10px] font-medium leading-4 text-white">{mobileSupport.liveTask}</p>
                  <p className="mt-2 text-[9px] leading-4 text-zinc-400">{mobileSupport.liveSummary}</p>
                </div>

                <div className="mt-2.5 rounded-[1.1rem] border border-white/[0.08] bg-black/30 p-3">
                  <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-zinc-500">{mobileSupport.actionsLabel}</p>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {mobileSupport.actions.map((action) => (
                      <div
                        className="rounded-[0.8rem] border border-white/[0.08] bg-white/[0.04] px-2 py-2 text-center text-[9px] font-medium text-zinc-200"
                        key={action}
                      >
                        {action}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-2.5 flex-1 rounded-[1.1rem] border border-white/[0.08] bg-black/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-zinc-500">{mobileSupport.updatesLabel}</p>
                    <span className="rounded-full border border-white/20 bg-white/10 px-2 py-1 font-mono text-[7px] uppercase tracking-[0.16em] text-zinc-300">
                      {mobileSupport.oversightLabel}
                    </span>
                  </div>
                  <div className="mt-2.5 rounded-[0.9rem] border border-white/[0.06] bg-[linear-gradient(180deg,rgba(39,39,42,0.2)_0%,rgba(255,255,255,0.03)_100%)] p-2.5">
                    <div className="flex h-8 items-end gap-1">
                      <span className="h-2 w-3 rounded-sm bg-white/70" />
                      <span className="h-2.5 w-3 rounded-sm bg-white/55" />
                      <span className="h-4 w-3 rounded-sm bg-white/85" />
                      <span className="h-6 w-3 rounded-sm bg-white" />
                      <span className="h-3 w-3 rounded-sm bg-white/60" />
                      <span className="h-5 w-3 rounded-sm bg-white/75" />
                      <span className="h-2.5 w-3 rounded-sm bg-white/45" />
                      <span className="h-4 w-3 rounded-sm bg-white/70" />
                    </div>
                  </div>
                  <div className="mt-2.5 space-y-2">
                    {mobileSupport.capabilities.map((capability) => (
                      <div
                        className="flex items-start gap-2 rounded-[0.85rem] border border-white/[0.06] bg-white/[0.03] px-2.5 py-2"
                        key={capability.title}
                      >
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)]" />
                        <div className="min-w-0">
                          <p className="text-[9px] font-medium leading-4 text-white">{capability.title}</p>
                          <p className="mt-0.5 text-[8px] leading-4 text-zinc-400">{capability.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-2.5 flex justify-center">
                  <div className="h-1 w-16 rounded-full bg-white/14" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MobileSupportQuickAction({ action, index }: { action: string; index: number }) {
  const kinds: Array<'task' | 'chat' | 'terminal' | 'git'> = ['task', 'chat', 'terminal', 'git']
  const kind = kinds[index] ?? 'task'

  return (
    <div className="flex min-h-[5.25rem] items-center gap-3 rounded-[1rem] border border-white/[0.08] bg-white/[0.04] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <MobileSupportGlyph kind={kind} />
      <span className="text-sm font-medium text-zinc-200">{action}</span>
    </div>
  )
}

function MobileSupportControlCard({
  card,
  index,
}: {
  card: LandingText['pain']['mobileSupport']['controlCards'][number]
  index: number
}) {
  return (
    <article>
      <div className="flex items-center gap-3">
        <MobileSupportGlyph kind={index === 0 ? 'branch' : 'review'} />
        <h4 className="text-xl font-medium tracking-[-0.04em] text-zinc-400">{card.title}</h4>
      </div>
      <p className="mt-4 max-w-xl text-sm leading-7 text-zinc-400">{card.description}</p>
    </article>
  )
}

function MobileSupportGlyph({ kind }: { kind: 'task' | 'chat' | 'terminal' | 'git' | 'logs' | 'branch' | 'review' }) {
  if (kind === 'task') {
    return (
      <svg aria-hidden="true" className="h-6 w-6 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24">
        <path d="M4 12a8 8 0 1 0 4-6.93" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="M4 4v4h4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="m9.5 12 1.8 1.8 4.2-4.3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    )
  }

  if (kind === 'logs') {
    return (
      <svg aria-hidden="true" className="h-6 w-6 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24">
        <path d="M5 5h9l5 5v9H5z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="M9 10h6M9 14h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        <path d="m5 5 6 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    )
  }

  if (kind === 'chat') {
    return (
      <svg aria-hidden="true" className="h-6 w-6 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24">
        <path d="M6 7.5A2.5 2.5 0 0 1 8.5 5h7A2.5 2.5 0 0 1 18 7.5v5A2.5 2.5 0 0 1 15.5 15H11l-3.5 3v-3H8.5A2.5 2.5 0 0 1 6 12.5z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    )
  }

  if (kind === 'terminal') {
    return (
      <svg aria-hidden="true" className="h-6 w-6 shrink-0 text-amber-300" fill="none" viewBox="0 0 24 24">
        <path d="m7 8 3 3-3 3M12.5 16H17M5 5h14v14H5z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    )
  }

  if (kind === 'git') {
    return (
      <svg aria-hidden="true" className="h-6 w-6 shrink-0 text-rose-300" fill="none" viewBox="0 0 24 24">
        <path d="M12 5v10m0-10a2 2 0 1 0-2-2m2 2a2 2 0 1 1 2-2m-2 12a2 2 0 1 0 2 2m-2-2a2 2 0 1 1-2 2m0-7h4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    )
  }

  if (kind === 'branch') {
    return (
      <svg aria-hidden="true" className="h-6 w-6 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24">
        <path d="M7 4v12m0 0 4-4m-4 4 4 4M17 8V4m0 0-3 3m3-3 3 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    )
  }

  return (
    <svg aria-hidden="true" className="h-6 w-6 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24">
      <path d="m7 12 3 3 7-7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M17 5h2v5M7 19H5v-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  )
}

const ctaAgent = {
  poster: '/agents/videos/agent-01-wave-alpha-v3-poster.png',
  src: '/agents/videos/agent-01-wave-alpha-v3.webm',
  tone: 'cyan' as const,
}

function AgentMascotVideo() {
  const selected = ctaAgent
  const glow = {
    blue: 'drop-shadow-[0_14px_28px_rgba(59,130,246,0.32)]',
    cyan: 'drop-shadow-[0_14px_28px_rgba(34,211,238,0.32)]',
    lime: 'drop-shadow-[0_14px_28px_rgba(114,255,92,0.36)]',
    violet: 'drop-shadow-[0_14px_28px_rgba(168,85,247,0.32)]',
    orange: 'drop-shadow-[0_14px_28px_rgba(249,115,22,0.34)]',
  }[selected.tone]

  return (
    <div className="relative flex h-44 w-44 items-end justify-center sm:h-56 sm:w-56">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-8 bottom-1 h-20 rounded-full bg-white/[0.04] blur-2xl" />
      <video
        aria-hidden="true"
        autoPlay
        className={`relative h-full w-full object-contain object-bottom ${glow}`}
        loop
        muted
        playsInline
        poster={selected.poster}
        preload="metadata"
      >
        <source src={selected.src} type="video/webm" />
      </video>
    </div>
  )
}

function AgentRoleCard({ language, role }: { language: Language; role: AgentRole }) {
  return (
    <Panel className="group p-6 transition hover:border-white/40 hover:bg-[#0d0b12]">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-lg font-medium tracking-[-0.04em] text-white">{role.name}</h3>
        <span className="h-2 w-2 rounded-full bg-white opacity-60 transition group-hover:opacity-100" />
      </div>
      <p className="mt-5 text-sm leading-7 text-zinc-300">
        {localize({ zh: role.summary, en: role.summaryEn }, language)}
      </p>
    </Panel>
  )
}

function ScenarioCard({ language, scenario }: { language: Language; scenario: Scenario }) {
  return (
    <Panel className="p-6">
      <h3 className="text-xl font-medium tracking-[-0.04em] text-white">
        {localize({ zh: scenario.title, en: scenario.titleEn }, language)}
      </h3>
      <p className="mt-5 text-sm leading-7 text-zinc-500">
        {localize({ zh: scenario.description, en: scenario.descriptionEn }, language)}
      </p>
    </Panel>
  )
}

function FaqItem({ answer, index, question }: { answer: string; index: number; question: string }) {
  const code = String(index).padStart(2, '0')

  return (
    <article className="group grid gap-4 py-6 sm:grid-cols-[4.5rem_1fr]">
      <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-400">FAQ-{code}</span>
      <div>
        <h3 className="text-xl font-medium tracking-[-0.04em] text-white transition group-hover:text-white">
          {question}
        </h3>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-500">{answer}</p>
      </div>
    </article>
  )
}

function localize(value: BilingualText, language: Language) {
  return value[language]
}

function SectionFrame({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`mx-auto max-w-[1440px] px-4 sm:px-6 ${className ?? ''}`} id={id}>
      {children}
    </section>
  )
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/[0.08] bg-[#0a0a0a] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${className ?? ''}`}>
      {children}
    </div>
  )
}

function SectionEyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-600">{children}</p>
}
