import assert from 'node:assert/strict'
import test from 'node:test'
import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspaceFileTree } from './workspace-file-tree'

const directoryEntry = {
  name: 'src',
  path: '/repo/src',
  kind: 'directory' as const,
}

const renderTree = (directoryStates: ComponentProps<typeof WorkspaceFileTree>['directoryStates']) => (
  renderToStaticMarkup(
    <WorkspaceFileTree
      directoryStates={directoryStates}
      entries={[directoryEntry]}
      expandedDirectories={new Set([directoryEntry.path])}
      emptyMessage="empty directory"
      loadingMessage="loading directory"
      selectedFilePath=""
      onOpenFile={() => undefined}
      onToggleDirectory={() => undefined}
    />,
  )
)

test('WorkspaceFileTree treats expanded idle directories as loading', () => {
  const html = renderTree({})

  assert.match(html, /loading directory/)
  assert.doesNotMatch(html, /empty directory/)
})

test('WorkspaceFileTree shows empty text only after a directory is ready and empty', () => {
  const html = renderTree({
    [directoryEntry.path]: {
      status: 'ready',
      entries: [],
      message: '',
    },
  })

  assert.match(html, /empty directory/)
  assert.doesNotMatch(html, /loading directory/)
})
