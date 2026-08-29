import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasCustomAgentScopeRestrictions,
  isCustomAgentAccessible,
  isCustomAgentVisibleInWorkspace,
  matchesCustomAgentScope,
  normalizeCustomAgentConfig,
  partitionAgentsByScope,
  readCustomAgentConfig,
  resolveAgentScopeKind,
  resolveCustomAgentVisibility,
  writeCustomAgentConfig,
} from './custom-agent'

test('normalizeCustomAgentConfig migrates inherit runtime to Pi', () => {
  const config = normalizeCustomAgentConfig({
    preferredRuntime: 'inherit',
    preferredModel: 'openai/gpt-5',
  })

  assert.equal(config.preferredRuntime, 'Pi')
  assert.equal(config.preferredModel, 'openai/gpt-5')
})

test('normalizeCustomAgentConfig defaults to Pi when runtime is missing', () => {
  const config = normalizeCustomAgentConfig({})

  assert.equal(config.preferredRuntime, 'Pi')
})

test('normalizeCustomAgentConfig no longer restricts file writes or commands', () => {
  const config = normalizeCustomAgentConfig({
    canWriteFiles: false,
    canRunCommands: false,
  })

  assert.equal(config.canWriteFiles, true)
  assert.equal(config.canRunCommands, true)
})

test('writeCustomAgentConfig persists Pi for legacy inherit runtime payloads', () => {
  const config = writeCustomAgentConfig({}, {
    preferredRuntime: 'inherit',
  })

  assert.equal(readCustomAgentConfig(config).preferredRuntime, 'Pi')
})

test('normalizeCustomAgentConfig removes the retired Feishu outgoing webhook', () => {
  const config = normalizeCustomAgentConfig({
    channels: {
      feishu: {
        enabled: true,
        appId: 'cli_test',
        appSecret: 'secret',
        webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/retired',
      },
    },
  })

  assert.equal('webhookUrl' in config.channels.feishu, false)
  assert.equal(config.channels.feishu.connectionMode, 'manual')
})

test('normalizeCustomAgentConfig preserves QR-bound Feishu long connection mode', () => {
  const config = normalizeCustomAgentConfig({ channels: { feishu: { connectionMode: 'long-connection' } } })
  assert.equal(config.channels.feishu.connectionMode, 'long-connection')
})

test('normalizeCustomAgentConfig defaults and preserves the WeChat iLink channel section', () => {
  const empty = normalizeCustomAgentConfig({})
  assert.deepEqual(empty.channels.wechat, { enabled: false, botToken: '', botId: '', wechatUserId: '', baseUrl: '' })

  const bound = normalizeCustomAgentConfig({
    channels: {
      wechat: {
        enabled: true,
        botToken: 'ilink-bot-token',
        botId: 'ilink-bot-id',
        wechatUserId: 'wx-user-1',
        baseUrl: 'https://ilinkai.weixin.qq.com',
      },
    },
  })
  assert.equal(bound.channels.wechat.enabled, true)
  assert.equal(bound.channels.wechat.botToken, 'ilink-bot-token')
  assert.equal(bound.channels.wechat.botId, 'ilink-bot-id')
  assert.equal(bound.channels.wechat.wechatUserId, 'wx-user-1')
  assert.equal(bound.channels.wechat.baseUrl, 'https://ilinkai.weixin.qq.com')
})

test('custom Agent scope matches an allowed project or workspace and treats empty lists as unrestricted', () => {
  const unrestricted = normalizeCustomAgentConfig({})
  assert.equal(hasCustomAgentScopeRestrictions(unrestricted), false)
  assert.equal(matchesCustomAgentScope(unrestricted, { projectId: 'project-1', workspaceId: 'workspace-1' }), true)

  const scoped = normalizeCustomAgentConfig({ workspaceIds: ['workspace-1'], projectIds: ['project-2'] })
  assert.equal(hasCustomAgentScopeRestrictions(scoped), true)
  assert.equal(matchesCustomAgentScope(scoped, { collaborationWorkspaceId: 'workspace-1' }), true)
  assert.equal(matchesCustomAgentScope(scoped, { agentWorkspaceId: 'workspace-1' }), true)
  assert.equal(matchesCustomAgentScope(scoped, { projectId: 'project-2' }), true)
  assert.equal(matchesCustomAgentScope(scoped, {
    projectId: 'project-1',
    collaborationWorkspaceId: 'workspace-2',
    agentWorkspaceId: 'agent-workspace-2',
  }), false)
})

test('normalizeCustomAgentConfig defaults visibility to private and preserves workspace', () => {
  const defaults = normalizeCustomAgentConfig({})
  assert.equal(defaults.visibility, 'private')

  const shared = normalizeCustomAgentConfig({ workspaceIds: ['ws-1'], visibility: 'workspace' })
  assert.equal(shared.visibility, 'workspace')
  assert.deepEqual(shared.workspaceIds, ['ws-1'])

  const legacy = normalizeCustomAgentConfig({ workspaceIds: ['ws-1'], visibility: 'team' })
  assert.equal(legacy.visibility, 'private')
})

test('isCustomAgentVisibleInWorkspace applies ownership, visibility and workspace membership', () => {
  const ownerId = 'user-1'
  const otherUserId = 'user-2'
  const workspaceId = 'ws-1'

  const shared = normalizeCustomAgentConfig({ workspaceIds: ['ws-1'], visibility: 'workspace' })
  assert.equal(isCustomAgentVisibleInWorkspace(shared, { userId: otherUserId, ownerUserId: ownerId, workspaceId }), true)
  assert.equal(isCustomAgentVisibleInWorkspace(shared, { userId: ownerId, ownerUserId: ownerId, workspaceId: 'ws-2' }), false)

  const privateAgent = normalizeCustomAgentConfig({ workspaceIds: ['ws-1'], visibility: 'private' })
  assert.equal(isCustomAgentVisibleInWorkspace(privateAgent, { userId: ownerId, ownerUserId: ownerId, workspaceId }), true)
  assert.equal(isCustomAgentVisibleInWorkspace(privateAgent, { userId: otherUserId, ownerUserId: ownerId, workspaceId }), false)

  // 老数据（未归属）→ 全局兼容
  const legacyGlobal = normalizeCustomAgentConfig({})
  assert.equal(isCustomAgentVisibleInWorkspace(legacyGlobal, { userId: otherUserId, ownerUserId: ownerId, workspaceId }), true)

  assert.equal(resolveCustomAgentVisibility(shared), 'workspace')
  assert.equal(resolveCustomAgentVisibility(privateAgent), 'private')
})

test('isCustomAgentAccessible enforces visibility, ownership, workspace and project scope', () => {
  const ownerId = 'user-1'
  const otherUserId = 'user-2'
  const workspaceId = 'ws-1'

  const shared = normalizeCustomAgentConfig({ workspaceIds: ['ws-1'], visibility: 'workspace' })
  assert.equal(isCustomAgentAccessible(shared, { userId: otherUserId, ownerUserId: ownerId, workspaceId }), true)
  assert.equal(isCustomAgentAccessible(shared, { userId: otherUserId, ownerUserId: ownerId, workspaceId: 'ws-2' }), false)
  // 无 workspace 上下文且归属了 workspace → 拒绝
  assert.equal(isCustomAgentAccessible(shared, { userId: otherUserId, ownerUserId: ownerId }), false)

  const privateAgent = normalizeCustomAgentConfig({ workspaceIds: ['ws-1'], visibility: 'private' })
  assert.equal(isCustomAgentAccessible(privateAgent, { userId: ownerId, ownerUserId: ownerId, workspaceId }), true)
  assert.equal(isCustomAgentAccessible(privateAgent, { userId: otherUserId, ownerUserId: ownerId, workspaceId }), false)

  // 老数据全局：共享 → 任意用户；私有 → 仅创建者
  const legacyShared = normalizeCustomAgentConfig({ visibility: 'workspace' })
  assert.equal(isCustomAgentAccessible(legacyShared, { userId: otherUserId, ownerUserId: ownerId }), true)
  const legacyPrivate = normalizeCustomAgentConfig({ visibility: 'private' })
  assert.equal(isCustomAgentAccessible(legacyPrivate, { userId: ownerId, ownerUserId: ownerId }), true)
  assert.equal(isCustomAgentAccessible(legacyPrivate, { userId: otherUserId, ownerUserId: ownerId }), false)

  // projectIds 限定：非空时必须匹配项目
  const projectScoped = normalizeCustomAgentConfig({ workspaceIds: ['ws-1'], projectIds: ['project-1'], visibility: 'workspace' })
  assert.equal(isCustomAgentAccessible(projectScoped, { userId: otherUserId, ownerUserId: ownerId, workspaceId, projectId: 'project-1' }), true)
  assert.equal(isCustomAgentAccessible(projectScoped, { userId: otherUserId, ownerUserId: ownerId, workspaceId, projectId: 'project-2' }), false)
})

test('resolveAgentScopeKind partitions agents into workspace vs private', () => {
  assert.equal(resolveAgentScopeKind({ visibility: 'workspace', workspaceIds: [] }), 'workspace')
  assert.equal(resolveAgentScopeKind({ visibility: 'private', workspaceIds: ['ws-1'] }), 'workspace')
  assert.equal(resolveAgentScopeKind({ visibility: 'private', workspaceIds: [] }), 'private')
})

test('partitionAgentsByScope splits agent list by scope', () => {
  const agents = [
    { id: 'a1', config: { customAgent: { workspaceIds: ['ws-1'], visibility: 'private' } } },
    { id: 'a2', config: { customAgent: { workspaceIds: [], visibility: 'workspace' } } },
    { id: 'a3', config: { customAgent: { workspaceIds: [], visibility: 'private' } } },
    { id: 'a4', config: {} },
  ]
  const { workspaceAgents, privateAgents } = partitionAgentsByScope(agents)
  assert.deepEqual(workspaceAgents.map((agent) => agent.id), ['a1', 'a2'])
  assert.deepEqual(privateAgents.map((agent) => agent.id), ['a3', 'a4'])
})
