import assert from 'node:assert/strict'
import test from 'node:test'
import type { Project, WorkspaceRecord, WorkspaceRole } from '@shared/types'
import {
  canUserManageProjectWorkspace,
  canWorkspaceRoleManageProjectWorkspace,
  getProjectWorkspaceManagementDeniedMessage,
} from './project-workspace-management-access'

const createProject = (workspaceId?: string): Pick<Project, 'workspaceId'> => ({ workspaceId })

const createWorkspace = (ownerUserId?: string): Pick<WorkspaceRecord, 'ownerUserId'> => ({ ownerUserId })

test('canWorkspaceRoleManageProjectWorkspace allows owner and admin only', () => {
  assert.equal(canWorkspaceRoleManageProjectWorkspace('owner'), true)
  assert.equal(canWorkspaceRoleManageProjectWorkspace('admin'), true)
  assert.equal(canWorkspaceRoleManageProjectWorkspace('member'), false)
  assert.equal(canWorkspaceRoleManageProjectWorkspace('viewer'), false)
  assert.equal(canWorkspaceRoleManageProjectWorkspace(null), false)
})

test('canUserManageProjectWorkspace allows the workspace creator without checking workspace membership', async () => {
  let called = false
  const allowed = await canUserManageProjectWorkspace({
    userId: 'user-creator',
    project: createProject('team-1'),
    workspace: createWorkspace('user-creator'),
    resolveWorkspaceRole: async () => {
      called = true
      return 'member'
    },
  })

  assert.equal(allowed, true)
  assert.equal(called, false)
})

test('canUserManageProjectWorkspace allows workspace owners and admins from the parent workspace', async () => {
  const allowedRoles: WorkspaceRole[] = ['owner', 'admin']

  for (const role of allowedRoles) {
    const allowed = await canUserManageProjectWorkspace({
      userId: `user-${role}`,
      project: createProject('team-1'),
      workspace: createWorkspace('user-creator'),
      resolveWorkspaceRole: async () => role,
    })
    assert.equal(allowed, true)
  }
})

test('canUserManageProjectWorkspace denies non-admin members of the parent workspace', async () => {
  const denied = await canUserManageProjectWorkspace({
    userId: 'user-member',
    project: createProject('team-1'),
    workspace: createWorkspace('user-creator'),
    resolveWorkspaceRole: async () => 'member',
  })

  assert.equal(denied, false)
})

test('canUserManageProjectWorkspace keeps legacy ownerless workspaces manageable', async () => {
  const allowed = await canUserManageProjectWorkspace({
    userId: 'user-legacy',
    project: createProject(),
    workspace: createWorkspace(),
  })

  assert.equal(allowed, true)
})

test('getProjectWorkspaceManagementDeniedMessage explains creator and workspace admin access', () => {
  assert.match(getProjectWorkspaceManagementDeniedMessage('archive'), /创建者/)
  assert.match(getProjectWorkspaceManagementDeniedMessage('restore'), /所有者\/管理员/)
  assert.match(getProjectWorkspaceManagementDeniedMessage('delete'), /删除工作区/)
})
