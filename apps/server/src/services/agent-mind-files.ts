// [INPUT]: Agent 创建时的基础信息（agentId / agentName / userId / config）
// [OUTPUT]: 云盘个人域 mind/ 模板文件（soul.md + memory/USER.md + MEMORY.md + MEMORY_INDEX.md）
// [POS]: Agent 灵魂与个人记忆的云盘文件初始化；文件权威在云盘个人域，worker 执行时由 server 下发快照
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { readCustomAgentConfig } from '@shared/custom-agent'
import { extractSearchText } from '@shared/drive-search'
import type { DriveFileRecord, DriveFileType } from '@shared/types'
import { createDriveFolder, getDriveFileById, listDriveFiles, registerDriveFile, updateDriveFileContent, type DriveScope } from '../repositories/drive-store'
import { buildDriveObjectKey, downloadDriveObject, uploadDriveObject } from './drive-storage'

/** 个人域根目录下的固定根目录名（存放所有 Agent 的记忆文件） */
const AGENTS_ROOT_FOLDER_NAME = 'agents'

/** 目录结构（个人域 workspaceId = null，按 createdBy = userId 归属）：
 *  agents/<agentId>/mind/
 *    ├── soul.md
 *    └── memory/
 *         ├── USER.md
 *         ├── MEMORY.md
 *         └── MEMORY_INDEX.md
 */

const textToBuffer = (text: string) => new TextEncoder().encode(text)

/** 上传一个 markdown 文件到个人域并登记元数据；已存在同名文件则跳过（幂等）。 */
const ensureMindFile = async (params: {
  userId: string
  parentId: string | null
  name: string
  content: string
}) => {
  const existing = await listDriveFiles({ workspaceId: null, userId: params.userId }, params.parentId)
  const found = existing.find((file) => file.fileType === 'file' && file.name === params.name)
  if (found) {
    return found
  }

  const key = buildDriveObjectKey(null, params.userId, params.name)
  const buffer = textToBuffer(params.content)
  await uploadDriveObject(key, buffer, 'text/markdown')
  return registerDriveFile(params.userId, {
    workspaceId: null,
    parentId: params.parentId,
    name: params.name,
    mimeType: 'text/markdown',
    sizeBytes: buffer.byteLength,
    s3Key: key,
    contentType: 'document',
    visibility: 'private',
    searchText: extractSearchText('text/markdown', params.name, params.content),
  })
}

/** 查找或创建个人域根目录下指定名称的文件夹。 */
const ensureFolder = async (params: {
  userId: string
  parentId: string | null
  name: string
}) => {
  const existing = await listDriveFiles({ workspaceId: null, userId: params.userId }, params.parentId)
  const found = existing.find((file) => file.fileType === 'folder' && file.name === params.name)
  if (found) {
    return found
  }

  return createDriveFolder(params.userId, {
    workspaceId: null,
    parentId: params.parentId,
    name: params.name,
  })
}

export const buildSoulTemplate = (agentName: string, role: string) => {
  return [
    `# Soul — ${agentName}`,
    '',
    '## Identity',
    `- **Role**: ${role || '未设置'}`,
    '',
    '## Personality',
    '- （语气与性格，owner 可编辑）',
    '',
    '## Work Style',
    '- （工作习惯）',
    '- 完成任务后，把可复用的用户偏好、项目约定与踩坑记录到 memory/MEMORY.md，避免未来重复询问或重复踩坑。',
    '',
    '## Boundaries',
    '- （红线与边界，例如：不修改用户项目仓库除非明确授权、敏感操作先询问）',
    '',
  ].join('\n')
}

const USER_MD_TEMPLATE = [
  '# User',
  '',
  '_这里记录关于用户的信息：偏好、沟通风格、期望、工作习惯。_',
  '',
].join('\n')

const MEMORY_MD_TEMPLATE = [
  '# Memory',
  '',
  '_这里记录 Agent 自己学到的知识：环境事实、项目约定、工具怪癖、重要决策。_',
  '',
].join('\n')

const MEMORY_INDEX_MD_TEMPLATE = [
  '# Memory Index',
  '',
  '## Topics',
  '<!-- 记忆索引：按主题列出 memory 里的条目，便于快速定位与去重 -->',
  '',
].join('\n')

/** 创建 Agent 时在云盘个人域落 mind/ 模板（幂等：已存在的文件/目录复用）。 */
export const ensureAgentMindFiles = async (params: {
  agentId: string
  agentName: string
  userId: string
  config?: Record<string, unknown>
}): Promise<{ mindFolderId: string }> => {
  const config = params.config ? readCustomAgentConfig(params.config) : null
  const role = config?.role ?? ''

  const agentsRoot = await ensureFolder({
    userId: params.userId,
    parentId: null,
    name: AGENTS_ROOT_FOLDER_NAME,
  })
  const agentFolder = await ensureFolder({
    userId: params.userId,
    parentId: agentsRoot.id,
    name: params.agentId,
  })
  const mindFolder = await ensureFolder({
    userId: params.userId,
    parentId: agentFolder.id,
    name: 'mind',
  })
  const memoryFolder = await ensureFolder({
    userId: params.userId,
    parentId: mindFolder.id,
    name: 'memory',
  })

  await ensureMindFile({
    userId: params.userId,
    parentId: mindFolder.id,
    name: 'soul.md',
    content: buildSoulTemplate(params.agentName, role),
  })
  await ensureMindFile({
    userId: params.userId,
    parentId: memoryFolder.id,
    name: 'USER.md',
    content: USER_MD_TEMPLATE,
  })
  await ensureMindFile({
    userId: params.userId,
    parentId: memoryFolder.id,
    name: 'MEMORY.md',
    content: MEMORY_MD_TEMPLATE,
  })
  await ensureMindFile({
    userId: params.userId,
    parentId: memoryFolder.id,
    name: 'MEMORY_INDEX.md',
    content: MEMORY_INDEX_MD_TEMPLATE,
  })

  return { mindFolderId: mindFolder.id }
}

// ---------- 读取（执行时注入） ----------

const decodeText = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

const findChildByName = async (
  scope: DriveScope,
  parentId: string | null,
  name: string,
  fileType: DriveFileType,
) => {
  const children = await listDriveFiles(scope, parentId)
  return children.find((file) => file.fileType === fileType && file.name === name) ?? null
}

const readFileText = async (file: DriveFileRecord | null): Promise<string> => {
  if (!file?.s3Key) return ''
  try {
    return decodeText(await downloadDriveObject(file.s3Key))
  } catch {
    return ''
  }
}

/** 去掉记忆文件里的标题与模板占位说明行（_这里记录..._ / <!-- 注释 -->）。 */
export const stripMemoryPlaceholder = (text: string) => {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('_') && !line.startsWith('<!--'))
    .join('\n')
}

/** 读 Agent 个人记忆快照（soul + memory：USER 优先 + MEMORY）；未初始化或读取失败返回 null（不阻断执行）。 */
export const readAgentMindSnapshot = async (params: {
  userId: string
  agentId: string
}): Promise<{ soul: string; memory: string; fileIds: { soul?: string; user?: string; memory?: string } } | null> => {
  const scope: DriveScope = { workspaceId: null, userId: params.userId }
  const agentsRoot = await findChildByName(scope, null, AGENTS_ROOT_FOLDER_NAME, 'folder')
  if (!agentsRoot) return null
  const agentFolder = await findChildByName(scope, agentsRoot.id, params.agentId, 'folder')
  if (!agentFolder) return null
  const mindFolder = await findChildByName(scope, agentFolder.id, 'mind', 'folder')
  if (!mindFolder) return null

  const soulFile = await findChildByName(scope, mindFolder.id, 'soul.md', 'file')
  const memoryFolder = await findChildByName(scope, mindFolder.id, 'memory', 'folder')

  const soul = await readFileText(soulFile)

  let memory = ''
  const fileIds: { soul?: string; user?: string; memory?: string } = {
    soul: soulFile?.id,
  }
  if (memoryFolder) {
    const userFile = await findChildByName(scope, memoryFolder.id, 'USER.md', 'file')
    const memoryFile = await findChildByName(scope, memoryFolder.id, 'MEMORY.md', 'file')
    const userText = stripMemoryPlaceholder(await readFileText(userFile)).slice(0, 1000)
    const memoryText = stripMemoryPlaceholder(await readFileText(memoryFile)).slice(0, 1000)
    memory = [userText, memoryText].filter(Boolean).join('\n\n')
    fileIds.user = userFile?.id
    fileIds.memory = memoryFile?.id
  }

  return { soul, memory, fileIds }
}

// ---------- 全文读写（设置页 markdown 编辑） ----------

/** Agent 个人记忆文件全文（soul.md / USER.md / MEMORY.md）+ 云盘 fileId。 */
export type AgentMindFile = { fileId: string | null; content: string }

export type AgentMindFileKey = 'soul' | 'user' | 'memory'

export type AgentMindFiles = {
  soul: AgentMindFile
  user: AgentMindFile
  memory: AgentMindFile
}

/** 读单个 Agent 记忆文件的全文；未初始化返回空 content + null fileId。供设置页逐文件渐进加载。 */
export const readAgentMindFile = async (params: {
  userId: string
  agentId: string
  file: AgentMindFileKey
}): Promise<AgentMindFile> => {
  const scope: DriveScope = { workspaceId: null, userId: params.userId }
  const empty: AgentMindFile = { fileId: null, content: '' }
  const agentsRoot = await findChildByName(scope, null, AGENTS_ROOT_FOLDER_NAME, 'folder')
  if (!agentsRoot) return empty
  const agentFolder = await findChildByName(scope, agentsRoot.id, params.agentId, 'folder')
  if (!agentFolder) return empty
  const mindFolder = await findChildByName(scope, agentFolder.id, 'mind', 'folder')
  if (!mindFolder) return empty

  if (params.file === 'soul') {
    const soulFile = await findChildByName(scope, mindFolder.id, 'soul.md', 'file')
    return { fileId: soulFile?.id ?? null, content: await readFileText(soulFile) }
  }

  const memoryFolder = await findChildByName(scope, mindFolder.id, 'memory', 'folder')
  if (!memoryFolder) return empty
  const targetFile = await findChildByName(scope, memoryFolder.id, params.file === 'user' ? 'USER.md' : 'MEMORY.md', 'file')
  return { fileId: targetFile?.id ?? null, content: await readFileText(targetFile) }
}

/** 读 Agent 个人记忆三个文件的全文；未初始化的文件返回空 content + null fileId。 */
export const readAgentMindFiles = async (params: {
  userId: string
  agentId: string
}): Promise<AgentMindFiles> => {
  const scope: DriveScope = { workspaceId: null, userId: params.userId }
  const empty: AgentMindFile = { fileId: null, content: '' }
  const agentsRoot = await findChildByName(scope, null, AGENTS_ROOT_FOLDER_NAME, 'folder')
  if (!agentsRoot) return { soul: empty, user: empty, memory: empty }
  const agentFolder = await findChildByName(scope, agentsRoot.id, params.agentId, 'folder')
  if (!agentFolder) return { soul: empty, user: empty, memory: empty }
  const mindFolder = await findChildByName(scope, agentFolder.id, 'mind', 'folder')
  if (!mindFolder) return { soul: empty, user: empty, memory: empty }

  const soulFile = await findChildByName(scope, mindFolder.id, 'soul.md', 'file')
  const memoryFolder = await findChildByName(scope, mindFolder.id, 'memory', 'folder')
  const userFile = memoryFolder ? await findChildByName(scope, memoryFolder.id, 'USER.md', 'file') : null
  const memoryFile = memoryFolder ? await findChildByName(scope, memoryFolder.id, 'MEMORY.md', 'file') : null

  return {
    soul: { fileId: soulFile?.id ?? null, content: await readFileText(soulFile) },
    user: { fileId: userFile?.id ?? null, content: await readFileText(userFile) },
    memory: { fileId: memoryFile?.id ?? null, content: await readFileText(memoryFile) },
  }
}

/** 写回单个记忆文件（覆盖原文件，不保留版本历史）；文件不存在则抛错。 */
export const writeAgentMindFile = async (params: {
  /** 定位个人域文件的 owner（决定对象键前缀，文件仍在 owner 域） */
  ownerUserId: string
  /** 实际操作者（审计用，记录到版本历史 uploadedBy；成员改记忆时记成员本人） */
  actorUserId: string
  fileId: string
  content: string
}): Promise<void> => {
  const file = await getDriveFileById(params.fileId)
  if (!file || file.fileType !== 'file') {
    throw new Error('记忆文件不存在。')
  }
  const key = buildDriveObjectKey(null, params.ownerUserId, file.name)
  const contentBytes = textToBuffer(params.content)
  await uploadDriveObject(key, contentBytes, file.mimeType ?? 'text/markdown')
  // 保留版本历史 + 记录实际操作者（业界主流审计：谁改的、什么时候改的、旧内容可回滚）
  await updateDriveFileContent(file, {
    s3Key: key,
    sizeBytes: contentBytes.byteLength,
    searchText: extractSearchText(file.mimeType, file.name, params.content),
  }, params.actorUserId)
}
