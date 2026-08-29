// [INPUT]: 用户消息文本 + 用户可访问的 Drive 作用域列表
// [OUTPUT]: 消息内 `@文档名` 命中的 Drive 文档引用列表（完整 token 匹配，去重）
// [POS]: 聊天 @ 文档（reference_doc）解析；三条发送链路（群聊 / DM / 主聊天）复用
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ChatDocReference } from '@shared/chat-mentions'
import { searchDriveFiles, type DriveScope } from '../repositories/drive-store'

/** 从消息里提取 `@名字` token（支持中文等非空白字符，忽略紧邻空白/标点）。 */
export const collectMentionNameTokens = (message: string): string[] => {
  const tokens: string[] = []
  const matcher = /(^|[\s([{，。！？!?,;:;：（）()])@([^\s@，。！？!?,;:;：（）()]+)/gu
  let match = matcher.exec(message)
  while (match) {
    const name = match[2]?.trim()
    if (name && !name.includes('@')) {
      tokens.push(name)
    }
    match = matcher.exec(message)
  }
  return tokens
}

/**
 * 解析消息内 `@文档名` 命中的 Drive 文档。
 * 对每个 @token 在各 scope 下按名字搜索，取完整同名命中（同 token 多 scope 多文件时全部保留，
 * 便于引用同名文件），按消息内出现顺序返回，按文件 id 去重。
 */
export const resolveMentionedDocRefs = async (params: {
  message: string
  scopes: DriveScope[]
}): Promise<ChatDocReference[]> => {
  const { message, scopes } = params
  if (!message.includes('@') || scopes.length === 0) {
    return []
  }

  const nameTokens = collectMentionNameTokens(message)
  if (nameTokens.length === 0) {
    return []
  }

  const seenIds = new Set<string>()
  const refs: ChatDocReference[] = []
  for (const name of nameTokens) {
    for (const scope of scopes) {
      // searchDriveFiles 按 name ILIKE 匹配（name + searchText），取完整同名命中。
      const results = await searchDriveFiles(scope, name)
      for (const file of results) {
        if (file.fileType === 'folder' || file.name.trim() !== name) {
          continue
        }
        if (seenIds.has(file.id)) {
          continue
        }
        seenIds.add(file.id)
        refs.push({
          id: file.id,
          name: file.name,
          workspaceId: scope.workspaceId,
        })
      }
    }
  }

  return refs
}
