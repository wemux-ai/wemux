import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTaskChatSessionKey } from '@shared/task-chat-session'

import { clusterConfig } from '../../cluster/config'
import type { TaskChatSessionLease } from '../../storage/postgres/task-chat-queue-store'
import {
  stopTaskChatExecutionAcrossNodes,
  taskChatStopRoutingDeps,
} from './runtime-state'

const baseDeps = {
  getLease: taskChatStopRoutingDeps.getLease,
  getNodeFresh: taskChatStopRoutingDeps.getNodeFresh,
  fetchRemoteStop: taskChatStopRoutingDeps.fetchRemoteStop,
}

const restoreDeps = () => {
  taskChatStopRoutingDeps.getLease = baseDeps.getLease
  taskChatStopRoutingDeps.getNodeFresh = baseDeps.getNodeFresh
  taskChatStopRoutingDeps.fetchRemoteStop = baseDeps.fetchRemoteStop
}

test.afterEach(restoreDeps)

const buildLease = (claimedByNodeId: string): TaskChatSessionLease => ({
  sessionKey: buildTaskChatSessionKey('task-1', 'workspace-1', 'session-1'),
  leaseId: 'lease-1',
  claimedByNodeId,
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
})

const stopParams = { taskId: 'task-1', workspaceId: 'workspace-1', workspaceSessionId: 'session-1' }

const buildNode = (nodeId: string, url = `https://${nodeId}.internal.example`) => ({
  nodeId,
  name: nodeId,
  url,
  relayUrl: url,
  status: 'online' as const,
  region: 'us',
  maxConcurrentTasks: 50,
  lastHeartbeatAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  capabilities: [],
  activeTasks: 0,
})

test('stopTaskChatExecutionAcrossNodes falls back to local stop when no lease exists', async () => {
  taskChatStopRoutingDeps.getLease = async () => null

  const result = await stopTaskChatExecutionAcrossNodes(stopParams)

  assert.equal(result.remote, false)
})

test('stopTaskChatExecutionAcrossNodes stops locally when the lease is owned by the local node', async () => {
  taskChatStopRoutingDeps.getLease = async () => buildLease(clusterConfig.nodeId)

  const result = await stopTaskChatExecutionAcrossNodes(stopParams)

  assert.equal(result.remote, false)
})

test('stopTaskChatExecutionAcrossNodes relays to the owning node when the lease is remote', async () => {
  const owningNodeId = 'node-b'
  const remoteRequests: Array<{ relayUrl: string; taskId: string; workspaceSessionId?: string }> = []
  taskChatStopRoutingDeps.getLease = async () => buildLease(owningNodeId)
  taskChatStopRoutingDeps.getNodeFresh = async (nodeId: string) => buildNode(nodeId)
  taskChatStopRoutingDeps.fetchRemoteStop = async (params) => {
    remoteRequests.push(params)
    return { ok: true, stopped: true }
  }

  const result = await stopTaskChatExecutionAcrossNodes(stopParams)

  assert.equal(result.remote, true)
  assert.equal(result.stopped, true)
  assert.equal(remoteRequests.length, 1)
  assert.equal(remoteRequests[0]?.relayUrl, `https://${owningNodeId}.internal.example`)
  assert.equal(remoteRequests[0]?.taskId, 'task-1')
  assert.equal(remoteRequests[0]?.workspaceSessionId, 'session-1')
})

test('stopTaskChatExecutionAcrossNodes reports failure when the remote relay is unavailable', async () => {
  taskChatStopRoutingDeps.getLease = async () => buildLease('node-b')
  taskChatStopRoutingDeps.getNodeFresh = async (nodeId: string) => buildNode(nodeId)
  taskChatStopRoutingDeps.fetchRemoteStop = async () => {
    throw new Error('ECONNREFUSED')
  }

  const result = await stopTaskChatExecutionAcrossNodes(stopParams)

  assert.equal(result.remote, true)
  assert.equal(result.stopped, false)
})

test('stopTaskChatExecutionAcrossNodes degrades to local stop when the owning node has no relay url', async () => {
  taskChatStopRoutingDeps.getLease = async () => buildLease('node-b')
  taskChatStopRoutingDeps.getNodeFresh = async (nodeId: string) => buildNode(nodeId, '')

  const result = await stopTaskChatExecutionAcrossNodes(stopParams)

  assert.equal(result.remote, false)
})
