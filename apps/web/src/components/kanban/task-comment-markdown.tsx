/**
 * [INPUT]: Persisted task-comment Markdown text.
 * [OUTPUT]: Safe, compact GitHub-flavored Markdown presentation for task comments.
 * [POS]: Kanban task-detail comment body renderer; comment editing and actions remain in the parent section.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function TaskCommentMarkdown({ content }: { content: string }) {
  return (
    <div className="markdown-body mt-1 min-w-0 break-words text-[13px] leading-5 text-zinc-400">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap break-words leading-5">{children}</p>,
          ul: ({ children }) => <ul className="ml-5 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-zinc-200">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children }) => <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[0.92em] text-zinc-200">{children}</code>,
          pre: ({ children }) => <pre className="max-w-full overflow-x-auto rounded-md bg-zinc-950 px-3 py-2 text-xs leading-5 text-zinc-200">{children}</pre>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-sky-300 underline underline-offset-4">
              {children}
            </a>
          ),
          blockquote: ({ children }) => <blockquote className="border-l-2 border-zinc-700 pl-3 italic text-zinc-500">{children}</blockquote>,
          h1: ({ children }) => <h1 className="text-base font-semibold text-zinc-100">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold text-zinc-100">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-medium text-zinc-200">{children}</h3>,
          hr: () => <hr className="border-dashed border-zinc-800" />,
          table: ({ children }) => <div className="max-w-full overflow-x-auto"><table className="w-full border-collapse text-xs">{children}</table></div>,
          th: ({ children }) => <th className="border border-zinc-800 px-2 py-1 text-left font-medium text-zinc-200">{children}</th>,
          td: ({ children }) => <td className="border border-zinc-800 px-2 py-1 align-top">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
