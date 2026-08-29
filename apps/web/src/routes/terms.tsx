// [INPUT]: 条款请求
// [OUTPUT]: 条款页
// [POS]: 条款页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { requireIndexedMarketingPage } from '@shared/site-seo'
import { MarketingPageLayout, MarketingSection } from '../components/marketing/marketing-page-layout'
import { buildMarketingHead, buildPageUrl, marketingSite } from '../lib/marketing-site'

const seoPage = requireIndexedMarketingPage('/terms')

const sections: Array<{ body: ReactNode; title: string }> = [
  {
    body: 'By accessing Wemux you agree to use the service in accordance with applicable law and these terms. Wemux is intended for legitimate software delivery, workflow coordination, and related team operations.',
    title: '1. Acceptance and permitted use',
  },
  {
    body: 'You are responsible for the accounts, repositories, workers, credentials, and environments you connect to Wemux. You must have the right to use the code, infrastructure, and data you route through the platform.',
    title: '2. Your responsibilities',
  },
  {
    body: 'You may not use Wemux for fraud, abuse, malware, credential theft, harassment, deceptive behavior, or any workflow that violates third-party rights or applicable law. We may suspend access where misuse, security risk, or policy violations are detected.',
    title: '3. Prohibited conduct',
  },
  {
    body: 'Paid plans, if enabled for your account, are billed according to the plan and billing terms presented before checkout. Subscriptions, renewals, taxes, refunds, and cancellation rules may depend on the specific billing flow presented at purchase time and the applicable billing provider terms. Usage-based features, when available, are measured and charged according to the terms shown in the product or agreed with your account.',
    title: '4. Billing and subscriptions',
  },
  {
    body: 'Wemux may still be evolving, including beta or rapidly changing features. Availability, features, routing logic, and interfaces may change over time. We may modify, limit, or discontinue features when required for product, security, or operational reasons.',
    title: '5. Beta and service changes',
  },
  {
    body: 'To the extent permitted by law, Wemux is provided on an as-is and as-available basis. You remain responsible for reviewing outputs, code changes, worker execution, and any downstream actions before relying on them in production.',
    title: '6. Warranty and review responsibility',
  },
  {
    body: (
      <>
        If you have questions about commercial use or these terms, contact Wemux at <span>support</span>
        <span>@</span>
        <span>wemux.ai</span>.
      </>
    ),
    title: '7. Contact',
  },
]

export const Route = createFileRoute('/terms')({
  head: () => {
    const structuredData = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          description: seoPage.description,
          name: seoPage.title,
          url: buildPageUrl('/terms'),
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
              item: buildPageUrl('/terms'),
              name: 'Terms of Service',
              position: 2,
            },
          ],
        },
      ],
    }

    return buildMarketingHead({
      description: seoPage.description,
      path: '/terms',
      structuredData,
      title: seoPage.title,
    })
  },
  component: TermsRoute,
})

function TermsRoute() {
  return (
    <MarketingPageLayout
      description="This page provides a public summary of the terms that govern access to Wemux, including platform use, billing, acceptable behavior, and review responsibility."
      eyebrow="Terms of Service"
      title="Public terms for using Wemux."
    >
      <MarketingSection
        description="This public version is intended to make the platform's baseline commercial and acceptable-use framing visible before signup or payment."
        title="Terms overview"
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
