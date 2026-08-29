import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CURRENT_APP_VERSION } from '../../lib/node-version'
import { Button } from '../ui/button'

type ChangelogPageProps = {
  changelogMarkdown: string
}

export function ChangelogPage({ changelogMarkdown }: ChangelogPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
      <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-[linear-gradient(180deg,rgba(24,24,27,0.96),rgba(9,9,11,0.98))]">
        <div className="flex flex-col gap-4 px-5 py-5 sm:px-6 sm:py-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300">
              Release History
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
                Changelog
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-zinc-400 sm:text-[15px]">
                User-facing release notes, version milestones, and shipped changes from a single project changelog source.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Current Version</p>
              <p className="mt-1 text-lg font-semibold text-zinc-100">v{CURRENT_APP_VERSION}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }
              }}
            >
              Back to Top
            </Button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/50">
        <div className="border-b border-zinc-800 px-5 py-4 sm:px-6">
          <p className="text-sm text-zinc-400">
            This page renders the root <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-200">CHANGELOG.md</code> so release workflow output and user-visible history stay aligned.
          </p>
        </div>
        <div className="px-5 py-5 sm:px-6 sm:py-6">
          <div className="markdown-body prose prose-sm sm:prose-base prose-invert max-w-none break-words prose-headings:break-words prose-headings:text-zinc-50 prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-p:text-zinc-300 prose-li:text-zinc-300 prose-strong:text-zinc-100 prose-code:break-all prose-code:text-zinc-100 prose-pre:border prose-pre:border-zinc-800 prose-pre:bg-zinc-950/70">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {changelogMarkdown}
            </ReactMarkdown>
          </div>
        </div>
      </section>
    </div>
  )
}
