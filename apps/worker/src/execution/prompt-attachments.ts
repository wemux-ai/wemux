// [INPUT]: prompt 附件（图片等）
// [OUTPUT]: 物化附件
// [POS]: prompt 附件物化
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'

export type MaterializedPromptAttachment = TaskChatAttachment & {
  absoluteUrl: string
  localPath: string
}

const CONTENT_TYPE_EXTENSION: Record<string, string> = {
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
}

const sanitizeFilename = (filename: string, fallback: string) => {
  const parsed = path.parse(filename)
  const safeName = (parsed.name || fallback).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  const safeExt = (parsed.ext || '').replace(/[^a-zA-Z0-9.]+/g, '')
  return `${safeName || fallback}${safeExt}`
}

const resolveAttachmentUrl = (cloudUrl: string | undefined, attachmentUrl: string) => {
  const normalizedCloudUrl = (cloudUrl || '').replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
  if (/^https?:\/\//i.test(attachmentUrl)) {
    return attachmentUrl
  }
  if (!normalizedCloudUrl) {
    throw new Error('当前 worker 未配置 cloudUrl，无法下载图片附件。')
  }
  return new URL(attachmentUrl, normalizedCloudUrl).toString()
}

const resolveFileExtension = (filename: string, contentType?: string) => {
  const existing = path.extname(filename)
  if (existing) {
    return existing
  }
  return contentType ? (CONTENT_TYPE_EXTENSION[contentType] || '') : ''
}

export const materializePromptAttachments = async (params: {
  attachments?: TaskChatAttachment[]
  cloudUrl?: string
  signal?: AbortSignal
}) => {
  const attachments = params.attachments ?? []
  if (attachments.length === 0) {
    return {
      attachments: [] as MaterializedPromptAttachment[],
      cleanup: async () => {},
    }
  }

  const tempRoot = path.join(os.tmpdir(), 'vibemux-task-chat-attachments-')
  await mkdir(path.dirname(tempRoot), { recursive: true })
  const tempDir = await mkdtemp(tempRoot)

  try {
    const materialized = await Promise.all(attachments.map(async (attachment, index) => {
      const absoluteUrl = resolveAttachmentUrl(params.cloudUrl, attachment.url)
      const response = await fetch(absoluteUrl, {
        signal: params.signal,
      })
      if (!response.ok) {
        throw new Error(`图片附件下载失败：${attachment.filename}`)
      }

      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || attachment.contentType
      const extension = resolveFileExtension(attachment.filename, contentType)
      const localFilename = sanitizeFilename(`${index + 1}-${attachment.filename || `image-${index + 1}`}${extension && !attachment.filename.endsWith(extension) ? extension : ''}`, `image-${index + 1}`)
      const localPath = path.join(tempDir, localFilename)
      const buffer = Buffer.from(await response.arrayBuffer())
      await writeFile(localPath, buffer)

      return {
        ...attachment,
        contentType,
        absoluteUrl,
        localPath,
      } satisfies MaterializedPromptAttachment
    }))

    return {
      attachments: materialized,
      cleanup: async () => {
        await rm(tempDir, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export const injectPromptAttachments = (
  prompt: string,
  attachments: MaterializedPromptAttachment[],
) => {
  if (attachments.length === 0) {
    return prompt
  }

  const header = '用户在本轮消息中附带了图片附件，请优先结合这些图片继续分析和回答。'
  const attachmentLines = attachments.flatMap((attachment, index) => [
    `附件 ${index + 1}: ${attachment.filename}`,
    `- 本地路径: ${attachment.localPath}`,
    `- 来源 URL: ${attachment.absoluteUrl}`,
  ])

  const driveReferenceLines = attachments.flatMap((attachment, index) => {
    if (attachment.kind !== 'drive' || !attachment.driveFileId) {
      return []
    }
    const scopeText = attachment.driveWorkspaceId
      ? `workspaceId: ${attachment.driveWorkspaceId}`
      : 'personal: true'
    return [
      `附件 ${index + 1} 是 Drive 云盘文件引用（fileId: ${attachment.driveFileId}，${scopeText}），非上传副本。`,
      `如需修改并用 drive.write_file 写回原文件，先读取 vibemux-drive-writeback skill 的读写回方法。`,
    ]
  })

  return [
    prompt.trim(),
    '',
    header,
    ...attachmentLines,
    ...(driveReferenceLines.length > 0 ? ['', ...driveReferenceLines] : []),
    '',
    '这些附件位于当前机器的临时目录，不属于仓库文件。',
  ].filter(Boolean).join('\n')
}
