// [INPUT]: 标题输入
// [OUTPUT]: 标题契约
// [POS]: 工作区标题类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

const WORKSPACE_TITLE_LIMIT = 32

const normalizeTitleWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim()

export const buildWorkspaceNameFromInitialPrompt = (initialPrompt: string) => {
  const firstLine = initialPrompt
    .trim()
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim() ?? ''
  const normalized = normalizeTitleWhitespace(firstLine.replace(/^[#>\-\s\d.)]+/, ''))
  const title = Array.from(normalized).slice(0, WORKSPACE_TITLE_LIMIT).join('').trim()
  return title || Array.from(initialPrompt.trim()).slice(0, WORKSPACE_TITLE_LIMIT).join('').trim()
}

export const buildWorkspaceTitleFallback = (
  initialPrompt: string,
  imageFilename?: string,
  fallbackTitle?: string,
) => {
  return buildWorkspaceNameFromInitialPrompt(initialPrompt)
    || imageFilename?.replace(/\.[^.]+$/, '').trim()
    || fallbackTitle?.trim()
    || ''
}

export const truncateWorkspaceTitle = (title: string) => {
  return Array.from(normalizeTitleWhitespace(title)).slice(0, WORKSPACE_TITLE_LIMIT).join('').trim()
}
