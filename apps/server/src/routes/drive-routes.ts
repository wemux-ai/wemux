// [INPUT]: 已鉴权 Hono app + 用户/组织成员身份
// [OUTPUT]: /api/collab/workspaces/:workspaceId/drive/*（团队）+ /api/my/drive/*（个人）Drive 路由
// [POS]: Drive 云盘 HTTP 协议层；团队域鉴权 isWorkspaceMember，个人域鉴权本人；文件级访问向上溯源 workspace 归属；
//       文本文件新建/内容保存走 POST /text-files + PUT /:id/content（JSON，配额/上限校验 + 工作记录），笔记等文本落盘统一入口；
//       手动删除走软删入回收站（子树一并软删），30 天后由 drive-lifecycle-service 物理删除
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Context, Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import type { DriveFileContentType, DriveFilePermissionRecord, DriveFileRecord, DrivePermissionRole, Task } from '@shared/types'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import { extractSearchText } from '@shared/drive-search'
import { isWorkspaceMember, getWorkspaceById } from '../repositories/workspace'
import { listAllUsers, searchUsers } from '../storage/postgres/auth-store'
import {
  collectDescendants,
  createDriveFolder,
  hasRoleLevel,
  listAllDriveFiles,
  listAllDriveFilesIncludingTrashed,
  listDriveChildren,
  listDriveFileVersions,
  listDrivePermissions,
  listTrashedDriveFiles,
  moveDriveFilesAcrossScopes,
  clearDriveFileGrants,
  registerDriveFile,
  removeDrivePermission,
  resolveEffectiveRole,
  restoreDriveFile,
  setDrivePermission,
  softDeleteDriveFile,
  sumDriveStorageUsed,
  updateDriveFile,
  updateDriveFileContent,
} from '../repositories/drive-store'
import {
  deleteDriveShare,
  getDriveFileById,
  getDriveShare,
  getDriveShareByToken,
  searchDriveFiles,
  upsertDriveShare,
} from '../repositories/drive-store'
import { buildDriveObjectKey, streamDriveObject, uploadDriveObject } from '../services/drive-storage'
import { listObjectPrefix, streamObject, sumObjectPrefixSize } from '../services/object-storage'
import { registerDriveFileReference } from '../repositories/drive-store'
import { buildDriveAttachmentToken, parseDriveAttachmentToken } from '../services/drive-attachment-token'
import { filterVisibleUserIds } from '../services/user-visibility-service'
import { appendTaskConversationMessage } from '../control-plane/conversation-service'
import { createWorkRecord } from '../repositories/profile-store'
import { getUserIdFromHeader, getAuthorizedTask, jsonError } from './shared'
import { loadState, saveTaskAndWait } from '../storage/app-state-store'
import { getCommercialGate, type DriveQuotaAccess } from '../services/gate/commercial-gate'


type DriveScope = { workspaceId: string | null; userId: string }

/**
 * 生成 Drive 引用附件（8a）：校验用户对该 Drive 文件有 read 权限 → HMAC token 下载 URL + kind='drive'。
 * tokenScope 用于 token 绑定（任务/会话标识），下载端点只用 driveFileId。
 */
export const buildDriveReferenceAttachment = async (params: {
  driveFileId: string
  userId: string
  tokenScope: string
}): Promise<{ attachment: TaskChatAttachment; driveFileId: string } | { error: string; status: 400 | 403 | 500 }> => {
  const { role, target } = await resolveEffectiveRole(params.driveFileId, params.userId)
  if (!target || !role || !hasRoleLevel(role, 'read')) {
    return { error: '无权访问该 Drive 文件。', status: 403 }
  }
  if (target.fileType !== 'file' || !target.s3Key) {
    return { error: '仅文件可发送到会话。', status: 400 }
  }

  const token = buildDriveAttachmentToken({ taskId: params.tokenScope, driveFileId: target.id })
  if (!token) {
    return { error: '附件引用生成失败。', status: 500 }
  }

  return {
    attachment: {
      id: `drive-${target.id}`,
      url: `/api/drive-attachments/${token}/download`,
      filename: target.name,
      contentType: target.mimeType || undefined,
      kind: 'drive',
      driveFileId: target.id,
      driveWorkspaceId: target.workspaceId,
    },
    driveFileId: target.id,
  }
}

/** 云节点文件占用的 R2 前缀（计入配额）：团队 = workspaces/<wid>，个人 = users/<uid>/agents */
const resolveScopeCloudStoragePrefix = (scope: DriveScope) => {
  return scope.workspaceId
    ? `workspaces/${scope.workspaceId}`
    : `users/${scope.userId}/agents`
}

/** scope 已用云盘存储 = DB 记录和 + 云节点 R2 前缀和（R2 未配置/失败按 0 计） */
const resolveScopeStorageUsed = async (scope: DriveScope) => {
  const dbBytes = await sumDriveStorageUsed(scope)
  const cloudBytes = await sumObjectPrefixSize(resolveScopeCloudStoragePrefix(scope)).catch(() => 0)
  return dbBytes + cloudBytes
}

/**
 * 文本文件配额判定：与 upload 同一口径（团队域按工作区 owner 套餐，个人域按本人）。
 * existingSizeBytes 传入时按「覆盖」计算增量（新大小 - 旧大小计入总存储），避免覆盖大文件被重复计满。
 */
const resolveDriveQuotaCheck = async (scope: DriveScope, fileSizeBytes: number, existingSizeBytes: number | null = null): Promise<DriveQuotaAccess> => {
  const quotaOwnerUserId = scope.workspaceId
    ? (await getWorkspaceById(scope.workspaceId))?.ownerUserId || scope.userId
    : scope.userId
  const policy = await getCommercialGate().resolveBillingPolicySnapshot(quotaOwnerUserId)
  const usedStorageBytes = await resolveScopeStorageUsed(scope)
  const effectiveUsed = existingSizeBytes === null
    ? usedStorageBytes
    : Math.max(0, usedStorageBytes - existingSizeBytes)
  return getCommercialGate().buildDriveQuotaAccess({
    plan: policy.plan,
    fileSizeBytes,
    usedStorageBytes: effectiveUsed,
  })
}

// ---------- 云节点文件只读视图（直接读 R2 前缀，挂载即持久） ----------

const buildCloudFilesPrefix = (workspaceId: string) => `workspaces/${workspaceId}`

/** 个人域云节点文件根：用户私人 Agent 的执行前缀（与挂载 resolveCfSandboxDrivePrefix 一致） */
const buildPersonalCloudFilesPrefix = (userId: string) => `users/${userId}/agents`

/** 规范化云节点文件路径：拒绝 `..`/空段/绝对路径；返回 <base 前缀>/<path> 或空串（无效） */
export const resolveCloudFilesPrefixWithin = (basePrefix: string, rawPath: string) => {
  const normalized = rawPath.trim().replace(/^\/+|\/+$/g, '')
  if (!normalized) {
    return basePrefix
  }
  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return ''
  }
  return `${basePrefix}/${segments.join('/')}`
}

/** 规范化云节点文件路径：拒绝 `..`/空段/绝对路径；返回 <wid 前缀>/<path> 或空串（无效） */
export const resolveCloudFilesPrefix = (workspaceId: string, rawPath: string) => {
  return resolveCloudFilesPrefixWithin(buildCloudFilesPrefix(workspaceId), rawPath)
}

export const isCloudFileKeyWithinWorkspace = (workspaceId: string, key: string) => {
  const base = `${buildCloudFilesPrefix(workspaceId)}/`
  return key.startsWith(base) && !key.split('/').includes('..')
}

/** 个人域白名单：key 必须落在 users/<uid>/agents/ 前缀内 */
export const isCloudFileKeyWithinUser = (userId: string, key: string) => {
  const base = `${buildPersonalCloudFilesPrefix(userId)}/`
  return key.startsWith(base) && !key.split('/').includes('..')
}

type CloudFilesScope = {
  basePrefix: string
  within: (key: string) => boolean
}

const buildCloudFilesListHandler = (resolveScope: (c: Context) => Promise<CloudFilesScope | null>) => async (c: Context) => {
  const scope = await resolveScope(c)
  if (!scope) return jsonError(c, '无权访问。', 403)
  const prefix = resolveCloudFilesPrefixWithin(scope.basePrefix, c.req.query('path') || '')
  if (!prefix) {
    return jsonError(c, '路径无效。', 400)
  }
  try {
    const entries = await listObjectPrefix(prefix)
    return c.json({ entries })
  } catch (error) {
    return jsonError(c, error instanceof Error ? error.message : '读取云节点文件失败。', 502)
  }
}

const buildCloudFilesDownloadHandler = (resolveScope: (c: Context) => Promise<CloudFilesScope | null>) => async (c: Context) => {
  const scope = await resolveScope(c)
  if (!scope) return jsonError(c, '无权访问。', 403)
  const key = c.req.query('key') || ''
  if (!scope.within(key)) {
    return jsonError(c, '无效文件。', 400)
  }
  const fileName = key.split('/').pop() || 'file'
  const response = await streamObject(key)
  if (response.ok && fileName) {
    response.headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
  }
  return response
}

const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(255),
  parentId: z.string().trim().optional(),
})

const renameSchema = z.object({
  name: z.string().trim().min(1).max(255),
})

const moveSchema = z.object({
  parentId: z.string().trim().nullable(),
  /** 目标空间：跨区移动时传目标 workspaceId（null = 个人空间）；缺省 = 同区移动 */
  targetWorkspaceId: z.string().trim().nullable().optional(),
})

const MAX_UPLOAD_SIZE = 200 * 1024 * 1024 // 防御性硬上限 200MB（Team 档单文件上限）；按 plan 的细分限制由 Drive 配额判定

/** 文本文件 MIME 推断（与 MCP drive.write_file 同口径）：按扩展名，默认 text/plain */
export const inferTextFileMimeType = (fileName: string): string => {
  const name = fileName.toLowerCase()
  if (name.endsWith('.html')) return 'text/html'
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'text/markdown'
  return 'text/plain'
}

export const guessContentType = (mimeType: string | null, fileName: string): DriveFileContentType => {
  const mime = mimeType?.toLowerCase() ?? ''
  const name = fileName.toLowerCase()
  // 代码扩展名优先于 MIME 嗅探判定：浏览器会把 .ts 识别成 video/mp2t（MPEG 传输流），
  // 在开发协作场景下 .ts 几乎总是 TypeScript 源码，需先于 video/ 判断分支。
  if (/\.(js|ts|tsx|py|go|rs|java|c|cpp|sh|yaml|yml|toml)$/.test(name)) return 'code'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('text/') || mime.includes('markdown') || /\.(md|html?|txt|json|csv|pdf)$/.test(name)) return 'document'
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip') || /\.(zip|tar|gz|7z|rar)$/.test(name)) return 'archive'
  return 'other'
}

/** 目标文件角色校验：required 'read'（查看/下载）、'edit'（写操作）或 'manage'（权限管理） */
const assertFileAccess = async (scope: DriveScope, fileId: string, required: 'read' | 'edit' | 'manage' = 'read') => {
  const { role, target } = await resolveEffectiveRole(fileId, scope.userId)
  if (!target) {
    return { ok: false as const, status: 404 as const, message: '文件不存在。', role: null as DrivePermissionRole | null, target: null as DriveFileRecord | null }
  }
  if (!role || !hasRoleLevel(role, required)) {
    return { ok: false as const, status: 403 as const, message: '无权访问该文件。', role: null as DrivePermissionRole | null, target: null as DriveFileRecord | null }
  }
  return { ok: true as const, target, role }
}

/** 校验移动目标 parent 必须是同 scope 下的文件夹（需要 edit 权限） */
const assertFolderTarget = async (scope: DriveScope, parentId: string | null): Promise<boolean> => {
  if (!parentId) return true
  const access = await assertFileAccess(scope, parentId, 'edit')
  return access.ok && access.target.fileType === 'folder'
}

export type DriveMoveResolution =
  | { ok: true; targetWorkspaceId: string | null; movingAcrossScopes: boolean }
  | { ok: false; message: string; status: 400 | 401 | 403 | 404 | 409 | 500 | 502 }

/**
 * 移动目标空间解析 + 跨区权限决策（纯函数，可单测）：
 * 缺省或目标与当前归属一致 = 同区移动；个人 ↔ 协作 跨区移动要求 manage 级角色
 * （与飞书一致：只有所有者或有可管理权限的协作者可跨空间移动）。目标成员身份由调用方校验（需 DB）。
 */
export const resolveDriveMoveTarget = (params: {
  currentWorkspaceId: string | null
  role: DrivePermissionRole | null
  requestedTargetWorkspaceId?: string | null
}): DriveMoveResolution => {
  const targetWorkspaceId = params.requestedTargetWorkspaceId === undefined
    ? params.currentWorkspaceId
    : params.requestedTargetWorkspaceId
  const movingAcrossScopes = targetWorkspaceId !== params.currentWorkspaceId
  if (movingAcrossScopes && !hasRoleLevel(params.role, 'manage')) {
    return { ok: false, message: '仅文件所有者或有可管理权限的协作者可跨空间移动。', status: 403 }
  }
  return { ok: true, targetWorkspaceId, movingAcrossScopes }
}

const registerDriveScopeRoutes = (
  app: Hono,
  requireAuth: MiddlewareHandler,
  basePath: string,
  resolveScope: (c: Context) => Promise<DriveScope | null>,
) => {
  // 文件树（全部文件，前端组树）
  app.get(`${basePath}/tree`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const files = await listAllDriveFiles(scope)
    return c.json({ files })
  })

  // 回收站（R8.3 孤儿软删列表）：deletedAt 非空，按删除时间倒序
  app.get(`${basePath}/trash`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const files = await listTrashedDriveFiles(scope)
    return c.json({ files })
  })

  // 从回收站恢复（R8.3）：清空 deletedAt；文件夹连同子树一并恢复
  app.post(`${basePath}/trash/:id/restore`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const access = await assertFileAccess(scope, c.req.param('id'), 'read')
    if (!access.ok) return jsonError(c, access.message, access.status)
    if (!access.target.deletedAt) return jsonError(c, '文件不在回收站。', 409)
    const all = await listAllDriveFilesIncludingTrashed(scope)
    const descendants = access.target.fileType === 'folder' ? collectDescendants(all, access.target.id) : []
    const toRestore = [access.target, ...descendants]
    for (const file of toRestore) {
      await restoreDriveFile(file.id)
    }
    return c.json({ message: `已恢复 ${toRestore.length} 项。`, file: { ...access.target, deletedAt: null } })
  })

  // 创建文件夹
  app.post(`${basePath}/folders`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const parsed = createFolderSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, '文件夹名不能为空。', 400)
    const { name, parentId } = parsed.data
    if (parentId && !(await assertFolderTarget(scope, parentId))) return jsonError(c, '目标目录不存在。', 400)
    const folder = await createDriveFolder(scope.userId, { workspaceId: scope.workspaceId, parentId: parentId ?? null, name })
    return c.json({ file: folder }, 201)
  })

  // 子项列表 ?parentId=
  app.get(basePath, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const parentId = c.req.query('parentId') || null
    const files = await listDriveChildren(scope, parentId)
    return c.json({ files })
  })

  // 新建文本文件（便签笔记等）：JSON body { name, content, parentId? }，直接落 R2 + 登记元数据
  const textFileSchema = z.object({
    name: z.string().trim().min(1).max(255),
    content: z.string(),
    parentId: z.string().trim().optional(),
  })

  app.post(`${basePath}/text-files`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const parsed = textFileSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, '文件名不能为空。', 400)
    const { name, content, parentId } = parsed.data
    if (parentId && !(await assertFolderTarget(scope, parentId))) return jsonError(c, '目标目录不存在。', 400)

    const contentBytes = new TextEncoder().encode(content)
    if (contentBytes.byteLength > MAX_UPLOAD_SIZE) return jsonError(c, '文本文件不能超过 200MB。', 400)
    const quotaCheck = await resolveDriveQuotaCheck(scope, contentBytes.byteLength)
    if (!quotaCheck.allowed) return jsonError(c, quotaCheck.message, 400)

    const mimeType = inferTextFileMimeType(name)
    const key = buildDriveObjectKey(scope.workspaceId, scope.userId, name)
    await uploadDriveObject(key, contentBytes, mimeType)
    const record = await registerDriveFile(scope.userId, {
      workspaceId: scope.workspaceId,
      parentId: parentId ?? null,
      name,
      mimeType,
      sizeBytes: contentBytes.byteLength,
      s3Key: key,
      contentType: 'document',
      searchText: extractSearchText(mimeType, name, content),
    })
    // 工作记录：Drive 文件创建（旁路，不阻塞）
    void createWorkRecord({
      actorType: 'user',
      actorId: scope.userId,
      recordType: 'drive_file_created',
      targetType: 'drive_file',
      targetId: record.id,
      title: record.name,
      metadataJson: { workspaceId: scope.workspaceId },
    }).catch(() => {})
    return c.json({ file: record, message: '文件已创建。' }, 201)
  })

  // 上传（multipart：file + parentId）
  app.post(`${basePath}/upload`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return jsonError(c, '请选择要上传的文件。', 400)
    if (file.size > MAX_UPLOAD_SIZE) return jsonError(c, '单文件不能超过 200MB。', 400)

    // Drive 配额（§九）：团队域按工作区 owner 的套餐，个人域按本人；单文件上限 + 总存储
    const quotaOwnerUserId = scope.workspaceId
      ? (await getWorkspaceById(scope.workspaceId))?.ownerUserId || scope.userId
      : scope.userId
    const policy = await getCommercialGate().resolveBillingPolicySnapshot(quotaOwnerUserId)
    const usedStorageBytes = await resolveScopeStorageUsed(scope)
    const quotaAccess = getCommercialGate().buildDriveQuotaAccess({
      plan: policy.plan,
      fileSizeBytes: file.size,
      usedStorageBytes,
    })
    if (!quotaAccess.allowed) {
      return jsonError(c, quotaAccess.message, 400)
    }

    const parentIdRaw = form.get('parentId')
    const parentId = typeof parentIdRaw === 'string' && parentIdRaw ? parentIdRaw : null
    if (parentId && !(await assertFolderTarget(scope, parentId))) return jsonError(c, '目标目录不存在。', 400)

    const key = buildDriveObjectKey(scope.workspaceId, scope.userId, file.name)
    const buffer = await file.arrayBuffer()
    await uploadDriveObject(key, buffer, file.type || 'application/octet-stream')
    // 文本文件提取纯文本供全文搜索
    const searchText = file.size <= 1024 * 1024
      ? extractSearchText(file.type || null, file.name, new TextDecoder().decode(buffer))
      : null
    const record = await registerDriveFile(scope.userId, {
      workspaceId: scope.workspaceId,
      parentId,
      name: file.name,
      mimeType: file.type || null,
      sizeBytes: file.size,
      s3Key: key,
      contentType: guessContentType(file.type, file.name),
      searchText,
    })
    // 工作记录：Drive 文件创建（旁路，不阻塞上传）
    void createWorkRecord({
      actorType: 'user',
      actorId: scope.userId,
      recordType: 'drive_file_created',
      targetType: 'drive_file',
      targetId: record.id,
      title: record.name,
      metadataJson: { workspaceId: scope.workspaceId },
    }).catch(() => {})
    return c.json({ file: record, message: '上传成功。' }, 201)
  })

  // 全文搜索（scope 内，name + 提取文本）——必须在 /:id 之前注册，否则被文件信息路由吞掉
  app.get(`${basePath}/search`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const query = (c.req.query('q') ?? '').trim()
    if (!query) return c.json({ results: [] })
    const results = await searchDriveFiles(scope, query)
    return c.json({ results })
  })

  // 文件信息
  app.get(`${basePath}/:id`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const access = await assertFileAccess(scope, c.req.param('id'))
    if (!access.ok) return jsonError(c, access.message, access.status)
    return c.json({ file: access.target })
  })

  // 下载
  app.get(`${basePath}/:id/download`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const access = await assertFileAccess(scope, c.req.param('id'))
    if (!access.ok) return jsonError(c, access.message, access.status)
    if (access.target.fileType !== 'file' || !access.target.s3Key) return jsonError(c, '不是可下载的文件。', 400)
    return streamDriveObject(access.target.s3Key)
  })

  // 重命名
  app.put(`${basePath}/:id/rename`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const parsed = renameSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, '名称不能为空。', 400)
    const access = await assertFileAccess(scope, c.req.param('id'), 'edit')
    if (!access.ok) return jsonError(c, access.message, access.status)
    const updated = await updateDriveFile(access.target, { name: parsed.data.name })
    return c.json({ file: updated })
  })

  // 保存文本内容（便签笔记编辑）：JSON body { content }，旧内容入版本历史后换新对象键
  const textContentSchema = z.object({
    content: z.string(),
  })

  app.put(`${basePath}/:id/content`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const parsed = textContentSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, '参数错误。', 400)
    const access = await assertFileAccess(scope, c.req.param('id'), 'edit')
    if (!access.ok) return jsonError(c, access.message, access.status)
    if (access.target.fileType !== 'file') return jsonError(c, '文件夹不能写入内容。', 400)

    const contentBytes = new TextEncoder().encode(parsed.data.content)
    if (contentBytes.byteLength > MAX_UPLOAD_SIZE) return jsonError(c, '文本内容不能超过 200MB。', 400)
    const quotaCheck = await resolveDriveQuotaCheck(scope, contentBytes.byteLength, access.target.sizeBytes)
    if (!quotaCheck.allowed) return jsonError(c, quotaCheck.message, 400)

    const mimeType = access.target.mimeType || inferTextFileMimeType(access.target.name)
    const key = buildDriveObjectKey(scope.workspaceId, scope.userId, access.target.name)
    await uploadDriveObject(key, contentBytes, mimeType)
    const updated = await updateDriveFileContent(
      access.target,
      {
        s3Key: key,
        sizeBytes: contentBytes.byteLength,
        mimeType,
        searchText: extractSearchText(mimeType, access.target.name, parsed.data.content),
      },
      scope.userId,
    )
    // 工作记录：Drive 文件更新（旁路，不阻塞）
    void createWorkRecord({
      actorType: 'user',
      actorId: scope.userId,
      recordType: 'drive_file_updated',
      targetType: 'drive_file',
      targetId: updated.id,
      title: updated.name,
      metadataJson: { workspaceId: scope.workspaceId },
    }).catch(() => {})
    return c.json({ file: updated, message: '文件已保存。' })
  })

  // 移动（同区或跨区：跨区 = 个人 ↔ 协作，递归变更子树归属；跨区需要源文件 manage 权限 + 目标空间可加入）
  app.put(`${basePath}/:id/move`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const parsed = moveSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, '参数错误。', 400)
    const access = await assertFileAccess(scope, c.req.param('id'), 'edit')
    if (!access.ok) return jsonError(c, access.message, access.status)
    if (access.target.id === parsed.data.parentId) return jsonError(c, '不能移动到自身。', 400)

    // 目标空间解析：缺省或与当前一致 = 同区移动；否则跨区（个人 ↔ 协作，需要 manage 角色）
    const moveResolution = resolveDriveMoveTarget({
      currentWorkspaceId: access.target.workspaceId,
      role: access.role,
      requestedTargetWorkspaceId: parsed.data.targetWorkspaceId,
    })
    if (!moveResolution.ok) return jsonError(c, moveResolution.message, moveResolution.status)
    const { targetWorkspaceId, movingAcrossScopes } = moveResolution
    const targetScope: DriveScope = { workspaceId: targetWorkspaceId, userId: scope.userId }

    // 移入协作空间还需是目标 workspace 成员（防普通成员把团队文件顺进个人空间）
    if (movingAcrossScopes && targetWorkspaceId !== null && !(await isWorkspaceMember(targetWorkspaceId, scope.userId))) {
      return jsonError(c, '你不是目标协作空间的成员。', 403)
    }

    // 目标目录必须属于目标空间且可编辑；同时防循环：目标不能是自身或子孙目录
    if (parsed.data.parentId && !(await assertFolderTarget(targetScope, parsed.data.parentId))) {
      return jsonError(c, '目标目录不存在。', 400)
    }
    if (parsed.data.parentId && access.target.fileType === 'folder') {
      const all = await listAllDriveFiles(scope)
      const descendants = collectDescendants(all, access.target.id)
      if (descendants.some((d) => d.id === parsed.data.parentId)) {
        return jsonError(c, '不能移动到自身的子目录。', 400)
      }
    }

    // 跨区移动：递归变更整棵子树归属 + 校验目标空间配额（子树全部字节）+ 协作→个人清空授权
    if (movingAcrossScopes) {
      const all = await listAllDriveFiles(scope)
      const descendants = access.target.fileType === 'folder' ? collectDescendants(all, access.target.id) : []
      const affectedIds = [access.target.id, ...descendants.map((d) => d.id)]
      const subtreeBytes = affectedIds.reduce((sum, id) => {
        const f = all.find((x) => x.id === id)
        return sum + (f?.fileType === 'file' ? (f.sizeBytes ?? 0) : 0)
      }, 0)
      const quotaCheck = await resolveDriveQuotaCheck(targetScope, subtreeBytes)
      if (!quotaCheck.allowed) return jsonError(c, quotaCheck.message, 400)
      // 自身一次写：parentId + 归属；子树（不含自身）批量归属，避免树断裂
      const updated = await updateDriveFile(access.target, {
        parentId: parsed.data.parentId,
        workspaceId: targetWorkspaceId,
        ...(targetWorkspaceId === null ? { createdBy: scope.userId } : {}),
      })
      if (descendants.length > 0) {
        await moveDriveFilesAcrossScopes(descendants.map((d) => d.id), {
          workspaceId: targetWorkspaceId,
          ...(targetWorkspaceId === null ? { createdBy: scope.userId } : {}),
        })
      }
      if (targetWorkspaceId === null) await clearDriveFileGrants(affectedIds)
      return c.json({ file: updated })
    }

    const updated = await updateDriveFile(access.target, { parentId: parsed.data.parentId })
    return c.json({ file: updated })
  })

  // 删除（软删入回收站：子树一并软删，不立即删 R2 对象与记录；30 天后由生命周期服务物理删除）
  app.delete(`${basePath}/:id`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const access = await assertFileAccess(scope, c.req.param('id'), 'edit')
    if (!access.ok) return jsonError(c, access.message, access.status)
    const all = await listAllDriveFilesIncludingTrashed(scope)
    const descendants = collectDescendants(all, access.target.id)
    const toTrash = [access.target, ...descendants]
    for (const file of toTrash) {
      await softDeleteDriveFile(file.id)
    }
    return c.json({ message: `已移入回收站 ${toTrash.length} 项。` })
  })

  // 版本历史
  app.get(`${basePath}/:id/versions`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const access = await assertFileAccess(scope, c.req.param('id'))
    if (!access.ok) return jsonError(c, access.message, access.status)
    const versions = await listDriveFileVersions(access.target.id)
    return c.json({ versions })
  })

  // 权限列表（read 即可查看）
  app.get(`${basePath}/:id/permissions`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const access = await assertFileAccess(scope, c.req.param('id'), 'read')
    if (!access.ok) return jsonError(c, access.message, access.status)
    const permissions = await listDrivePermissions(access.target.id)
    return c.json({ permissions })
  })

  // 设置协作者（需 manage 权限）：{ principalType: 'user'|'agent', principalId, role: 'read'|'edit'|'manage' }
  app.put(`${basePath}/:id/permissions`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const parsed = z.object({
      principalType: z.enum(['user', 'agent']),
      principalId: z.string().min(1),
      role: z.enum(['read', 'edit', 'manage']),
    }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, '参数错误。', 400)
    const access = await assertFileAccess(scope, c.req.param('id'), 'manage')
    if (!access.ok) return jsonError(c, access.message, access.status)
    const permission = await setDrivePermission({
      fileId: access.target.id,
      principalType: parsed.data.principalType,
      principalId: parsed.data.principalId,
      role: parsed.data.role,
      createdBy: scope.userId,
    })
    return c.json({ permission })
  })

  // 移除协作者（需 manage 权限）
  app.delete(`${basePath}/:id/permissions/:principalType/:principalId`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const principalType = c.req.param('principalType')
    if (principalType !== 'user' && principalType !== 'agent') return jsonError(c, '参数错误。', 400)
    const access = await assertFileAccess(scope, c.req.param('id'), 'manage')
    if (!access.ok) return jsonError(c, access.message, access.status)
    await removeDrivePermission(access.target.id, principalType, c.req.param('principalId'))
    return c.json({ message: '已移除协作者。' })
  })

  // 分享状态（read 可查）
  app.get(`${basePath}/:id/share`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const access = await assertFileAccess(scope, c.req.param('id'), 'read')
    if (!access.ok) return jsonError(c, access.message, access.status)
    const share = await getDriveShare(access.target.id)
    return c.json({ share })
  })

  // 生成/更新分享链接（需 manage 权限；匿名只读）
  app.post(`${basePath}/:id/share`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const parsed = z.object({ expiresAt: z.string().nullable().optional() }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, '参数错误。', 400)
    const access = await assertFileAccess(scope, c.req.param('id'), 'manage')
    if (!access.ok) return jsonError(c, access.message, access.status)
    if (access.target.fileType !== 'file') return jsonError(c, '文件夹不支持分享。', 400)
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '').slice(0, 32)
    const share = await upsertDriveShare({
      fileId: access.target.id,
      token,
      expiresAt: parsed.data.expiresAt ?? null,
      createdBy: scope.userId,
    })
    return c.json({ share, url: `/api/share/drive/${share.token}/download` })
  })

  // 关闭分享（需 manage 权限）
  app.delete(`${basePath}/:id/share`, requireAuth, async (c) => {
    const scope = await resolveScope(c)
    if (!scope) return jsonError(c, '无权访问。', 403)
    const access = await assertFileAccess(scope, c.req.param('id'), 'manage')
    if (!access.ok) return jsonError(c, access.message, access.status)
    await deleteDriveShare(access.target.id)
    return c.json({ message: '已关闭分享。' })
  })
}

export const registerDriveRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  // Drive 配额摘要（团队域按工作区 owner 套餐；供 Drive 页展示已用/总额度）
  app.get('/api/collab/workspaces/:workspaceId/drive/quota', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    const workspaceId = c.req.param('workspaceId')
    if (!userId || !workspaceId || !(await isWorkspaceMember(workspaceId, userId))) {
      return jsonError(c, '无权访问。', 403)
    }
    const workspace = await getWorkspaceById(workspaceId)
    const quotaOwnerUserId = workspace?.ownerUserId || userId
    const policy = await getCommercialGate().resolveBillingPolicySnapshot(quotaOwnerUserId)
    const limits = getCommercialGate().resolveDriveQuotaLimits(policy.plan)
    const usedStorageBytes = await resolveScopeStorageUsed({ workspaceId, userId })
    return c.json({
      plan: policy.plan,
      maxFileSizeBytes: limits.maxFileSizeBytes,
      totalStorageBytes: limits.totalStorageBytes,
      usedStorageBytes,
    })
  })

  // Drive 配额摘要（个人域按本人套餐）
  app.get('/api/my/drive/quota', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) return jsonError(c, '无权访问。', 403)
    const policy = await getCommercialGate().resolveBillingPolicySnapshot(userId)
    const limits = getCommercialGate().resolveDriveQuotaLimits(policy.plan)
    const usedStorageBytes = await resolveScopeStorageUsed({ workspaceId: null, userId })
    return c.json({
      plan: policy.plan,
      maxFileSizeBytes: limits.maxFileSizeBytes,
      totalStorageBytes: limits.totalStorageBytes,
      usedStorageBytes,
    })
  })

  // 8a：Drive 文件引用附件——发送 Drive 文件到任务会话（不复制内容；Agent 经免鉴权 token 下载读原文件，
  // kind='drive' + driveFileId 供写回原文件；下载 URL 24h 时效）
  app.post('/api/tasks/:id/attachments/drive', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) return jsonError(c, '无权访问。', 403)
    const taskId = c.req.param('id')
    const body = await c.req.json().catch(() => ({})) as { driveFileId?: string }
    const driveFileId = body.driveFileId?.trim()
    if (!driveFileId) return jsonError(c, '缺少 Drive 文件。', 400)

    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)

    const built = await buildDriveReferenceAttachment({ driveFileId, userId, tokenScope: taskId })
    if ('error' in built) return jsonError(c, built.error, built.status)

    appendTaskConversationMessage({
      task: taskResult.task,
      project: taskResult.project,
      role: 'user',
      senderId: userId,
      content: '',
      contentType: 'json',
      externalRef: { attachments: [built.attachment] },
    })

    // R8.5：任务级附件同时写入 tasks.attachments（Drive 引用，占用云盘空间）。
    const nextAttachments = [...(taskResult.task.attachments ?? [])]
    if (!nextAttachments.some((attachment) => attachment.id === built.attachment.id)) {
      const nextTask: Task = {
        ...taskResult.task,
        attachments: [...nextAttachments, built.attachment],
        updatedAt: new Date().toISOString(),
      }
      await saveTaskAndWait(nextTask)
      state.tasks = state.tasks.map((item) => (item.id === taskId ? nextTask : item))
    }
    void registerDriveFileReference({
      fileId: built.driveFileId,
      refType: 'task',
      refId: taskId,
    }).catch((error) => {
      console.error('[drive-routes] failed to register task drive reference', error)
    })

    return c.json({ attachment: built.attachment }, 201)
  })

  // 8a：Drive 引用附件下载（免鉴权，token 校验 + 24h 时效；Agent 物化附件时使用）
  app.get('/api/drive-attachments/:token/download', async (c) => {
    const parsed = parseDriveAttachmentToken(c.req.param('token'))
    if (!parsed) return jsonError(c, '链接无效或已过期。', 403)
    const file = await getDriveFileById(parsed.driveFileId)
    if (!file || file.fileType !== 'file' || !file.s3Key) return jsonError(c, '文件不存在。', 404)
    return streamDriveObject(file.s3Key)
  })

  // 云节点文件只读视图（团队域，独立于 DB 元数据树）：直接读 R2 的 workspaces/<wid>/ 前缀
  app.get(
    '/api/collab/workspaces/:workspaceId/drive/cloud-files',
    requireAuth,
    buildCloudFilesListHandler(async (c) => {
      const userId = getUserIdFromHeader(c)
      const workspaceId = c.req.param('workspaceId')
      if (!userId || !workspaceId || !(await isWorkspaceMember(workspaceId, userId))) return null
      return { basePrefix: buildCloudFilesPrefix(workspaceId), within: (key) => isCloudFileKeyWithinWorkspace(workspaceId, key) }
    }),
  )

  // 云节点文件下载（只读）：key 必须落在该 workspace 的 workspaces/<wid>/ 前缀内
  app.get(
    '/api/collab/workspaces/:workspaceId/drive/cloud-files/download',
    requireAuth,
    buildCloudFilesDownloadHandler(async (c) => {
      const userId = getUserIdFromHeader(c)
      const workspaceId = c.req.param('workspaceId')
      if (!userId || !workspaceId || !(await isWorkspaceMember(workspaceId, userId))) return null
      return { basePrefix: buildCloudFilesPrefix(workspaceId), within: (key) => isCloudFileKeyWithinWorkspace(workspaceId, key) }
    }),
  )

  // 云节点文件只读视图（个人域「我的云节点文件」）：直接读 R2 的 users/<uid>/agents 前缀
  app.get('/api/my/drive/cloud-files', requireAuth, buildCloudFilesListHandler(async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) return null
    const basePrefix = buildPersonalCloudFilesPrefix(userId)
    return { basePrefix, within: (key) => isCloudFileKeyWithinUser(userId, key) }
  }))

  app.get('/api/my/drive/cloud-files/download', requireAuth, buildCloudFilesDownloadHandler(async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) return null
    const basePrefix = buildPersonalCloudFilesPrefix(userId)
    return { basePrefix, within: (key) => isCloudFileKeyWithinUser(userId, key) }
  }))

  // 团队域：/api/collab/workspaces/:workspaceId/drive/*
  registerDriveScopeRoutes(app, requireAuth, '/api/collab/workspaces/:workspaceId/drive', async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) return null
    const workspaceId = c.req.param('workspaceId')
    if (!workspaceId) return null
    if (!(await isWorkspaceMember(workspaceId, userId))) return null
    return { workspaceId, userId }
  })

  // 个人域：/api/my/drive/*
  registerDriveScopeRoutes(app, requireAuth, '/api/my/drive', async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) return null
    return { workspaceId: null, userId }
  })

  // 权限协作者候选：按 ID/name/email 搜索用户（Drive 权限添加协作者选择器；无 q = 全部用户）
  app.get('/api/drive/permission-candidates', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) return jsonError(c, '无权访问。', 403)
    const q = c.req.query('q')?.trim() ?? ''
    const candidates = (q ? searchUsers(q) : listAllUsers())
    // 可见性（飞书式）：只返回同协作空间成员 ∪ 已连接好友。
    const visible = await filterVisibleUserIds(userId, candidates.map((u) => u.id))
    const visibleSet = new Set(visible)
    const users = candidates
      .filter((u) => visibleSet.has(u.id))
      .slice(0, 50)
      .map((u) => ({
        id: u.id,
        name: u.name,
        username: u.username ?? undefined,
        email: u.email,
        avatarUrl: u.avatarUrl ?? null,
      }))
    return c.json({ users })
  })

  // 匿名分享访问：/api/share/drive/:token/download（免鉴权，只读；校验 token + 过期）
  app.get('/api/share/drive/:token/download', async (c) => {
    const token = c.req.param('token')
    const share = await getDriveShareByToken(token)
    if (!share) return jsonError(c, '分享链接无效。', 404)
    if (share.expiresAt && share.expiresAt < new Date().toISOString()) {
      return jsonError(c, '分享链接已过期。', 403)
    }
    const file = await getDriveFileById(share.fileId)
    if (!file || file.fileType !== 'file' || !file.s3Key) return jsonError(c, '文件不存在。', 404)
    return streamDriveObject(file.s3Key)
  })
}
