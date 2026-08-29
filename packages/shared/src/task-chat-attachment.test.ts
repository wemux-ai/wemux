import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTaskChatAttachments } from './task-chat-attachment'

test('normalizeTaskChatAttachments keeps legacy plain attachments as kind=file', () => {
  const normalized = normalizeTaskChatAttachments([{
    id: 'a-1',
    url: '/uploads/attachments/x.png',
    filename: 'x.png',
    contentType: 'image/png',
  }])

  assert.deepEqual(normalized, [{
    id: 'a-1',
    url: '/uploads/attachments/x.png',
    filename: 'x.png',
    contentType: 'image/png',
    kind: 'file',
  }])
})

test('normalizeTaskChatAttachments preserves drive reference attachments', () => {
  const normalized = normalizeTaskChatAttachments([{
    id: 'drive-file-1',
    url: '/api/drive-attachments/token/download',
    filename: 'report.pdf',
    contentType: 'application/pdf',
    kind: 'drive',
    driveFileId: 'file-1',
  }])

  assert.deepEqual(normalized, [{
    id: 'drive-file-1',
    url: '/api/drive-attachments/token/download',
    filename: 'report.pdf',
    contentType: 'application/pdf',
    kind: 'drive',
    driveFileId: 'file-1',
    driveWorkspaceId: null,
  }])
})

test('normalizeTaskChatAttachments drops driveFileId for non-drive attachments', () => {
  const normalized = normalizeTaskChatAttachments([{
    id: 'a-2',
    url: '/uploads/attachments/x.txt',
    filename: 'x.txt',
    driveFileId: 'file-1',
  }])

  assert.equal(normalized[0]?.kind, 'file')
  assert.equal(normalized[0]?.driveFileId, undefined)
})

test('normalizeTaskChatAttachments rejects invalid entries', () => {
  assert.deepEqual(normalizeTaskChatAttachments(null), [])
  assert.deepEqual(normalizeTaskChatAttachments([{ id: 'x' }]), [])
  assert.deepEqual(normalizeTaskChatAttachments([{ id: 'x', url: '', filename: 'f' }]), [])
})

test('normalizeTaskChatAttachments preserves drive workspace scope', () => {
  const team = normalizeTaskChatAttachments([{
    id: 'drive-1',
    url: '/api/drive-attachments/token/download',
    filename: 'report.md',
    kind: 'drive',
    driveFileId: 'file-1',
    driveWorkspaceId: 'ws-1',
  }])
  assert.equal(team[0]?.driveWorkspaceId, 'ws-1')

  const personal = normalizeTaskChatAttachments([{
    id: 'drive-2',
    url: '/api/drive-attachments/token/download',
    filename: 'notes.md',
    kind: 'drive',
    driveFileId: 'file-2',
    driveWorkspaceId: null,
  }])
  assert.equal(personal[0]?.driveWorkspaceId, null)
})
