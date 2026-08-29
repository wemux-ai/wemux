import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDeleteObjectsXml, getObjectStorageStatus, parseListObjectsXml, readObjectStorageConfig } from './object-storage'

const OBJECT_STORAGE_ENV_KEYS = [
  'OBJECT_STORAGE_ENDPOINT',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_ACCESS_KEY_ID',
  'OBJECT_STORAGE_SECRET_ACCESS_KEY',
  'OBJECT_STORAGE_REGION',
  'OBJECT_STORAGE_KEY_PREFIX',
] as const

const withObjectStorageEnv = (
  env: Partial<Record<(typeof OBJECT_STORAGE_ENV_KEYS)[number], string>>,
  fn: () => void,
) => {
  const previous = new Map<string, string | undefined>()
  for (const key of OBJECT_STORAGE_ENV_KEYS) {
    previous.set(key, process.env[key])
    const value = env[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    fn()
  } finally {
    for (const key of OBJECT_STORAGE_ENV_KEYS) {
      const value = previous.get(key)
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('readObjectStorageConfig defaults the S3-compatible region to auto for Cloudflare R2', () => {
  withObjectStorageEnv({
    OBJECT_STORAGE_ENDPOINT: 'https://example-account.r2.cloudflarestorage.com/',
    OBJECT_STORAGE_BUCKET: 'vibemux-preview',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'access-key',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
  }, () => {
    assert.deepEqual(readObjectStorageConfig(), {
      endpoint: 'https://example-account.r2.cloudflarestorage.com',
      bucket: 'vibemux-preview',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      region: 'auto',
      keyPrefix: '',
      configured: true,
    })
  })
})

test('readObjectStorageConfig preserves an explicit S3-compatible region', () => {
  withObjectStorageEnv({
    OBJECT_STORAGE_ENDPOINT: 'https://s3.us-west-2.amazonaws.com',
    OBJECT_STORAGE_BUCKET: 'vibemux-production',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'access-key',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
    OBJECT_STORAGE_REGION: 'us-west-2',
  }, () => {
    assert.equal(readObjectStorageConfig().region, 'us-west-2')
  })
})

test('getObjectStorageStatus defaults region to auto for R2-compatible config', () => {
  withObjectStorageEnv({
    OBJECT_STORAGE_ENDPOINT: 'https://example-account.r2.cloudflarestorage.com/',
    OBJECT_STORAGE_BUCKET: 'vibemux-preview',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'access-key',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
  }, () => {
    assert.deepEqual(getObjectStorageStatus(), {
      configured: true,
      driver: 's3-compatible',
      bucket: 'vibemux-preview',
      region: 'auto',
      keyPrefix: '',
    })
  })
})

test('getObjectStorageStatus accepts explicit S3-compatible region', () => {
  withObjectStorageEnv({
    OBJECT_STORAGE_ENDPOINT: 'https://s3.example.com',
    OBJECT_STORAGE_REGION: 'us-east-1',
    OBJECT_STORAGE_BUCKET: 'vibemux-production',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'access-key',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
  }, () => {
    assert.equal(getObjectStorageStatus().region, 'us-east-1')
  })
})

test('readObjectStorageConfig normalizes an optional object key prefix', () => {
  withObjectStorageEnv({
    OBJECT_STORAGE_ENDPOINT: 'https://example-account.r2.cloudflarestorage.com/',
    OBJECT_STORAGE_BUCKET: 'vibemux-preview',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'access-key',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
    OBJECT_STORAGE_KEY_PREFIX: '/pr/my-branch/',
  }, () => {
    assert.equal(readObjectStorageConfig().keyPrefix, 'pr/my-branch')
    assert.equal(getObjectStorageStatus().keyPrefix, 'pr/my-branch')
  })
})

// ---------- 云节点文件只读视图：ListObjectsV2 XML 解析 ----------

test('parseListObjectsXml splits CommonPrefixes into folders and Contents into files', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>vibemux-dev</Name>
  <Prefix>workspaces/ws-1/</Prefix>
  <KeyCount>4</KeyCount>
  <MaxKeys>1000</MaxKeys>
  <IsTruncated>false</IsTruncated>
  <Contents>
    <Key>workspaces/ws-1/README.md</Key>
    <LastModified>2026-08-11T03:00:00.000Z</LastModified>
    <ETag>&quot;abc&quot;</ETag>
    <Size>1234</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>
  <Contents>
    <Key>workspaces/ws-1/workspaces/ws-1/worktrees/task-1/src/main.ts</Key>
    <LastModified>2026-08-11T04:00:00.000Z</LastModified>
    <Size>5678</Size>
  </Contents>
  <CommonPrefixes>
    <Prefix>workspaces/ws-1/workspaces/</Prefix>
  </CommonPrefixes>
</ListBucketResult>`

  const entries = parseListObjectsXml(xml, '')

  assert.deepEqual(entries, [
    {
      kind: 'folder',
      name: 'workspaces',
      key: 'workspaces/ws-1/workspaces',
      sizeBytes: null,
      updatedAt: null,
    },
    {
      kind: 'file',
      name: 'README.md',
      key: 'workspaces/ws-1/README.md',
      sizeBytes: 1234,
      updatedAt: '2026-08-11T03:00:00.000Z',
    },
    {
      kind: 'file',
      name: 'main.ts',
      key: 'workspaces/ws-1/workspaces/ws-1/worktrees/task-1/src/main.ts',
      sizeBytes: 5678,
      updatedAt: '2026-08-11T04:00:00.000Z',
    },
  ])
})

test('parseListObjectsXml strips the configured keyPrefix from returned keys', () => {
  const xml = `<ListBucketResult>
  <Contents>
    <Key>vmx/workspaces/ws-1/file.txt</Key>
    <Size>10</Size>
  </Contents>
  <CommonPrefixes>
    <Prefix>vmx/workspaces/ws-1/sub/</Prefix>
  </CommonPrefixes>
</ListBucketResult>`

  const entries = parseListObjectsXml(xml, 'vmx')

  assert.deepEqual(entries, [
    {
      kind: 'folder',
      name: 'sub',
      key: 'workspaces/ws-1/sub',
      sizeBytes: null,
      updatedAt: null,
    },
    {
      kind: 'file',
      name: 'file.txt',
      key: 'workspaces/ws-1/file.txt',
      sizeBytes: 10,
      updatedAt: null,
    },
  ])
})

test('parseListObjectsXml decodes XML entities in keys', () => {
  const xml = `<ListBucketResult>
  <Contents>
    <Key>workspaces/ws-1/a &amp; b.txt</Key>
    <Size>5</Size>
  </Contents>
</ListBucketResult>`

  const entries = parseListObjectsXml(xml, '')

  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.name, 'a & b.txt')
  assert.equal(entries[0]!.key, 'workspaces/ws-1/a & b.txt')
})

test('parseListObjectsXml maps nested CommonPrefixes to their current-level name', () => {
  const xml = `<ListBucketResult>
  <CommonPrefixes>
    <Prefix>workspaces/ws-1/a/</Prefix>
  </CommonPrefixes>
  <CommonPrefixes>
    <Prefix>workspaces/ws-1/a/b/</Prefix>
  </CommonPrefixes>
</ListBucketResult>`

  const entries = parseListObjectsXml(xml, '')

  assert.deepEqual(entries.map((entry) => entry.name), ['a', 'b'])
  assert.deepEqual(entries.map((entry) => entry.key), ['workspaces/ws-1/a', 'workspaces/ws-1/a/b'])
})

// ---------- 云节点文件前缀清理：DeleteObjects XML ----------

test('buildDeleteObjectsXml builds quiet-mode delete payload with escaped keys', () => {
  const xml = buildDeleteObjectsXml(['workspaces/ws-1/a.txt', 'workspaces/ws-1/a & b.txt'])
  assert.match(xml, /^<Delete>/)
  assert.match(xml, /<Object><Key>workspaces\/ws-1\/a.txt<\/Key><\/Object>/)
  assert.match(xml, /<Key>workspaces\/ws-1\/a &amp; b.txt<\/Key>/)
  assert.match(xml, /<Quiet>true<\/Quiet><\/Delete>$/)
})

test('buildDeleteObjectsXml returns empty for no keys', () => {
  assert.equal(buildDeleteObjectsXml([]), '')
})
