import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DriveFileRecord } from '@shared/types'
import { collectDescendants, hasRoleLevel } from '../repositories/drive-store'
import { guessContentType, inferTextFileMimeType, isCloudFileKeyWithinUser, isCloudFileKeyWithinWorkspace, resolveCloudFilesPrefix, resolveCloudFilesPrefixWithin, resolveDriveMoveTarget } from './drive-routes'

test('inferTextFileMimeType 按扩展名推断文本文件 MIME', () => {
  assert.equal(inferTextFileMimeType('note.md'), 'text/markdown')
  assert.equal(inferTextFileMimeType('README.markdown'), 'text/markdown')
  assert.equal(inferTextFileMimeType('page.html'), 'text/html')
  assert.equal(inferTextFileMimeType('log.txt'), 'text/plain')
  assert.equal(inferTextFileMimeType('no-extension'), 'text/plain')
  assert.equal(inferTextFileMimeType('UPPER.MD'), 'text/markdown')
})

test('guessContentType 按 MIME / 扩展名分类文件', () => {
  assert.equal(guessContentType('image/png', 'a.png'), 'image')
  assert.equal(guessContentType('video/mp4', 'a.mp4'), 'video')
  assert.equal(guessContentType('text/markdown', 'a.md'), 'document')
  assert.equal(guessContentType('', 'report.pdf'), 'document')
  assert.equal(guessContentType('', 'index.html'), 'document')
  assert.equal(guessContentType('application/zip', 'a.zip'), 'archive')
  assert.equal(guessContentType('', 'script.py'), 'code')
  assert.equal(guessContentType('application/octet-stream', 'random.bin'), 'other')
})

test('collectDescendants 收集目录子树（含深层嵌套，不含自身）', () => {
  const file = (id: string, parentId: string | null, type: 'folder' | 'file'): DriveFileRecord => ({
    id,
    workspaceId: 'ws-1',
    parentId,
    name: id,
    fileType: type,
    mimeType: null,
    sizeBytes: null,
    s3Key: type === 'file' ? 'key' : null,
    thumbnailS3Key: null,
    contentType: 'other',
    searchText: null,
    version: 1,
    visibility: 'team',
    deletedAt: null,
    createdBy: 'u1',
    createdAt: 'now',
    updatedAt: 'now',
  })

  const all = [
    file('root', null, 'folder'),
    file('a', 'root', 'folder'),
    file('a1', 'a', 'file'),
    file('b', 'root', 'file'),
    file('deep', 'a1', 'folder'), // 文件夹嵌套在文件下的异常情况也按 parentId 收集
  ]

  const descendants = collectDescendants(all, 'root')
  const ids = descendants.map((f) => f.id).sort()
  assert.deepEqual(ids, ['a', 'a1', 'b', 'deep'])
})

test('hasRoleLevel 角色等级判定（read < edit < manage < owner）', () => {
  assert.equal(hasRoleLevel('read', 'read'), true)
  assert.equal(hasRoleLevel('read', 'edit'), false)
  assert.equal(hasRoleLevel('edit', 'edit'), true)
  assert.equal(hasRoleLevel('edit', 'manage'), false)
  assert.equal(hasRoleLevel('manage', 'edit'), true)
  assert.equal(hasRoleLevel('owner', 'manage'), true)
  assert.equal(hasRoleLevel(null, 'read'), false)
})

test('resolveDriveMoveTarget 同区移动：缺省与显式同值均不跨区、不需要 manage', () => {
  const same = resolveDriveMoveTarget({ currentWorkspaceId: 'ws-1', role: 'edit', requestedTargetWorkspaceId: 'ws-1' })
  assert.equal(same.ok, true)
  if (same.ok) {
    assert.equal(same.targetWorkspaceId, 'ws-1')
    assert.equal(same.movingAcrossScopes, false)
  }
  const omitted = resolveDriveMoveTarget({ currentWorkspaceId: 'ws-1', role: 'edit' })
  assert.equal(omitted.ok, true)
  if (omitted.ok) assert.equal(omitted.movingAcrossScopes, false)
  // 个人目录同区（null == null）
  const personal = resolveDriveMoveTarget({ currentWorkspaceId: null, role: 'edit', requestedTargetWorkspaceId: null })
  assert.equal(personal.ok, true)
  if (personal.ok) assert.equal(personal.movingAcrossScopes, false)
})

test('resolveDriveMoveTarget 跨区移动：owner/manage 允许（个人→协作 与 协作→个人）', () => {
  // 个人文件（owner）→ 协作空间
  const toTeam = resolveDriveMoveTarget({ currentWorkspaceId: null, role: 'owner', requestedTargetWorkspaceId: 'ws-1' })
  assert.equal(toTeam.ok, true)
  if (toTeam.ok) {
    assert.equal(toTeam.targetWorkspaceId, 'ws-1')
    assert.equal(toTeam.movingAcrossScopes, true)
  }
  // 团队文件（manage 协作者）→ 个人空间
  const toPersonal = resolveDriveMoveTarget({ currentWorkspaceId: 'ws-1', role: 'manage', requestedTargetWorkspaceId: null })
  assert.equal(toPersonal.ok, true)
  if (toPersonal.ok) {
    assert.equal(toPersonal.targetWorkspaceId, null)
    assert.equal(toPersonal.movingAcrossScopes, true)
  }
})

test('resolveDriveMoveTarget 跨区移动：edit/read 拒绝，普通成员不能把团队文件移入个人空间', () => {
  const edit = resolveDriveMoveTarget({ currentWorkspaceId: 'ws-1', role: 'edit', requestedTargetWorkspaceId: null })
  assert.equal(edit.ok, false)
  if (!edit.ok) {
    assert.equal(edit.status, 403)
    assert.match(edit.message, /可管理权限/)
  }
  const read = resolveDriveMoveTarget({ currentWorkspaceId: 'ws-1', role: 'read', requestedTargetWorkspaceId: null })
  assert.equal(read.ok, false)
  if (!read.ok) assert.equal(read.status, 403)
  // 无角色（个人文件非本人 / 匿名）也不能跨区
  const none = resolveDriveMoveTarget({ currentWorkspaceId: null, role: null, requestedTargetWorkspaceId: 'ws-1' })
  assert.equal(none.ok, false)
  if (!none.ok) assert.equal(none.status, 403)
})

test('resolveCloudFilesPrefix 落在该工作区 workspaces/<wid>/ 前缀内', () => {
  assert.equal(resolveCloudFilesPrefix('ws-1', ''), 'workspaces/ws-1')
  assert.equal(resolveCloudFilesPrefix('ws-1', 'worktrees/task-1'), 'workspaces/ws-1/worktrees/task-1')
  assert.equal(resolveCloudFilesPrefix('ws-1', 'a/b/c/'), 'workspaces/ws-1/a/b/c')
})

test('resolveCloudFilesPrefix 拒绝 .. 与空段路径', () => {
  assert.equal(resolveCloudFilesPrefix('ws-1', '../secret'), '')
  assert.equal(resolveCloudFilesPrefix('ws-1', 'a/../b'), '')
  assert.equal(resolveCloudFilesPrefix('ws-1', 'a//b'), '')
  assert.equal(resolveCloudFilesPrefix('ws-1', '/etc/passwd'), 'workspaces/ws-1/etc/passwd')
})

test('isCloudFileKeyWithinWorkspace 拒绝跨工作区/穿越键', () => {
  assert.equal(isCloudFileKeyWithinWorkspace('ws-1', 'workspaces/ws-1/worktrees/task-1/src/main.ts'), true)
  assert.equal(isCloudFileKeyWithinWorkspace('ws-1', 'workspaces/ws-2/file.txt'), false)
  assert.equal(isCloudFileKeyWithinWorkspace('ws-1', 'users/user-1/agents/a1/file.txt'), false)
  assert.equal(isCloudFileKeyWithinWorkspace('ws-1', 'workspaces/ws-1/a/../b.txt'), false)
  assert.equal(isCloudFileKeyWithinWorkspace('ws-1', 'workspaces/ws-1'), false)
})

test('isCloudFileKeyWithinUser 拒绝越权个人键', () => {
  assert.equal(isCloudFileKeyWithinUser('user-1', 'users/user-1/agents/exec-1/file.txt'), true)
  assert.equal(isCloudFileKeyWithinUser('user-1', 'users/user-2/agents/exec-1/file.txt'), false)
  assert.equal(isCloudFileKeyWithinUser('user-1', 'workspaces/ws-1/worktrees/x/main.ts'), false)
  assert.equal(isCloudFileKeyWithinUser('user-1', 'users/user-1/agents/a/../b.txt'), false)
})

test('resolveCloudFilesPrefixWithin 在给定基前缀下规范化路径', () => {
  assert.equal(resolveCloudFilesPrefixWithin('users/user-1/agents', ''), 'users/user-1/agents')
  assert.equal(resolveCloudFilesPrefixWithin('users/user-1/agents', 'exec-1/notes.md'), 'users/user-1/agents/exec-1/notes.md')
  assert.equal(resolveCloudFilesPrefixWithin('users/user-1/agents', '../evil'), '')
})
