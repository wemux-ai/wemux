import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

import { listMarketingContentEntries, marketingCollections, type MarketingContentEntry } from '../packages/shared/src/marketing-content'
import { listMarketingTopics } from '../packages/shared/src/marketing-topics'

type CheckIssue = {
  message: string
  severity: 'error' | 'warning'
}

const projectRoot = process.cwd()
const contentRoot = path.join(projectRoot, 'apps/web/src/content')
const imageRoot = path.join(projectRoot, 'apps/web/public')

function wordCount(markdown: string) {
  return markdown
    .replace(/[`*_>#-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .length
}

function buildMarkdownPath(entry: MarketingContentEntry) {
  return path.join(contentRoot, entry.collection, `${entry.slug}.md`)
}

function buildImagePath(entry: MarketingContentEntry) {
  return path.join(imageRoot, entry.imagePath.replace(/^\//, ''))
}

async function pathExists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function collectEntryIssues(entry: MarketingContentEntry) {
  const issues: CheckIssue[] = []
  const markdownPath = buildMarkdownPath(entry)
  const imagePath = buildImagePath(entry)

  if (!(await pathExists(markdownPath))) {
    issues.push({
      severity: 'error',
      message: `${entry.path}: missing markdown file at ${path.relative(projectRoot, markdownPath)}`,
    })
  } else {
    const markdown = await readFile(markdownPath, 'utf8')
    const contentWordCount = wordCount(markdown)

    if (!markdown.trim()) {
      issues.push({
        severity: 'error',
        message: `${entry.path}: markdown body is empty`,
      })
    }

    if (contentWordCount < 180) {
      issues.push({
        severity: 'warning',
        message: `${entry.path}: markdown body is short (${contentWordCount} words)`,
      })
    }
  }

  if (!(await pathExists(imagePath))) {
    issues.push({
      severity: 'error',
      message: `${entry.path}: missing image asset at ${path.relative(projectRoot, imagePath)}`,
    })
  }

  if (entry.relatedPaths.includes(entry.path)) {
    issues.push({
      severity: 'error',
      message: `${entry.path}: relatedPaths must not include itself`,
    })
  }

  if (entry.title.length < 35 || entry.title.length > 70) {
    issues.push({
      severity: 'warning',
      message: `${entry.path}: title length ${entry.title.length} is outside the preferred 35-70 range`,
    })
  }

  if (entry.description.length < 110 || entry.description.length > 170) {
    issues.push({
      severity: 'warning',
      message: `${entry.path}: description length ${entry.description.length} is outside the preferred 110-170 range`,
    })
  }

  if (entry.imageAlt.length < 20) {
    issues.push({
      severity: 'warning',
      message: `${entry.path}: imageAlt is very short`,
    })
  }

  if (entry.updatedAt < entry.publishedAt) {
    issues.push({
      severity: 'error',
      message: `${entry.path}: updatedAt must be on or after publishedAt`,
    })
  }

  return issues
}

async function main() {
  const entries = listMarketingContentEntries()
  const issues: CheckIssue[] = []
  const publishedEntries = entries.filter((entry) => entry.status === 'published')
  const pathSet = new Set<string>()
  const collectionSlugSet = new Set<string>()

  for (const entry of entries) {
    const collectionSlugKey = `${entry.collection}:${entry.slug}`

    if (pathSet.has(entry.path)) {
      issues.push({
        severity: 'error',
        message: `${entry.path}: duplicate content path`,
      })
    }
    pathSet.add(entry.path)

    if (collectionSlugSet.has(collectionSlugKey)) {
      issues.push({
        severity: 'error',
        message: `${entry.path}: duplicate collection + slug pair`,
      })
    }
    collectionSlugSet.add(collectionSlugKey)

    issues.push(...await collectEntryIssues(entry))
  }

  for (const collection of marketingCollections) {
    const collectionEntries = publishedEntries.filter((entry) => entry.collection === collection)
    if (collectionEntries.length === 0) {
      issues.push({
        severity: 'warning',
        message: `${collection}: no published entries in this collection`,
      })
    }

    if (collectionEntries.length > 0 && !collectionEntries.some((entry) => entry.featured)) {
      issues.push({
        severity: 'warning',
        message: `${collection}: no featured published entry`,
      })
    }
  }

  for (const topic of listMarketingTopics()) {
    const topicEntries = publishedEntries.filter((entry) => entry.topicSlugs.includes(topic.slug))
    if (topicEntries.length === 0) {
      issues.push({
        severity: 'warning',
        message: `${topic.slug}: topic has no published entries`,
      })
    }
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length

  console.log(`SEO content check: ${entries.length} entries, ${publishedEntries.length} published, ${warningCount} warnings, ${errorCount} errors`)

  for (const issue of issues) {
    const prefix = issue.severity === 'error' ? 'ERROR' : 'WARN'
    console.log(`${prefix} ${issue.message}`)
  }

  if (errorCount > 0) {
    process.exitCode = 1
    return
  }

  console.log('SEO content check passed without structural errors.')
}

await main()
