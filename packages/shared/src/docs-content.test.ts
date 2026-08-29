import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDocsModel,
  buildDocsPageUrl,
  docsFileKey,
  extractDocsToc,
  parseDocsFrontmatter,
  stripDocsMarkdown,
} from './docs-content'

test('parseDocsFrontmatter: 解析 title/description 与正文', () => {
  const raw = '---\ntitle: Installation\ndescription: 安装 worker。\n---\n\n# Hello'
  const parsed = parseDocsFrontmatter(raw)
  assert.equal(parsed.title, 'Installation')
  assert.equal(parsed.description, '安装 worker。')
  assert.equal(parsed.body, '\n\n# Hello')
})

test('parseDocsFrontmatter: 无 frontmatter 时返回原文', () => {
  const parsed = parseDocsFrontmatter('# Plain')
  assert.equal(parsed.title, undefined)
  assert.equal(parsed.body, '# Plain')
})

test('docsFileKey: 识别 section/slug/locale', () => {
  assert.deepEqual(docsFileKey('getting-started/installation.en.mdx'), {
    section: 'getting-started',
    slug: 'installation',
    locale: 'en',
  })
  assert.deepEqual(docsFileKey('index.zh.mdx'), { section: '', slug: 'index', locale: 'zh' })
  assert.equal(docsFileKey('readme.md'), null)
  assert.equal(docsFileKey('foo.fr.mdx'), null)
})

test('extractDocsToc: 提取 heading 层级并生成稳定 id', () => {
  const toc = extractDocsToc('# Title\n\n## Quick Links\n\n### 核心概念\n\n## 1. Setup')
  assert.deepEqual(toc, [
    { depth: 1, id: 'title', title: 'Title' },
    { depth: 2, id: 'quick-links', title: 'Quick Links' },
    { depth: 3, id: '核心概念', title: '核心概念' },
    { depth: 2, id: '1-setup', title: '1. Setup' },
  ])
})

test('stripDocsMarkdown: 去语法留文本（代码块整体剥离）', () => {
  const text = stripDocsMarkdown('**bold** and `code` and [link](https://x) and ```\nblock\n```')
  assert.ok(text.includes('bold and code and link and'))
  assert.ok(!text.includes('block'))
  assert.ok(!text.includes('['))
  assert.ok(!text.includes('*'))
})

test('buildDocsPageUrl: 与旧站 URL 结构一致', () => {
  assert.equal(buildDocsPageUrl('en', 'getting-started', 'installation'), '/docs/en/docs/getting-started/installation')
  assert.equal(buildDocsPageUrl('en', '', 'index'), '/docs/en/docs')
  assert.equal(buildDocsPageUrl('zh', 'guides', 'cli-reference'), '/docs/zh/docs/guides/cli-reference')
})

test('buildDocsModel: 按 meta 排序、index 单独归位', () => {
  const model = buildDocsModel({
    locale: 'en',
    rootMeta: { pages: ['index', 'getting-started', 'configuration'] },
    sectionMeta: {
      'getting-started': { title: 'Getting Started', pages: ['installation', 'workspaces'] },
      configuration: { title: 'Configuration', pages: ['models'] },
    },
    pages: [
      { section: 'getting-started', slug: 'workspaces', locale: 'en', title: 'Workspaces', markdown: '# W' },
      { section: '', slug: 'index', locale: 'en', title: 'Welcome', markdown: '# Welcome' },
      { section: 'getting-started', slug: 'installation', locale: 'en', title: 'Installation', markdown: '# Install\n\n## Step 1' },
      { section: 'configuration', slug: 'models', locale: 'en', title: 'Models', markdown: '# M' },
    ],
  })

  assert.equal(model.index?.url, '/docs/en/docs')
  assert.equal(model.sections.length, 2)
  assert.deepEqual(model.sections[0].pages.map((p) => p.slug), ['installation', 'workspaces'])
  assert.equal(model.pages[0].url, '/docs/en/docs')
  assert.deepEqual(model.pages[1].toc.map((t) => t.id), ['install', 'step-1'])
})
