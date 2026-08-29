import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { listMarketingContentEntries, type MarketingContentEntry } from '../packages/shared/src/marketing-content'

type LintIssue = {
  message: string
  severity: 'error' | 'warning'
}

const projectRoot = process.cwd()
const contentRoot = path.join(projectRoot, 'apps/web/src/content')
const stopWords = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'into', 'when', 'your', 'from', 'they', 'them', 'than', 'then', 'their',
  'have', 'will', 'would', 'there', 'which', 'what', 'where', 'while', 'about', 'across', 'should', 'could', 'because',
  'inside', 'outside', 'after', 'before', 'being', 'become', 'through', 'team', 'teams', 'work', 'works', 'workflow',
  'platform', 'platforms', 'coding', 'agent', 'agents', 'ai', 'wemux',
])

function buildMarkdownPath(entry: MarketingContentEntry) {
  return path.join(contentRoot, entry.collection, `${entry.slug}.md`)
}

function normalizeWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !stopWords.has(word))
}

function buildWordSet(text: string) {
  return new Set(normalizeWords(text))
}

function jaccardSimilarity(left: Set<string>, right: Set<string>) {
  const intersection = [...left].filter((word) => right.has(word)).length
  const union = new Set([...left, ...right]).size
  return union === 0 ? 0 : intersection / union
}

function hasWeakClaimLanguage(value: string) {
  const normalized = value.toLowerCase()
  return normalized.includes('better fit')
    || normalized.includes('more relevant')
    || normalized.includes('strong fit')
    || normalized.includes('can be enough')
}

async function main() {
  const entries = listMarketingContentEntries()
  const issues: LintIssue[] = []
  const markdownByPath = new Map<string, string>()
  const wordSets = new Map<string, Set<string>>()

  for (const entry of entries) {
    const markdownPath = buildMarkdownPath(entry)
    const markdown = await readFile(markdownPath, 'utf8')
    markdownByPath.set(entry.path, markdown)
    wordSets.set(entry.path, buildWordSet(markdown))

    if (entry.author.trim().toLowerCase() === 'ai') {
      issues.push({
        severity: 'error',
        message: `${entry.path}: author must reflect a real publishing identity, not generic AI`,
      })
    }

    if (entry.pointOfView.trim().length < 40) {
      issues.push({
        severity: 'warning',
        message: `${entry.path}: pointOfView is too short to carry a clear editorial stance`,
      })
    }

    if (entry.keyClaim.trim().length < 40) {
      issues.push({
        severity: 'warning',
        message: `${entry.path}: keyClaim is too short to express a differentiated argument`,
      })
    }

    if (hasWeakClaimLanguage(entry.keyClaim)) {
      issues.push({
        severity: 'warning',
        message: `${entry.path}: keyClaim sounds soft; prefer a sharper, more defensible point of view`,
      })
    }

    if (entry.pointOfView.toLowerCase() === entry.keyClaim.toLowerCase()) {
      issues.push({
        severity: 'warning',
        message: `${entry.path}: pointOfView and keyClaim are identical; keep them meaningfully distinct`,
      })
    }
  }

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const left = entries[i]
      const right = entries[j]
      const similarity = jaccardSimilarity(
        wordSets.get(left.path) ?? new Set<string>(),
        wordSets.get(right.path) ?? new Set<string>(),
      )

      if (similarity >= 0.72) {
        issues.push({
          severity: 'warning',
          message: `${left.path} and ${right.path}: markdown bodies may be too similar (${similarity.toFixed(2)} similarity)`,
        })
      }
    }
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length

  console.log(`SEO content lint: ${entries.length} entries, ${warningCount} warnings, ${errorCount} errors`)

  for (const issue of issues) {
    console.log(`${issue.severity === 'error' ? 'ERROR' : 'WARN'} ${issue.message}`)
  }

  if (errorCount > 0) {
    process.exitCode = 1
    return
  }

  console.log('SEO content lint passed without structural errors.')
}

await main()
