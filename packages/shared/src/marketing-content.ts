// [INPUT]: 营销内容输入
// [OUTPUT]: 内容文档
// [POS]: 营销内容模型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { z } from 'zod'
import marketingContentJson from './marketing-content.json'
import { getMarketingTopicBySlug } from './marketing-topics'

export const marketingCollections = ['blog', 'compare', 'use-cases'] as const

export type MarketingContentCollection = (typeof marketingCollections)[number]

export type MarketingContentEntry = {
  author: string
  authorUrl?: string
  collection: MarketingContentCollection
  description: string
  eyebrow: string
  featured: boolean
  heroDescription: string
  heroTitle: string
  imageAlt: string
  imagePath: string
  keyClaim: string
  order: number
  path: string
  pointOfView: string
  publishedAt: string
  relatedPaths: string[]
  slug: string
  status: 'draft' | 'published'
  title: string
  topicSlugs: string[]
  updatedAt: string
}

const marketingContentEntrySchema = z.object({
  author: z.string().min(1),
  authorUrl: z.string().url().optional(),
  collection: z.enum(marketingCollections),
  description: z.string().min(1),
  eyebrow: z.string().min(1),
  featured: z.boolean(),
  heroDescription: z.string().min(1),
  heroTitle: z.string().min(1),
  imageAlt: z.string().min(1),
  imagePath: z.string().regex(/^\/.+/),
  keyClaim: z.string().min(12),
  order: z.number().int().nonnegative(),
  path: z.string().regex(/^\/.+/),
  pointOfView: z.string().min(12),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  relatedPaths: z.array(z.string().regex(/^\/.+/)),
  slug: z.string().min(1),
  status: z.enum(['draft', 'published']),
  title: z.string().min(1),
  topicSlugs: z.array(z.string().min(1)).min(1),
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const marketingContentEntries = z.array(marketingContentEntrySchema).parse(marketingContentJson) as MarketingContentEntry[]

const marketingContentPathSet = new Set(marketingContentEntries.map((entry) => entry.path))

for (const entry of marketingContentEntries) {
  for (const topicSlug of entry.topicSlugs) {
    if (!getMarketingTopicBySlug(topicSlug)) {
      throw new Error(`Unknown marketing topic slug "${topicSlug}" in ${entry.path}`)
    }
  }

  for (const relatedPath of entry.relatedPaths) {
    if (!marketingContentPathSet.has(relatedPath) && relatedPath !== '/docs/worker-install') {
      throw new Error(`Unknown related marketing path "${relatedPath}" in ${entry.path}`)
    }
  }
}

const marketingContentPathMap = new Map(
  marketingContentEntries.map((entry) => [entry.path, entry] satisfies [string, MarketingContentEntry]),
)

const sortMarketingContentEntries = (entries: MarketingContentEntry[]) => [...entries].sort((left, right) => {
  if (left.order !== right.order) {
    return left.order - right.order
  }

  if (left.publishedAt !== right.publishedAt) {
    return right.publishedAt.localeCompare(left.publishedAt)
  }

  return left.path.localeCompare(right.path)
})

const marketingContentCollectionMap = new Map<MarketingContentCollection, MarketingContentEntry[]>(
  marketingCollections.map((collection) => [collection, sortMarketingContentEntries(marketingContentEntries.filter((entry) => entry.collection === collection))]),
)

export function listMarketingContentEntries() {
  return sortMarketingContentEntries(marketingContentEntries)
}

export function listPublishedMarketingContentEntries() {
  return listMarketingContentEntries().filter((entry) => entry.status === 'published')
}

export function listMarketingContentEntriesByCollection(collection: MarketingContentCollection) {
  return marketingContentCollectionMap.get(collection) ?? []
}

export function listPublishedMarketingContentEntriesByCollection(collection: MarketingContentCollection) {
  return listMarketingContentEntriesByCollection(collection).filter((entry) => entry.status === 'published')
}

export function getMarketingContentEntryByPath(path: string) {
  return marketingContentPathMap.get(path) ?? null
}

export function getMarketingContentEntryByCollectionSlug(collection: MarketingContentCollection, slug: string) {
  return listMarketingContentEntriesByCollection(collection).find((entry) => entry.slug === slug) ?? null
}

export function listMarketingContentEntriesByTopic(topicSlug: string) {
  return sortMarketingContentEntries(marketingContentEntries.filter((entry) => entry.topicSlugs.includes(topicSlug)))
}

export function listPublishedMarketingContentEntriesByTopic(topicSlug: string) {
  return listMarketingContentEntriesByTopic(topicSlug).filter((entry) => entry.status === 'published')
}

export function listFeaturedMarketingContentEntriesByCollection(collection: MarketingContentCollection) {
  return listPublishedMarketingContentEntriesByCollection(collection).filter((entry) => entry.featured)
}
