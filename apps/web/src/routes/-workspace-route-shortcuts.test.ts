import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesToggleWorkspaceTerminalShortcut, shouldHandleToggleWorkspaceTerminalShortcut } from './-workspace-route-shortcuts'

test('matches Cmd/Ctrl + J for workspace terminal toggling', () => {
  assert.equal(matchesToggleWorkspaceTerminalShortcut({
    altKey: false,
    ctrlKey: true,
    key: 'j',
    metaKey: false,
    shiftKey: false,
  }), true)

  assert.equal(matchesToggleWorkspaceTerminalShortcut({
    altKey: false,
    ctrlKey: false,
    key: 'J',
    metaKey: true,
    shiftKey: false,
  }), true)

  assert.equal(matchesToggleWorkspaceTerminalShortcut({
    altKey: false,
    code: 'KeyJ',
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
  }), true)
})

test('ignores non-primary or interrupted workspace terminal shortcut keydowns', () => {
  assert.equal(matchesToggleWorkspaceTerminalShortcut({
    altKey: false,
    ctrlKey: false,
    key: 'j',
    metaKey: false,
    shiftKey: false,
  }), false)

  assert.equal(matchesToggleWorkspaceTerminalShortcut({
    altKey: false,
    ctrlKey: true,
    defaultPrevented: true,
    key: 'j',
    metaKey: false,
    shiftKey: false,
  }), false)

  assert.equal(matchesToggleWorkspaceTerminalShortcut({
    altKey: true,
    ctrlKey: true,
    key: 'j',
    metaKey: false,
    shiftKey: false,
  }), false)

  assert.equal(matchesToggleWorkspaceTerminalShortcut({
    altKey: false,
    ctrlKey: true,
    isComposing: true,
    key: 'j',
    metaKey: false,
    shiftKey: false,
  }), false)

  assert.equal(matchesToggleWorkspaceTerminalShortcut({
    altKey: false,
    ctrlKey: true,
    key: 'j',
    metaKey: false,
    repeat: true,
    shiftKey: false,
  }), false)
})

test('allows Cmd/Ctrl + J from terminal focus but ignores regular editors', () => {
  assert.equal(shouldHandleToggleWorkspaceTerminalShortcut({
    altKey: false,
    ctrlKey: true,
    key: 'j',
    metaKey: false,
    shiftKey: false,
    target: {
      tagName: 'TEXTAREA',
      closest: () => null,
    },
  }), false)

  assert.equal(shouldHandleToggleWorkspaceTerminalShortcut({
    altKey: false,
    ctrlKey: true,
    key: 'j',
    metaKey: false,
    shiftKey: false,
    target: {
      tagName: 'TEXTAREA',
      closest: (selector: string) => selector === '[data-workspace-terminal-root]' ? {} : null,
    },
  }), true)

  assert.equal(shouldHandleToggleWorkspaceTerminalShortcut({
    altKey: false,
    ctrlKey: true,
    key: 'j',
    metaKey: false,
    shiftKey: false,
    target: {
      tagName: 'DIV',
      closest: () => null,
    },
  }), true)
})
