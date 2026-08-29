// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
//
// INPUT: 文档页 markdown 正文（纯 markdown，无 JSX）
// OUTPUT: 文档风格的渲染组件（heading / 代码块 / 表格 / 提示块 / 链接等）
// POS: 文档内容渲染层。基于 react-markdown + remark-gfm，样式跟随 web 设计系统（zinc + violet、明暗主题）。

import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { cn } from '../utils'

const docsComponents: Components = {
  h1: ({ children }) => (
    <h1 className="scroll-m-20 text-2xl font-semibold tracking-tight text-foreground">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-10 scroll-m-20 border-b border-border pb-2 text-xl font-semibold tracking-tight text-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-8 scroll-m-20 text-lg font-semibold tracking-tight text-foreground">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-6 scroll-m-20 text-base font-semibold tracking-tight text-foreground">{children}</h4>
  ),
  p: ({ children }) => <p className="mt-4 leading-7 text-muted-foreground first:mt-0">{children}</p>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="font-medium text-violet-500 underline underline-offset-4 hover:text-violet-600 dark:text-violet-400 dark:hover:text-violet-300"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="text-foreground">{children}</em>,
  ul: ({ children }) => <ul className="my-4 ml-6 list-disc space-y-2 text-muted-foreground [&>li]:leading-7">{children}</ul>,
  ol: ({ children }) => <ol className="my-4 ml-6 list-decimal space-y-2 text-muted-foreground [&>li]:leading-7">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  hr: () => <hr className="my-8 border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="mt-4 rounded-md border-l-2 border-violet-500 bg-violet-500/5 px-4 py-3 text-sm leading-6 text-muted-foreground [&>p]:mt-0 [&>p]:leading-6">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = Boolean(className?.includes('language-'))
    if (isBlock) {
      return (
        <code className="block font-mono text-[13px] leading-6 text-foreground">
          {children}
        </code>
      )
    }
    return (
      <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-violet-600 dark:text-violet-400">
        {children}
      </code>
    )
  },
  pre: ({ children }) => <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-muted/60 px-4 py-3 text-foreground first:mt-0">{children}</pre>,
  table: ({ children }) => (
    <div className="mt-4 overflow-x-auto first:mt-0">
      <table className="w-full border-collapse text-sm text-muted-foreground">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-medium text-foreground [&:first-child]:pl-0 [&:last-child]:pr-0">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border px-3 py-2 align-top leading-6 [&:first-child]:pl-0 [&:last-child]:pr-0">{children}</td>
  ),
  img: ({ src, alt }) => (
    <img src={src} alt={alt} className="my-4 max-w-full rounded-lg border border-border first:mt-0" loading="lazy" />
  ),
  input: ({ disabled, checked, type }) => {
    if (type === 'checkbox') {
      return <input type="checkbox" disabled={disabled} checked={checked} className="mr-2 size-4 accent-violet-500" />
    }
    return null
  },
}

export function DocsMarkdown({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div className={cn('max-w-none', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={docsComponents}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

export function DocsProse({ children }: { children: ReactNode }) {
  return <div className="text-muted-foreground">{children}</div>
}
