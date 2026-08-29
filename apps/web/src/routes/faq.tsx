// [INPUT]: FAQ 请求
// [OUTPUT]: FAQ 页
// [POS]: FAQ 页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { requireIndexedMarketingPage } from '@shared/site-seo'
import { MarketingPageLayout, MarketingSection } from '../components/marketing/marketing-page-layout'
import { buildMarketingHead, buildPageUrl, marketingSite } from '../lib/marketing-site'

const faqItems = [
  {
    answer: 'No. Wemux does not try to replace your existing models or agent runtimes. It gives teams a control surface to route work into real repositories and real workstations, then bring back logs, branches, commits, and reviewable results.',
    question: 'Is Wemux just another AI chat tool?',
  },
  {
    answer: 'Teams using AI coding in production usually hit the same last-mile issues: tasks stay in chats, the wrong machine owns the environment, Git identity becomes messy, and nobody can review what actually happened. Wemux is built for that execution layer.',
    question: 'Who is Wemux for?',
  },
  {
    answer: 'Workers can run on local Macs, Linux boxes, shared office machines, or cloud VMs. The point is not where the agent thinks. The point is where the work can safely execute with the right repository, environment, and permissions.',
    question: 'Where do workers run?',
  },
  {
    answer: 'Wemux keeps humans in charge. Agents can execute, retry, and report, but final confirmation, takeover, and approval stay with the team. It is an orchestration and delivery console, not an autonomy fantasy.',
    question: 'Does Wemux fully automate software delivery?',
  },
  {
    answer: 'Because teams need more than a text reply. They need task routing, isolated workspaces, execution logs, branch outputs, and a review path that fits real engineering workflows.',
    question: 'Why not keep everything in a chat interface?',
  },
  {
    answer: 'No. Software delivery is the first wedge, but the same control plane can run research, QA, documentation, launch checklists, and recurring operations work that needs traceable execution.',
    question: 'Is Wemux only for coding?',
  },
]

const seoPage = requireIndexedMarketingPage('/faq')
const { title, description } = seoPage

export const Route = createFileRoute('/faq')({
  head: () => {
    const structuredData = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'FAQPage',
          mainEntity: faqItems.map((item) => ({
            '@type': 'Question',
            acceptedAnswer: {
              '@type': 'Answer',
              text: item.answer,
            },
            name: item.question,
          })),
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            {
              '@type': 'ListItem',
              item: marketingSite.homeUrl,
              name: 'Home',
              position: 1,
            },
            {
              '@type': 'ListItem',
              item: buildPageUrl('/faq'),
              name: 'FAQ',
              position: 2,
            },
          ],
        },
      ],
    }

    return buildMarketingHead({
      description,
      path: '/faq',
      structuredData,
      title,
    })
  },
  component: FaqRoute,
})

function FaqRoute() {
  return (
    <MarketingPageLayout
      description="This page answers the first questions engineering teams ask when they move from AI demos to a real delivery workflow."
      eyebrow="Wemux FAQ"
      title="Questions teams ask before they trust AI coding in a real repo."
    >
      <MarketingSection
        description="The FAQ is written for engineering leads and operators evaluating how AI work should move from prompt output to auditable delivery."
        title="Core answers"
      >
        <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
          {faqItems.map((item) => (
            <article className="py-6" key={item.question}>
              <h3 className="text-xl font-medium tracking-[-0.03em] text-white">{item.question}</h3>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-400">{item.answer}</p>
            </article>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection
        description="These links are the next step for teams that already know the pain and want the product framing behind it."
        title="Related pages"
      >
        <div className="flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-[0.18em]">
          <a className="border border-white/[0.12] px-4 py-3 text-zinc-300 transition hover:border-white/30 hover:text-white" href="/">
            Return to homepage
          </a>
          <a
            className="border border-white/[0.12] px-4 py-3 text-zinc-300 transition hover:border-white/30 hover:text-white"
            href="/compare/ai-chat-vs-ai-delivery"
          >
            Read chat vs delivery
          </a>
          <a className="border border-white/[0.12] px-4 py-3 text-zinc-300 transition hover:border-white/30 hover:text-white" href="/docs/worker-install">
            See worker install
          </a>
          <a className="border border-white/[0.12] px-4 py-3 text-zinc-300 transition hover:border-white/30 hover:text-white" href="/use-cases/ai-coding-delivery">
            AI coding delivery
          </a>
          <a className="bg-violet-600 px-4 py-3 text-white transition hover:bg-violet-500" href="/login">
            Book a demo
          </a>
        </div>
      </MarketingSection>
    </MarketingPageLayout>
  )
}
