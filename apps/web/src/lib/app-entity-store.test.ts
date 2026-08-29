import assert from 'node:assert/strict'
import test from 'node:test'

import type { AppState } from '@shared/types'
import { AppEntityStore, NormalizedEntityCollectionStore, replaceEqualDeep } from './app-entity-store'

test('replaceEqualDeep preserves equal nested references', () => {
  const previous = { id: 'task-1', result: { delivery: { status: 'ready' } } }
  const next = { id: 'task-1', result: { delivery: { status: 'ready' } } }

  assert.equal(replaceEqualDeep(previous, next), previous)
})

test('AppEntityStore updates one entity without replacing unchanged entities', () => {
  const projectA = { id: 'project-a', name: 'A', gitUrl: '' }
  const projectB = { id: 'project-b', name: 'B', gitUrl: '' }
  const initial = {
    projects: [projectA, projectB],
    tasks: [],
    nodes: [],
    projectBindings: [],
    distributedTasks: [],
    taskWorkspaceBindings: [],
    workspaceSessions: [],
    mainChatSessions: [],
  } as unknown as AppState
  const store = new AppEntityStore(initial)
  const current = store.reconcile(initial)
  const next = store.reconcile({
    ...initial,
    projects: [
      { id: 'project-a', name: 'A changed', gitUrl: '' },
      { id: 'project-b', name: 'B', gitUrl: '' },
    ],
  } as AppState)

  assert.notEqual(next.projects[0], current.projects[0])
  assert.equal(next.projects[1], current.projects[1])
  assert.equal(store.getEntity('projects', 'project-b'), current.projects[1])
})

test('NormalizedEntityCollectionStore shares entities across independent query payloads', () => {
  const store = new NormalizedEntityCollectionStore<{ id: string; name: string }>()
  const first = store.reconcile([{ id: 'workspace-1', name: 'Workspace' }])
  const second = store.reconcile([{ id: 'workspace-1', name: 'Workspace' }])

  assert.equal(second[0], first[0])
})

test('replaceEqualDeep preserves fields omitted from a summarized next payload', () => {
  const previous = { id: 's1', title: 'chat', messages: [{ id: 'm1', role: 'user', content: 'hi' }] }
  const next = { id: 's1', title: 'chat', messageCount: 1 } as unknown as typeof previous

  const merged = replaceEqualDeep(previous, next) as typeof previous & { messageCount?: number }

  assert.deepEqual(merged.messages, previous.messages)
  assert.equal(merged.messageCount, 1)
})

test('replaceEqualDeep still clears fields explicitly set to undefined', () => {
  const previous = { id: 't1', pinnedAt: '2026-01-01T00:00:00.000Z' as string | undefined }
  const next = { id: 't1', pinnedAt: undefined as string | undefined }

  const merged = replaceEqualDeep(previous, next)

  assert.equal(merged.pinnedAt, undefined)
})

test('AppEntityStore keeps a cold-loaded mainChatSession.messages after a summarized SSE reconcile', () => {
  const baseSession = { id: 's1', title: 'chat', agentRunningStatus: 'idle' as const }
  const initial = {
    projects: [],
    tasks: [],
    nodes: [],
    projectBindings: [],
    distributedTasks: [],
    taskWorkspaceBindings: [],
    workspaceSessions: [],
    mainChatSessions: [baseSession],
  } as unknown as AppState
  const store = new AppEntityStore(initial)
  store.reconcile(initial)

  const withMessages = {
    ...initial,
    mainChatSessions: [{ ...baseSession, messages: [{ id: 'm1', role: 'user', content: 'hi' }] }],
  } as AppState
  const afterColdLoad = store.reconcile(withMessages)
  assert.equal(afterColdLoad.mainChatSessions[0].messages?.length, 1)

  const summarized = {
    ...withMessages,
    mainChatSessions: [{ ...baseSession, messageCount: 1, messagesLoaded: false, latestMessagePreview: 'hi' }],
  } as AppState
  const afterSummarizedReconcile = store.reconcile(summarized)
  assert.equal(afterSummarizedReconcile.mainChatSessions[0].messages?.length, 1)
})
