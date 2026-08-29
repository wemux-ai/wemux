import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import { ScrollArea } from '../ui/scroll-area'

type WorkspaceUnifiedDiffProps = {
  patch: string
  className?: string
  emptyMessage?: string
}

type ParsedDiffFile = {
  key: string
  displayPath: string
  oldPath: string
  newPath: string
  additions: number
  deletions: number
  hunks: ParsedDiffHunk[]
  headerLines: string[]
}

type ParsedDiffHunk = {
  key: string
  header: string
  oldStart: number
  newStart: number
  lines: string[]
}

type DiffRow =
  | { key: string; kind: 'hunk'; header: string }
  | { key: string; kind: 'gap'; count: number }
  | { key: string; kind: 'meta'; content: string }
  | {
    key: string
    kind: 'line'
    tone: 'context' | 'addition' | 'deletion'
    content: string
    lineNumber: number | null
  }

const DIFF_START_PREFIX = 'diff --git '

const normalizeDiffPath = (value: string) => {
  if (!value || value === '/dev/null') {
    return value
  }

  return value.replace(/^[ab]\//, '')
}

const parseHunkHeader = (line: string) => {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
  if (!match) {
    return null
  }

  return {
    oldStart: Number(match[1]),
    newStart: Number(match[3]),
  }
}

const finalizeFile = (
  files: ParsedDiffFile[],
  currentFile: ParsedDiffFile | null,
  currentHunk: ParsedDiffHunk | null,
) => {
  if (!currentFile) {
    return
  }

  if (currentHunk) {
    currentFile.hunks.push(currentHunk)
  }

  files.push(currentFile)
}

const parseUnifiedDiff = (patch: string): ParsedDiffFile[] => {
  const lines = patch.split('\n')
  const files: ParsedDiffFile[] = []
  let currentFile: ParsedDiffFile | null = null
  let currentHunk: ParsedDiffHunk | null = null

  const startFile = (displayPath: string): ParsedDiffFile => {
    const nextFile: ParsedDiffFile = {
      key: `${files.length}:${displayPath}`,
      displayPath,
      oldPath: displayPath,
      newPath: displayPath,
      additions: 0,
      deletions: 0,
      hunks: [],
      headerLines: [],
    }
    currentFile = nextFile
    currentHunk = null
    return nextFile
  }

  for (const line of lines) {
    if (line.startsWith(DIFF_START_PREFIX)) {
      finalizeFile(files, currentFile, currentHunk)
      const [, fromPath = '', toPath = ''] = line.match(/^diff --git a\/(.+) b\/(.+)$/) ?? []
      const file = startFile(normalizeDiffPath(toPath || fromPath || 'Patch'))
      file.oldPath = normalizeDiffPath(fromPath || file.displayPath)
      file.newPath = normalizeDiffPath(toPath || file.displayPath)
      continue
    }

    const file = currentFile ?? startFile('Patch')

    if (line.startsWith('@@')) {
      if (currentHunk) {
        file.hunks.push(currentHunk)
      }

      const parsedHeader = parseHunkHeader(line)
      currentHunk = {
        key: `${file.key}:hunk:${file.hunks.length}`,
        header: line,
        oldStart: parsedHeader?.oldStart ?? 0,
        newStart: parsedHeader?.newStart ?? 0,
        lines: [],
      }
      continue
    }

    if (currentHunk) {
      currentHunk.lines.push(line)
      if (line.startsWith('+') && !line.startsWith('+++ ')) {
        file.additions += 1
      } else if (line.startsWith('-') && !line.startsWith('--- ')) {
        file.deletions += 1
      }
      continue
    }

    file.headerLines.push(line)
    if (line.startsWith('--- ')) {
      file.oldPath = normalizeDiffPath(line.slice(4).trim())
    } else if (line.startsWith('+++ ')) {
      file.newPath = normalizeDiffPath(line.slice(4).trim())
    }
  }

  finalizeFile(files, currentFile, currentHunk)

  return files
    .filter((file) => file.hunks.length > 0 || file.headerLines.some((line) => line.trim()))
    .map((file, index) => ({
      ...file,
      key: `${index}:${file.displayPath}:${file.oldPath}:${file.newPath}`,
      displayPath: file.newPath && file.newPath !== '/dev/null'
        ? file.newPath
        : file.oldPath && file.oldPath !== '/dev/null'
          ? file.oldPath
          : file.displayPath,
    }))
}

const buildDiffRows = (file: ParsedDiffFile): DiffRow[] => {
  const rows: DiffRow[] = file.headerLines
    .filter((line) => line.trim() && !line.startsWith('--- ') && !line.startsWith('+++ '))
    .map((line, index) => ({
      key: `${file.key}:meta-header:${index}`,
      kind: 'meta' as const,
      content: line,
    }))
  let previousOldLine = 1
  let previousNewLine = 1

  for (const hunk of file.hunks) {
    const topGap = Math.max(hunk.oldStart - previousOldLine, hunk.newStart - previousNewLine)
    if (topGap > 0) {
      rows.push({
        key: `${hunk.key}:gap-top`,
        kind: 'gap',
        count: topGap,
      })
    }

    rows.push({
      key: `${hunk.key}:header`,
      kind: 'hunk',
      header: hunk.header,
    })

    let oldLine = hunk.oldStart
    let newLine = hunk.newStart

    for (const line of hunk.lines) {
      if (line.startsWith('\\')) {
        rows.push({
          key: `${hunk.key}:meta:${rows.length}`,
          kind: 'meta',
          content: line,
        })
        continue
      }

      if (line.startsWith('+')) {
        rows.push({
          key: `${hunk.key}:line:${rows.length}`,
          kind: 'line',
          tone: 'addition',
          content: line.slice(1),
          lineNumber: newLine,
        })
        newLine += 1
        continue
      }

      if (line.startsWith('-')) {
        rows.push({
          key: `${hunk.key}:line:${rows.length}`,
          kind: 'line',
          tone: 'deletion',
          content: line.slice(1),
          lineNumber: oldLine,
        })
        oldLine += 1
        continue
      }

      rows.push({
        key: `${hunk.key}:line:${rows.length}`,
        kind: 'line',
        tone: 'context',
        content: line.startsWith(' ') ? line.slice(1) : line,
        lineNumber: newLine,
      })
      oldLine += 1
      newLine += 1
    }

    previousOldLine = oldLine
    previousNewLine = newLine
  }

  return rows
}

const diffRowToneClassName: Record<'context' | 'addition' | 'deletion', string> = {
  context: 'bg-transparent text-zinc-300',
  addition: 'bg-emerald-500/10 text-emerald-100',
  deletion: 'bg-rose-500/10 text-rose-100',
}

const diffNumberToneClassName: Record<'context' | 'addition' | 'deletion', string> = {
  context: 'text-zinc-500',
  addition: 'text-emerald-300',
  deletion: 'text-rose-300',
}

export function WorkspaceUnifiedDiff({
  patch,
  className,
  emptyMessage,
}: WorkspaceUnifiedDiffProps) {
  const { t } = useTranslation()
  const files = useMemo(() => parseUnifiedDiff(patch), [patch])
  const resolvedEmptyMessage = emptyMessage ?? t('workspace.diff.empty', { defaultValue: '没有可展示的 diff。' })
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setExpandedFiles((current) => {
      const next: Record<string, boolean> = {}
      for (const [index, file] of files.entries()) {
        next[file.key] = current[file.key] ?? index === 0
      }
      return next
    })
  }, [files])

  if (!patch.trim() || files.length === 0) {
    return (
      <div className={cn('flex h-full items-center justify-center text-xs text-zinc-600', className)}>
        {resolvedEmptyMessage}
      </div>
    )
  }

  return (
    <ScrollArea className={cn('bg-[#0b0b0c] [&_[data-radix-scroll-area-viewport]>div]:!block [&_[data-radix-scroll-area-viewport]>div]:!min-w-0 [&_[data-radix-scroll-area-viewport]>div]:!w-full', className)}>
      <div className="min-w-0 space-y-2 p-2">
        {files.map((file) => {
          const rows = buildDiffRows(file)
          const expanded = expandedFiles[file.key] ?? true
          const isNewFile = file.oldPath === '/dev/null'
          const isDeletedFile = file.newPath === '/dev/null'
          const isRenamedFile = !isNewFile && !isDeletedFile && file.oldPath !== file.newPath

          return (
            <section key={file.key} className="min-w-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80">
              <button
                type="button"
                onClick={() => setExpandedFiles((current) => ({ ...current, [file.key]: !expanded }))}
                className="flex w-full items-center justify-between gap-2 border-b border-zinc-800/60 px-2.5 py-1.5 text-left transition-colors hover:bg-zinc-900/40"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {expanded
                    ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />}
                  <span className="truncate font-mono text-[12px] text-zinc-200">{file.displayPath}</span>
                  {isNewFile ? <span className="rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] text-emerald-400">new</span> : null}
                  {isDeletedFile ? <span className="rounded bg-rose-500/10 px-1 py-0.5 text-[10px] text-rose-400">del</span> : null}
                  {isRenamedFile ? <span className="rounded bg-sky-500/10 px-1 py-0.5 text-[10px] text-sky-400">renamed</span> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
                  <span className="text-emerald-400">+{file.additions}</span>
                  <span className="text-rose-400">-{file.deletions}</span>
                </div>
              </button>

              {expanded ? (
                <div className="max-w-full overflow-x-auto overflow-y-hidden [scrollbar-width:thin] [scrollbar-color:rgb(82_82_91)_transparent] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-800 [&::-webkit-scrollbar-thumb:hover]:bg-zinc-700">
                  <div className="min-w-full w-max">
                    {rows.map((row) => {
                      if (row.kind === 'gap') {
                        return (
                          <div key={row.key} className="flex items-center gap-1.5 border-y border-zinc-800/40 bg-zinc-900/20 px-2.5 py-1 text-[11px] text-zinc-500">
                            <ChevronDown className="h-3 w-3" />
                            <span>{row.count} lines</span>
                          </div>
                        )
                      }

                      if (row.kind === 'hunk' || row.kind === 'meta') {
                        return null
                      }

                      return (
                        <div
                          key={row.key}
                          className={cn(
                            'grid grid-cols-[56px_1fr] font-mono text-[11px] leading-[18px]',
                            diffRowToneClassName[row.tone],
                          )}
                        >
                          <div className={cn('border-r border-zinc-800/40 px-2 text-right tabular-nums', diffNumberToneClassName[row.tone])}>
                            {row.lineNumber ?? ''}
                          </div>
                          <div className="px-2.5">
                            <div className="whitespace-pre">{row.content || ' '}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </section>
          )
        })}
      </div>
    </ScrollArea>
  )
}
