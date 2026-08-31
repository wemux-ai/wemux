/**
 * [INPUT]: Auth repository operations, Drizzle schema, token secrets, and shared auth contracts.
 * [OUTPUT]: Persistent users, teams, sessions, and personal access token records.
 * [POS]: Postgres auth store; owns auth persistence but not HTTP response envelopes.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { createHash, createHmac, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { PersonalAccessToken, PersonalAccessTokenCreateResponse } from '@shared/auth'
import { isPlaygroundProjectId } from '@shared/playground-workspace'
import { normalizeUsername, buildUniqueUsernameCandidate } from '@shared/username'
import type { Team as SharedTeam, TeamActivity, TeamInvitation as SharedTeamInvitation, TeamRole } from '@shared/types'
import { resolveSharedTokenSecret } from '../../services/token-secret'
import { and, desc, eq, lt } from 'drizzle-orm'

import { ensurePostgresReady } from './db'
import { provisionInitialUserAgent } from './agent-store'
import { getDrizzleDb } from './drizzle-db'
import { cloneJson, schedulePersistence } from './helpers'
import {
  authEvents,
  betterAuthSessions,
  collabWorkspaceMembers,
  collabWorkspaceProjects,
  collabWorkspaces,
  personalAccessTokens,
  revokedAuthTokens,
  teamActivities,
  teamInvitations,
  teamMembers,
  teamProjects,
  teams,
  userProjects,
  users,
  type UserRole,
  type UserStatus,
} from './schema'

export type { UserRole, UserStatus } from './schema'

export type User = {
  id: string
  email: string
  name: string
  /** 用户 ID（@username）：全局唯一；老用户回填前为 undefined */
  username?: string
  /** 用户 ID 最近修改时间（30 天冷静期用） */
  usernameUpdatedAt?: string
  avatarUrl?: string
  bio?: string
  onboardingCompletedAt?: string
  onboardingDismissedAt?: string
  onboardingPath?: 'existing-repo' | 'quickstart' | 'team'
  authProvider?: 'password' | 'google'
  isInternal?: boolean
  status?: UserStatus
  role?: UserRole
  emailVerifiedAt?: string
  lastLoginAt?: string
  lastLoginIp?: string
  suspendedUntil?: string
  bannedReason?: string
  bannedAt?: string
  supportNote?: string
  supportNoteStatus?: 'pending' | 'in_progress' | 'resolved'
  createdAt: string
}

export type AuthEvent = {
  id: string
  userId?: string
  email?: string
  eventType: string
  provider?: string
  result: 'success' | 'fail' | 'blocked'
  ip?: string
  userAgent?: string
  metadataJson?: Record<string, unknown>
  createdAt: string
}

export type Team = SharedTeam

export type TeamMember = {
  teamId: string
  userId: string
  role: TeamRole
}

export type TeamInvitation = SharedTeamInvitation

type UserRecord = User & { passwordHash: string }

const cache = {
  users: [] as UserRecord[],
  teams: [] as Team[],
  teamMembers: [] as TeamMember[],
  invitations: [] as TeamInvitation[],
  activities: [] as TeamActivity[],
  userProjects: [] as Array<{ userId: string; projectId: string; accessType: 'owner' | 'member' }>,
  teamProjects: [] as Array<{ teamId: string; projectId: string }>,
  authEvents: [] as AuthEvent[],
}

const mapUser = (user: UserRecord): User => ({
  id: user.id,
  email: user.email,
  name: user.name,
  username: user.username,
  usernameUpdatedAt: user.usernameUpdatedAt,
  avatarUrl: user.avatarUrl,
  bio: user.bio,
  onboardingCompletedAt: user.onboardingCompletedAt,
  onboardingDismissedAt: user.onboardingDismissedAt,
  onboardingPath: user.onboardingPath,
  authProvider: user.authProvider,
  isInternal: user.isInternal,
  status: user.status ?? 'active',
  role: user.role ?? 'user',
  emailVerifiedAt: user.emailVerifiedAt,
  lastLoginAt: user.lastLoginAt,
  lastLoginIp: user.lastLoginIp,
  suspendedUntil: user.suspendedUntil,
  bannedReason: user.bannedReason,
  bannedAt: user.bannedAt,
  supportNote: user.supportNote,
  supportNoteStatus: user.supportNoteStatus,
  createdAt: user.createdAt,
})

const mapUserWithInitialAgent = async (user: UserRecord): Promise<User> => {
  await provisionInitialUserAgent(user.id)
  return mapUser(user)
}

const userInsertValues = (user: UserRecord) => ({
  id: user.id,
  email: user.email,
  passwordHash: user.passwordHash,
  name: user.name,
  username: user.username ?? null,
  usernameUpdatedAt: user.usernameUpdatedAt ?? null,
  avatarUrl: user.avatarUrl ?? null,
  bio: user.bio ?? null,
  onboardingCompletedAt: user.onboardingCompletedAt ?? null,
  onboardingDismissedAt: user.onboardingDismissedAt ?? null,
  onboardingPath: user.onboardingPath ?? null,
  authProvider: user.authProvider ?? 'password',
  isInternal: user.isInternal ?? false,
  status: user.status ?? 'active',
  role: user.role ?? 'user',
  emailVerifiedAt: user.emailVerifiedAt ?? null,
  lastLoginAt: user.lastLoginAt ?? null,
  lastLoginIp: user.lastLoginIp ?? null,
  suspendedUntil: user.suspendedUntil ?? null,
  bannedReason: user.bannedReason ?? null,
  bannedAt: user.bannedAt ?? null,
  supportNote: user.supportNote ?? null,
  supportNoteStatus: user.supportNoteStatus ?? null,
  createdAt: user.createdAt,
})

const insertUserRow = (user: UserRecord) => getDrizzleDb().insert(users).values(userInsertValues(user))

const upsertUserByEmail = (user: UserRecord, set: Partial<ReturnType<typeof userInsertValues>>) => getDrizzleDb()
  .insert(users)
  .values(userInsertValues(user))
  .onConflictDoUpdate({
    target: users.email,
    set,
  })


const resolveLegacyTeamOwnerId = (teamId: string) => {
  return cache.teamMembers.find((member) => member.teamId === teamId && member.role === 'owner')?.userId
    ?? cache.teamMembers.find((member) => member.teamId === teamId)?.userId
    ?? ''
}

const persistLegacyTeamWorkspace = (team: Team) => {
  const ownerUserId = resolveLegacyTeamOwnerId(team.id)
  return getDrizzleDb()
    .insert(collabWorkspaces)
    .values({
      id: team.id,
      name: team.name,
      description: team.description ?? null,
      avatarUrl: team.avatarUrl ?? null,
      ownerUserId,
      legacyTeamId: team.id,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
    })
    .onConflictDoUpdate({
      // 按 legacy_team_id 唯一键冲突更新：preview/历史库中同一 legacy team 已存在时
      // 复用原行（保持原 id），避免同 legacy_team_id 二次插入触发唯一约束爆炸。
      target: collabWorkspaces.legacyTeamId,
      set: {
        name: team.name,
        description: team.description ?? null,
        avatarUrl: team.avatarUrl ?? null,
        ownerUserId,
        updatedAt: team.updatedAt,
      },
    })
}

const persistLegacyWorkspaceMember = (teamId: string, userId: string, role: TeamRole) => {
  return getDrizzleDb()
    .insert(collabWorkspaceMembers)
    .values({ workspaceId: teamId, userId, role })
    .onConflictDoUpdate({
      target: [collabWorkspaceMembers.workspaceId, collabWorkspaceMembers.userId],
      set: { role },
    })
}

const deleteLegacyWorkspaceMember = (teamId: string, userId: string) => {
  return getDrizzleDb()
    .delete(collabWorkspaceMembers)
    .where(and(eq(collabWorkspaceMembers.workspaceId, teamId), eq(collabWorkspaceMembers.userId, userId)))
}

const persistLegacyWorkspaceProject = (teamId: string, projectId: string) => {
  return getDrizzleDb()
    .insert(collabWorkspaceProjects)
    .values({ workspaceId: teamId, projectId })
    .onConflictDoNothing()
}

const deleteLegacyWorkspaceProject = (teamId: string, projectId: string) => {
  return getDrizzleDb()
    .delete(collabWorkspaceProjects)
    .where(and(eq(collabWorkspaceProjects.workspaceId, teamId), eq(collabWorkspaceProjects.projectId, projectId)))
}

const syncLegacyTeamsToCollabWorkspaces = async () => {
  await Promise.all(cache.teams.map((team) => persistLegacyTeamWorkspace(team)))
  await Promise.all(cache.teamMembers.map((member) => persistLegacyWorkspaceMember(member.teamId, member.userId, member.role)))
  await Promise.all(cache.teamProjects.map((binding) => persistLegacyWorkspaceProject(binding.teamId, binding.projectId)))
}

export const refreshAuthStore = async () => {
  await ensurePostgresReady()
  const db = getDrizzleDb()
  const now = new Date().toISOString()
  const [userRows, teamRows, memberRows, invitationRows, activityRows, userProjectRows, teamProjectRows, revokedTokenRows, authEventRows] = await Promise.all([
    db.select().from(users),
    db.select().from(teams),
    db.select().from(teamMembers),
    db.select().from(teamInvitations),
    db.select().from(teamActivities).orderBy(desc(teamActivities.createdAt)),
    db.select().from(userProjects),
    db.select().from(teamProjects),
    db.select({ tokenHash: revokedAuthTokens.tokenHash, expiresAt: revokedAuthTokens.expiresAt }).from(revokedAuthTokens),
    db.select().from(authEvents).orderBy(desc(authEvents.createdAt)).limit(500),
  ])

  cache.users = userRows.map((row) => ({
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    name: row.name,
    avatarUrl: row.avatarUrl ?? undefined,
    bio: row.bio ?? undefined,
    onboardingCompletedAt: row.onboardingCompletedAt ?? undefined,
    onboardingDismissedAt: row.onboardingDismissedAt ?? undefined,
    onboardingPath: row.onboardingPath ?? undefined,
    authProvider: row.authProvider ?? 'password',
    isInternal: row.isInternal,
    status: row.status ?? 'active',
    role: row.role ?? 'user',
    emailVerifiedAt: row.emailVerifiedAt ?? undefined,
    lastLoginAt: row.lastLoginAt ?? undefined,
    lastLoginIp: row.lastLoginIp ?? undefined,
    suspendedUntil: row.suspendedUntil ?? undefined,
    bannedReason: row.bannedReason ?? undefined,
    bannedAt: row.bannedAt ?? undefined,
    supportNote: row.supportNote ?? undefined,
    supportNoteStatus: row.supportNoteStatus ?? undefined,
    createdAt: row.createdAt,
  }))
  cache.authEvents = authEventRows.map((row) => ({
    id: row.id,
    userId: row.userId ?? undefined,
    email: row.email ?? undefined,
    eventType: row.eventType,
    provider: row.provider ?? undefined,
    result: (row.result === 'fail' || row.result === 'blocked' ? row.result : 'success') as AuthEvent['result'],
    ip: row.ip ?? undefined,
    userAgent: row.userAgent ?? undefined,
    metadataJson: row.metadataJson ?? undefined,
    createdAt: row.createdAt,
  }))
  cache.teams = teamRows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    avatarUrl: row.avatarUrl ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))
  cache.teamMembers = memberRows.map((row) => ({ teamId: row.teamId, userId: row.userId, role: row.role }))
  cache.invitations = invitationRows.map((row) => ({
    id: row.id,
    teamId: row.teamId,
    email: row.email,
    role: row.role,
    status: row.status,
    token: row.token,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  }))
  cache.activities = activityRows.map((row) => ({
    id: row.id,
    teamId: row.teamId,
    userId: row.userId,
    action: row.action,
    targetType: row.targetType ?? undefined,
    targetId: row.targetId ?? undefined,
    details: row.detailsJson ?? undefined,
    entityType: row.targetType ?? undefined,
    entityId: row.targetId ?? undefined,
    metadata: row.detailsJson ?? undefined,
    createdAt: row.createdAt,
  }))
  cache.userProjects = userProjectRows.map((row) => ({ userId: row.userId, projectId: row.projectId, accessType: row.accessType }))
  cache.teamProjects = teamProjectRows.map((row) => ({ teamId: row.teamId, projectId: row.projectId }))
  revokedTokenHashes.clear()
  for (const row of revokedTokenRows) {
    revokedTokenHashes.add(row.tokenHash)
  }
  // 只在确实存在已过期 token 时才执行清理 DELETE。
  // 无条件发 DELETE（即使匹配 0 行）也会触发 wemux_storage_change 语句级触发器，
  // 产生 storage_change_events + pg_notify → storage-change listener 再次 refreshAuthStore
  // → 再次 DELETE → 自反馈死循环（曾导致 storage_change_events 膨胀到数十 GB）。
  const hasExpiredTokens = revokedTokenRows.some((row) => row.expiresAt < now)
  if (hasExpiredTokens) {
    schedulePersistence(
      'cleanup-expired-revoked-auth-tokens',
      db.delete(revokedAuthTokens).where(lt(revokedAuthTokens.expiresAt, now)),
    )
  }
}

export const initAuthStore = async () => {
  await refreshAuthStore()
  await syncLegacyTeamsToCollabWorkspaces()
  ensureOwnerAccount()
}

export const createUser = async (email: string, password: string, name: string): Promise<User> => {
  const existing = cache.users.find((user) => user.email.toLowerCase() === email.toLowerCase())
  if (existing) {
    throw new Error('邮箱已存在')
  }
  const passwordHash = await bcrypt.hash(password, 10)
  const createdAt = new Date().toISOString()
  const user: UserRecord = {
    id: crypto.randomUUID(),
    email,
    passwordHash,
    name,
    authProvider: 'password',
    isInternal: false,
    createdAt,
  }
  cache.users.unshift(user)
  await insertUserRow(user)
  return mapUserWithInitialAgent(user)
}

export const ensureUser = async (email: string, password: string, name: string): Promise<User> => {
  const passwordHash = await bcrypt.hash(password, 10)
  const existing = cache.users.find((user) => user.email.toLowerCase() === email.toLowerCase())
  if (existing) {
    existing.passwordHash = passwordHash
    existing.name = name
    existing.authProvider = 'password'
    await upsertUserByEmail(existing, {
      passwordHash: existing.passwordHash,
      name: existing.name,
      authProvider: existing.authProvider ?? 'password',
    })
    return mapUserWithInitialAgent(existing)
  }

  const createdAt = new Date().toISOString()
  const user: UserRecord = {
    id: crypto.randomUUID(),
    email,
    passwordHash,
    name,
    authProvider: 'password',
    isInternal: false,
    createdAt,
  }
  cache.users.unshift(user)
  await insertUserRow(user)
  return mapUserWithInitialAgent(user)
}

export const ensurePasswordUserProfile = async (input: {
  email: string
  password: string
  name: string
  isInternal?: boolean
  onboardingCompletedAt?: string | null
  onboardingDismissedAt?: string | null
  onboardingPath?: User['onboardingPath'] | null
}): Promise<User> => {
  const passwordHash = await bcrypt.hash(input.password, 10)
  const now = new Date().toISOString()
  const normalizedEmail = input.email.trim().toLowerCase()
  const normalizedName = input.name.trim() || normalizedEmail.split('@')[0] || 'Dev User'
  const isInternal = Boolean(input.isInternal)
  const onboardingCompletedAt = input.onboardingCompletedAt ?? undefined
  const onboardingDismissedAt = input.onboardingDismissedAt ?? undefined
  const onboardingPath = input.onboardingPath ?? undefined
  const existing = cache.users.find((user) => user.email.toLowerCase() === normalizedEmail)

  if (existing) {
    existing.email = normalizedEmail
    existing.passwordHash = passwordHash
    existing.name = normalizedName
    existing.authProvider = 'password'
    existing.isInternal = isInternal
    existing.onboardingCompletedAt = onboardingCompletedAt
    existing.onboardingDismissedAt = onboardingDismissedAt
    existing.onboardingPath = onboardingPath
    await upsertUserByEmail(existing, {
      passwordHash: existing.passwordHash,
      name: existing.name,
      onboardingCompletedAt: existing.onboardingCompletedAt ?? null,
      onboardingDismissedAt: existing.onboardingDismissedAt ?? null,
      onboardingPath: existing.onboardingPath ?? null,
      authProvider: existing.authProvider ?? 'password',
      isInternal: existing.isInternal ?? false,
    })
    return mapUserWithInitialAgent(existing)
  }

  const user: UserRecord = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    passwordHash,
    name: normalizedName,
    onboardingCompletedAt,
    onboardingDismissedAt,
    onboardingPath,
    authProvider: 'password',
    isInternal,
    createdAt: now,
  }
  cache.users.unshift(user)
  await insertUserRow(user)
  return mapUserWithInitialAgent(user)
}

export const verifyUser = async (email: string, password: string): Promise<User | null> => {
  const user = cache.users.find((item) => item.email.toLowerCase() === email.toLowerCase())
  if (!user) {
    return null
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  return valid ? mapUser(user) : null
}

export const getUserById = (id: string): User | null => {
  const user = cache.users.find((item) => item.id === id)
  return user ? mapUser(user) : null
}

export const getAllUsers = (): User[] => cache.users.map(mapUser)

/** 按 username / name / email 模糊搜索用户（Drive 协作者候选等）；空 query 返回空 */
export const searchUsers = (query: string, limit = 20): User[] => {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return getAllUsers()
    .filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.username ?? '').toLowerCase().includes(q))
    .slice(0, limit)
}

/** 全量用户列表（候选下拉，限前 200） */
export const listAllUsers = (limit = 200): User[] => getAllUsers().slice(0, limit)

export const getUserByEmail = (email: string): User | null => {
  const user = cache.users.find((item) => item.email.toLowerCase() === email.toLowerCase())
  return user ? mapUser(user) : null
}

export const getUserByUsername = (username: string): User | null => {
  const normalized = normalizeUsername(username)
  if (!normalized) {
    return null
  }
  const user = cache.users.find((item) => item.username?.toLowerCase() === normalized)
  return user ? mapUser(user) : null
}

export const isUsernameTaken = (username: string, excludeUserId?: string) => {
  const normalized = normalizeUsername(username)
  if (!normalized) {
    return false
  }
  return cache.users.some((item) => (
    item.username?.toLowerCase() === normalized && item.id !== excludeUserId
  ))
}

/**
 * 老用户/未设置用户 ID 懒回填：邮箱前缀 + 随机后缀，冲突则加长重试。
 * 仅当用户还没有 username 时生成，并持久化。
 */
export const ensureUsernameBackfill = async (userId: string): Promise<User | null> => {
  const user = cache.users.find((item) => item.id === userId)
  if (!user) {
    return null
  }
  if (user.username?.trim()) {
    return mapUser(user)
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = buildUniqueUsernameCandidate(user.email, attempt)
    if (isUsernameTaken(candidate, user.id)) {
      continue
    }
    const now = new Date().toISOString()
    user.username = candidate
    user.usernameUpdatedAt = now
    await getDrizzleDb().update(users)
      .set({ username: candidate, usernameUpdatedAt: now })
      .where(eq(users.id, user.id))
    return mapUser(user)
  }

  // 极端冲突下返回未回填状态，下次再试。
  return mapUser(user)
}

export const updateUserProfile = (userId: string, updates: { name?: string; avatarUrl?: string; bio?: string; username?: string; usernameUpdatedAt?: string }): User | null => {
  const user = cache.users.find((item) => item.id === userId)
  if (!user) {
    return null
  }

  if (updates.name !== undefined) user.name = updates.name.trim()
  if (updates.avatarUrl !== undefined) user.avatarUrl = updates.avatarUrl ?? undefined
  if (updates.bio !== undefined) user.bio = updates.bio.trim() || undefined
  if (updates.username !== undefined) user.username = normalizeUsername(updates.username) || undefined
  if (updates.usernameUpdatedAt !== undefined) user.usernameUpdatedAt = updates.usernameUpdatedAt

  schedulePersistence(
    'update-user-profile',
    getDrizzleDb()
      .update(users)
      .set({
        name: user.name,
        avatarUrl: user.avatarUrl ?? null,
        bio: user.bio ?? null,
        username: user.username ?? null,
        usernameUpdatedAt: user.usernameUpdatedAt ?? null,
      })
      .where(eq(users.id, user.id)),
  )
  return mapUser(user)
}

const createOAuthPasswordHash = async () => bcrypt.hash(randomBytes(24).toString('hex'), 10)

export const resolveOAuthUserName = (existingName: string | undefined, oauthName: string, email: string) => {
  const normalizedExistingName = existingName?.trim() ?? ''
  if (normalizedExistingName) {
    return normalizedExistingName
  }

  return oauthName.trim() || email.split('@')[0] || 'Google User'
}

export const ensureOAuthUser = async (input: {
  email: string
  name: string
  avatarUrl?: string
  provider: 'google'
}): Promise<User> => {
  const existing = cache.users.find((user) => user.email.toLowerCase() === input.email.toLowerCase())
  if (existing) {
    existing.name = resolveOAuthUserName(existing.name, input.name, existing.email)
    existing.avatarUrl = input.avatarUrl?.trim() || existing.avatarUrl
    existing.authProvider = input.provider
    await getDrizzleDb()
      .update(users)
      .set({ name: existing.name, avatarUrl: existing.avatarUrl ?? null, authProvider: existing.authProvider })
      .where(eq(users.id, existing.id))
    return mapUserWithInitialAgent(existing)
  }

  const user: UserRecord = {
    id: crypto.randomUUID(),
    email: input.email,
    passwordHash: await createOAuthPasswordHash(),
    name: resolveOAuthUserName(undefined, input.name, input.email),
    avatarUrl: input.avatarUrl?.trim() || undefined,
    authProvider: input.provider,
    isInternal: false,
    createdAt: new Date().toISOString(),
  }
  cache.users.unshift(user)
  await insertUserRow(user)
  return mapUserWithInitialAgent(user)
}

/**
 * 邮箱密码用户同步（better-auth emailAndPassword 注册/登录后 bridge 调用）。
 * 权威密码在 better-auth account.password（scrypt）；wemux users.passwordHash 存随机占位。
 */
export const ensurePasswordUser = async (input: {
  email: string
  name: string
  avatarUrl?: string
  emailVerified?: boolean
}): Promise<User> => {
  const existing = cache.users.find((user) => user.email.toLowerCase() === input.email.toLowerCase())
  const now = new Date().toISOString()
  if (existing) {
    existing.authProvider = 'password'
    if (input.name?.trim()) {
      existing.name = resolveOAuthUserName(existing.name, input.name, existing.email)
    }
    if (input.avatarUrl?.trim()) {
      existing.avatarUrl = input.avatarUrl.trim()
    }
    if (input.emailVerified && !existing.emailVerifiedAt) {
      existing.emailVerifiedAt = now
    }
    await getDrizzleDb()
      .update(users)
      .set({
        name: existing.name,
        avatarUrl: existing.avatarUrl ?? null,
        authProvider: existing.authProvider,
        emailVerifiedAt: existing.emailVerifiedAt ?? null,
      })
      .where(eq(users.id, existing.id))
    return mapUserWithInitialAgent(existing)
  }

  const user: UserRecord = {
    id: crypto.randomUUID(),
    email: input.email,
    passwordHash: await createOAuthPasswordHash(),
    name: input.name?.trim() || input.email.split('@')[0] || 'User',
    avatarUrl: input.avatarUrl?.trim() || undefined,
    authProvider: 'password',
    isInternal: false,
    emailVerifiedAt: input.emailVerified ? now : undefined,
    createdAt: now,
  }
  cache.users.unshift(user)
  await insertUserRow(user)
  return mapUserWithInitialAgent(user)
}
export const updateUserOnboarding = (
  userId: string,
  updates: {
    onboardingCompletedAt?: string | null
    onboardingDismissedAt?: string | null
    onboardingPath?: User['onboardingPath'] | null
  },
): User | null => {
  const user = cache.users.find((item) => item.id === userId)
  if (!user) {
    return null
  }

  if (updates.onboardingCompletedAt !== undefined) {
    user.onboardingCompletedAt = updates.onboardingCompletedAt ?? undefined
  }
  if (updates.onboardingDismissedAt !== undefined) {
    user.onboardingDismissedAt = updates.onboardingDismissedAt ?? undefined
  }
  if (updates.onboardingPath !== undefined) {
    user.onboardingPath = updates.onboardingPath ?? undefined
  }

  schedulePersistence(
    'update-user-onboarding',
    getDrizzleDb()
      .update(users)
      .set({
        onboardingCompletedAt: user.onboardingCompletedAt ?? null,
        onboardingDismissedAt: user.onboardingDismissedAt ?? null,
        onboardingPath: user.onboardingPath ?? null,
      })
      .where(eq(users.id, user.id)),
  )

  return mapUser(user)
}

export const createTeam = (name: string, ownerId: string): Team => {
  const now = new Date().toISOString()
  const team: Team = { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now }
  cache.teams.unshift(team)
  cache.teamMembers.push({ teamId: team.id, userId: ownerId, role: 'owner' })
  schedulePersistence('create-team', Promise.all([
    getDrizzleDb().insert(teams).values({ id: team.id, name: team.name, createdAt: team.createdAt, updatedAt: team.updatedAt }),
    getDrizzleDb().insert(teamMembers).values({ teamId: team.id, userId: ownerId, role: 'owner' }).onConflictDoUpdate({
      target: [teamMembers.teamId, teamMembers.userId],
      set: { role: 'owner' },
    }),
    persistLegacyTeamWorkspace(team),
    persistLegacyWorkspaceMember(team.id, ownerId, 'owner'),
  ]))
  logTeamActivity(team.id, ownerId, 'team_created')
  return cloneJson(team)
}


export const createTeamAndWait = async (name: string, ownerId: string): Promise<Team> => {
  const now = new Date().toISOString()
  const team: Team = { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now }
  await Promise.all([
    getDrizzleDb().insert(teams).values({ id: team.id, name: team.name, createdAt: team.createdAt, updatedAt: team.updatedAt }),
    getDrizzleDb().insert(teamMembers).values({ teamId: team.id, userId: ownerId, role: 'owner' }).onConflictDoUpdate({
      target: [teamMembers.teamId, teamMembers.userId],
      set: { role: 'owner' },
    }),
    persistLegacyTeamWorkspace(team),
    persistLegacyWorkspaceMember(team.id, ownerId, 'owner'),
  ])
  cache.teams.unshift(team)
  cache.teamMembers.push({ teamId: team.id, userId: ownerId, role: 'owner' })
  logTeamActivity(team.id, ownerId, 'team_created')
  return cloneJson(team)
}

export const getUserTeams = (userId: string): Team[] => {
  const teamIds = new Set(cache.teamMembers.filter((member) => member.userId === userId).map((member) => member.teamId))
  return cloneJson(cache.teams.filter((team) => teamIds.has(team.id)))
}

export const addTeamMember = (teamId: string, userId: string, role: TeamRole = 'member'): void => {
  const existing = cache.teamMembers.find((member) => member.teamId === teamId && member.userId === userId)
  if (existing) {
    existing.role = role
  } else {
    cache.teamMembers.push({ teamId, userId, role })
  }
  schedulePersistence('add-team-member', Promise.all([
    getDrizzleDb().insert(teamMembers).values({ teamId, userId, role }).onConflictDoUpdate({
      target: [teamMembers.teamId, teamMembers.userId],
      set: { role },
    }),
    persistLegacyWorkspaceMember(teamId, userId, role),
  ]))
}


export const addTeamMemberAndWait = async (teamId: string, userId: string, role: TeamRole = 'member'): Promise<void> => {
  await Promise.all([
    getDrizzleDb().insert(teamMembers).values({ teamId, userId, role }).onConflictDoUpdate({
      target: [teamMembers.teamId, teamMembers.userId],
      set: { role },
    }),
    persistLegacyWorkspaceMember(teamId, userId, role),
  ])
  const existing = cache.teamMembers.find((member) => member.teamId === teamId && member.userId === userId)
  if (existing) {
    existing.role = role
  } else {
    cache.teamMembers.push({ teamId, userId, role })
  }
}

export const removeTeamMember = (teamId: string, userId: string): void => {
  cache.teamMembers = cache.teamMembers.filter((member) => !(member.teamId === teamId && member.userId === userId))
  schedulePersistence('remove-team-member', Promise.all([
    getDrizzleDb().delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))),
    deleteLegacyWorkspaceMember(teamId, userId),
  ]))
}


export const removeTeamMemberAndWait = async (teamId: string, userId: string): Promise<void> => {
  await Promise.all([
    getDrizzleDb().delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))),
    deleteLegacyWorkspaceMember(teamId, userId),
  ])
  cache.teamMembers = cache.teamMembers.filter((member) => !(member.teamId === teamId && member.userId === userId))
}

export const getTeamMembers = (teamId: string): Array<User & { role: TeamRole }> => {
  return cache.teamMembers
    .filter((member) => member.teamId === teamId)
    .map((member) => {
      const user = getUserById(member.userId)
      return user ? { ...user, role: member.role } : null
    })
    .filter(Boolean) as Array<User & { role: TeamRole }>
}

export const getProjectAssignees = (projectId: string): User[] => {
  const userIds = new Set<string>()
  for (const assignment of cache.userProjects.filter((item) => item.projectId === projectId)) {
    userIds.add(assignment.userId)
  }
  for (const teamProject of cache.teamProjects.filter((item) => item.projectId === projectId)) {
    for (const member of cache.teamMembers.filter((item) => item.teamId === teamProject.teamId)) {
      userIds.add(member.userId)
    }
  }

  return cache.users
    .filter((user) => userIds.has(user.id))
    .map(mapUser)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export const getUserProjectIds = (userId: string): string[] => {
  const projectIds = new Set<string>()
  for (const item of cache.userProjects.filter((project) => project.userId === userId)) {
    projectIds.add(item.projectId)
  }
  const teamIds = new Set(cache.teamMembers.filter((member) => member.userId === userId).map((member) => member.teamId))
  for (const item of cache.teamProjects.filter((project) => teamIds.has(project.teamId))) {
    projectIds.add(item.projectId)
  }
  return [...projectIds]
}

export const addUserProject = (userId: string, projectId: string, accessType: 'owner' | 'member' = 'owner'): void => {
  const existing = cache.userProjects.find((item) => item.userId === userId && item.projectId === projectId)
  if (existing) {
    existing.accessType = accessType
  } else {
    cache.userProjects.push({ userId, projectId, accessType })
  }
  schedulePersistence(
    'add-user-project',
    getDrizzleDb().insert(userProjects).values({ userId, projectId, accessType }).onConflictDoUpdate({
      target: [userProjects.userId, userProjects.projectId],
      set: { accessType },
    }),
  )
}


export const addUserProjectAndWait = async (userId: string, projectId: string, accessType: 'owner' | 'member' = 'owner'): Promise<void> => {
  await getDrizzleDb().insert(userProjects).values({ userId, projectId, accessType }).onConflictDoUpdate({
    target: [userProjects.userId, userProjects.projectId],
    set: { accessType },
  })
  const existing = cache.userProjects.find((item) => item.userId === userId && item.projectId === projectId)
  if (existing) {
    existing.accessType = accessType
  } else {
    cache.userProjects.push({ userId, projectId, accessType })
  }
}

export const addTeamProject = (teamId: string, projectId: string): void => {
  if (!cache.teamProjects.some((item) => item.teamId === teamId && item.projectId === projectId)) {
    cache.teamProjects.push({ teamId, projectId })
  }
  schedulePersistence('add-team-project', Promise.all([
    getDrizzleDb().insert(teamProjects).values({ teamId, projectId }).onConflictDoNothing(),
    persistLegacyWorkspaceProject(teamId, projectId),
  ]))
}


export const addTeamProjectAndWait = async (teamId: string, projectId: string): Promise<void> => {
  await Promise.all([
    getDrizzleDb().insert(teamProjects).values({ teamId, projectId }).onConflictDoNothing(),
    persistLegacyWorkspaceProject(teamId, projectId),
  ])
  if (!cache.teamProjects.some((item) => item.teamId === teamId && item.projectId === projectId)) {
    cache.teamProjects.push({ teamId, projectId })
  }
}

export const removeUserProject = (userId: string, projectId: string): void => {
  cache.userProjects = cache.userProjects.filter((item) => !(item.userId === userId && item.projectId === projectId))
  schedulePersistence(
    'remove-user-project',
    getDrizzleDb().delete(userProjects).where(and(eq(userProjects.userId, userId), eq(userProjects.projectId, projectId))),
  )
}


export const removeUserProjectAndWait = async (userId: string, projectId: string): Promise<void> => {
  await getDrizzleDb().delete(userProjects).where(and(eq(userProjects.userId, userId), eq(userProjects.projectId, projectId)))
  cache.userProjects = cache.userProjects.filter((item) => !(item.userId === userId && item.projectId === projectId))
}

export const isProjectAccessible = (userId: string, projectId: string): boolean => isPlaygroundProjectId(projectId) || getUserProjectIds(userId).includes(projectId)

/** 项目直接成员条目（user_projects 原始行；不含 team 间接成员） */
export const getProjectMemberEntries = (projectId: string): Array<{ userId: string; accessType: 'owner' | 'member' }> =>
  cloneJson(cache.userProjects.filter((item) => item.projectId === projectId))

export const getTeamById = (teamId: string): Team | null => cloneJson(cache.teams.find((team) => team.id === teamId) ?? null)

export const updateTeam = (teamId: string, updates: { name?: string; description?: string; avatarUrl?: string }): Team | null => {
  const team = cache.teams.find((item) => item.id === teamId)
  if (!team) {
    return null
  }
  if (updates.name !== undefined) team.name = updates.name
  if (updates.description !== undefined) team.description = updates.description ?? undefined
  if (updates.avatarUrl !== undefined) team.avatarUrl = updates.avatarUrl ?? undefined
  team.updatedAt = new Date().toISOString()
  schedulePersistence('update-team', Promise.all([
    getDrizzleDb()
      .update(teams)
      .set({ name: team.name, description: team.description ?? null, avatarUrl: team.avatarUrl ?? null, updatedAt: team.updatedAt })
      .where(eq(teams.id, team.id)),
    persistLegacyTeamWorkspace(team),
  ]))
  return cloneJson(team)
}

export const updateTeamAndWait = async (teamId: string, updates: { name?: string; description?: string; avatarUrl?: string }): Promise<Team | null> => {
  const team = cache.teams.find((item) => item.id === teamId)
  if (!team) {
    return null
  }
  if (updates.name !== undefined) team.name = updates.name
  if (updates.description !== undefined) team.description = updates.description ?? undefined
  if (updates.avatarUrl !== undefined) team.avatarUrl = updates.avatarUrl ?? undefined
  team.updatedAt = new Date().toISOString()
  await Promise.all([
    getDrizzleDb()
      .update(teams)
      .set({ name: team.name, description: team.description ?? null, avatarUrl: team.avatarUrl ?? null, updatedAt: team.updatedAt })
      .where(eq(teams.id, team.id)),
    persistLegacyTeamWorkspace(team),
  ])
  return cloneJson(team)
}

export const getTeamMemberRole = (teamId: string, userId: string): TeamRole | null => cache.teamMembers.find((member) => member.teamId === teamId && member.userId === userId)?.role ?? null

export const updateTeamMemberRole = (teamId: string, userId: string, role: TeamRole, changedBy?: string): boolean => {
  const member = cache.teamMembers.find((item) => item.teamId === teamId && item.userId === userId)
  if (!member) {
    return false
  }
  member.role = role
  schedulePersistence('update-team-member-role', Promise.all([
    getDrizzleDb()
      .update(teamMembers)
      .set({ role })
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))),
    persistLegacyWorkspaceMember(teamId, userId, role),
  ]))
  logTeamActivity(teamId, changedBy ?? userId, 'member_role_changed', 'user', userId, { role })
  return true
}


export const updateTeamMemberRoleAndWait = async (teamId: string, userId: string, role: TeamRole, changedBy?: string): Promise<boolean> => {
  const member = cache.teamMembers.find((item) => item.teamId === teamId && item.userId === userId)
  if (!member) {
    return false
  }
  await Promise.all([
    getDrizzleDb()
      .update(teamMembers)
      .set({ role })
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))),
    persistLegacyWorkspaceMember(teamId, userId, role),
  ])
  member.role = role
  logTeamActivity(teamId, changedBy ?? userId, 'member_role_changed', 'user', userId, { role })
  return true
}

export const createTeamInvitation = (teamId: string, email: string, invitedBy: string, role: TeamRole = 'member'): TeamInvitation => {
  const invitation: TeamInvitation = {
    id: crypto.randomUUID(),
    teamId,
    email,
    role,
    status: 'pending',
    token: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
  }
  cache.invitations.unshift(invitation)
  schedulePersistence(
    'create-invitation',
    getDrizzleDb().insert(teamInvitations).values({
      id: invitation.id,
      teamId: invitation.teamId,
      email: invitation.email,
      role: invitation.role,
      invitedBy,
      status: invitation.status,
      token: invitation.token,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    }),
  )
  logTeamActivity(teamId, invitedBy, 'invitation_sent', 'email', email, { role })
  return cloneJson(invitation)
}

export const createTeamInvitationAndWait = async (teamId: string, email: string, invitedBy: string, role: TeamRole = 'member'): Promise<TeamInvitation> => {
  const invitation: TeamInvitation = {
    id: crypto.randomUUID(),
    teamId,
    email,
    role,
    status: 'pending',
    token: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
  }
  await getDrizzleDb().insert(teamInvitations).values({
    id: invitation.id,
    teamId: invitation.teamId,
    email: invitation.email,
    role: invitation.role,
    invitedBy,
    status: invitation.status,
    token: invitation.token,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  })
  cache.invitations.unshift(invitation)
  logTeamActivity(teamId, invitedBy, 'invitation_sent', 'email', email, { role })
  return cloneJson(invitation)
}

export const getTeamInvitations = (teamId: string): TeamInvitation[] => cloneJson(cache.invitations.filter((invitation) => invitation.teamId === teamId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))

export const getPendingTeamInvitationsByEmail = (email: string): TeamInvitation[] => {
  const normalizedEmail = email.trim().toLowerCase()
  const now = Date.now()
  return cloneJson(cache.invitations
    .filter((invitation) => invitation.status === 'pending')
    .filter((invitation) => invitation.email.toLowerCase() === normalizedEmail)
    .filter((invitation) => new Date(invitation.expiresAt).getTime() >= now)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
}

export const getInvitationByToken = (token: string): TeamInvitation | null => cloneJson(cache.invitations.find((invitation) => invitation.token === token) ?? null)

export const getInvitationById = (id: string): TeamInvitation | null => cloneJson(cache.invitations.find((invitation) => invitation.id === id) ?? null)

export const acceptTeamInvitation = (token: string, userId: string): boolean => {
  const invitation = cache.invitations.find((item) => item.token === token)
  if (!invitation || invitation.status !== 'pending') {
    return false
  }
  if (new Date(invitation.expiresAt) < new Date()) {
    invitation.status = 'expired'
    schedulePersistence(
      'expire-invitation',
      getDrizzleDb().update(teamInvitations).set({ status: 'expired' }).where(eq(teamInvitations.id, invitation.id)),
    )
    return false
  }
  const user = getUserById(userId)
  if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return false
  }
  addTeamMember(invitation.teamId, userId, invitation.role)
  invitation.status = 'accepted'
  schedulePersistence(
    'accept-invitation',
    getDrizzleDb().update(teamInvitations).set({ status: 'accepted' }).where(eq(teamInvitations.id, invitation.id)),
  )
  logTeamActivity(invitation.teamId, userId, 'member_joined', 'user', userId)
  return true
}

export const cancelTeamInvitation = (invitationId: string, canceledBy: string): boolean => {
  const invitation = cache.invitations.find((item) => item.id === invitationId)
  if (!invitation) {
    return false
  }
  cache.invitations = cache.invitations.filter((item) => item.id !== invitationId)
  schedulePersistence(
    'cancel-invitation',
    getDrizzleDb().delete(teamInvitations).where(eq(teamInvitations.id, invitationId)),
  )
  logTeamActivity(invitation.teamId, canceledBy, 'invitation_cancelled', 'invitation', invitationId)
  return true
}

export const logTeamActivity = (teamId: string, userId: string, action: string, targetType?: string, targetId?: string, details?: Record<string, unknown>): void => {
  const activity: TeamActivity = {
    id: crypto.randomUUID(),
    teamId,
    userId,
    action,
    targetType,
    targetId,
    details,
    entityType: targetType,
    entityId: targetId,
    metadata: details,
    createdAt: new Date().toISOString(),
  }
  cache.activities.unshift(activity)
  schedulePersistence(
    'log-team-activity',
    getDrizzleDb().insert(teamActivities).values({
      id: activity.id,
      teamId: activity.teamId,
      userId: activity.userId ?? userId,
      action: activity.action,
      targetType: activity.targetType ?? null,
      targetId: activity.targetId ?? null,
      detailsJson: activity.details ?? null,
      createdAt: activity.createdAt,
    }),
  )
}

export const getTeamActivities = (teamId: string, limit = 50): TeamActivity[] => cloneJson(cache.activities.filter((activity) => activity.teamId === teamId).slice(0, limit))

export const getTeamProjects = (teamId: string): Array<{ projectId: string }> => cloneJson(cache.teamProjects.filter((item) => item.teamId === teamId).map((item) => ({ projectId: item.projectId })))

export const removeTeamProject = (teamId: string, projectId: string, removedBy: string): boolean => {
  const before = cache.teamProjects.length
  cache.teamProjects = cache.teamProjects.filter((item) => !(item.teamId === teamId && item.projectId === projectId))
  const changed = cache.teamProjects.length !== before
  if (changed) {
    schedulePersistence('remove-team-project', Promise.all([
      getDrizzleDb().delete(teamProjects).where(and(eq(teamProjects.teamId, teamId), eq(teamProjects.projectId, projectId))),
      deleteLegacyWorkspaceProject(teamId, projectId),
    ]))
    logTeamActivity(teamId, removedBy, 'project_removed', 'project', projectId)
  }
  return changed
}

export const isTeamAdmin = (teamId: string, userId: string): boolean => {
  const role = getTeamMemberRole(teamId, userId)
  return role === 'owner' || role === 'admin'
}

const TOKEN_SECRET = resolveSharedTokenSecret()
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000
const revokedTokenHashes = new Set<string>()
const hashAuthToken = (token: string) => createHash('sha256').update(token).digest('hex')

export const createToken = (userId: string): string => {
  const payload = JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_EXPIRY_MS })
  const encoded = Buffer.from(payload).toString('base64url')
  const sig = createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url')
  return `${encoded}.${sig}`
}

export const verifyToken = (token: string): string | null => {
  if (revokedTokenHashes.has(hashAuthToken(token))) return null
  const dotIdx = token.indexOf('.')
  if (dotIdx === -1) return null
  const encoded = token.slice(0, dotIdx)
  const sig = token.slice(dotIdx + 1)
  const expected = createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url')
  if (sig !== expected) return null
  try {
    const { uid, exp } = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'))
    if (typeof exp === 'number' && Date.now() > exp) return null
    return uid ?? null
  } catch {
    return null
  }
}

export const revokeToken = async (token: string): Promise<void> => {
  await ensurePostgresReady()
  const tokenHash = hashAuthToken(token)
  const encoded = token.slice(0, token.indexOf('.'))
  let expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString()
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { exp?: unknown }
    if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
      expiresAt = new Date(payload.exp).toISOString()
    }
  } catch {
    // Invalid tokens still get a bounded revocation record.
  }

  revokedTokenHashes.add(tokenHash)
  const revokedAt = new Date().toISOString()
  await getDrizzleDb()
    .insert(revokedAuthTokens)
    .values({ tokenHash, expiresAt, revokedAt })
    .onConflictDoUpdate({
      target: revokedAuthTokens.tokenHash,
      set: { expiresAt, revokedAt },
    })
}

const resolvePatUserId = async (raw: string): Promise<string | null> => {
  if (!raw.startsWith('vbx-')) return null
  const hash = createHash('sha256').update(raw).digest('hex')
  const rows = await getDrizzleDb()
    .select({ userId: personalAccessTokens.userId, expiresAt: personalAccessTokens.expiresAt })
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.tokenHash, hash))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return null
  await getDrizzleDb()
    .update(personalAccessTokens)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(personalAccessTokens.tokenHash, hash))
  return row.userId
}

export const parseTokenUserId = (raw: string): string | null => {
  return verifyToken(raw)
}

export const parseTokenUserIdAsync = async (raw: string): Promise<string | null> => {
  const patUserId = await resolvePatUserId(raw)
  if (patUserId) return patUserId
  return verifyToken(raw)
}

export const createPersonalAccessToken = async (params: { userId: string; name: string; expiresAt?: string | null }): Promise<PersonalAccessTokenCreateResponse> => {
  const id = crypto.randomUUID()
  const rawToken = `vbx-${randomBytes(32).toString('base64url')}`
  const hash = createHash('sha256').update(rawToken).digest('hex')
  const prefix = rawToken.slice(0, 11)
  const now = new Date().toISOString()
  await getDrizzleDb().insert(personalAccessTokens).values({
    id,
    userId: params.userId,
    name: params.name,
    tokenHash: hash,
    tokenPrefix: prefix,
    expiresAt: params.expiresAt ?? null,
    createdAt: now,
  })
  return { id, token: rawToken, prefix, name: params.name, expiresAt: params.expiresAt ?? null, createdAt: now }
}

export const listPersonalAccessTokens = async (userId: string): Promise<PersonalAccessToken[]> => {
  const rows = await getDrizzleDb()
    .select({
      id: personalAccessTokens.id,
      name: personalAccessTokens.name,
      tokenPrefix: personalAccessTokens.tokenPrefix,
      expiresAt: personalAccessTokens.expiresAt,
      lastUsedAt: personalAccessTokens.lastUsedAt,
      createdAt: personalAccessTokens.createdAt,
    })
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.userId, userId))
    .orderBy(desc(personalAccessTokens.createdAt))
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    token_prefix: row.tokenPrefix,
    expires_at: row.expiresAt,
    last_used_at: row.lastUsedAt,
    created_at: row.createdAt,
  }))
}

export const deletePersonalAccessToken = async (id: string, userId: string): Promise<boolean> => {
  await getDrizzleDb()
    .delete(personalAccessTokens)
    .where(and(eq(personalAccessTokens.id, id), eq(personalAccessTokens.userId, userId)))
  return true
}

export const revokeAllPersonalAccessTokens = async (userId: string): Promise<number> => {
  await getDrizzleDb().delete(personalAccessTokens).where(eq(personalAccessTokens.userId, userId))
  return 0
}

// ============================================================================
// Admin 用户管理 / 账号安全（feature 账户体系）
// ============================================================================

const normalizeStatus = (value: string | null | undefined, fallback: UserStatus): UserStatus => {
  return value === 'active' || value === 'suspended' || value === 'banned' ? value : fallback
}

/** 处理停用到期自动恢复；返回用户当前应生效的状态。 */
export const resolveEffectiveUserStatus = (user: User): UserStatus => {
  const status = normalizeStatus(user.status, 'active')
  if (status === 'suspended' && user.suspendedUntil && new Date(user.suspendedUntil) <= new Date()) {
    return 'active'
  }
  return status
}

export const recordAuthEvent = (input: {
  userId?: string
  email?: string
  eventType: string
  provider?: string
  result: 'success' | 'fail' | 'blocked'
  ip?: string
  userAgent?: string
  metadata?: Record<string, unknown>
}) => {
  const event: AuthEvent = {
    id: crypto.randomUUID(),
    userId: input.userId,
    email: input.email,
    eventType: input.eventType,
    provider: input.provider,
    result: input.result,
    ip: input.ip,
    userAgent: input.userAgent,
    metadataJson: input.metadata,
    createdAt: new Date().toISOString(),
  }
  cache.authEvents.unshift(event)
  if (cache.authEvents.length > 500) {
    cache.authEvents.length = 500
  }
  schedulePersistence(
    'record-auth-event',
    getDrizzleDb().insert(authEvents).values({
      id: event.id,
      userId: event.userId ?? null,
      email: event.email ?? null,
      eventType: event.eventType,
      provider: event.provider ?? null,
      result: event.result,
      ip: event.ip ?? null,
      userAgent: event.userAgent ?? null,
      metadataJson: event.metadataJson ?? null,
      createdAt: event.createdAt,
    }),
  )
  return event
}

export const listAuthEventsByUser = (userId: string, limit = 50): AuthEvent[] => {
  return cloneJson(cache.authEvents.filter((event) => event.userId === userId).slice(0, limit))
}

export const listRecentAuthEvents = (limit = 50): AuthEvent[] => {
  return cloneJson(cache.authEvents.slice(0, limit))
}

export const listUsersForAdmin = (filter: {
  status?: string
  role?: string
  provider?: string
  plan?: string
  q?: string
  limit?: number
  offset?: number
}): { users: User[]; total: number } => {
  const q = filter.q?.trim().toLowerCase()
  let list = cache.users.map(mapUser)
  if (filter.status && filter.status !== 'all') {
    list = list.filter((user) => resolveEffectiveUserStatus(user) === filter.status)
  }
  if (filter.role && filter.role !== 'all') {
    list = list.filter((user) => (user.role ?? 'user') === filter.role)
  }
  if (filter.provider && filter.provider !== 'all') {
    list = list.filter((user) => user.authProvider === filter.provider)
  }
  if (q) {
    list = list.filter((user) => user.name.toLowerCase().includes(q) || user.email.toLowerCase().includes(q))
  }
  const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const total = sorted.length
  const limit = filter.limit && filter.limit > 0 ? filter.limit : 50
  const offset = filter.offset && filter.offset > 0 ? filter.offset : 0
  return { users: sorted.slice(offset, offset + limit), total }
}

export const listAdminAccounts = (): Array<User & { role: 'admin' | 'owner' }> => {
  return cache.users
    .filter((user) => user.role === 'admin' || user.role === 'owner' || user.isInternal)
    .map((user) => ({
      ...mapUser(user),
      role: (user.role === 'owner' || user.role === 'admin' ? user.role : 'admin') as 'admin' | 'owner',
    }))
}

export const updateUserStatus = (input: {
  userId: string
  status: UserStatus
  reason?: string
  suspendedUntil?: string
  actorId?: string
}): User | null => {
  const user = cache.users.find((item) => item.id === input.userId)
  if (!user) {
    return null
  }

  const now = new Date().toISOString()
  user.status = input.status
  if (input.status === 'banned') {
    user.bannedReason = input.reason?.trim() || user.bannedReason
    user.bannedAt = user.bannedAt ?? now
    user.suspendedUntil = undefined
  } else if (input.status === 'suspended') {
    user.suspendedUntil = input.suspendedUntil || undefined
    user.bannedReason = undefined
    user.bannedAt = undefined
  } else {
    user.suspendedUntil = undefined
    user.bannedReason = undefined
    user.bannedAt = undefined
  }

  schedulePersistence(
    'update-user-status',
    getDrizzleDb()
      .update(users)
      .set({
        status: user.status,
        suspendedUntil: user.suspendedUntil ?? null,
        bannedReason: user.bannedReason ?? null,
        bannedAt: user.bannedAt ?? null,
      })
      .where(eq(users.id, user.id)),
  )

  recordAuthEvent({
    userId: user.id,
    email: user.email,
    eventType: input.status === 'active' ? 'account_restored' : input.status === 'suspended' ? 'account_suspended' : 'account_banned',
    provider: user.authProvider,
    result: 'success',
    metadata: { reason: input.reason, actorId: input.actorId, suspendedUntil: user.suspendedUntil },
  })
  return mapUser(user)
}

export const updateUserRole = (userId: string, role: UserRole, actorId?: string): User | null => {
  const user = cache.users.find((item) => item.id === userId)
  if (!user) {
    return null
  }
  const previousRole = user.role ?? 'user'
  user.role = role
  user.isInternal = role === 'admin' || role === 'owner' ? true : user.isInternal
  schedulePersistence(
    'update-user-role',
    getDrizzleDb()
      .update(users)
      .set({ role: user.role, isInternal: user.isInternal })
      .where(eq(users.id, user.id)),
  )
  recordAuthEvent({
    userId: user.id,
    email: user.email,
    eventType: 'role_changed',
    provider: user.authProvider,
    result: 'success',
    metadata: { previousRole, role, actorId },
  })
  return mapUser(user)
}

export const updateUserSupportNote = (userId: string, note: string, status?: 'pending' | 'in_progress' | 'resolved', actorId?: string): User | null => {
  const user = cache.users.find((item) => item.id === userId)
  if (!user) {
    return null
  }
  const previousNote = user.supportNote
  user.supportNote = note.trim() || undefined
  user.supportNoteStatus = status
  schedulePersistence(
    'update-user-support-note',
    getDrizzleDb()
      .update(users)
      .set({ supportNote: user.supportNote ?? null, supportNoteStatus: user.supportNoteStatus ?? null })
      .where(eq(users.id, user.id)),
  )
  recordAuthEvent({
    userId: user.id,
    email: user.email,
    eventType: 'support_note_updated',
    result: 'success',
    metadata: { actorId, previousNote, note: user.supportNote, status: user.supportNoteStatus ?? null },
  })
  return mapUser(user)
}

export const setUserLastLogin = (userId: string, ip?: string) => {
  const user = cache.users.find((item) => item.id === userId)
  if (!user) {
    return
  }
  user.lastLoginAt = new Date().toISOString()
  user.lastLoginIp = ip?.slice(0, 64)
  schedulePersistence(
    'set-user-last-login',
    getDrizzleDb().update(users).set({ lastLoginAt: user.lastLoginAt, lastLoginIp: user.lastLoginIp ?? null }).where(eq(users.id, user.id)),
  )
}

export const markUserEmailVerified = (userId: string) => {
  const user = cache.users.find((item) => item.id === userId)
  if (!user) {
    return
  }
  user.emailVerifiedAt = new Date().toISOString()
  schedulePersistence(
    'mark-user-email-verified',
    getDrizzleDb().update(users).set({ emailVerifiedAt: user.emailVerifiedAt }).where(eq(users.id, user.id)),
  )
}

/** 强制下线：清除该用户全部 better-auth 会话（cookie），wemux token 由 status 阻断兜底。 */
export const revokeAllUserSessions = async (userId: string): Promise<number> => {
  const result = await getDrizzleDb().delete(betterAuthSessions).where(eq(betterAuthSessions.userId, userId))
  const user = cache.users.find((item) => item.id === userId)
  if (user) {
    recordAuthEvent({ userId, email: user.email, eventType: 'force_logout', provider: user.authProvider, result: 'success' })
  }
  return result.rowCount ?? 0
}

/** 首次初始化：若全库没有 owner，把第一个内部账号提升为 owner（总管理员引导）。 */
export const ensureOwnerAccount = () => {
  const hasOwner = cache.users.some((user) => user.role === 'owner')
  if (hasOwner) {
    return
  }
  const firstInternal = cache.users.find((user) => user.isInternal)
  if (firstInternal) {
    firstInternal.role = 'owner'
    schedulePersistence(
      'ensure-owner-account',
      getDrizzleDb().update(users).set({ role: 'owner' }).where(eq(users.id, firstInternal.id)),
    )
  }
}

/** 调度大脑（feature）：更新协作空间级大脑配置（brainEnabled/brainAgentId/brainInstructions）。 */
export const updateCollabWorkspaceBrainConfig = (
  workspaceId: string,
  config: { enabled?: boolean; brainAgentId?: string; brainInstructions?: string },
): Promise<boolean> => {
  const nextUpdatedAt = new Date().toISOString()
  const set: Record<string, unknown> = { updatedAt: nextUpdatedAt }
  // drizzle set key 使用 schema 属性名（brainEnabled/brainAgentId/brainInstructions）
  if (config.enabled !== undefined) set.brainEnabled = config.enabled
  if (config.brainAgentId !== undefined) set.brainAgentId = config.brainAgentId?.trim() || null
  if (config.brainInstructions !== undefined) set.brainInstructions = config.brainInstructions?.trim() || null
  return getDrizzleDb()
    .update(collabWorkspaces)
    .set(set)
    .where(eq(collabWorkspaces.id, workspaceId))
    .then((result) => (result.rowCount ?? 0) > 0)
    .catch(() => false)
}
