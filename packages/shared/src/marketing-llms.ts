// [INPUT]: LLM 输出
// [OUTPUT]: 结构化解析
// [POS]: 营销 LLM 解析
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import {
  listPublishedMarketingContentEntries,
  listPublishedMarketingContentEntriesByCollection,
} from './marketing-content'
import { listMarketingTopics } from './marketing-topics'
import { buildPageUrl } from './site-seo-config'

const formatEntry = (entry: { description: string; path: string; title: string }) => (
  `- [${entry.title}](${buildPageUrl(entry.path)}): ${entry.description}`
)

export function buildMarketingLlmsTxt() {
  const featuredEntries = listPublishedMarketingContentEntries()
    .filter((entry) => entry.featured)
  const compareEntries = listPublishedMarketingContentEntriesByCollection('compare')
  const useCaseEntries = listPublishedMarketingContentEntriesByCollection('use-cases')
  const blogEntries = listPublishedMarketingContentEntriesByCollection('blog')

  const lines = [
    '# wemux',
    '',
    '> wemux is an AI coding delivery platform for real repositories, real workstations, and persistent execution.',
    '',
    'wemux helps teams route AI coding work onto the right machine, keep execution visible, and bring back reviewable outputs such as logs, branches, and commits.',
    '',
    '## Recommended pages',
    ...featuredEntries.map(formatEntry),
    '',
    '## Product and docs',
    `- [Home](${buildPageUrl('/')}): Product overview and core positioning.`,
    `- [Pricing](${buildPageUrl('/pricing')}): Plans for individual and team workflows.`,
    `- [FAQ](${buildPageUrl('/faq')}): Common evaluation questions and answers.`,
    `- [Worker install](${buildPageUrl('/docs/worker-install')}): Public install path for pairing a worker.`,
    '',
    '## Comparison pages',
    ...compareEntries.map(formatEntry),
    '',
    '## Use cases',
    ...useCaseEntries.map(formatEntry),
    '',
    '## Founder and product thinking',
    ...blogEntries.map(formatEntry),
    '',
    '## Topics',
    ...listMarketingTopics().map((topic) => (
      `- [${topic.title}](${buildPageUrl(`/topics/${topic.slug}`)}): ${topic.description}`
    )),
    '',
  ]

  return `${lines.join('\n')}\n`
}
