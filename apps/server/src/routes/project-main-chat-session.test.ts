import assert from 'node:assert/strict'
import test from 'node:test'
import type { MainChatSession } from '@shared/types'
import {
  createCustomAgentChatSession,
  createMainChatSession,
  resolveNewCustomAgentChatSessionDefaults,
  resolveNewMainChatSessionDefaults,
  setMainChatSessionRuntimeStatus,
} from './project-main-chat-session'

const createSession = (overrides: Partial<MainChatSession>): MainChatSession => ({
  id: overrides.id ?? crypto.randomUUID(),
  title: overrides.title ?? '会话',
  customAgentId: overrides.customAgentId,
  executorId: overrides.executorId,
  executionModel: overrides.executionModel,
  messages: overrides.messages ?? [],
  createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
  runtimeSessionIds: overrides.runtimeSessionIds,
  runtimeContinuations: overrides.runtimeContinuations,
  handoffSnapshot: overrides.handoffSnapshot,
  sourceChannel: overrides.sourceChannel,
  externalConversationId: overrides.externalConversationId,
  externalUserId: overrides.externalUserId,
  externalChatId: overrides.externalChatId,
  externalThreadId: overrides.externalThreadId,
  agentRunningStatus: overrides.agentRunningStatus,
  currentStep: overrides.currentStep,
})

test('createMainChatSession applies inherited executor and model defaults', () => {
  const session = createMainChatSession('新会话', {
    executorId: 'executor-1',
    executionModel: 'openai/gpt-5',
  })

  assert.equal(session.executorId, 'executor-1')
  assert.equal(session.executionModel, 'openai/gpt-5')
  assert.equal(session.agentRunningStatus, 'idle')
  assert.equal(session.currentStep, '')
})

test('resolveNewMainChatSessionDefaults prefers the currently selected session when the agent matches', () => {
  const sessions = [
    createSession({
      id: 'session-primary',
      executorId: 'executor-primary',
      executionModel: 'openai/gpt-5',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    createSession({
      id: 'session-custom',
      customAgentId: 'agent-1',
      executorId: 'executor-custom',
      executionModel: 'openrouter/deepseek-r1',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }),
  ]

  const defaults = resolveNewMainChatSessionDefaults({
    sessions,
    selectedSessionId: 'session-custom',
    customAgentId: 'agent-1',
  })

  assert.equal(defaults.customAgentId, 'agent-1')
  assert.equal(defaults.executorId, 'executor-custom')
  assert.equal(defaults.executionModel, 'openrouter/deepseek-r1')
})

test('resolveNewMainChatSessionDefaults falls back to the latest session for the target agent', () => {
  const sessions = [
    createSession({
      id: 'session-older',
      customAgentId: 'agent-2',
      executorId: 'executor-old',
      executionModel: 'openai/gpt-4.1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    createSession({
      id: 'session-newer',
      customAgentId: 'agent-2',
      executorId: 'executor-new',
      executionModel: 'openai/gpt-5',
      updatedAt: '2026-01-03T00:00:00.000Z',
    }),
    createSession({
      id: 'session-other-agent',
      customAgentId: 'agent-3',
      executorId: 'executor-other',
      executionModel: 'anthropic/claude-sonnet-4',
      updatedAt: '2026-01-04T00:00:00.000Z',
    }),
  ]

  const defaults = resolveNewMainChatSessionDefaults({
    sessions,
    selectedSessionId: 'session-other-agent',
    customAgentId: 'agent-2',
  })

  assert.equal(defaults.customAgentId, 'agent-2')
  assert.equal(defaults.executorId, 'executor-new')
  assert.equal(defaults.executionModel, 'openai/gpt-5')
})

test('createCustomAgentChatSession keeps the target agent while inheriting the model defaults', () => {
  const session = createCustomAgentChatSession('agent-9', '新会话', {
    executorId: 'executor-9',
    executionModel: 'openrouter/gemini-2.5-pro',
  })

  assert.equal(session.customAgentId, 'agent-9')
  assert.equal(session.executorId, 'executor-9')
  assert.equal(session.executionModel, 'openrouter/gemini-2.5-pro')
})

test('setMainChatSessionRuntimeStatus updates the persisted session runtime state', () => {
  const session = createSession({
    id: 'session-runtime',
    agentRunningStatus: 'idle',
    currentStep: '',
  })

  const runningSession = setMainChatSessionRuntimeStatus(session, 'executing', 'Agent 正在运行')
  assert.equal(runningSession.agentRunningStatus, 'executing')
  assert.equal(runningSession.currentStep, 'Agent 正在运行')

  const unchangedSession = setMainChatSessionRuntimeStatus(runningSession, 'executing', 'Agent 正在运行')
  assert.equal(unchangedSession, runningSession)
})

test('resolveNewCustomAgentChatSessionDefaults keeps the current session model even when the agent has its own default model', () => {
  const sessions = [
    createSession({
      id: 'session-agent-1',
      customAgentId: 'agent-1',
      executorId: 'executor-agent-1',
      executionModel: 'openrouter/deepseek-r1',
      updatedAt: '2026-01-03T00:00:00.000Z',
    }),
  ]

  const defaults = resolveNewCustomAgentChatSessionDefaults({
    sessions,
    selectedSessionId: 'session-agent-1',
    customAgentId: 'agent-1',
  })

  assert.equal(defaults.customAgentId, 'agent-1')
  assert.equal(defaults.executorId, 'executor-agent-1')
  assert.equal(defaults.executionModel, 'openrouter/deepseek-r1')
})

test('resolveNewCustomAgentChatSessionDefaults keeps the inherited model when the agent has no default model', () => {
  const sessions = [
    createSession({
      id: 'session-agent-2',
      customAgentId: 'agent-2',
      executorId: 'executor-agent-2',
      executionModel: 'anthropic/claude-sonnet-4',
      updatedAt: '2026-01-04T00:00:00.000Z',
    }),
  ]

  const defaults = resolveNewCustomAgentChatSessionDefaults({
    sessions,
    selectedSessionId: 'session-agent-2',
    customAgentId: 'agent-2',
  })

  assert.equal(defaults.customAgentId, 'agent-2')
  assert.equal(defaults.executorId, 'executor-agent-2')
  assert.equal(defaults.executionModel, 'anthropic/claude-sonnet-4')
})
