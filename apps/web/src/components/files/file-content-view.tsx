// [INPUT]: 文件名 + 纯文本内容（不依赖任何后端来源，executor 与 Drive 均可用）
// [OUTPUT]: 只读代码高亮视图 CodeContentView、图片视图 ImageContentView，及文件名/扩展名/语言判定工具函数
// [POS]: 文件预览渲染层的共享底座；workspace-file-preview.tsx（executor 文件）与 drive-file-preview.tsx（Drive 文件）都基于此渲染代码/图片
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useMemo, type CSSProperties } from 'react'
import { FileImage } from 'lucide-react'
import { cn } from '../../lib/utils'
import { PreviewableImage } from '../ui/previewable-image'

const LINE_GUTTER_WIDTH = '4rem'

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: 'shell',
  cjs: 'javascript',
  css: 'css',
  dockerfile: 'dockerfile',
  env: 'env',
  go: 'go',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  less: 'css',
  log: 'text',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sass: 'css',
  scss: 'css',
  sh: 'shell',
  sql: 'sql',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'typescript',
  txt: 'text',
  xml: 'html',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'shell',
}

const CODE_KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
  'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for', 'from', 'function',
  'if', 'implements', 'import', 'in', 'interface', 'let', 'new', 'null', 'of', 'private',
  'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try',
  'type', 'typeof', 'undefined', 'var', 'void', 'while', 'yield',
])

const SHELL_KEYWORDS = new Set(['case', 'do', 'done', 'elif', 'else', 'esac', 'fi', 'for', 'function', 'if', 'in', 'then', 'while'])
const SQL_KEYWORDS = new Set(['and', 'as', 'by', 'create', 'delete', 'from', 'group', 'insert', 'join', 'left', 'limit', 'not', 'null', 'on', 'or', 'order', 'right', 'select', 'set', 'table', 'update', 'values', 'where'])

export const getFileName = (filePath: string) => filePath.split('/').filter(Boolean).pop() || filePath

export const getFileExtension = (filePath: string) => {
  const basename = getFileName(filePath)
  if (/^dockerfile$/i.test(basename)) {
    return 'dockerfile'
  }
  const parts = basename.split('.')
  return parts.length > 1 ? parts.pop()?.toLowerCase() || '' : ''
}

export const isCodeLikeFileName = (filePath: string) => getFileExtension(filePath) in LANGUAGE_BY_EXTENSION

const getLanguageForFile = (filePath: string) => LANGUAGE_BY_EXTENSION[getFileExtension(filePath)] ?? 'text'

const normalizeSearchQuery = (value?: string) => value?.trim().toLowerCase() || ''

const splitBySearchQuery = (text: string, searchQuery?: string) => {
  const query = normalizeSearchQuery(searchQuery)
  if (!query) {
    return [{ text, match: false }]
  }

  const lowerText = text.toLowerCase()
  const segments: Array<{ text: string; match: boolean }> = []
  let cursor = 0
  while (cursor < text.length) {
    const index = lowerText.indexOf(query, cursor)
    if (index < 0) {
      segments.push({ text: text.slice(cursor), match: false })
      break
    }
    if (index > cursor) {
      segments.push({ text: text.slice(cursor, index), match: false })
    }
    segments.push({ text: text.slice(index, index + query.length), match: true })
    cursor = index + query.length
  }

  return segments.length > 0 ? segments : [{ text, match: false }]
}

function SearchHighlightedText({
  text,
  searchQuery,
  className,
}: {
  text: string
  searchQuery?: string
  className?: string
}) {
  return (
    <>
      {splitBySearchQuery(text, searchQuery).map((segment, index) => segment.match ? (
        <mark
          key={`${index}:${segment.text}`}
          className={cn(className, 'rounded-sm bg-amber-400/25 px-0.5 text-amber-100')}
        >
          {segment.text}
        </mark>
      ) : (
        <span key={`${index}:${segment.text}`} className={className}>
          {segment.text}
        </span>
      ))}
    </>
  )
}

const findLineCommentIndex = (line: string, language: string) => {
  if (language === 'json') {
    return -1
  }
  if (language === 'shell' || language === 'python' || language === 'ruby' || language === 'yaml' || language === 'toml' || language === 'env') {
    return line.indexOf('#')
  }
  if (language === 'sql') {
    return line.indexOf('--')
  }
  return line.indexOf('//')
}

const renderPlainCodeSegment = (text: string, language: string, searchQuery?: string) => {
  const keywordSet = language === 'shell'
    ? SHELL_KEYWORDS
    : language === 'sql'
      ? SQL_KEYWORDS
      : CODE_KEYWORDS
  const parts = text.split(/(\b[A-Za-z_$][\w$-]*\b|\b\d+(?:\.\d+)?\b)/g)

  return parts.map((part, index) => {
    if (!part) {
      return null
    }

    const lowerPart = part.toLowerCase()
    const className = keywordSet.has(language === 'sql' ? lowerPart : part)
      ? 'text-sky-300'
      : /^(true|false|null|undefined)$/.test(lowerPart)
        ? 'text-violet-300'
        : /^\d/.test(part)
          ? 'text-emerald-300'
          : /^[A-Z][\w$-]*$/.test(part)
            ? 'text-fuchsia-300'
            : undefined

    return (
      <SearchHighlightedText
        key={`${index}:${part}`}
        text={part}
        searchQuery={searchQuery}
        className={className}
      />
    )
  })
}

function CodeLine({
  line,
  language,
  searchQuery,
}: {
  line: string
  language: string
  searchQuery?: string
}) {
  const commentIndex = findLineCommentIndex(line, language)
  const codePart = commentIndex >= 0 ? line.slice(0, commentIndex) : line
  const commentPart = commentIndex >= 0 ? line.slice(commentIndex) : ''
  const segments = codePart.split(/((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`))/g)

  return (
    <>
      {segments.map((segment, index) => {
        if (!segment) {
          return null
        }
        if (/^["'`]/.test(segment)) {
          return (
            <SearchHighlightedText
              key={`${index}:${segment}`}
              text={segment}
              searchQuery={searchQuery}
              className="text-emerald-300"
            />
          )
        }
        return (
          <span key={`${index}:${segment}`}>
            {renderPlainCodeSegment(segment, language, searchQuery)}
          </span>
        )
      })}
      {commentPart ? (
        <SearchHighlightedText
          text={commentPart}
          searchQuery={searchQuery}
          className="text-zinc-500"
        />
      ) : null}
    </>
  )
}

export function ImageContentView({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="min-h-full">
      <div className="flex min-h-[20rem] items-center justify-center bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_38%),linear-gradient(180deg,rgba(15,23,42,0.25),rgba(2,6,23,0.02))] p-5">
        {src ? (
          <PreviewableImage
            src={src}
            alt={alt}
            triggerClassName="max-w-full"
            imageClassName="max-h-[26rem] w-auto max-w-full rounded-xl border border-zinc-800 bg-zinc-950 object-contain shadow-2xl shadow-black/30"
            previewImageClassName="bg-zinc-950"
          />
        ) : (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <FileImage className="h-4 w-4" />
            当前图片没有可预览内容。
          </div>
        )}
      </div>
    </div>
  )
}

export function CodeContentView({
  fileName,
  content,
  searchQuery,
}: {
  fileName: string
  content: string
  searchQuery?: string
}) {
  const lines = useMemo(() => content.replace(/\r\n/g, '\n').split('\n'), [content])
  const language = getLanguageForFile(fileName)

  return (
    <div className="min-h-full">
      <div className="overflow-auto bg-[#090b10]">
        <div className="min-w-max py-3 font-mono text-[12px] leading-6 text-zinc-200">
          {lines.map((line, index) => (
            <div
              key={`${index}:${line}`}
              className="grid grid-cols-[var(--workspace-file-line-gutter)_minmax(0,1fr)] items-start hover:bg-white/[0.03]"
              style={{ '--workspace-file-line-gutter': LINE_GUTTER_WIDTH } as CSSProperties}
            >
              <span
                className="select-none border-r border-zinc-800/80 px-3 text-right text-zinc-500"
              >
                {index + 1}
              </span>
              <span className="whitespace-pre px-4">
                {line ? (
                  <CodeLine
                    line={line}
                    language={language}
                    searchQuery={searchQuery}
                  />
                ) : ' '}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
