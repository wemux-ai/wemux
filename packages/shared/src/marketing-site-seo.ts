// [INPUT]: SEO 输入
// [OUTPUT]: SEO 配置
// [POS]: 营销站点 SEO
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { getMarketingContentEntryByPath, listPublishedMarketingContentEntries, listPublishedMarketingContentEntriesByTopic } from './marketing-content'
import { listMarketingTopics } from './marketing-topics'
import { siteSeoLastUpdated } from './site-seo-config'

export type IndexedMarketingPage = {
  changeFrequency: 'weekly'
  description: string
  lastModified: string
  path: string
  priority: number
  title: string
}

const staticIndexedMarketingPages = [
  {
    path: '/pricing',
    title: 'wemux Pricing for Pro and Team Workflows',
    description: 'Public wemux pricing for Free, Pro, and Team plans, including monthly plan differences and what each tier unlocks before checkout.',
    lastModified: siteSeoLastUpdated,
    changeFrequency: 'weekly',
    priority: 0.8,
  },
  {
    path: '/privacy',
    title: 'wemux Privacy Policy',
    description: 'How wemux handles account data, repositories, execution logs, worker metadata, and communications for the AI delivery platform.',
    lastModified: siteSeoLastUpdated,
    changeFrequency: 'weekly',
    priority: 0.6,
  },
  {
    path: '/terms',
    title: 'wemux Terms of Service',
    description: 'The public terms for accessing wemux, including acceptable use, billing, beta limitations, and responsibilities when running AI delivery workflows.',
    lastModified: siteSeoLastUpdated,
    changeFrequency: 'weekly',
    priority: 0.6,
  },
  {
    path: '/',
    title: 'wemux - The AI-Native Operating System for Your Organization',
    description: 'wemux is the AI-native operating system for your organization: plan tasks on a distributed kanban board, command agent teams, route workers, track execution, and review results across teams, projects, and organizations.',
    lastModified: siteSeoLastUpdated,
    changeFrequency: 'weekly',
    priority: 1.0,
  },
  {
    path: '/faq',
    title: 'wemux FAQ for AI Coding Teams',
    description: 'Answers for teams evaluating wemux: what it does, where workers run, why it is not another AI chat demo, and how it fits real delivery workflows.',
    lastModified: siteSeoLastUpdated,
    changeFrequency: 'weekly',
    priority: 0.8,
  },
  {
    path: '/blog',
    title: 'wemux Blog',
    description: 'wemux founder notes and SEO articles about AI coding delivery, persistent execution, remote handoff, and real workstation workflows.',
    lastModified: siteSeoLastUpdated,
    changeFrequency: 'weekly',
    priority: 0.7,
  },
  {
    path: '/compare',
    title: 'wemux Compare Pages',
    description: 'Comparison pages that explain the gap between AI chat output and accountable AI delivery workflows.',
    lastModified: siteSeoLastUpdated,
    changeFrequency: 'weekly',
    priority: 0.7,
  },
  {
    path: '/download',
    title: 'Download the wemux Desktop App',
    description: 'Download the wemux desktop client for macOS, Windows, and Linux, with version info and release notes for the current build.',
    lastModified: siteSeoLastUpdated,
    changeFrequency: 'weekly',
    priority: 0.8,
  },
  {
    path: '/docs/worker-install',
    title: 'Install a wemux Worker and Complete Your First Pairing',
    description: 'The shortest public wemux worker install path for beta users: generate a connect command, run it on the target machine, and finish the first task flow.',
    lastModified: siteSeoLastUpdated,
    changeFrequency: 'weekly',
    priority: 0.8,
  },
  {
    path: '/use-cases',
    title: 'wemux Use Cases',
    description: 'Use-case pages for AI coding delivery, multi-agent orchestration, and small engineering team workflows.',
    lastModified: siteSeoLastUpdated,
    changeFrequency: 'weekly',
    priority: 0.7,
  },
  {
    path: '/topics',
    title: 'wemux SEO Topics',
    description: 'Topic hubs that connect wemux blog posts, compare pages, and use cases into coherent AI coding SEO clusters.',
    lastModified: siteSeoLastUpdated,
    changeFrequency: 'weekly',
    priority: 0.7,
  },
] satisfies IndexedMarketingPage[]

const contentIndexedMarketingPages = listPublishedMarketingContentEntries().map((entry) => ({
  path: entry.path,
  title: entry.title,
  description: entry.description,
  lastModified: entry.updatedAt,
  changeFrequency: 'weekly',
  priority: entry.collection === 'blog' ? 0.7 : 0.8,
})) satisfies IndexedMarketingPage[]

const topicIndexedMarketingPages = listMarketingTopics().map((topic) => ({
  path: `/topics/${topic.slug}`,
  title: `${topic.title} | wemux Topic`,
  description: topic.description,
  lastModified: listPublishedMarketingContentEntriesByTopic(topic.slug)
    .map((entry) => entry.updatedAt)
    .sort()
    .at(-1) || siteSeoLastUpdated,
  changeFrequency: 'weekly',
  priority: 0.7,
})) satisfies IndexedMarketingPage[]

const indexedMarketingPages = [...staticIndexedMarketingPages, ...contentIndexedMarketingPages, ...topicIndexedMarketingPages]

const indexedMarketingPageMap = new Map(
  indexedMarketingPages.map((page) => [page.path, page] satisfies [string, IndexedMarketingPage]),
)

export function listSeoIndexedMarketingPages() {
  return indexedMarketingPages
}

export function getSeoIndexedMarketingPage(path: string) {
  return indexedMarketingPageMap.get(path) ?? null
}

export function getMarketingContentSeoPage(path: string) {
  const entry = getMarketingContentEntryByPath(path)
  if (!entry) {
    return null
  }

  return getSeoIndexedMarketingPage(entry.path)
}
