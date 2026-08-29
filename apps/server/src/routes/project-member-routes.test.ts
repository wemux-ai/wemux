import assert from 'node:assert/strict'
import test from 'node:test'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Project } from '@shared/types'
import {
  addTeamMemberAndWait,
  addUserProjectAndWait,
  createTeamAndWait,
  createToken,
  createUser,
  getUserProjectIds,
} from '../repositories/auth'
import { closePostgres } from '../storage/postgres/db'
import { loadState, resetState, saveProjectAndWait } from '../storage/app-state-store'
import { resetClusterData } from '../storage/distributed-task-store'
import { getScopedState } from './shared'
import { createProjectRecord } from './project-route-shared'
import { registerProjectMemberRoutes } from './project-member-routes'

const requireAuth: MiddlewareHandler = async (_c, next) => {
  await next()
}

const createApp = () => {
  const app = new Hono()
  registerProjectMemberRoutes(app, requireAuth)
  return app
}

const withSuppressedPostgresErrors = async <T>(action: () => Promise<T> | T) => {
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[postgres]')) {
      return
    }
    originalConsoleError(...args)
  }

  try {
    return await action()
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0))
    console.error = originalConsoleError
  }
}

/** 组织成员判定走 collab_workspaces / legacy teams（listUserWorkspaces），需要真实 Postgres；不可用时跳过 */
let postgresAvailable = false

test.before(async () => {
  try {
    const { ensurePostgresReady } = await import('../storage/postgres/db')
    await withSuppressedPostgresErrors(async () => {
      await ensurePostgresReady()
    })
    postgresAvailable = true
  } catch {
    postgresAvailable = false
  }
})

test.after(async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()
    await closePostgres()
  })
})

type MemberFixture = {
  ownerId: string
  memberId: string
  outsiderId: string
  project: Project
}

const setupMemberFixture = async (): Promise<MemberFixture> => {
  resetState()
  resetClusterData()

  const suffix = crypto.randomUUID().slice(0, 8)
  const owner = await createUser(`owner-${suffix}@test.local`, 'password-123', `Owner ${suffix}`)
  const member = await createUser(`member-${suffix}@test.local`, 'password-123', `Member ${suffix}`)
  const outsider = await createUser(`outsider-${suffix}@test.local`, 'password-123', `Outsider ${suffix}`)

  // 同组织：legacy team 路径（listUserWorkspaces 会回退合并 legacy teams）；用 AndWait 变体避免持久化竞态
  const team = await createTeamAndWait(`team-${suffix}`, owner.id)
  await addTeamMemberAndWait(team.id, member.id)

  const project = createProjectRecord({
    name: `private-project-${suffix}`,
    gitUrl: '',
    visibility: 'private',
    versionControl: 'none',
    defaultBranch: 'main',
    rootPath: `/tmp/vibemux-test/private-project-${suffix}`,
  }, undefined)
  await saveProjectAndWait(project)
  await addUserProjectAndWait(owner.id, project.id, 'owner')

  return { ownerId: owner.id, memberId: member.id, outsiderId: outsider.id, project }
}

const authHeadersFor = (userId: string): Record<string, string> => ({
  Authorization: `Bearer ${createToken(userId)}`,
  'content-type': 'application/json',
})

test('owner adds same-org member; member gains scoped visibility and shows in member list', async (t) => {
  if (!postgresAvailable) {
    t.skip('Postgres unavailable')
    return
  }

  await withSuppressedPostgresErrors(async () => {
    const app = createApp()
    const { ownerId, memberId, project } = await setupMemberFixture()

    assert.ok(!getUserProjectIds(memberId).includes(project.id), '加入前不应可见')

    const addResponse = await app.request(`/api/projects/${project.id}/members`, {
      method: 'POST',
      headers: authHeadersFor(ownerId),
      body: JSON.stringify({ userId: memberId }),
    })
    assert.equal(addResponse.status, 200)
    assert.ok(getUserProjectIds(memberId).includes(project.id), '拉入后应可访问')

    // scoped state：成员视角能看到项目（私有项目拉人可见的核心断言）
    const scopedForMember = getScopedState(loadState(), memberId)
    assert.ok(scopedForMember.projects.some((item) => item.id === project.id))

    const listResponse = await app.request(`/api/projects/${project.id}/members`, {
      headers: authHeadersFor(memberId),
    })
    assert.equal(listResponse.status, 200)
    const { members } = await listResponse.json() as { members: Array<{ userId: string; accessType: string }> }
    assert.deepEqual(
      members.map((entry) => ({ userId: entry.userId, accessType: entry.accessType }))
        .sort((left, right) => left.userId.localeCompare(right.userId)),
      [
        { userId: ownerId, accessType: 'owner' },
        { userId: memberId, accessType: 'member' },
      ].sort((left, right) => left.userId.localeCompare(right.userId)),
    )
  })
})

test('non-owner cannot manage members and cross-org user is rejected', async (t) => {
  if (!postgresAvailable) {
    t.skip('Postgres unavailable')
    return
  }

  await withSuppressedPostgresErrors(async () => {
    const app = createApp()
    const { ownerId, memberId, outsiderId, project } = await setupMemberFixture()

    const forbiddenResponse = await app.request(`/api/projects/${project.id}/members`, {
      method: 'POST',
      headers: authHeadersFor(memberId),
      body: JSON.stringify({ userId: outsiderId }),
    })
    assert.equal(forbiddenResponse.status, 403)

    const crossOrgResponse = await app.request(`/api/projects/${project.id}/members`, {
      method: 'POST',
      headers: authHeadersFor(ownerId),
      body: JSON.stringify({ userId: outsiderId }),
    })
    assert.equal(crossOrgResponse.status, 403)
    assert.ok(!getUserProjectIds(outsiderId).includes(project.id))
  })
})

test('owner removes member and cannot remove self as owner', async (t) => {
  if (!postgresAvailable) {
    t.skip('Postgres unavailable')
    return
  }

  await withSuppressedPostgresErrors(async () => {
    const app = createApp()
    const { ownerId, memberId, project } = await setupMemberFixture()
    await app.request(`/api/projects/${project.id}/members`, {
      method: 'POST',
      headers: authHeadersFor(ownerId),
      body: JSON.stringify({ userId: memberId }),
    })

    const removeOwnerResponse = await app.request(`/api/projects/${project.id}/members/${ownerId}`, {
      method: 'DELETE',
      headers: authHeadersFor(ownerId),
    })
    assert.equal(removeOwnerResponse.status, 400)

    const removeResponse = await app.request(`/api/projects/${project.id}/members/${memberId}`, {
      method: 'DELETE',
      headers: authHeadersFor(ownerId),
    })
    assert.equal(removeResponse.status, 200)
    assert.ok(!getUserProjectIds(memberId).includes(project.id), '移除后不应再可见')
  })
})
