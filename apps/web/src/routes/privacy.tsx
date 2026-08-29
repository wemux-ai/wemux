// [INPUT]: 隐私请求
// [OUTPUT]: 隐私页
// [POS]: 隐私页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { requireIndexedMarketingPage } from '@shared/site-seo'
import { MarketingPageLayout, MarketingSection } from '../components/marketing/marketing-page-layout'
import { buildMarketingHead, buildPageUrl, marketingSite } from '../lib/marketing-site'

const seoPage = requireIndexedMarketingPage('/privacy')

const sections: Array<{ body: ReactNode; title: string }> = [
  {
    body: 'Wemux is an AI delivery platform that helps users route tasks into workers, coordinate execution, and review outputs. To operate the service we may process account details, workspace metadata, task content, execution logs, repository connection details, and service usage records.',
    title: '1. Scope',
  },
  {
    body: 'We may collect information you provide directly, such as account identity, team membership, billing-related identifiers, and support requests. We also process operational data needed to run the platform, including worker status, task routing metadata, review state, and execution artifacts generated through the service.',
    title: '2. Data we process',
  },
  {
    body: 'We use this information to authenticate users, operate shared workspaces, route execution to the correct worker, provide audit trails, process billing-related flows, detect abuse, and improve platform reliability. We do not need repository contents or execution artifacts beyond what is required to provide the workflow you invoke.',
    title: '3. How we use data',
  },
  {
    body: 'Billing-related checkout and subscription flows, when enabled, may be handled by authorized service providers acting on our behalf. Authentication, infrastructure hosting, storage, and communications may also rely on third-party providers. Each provider processes only the information needed for its operational role.',
    title: '4. Service providers',
  },
  {
    body: 'Execution logs, workspace activity, and related artifacts may be retained for reliability, debugging, and review history. Retention periods can vary by environment, workspace usage, and operational needs. We may delete or anonymize data when it is no longer needed to provide the service or comply with legal obligations.',
    title: '5. Retention',
  },
  {
    body: (
      <>
        If you have questions about this policy or need to discuss privacy-related requests, contact Wemux at <span>support</span>
        <span>@</span>
        <span>wemux.ai</span>.
      </>
    ),
    title: '6. Contact',
  },
]

export const Route = createFileRoute('/privacy')({
  head: () => {
    const structuredData = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          description: seoPage.description,
          name: seoPage.title,
          url: buildPageUrl('/privacy'),
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
              item: buildPageUrl('/privacy'),
              name: 'Privacy Policy',
              position: 2,
            },
          ],
        },
      ],
    }

    return buildMarketingHead({
      description: seoPage.description,
      path: '/privacy',
      structuredData,
      title: seoPage.title,
    })
  },
  component: PrivacyRoute,
})

function PrivacyRoute() {
  return (
    <MarketingPageLayout
      description="This policy explains, at a public high level, how Wemux processes account, workspace, execution, and billing-adjacent data while operating the AI delivery platform."
      eyebrow="Privacy Policy"
      title="How Wemux handles platform data."
    >
      <MarketingSection
        description="This page is a public-facing overview for website visitors, prospective customers, and payment compliance review."
        title="Policy overview"
      >
        <div className="space-y-6">
          {sections.map((section) => (
            <article key={section.title}>
              <h2 className="text-xl font-medium tracking-[-0.03em] text-white">{section.title}</h2>
              <p className="mt-3 max-w-4xl text-sm leading-7 text-zinc-400">{section.body}</p>
            </article>
          ))}
        </div>
      </MarketingSection>
    </MarketingPageLayout>
  )
}
