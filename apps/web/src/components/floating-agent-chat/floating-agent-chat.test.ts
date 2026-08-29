import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldShowFloatingChatForPathname } from './floating-agent-chat'

test('business pages show the floating chat entry', () => {
  assert.equal(shouldShowFloatingChatForPathname('/chat'), true)
  assert.equal(shouldShowFloatingChatForPathname('/workspace?sessionId=abc'), true)
  assert.equal(shouldShowFloatingChatForPathname('/kanban'), true)
  assert.equal(shouldShowFloatingChatForPathname('/dashboard'), true)
  assert.equal(shouldShowFloatingChatForPathname('/workspaces'), true)
  assert.equal(shouldShowFloatingChatForPathname('/agents'), true)
  assert.equal(shouldShowFloatingChatForPathname('/settings'), true)
})

test('embed pages never show the floating chat entry', () => {
  assert.equal(shouldShowFloatingChatForPathname('/embed'), false)
  assert.equal(shouldShowFloatingChatForPathname('/embed/session/token-1'), false)
})

test('admin console never shows the floating chat entry', () => {
  assert.equal(shouldShowFloatingChatForPathname('/admin'), false)
  assert.equal(shouldShowFloatingChatForPathname('/admin/settings'), false)
})


test('regular app paths show the floating chat entry', () => {
  assert.equal(shouldShowFloatingChatForPathname('/chat'), true)
  assert.equal(shouldShowFloatingChatForPathname('/dashboard'), true)
  assert.equal(shouldShowFloatingChatForPathname('/some/unknown/path'), true)
})

test('auth / onboarding pages never show the floating chat entry', () => {
  assert.equal(shouldShowFloatingChatForPathname('/login'), false)
  assert.equal(shouldShowFloatingChatForPathname('/onboarding'), false)
})

