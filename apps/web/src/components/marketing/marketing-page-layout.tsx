import type { ReactNode } from 'react'

type MarketingPageLayoutProps = {
  children: ReactNode
  description: string
  eyebrow: string
  title: string
}

type MarketingSectionProps = {
  children: ReactNode
  description?: ReactNode
  title: string
}

const marketingLinks = [
  { href: '/', label: 'Home' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/faq', label: 'FAQ' },
  { href: '/topics', label: 'Topics' },
  { href: '/compare/ai-chat-vs-ai-delivery', label: 'Chat vs Delivery' },
  { href: '/use-cases', label: 'Use Cases' },
  { href: '/docs/worker-install', label: 'Worker Install' },
  { href: '/blog', label: 'Blog' },
  { href: '/login', label: 'Login' },
]

export function MarketingPageLayout({ children, description, eyebrow, title }: MarketingPageLayoutProps) {
  return (
    <main className="min-h-screen bg-[#050507] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,rgba(124,58,237,0.18),transparent_28%),linear-gradient(180deg,rgba(10,10,14,0.96)_0%,rgba(5,5,7,1)_100%)]" />
      <div className="relative">
        <header className="border-b border-white/[0.08] bg-black/70 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-4 sm:px-6">
            <a className="font-mono text-[11px] font-black uppercase tracking-[0.2em] text-white" href="/">
              Wemux
            </a>
            <nav className="flex flex-wrap items-center justify-end gap-4 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {marketingLinks.map((link) => (
                <a className="transition hover:text-white" href={link.href} key={link.href}>
                  {link.label}
                </a>
              ))}
            </nav>
          </div>
        </header>

        <section className="mx-auto max-w-6xl px-4 pb-14 pt-16 sm:px-6 sm:pb-20 sm:pt-24">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">{eyebrow}</p>
          <h1 className="mt-5 max-w-4xl text-balance text-4xl font-medium tracking-[-0.06em] text-white sm:text-6xl">
            {title}
          </h1>
          <p className="mt-6 max-w-3xl text-balance text-base leading-8 text-zinc-300">
            {description}
          </p>
        </section>

        <div className="mx-auto max-w-6xl space-y-6 px-4 pb-16 sm:px-6 sm:pb-24">
          {children}
        </div>

        <footer className="mx-auto max-w-6xl border-t border-white/[0.08] px-4 pb-10 pt-6 sm:px-6 sm:pb-14">
          <div className="flex flex-col gap-2 text-sm text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Built by{' '}
              <a className="underline decoration-white/20 underline-offset-4 transition hover:text-zinc-200 hover:decoration-white/40" href="https://zijiekyro.com" rel="author" target="_blank">
                Zijie Kyro
              </a>
              {' · '}
              <a className="underline decoration-white/20 underline-offset-4 transition hover:text-zinc-200 hover:decoration-white/40" href="https://zijiekyro.com" rel="author" target="_blank">
                zijiekyro.com
              </a>
            </span>
            <span>Contact Wemux for support and compliance questions.</span>
            <SupportEmailText className="text-zinc-200" />
          </div>
        </footer>
      </div>
    </main>
  )
}

export function SupportEmailText({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span>support</span>
      <span>@</span>
      <span>wemux.ai</span>
    </span>
  )
}

export function MarketingSection({ children, description, title }: MarketingSectionProps) {
  return (
    <section className="border border-white/[0.08] bg-white/[0.02] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:p-8">
      <h2 className="text-2xl font-medium tracking-[-0.04em] text-white sm:text-3xl">{title}</h2>
      {description ? <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-400">{description}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  )
}
