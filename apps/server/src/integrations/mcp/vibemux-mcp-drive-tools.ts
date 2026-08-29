// [INPUT]: Agent 身份（VibemuxMcpContext）+ Drive 工具调用
// [OUTPUT]: drive.list_files / read_file / write_file / file_info + create_folder / rename / move / delete /
//           trash_list / trash_restore / versions / permissions_get / permissions_set / share / search 工具
// [POS]: MCP 适配层；Agent 不持对象存储凭据，读写走 server 存储层（uploadDriveObject/streamDriveObject）；
//       隔离：Agent 以 ctx.userId（owner）身份，组织文件须为成员，个人文件限本人；删除与恢复均走软删回收站语义
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { extractSearchText } from '@shared/drive-search'
import { VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS } from '@shared/mcp'
import type { DriveFileRecord } from '@shared/types'
import { ErrorCode, McpError, type McpServer } from './sdk'
import { toToolResult, type VibemuxMcpContext } from './vibemux-mcp-context'
import { isWorkspaceMember } from '../../repositories/workspace'
import {
  collectDescendants,
  createDriveFolder,
  getDriveShare,
  hasRoleLevel,
  listAllDriveFiles,
  listAllDriveFilesIncludingTrashed,
  listDriveFileVersions,
  listDrivePermissions,
  listTrashedDriveFiles,
  overwriteDriveFileContent,
  registerDriveFile,
  resolveEffectiveRole,
  restoreDriveFile,
  searchDriveFiles,
  setDrivePermission,
  softDeleteDriveFile,
  updateDriveFile,
  upsertDriveShare,
  type DriveScope,
} from '../../repositories/drive-store'
import { buildDriveObjectKey, downloadDriveObject, uploadDriveObject } from '../../services/drive-storage'
import { createWorkRecord } from '../../repositories/profile-store'

const teamScopeSchema = z.object({
  workspaceId: z.string().min(1).describe('协作组织 ID（组织 Drive）'),
  parentId: z.string().trim().optional().describe('父目录 ID，缺省为根目录'),
})

const personalScopeSchema = z.object({
  personal: z.literal(true).describe('个人 Drive（当前用户）'),
  parentId: z.string().trim().optional().describe('父目录 ID，缺省为根目录'),
})

const scopeSchema = z.discriminatedUnion('personal', [
  z.object({ personal: z.literal(false), workspaceId: z.string().min(1).describe('协作组织 ID（组织 Drive）'), parentId: z.string().trim().optional() }),
  personalScopeSchema,
])

const textFileSchema = z.union([
  z.object({
    personal: z.literal(false),
    workspaceId: z.string().min(1).describe('协作组织 ID（组织 Drive）'),
    parentId: z.string().trim().optional(),
    name: z.string().min(1).max(255).describe('文件名，如 report.md / index.html / notes.txt'),
    content: z.string().describe('文件文本内容（Markdown / HTML / 纯文本）'),
    fileId: z.string().optional().describe('覆盖已有文件时传文件 ID'),
  }),
  z.object({
    personal: z.literal(true),
    parentId: z.string().trim().optional(),
    name: z.string().min(1).max(255).describe('文件名，如 report.md / index.html / notes.txt'),
    content: z.string().describe('文件文本内容（Markdown / HTML / 纯文本）'),
    fileId: z.string().optional().describe('覆盖已有文件时传文件 ID'),
  }),
])

// ---------- 管理工具入参 ----------

const createFolderSchema = z.union([
  z.object({
    personal: z.literal(false),
    workspaceId: z.string().min(1).describe('协作组织 ID（组织 Drive）'),
    parentId: z.string().trim().optional().describe('父目录 ID，缺省为根目录'),
    name: z.string().trim().min(1).max(255).describe('文件夹名称'),
  }),
  z.object({
    personal: z.literal(true),
    parentId: z.string().trim().optional().describe('父目录 ID，缺省为根目录'),
    name: z.string().trim().min(1).max(255).describe('文件夹名称'),
  }),
])

const renameSchema = z.object({
  fileId: z.string().min(1).describe('文件/文件夹 ID'),
  name: z.string().trim().min(1).max(255).describe('新名称'),
})

const moveSchema = z.object({
  fileId: z.string().min(1).describe('文件/文件夹 ID'),
  parentId: z.string().trim().nullable().describe('目标父目录 ID，null 表示移到根目录'),
})

/** 单个 fileId 入参（删除 / 恢复 / 版本 / 权限查询共用） */
const fileIdSchema = z.object({ fileId: z.string().min(1).describe('文件/文件夹 ID') })

const permissionsSetSchema = z.object({
  fileId: z.string().min(1).describe('文件/文件夹 ID'),
  principalType: z.enum(['user', 'agent']).describe('协作者类型：user=用户 / agent=Agent'),
  principalId: z.string().min(1).describe('协作者 ID（用户 ID 或 Agent ID）'),
  role: z.enum(['read', 'edit', 'manage']).describe('权限角色：read=只读 / edit=可编辑 / manage=可管理'),
})

const shareSchema = z.discriminatedUnion('action', [
  z.object({
    fileId: z.string().min(1).describe('文件 ID'),
    action: z.literal('get').describe('查询当前分享状态（只读）'),
  }),
  z.object({
    fileId: z.string().min(1).describe('文件 ID'),
    action: z.literal('create').describe('生成或更新分享链接'),
    expiresAt: z.string().nullable().optional().describe('过期时间（ISO 字符串），null 或不传为永久有效'),
  }),
])

const searchSchema = z.union([
  z.object({
    personal: z.literal(false),
    workspaceId: z.string().min(1).describe('协作组织 ID（组织 Drive）'),
    query: z.string().trim().min(1).describe('搜索关键词（匹配文件名与提取文本）'),
  }),
  z.object({
    personal: z.literal(true),
    query: z.string().trim().min(1).describe('搜索关键词（匹配文件名与提取文本）'),
  }),
])

/** 校验 scope 归属：组织须为成员，个人限本人；返回 DriveScope */
const resolveMcpScope = async (ctx: VibemuxMcpContext, input: { personal: boolean; workspaceId?: string }) => {
  if (input.personal) {
    return { workspaceId: null, userId: ctx.userId }
  }
  const workspaceId = input.workspaceId
  if (!workspaceId) throw new McpError(ErrorCode.InvalidParams, '缺少 workspaceId。')
  if (!(await isWorkspaceMember(workspaceId, ctx.userId))) {
    throw new McpError(ErrorCode.InvalidParams, '无权访问该组织。')
  }
  return { workspaceId, userId: ctx.userId }
}

/** 文件级访问校验：按文件归属自动校验（组织=成员，个人=本人），并解析有效角色 */
const assertMcpFileAccess = async (ctx: VibemuxMcpContext, fileId: string, required: 'read' | 'edit' | 'manage' = 'read') => {
  const { role, target } = await resolveEffectiveRole(fileId, ctx.userId, ctx.runtimeAgentId)
  if (!target) throw new McpError(ErrorCode.InvalidParams, '文件不存在。')
  if (!role || !hasRoleLevel(role, required)) throw new McpError(ErrorCode.InvalidParams, '无权访问该文件。')
  return target
}

/** 由已校验归属的文件推导 DriveScope（级联删除/恢复需要 scope 拉全量文件） */
const scopeFromFile = (file: DriveFileRecord): DriveScope => ({ workspaceId: file.workspaceId, userId: file.createdBy })

export const registerVibemuxMcpDriveTools = (server: McpServer, ctx: VibemuxMcpContext) => {
  server.registerTool('drive.list_files', {
    title: 'Drive List Files',
    description: '列出云盘文件树（组织或个人 Drive）。返回文件夹与文件，含 id/name/类型/大小，供后续读写。',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: scopeSchema,
  }, async (input) => {
    const scope = await resolveMcpScope(ctx, input)
    const files = await listAllDriveFiles(scope)
    return toToolResult({
      ok: true,
      files: files.map((file) => ({
        id: file.id,
        name: file.name,
        fileType: file.fileType,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        parentId: file.parentId,
        updatedAt: file.updatedAt,
      })),
    })
  })

  server.registerTool('drive.read_file', {
    title: 'Drive Read File',
    description: '读取云盘文本文件内容（Markdown / HTML / 纯文本）。二进制文件请用 drive.file_info 获取下载路径。',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: z.object({ fileId: z.string().min(1).describe('文件 ID') }),
  }, async ({ fileId }) => {
    const file = await assertMcpFileAccess(ctx, fileId)
    if (file.fileType !== 'file' || !file.s3Key) {
      throw new McpError(ErrorCode.InvalidParams, '不是可读取的文件。')
    }
    if (!(file.mimeType?.startsWith('text/') || file.contentType === 'document')) {
      throw new McpError(ErrorCode.InvalidParams, '该文件不是文本，无法直接读取。')
    }
    const bytes = await downloadDriveObject(file.s3Key)
    const content = new TextDecoder().decode(bytes)
    return toToolResult({ ok: true, name: file.name, contentType: file.contentType, content })
  })

  server.registerTool('drive.file_info', {
    title: 'Drive File Info',
    description: '获取云盘文件信息（名称/类型/大小/归属组织），用于确认文件可访问性与定位。',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: z.object({ fileId: z.string().min(1).describe('文件 ID') }),
  }, async ({ fileId }) => {
    const file = await assertMcpFileAccess(ctx, fileId)
    return toToolResult({
      ok: true,
      file: {
        id: file.id,
        name: file.name,
        fileType: file.fileType,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        workspaceId: file.workspaceId,
        version: file.version,
        updatedAt: file.updatedAt,
      },
    })
  })

  server.registerTool('drive.write_file', {
    title: 'Drive Write File',
    description: '在云盘创建或覆盖文本文件（Markdown / HTML / 纯文本）。\n'
      + '- 创建：传 workspaceId（组织）或不传 personal（个人）+ name + content\n'
      + '- 覆盖：传 fileId，用新内容直接覆盖原文件（不保留版本历史）\n'
      + 'Agent 会话中生成的文档/报告/页面请用本工具写入云盘，供人类与其他 Agent 查看。',
    inputSchema: textFileSchema,
  }, async (input) => {
    // 覆盖已有文件（写回：直接覆盖，不建版本历史）
    if ('fileId' in input && input.fileId) {
      const scope = await resolveMcpScope(ctx, {
        personal: input.personal,
        workspaceId: input.personal === false ? input.workspaceId : undefined,
      })
      const file = await assertMcpFileAccess(ctx, input.fileId, 'edit')
      if (file.fileType !== 'file') throw new McpError(ErrorCode.InvalidParams, '文件夹不能写入内容。')
      const key = buildDriveObjectKey(scope.workspaceId, scope.userId, file.name)
      const contentBytes = new TextEncoder().encode(input.content)
      await uploadDriveObject(key, contentBytes, file.mimeType ?? 'text/markdown')
      const updated = await overwriteDriveFileContent(
        file,
        { s3Key: key, sizeBytes: contentBytes.byteLength, searchText: extractSearchText(file.mimeType, file.name, input.content) },
      )
      // 工作记录：Drive 文件更新（旁路）
      void createWorkRecord({
        actorType: 'user',
        actorId: ctx.userId,
        recordType: 'drive_file_updated',
        targetType: 'drive_file',
        targetId: updated.id,
        title: updated.name,
        metadataJson: { workspaceId: scope.workspaceId },
      }).catch(() => {})
      return toToolResult({ ok: true, file: { id: updated.id, name: updated.name, version: updated.version }, message: '文件已更新（直接覆盖）。' })
    }

    // 新建文件
    const { name, content, parentId } = input as { name: string; content: string; parentId?: string }
    const scope = await resolveMcpScope(ctx, { personal: (input as { personal: boolean }).personal, workspaceId: (input as { workspaceId?: string }).workspaceId })
    if (parentId) {
      const parent = await assertMcpFileAccess(ctx, parentId, 'edit')
      if (parent.fileType !== 'folder') throw new McpError(ErrorCode.InvalidParams, 'parentId 必须是文件夹。')
    }
    const mimeType = name.endsWith('.html') ? 'text/html' : name.endsWith('.md') ? 'text/markdown' : 'text/plain'
    const key = buildDriveObjectKey(scope.workspaceId, scope.userId, name)
    const contentBytes = new TextEncoder().encode(content)
    await uploadDriveObject(key, contentBytes, mimeType)
    const record = await registerDriveFile(ctx.userId, {
      workspaceId: scope.workspaceId,
      parentId: parentId ?? null,
      name,
      mimeType,
      sizeBytes: contentBytes.byteLength,
      s3Key: key,
      contentType: 'document',
      searchText: extractSearchText(mimeType, name, content),
    })
    // 工作记录：Drive 文件创建（旁路）
    void createWorkRecord({
      actorType: 'user',
      actorId: ctx.userId,
      recordType: 'drive_file_created',
      targetType: 'drive_file',
      targetId: record.id,
      title: record.name,
      metadataJson: { workspaceId: scope.workspaceId },
    }).catch(() => {})
    return toToolResult({ ok: true, file: { id: record.id, name: record.name, version: record.version }, message: '文件已写入云盘。' })
  })

  server.registerTool('drive.create_folder', {
    title: 'Drive Create Folder',
    description: '在云盘创建文件夹（组织或个人 Drive）。父目录可选，缺省为根目录。',
    inputSchema: createFolderSchema,
  }, async (input) => {
    const scope = await resolveMcpScope(ctx, input)
    const { name, parentId } = input
    if (parentId) {
      const parent = await assertMcpFileAccess(ctx, parentId, 'edit')
      if (parent.fileType !== 'folder') throw new McpError(ErrorCode.InvalidParams, 'parentId 必须是文件夹。')
    }
    const folder = await createDriveFolder(ctx.userId, { workspaceId: scope.workspaceId, parentId: parentId ?? null, name })
    return toToolResult({ ok: true, file: { id: folder.id, name: folder.name, fileType: folder.fileType, parentId: folder.parentId } })
  })

  server.registerTool('drive.rename', {
    title: 'Drive Rename',
    description: '重命名云盘文件或文件夹。',
    inputSchema: renameSchema,
  }, async ({ fileId, name }) => {
    const file = await assertMcpFileAccess(ctx, fileId, 'edit')
    const updated = await updateDriveFile(file, { name })
    return toToolResult({ ok: true, file: { id: updated.id, name: updated.name } })
  })

  server.registerTool('drive.move', {
    title: 'Drive Move',
    description: '移动云盘文件/文件夹到目标父目录（parentId 传 null 表示移到根目录）。',
    inputSchema: moveSchema,
  }, async ({ fileId, parentId }) => {
    const file = await assertMcpFileAccess(ctx, fileId, 'edit')
    if (file.id === parentId) throw new McpError(ErrorCode.InvalidParams, '不能移动到自身。')
    if (parentId) {
      const parent = await assertMcpFileAccess(ctx, parentId, 'edit')
      if (parent.fileType !== 'folder') throw new McpError(ErrorCode.InvalidParams, '目标目录必须是文件夹。')
    }
    const updated = await updateDriveFile(file, { parentId })
    return toToolResult({ ok: true, file: { id: updated.id, parentId: updated.parentId } })
  })

  server.registerTool('drive.delete', {
    title: 'Drive Delete',
    description: '将文件/文件夹移入回收站（软删，不立即删除对象；30 天后自动清理）。文件夹会连同子项一起移入回收站。',
    inputSchema: fileIdSchema,
  }, async ({ fileId }) => {
    const file = await assertMcpFileAccess(ctx, fileId, 'edit')
    const scope = scopeFromFile(file)
    const all = await listAllDriveFilesIncludingTrashed(scope)
    const descendants = collectDescendants(all, file.id)
    const toTrash = [file, ...descendants]
    for (const item of toTrash) {
      await softDeleteDriveFile(item.id)
    }
    return toToolResult({ ok: true, message: `已移入回收站 ${toTrash.length} 项。` })
  })

  server.registerTool('drive.trash_list', {
    title: 'Drive Trash List',
    description: '列出云盘回收站中的文件与文件夹（软删，按删除时间倒序），供后续恢复。',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: scopeSchema,
  }, async (input) => {
    const scope = await resolveMcpScope(ctx, input)
    const files = await listTrashedDriveFiles(scope)
    return toToolResult({
      ok: true,
      files: files.map((file) => ({
        id: file.id,
        name: file.name,
        fileType: file.fileType,
        parentId: file.parentId,
        deletedAt: file.deletedAt,
        updatedAt: file.updatedAt,
      })),
    })
  })

  server.registerTool('drive.trash_restore', {
    title: 'Drive Trash Restore',
    description: '从回收站恢复文件/文件夹（文件夹会连同子项一并恢复）。',
    inputSchema: fileIdSchema,
  }, async ({ fileId }) => {
    const file = await assertMcpFileAccess(ctx, fileId, 'read')
    if (!file.deletedAt) throw new McpError(ErrorCode.InvalidParams, '文件不在回收站。')
    const scope = scopeFromFile(file)
    const all = await listAllDriveFilesIncludingTrashed(scope)
    const descendants = file.fileType === 'folder' ? collectDescendants(all, file.id) : []
    const toRestore = [file, ...descendants]
    for (const item of toRestore) {
      await restoreDriveFile(item.id)
    }
    return toToolResult({ ok: true, message: `已恢复 ${toRestore.length} 项。` })
  })

  server.registerTool('drive.versions', {
    title: 'Drive Versions',
    description: '查看云盘文件的版本历史（含每次上传的 s3Key / 大小 / 上传者）。',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: fileIdSchema,
  }, async ({ fileId }) => {
    const file = await assertMcpFileAccess(ctx, fileId, 'read')
    const versions = await listDriveFileVersions(file.id)
    return toToolResult({ ok: true, versions })
  })

  server.registerTool('drive.permissions_get', {
    title: 'Drive Permissions Get',
    description: '查看云盘文件/文件夹的显式协作者权限列表。',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: fileIdSchema,
  }, async ({ fileId }) => {
    const file = await assertMcpFileAccess(ctx, fileId, 'read')
    const permissions = await listDrivePermissions(file.id)
    return toToolResult({ ok: true, permissions })
  })

  server.registerTool('drive.permissions_set', {
    title: 'Drive Permissions Set',
    description: '设置云盘文件/文件夹的协作者权限（需 manage 权限）。principalType 仅 user/agent；role 为 read/edit/manage。',
    inputSchema: permissionsSetSchema,
  }, async ({ fileId, principalType, principalId, role }) => {
    const file = await assertMcpFileAccess(ctx, fileId, 'manage')
    const permission = await setDrivePermission({
      fileId: file.id,
      principalType,
      principalId,
      role,
      createdBy: ctx.userId,
    })
    return toToolResult({ ok: true, permission })
  })

  server.registerTool('drive.share', {
    title: 'Drive Share',
    description: '查询或管理云盘文件的匿名分享链接。action=get 查询当前状态（只读）；action=create 生成/更新分享链接（仅文件，需 manage 权限）。',
    inputSchema: shareSchema,
  }, async (input) => {
    const file = await assertMcpFileAccess(ctx, input.fileId, input.action === 'get' ? 'read' : 'manage')
    if (input.action === 'get') {
      const share = await getDriveShare(file.id)
      return toToolResult({ ok: true, share })
    }
    if (file.fileType !== 'file') throw new McpError(ErrorCode.InvalidParams, '文件夹不支持分享。')
    const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, '').slice(0, 32)
    const share = await upsertDriveShare({
      fileId: file.id,
      token,
      expiresAt: input.expiresAt ?? null,
      createdBy: ctx.userId,
    })
    return toToolResult({ ok: true, share, url: `/api/share/drive/${share.token}/download` })
  })

  server.registerTool('drive.search', {
    title: 'Drive Search',
    description: '在云盘内全文搜索（匹配文件名与提取文本，scope 内）。返回命中结果与片段。',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: searchSchema,
  }, async (input) => {
    const scope = await resolveMcpScope(ctx, input)
    const results = await searchDriveFiles(scope, input.query.trim())
    return toToolResult({ ok: true, results })
  })
}
