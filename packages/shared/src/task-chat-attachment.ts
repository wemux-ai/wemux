/**
 * [INPUT]: Unknown attachment metadata from task chat and task comment boundaries.
 * [OUTPUT]: Normalized attachment records plus shared comment upload limits.
 * [POS]: Pure cross-runtime attachment contract; object upload remains server-owned.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { isRecord } from './utils'

export const TASK_COMMENT_ATTACHMENT_LIMIT = 5
export const TASK_COMMENT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024

export interface TaskChatAttachment {
  id: string
  url: string
  filename: string
  contentType?: string
  /** 'file'（上传副本，默认）| 'drive'（Drive 文件引用——Agent 读取原文件，改动回写 Drive） */
  kind?: 'file' | 'drive'
  /** kind === 'drive' 时的 Drive 文件记录 id（写回原文件用） */
  driveFileId?: string
  /** kind === 'drive' 时的归属组织（null = 个人文件；写回 drive.write_file 需 scope） */
  driveWorkspaceId?: string | null
}

export const normalizeTaskChatAttachments = (value: unknown): TaskChatAttachment[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return []
    }

    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const url = typeof item.url === 'string' ? item.url.trim() : ''
    const filename = typeof item.filename === 'string' ? item.filename.trim() : ''
    const contentType = typeof item.contentType === 'string' ? item.contentType.trim() : undefined
    if (!id || !url || !filename) {
      return []
    }

    const kind = item.kind === 'drive' ? 'drive' : 'file'
    const driveFileId = typeof item.driveFileId === 'string' && item.driveFileId.trim()
      ? item.driveFileId.trim()
      : undefined

    const driveWorkspaceId = typeof item.driveWorkspaceId === 'string' && item.driveWorkspaceId.trim()
      ? item.driveWorkspaceId.trim()
      : null

    return [{
      id,
      url,
      filename,
      contentType: contentType || undefined,
      kind,
      ...(kind === 'drive' && driveFileId ? { driveFileId } : {}),
      ...(kind === 'drive' ? { driveWorkspaceId } : {}),
    } satisfies TaskChatAttachment]
  })
}
