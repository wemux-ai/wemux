import assert from 'node:assert/strict'
import test from 'node:test'
import { readCustomAgentConfig } from '@shared/custom-agent'
import { buildCustomAgentConfig, createCustomAgentDraft, toggleCustomAgentScopeId } from './draft'

test('buildCustomAgentConfig persists workspace and project allowlists from the editor', () => {
  const config = buildCustomAgentConfig({
    ...createCustomAgentDraft(),
    workspaceIdsText: 'workspace-1\nworkspace-2\nworkspace-1',
    projectIdsText: 'project-1\nproject-2',
  })
  const profile = readCustomAgentConfig(config)

  assert.deepEqual(profile.workspaceIds, ['workspace-1', 'workspace-2'])
  assert.deepEqual(profile.projectIds, ['project-1', 'project-2'])
})

test('toggleCustomAgentScopeId adds and removes normalized scope IDs', () => {
  assert.equal(toggleCustomAgentScopeId('workspace-1\nworkspace-1', 'workspace-2'), 'workspace-1\nworkspace-2')
  assert.equal(toggleCustomAgentScopeId('workspace-1\nworkspace-2', ' workspace-1 '), 'workspace-2')
})

test('buildCustomAgentConfig round-trips the WeChat iLink channel section', () => {
  const config = buildCustomAgentConfig({
    ...createCustomAgentDraft(),
    wechatEnabled: true,
    wechatBotToken: 'ilink-token',
    wechatBotId: 'ilink-bot-id',
    wechatWechatUserId: 'wx-user-1',
    wechatBaseUrl: 'https://ilinkai.weixin.qq.com',
  })
  const profile = readCustomAgentConfig(config)

  assert.equal(profile.channels.wechat.enabled, true)
  assert.equal(profile.channels.wechat.botToken, 'ilink-token')
  assert.equal(profile.channels.wechat.botId, 'ilink-bot-id')
  assert.equal(profile.channels.wechat.wechatUserId, 'wx-user-1')
  assert.equal(profile.channels.wechat.baseUrl, 'https://ilinkai.weixin.qq.com')
})

test('buildCustomAgentConfig round-trips Discord and Slack channel sections', () => {
  const config = buildCustomAgentConfig({
    ...createCustomAgentDraft(),
    discordEnabled: true,
    discordBotToken: 'discord-token',
    discordGuildId: 'guild-1',
    slackEnabled: true,
    slackBotToken: 'xoxb-token',
    slackAppToken: 'xapp-token',
  })
  const profile = readCustomAgentConfig(config)

  assert.equal(profile.channels.discord.enabled, true)
  assert.equal(profile.channels.discord.botToken, 'discord-token')
  assert.equal(profile.channels.discord.guildId, 'guild-1')
  assert.equal(profile.channels.slack.enabled, true)
  assert.equal(profile.channels.slack.botToken, 'xoxb-token')
  assert.equal(profile.channels.slack.appToken, 'xapp-token')
})
