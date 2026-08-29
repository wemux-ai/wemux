// [INPUT]: 文件元信息与内容
// [OUTPUT]: 全文搜索辅助纯函数（文本提取 + 命中片段）
// [POS]: Drive 搜索纯函数层；提取的文本存 drive_files.search_text，搜索用 ILIKE 匹配
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

const SEARCH_TEXT_MAX_LENGTH = 100_000

const TEXTUAL_EXTENSION = /\.(md|markdown|html?|txt|json|csv|xml|yml|yaml|log)$/i

/** 判断文件是否可提取文本（可读文本类） */
export const isTextualFile = (mimeType: string | null, name: string): boolean => {
  return Boolean(mimeType?.startsWith('text/')) || TEXTUAL_EXTENSION.test(name)
}

/** 从文件内容提取纯文本（HTML 去标签；超长截断）；不可提取返回 null */
export const extractSearchText = (mimeType: string | null, name: string, content: string): string | null => {
  if (!isTextualFile(mimeType, name)) return null
  let text = content
  if (mimeType === 'text/html' || /\.html?$/i.test(name)) {
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
  if (!text) return null
  return text.slice(0, SEARCH_TEXT_MAX_LENGTH)
}

/** 命中片段：在文本中定位 query，截取前后文 */
export const buildSearchSnippet = (searchText: string | null, query: string, radius = 60): string | null => {
  if (!searchText) return null
  const index = searchText.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return null
  const start = Math.max(0, index - radius)
  const end = Math.min(searchText.length, index + query.length + radius)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < searchText.length ? '…' : ''
  return `${prefix}${searchText.slice(start, end)}${suffix}`
}
