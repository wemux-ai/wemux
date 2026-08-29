// [INPUT]: OpenCode 配置输入
// [OUTPUT]: 配置契约
// [POS]: OpenCode 配置
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

const stripJsonComments = (content: string) => {
  let result = ''
  let inString = false
  let stringQuote = '"'
  let escaping = false

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const next = content[index + 1]

    if (inString) {
      result += char
      if (escaping) {
        escaping = false
        continue
      }
      if (char === '\\') {
        escaping = true
        continue
      }
      if (char === stringQuote) {
        inString = false
      }
      continue
    }

    if (char === '"' || char === '\'') {
      inString = true
      stringQuote = char
      result += char
      continue
    }

    if (char === '/' && next === '/') {
      index += 2
      while (index < content.length && content[index] !== '\n') {
        index += 1
      }
      if (index < content.length) {
        result += content[index]
      }
      continue
    }

    if (char === '/' && next === '*') {
      index += 2
      while (index < content.length - 1 && !(content[index] === '*' && content[index + 1] === '/')) {
        index += 1
      }
      index += 1
      continue
    }

    result += char
  }

  return result
}

const stripTrailingCommas = (content: string) => {
  let result = ''
  let inString = false
  let stringQuote = '"'
  let escaping = false

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]

    if (inString) {
      result += char
      if (escaping) {
        escaping = false
        continue
      }
      if (char === '\\') {
        escaping = true
        continue
      }
      if (char === stringQuote) {
        inString = false
      }
      continue
    }

    if (char === '"' || char === '\'') {
      inString = true
      stringQuote = char
      result += char
      continue
    }

    if (char === ',') {
      let lookahead = index + 1
      while (lookahead < content.length && /\s/.test(content[lookahead])) {
        lookahead += 1
      }
      if (content[lookahead] === '}' || content[lookahead] === ']') {
        continue
      }
    }

    result += char
  }

  return result
}

const normalizeJsonLikeContent = (content: string) => {
  return stripTrailingCommas(stripJsonComments(content))
}

export const parseOpencodeConfigContent = (content?: string) => {
  const normalized = content?.trim()
  if (!normalized) {
    return {}
  }

  try {
    const parsed = JSON.parse(normalizeJsonLikeContent(normalized)) as Record<string, unknown>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    throw new Error(error instanceof Error ? `OpenCode 配置 JSON/JSONC 无效：${error.message}` : 'OpenCode 配置 JSON/JSONC 无效')
  }
}
