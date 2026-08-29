// [INPUT]: 纯函数输入（Agent 行 + 会话 + 工作区 + 机器）
// [OUTPUT]: 宇宙图谱装配与忙碌聚合行为断言
// [POS]: Agent 宇宙服务纯函数测试（buildAgentBusyCounts / isUniverseSessionBusy / buildAgentUniverseGraph）；不连数据库
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import assert from 'node:assert/strict'
import test from 'node:test'
import { writeCustomAgentConfig } from '@shared/custom-agent'
import {
  buildAgentBusyCounts,
  buildAgentUniverseGraph,
  isUniverseSessionBusy,
  filterAgentUniverseGraph,
} from './agent-universe-service'

const agentRow = (id: string, workspaceIds: string[], overrides: Record<string, unknown> = {}) => ({
  id,
  name: `agent-${id}`,
  status: 'online' as const,
  ownerUserId: 'user-1',
  config: writeCustomAgentConfig(undefined, {
    workspaceIds,
    preferredModel: 'gpt-4o',
    preferredRuntime: 'openCode',
    defaultExecutorId: 'exec-1',
    avatarUrl: 'https://example.com/a.png',
    skills: ['skill-1'],
    ...overrides,
  }),
})

test('isUniverseSessionBusy：与 web 判定集对齐', () => {
  assert.equal(isUniverseSessionBusy({ agentRunningStatus: 'thinking' }), true)
  assert.equal(isUniverseSessionBusy({ agentRunningStatus: 'executing' }), true)
  assert.equal(isUniverseSessionBusy({ agentRunningStatus: 'waiting' }), true)
  assert.equal(isUniverseSessionBusy({ agentRunningStatus: 'complete' }), false)
  assert.equal(isUniverseSessionBusy({ agentRunningStatus: 'error' }), false)
  assert.equal(isUniverseSessionBusy({ agentRunningStatus: 'idle' }), false)
  // runtimeStatus 优先：queued 不忙；running/waiting 忙
  assert.equal(isUniverseSessionBusy({ agentRunningStatus: 'idle', runtimeStatus: 'queued' }), false)
  assert.equal(isUniverseSessionBusy({ agentRunningStatus: 'idle', runtimeStatus: 'running' }), true)
  assert.equal(isUniverseSessionBusy({ agentRunningStatus: 'idle', runtimeStatus: 'waiting' }), true)
  assert.equal(isUniverseSessionBusy({ agentRunningStatus: 'complete', runtimeStatus: 'running' }), false)
})

test('buildAgentBusyCounts：按 customAgentId 聚合 workspace + main chat', () => {
  const agents = [agentRow('a', []), agentRow('b', [])]
  const counts = buildAgentBusyCounts(
    [
      { customAgentId: 'a', agentRunningStatus: 'executing' },
      { customAgentId: 'a', agentRunningStatus: 'idle', runtimeStatus: 'running' },
      { customAgentId: 'b', agentRunningStatus: 'complete' },
      { customAgentId: 'b', agentRunningStatus: 'thinking' },
    ],
    [
      { customAgentId: 'a', agentRunningStatus: 'waiting' },
      { customAgentId: 'b', agentRunningStatus: 'idle' },
    ],
    agents,
  )
  assert.equal(counts.get('a'), 3)
  assert.equal(counts.get('b'), 1)
})

test('buildAgentBusyCounts：历史会话只有名字时按名字回退匹配', () => {
  const agents = [agentRow('a', [])]
  const counts = buildAgentBusyCounts(
    [{ customAgentName: 'agent-a', agentRunningStatus: 'executing' }],
    [],
    agents,
  )
  assert.equal(counts.get('a'), 1)
})

test('buildAgentUniverseGraph：Agent/工作区/机器节点与四种边', () => {
  const agents = [agentRow('a', ['ws-1', 'ws-2']), agentRow('b', ['ws-1'])]
  const graph = buildAgentUniverseGraph({
    agents,
    workspaceSessions: [{ customAgentId: 'a', agentRunningStatus: 'executing' }],
    mainChatSessions: [],
    workspaces: [
      { id: 'ws-1', name: '核心组' },
      { id: 'ws-2', name: '实验组' },
    ],
    executors: [{ executorId: 'exec-1', machineName: 'mac-pro', name: 'exec-1', platform: 'darwin', version: '1.0', status: 'online' }],
  })

  const agentNodes = graph.nodes.filter((node) => node.type === 'agent')
  assert.equal(agentNodes.length, 2)
  const agentA = agentNodes.find((node) => node.agentId === 'a')!
  assert.equal(agentA.liveBusyCount, 1)
  assert.equal(agentA.model, 'gpt-4o')
  assert.equal(agentA.executorId, 'exec-1')
  assert.equal(agentA.workspaceCount, 2)
  assert.equal(agentA.skillCount, 1)

  assert.equal(graph.nodes.filter((node) => node.type === 'workspace').length, 2)
  const executorNodes = graph.nodes.filter((node) => node.type === 'executor')
  assert.equal(executorNodes.length, 1)
  assert.equal(executorNodes[0].machineName, 'mac-pro')
  assert.equal(executorNodes[0].agentCount, 2) // a + b 都 runs_on exec-1

  const edgeTypes = new Set(graph.edges.map((edge) => edge.type))
  assert.ok(edgeTypes.has('belongs_to'))
  assert.ok(edgeTypes.has('runs_on'))
  assert.ok(edgeTypes.has('collaborates'))
  // a↔b 同 ws-1 协作
  assert.ok(graph.edges.some((edge) => edge.type === 'collaborates'
    && edge.source === 'agent:a' && edge.target === 'agent:b'))
  // runs_on 覆盖执行位置
  assert.ok(graph.edges.some((edge) => edge.type === 'runs_on'
    && edge.source === 'agent:a' && edge.target === 'executor:exec-1'))
})

test('buildAgentUniverseGraph：defaultExecutorId 不可见时不产生机器节点', () => {
  const agents = [agentRow('a', ['ws-1'], { defaultExecutorId: 'exec-hidden' })]
  const graph = buildAgentUniverseGraph({
    agents,
    workspaceSessions: [],
    mainChatSessions: [],
    workspaces: [{ id: 'ws-1', name: '核心组' }],
    executors: [],
  })
  assert.equal(graph.nodes.filter((node) => node.type === 'executor').length, 0)
  assert.equal(graph.edges.some((edge) => edge.type === 'runs_on'), false)
})

test('filterAgentUniverseGraph：只保留工作区直达子图', () => {
  const agents = [agentRow('a', ['ws-1']), agentRow('b', ['ws-2'])]
  const graph = buildAgentUniverseGraph({
    agents,
    workspaceSessions: [],
    mainChatSessions: [],
    workspaces: [
      { id: 'ws-1', name: '核心组' },
      { id: 'ws-2', name: '实验组' },
    ],
    executors: [{ executorId: 'exec-1', machineName: 'mac-pro', name: 'exec-1', platform: 'darwin', version: '1.0', status: 'online' }],
    workspaceFilter: 'ws-1',
  })
  assert.ok(graph.nodes.some((node) => node.type === 'workspace' && node.workspaceId === 'ws-1'))
  assert.equal(graph.nodes.some((node) => node.type === 'workspace' && node.workspaceId === 'ws-2'), false)
  assert.ok(graph.nodes.some((node) => node.type === 'agent' && node.agentId === 'a'))
  assert.equal(graph.nodes.some((node) => node.type === 'agent' && node.agentId === 'b'), false)
})
