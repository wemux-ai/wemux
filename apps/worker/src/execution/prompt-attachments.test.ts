import assert from 'node:assert/strict'
import test from 'node:test'
import { injectPromptAttachments, type MaterializedPromptAttachment } from './prompt-attachments'

test('injectPromptAttachments adds drive writeback guidance for drive reference attachments', () => {
  const driveAttachment: MaterializedPromptAttachment = {
    id: 'drive-1',
    url: '/api/drive-attachments/token/download',
    filename: 'report.md',
    contentType: 'text/markdown',
    kind: 'drive',
    driveFileId: 'file-1',
    driveWorkspaceId: 'ws-1',
    absoluteUrl: 'https://cloud.example.com/api/drive-attachments/token/download',
    localPath: '/tmp/vibemux-task-chat-attachments-xxx/1-report.md',
  }

  const injected = injectPromptAttachments('请处理这份文件。', [driveAttachment])

  assert.match(injected, /Drive 云盘文件引用（fileId: file-1，workspaceId: ws-1）/)
  assert.match(injected, /vibemux-drive-writeback skill/)
  assert.match(injected, /drive.write_file/)
})

test('injectPromptAttachments uses personal scope for drive files without workspace', () => {
  const personal: MaterializedPromptAttachment = {
    id: 'drive-2',
    url: '/api/drive-attachments/token/download',
    filename: 'notes.md',
    kind: 'drive',
    driveFileId: 'file-2',
    driveWorkspaceId: null,
    absoluteUrl: 'https://cloud.example.com/api/drive-attachments/token/download',
    localPath: '/tmp/vibemux-task-chat-attachments-xxx/2-notes.md',
  }

  const injected = injectPromptAttachments('处理', [personal])
  assert.match(injected, /fileId: file-2，personal: true/)
})

test('injectPromptAttachments keeps legacy file attachments unchanged', () => {
  const plain: MaterializedPromptAttachment = {
    id: 'a-1',
    url: '/uploads/attachments/x.png',
    filename: 'x.png',
    contentType: 'image/png',
    kind: 'file',
    absoluteUrl: 'https://cloud.example.com/uploads/attachments/x.png',
    localPath: '/tmp/vibemux-task-chat-attachments-xxx/1-x.png',
  }

  const injected = injectPromptAttachments('看图', [plain])
  assert.ok(!injected.includes('Drive 云盘文件引用'))
  assert.match(injected, /图片附件/)
})
