// [INPUT]: 对象存储请求
// [OUTPUT]: S3 操作
// [POS]: 对象存储封装
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { AwsClient } from 'aws4fetch'

type ObjectStorageConfig = {
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  endpoint: string
  region: string
  keyPrefix: string
  configured: boolean
}

const normalizeObjectStorageKeyPrefix = (value: string) => value
  .trim()
  .replace(/^\/+/, '')
  .replace(/\/+$/, '')

export const readObjectStorageConfig = (): ObjectStorageConfig => {
  const bucket = process.env.OBJECT_STORAGE_BUCKET?.trim() ?? ''
  const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim() ?? ''
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim() ?? ''
  const endpoint = (process.env.OBJECT_STORAGE_ENDPOINT?.trim() ?? '').replace(/\/$/, '')
  const region = process.env.OBJECT_STORAGE_REGION?.trim() || 'auto'
  const keyPrefix = normalizeObjectStorageKeyPrefix(process.env.OBJECT_STORAGE_KEY_PREFIX ?? '')

  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint,
    region,
    keyPrefix,
    configured: Boolean(endpoint && bucket && accessKeyId && secretAccessKey),
  }
}

const resolveObjectStorageKey = (keyPrefix: string, key: string) => {
  const normalizedKey = key.replace(/^\/+/, '')
  return keyPrefix ? `${keyPrefix}/${normalizedKey}` : normalizedKey
}

const buildObjectUrl = (endpoint: string, bucket: string, key: string) => {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  return `${endpoint}/${bucket}/${encodedKey}`
}

const getClient = () => {
  const config = readObjectStorageConfig()
  if (!config.configured) {
    throw new Error('对象存储未配置，请补充 OBJECT_STORAGE_ENDPOINT、OBJECT_STORAGE_BUCKET、OBJECT_STORAGE_ACCESS_KEY_ID、OBJECT_STORAGE_SECRET_ACCESS_KEY 和可选 OBJECT_STORAGE_REGION。')
  }

  return {
    config,
    client: new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: 's3',
      region: config.region,
    }),
  }
}

export const getObjectStorageStatus = () => {
  const config = readObjectStorageConfig()

  return {
    configured: config.configured,
    driver: 's3-compatible',
    bucket: config.bucket,
    region: config.region,
    keyPrefix: config.keyPrefix,
  }
}

export const uploadObject = async (key: string, body: ArrayBuffer | Uint8Array, options: {
  contentType: string
  cacheControl?: string
}) => {
  const { config, client } = getClient()
  const payload = new Blob([body instanceof Uint8Array ? Uint8Array.from(body).buffer : body])
  const response = await client.fetch(buildObjectUrl(config.endpoint, config.bucket, resolveObjectStorageKey(config.keyPrefix, key)), {
    method: 'PUT',
    headers: {
      'Content-Type': options.contentType,
      'Cache-Control': options.cacheControl || 'public, max-age=31536000, immutable',
    },
    body: payload,
  })

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || '上传对象到对象存储失败。')
  }
}

export const streamObject = async (key: string) => {
  const { config, client } = getClient()
  const response = await client.fetch(buildObjectUrl(config.endpoint, config.bucket, resolveObjectStorageKey(config.keyPrefix, key)), { method: 'GET' })

  if (response.status === 404) {
    return new Response(JSON.stringify({ message: '文件不存在' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    return new Response(JSON.stringify({ message: message || '读取文件失败' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const headers = new Headers()
  headers.set('Content-Type', response.headers.get('content-type') || 'application/octet-stream')
  headers.set('Cache-Control', response.headers.get('cache-control') || 'public, max-age=3600')

  return new Response(response.body, {
    status: 200,
    headers,
  })
}

export const downloadObject = async (key: string) => {
  const { config, client } = getClient()
  const response = await client.fetch(
    buildObjectUrl(config.endpoint, config.bucket, resolveObjectStorageKey(config.keyPrefix, key)),
    { method: 'GET' },
  )
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || (response.status === 404 ? '对象不存在。' : '读取对象失败。'))
  }
  return new Uint8Array(await response.arrayBuffer())
}

export const deleteObject = async (key: string) => {
  const { config, client } = getClient()
  const response = await client.fetch(
    buildObjectUrl(config.endpoint, config.bucket, resolveObjectStorageKey(config.keyPrefix, key)),
    { method: 'DELETE' },
  )
  if (!response.ok && response.status !== 404) {
    const message = await response.text().catch(() => '')
    throw new Error(message || '删除对象失败。')
  }
}

// ---------- 列出前缀（云节点文件只读视图用） ----------

export type ObjectStorageListEntry = {
  kind: 'folder' | 'file'
  /** 当前层名称（不含路径） */
  name: string
  /** 相对对象键（不含 keyPrefix）：文件 = 对象键；文件夹 = 前缀 */
  key: string
  sizeBytes: number | null
  updatedAt: string | null
}

const decodeXmlEntities = (value: string) => value
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&')

const extractXmlTagValues = (xml: string, tag: string) => {
  const values: string[] = []
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g')
  let match: RegExpExecArray | null
  while ((match = regex.exec(xml)) !== null) {
    values.push(decodeXmlEntities(match[1]))
  }
  return values
}

/** 解析 S3 ListObjectsV2 XML 为目录层 + 文件层（纯函数，可单测） */
export const parseListObjectsXml = (xml: string, keyPrefix: string): ObjectStorageListEntry[] => {
  const stripKeyPrefix = (key: string) => (keyPrefix && key.startsWith(`${keyPrefix}/`))
    ? key.slice(keyPrefix.length + 1)
    : key

  const entries: ObjectStorageListEntry[] = []
  for (const block of xml.split('<CommonPrefixes>').slice(1)) {
    const folderKey = extractXmlTagValues(block, 'Prefix')[0]
    if (!folderKey) continue
    const relativeKey = stripKeyPrefix(folderKey)
    if (!relativeKey) continue
    const trimmed = relativeKey.replace(/\/+$/, '')
    const name = trimmed.split('/').pop() || trimmed
    if (entries.some((entry) => entry.kind === 'folder' && entry.name === name)) continue
    entries.push({
      kind: 'folder',
      name,
      key: trimmed,
      sizeBytes: null,
      updatedAt: null,
    })
  }

  for (const block of xml.split('<Contents>').slice(1)) {
    const key = extractXmlTagValues(block, 'Key')[0]
    if (!key) continue
    const relativeKey = stripKeyPrefix(key)
    if (!relativeKey) continue
    const name = relativeKey.split('/').pop() || relativeKey
    const sizeRaw = extractXmlTagValues(block, 'Size')[0]
    const sizeBytes = sizeRaw ? Number.parseInt(sizeRaw, 10) : null
    const updatedAt = extractXmlTagValues(block, 'LastModified')[0] || null
    entries.push({
      kind: 'file',
      name,
      key: relativeKey,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
      updatedAt,
    })
  }

  return entries
}

/**
 * 列出某前缀下的直接子项（delimiter=/ 返回 CommonPrefixes 目录层 + Contents 文件层）。
 * 返回的 key 为相对键（不含 keyPrefix），与 downloadObject/streamObject 的入参一致。
 */
export const listObjectPrefix = async (prefix: string): Promise<ObjectStorageListEntry[]> => {
  const { config, client } = getClient()
  const fullPrefix = resolveObjectStorageKey(config.keyPrefix, prefix)
  const url = new URL(buildObjectUrl(config.endpoint, config.bucket, ''))
  url.searchParams.set('list-type', '2')
  if (fullPrefix) {
    url.searchParams.set('prefix', fullPrefix)
  }
  url.searchParams.set('delimiter', '/')
  url.searchParams.set('max-keys', '1000')

  const response = await client.fetch(url.toString(), { method: 'GET' })
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || '列出对象失败。')
  }
  const xml = await response.text()
  return parseListObjectsXml(xml, config.keyPrefix)
}

/** 统计某前缀下全部对象的总字节数（分页 list 求和；云节点文件计入配额） */
export const sumObjectPrefixSize = async (prefix: string) => {
  const { config, client } = getClient()
  const fullPrefix = resolveObjectStorageKey(config.keyPrefix, prefix)
  let continuationToken: string | undefined
  let totalBytes = 0

  do {
    const url = new URL(buildObjectUrl(config.endpoint, config.bucket, ''))
    url.searchParams.set('list-type', '2')
    if (fullPrefix) {
      url.searchParams.set('prefix', fullPrefix)
    }
    url.searchParams.set('max-keys', '1000')
    if (continuationToken) {
      url.searchParams.set('continuation-token', continuationToken)
    }

    const response = await client.fetch(url.toString(), { method: 'GET' })
    if (!response.ok) {
      const message = await response.text().catch(() => '')
      throw new Error(message || '列出对象失败。')
    }
    const xml = await response.text()
    for (const block of xml.split('<Contents>').slice(1)) {
      const sizeRaw = extractXmlTagValues(block, 'Size')[0]
      const size = sizeRaw ? Number.parseInt(sizeRaw, 10) : 0
      if (Number.isFinite(size) && size > 0) {
        totalBytes += size
      }
    }
    continuationToken = extractXmlTagValues(xml, 'NextContinuationToken')[0] || undefined
  } while (continuationToken)

  return totalBytes
}

const escapeXmlText = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/** 构造 S3 DeleteObjects 请求体（每批 ≤ 1000 key；Quiet 模式不返回删除明细） */
export const buildDeleteObjectsXml = (keys: string[]) => {
  if (keys.length === 0) {
    return ''
  }
  const objects = keys
    .map((key) => `<Object><Key>${escapeXmlText(key)}</Key></Object>`)
    .join('')
  return `<Delete>${objects}<Quiet>true</Quiet></Delete>`
}

/**
 * 删除某前缀下的全部对象（云节点文件清理：工作区删除 → 清 workspaces/<wid>/）。
 * 分页 list（continuation-token）+ 每批 500 个 DeleteObjects；返回删除对象数。
 */
export const deleteObjectPrefix = async (prefix: string) => {
  const { config, client } = getClient()
  const fullPrefix = resolveObjectStorageKey(config.keyPrefix, prefix)
  let continuationToken: string | undefined
  let deletedCount = 0

  do {
    const url = new URL(buildObjectUrl(config.endpoint, config.bucket, ''))
    url.searchParams.set('list-type', '2')
    if (fullPrefix) {
      url.searchParams.set('prefix', fullPrefix)
    }
    url.searchParams.set('max-keys', '1000')
    if (continuationToken) {
      url.searchParams.set('continuation-token', continuationToken)
    }

    const listResponse = await client.fetch(url.toString(), { method: 'GET' })
    if (!listResponse.ok) {
      const message = await listResponse.text().catch(() => '')
      throw new Error(message || '列出对象失败。')
    }
    const xml = await listResponse.text()
    const keys = extractXmlTagValues(xml, 'Key')
    continuationToken = extractXmlTagValues(xml, 'NextContinuationToken')[0] || undefined

    for (let index = 0; index < keys.length; index += 500) {
      const batch = keys.slice(index, index + 500)
      if (batch.length === 0) {
        continue
      }
      const deleteXml = buildDeleteObjectsXml(batch)
      const deleteUrl = new URL(buildObjectUrl(config.endpoint, config.bucket, ''))
      deleteUrl.searchParams.set('delete', '')
      const deleteResponse = await client.fetch(deleteUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: deleteXml,
      })
      if (!deleteResponse.ok) {
        const message = await deleteResponse.text().catch(() => '')
        throw new Error(message || '批量删除对象失败。')
      }
      deletedCount += batch.length
    }
  } while (continuationToken)

  return deletedCount
}
