// [INPUT]: Drive 文件二进制与元数据
// [OUTPUT]: 对象存储上传 / 下载 / 删除（文件本体）
// [POS]: Drive 文件本体存储层，复用 object-storage（S3 兼容抽象：生产 Cloudflare R2，本地 dev RustFS，
//       endpoint/bucket/凭据配置驱动，换提供商只改配置不改本层代码；禁止硬编码厂商 API）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { randomUUID } from 'node:crypto'
import { deleteObject, downloadObject, streamObject, uploadObject } from './object-storage'

const DRIVE_PREFIX = 'drive'

/** 生成对象存储键：drive/<ws|user>/<id 前缀>/<uuid>-<safe-name>，同一文件新版本另生成新键（与提供商无关的逻辑键） */
export const buildDriveObjectKey = (workspaceId: string | null, userId: string, fileName: string) => {
  const scope = workspaceId ? `ws-${workspaceId.slice(0, 12)}` : `user-${userId.slice(0, 12)}`
  const safeName = fileName.replace(/[^\w.\-]+/g, '_').slice(0, 80)
  return `${DRIVE_PREFIX}/${scope}/${randomUUID()}-${safeName}`
}

export const uploadDriveObject = async (key: string, body: ArrayBuffer | Uint8Array, contentType: string) => {
  await uploadObject(key, body, { contentType, cacheControl: 'private, max-age=0' })
}

/** 下载/预览：返回可直接回给客户端的 Response（含 Content-Type） */
export const streamDriveObject = (key: string) => streamObject(key)

export const downloadDriveObject = async (key: string) => downloadObject(key)

export const deleteDriveObject = async (key: string) => deleteObject(key)
