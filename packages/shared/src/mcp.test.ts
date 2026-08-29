import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createVibemuxMcpServerPolicy,
  ensureOfficialConnectorMcpServer,
  materializeMcpServersForOpencode,
  OFFICIAL_CONNECTOR_MCP_SERVER_ID,
  OFFICIAL_CONNECTOR_MCP_SERVER_NAME,
} from './mcp'

test('built-in Vibemux MCP forwards the bound runtime Agent identity', () => {
  const servers = materializeMcpServersForOpencode([createVibemuxMcpServerPolicy()], {
    cloudUrl: 'https://vibemux.example',
    executorToken: 'executor-token',
    actingUserId: 'user-1',
    runtimeAgentId: 'agent-1',
  })
  const definition = servers['mcp-vibemux'] as { headers?: Record<string, string> }

  assert.equal(definition.headers?.['x-vibemux-acting-user'], 'user-1')
  assert.equal(definition.headers?.['x-vibemux-runtime-agent'], 'agent-1')
})

test('ensureOfficialConnectorMcpServer injects a managed connector server when target is set', () => {
  const servers = ensureOfficialConnectorMcpServer([createVibemuxMcpServerPolicy()], 'https://connector.example/mcp')

  assert.equal(servers.length, 2)
  const connector = servers.find((server) => server.id === OFFICIAL_CONNECTOR_MCP_SERVER_ID)
  assert.ok(connector)
  assert.equal(connector.name, OFFICIAL_CONNECTOR_MCP_SERVER_NAME)
  assert.equal(connector.target, 'https://connector.example/mcp')
  assert.equal(connector.transport, 'http')
  assert.equal(connector.managedBySystem, true)
  assert.equal(connector.capabilityMode, 'resources+tools')
  assert.equal(connector.enabled, true)
})

test('ensureOfficialConnectorMcpServer is a no-op without a target', () => {
  const servers = [createVibemuxMcpServerPolicy()]
  assert.equal(ensureOfficialConnectorMcpServer(servers, undefined), servers)
  assert.equal(ensureOfficialConnectorMcpServer(servers, '  '), servers)
})

test('ensureOfficialConnectorMcpServer updates the existing connector target instead of duplicating', () => {
  const first = ensureOfficialConnectorMcpServer([], 'https://connector.example/mcp')
  const second = ensureOfficialConnectorMcpServer(first, 'https://connector-new.example/mcp')

  assert.equal(second.length, 1)
  assert.equal(second[0].id, OFFICIAL_CONNECTOR_MCP_SERVER_ID)
  assert.equal(second[0].target, 'https://connector-new.example/mcp')
  assert.equal(second[0].enabled, true)
})

test('ensureOfficialConnectorMcpServer keeps user-disabled connector state when refreshing target', () => {
  const first = ensureOfficialConnectorMcpServer([], 'https://connector.example/mcp')
  const disabled = first.map((server) => ({ ...server, enabled: false }))
  const refreshed = ensureOfficialConnectorMcpServer(disabled, 'https://connector-new.example/mcp')

  assert.equal(refreshed[0].enabled, false)
  assert.equal(refreshed[0].target, 'https://connector-new.example/mcp')
})

test('official connector materializes as a remote streamable HTTP server for runtime bridges', () => {
  const servers = ensureOfficialConnectorMcpServer([], 'http://localhost:13000/mcp')
  const materialized = materializeMcpServersForOpencode(servers, {
    cloudUrl: 'https://vibemux.example',
    executorToken: 'executor-token',
  })

  const definition = materialized[OFFICIAL_CONNECTOR_MCP_SERVER_ID] as { type?: string; url?: string; enabled?: boolean }
  assert.ok(definition)
  assert.equal(definition.type, 'remote')
  assert.equal(definition.url, 'https://vibemux.example/api/connector/mcp')
  assert.equal(definition.enabled, true)
})

test('official connector materializes with runtime token headers for authenticated MCP bridging', () => {
  const servers = ensureOfficialConnectorMcpServer(
    [],
    'http://localhost:13000/mcp',
    { Authorization: 'Bearer runtime-token' },
  )
  const materialized = materializeMcpServersForOpencode(servers, {
    cloudUrl: 'https://vibemux.example',
    executorToken: 'executor-token',
  })

  const definition = materialized[OFFICIAL_CONNECTOR_MCP_SERVER_ID] as { headers?: Record<string, string> }
  assert.ok(definition)
  assert.equal(definition.headers?.['Authorization'], 'Bearer runtime-token')
})

test('ensureOfficialConnectorMcpServer keeps headers when refreshing target', () => {
  const first = ensureOfficialConnectorMcpServer([], 'https://connector.example/mcp', { Authorization: 'Bearer old' })
  const refreshed = ensureOfficialConnectorMcpServer(first, 'https://connector-new.example/mcp', { Authorization: 'Bearer new' })

  assert.equal(refreshed[0].target, 'https://connector-new.example/mcp')
  assert.equal(refreshed[0].headers?.['Authorization'], 'Bearer new')
})

test('official connector materializes to the Vibemux proxy endpoint with workspace header', () => {
  const servers = ensureOfficialConnectorMcpServer([], 'http://localhost:13000/mcp', {
    Authorization: 'Bearer runtime-token',
  })
  const materialized = materializeMcpServersForOpencode(servers, {
    cloudUrl: 'https://wemux.example',
    executorToken: 'executor-token',
    workspaceId: 'ws-123',
  })

  const definition = materialized[OFFICIAL_CONNECTOR_MCP_SERVER_ID] as {
    url?: string
    headers?: Record<string, string>
  }
  assert.ok(definition)
  assert.equal(definition.url, 'https://wemux.example/api/connector/mcp')
  assert.equal(definition.headers?.['Authorization'], 'Bearer runtime-token')
  assert.equal(definition.headers?.['x-vibemux-workspace'], 'ws-123')
})

test('official connector without workspace omits the workspace header', () => {
  const servers = ensureOfficialConnectorMcpServer([], 'http://localhost:13000/mcp')
  const materialized = materializeMcpServersForOpencode(servers, {
    cloudUrl: 'https://wemux.example',
    executorToken: 'executor-token',
  })

  const definition = materialized[OFFICIAL_CONNECTOR_MCP_SERVER_ID] as { headers?: Record<string, string> }
  assert.ok(definition)
  assert.equal(definition.headers?.['x-vibemux-workspace'], undefined)
})
