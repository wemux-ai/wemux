// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
//
// INPUT:
// - `apps/web/src/content/docs/**` 下的 MDX 原始文本（纯 markdown + frontmatter）与 `meta*.json`
// - 目录/文件名约定：`{section}/{slug}.{lang}.mdx`（根级 `index.{lang}.mdx`）、`meta.json` / `meta.zh.json`
//
// OUTPUT:
// - 文档内容模型：页面（含 URL / TOC）、侧边栏树、搜索条目、LLM 检索文本
// - 纯函数实现，web（?raw 打包）、导出脚本（fs 扫描）、server（SSR 路径判断）三端共用
//
// POS: 文档站的纯数据层，替代原 apps/docs 的 Fumadocs 管线。frontmatter 仅 title/description，
// 正文为纯 markdown（无 JSX），因此不需要 MDX 编译器；渲染走 react-markdown。
// 文件命名 `.en.mdx` / `.zh.mdx` 表达语言，`meta.json` 表达层级与顺序。

export const docsLocales = ['en', 'zh'] as const
export type DocsLocale = (typeof docsLocales)[number]

export type DocsMetaEntry = {
  title?: string
  pages: string[]
}

export type DocsPageFile = {
  /** 目录名；根级 index 为空串 */
  section: string
  /** 文件名 slug；根级 index 为 'index' */
  slug: string
  locale: DocsLocale
  title: string
  description?: string
  /** 去除 frontmatter 后的正文 markdown */
  markdown: string
}

export type DocsTocItem = {
  depth: number
  id: string
  title: string
}

export type DocsPage = DocsPageFile & {
  /** 完整页面 URL，如 /docs/en/docs/getting-started/installation */
  url: string
  toc: DocsTocItem[]
}

export type DocsSection = {
  title: string
  pages: DocsPage[]
}

export type DocsModel = {
  pages: DocsPage[]
  index: DocsPage | null
  sections: DocsSection[]
}

export const isDocsLocale = (value: string): value is DocsLocale => value === 'en' || value === 'zh'

export const docsBaseUrl = '/docs'

/** 是否属于文档站公开路径（含 /docs 与 /docs/**）；与营销路径互不冲突。 */
export const isDocsPath = (pathname: string): boolean =>
  pathname === docsBaseUrl || pathname.startsWith(`${docsBaseUrl}/`)

/** 根 meta（`meta.json`）里的 section 目录名；与页面 slug 'index' 区分 */
export const docsRootSectionEntries = ['getting-started', 'core-concepts', 'configuration', 'guides', 'troubleshooting'] as const

/**
 * 解析 `---\nkey: value\n---` frontmatter + 正文。
 * 仅支持纯字符串值（当前文档只使用 title / description）。
 */
export function parseDocsFrontmatter(raw: string): { title?: string; description?: string; body: string } {
  const trimmed = raw.replace(/^\uFEFF/, '')
  if (!trimmed.startsWith('---')) {
    return { body: trimmed }
  }

  const end = trimmed.indexOf('\n---', 3)
  if (end === -1) {
    return { body: trimmed }
  }

  const head = trimmed.slice(3, end)
  // `end` 指向关闭 `\n---` 的 `\n`；跳过 `---\n` 得到正文（保留其后的空行）
  const body = trimmed.slice(end + 4)
  const fields: { title?: string; description?: string } = {}

  for (const line of head.split('\n')) {
    const match = line.match(/^\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*(.*?)\s*$/)
    if (!match) {
      continue
    }
    const [, key, rawValue] = match
    if (key !== 'title' && key !== 'description') {
      continue
    }
    fields[key] = rawValue.replace(/^["']|["']$/g, '')
  }

  return { title: fields.title, description: fields.description, body }
}

/**
 * 把文件名解析为 { section, slug, locale }。
 * 支持 `index.{lang}.mdx`（section=''）与 `{slug}.{lang}.mdx`；无法识别返回 null。
 */
export function docsFileKey(fileName: string): { section: string; slug: string; locale: DocsLocale } | null {
  const normalized = fileName.replace(/\\/g, '/')
  const slashIndex = normalized.lastIndexOf('/')
  const base = slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1)
  if (!base.endsWith('.mdx')) {
    return null
  }

  const match = base.match(/^(.+?)\.(en|zh)\.mdx$/)
  if (!match) {
    return null
  }

  const [, slug, localeValue] = match
  if (!isDocsLocale(localeValue)) {
    return null
  }

  const section = slashIndex === -1 ? '' : normalized.slice(0, slashIndex)
  return { section, slug, locale: localeValue }
}

/** GitHub 风格 heading slug；中文保留原文（保证可读且稳定）。 */
export function docsHeadingId(text: string): string {
  const stripped = text.replace(/[`*_~]/g, '').trim().toLowerCase()
  const chars: string[] = []
  for (const char of stripped) {
    if (/[a-z0-9]/.test(char)) {
      chars.push(char)
    } else if (/[\u4e00-\u9fff]/.test(char)) {
      chars.push(char)
    } else if (chars.length > 0 && chars[chars.length - 1] !== '-') {
      chars.push('-')
    }
  }
  return chars.join('').replace(/^-+|-+$/g, '')
}

/** 从 markdown 正文提取 heading 目录（depth 1-4），用于文档页 TOC。 */
export function extractDocsToc(markdown: string, maxDepth = 4): DocsTocItem[] {
  const items: DocsTocItem[] = []
  for (const line of markdown.split('\n')) {
    const match = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/)
    if (!match) {
      continue
    }
    const depth = match[1].length
    if (depth > maxDepth) {
      continue
    }
    const rawTitle = match[2].trim()
    const title = rawTitle.replace(/[`*_~]/g, '').trim()
    if (!title) {
      continue
    }
    items.push({ depth, id: docsHeadingId(rawTitle), title })
  }
  return items
}

/** 去掉 markdown 语法，得到纯文本（搜索 / LLM 检索用）。 */
export function stripDocsMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, ' ')
    .replace(/^\s*\d+\.\s+/gm, ' ')
    .replace(/^>\s?/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/[|]{2}/g, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildDocsPageUrl(locale: DocsLocale, section: string, slug: string): string {
  const pageSlug = slug === 'index' ? '' : slug
  const path = [docsBaseUrl, locale, 'docs', section, pageSlug].filter(Boolean).join('/')
  return path === docsBaseUrl ? `${docsBaseUrl}/${locale}/docs` : path
}

export function buildDocsLandingUrl(locale: DocsLocale): string {
  return `${docsBaseUrl}/${locale}`
}

export function buildDocsLegacyRedirectUrl(slugs: string[]): string {
  const suffix = slugs.length > 0 ? `/${slugs.join('/')}` : ''
  return `${docsBaseUrl}/en/docs${suffix}`
}

/**
 * 组装完整文档模型：根 meta 定义顺序与 section 标题，section meta 定义页面顺序。
 * 页面 URL / TOC 在此统一计算，供路由、侧边栏、搜索与 AI 检索共用。
 */
export function buildDocsModel(args: {
  locale: DocsLocale
  rootMeta: DocsMetaEntry
  sectionMeta: Record<string, DocsMetaEntry>
  pages: DocsPageFile[]
}): DocsModel {
  const { locale, rootMeta, sectionMeta, pages } = args
  const pageByKey = new Map(pages.map((page) => [`${page.section}:${page.slug}`, page]))

  const materialize = (section: string, slug: string): DocsPage | null => {
    const file = pageByKey.get(`${section}:${slug}`)
    if (!file) {
      return null
    }
    return {
      ...file,
      url: buildDocsPageUrl(locale, section, slug),
      toc: extractDocsToc(file.markdown),
    }
  }

  const index = materialize('', 'index')

  const sections: DocsSection[] = []
  for (const sectionName of rootMeta.pages) {
    if (sectionName === 'index') {
      continue
    }
    const sectionMetaForName = sectionMeta[sectionName]
    if (!sectionMetaForName) {
      continue
    }
    const sectionPages = (sectionMetaForName.pages ?? [])
      .map((slug) => materialize(sectionName, slug))
      .filter((page): page is DocsPage => page !== null)
    if (sectionPages.length === 0) {
      continue
    }
    sections.push({ title: sectionMetaForName.title ?? sectionName, pages: sectionPages })
  }

  const orderedPageKeys = new Set<string>()
  if (index) {
    orderedPageKeys.add(`${index.section}:${index.slug}`)
  }
  for (const section of sections) {
    for (const page of section.pages) {
      orderedPageKeys.add(`${page.section}:${page.slug}`)
    }
  }

  const allPages = [...orderedPageKeys]
    .map((key) => pageByKey.get(key))
    .map((file) => (file ? materialize(file.section, file.slug) : null))
    .filter((page): page is DocsPage => page !== null)

  return { pages: allPages, index, sections }
}

export type DocsSearchEntry = {
  url: string
  title: string
  description: string
  sectionTitle: string
  /** 截断的正文纯文本，用于搜索摘要与 AI 检索 */
  content: string
}

export function buildDocsSearchEntries(model: DocsModel, sectionTitleOf?: (page: DocsPage) => string): DocsSearchEntry[] {
  const sectionTitleFor = sectionTitleOf ?? (() => '')
  return model.pages.map((page) => ({
    url: page.url,
    title: page.title,
    description: page.description ?? '',
    sectionTitle: sectionTitleFor(page),
    content: stripDocsMarkdown(page.markdown).slice(0, 8000),
  }))
}
