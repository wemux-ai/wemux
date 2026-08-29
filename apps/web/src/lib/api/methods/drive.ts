// [INPUT]: Drive API 请求/响应契约
// [OUTPUT]: Drive 云盘 HTTP 方法（团队域 + 个人域）
// [POS]: Web 控制面 Drive 客户端；文件上传走 multipart，文本新建/内容保存走 JSON（create*/save*Text*），下载走 authFetch + blob
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { CloudDriveFileEntry, DriveFilePermissionRecord, DriveFileRecord, DriveFileShareRecord, DriveFileVersionRecord, DriveSearchResult } from '@shared/types'
import { authFetch, request } from '../client'

/** Drive 配额摘要（Drive 页展示已用/总额度） */
export type DriveQuotaInfo = {
  plan: string
  maxFileSizeBytes: number
  totalStorageBytes: number
  usedStorageBytes: number
}

const teamBase = (workspaceId: string) => `/api/collab/workspaces/${workspaceId}/drive`
const myBase = '/api/my/drive'

const listChildrenPath = (base: string, parentId: string | null) =>
  `${base}${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ''}`

export const driveMethods = {
  // ---------- 团队域 ----------
  listTeamDriveTree: (workspaceId: string) => request<{ files: DriveFileRecord[] }>(`${teamBase(workspaceId)}/tree`),
  listTeamDriveChildren: (workspaceId: string, parentId: string | null) =>
    request<{ files: DriveFileRecord[] }>(listChildrenPath(teamBase(workspaceId), parentId)),
  createTeamDriveFolder: (workspaceId: string, payload: { name: string; parentId?: string }) =>
    request<{ file: DriveFileRecord }>(`${teamBase(workspaceId)}/folders`, { method: 'POST', body: JSON.stringify(payload) }),
  uploadTeamDriveFile: (workspaceId: string, file: File, parentId: string | null) => {
    const form = new FormData()
    form.append('file', file)
    if (parentId) form.append('parentId', parentId)
    return request<{ file: DriveFileRecord }>(`${teamBase(workspaceId)}/upload`, { method: 'POST', body: form })
  },
  createTeamDriveTextFile: (workspaceId: string, payload: { name: string; content: string; parentId?: string }) =>
    request<{ file: DriveFileRecord }>(`${teamBase(workspaceId)}/text-files`, { method: 'POST', body: JSON.stringify(payload) }),
  saveTeamDriveTextContent: (workspaceId: string, fileId: string, content: string) =>
    request<{ file: DriveFileRecord }>(`${teamBase(workspaceId)}/${fileId}/content`, { method: 'PUT', body: JSON.stringify({ content }) }),
  renameTeamDriveFile: (workspaceId: string, fileId: string, name: string) =>
    request<{ file: DriveFileRecord }>(`${teamBase(workspaceId)}/${fileId}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),
  moveTeamDriveFile: (workspaceId: string, fileId: string, parentId: string | null, targetWorkspaceId?: string | null) =>
    request<{ file: DriveFileRecord }>(`${teamBase(workspaceId)}/${fileId}/move`, {
      method: 'PUT',
      body: JSON.stringify({ parentId, targetWorkspaceId }),
    }),
  deleteTeamDriveFile: (workspaceId: string, fileId: string) =>
    request<{ message: string }>(`${teamBase(workspaceId)}/${fileId}`, { method: 'DELETE' }),
  // ---------- 回收站（R8.3 孤儿软删） ----------
  listTeamDriveTrash: (workspaceId: string) => request<{ files: DriveFileRecord[] }>(`${teamBase(workspaceId)}/trash`),
  restoreTeamDriveTrashFile: (workspaceId: string, fileId: string) =>
    request<{ message: string; file: DriveFileRecord }>(`${teamBase(workspaceId)}/trash/${fileId}/restore`, { method: 'POST' }),
  listTeamDriveFileVersions: (workspaceId: string, fileId: string) =>
    request<{ versions: DriveFileVersionRecord[] }>(`${teamBase(workspaceId)}/${fileId}/versions`),
  // 权限（协作者）
  listTeamDrivePermissions: (workspaceId: string, fileId: string) =>
    request<{ permissions: DriveFilePermissionRecord[] }>(`${teamBase(workspaceId)}/${fileId}/permissions`),
  setTeamDrivePermission: (workspaceId: string, fileId: string, payload: { principalType: 'user' | 'agent'; principalId: string; role: 'read' | 'edit' | 'manage' }) =>
    request<{ permission: DriveFilePermissionRecord }>(`${teamBase(workspaceId)}/${fileId}/permissions`, { method: 'PUT', body: JSON.stringify(payload) }),
  removeTeamDrivePermission: (workspaceId: string, fileId: string, principalType: 'user' | 'agent', principalId: string) =>
    request<{ message: string }>(`${teamBase(workspaceId)}/${fileId}/permissions/${principalType}/${principalId}`, { method: 'DELETE' }),
  // 链接分享
  getTeamDriveShare: (workspaceId: string, fileId: string) =>
    request<{ share: DriveFileShareRecord | null }>(`${teamBase(workspaceId)}/${fileId}/share`),
  createTeamDriveShare: (workspaceId: string, fileId: string, expiresAt?: string | null) =>
    request<{ share: DriveFileShareRecord; url: string }>(`${teamBase(workspaceId)}/${fileId}/share`, {
      method: 'POST',
      body: JSON.stringify({ expiresAt: expiresAt ?? null }),
    }),
  deleteTeamDriveShare: (workspaceId: string, fileId: string) =>
    request<{ message: string }>(`${teamBase(workspaceId)}/${fileId}/share`, { method: 'DELETE' }),
  // 全文搜索
  searchTeamDrive: (workspaceId: string, query: string) =>
    request<{ results: DriveSearchResult[] }>(`${teamBase(workspaceId)}/search?q=${encodeURIComponent(query)}`),
  // 云节点文件只读视图（直接读 R2 的 workspaces/<wid>/ 前缀）
  listTeamDriveCloudFiles: (workspaceId: string, path: string) =>
    request<{ entries: CloudDriveFileEntry[] }>(`${teamBase(workspaceId)}/cloud-files${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  getTeamDriveQuota: (workspaceId: string) =>
    request<DriveQuotaInfo>(`${teamBase(workspaceId)}/quota`),

  // ---------- 个人域 ----------
  listMyDriveTree: () => request<{ files: DriveFileRecord[] }>(`${myBase}/tree`),
  listMyDriveChildren: (parentId: string | null) =>
    request<{ files: DriveFileRecord[] }>(listChildrenPath(myBase, parentId)),
  createMyDriveFolder: (payload: { name: string; parentId?: string }) =>
    request<{ file: DriveFileRecord }>(`${myBase}/folders`, { method: 'POST', body: JSON.stringify(payload) }),
  uploadMyDriveFile: (file: File, parentId: string | null) => {
    const form = new FormData()
    form.append('file', file)
    if (parentId) form.append('parentId', parentId)
    return request<{ file: DriveFileRecord }>(`${myBase}/upload`, { method: 'POST', body: form })
  },
  createMyDriveTextFile: (payload: { name: string; content: string; parentId?: string }) =>
    request<{ file: DriveFileRecord }>(`${myBase}/text-files`, { method: 'POST', body: JSON.stringify(payload) }),
  saveMyDriveTextContent: (fileId: string, content: string) =>
    request<{ file: DriveFileRecord }>(`${myBase}/${fileId}/content`, { method: 'PUT', body: JSON.stringify({ content }) }),
  renameMyDriveFile: (fileId: string, name: string) =>
    request<{ file: DriveFileRecord }>(`${myBase}/${fileId}/rename`, { method: 'PUT', body: JSON.stringify({ name }) }),
  moveMyDriveFile: (fileId: string, parentId: string | null, targetWorkspaceId?: string | null) =>
    request<{ file: DriveFileRecord }>(`${myBase}/${fileId}/move`, { method: 'PUT', body: JSON.stringify({ parentId, targetWorkspaceId }) }),
  deleteMyDriveFile: (fileId: string) => request<{ message: string }>(`${myBase}/${fileId}`, { method: 'DELETE' }),
  listMyDriveTrash: () => request<{ files: DriveFileRecord[] }>(`${myBase}/trash`),
  restoreMyDriveTrashFile: (fileId: string) =>
    request<{ message: string; file: DriveFileRecord }>(`${myBase}/trash/${fileId}/restore`, { method: 'POST' }),
  listMyDriveFileVersions: (fileId: string) => request<{ versions: DriveFileVersionRecord[] }>(`${myBase}/${fileId}/versions`),
  // 权限（协作者）
  listMyDrivePermissions: (fileId: string) => request<{ permissions: DriveFilePermissionRecord[] }>(`${myBase}/${fileId}/permissions`),
  setMyDrivePermission: (fileId: string, payload: { principalType: 'user' | 'agent'; principalId: string; role: 'read' | 'edit' | 'manage' }) =>
    request<{ permission: DriveFilePermissionRecord }>(`${myBase}/${fileId}/permissions`, { method: 'PUT', body: JSON.stringify(payload) }),
  removeMyDrivePermission: (fileId: string, principalType: 'user' | 'agent', principalId: string) =>
    request<{ message: string }>(`${myBase}/${fileId}/permissions/${principalType}/${principalId}`, { method: 'DELETE' }),
  // 链接分享
  getMyDriveShare: (fileId: string) => request<{ share: DriveFileShareRecord | null }>(`${myBase}/${fileId}/share`),
  createMyDriveShare: (fileId: string, expiresAt?: string | null) =>
    request<{ share: DriveFileShareRecord; url: string }>(`${myBase}/${fileId}/share`, {
      method: 'POST',
      body: JSON.stringify({ expiresAt: expiresAt ?? null }),
    }),
  deleteMyDriveShare: (fileId: string) => request<{ message: string }>(`${myBase}/${fileId}/share`, { method: 'DELETE' }),
  // 全文搜索
  searchMyDrive: (query: string) => request<{ results: DriveSearchResult[] }>(`${myBase}/search?q=${encodeURIComponent(query)}`),
  // 云节点文件只读视图（个人域「我的云节点文件」）
  listMyDriveCloudFiles: (path: string) =>
    request<{ entries: CloudDriveFileEntry[] }>(`${myBase}/cloud-files${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  getMyDriveQuota: () => request<DriveQuotaInfo>(`${myBase}/quota`),

  // ---------- 权限协作者候选（添加协作者选择器） ----------
  searchDrivePermissionCandidates: (query?: string) =>
    request<{ users: DrivePermissionCandidate[] }>(
      `/api/drive/permission-candidates${query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`,
    ),
}

/** 权限协作者候选：按 name/email 搜索用户（Drive 权限添加协作者选择器；无 q = 全部用户） */
export type DrivePermissionCandidate = { id: string; name: string; email: string; avatarUrl: string | null }

// ---------- 下载 / 预览（需要鉴权 header，走 blob） ----------

const downloadAsBlob = async (url: string, fileName: string) => {
  const response = await authFetch(url)
  if (!response.ok) throw new Error('下载失败。')
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}

export const downloadDriveFile = (workspaceId: string | null, fileId: string, fileName: string) => {
  const url = workspaceId
    ? `/api/collab/workspaces/${workspaceId}/drive/${fileId}/download`
    : `/api/my/drive/${fileId}/download`
  return downloadAsBlob(url, fileName)
}

/** 读取文本文件内容（便签笔记编辑）：workspaceId 传 null = 个人域；返回文件文本 */
export const readDriveTextContent = async (workspaceId: string | null, fileId: string): Promise<string> => {
  const url = workspaceId
    ? `/api/collab/workspaces/${workspaceId}/drive/${fileId}/download`
    : `/api/my/drive/${fileId}/download`
  const response = await authFetch(url)
  if (!response.ok) throw new Error('读取文件内容失败。')
  return response.text()
}

/** 下载云节点文件（只读视图）：key 为 R2 相对对象键 */
export const downloadCloudDriveFile = (workspaceId: string, key: string, fileName: string) => {
  return downloadAsBlob(`/api/collab/workspaces/${workspaceId}/drive/cloud-files/download?key=${encodeURIComponent(key)}`, fileName)
}

/** 下载个人云节点文件（只读视图） */
export const downloadMyCloudDriveFile = (key: string, fileName: string) => {
  return downloadAsBlob(`/api/my/drive/cloud-files/download?key=${encodeURIComponent(key)}`, fileName)
}

/** 预览内容：返回可渲染的 URL（blob），供 <img>/<iframe> 使用 */
export const previewDriveFileUrl = async (workspaceId: string | null, fileId: string): Promise<string> => {
  const url = workspaceId
    ? `/api/collab/workspaces/${workspaceId}/drive/${fileId}/download`
    : `/api/my/drive/${fileId}/download`
  const response = await authFetch(url)
  if (!response.ok) throw new Error('预览失败。')
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}
