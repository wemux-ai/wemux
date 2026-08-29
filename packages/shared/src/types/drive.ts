// [INPUT]: 无（纯类型定义）
// [OUTPUT]: Drive（云盘）领域类型（DriveFileRecord / DriveFileVersionRecord 及 API 载荷）
// [POS]: Drive 云盘共享契约，跨 server / web / worker 使用；文件挂载在协作组织维度（workspaceId = collab_workspaces.id，NULL = 个人）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type DriveFileType = 'folder' | 'file'

export type DriveFileContentType = 'document' | 'image' | 'video' | 'archive' | 'code' | 'other'

export type DriveFileVisibility = 'private' | 'team' | 'public'

export type DrivePermissionRole = 'owner' | 'manage' | 'edit' | 'read'

export type DrivePermissionPrincipalType = 'user' | 'agent' | 'workspace'

export interface DriveFilePermissionRecord {
  fileId: string
  principalType: DrivePermissionPrincipalType
  principalId: string
  role: DrivePermissionRole
  createdBy: string | null
  createdAt: string
}

export interface DriveFileShareRecord {
  fileId: string
  /** 分享 token（匿名访问凭据） */
  token: string
  /** 过期时间；null = 永久有效 */
  expiresAt: string | null
  createdBy: string
  createdAt: string
}

export interface DriveSearchResult {
  id: string
  name: string
  fileType: DriveFileType
  contentType: DriveFileContentType
  sizeBytes: number | null
  parentId: string | null
  /** 命中的片段（前后文） */
  snippet: string | null
  updatedAt: string
}

/**
 * 云节点文件只读视图条目：直接读 R2 的 `workspaces/<wid>/` 前缀（挂载即持久），
 * 无 DB 元数据；目录由对象键的 `/` 层级推断（扁平键虚拟目录）。
 */
export interface CloudDriveFileEntry {
  kind: 'folder' | 'file'
  /** 当前层名称（不含路径） */
  name: string
  /** 相对对象键：文件 = 对象键；文件夹 = 前缀（供下载/下钻） */
  key: string
  sizeBytes: number | null
  updatedAt: string | null
}

export interface DriveFileRecord {
  id: string
  /** 所属协作组织（collab_workspaces.id）；null = 个人文件 */
  workspaceId: string | null
  /** 父目录（folder 的 id）；null = 根目录 */
  parentId: string | null
  name: string
  /** 'folder' | 'file'；目录也是 drive_files 一行，靠 parent_id 组树 */
  fileType: DriveFileType
  /** 文件 MIME 类型（folder 为 null） */
  mimeType: string | null
  sizeBytes: number | null
  /** R2 存储路径（folder 为 null） */
  s3Key: string | null
  thumbnailS3Key: string | null
  /** 文件内容大类：document / image / video / archive / code / other */
  contentType: DriveFileContentType
  /** 提取的纯文本（全文搜索用）；二进制为 null */
  searchText: string | null
  version: number
  visibility: DriveFileVisibility
  /** 回收站软删标记（R8.3 生命周期）：null = 正常；非空 = 已移入回收站，到期物理删除。 */
  deletedAt: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface DriveFileVersionRecord {
  id: string
  fileId: string
  version: number
  s3Key: string
  sizeBytes: number | null
  uploadedBy: string
  createdAt: string
}

export interface CreateDriveFolderInput {
  workspaceId: string | null
  parentId?: string | null
  name: string
}

/** 上传文件后登记元数据 */
export interface RegisterDriveFileInput {
  workspaceId: string | null
  parentId?: string | null
  name: string
  mimeType?: string | null
  sizeBytes?: number | null
  s3Key: string
  contentType?: DriveFileContentType
  visibility?: DriveFileVisibility
  /** 提取的纯文本（全文搜索用，可为 null） */
  searchText?: string | null
}

export interface UpdateDriveFileInput {
  name?: string
  parentId?: string | null
  visibility?: DriveFileVisibility
  /** 跨区移动（个人↔协作）时变更空间归属；undefined = 不变 */
  workspaceId?: string | null
  /** 协作 → 个人 认领时变更创建者 */
  createdBy?: string
}

/** 工作区大脑（Wemux Brain）纳入的云盘文件（workspace_brain_files 关联表）。 */
export interface WorkspaceBrainFile {
  id: string
  workspaceId: string
  fileId: string
  /** 大脑整理后的文件摘要（要点/约定/结论） */
  digest: string | null
  enabled: boolean
  /** 最后整理时间（对比 file.updatedAt 判断过期） */
  digestAt: string | null
  createdAt: string
  updatedAt: string
  /** join 出来的云盘文件名（列表展示用） */
  fileName?: string
}

/** 纳入/移出大脑上下文的请求载荷。 */
export interface SetWorkspaceBrainFileInput {
  enabled: boolean
}
