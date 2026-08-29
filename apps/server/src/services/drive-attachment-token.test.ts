import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDriveAttachmentToken, parseDriveAttachmentToken, DRIVE_ATTACHMENT_TOKEN_TTL_MS } from './drive-attachment-token'

test('buildDriveAttachmentToken generates a parseable token', () => {
  const token = buildDriveAttachmentToken({ taskId: 'task-1', driveFileId: 'file-1' })
  assert.ok(token)
  assert.ok(token.includes('.'))

  const parsed = parseDriveAttachmentToken(token)
  assert.deepEqual(parsed, { taskId: 'task-1', driveFileId: 'file-1', issuedAt: parsed?.issuedAt })
})

test('parseDriveAttachmentToken rejects a tampered signature', () => {
  const token = buildDriveAttachmentToken({ taskId: 'task-1', driveFileId: 'file-1' })
  const tampered = `${token.slice(0, -2)}ff`
  assert.equal(parseDriveAttachmentToken(tampered), null)
})

test('parseDriveAttachmentToken rejects a modified payload', () => {
  const token = buildDriveAttachmentToken({ taskId: 'task-1', driveFileId: 'file-1' })
  // 替换 payload 里 taskId 为其他任务（签名不再匹配）
  const [payloadPart, signature] = token.split('.')
  const payload = Buffer.from(payloadPart, 'base64url').toString('utf8')
  const swapped = payload.replace('task-1', 'task-2')
  const swappedToken = `${Buffer.from(swapped, 'utf8').toString('base64url')}.${signature}`
  assert.equal(parseDriveAttachmentToken(swappedToken), null)
})

test('parseDriveAttachmentToken rejects expired tokens', () => {
  const token = buildDriveAttachmentToken({ taskId: 'task-1', driveFileId: 'file-1', issuedAt: Date.now() - DRIVE_ATTACHMENT_TOKEN_TTL_MS - 1 })
  assert.equal(parseDriveAttachmentToken(token), null)
})

test('parseDriveAttachmentToken rejects malformed tokens', () => {
  assert.equal(parseDriveAttachmentToken(''), null)
  assert.equal(parseDriveAttachmentToken('no-dot'), null)
  assert.equal(parseDriveAttachmentToken('...'), null)
})
