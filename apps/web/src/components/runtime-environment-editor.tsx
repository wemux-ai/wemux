import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown, ChevronLeft, FileText, FileUp, Folder, Info, Loader2, RefreshCw } from 'lucide-react'
import { parseRuntimeEnvironmentContent, type RuntimeEnvironmentConfig, type RuntimeEnvironmentDeliveryMode, type RuntimeEnvironmentSummary, validateRuntimeEnvironmentConfig } from '@shared/runtime-environment'
import { toast } from 'sonner'
import { useTranslation } from '../lib/i18n/react'
import { api } from '../lib/api'
import { resolveFirstOpenableExecutorDirectory } from '../lib/executor-open-path'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { NativeSelect } from './ui/native-select'
import { ScrollArea } from './ui/scroll-area'
import { Textarea } from './ui/textarea'

type RuntimeEnvironmentEditorProps = {
  title: string
  description: string
  config: RuntimeEnvironmentConfig | null
  summary?: RuntimeEnvironmentSummary | null
  onChange: (config: RuntimeEnvironmentConfig | null) => void
  chrome?: 'full' | 'minimal'
  /** Controls which reference tips are emphasized for the current settings page. */
  scope?: 'project' | 'workspace'
  fileImportSource?: RuntimeEnvironmentFileImportSource | null
  fileNameStatus?: string
  fileNameStatusBusy?: boolean
}

export type RuntimeEnvironmentFileImportSource = {
  executorId: string
  candidatePaths: string[]
  dialogTitle?: string
  dialogDescription?: string
  buttonLabel?: string
}

const modeLabel: Record<RuntimeEnvironmentDeliveryMode, string> = {
  'process-env': '注入终端环境',
  'env-file': '写入项目文件',
}

const tr = (language: string, zh: string, en: string) => language === 'zh' ? zh : en
const basename = (targetPath: string) => targetPath.split(/[\\/]/).filter(Boolean).pop() || targetPath
const DEFAULT_ENV_FILE_NAME = '.env.local'
const ENV_EDITOR_TEXT_CLASS_NAME = 'font-mono text-[13px] leading-5 md:text-[13px]'
const ENV_REFERENCE_PATTERN = /\$\{\{\s*[^}]+\s*\}\}/g
const ENV_EDITOR_PLACEHOLDER = [
  'API_HOST=https://api.example.com',
  'AUTH_PATH=/auth',
  'AUTH_ENDPOINT=${{ API_HOST }}${{ AUTH_PATH }}',
  'BETTER_AUTH_URL=${{ preview.publicUrl }}',
  'BETTER_AUTH_TRUSTED_ORIGINS=${{ preview.publicOrigin }}',
].join('\n')

const CodeChip = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-zinc-900 px-1 py-0.5 font-mono text-[10px] text-violet-300">
    {children}
  </code>
)

const renderValueWithReferences = (value: string, hasIssue: boolean) => {
  if (hasIssue || !value.includes('${{')) {
    return <span className={hasIssue ? '' : 'text-emerald-200'}>{value}</span>
  }

  const nodes: ReactNode[] = []
  let lastIndex = 0
  let matchIndex = 0
  const pattern = new RegExp(ENV_REFERENCE_PATTERN.source, 'g')
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > lastIndex) {
      nodes.push(
        <span key={`text-${matchIndex}`} className="text-emerald-200">
          {value.slice(lastIndex, start)}
        </span>,
      )
    }
    nodes.push(
      <span key={`ref-${matchIndex}`} className="text-violet-300">
        {match[0]}
      </span>,
    )
    lastIndex = start + match[0].length
    matchIndex += 1
  }

  if (lastIndex < value.length) {
    nodes.push(
      <span key="text-end" className="text-emerald-200">
        {value.slice(lastIndex)}
      </span>,
    )
  }

  return <>{nodes}</>
}

const renderRuntimeEnvironmentLineHighlight = (
  rawLine: string,
  lineNumber: number,
  issueLines: Set<number>,
) => {
  const trimmed = rawLine.trim()
  const hasIssue = issueLines.has(lineNumber)
  const lineClassName = cn(
    'block min-h-5 whitespace-pre-wrap break-words px-4',
    hasIssue && 'bg-rose-500/10 text-rose-200',
  )

  if (!trimmed) {
    return <span className={lineClassName}>&nbsp;</span>
  }

  if (trimmed.startsWith('#')) {
    return <span className={cn(lineClassName, hasIssue ? '' : 'text-zinc-500')}>{rawLine}</span>
  }

  const leadingWhitespaceLength = rawLine.length - rawLine.trimStart().length
  const leadingWhitespace = rawLine.slice(0, leadingWhitespaceLength)
  const content = rawLine.slice(leadingWhitespaceLength)
  const exportPrefix = content.startsWith('export ') ? 'export ' : ''
  const envAssignment = exportPrefix ? content.slice(exportPrefix.length) : content
  const separatorIndex = envAssignment.indexOf('=')
  if (separatorIndex <= 0) {
    return <span className={lineClassName}>{rawLine}</span>
  }

  const key = envAssignment.slice(0, separatorIndex)
  const value = envAssignment.slice(separatorIndex + 1)

  return (
    <span className={lineClassName}>
      {leadingWhitespace}
      {exportPrefix ? <span className={hasIssue ? '' : 'text-sky-300'}>{exportPrefix}</span> : null}
      <span className={hasIssue ? '' : 'text-cyan-300'}>{key}</span>
      <span className={hasIssue ? '' : 'text-zinc-500'}>=</span>
      {renderValueWithReferences(value, hasIssue)}
    </span>
  )
}

function RuntimeEnvironmentReferenceTips({
  language,
  scope,
}: {
  language: string
  scope: 'project' | 'workspace'
}) {
  const [expanded, setExpanded] = useState(false)
  const scopeHint = scope === 'workspace'
    ? tr(
      language,
      '当前为工作区级配置：同名键会覆盖项目级；${{ KEY }} 取合并后的最终值。',
      'Workspace scope: same keys override project values; ${{ KEY }} resolves the effective merged value.',
    )
    : tr(
      language,
      '当前为项目级配置：可被工作区同名键覆盖；${{ KEY }} 在执行时按合并结果解析。',
      'Project scope: workspace keys can override these; ${{ KEY }} resolves the effective merged value at runtime.',
    )

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-zinc-400 transition-colors hover:bg-zinc-900/50 hover:text-zinc-300"
      >
        <Info className="size-3.5 shrink-0 text-zinc-500" />
        <span className="min-w-0 flex-1">
          {tr(language, '变量引用', 'Variable references')}
          <span className="ml-1.5 text-zinc-600">
            {tr(language, '支持 ${{ ... }} · 平台变量仅显式引用时注入', 'Supports ${{ ... }} · platform vars inject only when referenced')}
          </span>
        </span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-zinc-600 transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded ? (
        <div className="space-y-2 border-t border-zinc-800/80 px-3 py-2.5 text-[11px] leading-relaxed text-zinc-500">
          <p>{scopeHint}</p>
          <ul className="space-y-1.5">
            <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <CodeChip>{'${{ KEY }}'}</CodeChip>
              <span>{tr(language, '引用合并后的最终值（工作区覆盖项目）', 'Effective merged value (workspace overrides project)')}</span>
            </li>
            <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <CodeChip>{'${{ project.KEY }}'}</CodeChip>
              <span>/</span>
              <CodeChip>{'${{ workspace.KEY }}'}</CodeChip>
              <span>{tr(language, '明确作用域，不走合并', 'Explicit scope, no merge')}</span>
            </li>
            <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <CodeChip>{'${{ preview.publicUrl }}'}</CodeChip>
              <span>/</span>
              <CodeChip>{'${{ preview.publicOrigin }}'}</CodeChip>
              <span>{tr(language, 'Preview 启动时解析', 'Resolved when preview starts')}</span>
            </li>
            <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <CodeChip>{'${{ node.publicIp }}'}</CodeChip>
              <span>/</span>
              <CodeChip>{'${{ node.lanIp }}'}</CodeChip>
              <span>/</span>
              <CodeChip>{'${{ node.meshIp }}'}</CodeChip>
              <span>{tr(language, '节点网络信息（仅引用时注入）', 'Node network info (inject only when referenced)')}</span>
            </li>
            <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <CodeChip>{'${{ vibemux.preview.publicUrl }}'}</CodeChip>
              <span>{tr(language, '平台变量别名，便于文档化', 'Platform alias for documentation')}</span>
            </li>
          </ul>
          <p className="text-zinc-600">
            {tr(
              language,
              '数据库保存原始文本，不会在保存时展开。Preview URL 等运行时上下文在启动 Preview / 执行任务前由服务端解析；缺失的用户变量会报错，普通任务中缺失的平台变量会保留原样。',
              'Raw text is stored as-is and not expanded on save. Runtime context such as preview URLs is resolved by the server before preview start / task execution. Missing user vars error; missing platform vars are preserved in non-preview flows.',
            )}
          </p>
        </div>
      ) : null}
    </div>
  )
}

export function RuntimeEnvironmentEditor({
  title,
  description,
  config,
  summary,
  onChange,
  chrome = 'full',
  scope = 'project',
  fileImportSource = null,
  fileNameStatus = '',
  fileNameStatusBusy = false,
}: RuntimeEnvironmentEditorProps) {
  const { language } = useTranslation()
  const content = config?.content ?? ''
  const issues = useMemo(() => validateRuntimeEnvironmentConfig(config), [config])
  const parsed = useMemo(() => parseRuntimeEnvironmentContent(content), [content])
  const issueLines = useMemo(() => new Set(parsed.issues.map((issue) => issue.line).filter((line) => line > 0)), [parsed.issues])
  const highlightedLines = useMemo(() => content.split('\n'), [content])
  const variableCount = summary?.variableCount ?? parsed.entries.length
  const mode = config?.mode ?? 'env-file'
  const fileName = config?.fileName ?? DEFAULT_ENV_FILE_NAME
  const showHeader = chrome === 'full'
  const referenceCount = useMemo(() => {
    const matches = content.match(ENV_REFERENCE_PATTERN)
    return matches?.length ?? 0
  }, [content])
  const [fileImportOpen, setFileImportOpen] = useState(false)
  const [directoryPath, setDirectoryPath] = useState('')
  const [parentPath, setParentPath] = useState('')
  const [entries, setEntries] = useState<Array<{ name: string; path: string; kind: 'directory' | 'file'; sizeBytes?: number }>>([])
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [directoryError, setDirectoryError] = useState('')
  const [fileImportingPath, setFileImportingPath] = useState('')
  const [editorScroll, setEditorScroll] = useState({ left: 0, top: 0 })
  const directoryRequestIdRef = useRef(0)
  const activeFileImportSource = useMemo(() => {
    if (!fileImportSource?.executorId?.trim()) {
      return
    }

    const candidatePaths = fileImportSource.candidatePaths
      .map((item) => item.trim())
      .filter(Boolean)

    if (candidatePaths.length === 0) {
      return null
    }

    return {
      ...fileImportSource,
      executorId: fileImportSource.executorId.trim(),
      candidatePaths,
    }
  }, [fileImportSource])
  const sortedEntries = useMemo(
    () => [...entries].sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'directory' ? -1 : 1
      }

      return left.name.localeCompare(right.name)
    }),
    [entries],
  )
  const fileNameLabel = (
    <div className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">文件名</span>
      {fileNameStatus ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
          {fileNameStatusBusy ? <Loader2 className="size-3 animate-spin" /> : null}
          {fileNameStatus}
        </span>
      ) : null}
    </div>
  )

  const loadDirectory = async (targetPath: string, options?: { forceResolveRoot?: boolean }) => {
    if (!activeFileImportSource) {
      return
    }

    const requestId = directoryRequestIdRef.current + 1
    directoryRequestIdRef.current = requestId
    setDirectoryLoading(true)
    setDirectoryError('')

    try {
      const resolvedPath = options?.forceResolveRoot
        ? (await resolveFirstOpenableExecutorDirectory(activeFileImportSource.executorId, activeFileImportSource.candidatePaths))[0] || ''
        : targetPath

      if (!resolvedPath) {
        throw new Error(tr(language, '当前没有可读取的项目目录。', 'There is no readable project directory.'))
      }

      const result = await api.browseExecutorDirectory(activeFileImportSource.executorId, resolvedPath)
      if (directoryRequestIdRef.current !== requestId) {
        return
      }

      if (!result.ok) {
        throw new Error(result.message || tr(language, '目录读取失败。', 'Failed to browse directory.'))
      }

      setDirectoryPath(result.path)
      setParentPath(result.parentPath || '')
      setEntries(result.entries)
    } catch (error) {
      if (directoryRequestIdRef.current !== requestId) {
        return
      }

      setDirectoryError(error instanceof Error ? error.message : tr(language, '目录读取失败。', 'Failed to browse directory.'))
      setEntries([])
    } finally {
      if (directoryRequestIdRef.current === requestId) {
        setDirectoryLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!fileImportOpen || !activeFileImportSource) {
      return
    }

    void loadDirectory('', {
      forceResolveRoot: true,
    })
  }, [activeFileImportSource, fileImportOpen])

  const handleImportFile = async (filePath: string) => {
    if (!activeFileImportSource) {
      return
    }

    setFileImportingPath(filePath)
    try {
      const result = await api.readExecutorFile(activeFileImportSource.executorId, filePath)
      if (!result.ok || typeof result.content !== 'string') {
        throw new Error(result.message || tr(language, '文件读取失败。', 'Failed to read file.'))
      }

      const content = result.content
      onChange({
        mode,
        fileName: mode === 'env-file'
          ? (config?.fileName?.trim() || basename(filePath) || DEFAULT_ENV_FILE_NAME)
          : config?.fileName,
        content,
      })
      setFileImportOpen(false)

      const importedVariableCount = parseRuntimeEnvironmentContent(content).entries.length
      toast.success(tr(
        language,
        `已从 ${basename(filePath)} 读取 ${importedVariableCount} 项环境变量`,
        `Imported ${importedVariableCount} environment variables from ${basename(filePath)}`,
      ))
    } catch (error) {
      toast.error(error instanceof Error
        ? error.message
        : tr(language, '读取环境变量文件失败', 'Failed to read env file'))
    } finally {
      setFileImportingPath('')
    }
  }

  return (
    <div className="space-y-0">
      {showHeader ? (
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-zinc-100">{title}</p>
            <Badge className="border-zinc-800 bg-zinc-900 text-zinc-300">
              {modeLabel[mode]}
            </Badge>
          </div>
          {description ? <p className="text-xs text-zinc-500">{description}</p> : null}
        </div>
      ) : null}

      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">投递方式</span>
            <NativeSelect
              value={mode}
              onValueChange={(nextMode) => onChange({
                mode: nextMode === 'env-file' ? 'env-file' : 'process-env',
                fileName: nextMode === 'env-file' ? (config?.fileName ?? DEFAULT_ENV_FILE_NAME) : config?.fileName,
                content: config?.content ?? '',
              })}
              options={[
                { value: 'process-env', label: '注入终端环境' },
                { value: 'env-file', label: '写入项目文件' },
              ]}
            />
          </div>

          {mode === 'env-file' ? (
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                {fileNameLabel}
                <Input
                  value={fileName}
                  onChange={(event) => onChange({
                    mode,
                    fileName: event.target.value,
                    content: config?.content ?? '',
                  })}
                  placeholder=".env.local"
                  className="w-40 font-mono"
                />
              </div>
              {activeFileImportSource ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFileImportOpen(true)}
                  className="h-9 rounded-lg border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
                >
                  <FileUp data-icon="inline-start" />
                  {activeFileImportSource.buttonLabel || tr(language, '读取文件', 'Load File')}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-1.5">
              {fileNameLabel}
              <div className="border border-zinc-800 bg-[#050506] px-3 py-2 font-mono text-xs text-zinc-500">
                workspace.env
              </div>
            </div>
          )}
        </div>

        <RuntimeEnvironmentReferenceTips language={language} scope={scope} />

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-zinc-600">KEY=value</span>
            <span className="font-mono text-[11px] text-zinc-600">
              {tr(language, '引用', 'refs')} {referenceCount}
            </span>
          </div>

          <div className="relative min-h-[18rem] overflow-hidden rounded-lg border border-zinc-800 bg-[#050506] lg:min-h-[20rem]">
            <pre
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-px overflow-hidden py-3 text-left tabular-nums',
                ENV_EDITOR_TEXT_CLASS_NAME,
              )}
            >
              <code
                className="block min-w-full"
                style={{
                  transform: `translate(${-editorScroll.left}px, ${-editorScroll.top}px)`,
                }}
              >
                {highlightedLines.map((line, index) => (
                  <span key={`${index}-${line.length}`}>
                    {renderRuntimeEnvironmentLineHighlight(line, index + 1, issueLines)}
                  </span>
                ))}
              </code>
            </pre>
            <Textarea
              value={content}
              onScroll={(event) => {
                setEditorScroll({
                  left: event.currentTarget.scrollLeft,
                  top: event.currentTarget.scrollTop,
                })
              }}
              onChange={(event) => onChange({
                mode,
                fileName: mode === 'env-file' ? fileName : config?.fileName,
                content: event.target.value,
              })}
              placeholder={ENV_EDITOR_PLACEHOLDER}
              spellCheck={false}
              className={cn(
                'relative z-10 min-h-[18rem] resize-y rounded-lg !border-0 !bg-transparent px-4 py-3 text-transparent shadow-none caret-zinc-100 selection:bg-sky-500/30 placeholder:text-zinc-600 focus-visible:!border-0 focus-visible:ring-0 lg:min-h-[20rem]',
                ENV_EDITOR_TEXT_CLASS_NAME,
              )}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-zinc-800/50 bg-[#050506]/50 px-4 py-2 text-xs text-zinc-500">
        <span className="text-zinc-600">
          {variableCount} {tr(language, '项', 'vars')}
          {referenceCount > 0 ? (
            <span className="ml-2 text-violet-400/80">
              · {referenceCount} {tr(language, '处引用', 'refs')}
            </span>
          ) : null}
        </span>
        {issues.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-amber-300">
            <AlertTriangle className="h-3 w-3" />
            {issues[0]?.message}
          </span>
        ) : null}
      </div>

      <Dialog open={fileImportOpen} onOpenChange={setFileImportOpen}>
        <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 sm:max-w-[42rem]">
          <DialogHeader>
            <DialogTitle>{activeFileImportSource?.dialogTitle || tr(language, '读取项目目录文件', 'Read Project File')}</DialogTitle>
            <DialogDescription className="text-zinc-400">
              {activeFileImportSource?.dialogDescription || tr(language, '从项目原始目录选择文件，读取后覆盖当前环境变量内容。', 'Choose a file from the project directory and replace the current runtime env content.')}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-[#050506] px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                if (parentPath) {
                  void loadDirectory(parentPath)
                }
              }}
              disabled={!parentPath || directoryLoading}
              className="size-8 rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            >
              <ChevronLeft />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs text-zinc-300" title={directoryPath}>
                {directoryPath || tr(language, '正在解析项目目录...', 'Resolving project directory...')}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void loadDirectory(directoryPath || '', { forceResolveRoot: !directoryPath })}
              disabled={directoryLoading}
              className="size-8 rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            >
              <RefreshCw className={directoryLoading ? 'animate-spin' : ''} />
            </Button>
          </div>

          <ScrollArea className="h-[22rem] rounded-lg border border-zinc-800 bg-[#050506]">
            <div className="p-2">
              {directoryLoading ? (
                <div className="flex items-center gap-2 px-3 py-6 text-sm text-zinc-400">
                  <Loader2 className="animate-spin" />
                  {tr(language, '正在读取目录...', 'Loading directory...')}
                </div>
              ) : directoryError ? (
                <div className="px-3 py-6 text-sm text-amber-300">{directoryError}</div>
              ) : sortedEntries.length === 0 ? (
                <div className="px-3 py-6 text-sm text-zinc-500">
                  {tr(language, '当前目录没有可读取的文件。', 'This directory has no readable files.')}
                </div>
              ) : (
                <div className="space-y-1">
                  {sortedEntries.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      onClick={() => {
                        if (entry.kind === 'directory') {
                          void loadDirectory(entry.path)
                          return
                        }

                        void handleImportFile(entry.path)
                      }}
                      disabled={directoryLoading || fileImportingPath === entry.path}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-900 disabled:opacity-60"
                    >
                      {entry.kind === 'directory' ? (
                        <Folder className="shrink-0 text-zinc-500" />
                      ) : (
                        <FileText className="shrink-0 text-zinc-500" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      {fileImportingPath === entry.path ? <Loader2 className="shrink-0 animate-spin text-zinc-500" /> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  )
}
