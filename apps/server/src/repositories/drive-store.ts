// [INPUT]: Drive 领域输入（CreateDriveFolderInput / RegisterDriveFileInput / UpdateDriveFileInput）
// [OUTPUT]: drive_files / drive_file_versions 表的 CRUD、树查询、文件版本、回收站软删/恢复与子树收集
// [POS]: Drive 云盘 Postgres 存储层；文件本体在 R2（drive-storage.ts），权限校验在路由层（isWorkspaceMember / 个人归属）；
//       活跃列表默认排除回收站（deletedAt 非空），级联删除/恢复与配额统计用 listAllDriveFilesIncludingTrashed
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, ilike, inArray, isNull, isNotNull, or } from 'drizzle-orm'
import type {
  CreateDriveFolderInput,
  DriveFileContentType,
  DriveFilePermissionRecord,
  DriveFileRecord,
  DriveFileShareRecord,
  DriveFileVersionRecord,
  DrivePermissionRole,
  DriveSearchResult,
  RegisterDriveFileInput,
  UpdateDriveFileInput,
  WorkspaceBrainFile,
} from '@shared/types'
import { buildSearchSnippet } from '@shared/drive-search'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { driveFilePermissions, driveFileReferences, driveFileShares, driveFileVersions, driveFiles, workspaceBrainFiles } from '../storage/postgres/schema-core'

const nowIso = () => new Date().toISOString()

/** Drive 查询作用域：团队文件按 workspaceId，个人文件按 userId（workspaceId 为 null） */
export interface DriveScope {
  workspaceId: string | null
  userId: string
}

const scopeCondition = (scope: DriveScope) => {
  return scope.workspaceId
    ? eq(driveFiles.workspaceId, scope.workspaceId)
    : and(isNull(driveFiles.workspaceId), eq(driveFiles.createdBy, scope.userId))
}

// ---------- 查询 ----------

export const listDriveFiles = async (scope: DriveScope, parentId: string | null): Promise<DriveFileRecord[]> => {
  const condition = parentId
    ? and(scopeCondition(scope), eq(driveFiles.parentId, parentId), isNull(driveFiles.deletedAt))
    : and(scopeCondition(scope), isNull(driveFiles.parentId), isNull(driveFiles.deletedAt))
  return getDrizzleDb()
    .select()
    .from(driveFiles)
    .where(condition)
    .orderBy(asc(driveFiles.fileType), asc(driveFiles.name))
}

/** 获取全部「活跃」文件（不含回收站软删），供前端组装整棵树 */
export const listAllDriveFiles = async (scope: DriveScope): Promise<DriveFileRecord[]> => {
  return getDrizzleDb()
    .select()
    .from(driveFiles)
    .where(and(scopeCondition(scope), isNull(driveFiles.deletedAt)))
    .orderBy(asc(driveFiles.name))
}

/** 获取 scope 下全部文件（含回收站软删），供级联删除/恢复与配额统计 */
export const listAllDriveFilesIncludingTrashed = async (scope: DriveScope): Promise<DriveFileRecord[]> => {
  return getDrizzleDb().select().from(driveFiles).where(scopeCondition(scope)).orderBy(asc(driveFiles.name))
}

/** 收集 parentId 下的全部后代记录（不含自身），用于级联删除/恢复 */
export const collectDescendants = (all: DriveFileRecord[], parentId: string): DriveFileRecord[] => {
  const result: DriveFileRecord[] = []
  const stack = [parentId]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    const children = all.filter((f) => f.parentId === current)
    for (const child of children) {
      result.push(child)
      stack.push(child.id)
    }
  }
  return result
}

/** 统计该 scope 已用云盘存储（文件 sizeBytes 之和，文件夹为 0） */
export const sumDriveStorageUsed = async (scope: DriveScope): Promise<number> => {
  // 回收站软删文件在物理删除前仍占用 R2，故计入配额（沿用既有计入口径）。
  const files = await listAllDriveFilesIncludingTrashed(scope)
  return files.reduce((sum, file) => sum + (file.fileType === 'file' ? (file.sizeBytes ?? 0) : 0), 0)
}

export const getDriveFileById = async (fileId: string): Promise<DriveFileRecord | null> => {
  const rows = await getDrizzleDb().select().from(driveFiles).where(eq(driveFiles.id, fileId)).limit(1)
  return rows[0] ?? null
}

/** 向上溯源到根，返回文件路径上的全部记录（含自身），用于权限校验 workspace 归属 */
export const resolveDriveFileAncestors = async (fileId: string): Promise<DriveFileRecord[]> => {
  const result: DriveFileRecord[] = []
  let current = await getDriveFileById(fileId)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    result.push(current)
    if (!current.parentId) break
    current = await getDriveFileById(current.parentId)
  }
  return result
}

// ---------- 写入 ----------

export const createDriveFolder = async (userId: string, input: CreateDriveFolderInput): Promise<DriveFileRecord> => {
  const now = nowIso()
  const record: DriveFileRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    parentId: input.parentId ?? null,
    name: input.name,
    fileType: 'folder',
    mimeType: null,
    sizeBytes: null,
    s3Key: null,
    thumbnailS3Key: null,
    contentType: 'other',
    searchText: null,
    version: 1,
    visibility: 'team',
    deletedAt: null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  }
  await getDrizzleDb().insert(driveFiles).values(record)
  return record
}

/** 上传文件后登记元数据（文件本体已写入 R2） */
export const registerDriveFile = async (userId: string, input: RegisterDriveFileInput): Promise<DriveFileRecord> => {
  const now = nowIso()
  const record: DriveFileRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    parentId: input.parentId ?? null,
    name: input.name,
    fileType: 'file',
    mimeType: input.mimeType ?? null,
    sizeBytes: input.sizeBytes ?? null,
    s3Key: input.s3Key,
    thumbnailS3Key: null,
    contentType: input.contentType ?? 'other',
    searchText: input.searchText ?? null,
    version: 1,
    visibility: input.visibility ?? 'team',
    deletedAt: null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  }
  await getDrizzleDb().insert(driveFiles).values(record)
  await getDrizzleDb().insert(driveFileVersions).values({
    id: randomUUID(),
    fileId: record.id,
    version: 1,
    s3Key: input.s3Key,
    sizeBytes: record.sizeBytes,
    uploadedBy: userId,
    createdAt: now,
  })
  return record
}

/** 更新文件元数据（重命名 / 移动 / 可见性 / 跨区归属） */
export const updateDriveFile = async (
  file: DriveFileRecord,
  input: UpdateDriveFileInput,
): Promise<DriveFileRecord> => {
  const updated: DriveFileRecord = {
    ...file,
    name: input.name ?? file.name,
    parentId: input.parentId !== undefined ? input.parentId : file.parentId,
    visibility: input.visibility ?? file.visibility,
    workspaceId: input.workspaceId !== undefined ? input.workspaceId : file.workspaceId,
    createdBy: input.createdBy ?? file.createdBy,
    updatedAt: nowIso(),
  }
  await getDrizzleDb().update(driveFiles).set({
    name: updated.name,
    parentId: updated.parentId,
    visibility: updated.visibility,
    workspaceId: updated.workspaceId,
    createdBy: updated.createdBy,
    updatedAt: updated.updatedAt,
  }).where(eq(driveFiles.id, file.id))
  return updated
}

/**
 * 跨区移动（个人 ↔ 协作）批量变更归属：被移动节点 + 整个子树一并转区，
 * 否则子树文件 workspaceId 不变会导致树断裂。createdBy 仅在协作 → 个人 时传入（整体认领到移动者名下）。
 */
export const moveDriveFilesAcrossScopes = async (
  fileIds: string[],
  input: { workspaceId: string | null; createdBy?: string },
): Promise<void> => {
  if (fileIds.length === 0) return
  const db = getDrizzleDb()
  const set = {
    workspaceId: input.workspaceId,
    updatedAt: nowIso(),
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
  }
  await db.update(driveFiles).set(set).where(inArray(driveFiles.id, fileIds))
}

/** 清除文件（含子树）的全部显式协作者与分享链接 —— 协作 → 个人 移出时转为纯私有，防止授权残留 */
export const clearDriveFileGrants = async (fileIds: string[]): Promise<void> => {
  if (fileIds.length === 0) return
  const db = getDrizzleDb()
  await db.delete(driveFilePermissions).where(inArray(driveFilePermissions.fileId, fileIds))
  await db.delete(driveFileShares).where(inArray(driveFileShares.fileId, fileIds))
}

/** 删除文件记录 + 版本记录（R2 对象删除由调用方在 service 层完成） */
export const deleteDriveFileRecord = async (fileId: string): Promise<void> => {
  const db = getDrizzleDb()
  await db.delete(driveFileVersions).where(eq(driveFileVersions.fileId, fileId))
  await db.delete(driveFileReferences).where(eq(driveFileReferences.fileId, fileId))
  await db.delete(driveFiles).where(eq(driveFiles.id, fileId))
}

// ---------- 附件引用索引（R8.3 孤儿判定基础） ----------

export type DriveFileReferenceType = 'conversation_message' | 'task_comment' | 'task'

/** 登记 Drive 文件被某消息/评论引用（幂等）。 */
export const registerDriveFileReference = async (params: {
  fileId: string
  refType: DriveFileReferenceType
  refId: string
}): Promise<void> => {
  await getDrizzleDb()
    .insert(driveFileReferences)
    .values({
      id: randomUUID(),
      fileId: params.fileId,
      refType: params.refType,
      refId: params.refId,
      createdAt: nowIso(),
    })
    .onConflictDoNothing()
}

/** 按引用删除所有引用行（消息/评论删除时调用；无则 no-op）。 */
export const clearDriveFileReferencesByRef = async (refType: DriveFileReferenceType, refId: string): Promise<void> => {
  await getDrizzleDb()
    .delete(driveFileReferences)
    .where(and(eq(driveFileReferences.refType, refType), eq(driveFileReferences.refId, refId)))
}

/** 查询文件是否仍被引用（孤儿判定）。 */
export const isDriveFileReferenced = async (fileId: string): Promise<boolean> => {
  const rows = await getDrizzleDb()
    .select({ id: driveFileReferences.id })
    .from(driveFileReferences)
    .where(eq(driveFileReferences.fileId, fileId))
    .limit(1)
  return rows.length > 0
}

// ---------- 回收站（软删） ----------

/** 移入回收站（软删）：只标记 deletedAt，不删除记录与 R2 对象。 */
export const softDeleteDriveFile = async (fileId: string): Promise<void> => {
  await getDrizzleDb()
    .update(driveFiles)
    .set({ deletedAt: nowIso(), updatedAt: nowIso() })
    .where(eq(driveFiles.id, fileId))
}

/** 从回收站恢复：清空 deletedAt。 */
export const restoreDriveFile = async (fileId: string): Promise<void> => {
  await getDrizzleDb()
    .update(driveFiles)
    .set({ deletedAt: null, updatedAt: nowIso() })
    .where(eq(driveFiles.id, fileId))
}

/** 列出目录下全部直接子项（含文件与文件夹） */
export const listDriveChildren = async (scope: DriveScope, parentId: string | null): Promise<DriveFileRecord[]> => {
  return listDriveFiles(scope, parentId)
}

/** 列出回收站（软删）文件：deletedAt 非空，按删除时间倒序。 */
export const listTrashedDriveFiles = async (scope: DriveScope): Promise<DriveFileRecord[]> => {
  return getDrizzleDb()
    .select()
    .from(driveFiles)
    .where(and(scopeCondition(scope), isNotNull(driveFiles.deletedAt)))
    .orderBy(desc(driveFiles.deletedAt))
}

// ---------- 版本 ----------

export const listDriveFileVersions = async (fileId: string): Promise<DriveFileVersionRecord[]> => {
  return getDrizzleDb()
    .select()
    .from(driveFileVersions)
    .where(eq(driveFileVersions.fileId, fileId))
    .orderBy(desc(driveFileVersions.version))
}

export const addDriveFileVersion = async (
  fileId: string,
  version: number,
  s3Key: string,
  sizeBytes: number | null,
  uploadedBy: string,
): Promise<void> => {
  await getDrizzleDb().insert(driveFileVersions).values({
    id: randomUUID(),
    fileId,
    version,
    s3Key,
    sizeBytes,
    uploadedBy,
    createdAt: nowIso(),
  })
}

/** 更新文件内容：当前内容先入版本历史，再推进 version 并换新对象键（供 Agent 写回 / 覆盖上传） */
export const updateDriveFileContent = async (
  file: DriveFileRecord,
  input: { s3Key: string; sizeBytes?: number | null; mimeType?: string | null; contentType?: DriveFileContentType; searchText?: string | null },
  uploadedBy: string,
): Promise<DriveFileRecord> => {
  const now = nowIso()
  if (file.fileType !== 'file') {
    throw new Error('文件夹不能更新内容。')
  }
  if (file.s3Key) {
    await addDriveFileVersion(file.id, file.version, file.s3Key, file.sizeBytes, uploadedBy)
  }
  const updated: DriveFileRecord = {
    ...file,
    s3Key: input.s3Key,
    sizeBytes: input.sizeBytes ?? file.sizeBytes,
    mimeType: input.mimeType !== undefined ? input.mimeType : file.mimeType,
    contentType: input.contentType ?? file.contentType,
    searchText: input.searchText !== undefined ? input.searchText : file.searchText,
    version: file.version + 1,
    updatedAt: now,
  }
  await getDrizzleDb().update(driveFiles).set({
    s3Key: updated.s3Key,
    sizeBytes: updated.sizeBytes,
    mimeType: updated.mimeType,
    contentType: updated.contentType,
    searchText: updated.searchText,
    version: updated.version,
    updatedAt: updated.updatedAt,
  }).where(eq(driveFiles.id, file.id))
  return updated
}

/**
 * 直接覆盖文件内容：不建版本历史、不换对象键（Agent 写回链路简化版）。
 * 调用方负责先 PUT 覆盖同一对象再更新记录。
 */
export const overwriteDriveFileContent = async (
  file: DriveFileRecord,
  input: { s3Key: string; sizeBytes?: number | null; mimeType?: string | null; contentType?: DriveFileContentType; searchText?: string | null },
): Promise<DriveFileRecord> => {
  const now = nowIso()
  if (file.fileType !== 'file') {
    throw new Error('文件夹不能更新内容。')
  }
  const updated: DriveFileRecord = {
    ...file,
    s3Key: input.s3Key,
    sizeBytes: input.sizeBytes ?? file.sizeBytes,
    mimeType: input.mimeType !== undefined ? input.mimeType : file.mimeType,
    contentType: input.contentType ?? file.contentType,
    searchText: input.searchText !== undefined ? input.searchText : file.searchText,
    updatedAt: now,
  }
  await getDrizzleDb().update(driveFiles).set({
    s3Key: updated.s3Key,
    sizeBytes: updated.sizeBytes,
    mimeType: updated.mimeType,
    contentType: updated.contentType,
    searchText: updated.searchText,
    updatedAt: updated.updatedAt,
  }).where(eq(driveFiles.id, file.id))
  return updated
}

// ---------- 文件级权限（二期：显式协作者，覆盖继承） ----------

export const listDrivePermissions = async (fileId: string): Promise<DriveFilePermissionRecord[]> => {
  return getDrizzleDb().select().from(driveFilePermissions).where(eq(driveFilePermissions.fileId, fileId))
}

export const setDrivePermission = async (input: {
  fileId: string
  principalType: DriveFilePermissionRecord['principalType']
  principalId: string
  role: DrivePermissionRole
  createdBy: string | null
}): Promise<DriveFilePermissionRecord> => {
  const record: DriveFilePermissionRecord = {
    fileId: input.fileId,
    principalType: input.principalType,
    principalId: input.principalId,
    role: input.role,
    createdBy: input.createdBy,
    createdAt: nowIso(),
  }
  await getDrizzleDb()
    .insert(driveFilePermissions)
    .values(record)
    .onConflictDoUpdate({
      target: [driveFilePermissions.fileId, driveFilePermissions.principalType, driveFilePermissions.principalId],
      set: { role: record.role, createdBy: record.createdBy },
    })
  return record
}

export const removeDrivePermission = async (
  fileId: string,
  principalType: DriveFilePermissionRecord['principalType'],
  principalId: string,
): Promise<void> => {
  await getDrizzleDb()
    .delete(driveFilePermissions)
    .where(
      and(
        eq(driveFilePermissions.fileId, fileId),
        eq(driveFilePermissions.principalType, principalType),
        eq(driveFilePermissions.principalId, principalId),
      ),
    )
}

const ROLE_LEVEL: Record<DrivePermissionRole, number> = { read: 1, edit: 2, manage: 3, owner: 4 }

/**
 * 解析目标文件对调用者的有效角色：
 * 1. 文件 → 父链的显式协作者（user 匹配 userId / agent 匹配 agentId）优先
 * 2. 无显式：团队文件成员默认 edit；个人文件本人默认 owner
 */
export const resolveEffectiveRole = async (
  fileId: string,
  viewerUserId: string,
  agentId?: string | null,
): Promise<{ role: DrivePermissionRole | null; target: DriveFileRecord | null }> => {
  const ancestors = await resolveDriveFileAncestors(fileId)
  const target = ancestors[0]
  if (!target) return { role: null, target: null }

  // 显式协作者：文件自身 → 父文件夹 → 根，命中即返回
  const db = getDrizzleDb()
  for (const node of ancestors) {
    const permissions = await db.select().from(driveFilePermissions).where(eq(driveFilePermissions.fileId, node.id))
    const userPerm = permissions.find((p) => p.principalType === 'user' && p.principalId === viewerUserId)
    const agentPerm = agentId ? permissions.find((p) => p.principalType === 'agent' && p.principalId === agentId) : undefined
    const matched = agentPerm ?? userPerm
    if (matched) return { role: matched.role, target }
  }

  // 无显式：回退继承
  if (target.workspaceId) {
    // 团队文件：创建者 owner；其余成员默认 edit（成员判定由调用方/路由完成）
    return { role: target.createdBy === viewerUserId ? 'owner' : 'edit', target }
  }
  // 个人文件
  return { role: target.createdBy === viewerUserId ? 'owner' : null, target }
}

/** 角色是否满足所需等级 */
export const hasRoleLevel = (role: DrivePermissionRole | null, required: 'read' | 'edit' | 'manage'): boolean => {
  if (!role) return false
  return ROLE_LEVEL[role] >= ROLE_LEVEL[required]
}

// ---------- 链接分享（匿名只读访问） ----------

export const getDriveShare = async (fileId: string): Promise<DriveFileShareRecord | null> => {
  const rows = await getDrizzleDb().select().from(driveFileShares).where(eq(driveFileShares.fileId, fileId)).limit(1)
  return rows[0] ?? null
}

export const getDriveShareByToken = async (token: string): Promise<DriveFileShareRecord | null> => {
  const rows = await getDrizzleDb().select().from(driveFileShares).where(eq(driveFileShares.token, token)).limit(1)
  return rows[0] ?? null
}

export const upsertDriveShare = async (input: {
  fileId: string
  token: string
  expiresAt: string | null
  createdBy: string
}): Promise<DriveFileShareRecord> => {
  const record: DriveFileShareRecord = {
    fileId: input.fileId,
    token: input.token,
    expiresAt: input.expiresAt,
    createdBy: input.createdBy,
    createdAt: nowIso(),
  }
  await getDrizzleDb()
    .insert(driveFileShares)
    .values(record)
    .onConflictDoUpdate({
      target: driveFileShares.fileId,
      set: { token: record.token, expiresAt: record.expiresAt, createdBy: record.createdBy },
    })
  return record
}

export const deleteDriveShare = async (fileId: string): Promise<void> => {
  await getDrizzleDb().delete(driveFileShares).where(eq(driveFileShares.fileId, fileId))
}

// ---------- 全文搜索（name + searchText ILIKE） ----------

export const searchDriveFiles = async (scope: DriveScope, query: string): Promise<DriveSearchResult[]> => {
  const db = getDrizzleDb()
  const pattern = `%${query}%`
  const rows = await db
    .select()
    .from(driveFiles)
    .where(and(scopeCondition(scope), isNull(driveFiles.deletedAt), or(ilike(driveFiles.name, pattern), ilike(driveFiles.searchText, pattern))))
    .orderBy(desc(driveFiles.updatedAt))
    .limit(50)
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    fileType: row.fileType,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    parentId: row.parentId,
    snippet: buildSearchSnippet(row.searchText, query),
    updatedAt: row.updatedAt,
  }))
}

// ---------- 工作区大脑（Wemux Brain）纳入的云盘文件 ----------

/** 列出工作区大脑纳入的云盘文件（join drive_files 拿文件名）。 */
export const listWorkspaceBrainFiles = async (workspaceId: string): Promise<WorkspaceBrainFile[]> => {
  const rows = await getDrizzleDb()
    .select({
      id: workspaceBrainFiles.id,
      workspaceId: workspaceBrainFiles.workspaceId,
      fileId: workspaceBrainFiles.fileId,
      digest: workspaceBrainFiles.digest,
      enabled: workspaceBrainFiles.enabled,
      digestAt: workspaceBrainFiles.digestAt,
      createdAt: workspaceBrainFiles.createdAt,
      updatedAt: workspaceBrainFiles.updatedAt,
      fileName: driveFiles.name,
    })
    .from(workspaceBrainFiles)
    .leftJoin(driveFiles, eq(driveFiles.id, workspaceBrainFiles.fileId))
    .where(and(eq(workspaceBrainFiles.workspaceId, workspaceId), eq(workspaceBrainFiles.enabled, true)))
    .orderBy(desc(workspaceBrainFiles.updatedAt))
  return rows as WorkspaceBrainFile[]
}

/** 纳入/移出（upsert）；移出时删除记录。 */
export const setWorkspaceBrainFile = async (workspaceId: string, fileId: string, enabled: boolean): Promise<void> => {
  const db = getDrizzleDb()
  if (enabled) {
    const existing = await db.select().from(workspaceBrainFiles)
      .where(and(eq(workspaceBrainFiles.workspaceId, workspaceId), eq(workspaceBrainFiles.fileId, fileId)))
      .limit(1)
    if (existing.length > 0) {
      await db.update(workspaceBrainFiles).set({ enabled: true, updatedAt: nowIso() })
        .where(eq(workspaceBrainFiles.id, existing[0]!.id))
      return
    }
    await db.insert(workspaceBrainFiles).values({
      id: randomUUID(),
      workspaceId,
      fileId,
      digest: null,
      enabled: true,
      digestAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    return
  }
  await db.delete(workspaceBrainFiles)
    .where(and(eq(workspaceBrainFiles.workspaceId, workspaceId), eq(workspaceBrainFiles.fileId, fileId)))
}

/** 更新大脑整理后的摘要。 */
export const updateWorkspaceBrainFileDigest = async (workspaceId: string, fileId: string, digest: string): Promise<void> => {
  const now = nowIso()
  await getDrizzleDb().update(workspaceBrainFiles)
    .set({ digest, digestAt: now, updatedAt: now })
    .where(and(eq(workspaceBrainFiles.workspaceId, workspaceId), eq(workspaceBrainFiles.fileId, fileId)))
}
