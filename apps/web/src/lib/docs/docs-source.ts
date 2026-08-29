// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
//
// INPUT: `src/content/docs/**`（纯 markdown + frontmatter + meta.json），经 Vite `import.meta.glob` 打包
// OUTPUT: 文档模型（页面 / 侧边栏树 / 搜索条目）；纯同步，client + SSR 通用
// POS: 文档站数据装配层。复用 packages/shared 的纯函数，URL 结构保持旧站一致（/docs/{lang}/docs/{slug}）。

import {
  buildDocsModel,
  buildDocsSearchEntries,
  docsFileKey,
  isDocsLocale,
  parseDocsFrontmatter,
  type DocsLocale,
  type DocsMetaEntry,
  type DocsModel,
  type DocsPage,
  type DocsPageFile,
  type DocsSearchEntry,
  type DocsSection,
} from '@shared/docs-content'

const contentRoot = '../../content/docs/'

const rawDocsModules = import.meta.glob('../../content/docs/**/*.mdx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const metaModules = import.meta.glob('../../content/docs/**/meta*.json', {
  eager: true,
}) as Record<string, { title?: string; pages?: string[] }>

const parseMetaModule = (raw: unknown): DocsMetaEntry | null => {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const entry = raw as { title?: string; pages?: unknown }
  if (!Array.isArray(entry.pages)) {
    return null
  }
  return {
    title: typeof entry.title === 'string' ? entry.title : undefined,
    pages: entry.pages.filter((page): page is string => typeof page === 'string'),
  }
}

const collectMeta = (locale: DocsLocale) => {
  const rootMeta: DocsMetaEntry = { pages: [] }
  const sectionMeta: Record<string, DocsMetaEntry> = {}

  for (const [key, module] of Object.entries(metaModules)) {
    const relative = key.replace(contentRoot, '')
    // 形如 meta.json / meta.zh.json / getting-started/meta.zh.json
    if (relative.endsWith('.zh.json')) {
      if (locale !== 'zh') {
        continue
      }
    } else if (relative.endsWith('meta.json')) {
      if (locale !== 'en') {
        continue
      }
    } else {
      continue
    }

    const parsed = parseMetaModule(module)
    if (!parsed) {
      continue
    }

    const dir = relative.replace(/\/?(?:meta\.zh|meta)\.json$/, '')
    if (dir === '') {
      rootMeta.title = parsed.title
      rootMeta.pages = parsed.pages
    } else {
      sectionMeta[dir] = parsed
    }
  }

  return { rootMeta, sectionMeta }
}

const modelCache: Partial<Record<DocsLocale, DocsModel>> = {}

export function getDocsModel(locale: DocsLocale): DocsModel {
  const cached = modelCache[locale]
  if (cached) {
    return cached
  }

  const pages: DocsPageFile[] = []
  for (const [key, raw] of Object.entries(rawDocsModules)) {
    const fileKey = docsFileKey(key.replace(contentRoot, ''))
    if (!fileKey || fileKey.locale !== locale) {
      continue
    }
    const { title, description, body } = parseDocsFrontmatter(raw)
    pages.push({
      section: fileKey.section,
      slug: fileKey.slug,
      locale: fileKey.locale,
      title: title ?? fileKey.slug,
      description,
      markdown: body,
    })
  }

  const { rootMeta, sectionMeta } = collectMeta(locale)
  const model = buildDocsModel({ locale, rootMeta, sectionMeta, pages })
  modelCache[locale] = model
  return model
}

export function getDocsPages(locale: DocsLocale): DocsPage[] {
  return getDocsModel(locale).pages
}

export function getDocsIndex(locale: DocsLocale): DocsPage | null {
  return getDocsModel(locale).index
}

export function getDocsSections(locale: DocsLocale): DocsSection[] {
  return getDocsModel(locale).sections
}

export function getDocsPageBySlugs(locale: DocsLocale, slugs: string[]): DocsPage | null {
  if (slugs.length === 0) {
    return getDocsIndex(locale)
  }
  if (slugs.length !== 2) {
    return null
  }
  const [section, slug] = slugs
  return getDocsModel(locale).pages.find((page) => page.section === section && page.slug === slug) ?? null
}

export function getDocsPageByUrl(url: string): { locale: DocsLocale; page: DocsPage } | null {
  const match = url.match(/^\/docs\/(en|zh)\/docs(?:\/([^/]+)\/([^/]+))?$/)
  if (!match) {
    return null
  }
  const locale = match[1]
  if (!isDocsLocale(locale)) {
    return null
  }
  const slugs = [match[2], match[3]].filter((value): value is string => Boolean(value))
  const page = getDocsPageBySlugs(locale, slugs)
  if (!page) {
    return null
  }
  return { locale, page }
}

const searchEntriesCache: Partial<Record<DocsLocale, DocsSearchEntry[]>> = {}

export function getDocsSearchEntries(locale: DocsLocale): DocsSearchEntry[] {
  const cached = searchEntriesCache[locale]
  if (cached) {
    return cached
  }
  const model = getDocsModel(locale)
  const sectionTitleByUrl = new Map<string, string>()
  for (const section of model.sections) {
    for (const page of section.pages) {
      sectionTitleByUrl.set(page.url, section.title)
    }
  }
  const entries = buildDocsSearchEntries(model, (page) => sectionTitleByUrl.get(page.url) ?? '')
  searchEntriesCache[locale] = entries
  return entries
}

export function listDocsLocales(): DocsLocale[] {
  return ['en', 'zh']
}

/** 旧站遗留路径（无 locale 前缀）是否命中某个文档页，用于生成跳转清单 */
export function listDocsLegacyRedirectTargets(): Array<{ from: string; to: string }> {
  const targets: Array<{ from: string; to: string }> = []
  const model = getDocsModel('en')
  for (const page of model.pages) {
    if (page.slug === 'index') {
      targets.push({ from: '/docs', to: '/docs/en/docs' })
      continue
    }
    const legacySlug = page.section ? `${page.section}/${page.slug}` : page.slug
    targets.push({ from: `/docs/${legacySlug}`, to: `/docs/en/docs${legacySlug ? `/${legacySlug}` : ''}` })
  }
  return targets
}
