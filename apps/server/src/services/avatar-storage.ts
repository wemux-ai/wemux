// [INPUT]: 头像上传输入
// [OUTPUT]: 对象存储写入/读取
// [POS]: 头像存储
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { getObjectStorageStatus, streamObject, uploadObject } from './object-storage'

const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])

const MAX_AVATAR_SIZE = 5 * 1024 * 1024

const toUserAvatarKey = (userId: string, filename: string) => `avatars/${userId}/${filename}`
const toAgentAvatarKey = (agentId: string, filename: string) => `avatars/agents/${agentId}/${filename}`

const uploadAvatarFile = async (key: string, file: File) => {
  const extension = IMAGE_TYPES.get(file.type)
  if (!extension) {
    throw new Error('仅支持 JPG、PNG、WebP 或 GIF 图片。')
  }

  if (file.size > MAX_AVATAR_SIZE) {
    throw new Error('头像大小不能超过 5MB。')
  }

  const filename = `${Date.now()}-${crypto.randomUUID()}.${extension}`
  await uploadObject(`${key}/${filename}`, await file.arrayBuffer(), { contentType: file.type })
  return filename
}

export const getAvatarStorageStatus = () => {
  const storage = getObjectStorageStatus()
  return {
    configured: storage.configured,
    driver: storage.driver,
    bucket: storage.bucket,
    maxFileSizeMb: MAX_AVATAR_SIZE / 1024 / 1024,
    acceptedTypes: [...IMAGE_TYPES.keys()],
  }
}

export const uploadAvatar = async (userId: string, file: File) => {
  const filename = await uploadAvatarFile(`avatars/${userId}`, file)

  return {
    filename,
    avatarUrl: `/api/auth/users/${userId}/avatar/${filename}`,
  }
}

export const uploadAgentAvatar = async (agentId: string, file: File) => {
  const filename = await uploadAvatarFile(`avatars/agents/${agentId}`, file)

  return {
    filename,
    avatarUrl: `/api/agents/${agentId}/avatar/${filename}`,
  }
}

export const streamAvatar = async (userId: string, filename: string) => {
  const response = await streamObject(toUserAvatarKey(userId, filename))
  if (response.status !== 404) {
    return response
  }

  return new Response(JSON.stringify({ message: '头像不存在' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const streamAgentAvatar = async (agentId: string, filename: string) => {
  const response = await streamObject(toAgentAvatarKey(agentId, filename))
  if (response.status !== 404) {
    return response
  }

  return new Response(JSON.stringify({ message: 'Agent 头像不存在' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  })
}
