// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
//
// INPUT:
// - POST JSON: { question: string, locale?: 'en' | 'zh' }
// - 环境变量: DOCS_AI_API_KEY（其次 DEEPSEEK_API_KEY，再兼容 OPENROUTER_API_KEY）、
//   DOCS_AI_BASE_URL（可选，默认 https://api.deepseek.com）、DOCS_AI_MODEL（可选，默认 deepseek-chat）
//
// OUTPUT:
// - SSE 流：首个 data 事件为 `{"type":"sources","sources":[{title,url},...]}`，
//   之后为 OpenAI 兼容 chat.completion.chunk（delta.content），结束为 [DONE]
//
// POS: 文档站 AI 问答的服务端逻辑（从 apps/docs port）。基于 shared 的 fs 读取（无 Vite 依赖），
// 可被 vite.config.ts 的 dev 中间件直接 import；生产静态站不可用（与旧站一致）。
// 检索：ZBSearch BM25 内存索引（中英混合 tokenizer，标题加权）；生成：Vercel AI SDK textStream → SSE。

import path from 'node:path'
import { readFileSync } from 'node:fs'
import { create, insertMultiple, search } from 'zbsearch'
import type { ZBSearch } from 'zbsearch'
import { streamText } from 'ai'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { stripDocsMarkdown, type DocsLocale } from '@shared/docs-content'
import { collectDocsModel } from '@shared/docs-fs'

const INDEX_SCHEMA = {
  title: 'string',
  description: 'string',
  url: 'string',
  content: 'string',
} as const

/** 中英混合 tokenizer：英文/数字按词，中文按单字 + 双字 bigram。 */
const tokenize = (raw: string): string[] => {
  const lower = String(raw).toLowerCase()
  const tokens: string[] = []
  for (const match of lower.match(/[a-z0-9]+/g) ?? []) {
    tokens.push(match)
  }
  const cjk = lower.match(/[\u4e00-\u9fff]/g) ?? []
  for (const char of cjk) {
    tokens.push(char)
  }
  for (let index = 0; index < cjk.length - 1; index += 1) {
    tokens.push(cjk[index] + cjk[index + 1])
  }
  return tokens
}

type KnowledgeDb = ZBSearch<typeof INDEX_SCHEMA>

const dbCache = new Map<DocsLocale, Promise<KnowledgeDb>>()

const getDb = (locale: DocsLocale): Promise<KnowledgeDb> => {
  const cached = dbCache.get(locale)
  if (cached) {
    return cached
  }

  const build = async (): Promise<KnowledgeDb> => {
    const contentDir = path.resolve(process.cwd(), 'apps/web/src/content/docs')
    const model = await collectDocsModel(contentDir, locale)
    const sectionTitleByUrl = new Map<string, string>()
    for (const section of model.sections) {
      for (const page of section.pages) {
        sectionTitleByUrl.set(page.url, section.title)
      }
    }

    const docs = model.pages
      .map((page) => ({
        url: page.url,
        title: page.title,
        description: page.description ?? '',
        content: stripDocsMarkdown(page.markdown),
      }))
      .filter((doc) => doc.content.length > 0)

    const db = await create({
      schema: INDEX_SCHEMA,
      components: {
        tokenizer: {
          language: 'multilingual',
          normalizationCache: new Map<string, string>(),
          tokenize,
        },
      },
    })
    await insertMultiple(db, docs)
    return db
  }

  const promise = build()
  dbCache.set(locale, promise)
  return promise
}

export const retrieveRelevantDocs = async (
  question: string,
  locale: DocsLocale,
  limit = 5,
): Promise<Array<{ url: string; title: string }>> => {
  const db = await getDb(locale)
  const results = await search(db, {
    term: question,
    boost: {
      title: 3,
      description: 2,
    },
    limit,
  })
  return results.hits.map((hit) => hit.document as unknown as { url: string; title: string })
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-chat'

const buildSystemPrompt = (): string =>
  [
    '你是一个专注、准确的技术文档助手，帮助用户解答关于 Wemux（AI 编程交付平台）的文档问题。',
    '规则：',
    '1. 只基于用户提供的「文档片段」回答，不要编造、不要推测文档之外的事实。',
    '2. 如果文档片段不足以回答问题，明确说「文档中没有覆盖这个问题」，并给出最接近的参考。',
    '3. 回答语言与用户提问的语言一致。',
    '4. 需要引用来源时，用 [1]、[2] 等编号标注在对应句末。',
  ].join('\n')

/**
 * dev 兜底：容器/本地 vite dev 不会自动注入根 .env（docker compose 只透传声明的 env），
 * 与旧 apps/docs 的 next.config.mjs 行为一致——缺 key 时从仓库根 .env 补齐。
 */
const loadRootEnv = (): void => {
  if (process.env.DOCS_AI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENROUTER_API_KEY) {
    return
  }
  try {
    const envPath = path.resolve(process.cwd(), '.env')
    const content = readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
      }
    }
  } catch {
    // 忽略：无 .env 或不可读时不阻断 AI 端点（返回 503 提示）
  }
}

export async function handleAskRequest(request: Request): Promise<Response> {
  loadRootEnv()
  const apiKey = process.env.DOCS_AI_API_KEY?.trim()
    || process.env.DEEPSEEK_API_KEY?.trim()
    || process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) {
    return Response.json(
      { error: 'AI 助手未配置：docs dev server 缺少 DOCS_AI_API_KEY / DEEPSEEK_API_KEY' },
      { status: 503 },
    )
  }

  const payload = (await request.json().catch(() => null)) as { question?: unknown; locale?: unknown } | null
  const question = typeof payload?.question === 'string' ? payload.question.trim() : ''
  const locale: DocsLocale = payload?.locale === 'zh' ? 'zh' : 'en'
  if (!question) {
    return Response.json({ error: 'question is required' }, { status: 400 })
  }

  const docs = await retrieveRelevantDocs(question, locale, 5)
  if (docs.length === 0) {
    return Response.json(
      { error: locale === 'zh' ? '没有找到相关的文档内容' : 'No relevant documentation found' },
      { status: 404 },
    )
  }

  const model = process.env.DOCS_AI_MODEL?.trim() || DEFAULT_MODEL
  const baseURL = (process.env.DOCS_AI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const contentDir = path.resolve(process.cwd(), 'apps/web/src/content/docs')
  const modelSource = await collectDocsModel(contentDir, locale)
  const contentByUrl = new Map(modelSource.pages.map((page) => [page.url, stripDocsMarkdown(page.markdown)]))

  const context = docs
    .map((doc, index) => {
      const content = contentByUrl.get(doc.url) ?? ''
      return `### [${index + 1}] ${doc.title}\nURL: ${doc.url}\n\n${content}`
    })
    .join('\n\n---\n\n')

  const deepseek = createDeepSeek({ apiKey, baseURL })
  const result = streamText({
    model: deepseek(model),
    system: buildSystemPrompt(),
    messages: [
      {
        role: 'user',
        content: `以下是相关文档片段：\n\n${context}\n\n---\n\n用户问题：${question}`,
      },
    ],
  })

  const encoder = new TextEncoder()
  const sourcesEvent = `data: ${JSON.stringify({
    type: 'sources',
    sources: docs.map((doc) => ({ title: doc.title, url: doc.url })),
  })}\n\n`

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(sourcesEvent))
      try {
        for await (const delta of result.textStream) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`),
          )
        }
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
    },
  })
}
