import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ExecutorRecord } from '@shared/types'
import { TaskChatExecutorSelector } from './workspace-session-chat-selectors'

const executor: ExecutorRecord = {
  executorId: 'executor-win',
  machineId: 'machine-win',
  name: 'Win',
  machineName: 'Win',
  workspaceRoot: 'C:\\vibemux',
  status: 'online',
  version: '0.3.102',
  maxConcurrency: 1,
  capabilities: [],
  labels: [],
  lastSeenAt: '2026-07-13T08:00:00.000Z',
  createdAt: '2026-07-13T08:00:00.000Z',
  ownerUserId: 'user-1',
  visibility: 'private',
}

test('TaskChatExecutorSelector exposes an inline loading state while switching nodes', () => {
  const html = renderToStaticMarkup(
    <TaskChatExecutorSelector
      open={false}
      onOpenChange={() => undefined}
      workspaceId="workspace-1"
      busy
      switching
      executorCards={[{
        executor,
        runningCount: 0,
        queuedCount: 0,
        freeSlots: 1,
        isOnline: true,
        isBusy: false,
        isOutdated: false,
      }]}
      effectiveExecutorId={executor.executorId}
      onSelectExecutor={() => undefined}
      onCreateExecutor={() => undefined}
    />,
  )

  assert.match(html, /aria-busy="true"/)
  assert.match(html, /animate-spin/)
  assert.match(html, /正在切换到 Win/)
})
