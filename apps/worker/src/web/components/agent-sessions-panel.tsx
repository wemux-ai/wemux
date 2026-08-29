import React, { useMemo, useState } from 'react'
import type { AgentSessionDetail, AgentSessionSource, AgentSessionSummary } from '../worker-console-types'

type AgentSessionsPanelProps = {
  title: string
  description: string
  loadingLabel: string
  emptyLabel: string
  noSelectionLabel: string
  noEntriesLabel: string
  refreshLabel: string
  expandLabel: string
  collapseLabel: string
  startedAtLabel: string
  updatedAtLabel: string
  cwdLabel: string
  countLabel: string
  sources: Record<AgentSessionSource, { label: string; count: number }>
  loading: boolean
  sessions: AgentSessionSummary[]
  activeSessionId?: string
  detail: AgentSessionDetail | null
  onRefresh: () => void
  onSelect: (session: AgentSessionSummary) => void
}

const sourceClassName = (source: AgentSessionSource) => {
  if (source === 'claude') return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
  if (source === 'opencode') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (source === 'pi') return 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200'
  return 'border-sky-500/30 bg-sky-500/10 text-sky-200'
}

const entryClassName = (role: AgentSessionDetail['entries'][number]['role']) => {
  if (role === 'assistant') return 'border-sky-500/20 bg-sky-500/5'
  if (role === 'tool') return 'border-amber-500/20 bg-amber-500/5'
  if (role === 'system') return 'border-zinc-700 bg-zinc-900/80'
  return 'border-zinc-800 bg-zinc-950'
}

const roleLabel = (role: AgentSessionDetail['entries'][number]['role']) => {
  if (role === 'assistant') return 'Assistant'
  if (role === 'tool') return 'Tool'
  if (role === 'system') return 'System'
  return 'User'
}

const formatCompactTimestamp = (value?: string) => {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const formatEntryPreview = (value: string, maxLength = 280) => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return '—'
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

const isToolLikeRole = (role: AgentSessionDetail['entries'][number]['role']) => {
  return role === 'tool' || role === 'system'
}

export const AgentSessionsPanel = ({
  title,
  description,
  loadingLabel,
  emptyLabel,
  noSelectionLabel,
  noEntriesLabel,
  refreshLabel,
  expandLabel,
  collapseLabel,
  startedAtLabel,
  updatedAtLabel,
  cwdLabel,
  countLabel,
  sources,
  loading,
  sessions,
  activeSessionId,
  detail,
  onRefresh,
  onSelect,
}: AgentSessionsPanelProps) => {
  const [activeSource, setActiveSource] = useState<'all' | AgentSessionSource>('all')
  const [expandedEntryIds, setExpandedEntryIds] = useState<string[]>([])
  const filteredSessions = useMemo(() => {
    if (activeSource === 'all') return sessions
    return sessions.filter((session) => session.source === activeSource)
  }, [activeSource, sessions])
  const sourceOrder: AgentSessionSource[] = ['claude', 'opencode', 'codex', 'pi']
  const summaryItems = [
    { id: 'all', label: 'All', count: sessions.length },
    ...sourceOrder.map((source) => ({
      id: source,
      label: sources[source].label,
      count: sources[source].count,
    })),
  ] as const
  const toggleEntry = (entryId: string) => {
    setExpandedEntryIds((current) => current.includes(entryId)
      ? current.filter((id) => id !== entryId)
      : [...current, entryId])
  }

  return (
    <section className="console-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-white">{title}</h2>
          {description ? <p className="text-sm leading-6 text-zinc-300">{description}</p> : null}
        </div>
        <button className="console-button-secondary" onClick={onRefresh} type="button">
          {refreshLabel}
        </button>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-4">
        {summaryItems.map((item) => (
          <button
            key={item.id}
            className={`flex min-h-[96px] w-full flex-col justify-between rounded-[14px] border px-4 py-3.5 text-left transition ${activeSource === item.id ? 'border-zinc-500 bg-zinc-900' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900/70'}`}
            onClick={() => setActiveSource(item.id)}
            type="button"
          >
            <div className="text-xs uppercase tracking-[0.12em] text-zinc-400">{item.label}</div>
            <div className="mt-2 text-xl font-semibold text-white">{item.count}</div>
          </button>
        ))}
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(340px,380px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <div className="console-card-muted p-4">
            <div className="flex flex-wrap gap-2">
              <button
                className={activeSource === 'all' ? 'console-button-secondary' : 'console-pill'}
                onClick={() => setActiveSource('all')}
                type="button"
              >
                All
              </button>
              {Object.entries(sources).map(([key, value]) => (
                <button
                  key={key}
                  className={activeSource === key ? 'console-button-secondary' : 'console-pill'}
                  onClick={() => setActiveSource(key as AgentSessionSource)}
                  type="button"
                >
                  {value.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="console-empty">{loadingLabel}</div>
          ) : filteredSessions.length === 0 ? (
            <div className="console-empty">{emptyLabel}</div>
          ) : (
            <div className="flex max-h-[76vh] flex-col gap-3 overflow-y-auto pr-1">
              {filteredSessions.map((session) => (
                <button
                  key={`${session.source}:${session.id}`}
                  className={`flex min-h-[96px] w-full items-start gap-3 rounded-[14px] border px-3.5 py-3 text-left transition ${activeSessionId === `${session.source}:${session.id}` ? 'border-zinc-500 bg-zinc-900 shadow-[0_0_0_1px_rgba(113,113,122,0.2)]' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900/70'}`}
                  onClick={() => onSelect(session)}
                  type="button"
                >
                  <div className="flex h-10 w-[84px] shrink-0 items-center">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${sourceClassName(session.source)}`}>
                      {sources[session.source].label}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold leading-6 text-white">{session.title}</div>
                      </div>
                      <div className="shrink-0 pl-2 text-right text-[11px] leading-5 text-zinc-500">
                        {formatCompactTimestamp(session.lastUpdatedAt)}
                      </div>
                    </div>

                    <div className="truncate text-xs leading-5 text-zinc-400">
                      {session.cwd || '—'}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                      <span className="truncate">{countLabel} · {session.entryCount}</span>
                      <span className="truncate">{startedAtLabel} · {formatCompactTimestamp(session.startedAt)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {!detail ? (
            <div className="console-empty min-h-[320px]">{noSelectionLabel}</div>
          ) : (
            <>
              <div className="console-card-muted p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${sourceClassName(detail.source)}`}>
                      {sources[detail.source].label}
                    </span>
                    <div className="text-xl font-semibold leading-8 text-white">{detail.title}</div>
                    <div className="break-all rounded-[12px] border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm leading-6 text-zinc-300">
                      {detail.cwd || '—'}
                    </div>
                  </div>
                  <div className="grid min-w-[220px] gap-3 self-stretch sm:grid-cols-2 xl:grid-cols-1">
                    <div className="console-kv">
                      <div className="console-kv-label">{countLabel}</div>
                      <div className="console-kv-value">{detail.entryCount}</div>
                    </div>
                    <div className="console-kv">
                      <div className="console-kv-label">{updatedAtLabel}</div>
                      <div className="console-kv-value">{detail.lastUpdatedAt}</div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="console-kv">
                    <div className="console-kv-label">{startedAtLabel}</div>
                    <div className="console-kv-value">{detail.startedAt || '—'}</div>
                  </div>
                  <div className="console-kv">
                    <div className="console-kv-label">{cwdLabel}</div>
                    <div className="console-kv-value break-all">{detail.cwd || '—'}</div>
                  </div>
                </div>
              </div>

              {detail.entries.length === 0 ? (
                <div className="console-empty min-h-[240px]">{noEntriesLabel}</div>
              ) : (
                <div className="flex max-h-[76vh] flex-col gap-3 overflow-y-auto pr-1">
                  {detail.entries.map((entry) => (
                    (() => {
                      const isExpanded = expandedEntryIds.includes(entry.id)
                      const isCollapsible = entry.text.length > 800
                      const previewText = formatEntryPreview(entry.text)
                      const toolLike = isToolLikeRole(entry.role)
                      const userLike = entry.role === 'user'
                      const rowClassName = toolLike
                        ? 'w-full'
                        : userLike
                          ? 'flex w-full justify-end'
                          : 'flex w-full justify-start'
                      const bubbleClassName = toolLike
                        ? `w-full overflow-hidden rounded-[16px] border px-4 py-3.5 ${entryClassName(entry.role)}`
                        : userLike
                          ? 'max-w-[78%] rounded-[18px] border border-zinc-700 bg-zinc-100 px-4 py-3 text-zinc-950 shadow-[0_8px_20px_rgba(0,0,0,0.18)]'
                          : 'max-w-[78%] rounded-[18px] border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 shadow-[0_8px_20px_rgba(0,0,0,0.18)]'
                      const metaClassName = toolLike
                        ? 'text-xs text-zinc-400'
                        : userLike
                          ? 'text-xs text-zinc-500'
                          : 'text-xs text-zinc-400'

                      return (
                        <div key={entry.id} className={rowClassName}>
                          <article className={bubbleClassName}>
                            <div className={`flex flex-wrap items-center ${toolLike ? 'justify-between gap-3' : 'justify-between gap-2'}`}>
                              <div className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${
                                toolLike
                                  ? 'border border-zinc-700 bg-zinc-900 text-zinc-200'
                                  : userLike
                                    ? 'border border-zinc-300 bg-white text-zinc-700'
                                    : 'border border-zinc-700 bg-zinc-950 text-zinc-200'
                              }`}>
                                {roleLabel(entry.role)}
                              </div>
                              <div className={metaClassName}>{formatCompactTimestamp(entry.timestamp)}</div>
                            </div>

                            {isExpanded ? (
                              <pre className={`mt-3 w-full overflow-x-auto whitespace-pre-wrap break-words text-sm leading-6 ${toolLike ? 'rounded-[12px] border border-zinc-800/80 bg-black/10 p-3 text-zinc-200' : userLike ? 'text-zinc-900' : 'text-zinc-100'}`}>{entry.text}</pre>
                            ) : toolLike ? (
                              <div className="mt-3 rounded-[12px] border border-zinc-800/80 bg-black/10 px-3 py-3">
                                <div className="line-clamp-4 min-h-[84px] text-sm leading-6 text-zinc-200">{previewText}</div>
                              </div>
                            ) : (
                              <div className={`mt-3 line-clamp-4 text-sm leading-6 ${userLike ? 'text-zinc-900' : 'text-zinc-100'}`}>
                                {previewText}
                              </div>
                            )}

                            {isCollapsible ? (
                              <div className={`mt-2.5 flex ${toolLike || userLike ? 'justify-end' : 'justify-start'}`}>
                                <button
                                  className={toolLike ? 'console-button-secondary min-w-[88px]' : userLike ? 'rounded-[10px] border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50' : 'rounded-[10px] border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800'}
                                  onClick={() => toggleEntry(entry.id)}
                                  type="button"
                                >
                                  {isExpanded ? collapseLabel : expandLabel}
                                </button>
                              </div>
                            ) : null}
                          </article>
                        </div>
                      )
                    })()
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
