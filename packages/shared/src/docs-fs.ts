// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
//
// INPUT: `apps/web/src/content/docs/**`（mdx + meta.json），Node fs 扫描
// OUTPUT: 文档静态站点索引：SSR 渲染目标（页面 / 落地 / 旧链接跳转）
// POS: Node-only 模块（server 与静态导出脚本共用）。web 客户端勿导入；
// 纯数据装配，复用 ./docs-content 的纯函数，与 web 内 docs-source.ts 同构。

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  buildDocsLandingUrl,
  buildDocsModel,
  docsFileKey,
  docsLocales,
  parseDocsFrontmatter,
  type DocsLocale,
  type DocsMetaEntry,
  type DocsModel,
  type DocsPageFile,
} from './docs-content'

export type DocsStaticRenderTarget = {
  path: string
  title: string
  description: string
  index: boolean
}

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

const readMeta = async (filePath: string): Promise<DocsMetaEntry | null> => {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as { title?: string; pages?: unknown }
    if (!Array.isArray(raw.pages)) {
      return null
    }
    return {
      title: typeof raw.title === 'string' ? raw.title : undefined,
      pages: raw.pages.filter((page): page is string => typeof page === 'string'),
    }
  } catch {
    return null
  }
}

const buildLocaleModel = async (
  locale: DocsLocale,
  files: string[],
  contentRoot: string,
): Promise<DocsModel> => {
  const pages: DocsPageFile[] = []
  const rootMeta: DocsMetaEntry = { pages: [] }
  const sectionMeta: Record<string, DocsMetaEntry> = {}

  for (const filePath of files) {
    const relative = path.relative(contentRoot, filePath).split(path.sep).join('/')
    if (relative.endsWith('.mdx')) {
      const key = docsFileKey(relative)
      if (!key || key.locale !== locale) {
        continue
      }
      const raw = await readFile(filePath, 'utf8')
      const { title, description, body } = parseDocsFrontmatter(raw)
      pages.push({
        section: key.section,
        slug: key.slug,
        locale: key.locale,
        title: title ?? key.slug,
        description,
        markdown: body,
      })
      continue
    }

    if (/meta(?:\.zh)?\.json$/.test(relative)) {
      const meta = await readMeta(filePath)
      if (!meta) {
        continue
      }
      const localeSuffix = relative.endsWith('.zh.json') ? 'zh' : 'en'
      if (localeSuffix !== locale) {
        continue
      }
      const dir = relative.replace(/\/?meta(?:\.zh)?\.json$/, '')
      if (dir === '') {
        rootMeta.title = meta.title
        rootMeta.pages = meta.pages
      } else {
        sectionMeta[dir] = meta
      }
    }
  }

  return buildDocsModel({ locale, rootMeta, sectionMeta, pages })
}

/** 暴露给 AI 检索等需要完整正文的消费方（server / 静态导出脚本 / dev 中间件）。 */
export async function collectDocsModel(contentDir: string, locale: DocsLocale): Promise<DocsModel> {
  const files = await walk(contentDir)
  return buildLocaleModel(locale, files, contentDir)
}

export async function collectDocsStaticIndex(contentDir: string): Promise<DocsStaticRenderTarget[]> {
  const files = await walk(contentDir)
  const targets: DocsStaticRenderTarget[] = []

  targets.push({
    path: '/docs',
    title: 'wemux Docs',
    description: 'wemux documentation: an AI coding delivery platform that orchestrates work across real repositories, workers, branches, logs, and review flows.',
    index: false,
  })

  const legacyRedirectPaths = new Set<string>()

  for (const locale of docsLocales) {
    const model = await buildLocaleModel(locale, files, contentDir)
    const zh = locale === 'zh'

    targets.push({
      path: buildDocsLandingUrl(locale),
      title: zh ? 'wemux 文档' : 'wemux Docs',
      description: zh
        ? 'wemux（AI 编程交付平台）文档：协调真实仓库、Worker、分支、日志与审核流程。'
        : 'wemux documentation: an AI coding delivery platform that orchestrates work across real repositories, workers, branches, logs, and review flows.',
      index: true,
    })

    for (const page of model.pages) {
      targets.push({
        path: page.url,
        title: `${page.title} — wemux Docs`,
        description: page.description ?? page.title,
        index: true,
      })

      // 旧链接（无语言前缀）跳转页：仅 en（与旧站行为一致）
      if (locale === 'en' && page.slug !== 'index') {
        const legacySlug = page.section ? `${page.section}/${page.slug}` : page.slug
        const from = `/docs/${legacySlug}`
        if (!legacyRedirectPaths.has(from)) {
          legacyRedirectPaths.add(from)
          targets.push({
            path: from,
            title: 'wemux Docs',
            description: 'Redirecting to the wemux documentation.',
            index: false,
          })
        }
      }
    }
  }

  return targets
}
