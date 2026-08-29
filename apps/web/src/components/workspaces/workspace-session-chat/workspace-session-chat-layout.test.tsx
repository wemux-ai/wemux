import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildWorkspaceToolActionItems, ToolCallRow } from './workspace-session-chat-ui'
import { TaskChatFeed } from './workspace-session-chat-layout'
import { aggregateTimelineForDisplay, canMutateWorkspaceUserTurn } from './workspace-session-chat-helpers'
import { toolCallHasOmittedPersistenceContent } from '@shared/tool-call-persistence'
import { resolveConversationTurnProcessFold } from '../../chat/conversation-feed'

test('TaskChatFeed appends a working assistant bubble for the active workspace turn', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode={false}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-1',
          isCurrent: true,
          user: {
            id: 'turn-1-user',
            ts: '2026-05-15T03:11:00.000Z',
            turnId: 'turn-1',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-1',
            text: '这是一个什么项目',
          },
          entries: [],
          status: {
            id: 'turn-1-status',
            ts: '2026-05-15T03:11:01.000Z',
            turnId: 'turn-1',
            seq: 2,
            kind: 'status',
            status: 'thinking',
            step: 'Codex 正在思考项目结构...',
          },
        },
      ]}
      isSessionBusy
      displayStep="Codex 正在思考项目结构..."
      currentRunTiming={{
        turnId: 'turn-1',
        startedAt: '2026-05-15T03:10:00.000Z',
      }}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /Codex/)
  assert.match(html, /Codex 正在思考项目结构\.\.\./)
})

test('TaskChatFeed shows created task card under the final assistant result', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      tasksById={new Map([['task-created-1', {
        id: 'task-created-1',
        projectId: 'project-1',
        title: '切换工作区节点时保留 agent 原生会话续接',
        description: '保证跨节点后继续沿用原会话系统。',
        status: 'todo',
        priority: 'medium',
        retryCount: 0,
        agentType: 'Codex',
        agentManaged: 'ai',
        requirementType: 'task',
        executionMode: 'auto',
        agentRunningStatus: 'idle',
        currentStep: '',
        createdAt: '2026-06-11T10:45:00.000Z',
        updatedAt: '2026-06-11T10:45:00.000Z',
      } as any]])}
      displayTimeline={[
        {
          id: 'turn-task-created',
          isCurrent: false,
          user: {
            id: 'turn-task-created-user',
            ts: '2026-06-11T10:45:00.000Z',
            turnId: 'turn-task-created',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-task-created',
            text: '你记成一个任务，我到时候再做',
          },
          entries: [
            {
              kind: 'tool',
              id: 'tool-task-created',
              tool: {
                id: 'tool-task-created',
                name: 'task.create',
                args: 'title: 切换工作区节点时保留 agent 原生会话续接',
                result: 'title=切换工作区节点时保留 agent 原生会话续接 | taskId=task-created-1 | status=todo | project=Wemux',
                startedAt: '2026-06-11T10:45:01.000Z',
                finishedAt: '2026-06-11T10:45:02.000Z',
                metadata: {
                  resultPreviewKind: 'task_created',
                  resultPreviewTaskId: 'task-created-1',
                },
              },
            },
            {
              kind: 'assistant',
              id: 'assistant-task-created',
              message: {
                id: 'assistant-task-created',
                role: 'assistant',
                text: '已经记成任务了。',
                createdAt: '2026-06-11T10:45:03.000Z',
              },
            },
          ],
          status: {
            id: 'turn-task-created-status',
            ts: '2026-06-11T10:45:03.000Z',
            turnId: 'turn-task-created',
            seq: 3,
            kind: 'status',
            status: 'complete',
            step: '已完成',
          },
        },
      ]}
      isSessionBusy={false}
      displayStep=""
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
      onOpenTaskFromResult={() => undefined}
    />,
  )

  assert.match(html, /已创建任务/)
  assert.match(html, /打开任务/)
  assert.match(html, /切换工作区节点时保留 agent 原生会话续接/)
})

test('resolveConversationTurnProcessFold hides intermediate process entries once a turn is settled', () => {
  const fold = resolveConversationTurnProcessFold({
    enabled: true,
    isBusy: false,
    turn: {
      id: 'turn-folded',
      isCurrent: false,
      entries: [
        {
          kind: 'assistant',
          id: 'assistant-progress',
          message: {
            id: 'assistant-progress',
            role: 'assistant',
            text: '先确认项目结构。',
            createdAt: '2026-05-15T03:11:05.000Z',
          },
        },
        {
          kind: 'tool',
          id: 'tool-read',
          tool: {
            id: 'tool-read',
            name: 'Read',
            args: 'app.js',
            startedAt: '2026-05-15T03:11:06.000Z',
            finishedAt: '2026-05-15T03:11:08.000Z',
          },
        },
        {
          kind: 'assistant',
          id: 'assistant-result',
          message: {
            id: 'assistant-result',
            role: 'assistant',
            text: '已经完成，入口在 app.js。',
            createdAt: '2026-05-15T03:11:20.000Z',
          },
        },
      ],
      status: {
        status: 'complete',
        step: '已完成',
      },
    },
  })

  assert.equal(fold.collapsible, true)
  assert.equal(fold.hiddenEntries.length, 2)
  assert.equal(fold.visibleEntries.length, 1)
  assert.equal(fold.visibleEntries[0]?.id, 'assistant-result')
})

test('resolveConversationTurnProcessFold keeps process visible while the turn is still running', () => {
  const fold = resolveConversationTurnProcessFold({
    enabled: true,
    isBusy: true,
    turn: {
      id: 'turn-running',
      isCurrent: true,
      entries: [
        {
          kind: 'assistant',
          id: 'assistant-progress',
          message: {
            id: 'assistant-progress',
            role: 'assistant',
            text: '我先看一下目录。',
            createdAt: '2026-05-15T03:11:05.000Z',
          },
        },
        {
          kind: 'tool',
          id: 'tool-read',
          tool: {
            id: 'tool-read',
            name: 'Read',
            args: 'app.js',
            startedAt: '2026-05-15T03:11:06.000Z',
          },
        },
      ],
      status: {
        status: 'executing',
        step: '处理中',
      },
    },
  })

  assert.equal(fold.collapsible, false)
  assert.equal(fold.visibleEntries.length, 2)
})

test('resolveConversationTurnProcessFold keeps the final assistant message visible when a change summary follows it', () => {
  const fold = resolveConversationTurnProcessFold({
    enabled: true,
    isBusy: false,
    turn: {
      id: 'turn-assistant-with-change-summary',
      isCurrent: false,
      entries: [
        {
          kind: 'assistant',
          id: 'assistant-progress',
          message: {
            id: 'assistant-progress',
            role: 'assistant',
            text: '我先确认一下改动范围。',
            createdAt: '2026-05-15T03:11:05.000Z',
          },
        },
        {
          kind: 'tool',
          id: 'tool-edit',
          tool: {
            id: 'tool-edit',
            name: 'Edit',
            args: 'app.js',
            startedAt: '2026-05-15T03:11:06.000Z',
            finishedAt: '2026-05-15T03:11:08.000Z',
          },
        },
        {
          kind: 'assistant',
          id: 'assistant-final',
          message: {
            id: 'assistant-final',
            role: 'assistant',
            text: '已经修好，最后一条回复应该继续可见。',
            createdAt: '2026-05-15T03:11:20.000Z',
          },
        },
        {
          kind: 'change_summary',
          id: 'delivery-1:change-summary',
          createdAt: '2026-05-15T03:11:21.000Z',
          changeSummary: {
            fileCount: 1,
            additions: 12,
            deletions: 3,
            files: [
              {
                path: 'apps/web/src/components/chat/conversation-feed.tsx',
                status: 'M',
                additions: 12,
                deletions: 3,
              },
            ],
          },
        },
      ],
      status: {
        status: 'complete',
        step: '已完成',
      },
    },
  })

  assert.equal(fold.collapsible, true)
  assert.equal(fold.hiddenEntries.length, 2)
  assert.equal(fold.visibleEntries.length, 2)
  assert.equal(fold.visibleEntries[0]?.id, 'assistant-final')
  assert.equal(fold.visibleEntries[1]?.id, 'delivery-1:change-summary')
})

test('TaskChatFeed keeps the final assistant message visible when a change summary card follows it', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-change-summary-visible-final',
          isCurrent: false,
          user: {
            id: 'turn-change-summary-visible-final-user',
            ts: '2026-05-15T03:11:00.000Z',
            turnId: 'turn-change-summary-visible-final',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-change-summary-visible-final',
            text: '把这块修一下',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'assistant-progress',
              message: {
                id: 'assistant-progress',
                role: 'assistant',
                text: '我先定位相关文件。',
                createdAt: '2026-05-15T03:11:05.000Z',
              },
            },
            {
              kind: 'tool',
              id: 'tool-edit',
              tool: {
                id: 'tool-edit',
                name: 'Edit',
                args: 'conversation-feed.tsx',
                startedAt: '2026-05-15T03:11:06.000Z',
                finishedAt: '2026-05-15T03:11:08.000Z',
              },
            },
            {
              kind: 'assistant',
              id: 'assistant-final',
              message: {
                id: 'assistant-final',
                role: 'assistant',
                text: '已经修好，最后一条消息现在不该再被折叠掉。',
                createdAt: '2026-05-15T03:11:20.000Z',
              },
            },
            {
              kind: 'change_summary',
              id: 'delivery-visible:change-summary',
              createdAt: '2026-05-15T03:11:21.000Z',
              changeSummary: {
                fileCount: 2,
                additions: 24,
                deletions: 5,
                files: [
                  { path: 'apps/web/src/components/chat/conversation-feed.tsx', status: 'M', additions: 10, deletions: 2 },
                  { path: 'apps/web/src/components/workspaces/workspace-session-chat/workspace-session-chat-layout.test.tsx', status: 'M', additions: 14, deletions: 3 },
                ],
              },
            },
          ],
          status: {
            id: 'turn-change-summary-visible-final-status',
            ts: '2026-05-15T03:11:21.000Z',
            turnId: 'turn-change-summary-visible-final',
            seq: 4,
            kind: 'status',
            status: 'complete',
            step: '工作区对话已完成',
          },
        },
      ]}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /展开过程|Show process/)
  assert.match(html, /已经修好，最后一条消息现在不该再被折叠掉。/)
  assert.match(html, /2 个文件已更改/)
  assert.doesNotMatch(html, /我先定位相关文件。/)
})

test('TaskChatFeed hides transcript until the initial workspace session scroll is ready', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode={false}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[]}
      initialTranscriptReady={false}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /opacity-0/)
})

test('TaskChatFeed shows process folding control and keeps only the final result visible for settled workspace turns', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-complete',
          isCurrent: false,
          user: {
            id: 'turn-complete-user',
            ts: '2026-05-15T03:11:00.000Z',
            turnId: 'turn-complete',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-complete',
            text: '帮我修一下',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'assistant-progress',
              message: {
                id: 'assistant-progress',
                role: 'assistant',
                text: '我先检查项目结构。',
                createdAt: '2026-05-15T03:11:05.000Z',
              },
            },
            {
              kind: 'tool',
              id: 'tool-read',
              tool: {
                id: 'tool-read',
                name: 'Read',
                args: 'app.js',
                startedAt: '2026-05-15T03:11:06.000Z',
                finishedAt: '2026-05-15T03:11:08.000Z',
              },
            },
            {
              kind: 'assistant',
              id: 'assistant-result',
              message: {
                id: 'assistant-result',
                role: 'assistant',
                text: '已经修好，入口在 app.js。',
                createdAt: '2026-05-15T03:11:20.000Z',
              },
            },
          ],
          status: {
            id: 'turn-complete-status',
            ts: '2026-05-15T03:11:20.000Z',
            turnId: 'turn-complete',
            seq: 3,
            kind: 'status',
            status: 'complete',
            step: '工作区对话已完成',
          },
        },
      ]}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /展开过程|Show process/)
  assert.match(html, /1 条消息 · 1 个工具|1 messages · 1 tools/)
  assert.match(html, /已经修好，入口在 app\.js。/)
  assert.doesNotMatch(html, /我先检查项目结构。/)
  assert.doesNotMatch(html, />Read</)
})

test('TaskChatFeed appends a working assistant bubble while a submitted turn has no status event yet', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode={false}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="OpenCode"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-without-status',
          isCurrent: true,
          user: {
            id: 'turn-without-status-user',
            ts: '2026-05-15T03:11:00.000Z',
            turnId: 'turn-without-status',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-without-status',
            text: '你好',
          },
          entries: [],
        },
      ]}
      isSessionBusy
      displayStep="正在提交消息"
      currentRunTiming={{
        turnId: 'turn-without-status',
        startedAt: '2026-05-15T03:10:00.000Z',
      }}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /OpenCode/)
  assert.match(html, /正在提交消息/)
})

test('TaskChatFeed keeps the running status pill visible when the current workspace turn only has a running tool entry', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode={false}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-running-tool-only',
          isCurrent: true,
          user: {
            id: 'turn-running-tool-only-user',
            ts: '2026-06-14T10:00:00.000Z',
            turnId: 'turn-running-tool-only',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-running-tool-only',
            text: '重启 dev server',
          },
          entries: [
            {
              kind: 'tool',
              id: 'turn-running-tool-only-tool',
              tool: {
                id: 'tool-running-only',
                name: 'shell',
                args: '{"cmd":"rm -rf .next && pnpm dev"}',
                startedAt: '2026-06-14T10:00:01.000Z',
              },
            },
          ],
        },
      ]}
      isSessionBusy
      displayStep="正在执行工具..."
      currentRunTiming={{
        turnId: 'turn-running-tool-only',
        startedAt: '2026-06-14T10:00:00.000Z',
      }}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /运行中/)
  assert.match(html, /执行中/)
})

test('TaskChatFeed marks unfinished tool entries as stopped when the workspace session is idle', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode={false}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-stopped-tool-only',
          isCurrent: true,
          user: {
            id: 'turn-stopped-tool-only-user',
            ts: '2026-06-14T10:00:00.000Z',
            turnId: 'turn-stopped-tool-only',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-stopped-tool-only',
            text: '读取 GitHub 配置',
          },
          entries: [
            {
              kind: 'tool',
              id: 'turn-stopped-tool-only-tool',
              tool: {
                id: 'tool-stopped-only',
                name: 'Read',
                args: '{"filePath":"/Users/x/.config/gh/hosts.yml"}',
                startedAt: '2026-06-14T10:00:01.000Z',
              },
            },
          ],
        },
      ]}
      isSessionBusy={false}
      displayStep="已停止"
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /已停止/)
  assert.doesNotMatch(html, /运行中/)
})

test('TaskChatFeed shows a working assistant bubble when the busy session has no timeline yet', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode={false}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[]}
      isSessionBusy
      displayStep="Codex 正在执行代码任务..."
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /Codex/)
  assert.match(html, /Codex 正在执行代码任务\.\.\./)
})

test('TaskChatFeed appends a runtime working bubble when busy state has only historical turns', () => {
  const originalNow = Date.now
  Date.now = () => new Date('2026-05-15T03:10:07.000Z').getTime()

  try {
    const html = renderToStaticMarkup(
      <TaskChatFeed
        scrollRef={{ current: null }}
        onScroll={() => undefined}
        bottomInset={0}
        hasMoreBefore={false}
        isWorkspaceHistoryMode
        loadingMoreBefore={false}
        onLoadOlderTranscriptPage={() => undefined}
        selectedAgentType="OpenCode"
        boundCustomAgentName=""
        boundCustomAgentMode=""
        mountedSkillNames={[]}
        mountedMcpServerNames={[]}
        notices={[]}
        systemLogs={[]}
        displayTimeline={[
          {
            id: 'historical-turn',
            isCurrent: true,
            user: {
              id: 'historical-turn-user',
              ts: '2026-05-15T03:09:00.000Z',
              turnId: 'historical-turn',
              seq: 1,
              kind: 'user_message',
              messageId: 'historical-user',
              text: '这是什么项目',
            },
            entries: [{
              kind: 'assistant',
              id: 'historical-assistant-entry',
              message: {
                id: 'historical-assistant',
                role: 'assistant',
                text: '这是一个 monorepo 项目。',
                createdAt: '2026-05-15T03:09:10.000Z',
              },
            }],
            status: {
              id: 'historical-turn-status',
              ts: '2026-05-15T03:09:10.000Z',
              turnId: 'historical-turn',
              seq: 3,
              kind: 'status',
              status: 'complete',
              step: '已完成',
            },
          },
        ]}
        isSessionBusy
        displayStep="OpenCode 正在继续执行..."
        currentRunTiming={null}
        queueStatusMessage=""
        scrollShortcutTarget={null}
        onJumpToBottom={() => undefined}
        onJumpToTop={() => undefined}
      />,
    )

    assert.match(html, /这是一个 monorepo 项目。/)
    assert.match(html, /OpenCode 正在继续执行\.\.\./)
    assert.match(html, /00:00/)
  } finally {
    Date.now = originalNow
  }
})

test('TaskChatFeed does not render the message outline entry point for user turns', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode={false}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-outline-visible',
          isCurrent: false,
          user: {
            id: 'turn-outline-visible-user',
            ts: '2026-05-15T03:11:00.000Z',
            turnId: 'turn-outline-visible',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-outline-visible',
            text: '帮我快速回到这一条用户发过的话',
          },
          entries: [],
        },
      ]}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.doesNotMatch(html, /消息提纲/)
  assert.match(html, /workspace-session-turn-anchor-turn-outline-visible/)
  assert.match(html, /帮我快速回到这一条用户发过的话/)
  assert.doesNotMatch(html, /快速跳回用户发过的话/)
})

test('TaskChatFeed keeps the working assistant bubble visible when the current workspace turn only has an empty assistant placeholder', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode={false}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-with-empty-assistant',
          isCurrent: true,
          user: {
            id: 'turn-with-empty-assistant-user',
            ts: '2026-05-15T03:11:00.000Z',
            turnId: 'turn-with-empty-assistant',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-empty-assistant',
            text: '在吗',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'assistant-empty-placeholder',
              message: {
                id: 'assistant-empty-placeholder',
                role: 'assistant',
                text: '',
                createdAt: '2026-05-15T03:11:01.000Z',
              },
            },
          ],
          status: {
            id: 'turn-empty-assistant-status',
            ts: '2026-05-15T03:11:01.000Z',
            turnId: 'turn-with-empty-assistant',
            seq: 2,
            kind: 'status',
            status: 'thinking',
            step: 'Codex 正在分析这个工作区会话...',
          },
        },
      ]}
      isSessionBusy
      displayStep="Codex 正在分析这个工作区会话..."
      currentRunTiming={{
        turnId: 'turn-with-empty-assistant',
        startedAt: '2026-05-15T03:10:00.000Z',
      }}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /Codex/)
  assert.match(html, /Codex 正在分析这个工作区会话\.\.\./)
})

test('TaskChatFeed keeps the working assistant bubble visible when the current workspace turn only has an OpenCode missing-output placeholder', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode={false}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="OpenCode"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-with-opencode-placeholder',
          isCurrent: true,
          user: {
            id: 'turn-with-opencode-placeholder-user',
            ts: '2026-05-15T03:11:00.000Z',
            turnId: 'turn-with-opencode-placeholder',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-opencode-placeholder',
            text: '继续',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'assistant-opencode-placeholder',
              message: {
                id: 'assistant-opencode-placeholder',
                role: 'assistant',
                text: 'OpenCode 未生成有效文本回复，请重试。',
                createdAt: '2026-05-15T03:11:01.000Z',
              },
            },
          ],
          status: {
            id: 'turn-opencode-placeholder-status',
            ts: '2026-05-15T03:11:01.000Z',
            turnId: 'turn-with-opencode-placeholder',
            seq: 2,
            kind: 'status',
            status: 'thinking',
            step: 'OpenCode 正在分析这个工作区会话...',
          },
        },
      ]}
      isSessionBusy
      displayStep="OpenCode 正在分析这个工作区会话..."
      currentRunTiming={{
        turnId: 'turn-with-opencode-placeholder',
        startedAt: '2026-05-15T03:10:00.000Z',
      }}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /OpenCode 正在分析这个工作区会话\.\.\./)
  assert.doesNotMatch(html, /OpenCode 未生成有效文本回复，请重试。/)
})

test('TaskChatFeed does not render delivery result entries', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-delivery',
          isCurrent: false,
          user: {
            id: 'turn-delivery-user',
            ts: '2026-05-15T03:11:00.000Z',
            turnId: 'turn-delivery',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-delivery',
            text: '请帮我提交并推送',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'turn-delivery-assistant-entry',
              message: {
                id: 'assistant-delivery',
                role: 'assistant',
                text: '我已经完成改动并准备交付。',
                createdAt: '2026-05-15T03:11:10.000Z',
              },
            },
            {
              kind: 'delivery_result',
              id: 'turn-delivery-result-entry',
              message: '已推送远端分支 vibemux/test-delivery-card。',
              createdAt: '2026-05-15T03:11:11.000Z',
              remoteBranchName: 'vibemux/test-delivery-card',
              commitShas: ['abcdef1234567890'],
            },
          ],
        },
      ]}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.doesNotMatch(html, /系统交付/)
  assert.doesNotMatch(html, /已推送远端分支 vibemux\/test-delivery-card。/)
  assert.doesNotMatch(html, /vibemux\/test-delivery-card/)
})

test('TaskChatFeed renders interrupted workspace replies as system messages', () => {
  const displayTimeline = aggregateTimelineForDisplay([
    {
      id: 'turn-interrupted-user-event',
      ts: '2026-05-15T03:11:00.000Z',
      turnId: 'turn-interrupted',
      seq: 1,
      kind: 'user_message',
      messageId: 'user-interrupted',
      text: '继续执行',
    },
    {
      id: 'turn-interrupted-system-event',
      ts: '2026-05-15T03:11:01.000Z',
      turnId: 'turn-interrupted',
      seq: 2,
      kind: 'system_message',
      message: '执行器与控制面连接已断开，本次回复已中止。',
    },
  ], false)

  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={displayTimeline}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /系统提示/)
  assert.match(html, /data-system-timeline-item/)
  assert.doesNotMatch(html, /data-timeline-connect-before/)
  assert.doesNotMatch(html, /data-timeline-connect-after/)
  assert.match(html, /执行器与控制面连接已断开，本次回复已中止。/)
  assert.doesNotMatch(html, /CODEX/)
})

test('TaskChatFeed interleaves system logs with transcript turns by timestamp', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="OpenCode"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[
        {
          id: 'system-log-between-turns',
          role: 'system',
          content: '正在准备工作目录',
          createdAt: '2026-05-15T03:10:05.000Z',
        },
      ]}
      displayTimeline={[
        {
          id: 'turn-early',
          isCurrent: false,
          user: {
            id: 'turn-early-user',
            ts: '2026-05-15T03:10:00.000Z',
            turnId: 'turn-early',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-early',
            text: '先介绍一下自己',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'turn-early-assistant',
              message: {
                id: 'assistant-early',
                role: 'assistant',
                text: '我是你的开发助手。',
                createdAt: '2026-05-15T03:10:03.000Z',
              },
            },
          ],
          status: {
            id: 'turn-early-status',
            ts: '2026-05-15T03:10:03.000Z',
            turnId: 'turn-early',
            seq: 2,
            kind: 'status',
            status: 'complete',
            step: '已完成',
          },
        },
        {
          id: 'turn-late',
          isCurrent: false,
          user: {
            id: 'turn-late-user',
            ts: '2026-05-15T03:10:08.000Z',
            turnId: 'turn-late',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-late',
            text: '继续看看项目',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'turn-late-assistant',
              message: {
                id: 'assistant-late',
                role: 'assistant',
                text: '我先去看项目结构。',
                createdAt: '2026-05-15T03:10:10.000Z',
              },
            },
          ],
          status: {
            id: 'turn-late-status',
            ts: '2026-05-15T03:10:10.000Z',
            turnId: 'turn-late',
            seq: 2,
            kind: 'status',
            status: 'complete',
            step: '已完成',
          },
        },
      ]}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  const earlyIndex = html.indexOf('我是你的开发助手。')
  const systemIndex = html.indexOf('正在准备工作目录')
  const lateIndex = html.indexOf('我先去看项目结构。')

  assert.notEqual(earlyIndex, -1)
  assert.notEqual(systemIndex, -1)
  assert.notEqual(lateIndex, -1)
  assert.ok(earlyIndex < systemIndex)
  assert.ok(systemIndex < lateIndex)
})

test('TaskChatFeed renders generic workspace history system messages as timestamped timeline rows', () => {
  const displayTimeline = aggregateTimelineForDisplay([
    {
      id: 'workspace-history-prep-event',
      ts: '2026-05-15T03:10:06.000Z',
      turnId: 'workspace-prep-turn',
      seq: 1,
      kind: 'system_message',
      message: '正在准备工作目录： /data/vibemux-worker/workspaces/workspace-1/worktrees/worktree-1',
    },
  ], false)

  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="OpenCode"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={displayTimeline}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /系统提示/)
  assert.match(html, /data-system-timeline-item/)
  assert.match(html, /正在准备工作目录/)
  assert.match(html, /2026-05-15T03:10:06\.000Z/)
  assert.doesNotMatch(html, /OPENCODE/)
})

test('TaskChatFeed hides superseded workspace history preparation messages', () => {
  const displayTimeline = aggregateTimelineForDisplay([
    {
      id: 'executor-switch-history-event',
      ts: '2026-05-15T03:10:05.000Z',
      turnId: 'workspace-switch-turn',
      seq: 1,
      kind: 'system_message',
      message: '节点切换：MBP → 我的 Worker\n分支：vibemux/9bfd-这是什么项目\n正在后台准备新节点上的工作目录。',
    },
    {
      id: 'superseded-history-event',
      ts: '2026-05-15T03:10:06.000Z',
      turnId: 'workspace-superseded-turn',
      seq: 1,
      kind: 'system_message',
      message: '针对节点 ce529916-8379-49df-87ad-deffd0936381 的后台准备已停止，已由更新的节点切换替代。',
    },
    {
      id: 'workspace-history-prep-event',
      ts: '2026-05-15T03:10:07.000Z',
      turnId: 'workspace-prep-turn',
      seq: 1,
      kind: 'system_message',
      message: '正在准备工作目录： /data/vibemux-worker/workspaces/workspace-1/worktrees/worktree-1',
    },
  ], false)

  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="OpenCode"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={displayTimeline}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  const switchIndex = html.indexOf('节点切换')
  const prepIndex = html.indexOf('正在准备工作目录：')

  assert.notEqual(switchIndex, -1)
  assert.notEqual(prepIndex, -1)
  assert.ok(switchIndex < prepIndex)
  assert.doesNotMatch(html, /后台准备已停止/)
  assert.match(html, /2026-05-15T03:10:07\.000Z/)
})

test('TaskChatFeed renders executor switch logs as a dedicated transition card before follow-up system logs', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="OpenCode"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[
        {
          id: 'executor-switch-log',
          role: 'system',
          content: '节点切换：MBP → Docker Worker\n分支：vibemux/e05f-项目介绍与探索\n正在后台准备新节点上的工作目录。',
          createdAt: '2026-05-15T03:10:05.000Z',
          workspaceId: 'workspace-1',
          workspaceSessionId: 'session-1',
        },
        {
          id: 'follow-up-log',
          role: 'system',
          content: '正在准备工作目录',
          createdAt: '2026-05-15T03:10:06.000Z',
          workspaceId: 'workspace-1',
          workspaceSessionId: 'session-1',
        },
      ]}
      displayTimeline={[]}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  const switchIndex = html.indexOf('节点切换')
  const followUpIndex = html.indexOf('正在准备工作目录')

  assert.notEqual(switchIndex, -1)
  assert.notEqual(followUpIndex, -1)
  assert.ok(switchIndex < followUpIndex)
  assert.match(html, /节点切换事件/)
  assert.match(html, /MBP/)
  assert.match(html, /Docker Worker/)
  assert.match(html, /2026-05-15T03:10:05\.000Z/)
})

test('TaskChatFeed renders executor switch history messages as the transition bubble', () => {
  const displayTimeline = aggregateTimelineForDisplay([
    {
      id: 'executor-switch-history-event',
      ts: '2026-05-15T03:10:05.000Z',
      turnId: 'workspace-switch-turn',
      seq: 1,
      kind: 'system_message',
      message: '节点切换：MBP → 我的 Worker\n分支：vibemux/9bfd-这是什么项目\n正在后台准备新节点上的工作目录。',
    },
  ], false)

  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="OpenCode"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={displayTimeline}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /节点切换事件/)
  assert.match(html, /MBP/)
  assert.match(html, /我的 Worker/)
  assert.match(html, /2026-05-15T03:10:05\.000Z/)
  assert.doesNotMatch(html, /系统提示/)
})

test('TaskChatFeed keeps the active running turn after newer system logs so execution status stays visible', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="OpenCode"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[
        {
          id: 'system-log-running',
          role: 'system',
          content: '开始自动执行安装命令：pnpm install',
          createdAt: '2026-05-15T03:10:05.000Z',
        },
      ]}
      displayTimeline={[
        {
          id: 'historical-turn-before-running',
          isCurrent: false,
          user: {
            id: 'historical-turn-before-running-user',
            ts: '2026-05-15T03:09:00.000Z',
            turnId: 'historical-turn-before-running',
            seq: 1,
            kind: 'user_message',
            messageId: 'historical-before-running-user',
            text: '这是一个什么项目',
          },
          entries: [{
            kind: 'assistant',
            id: 'historical-turn-before-running-assistant',
            message: {
              id: 'historical-before-running-assistant',
              role: 'assistant',
              text: '这是一个 monorepo 项目。',
              createdAt: '2026-05-15T03:09:10.000Z',
            },
          }],
          status: {
            id: 'historical-turn-before-running-status',
            ts: '2026-05-15T03:09:10.000Z',
            turnId: 'historical-turn-before-running',
            seq: 3,
            kind: 'status',
            status: 'complete',
            step: '已完成',
          },
        },
      ]}
      isSessionBusy
      displayStep="OpenCode 正在执行安装命令..."
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  const systemIndex = html.indexOf('开始自动执行安装命令：pnpm install')
  const runningIndex = html.indexOf('OpenCode 正在执行安装命令...')
  const statusIndex = html.indexOf('执行中')

  assert.notEqual(systemIndex, -1)
  assert.notEqual(runningIndex, -1)
  assert.notEqual(statusIndex, -1)
  assert.ok(systemIndex < runningIndex)
  assert.ok(runningIndex < statusIndex)
})

test('TaskChatFeed keeps final duration visible when delivery system messages follow assistant output', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="OpenCode"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-delivered-with-status',
          isCurrent: true,
          user: {
            id: 'turn-delivered-with-status-user',
            ts: '2026-05-15T03:10:00.000Z',
            turnId: 'turn-delivered-with-status',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-delivered-with-status',
            text: '写一个插入排序',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'turn-delivered-with-status-assistant-entry',
              message: {
                id: 'assistant-delivered-with-status',
                role: 'assistant',
                text: '已创建 insertionsort.js 并验证通过。',
                createdAt: '2026-05-15T03:10:04.000Z',
              },
            },
            {
              kind: 'assistant',
              id: 'turn-delivered-with-status-system-start-entry',
              message: {
                id: 'system-delivery-start',
                role: 'assistant',
                authorType: 'system',
                authorName: '系统提示',
                text: '正在提交改动并推送分支：vibemux/de4e-快排',
                createdAt: '2026-05-15T03:10:05.000Z',
              },
            },
            {
              kind: 'assistant',
              id: 'turn-delivered-with-status-system-finish-entry',
              message: {
                id: 'system-delivery-finish',
                role: 'assistant',
                authorType: 'system',
                authorName: '系统提示',
                text: '已推送远端分支 vibemux/de4e-快排。',
                createdAt: '2026-05-15T03:10:08.000Z',
              },
            },
          ],
          status: {
            id: 'turn-delivered-with-status-complete',
            ts: '2026-05-15T03:10:08.000Z',
            turnId: 'turn-delivered-with-status',
            seq: 5,
            kind: 'status',
            status: 'complete',
            step: '工作区对话已完成',
          },
        },
      ]}
      isSessionBusy={false}
      displayStep="工作区对话已完成"
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /已创建 insertionsort\.js 并验证通过。/)
  assert.match(html, /已推送远端分支 vibemux\/de4e-快排。/)
  assert.equal(html.match(/data-timeline-connect-before="true"/g)?.length ?? 0, 1)
  assert.equal(html.match(/data-timeline-connect-after="true"/g)?.length ?? 0, 1)
  assert.match(html, /已完成/)
  assert.match(html, /00:08/)
})

test('TaskChatFeed keeps the final run duration visible after the current workspace turn completes', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode={false}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-complete',
          isCurrent: true,
          user: {
            id: 'turn-complete-user',
            ts: '2026-05-15T03:11:00.000Z',
            turnId: 'turn-complete',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-complete',
            text: '继续',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'assistant-complete',
              message: {
                id: 'assistant-complete',
                role: 'assistant',
                text: '处理好了。',
                createdAt: '2026-05-15T03:11:20.000Z',
              },
            },
          ],
          status: {
            id: 'turn-complete-status',
            ts: '2026-05-15T03:11:20.000Z',
            turnId: 'turn-complete',
            seq: 3,
            kind: 'status',
            status: 'complete',
            step: '工作区对话已完成',
            workspaceExecutor: {
              executorId: 'a48370fc-42e1-401e-b588-1b056ed53df4',
              name: 'Wemux Cloud Workspace',
              executorSource: 'managed-cloud',
              managedBy: 'vibemux',
              runtimeClass: 'managed-worker',
              status: 'online',
            },
          },
        },
      ]}
      isSessionBusy={false}
      displayStep="工作区对话已完成"
      currentRunTiming={{
        turnId: 'turn-complete',
        startedAt: '2026-05-15T03:10:00.000Z',
        finishedAt: '2026-05-15T03:11:20.000Z',
      }}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /已完成/)
  assert.match(html, /运行节点 Wemux Cloud Workspace · 云节点/)
  assert.match(html, /00:20/)
})

test('TaskChatFeed shows duration metadata while the current workspace turn is still running', () => {
  const originalNow = Date.now
  Date.now = () => new Date('2026-05-15T03:10:07.000Z').getTime()

  try {
    const html = renderToStaticMarkup(
      <TaskChatFeed
        scrollRef={{ current: null }}
        onScroll={() => undefined}
        bottomInset={0}
        hasMoreBefore={false}
        isWorkspaceHistoryMode={false}
        loadingMoreBefore={false}
        onLoadOlderTranscriptPage={() => undefined}
        selectedAgentType="OpenCode"
        boundCustomAgentName=""
        boundCustomAgentMode=""
        mountedSkillNames={[]}
        mountedMcpServerNames={[]}
        notices={[]}
        systemLogs={[]}
        displayTimeline={[
          {
            id: 'turn-running-duration',
            isCurrent: true,
            user: {
              id: 'turn-running-duration-user',
              ts: '2026-05-15T03:10:00.000Z',
              turnId: 'turn-running-duration',
              seq: 1,
              kind: 'user_message',
              messageId: 'user-running-duration',
              text: '帮我启动一下',
            },
            entries: [],
            status: {
              id: 'turn-running-duration-status',
              ts: '2026-05-15T03:10:01.000Z',
              turnId: 'turn-running-duration',
              seq: 2,
              kind: 'status',
              status: 'thinking',
              step: '正在启动 OpenCode...',
            },
          },
        ]}
        isSessionBusy
        displayStep="正在启动 OpenCode..."
        currentRunTiming={{
          turnId: 'turn-running-duration',
          startedAt: '2026-05-15T03:10:00.000Z',
        }}
        queueStatusMessage=""
        scrollShortcutTarget={null}
        onJumpToBottom={() => undefined}
        onJumpToTop={() => undefined}
      />,
    )

    assert.match(html, /正在启动 OpenCode\.\.\./)
    assert.doesNotMatch(html, /<span class="min-w-0 truncate">正在启动 OpenCode\.\.\.<\/span>/)
    assert.match(html, /00:07/)
  } finally {
    Date.now = originalNow
  }
})

test('TaskChatFeed keeps running duration live when a restored workspace turn has no currentRunTiming snapshot yet', () => {
  const originalNow = Date.now
  Date.now = () => new Date('2026-05-15T03:10:07.000Z').getTime()

  try {
    const html = renderToStaticMarkup(
      <TaskChatFeed
        scrollRef={{ current: null }}
        onScroll={() => undefined}
        bottomInset={0}
        hasMoreBefore={false}
        isWorkspaceHistoryMode
        loadingMoreBefore={false}
        onLoadOlderTranscriptPage={() => undefined}
        selectedAgentType="OpenCode"
        boundCustomAgentName=""
        boundCustomAgentMode=""
        mountedSkillNames={[]}
        mountedMcpServerNames={[]}
        notices={[]}
        systemLogs={[]}
        displayTimeline={[
          {
            id: 'turn-restored-running-duration',
            isCurrent: true,
            user: {
              id: 'turn-restored-running-duration-user',
              ts: '2026-05-15T03:10:00.000Z',
              turnId: 'turn-restored-running-duration',
              seq: 1,
              kind: 'user_message',
              messageId: 'user-restored-running-duration',
              text: '帮我启动一下',
            },
            entries: [],
            status: {
              id: 'turn-restored-running-duration-status',
              ts: '2026-05-15T03:10:01.000Z',
              turnId: 'turn-restored-running-duration',
              seq: 2,
              kind: 'status',
              status: 'executing',
              step: '正在启动 OpenCode...',
            },
          },
        ]}
        isSessionBusy
        displayStep="正在启动 OpenCode..."
        currentRunTiming={null}
        queueStatusMessage=""
        scrollShortcutTarget={null}
        onJumpToBottom={() => undefined}
        onJumpToTop={() => undefined}
      />,
    )

    assert.match(html, /正在启动 OpenCode\.\.\./)
    assert.doesNotMatch(html, /<span class="min-w-0 truncate">正在启动 OpenCode\.\.\.<\/span>/)
    assert.match(html, /00:07/)
    assert.doesNotMatch(html, /00:01/)
  } finally {
    Date.now = originalNow
  }
})

test('TaskChatFeed derives turn duration from the current user message and turn status timestamps', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode={false}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-complete-from-user-ts',
          isCurrent: true,
          user: {
            id: 'turn-complete-from-user-ts-user',
            ts: '2026-05-15T14:31:00.000Z',
            turnId: 'turn-complete-from-user-ts',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-complete-from-user-ts',
            text: '你好',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'assistant-complete-from-user-ts',
              message: {
                id: 'assistant-complete-from-user-ts',
                role: 'assistant',
                text: '需要我帮你做什么吗？',
                createdAt: '2026-05-15T14:31:05.000Z',
              },
            },
          ],
          status: {
            id: 'turn-complete-from-user-ts-status',
            ts: '2026-05-15T14:31:05.000Z',
            turnId: 'turn-complete-from-user-ts',
            seq: 3,
            kind: 'status',
            status: 'complete',
            step: '工作区对话已完成',
          },
        },
      ]}
      isSessionBusy={false}
      displayStep="工作区对话已完成"
      currentRunTiming={{
        turnId: 'turn-complete-from-user-ts',
        startedAt: '2026-05-15T13:51:30.000Z',
        finishedAt: '2026-05-15T14:31:05.000Z',
      }}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /已完成/)
  assert.match(html, /00:05/)
  assert.doesNotMatch(html, /39:35/)
})

test('TaskChatFeed shows duration metadata for completed historical turns', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-history-complete',
          isCurrent: false,
          user: {
            id: 'turn-history-complete-user',
            ts: '2026-05-15T13:56:00.000Z',
            turnId: 'turn-history-complete',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-history-complete',
            text: '怎么启动',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'assistant-history-complete',
              message: {
                id: 'assistant-history-complete',
                role: 'assistant',
                text: '运行 npm run dev 即可。',
                createdAt: '2026-05-15T13:56:12.000Z',
              },
            },
          ],
          status: {
            id: 'turn-history-complete-status',
            ts: '2026-05-15T13:56:12.000Z',
            turnId: 'turn-history-complete',
            seq: 3,
            kind: 'status',
            status: 'complete',
            step: '工作区对话已完成',
          },
        },
      ]}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /已完成/)
  assert.match(html, /00:12/)
})

test('TaskChatFeed keeps a minimum one-second duration for completed turns that collapse into the same second', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Pi"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-history-subsecond-complete',
          isCurrent: false,
          user: {
            id: 'turn-history-subsecond-complete-user',
            ts: '2026-05-15T13:56:00.100Z',
            turnId: 'turn-history-subsecond-complete',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-history-subsecond-complete',
            text: '在吗',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'assistant-history-subsecond-complete',
              message: {
                id: 'assistant-history-subsecond-complete',
                role: 'assistant',
                text: '我在。',
                createdAt: '2026-05-15T13:56:00.400Z',
              },
            },
          ],
          status: {
            id: 'turn-history-subsecond-complete-status',
            ts: '2026-05-15T13:56:00.400Z',
            turnId: 'turn-history-subsecond-complete',
            seq: 3,
            kind: 'status',
            status: 'complete',
            step: '工作区对话已完成',
          },
        },
      ]}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /已完成/)
  assert.match(html, /00:01/)
  assert.doesNotMatch(html, /00:00/)
})

test('TaskChatFeed falls back to the latest historical turn content timestamp when status timing collapses to zero', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-history-collapsed-status',
          isCurrent: false,
          user: {
            id: 'turn-history-collapsed-status-user',
            ts: '2026-05-15T14:40:00.000Z',
            turnId: 'turn-history-collapsed-status',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-history-collapsed-status',
            text: '继续做下去',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'assistant-history-collapsed-status',
              message: {
                id: 'assistant-history-collapsed-status',
                role: 'assistant',
                text: '我可以继续帮你改页面。',
                createdAt: '2026-05-15T14:40:09.000Z',
              },
            },
          ],
          status: {
            id: 'turn-history-collapsed-status-status',
            ts: '2026-05-15T14:40:00.000Z',
            turnId: 'turn-history-collapsed-status',
            seq: 3,
            kind: 'status',
            status: 'complete',
            step: '工作区对话已完成',
          },
        },
      ]}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /已完成/)
  assert.match(html, /00:09/)
  assert.doesNotMatch(html, /00:00/)
})

test('TaskChatFeed shows duration metadata for failed turns even when only an error event is available', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="OpenCode"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-error-only',
          isCurrent: true,
          user: {
            id: 'turn-error-only-user',
            ts: '2026-05-15T14:00:00.000Z',
            turnId: 'turn-error-only',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-error-only',
            text: '启动一下',
          },
          entries: [],
          error: {
            id: 'turn-error-only-error',
            ts: '2026-05-15T14:00:06.000Z',
            turnId: 'turn-error-only',
            seq: 2,
            kind: 'error',
            message: 'OpenCode 会话创建失败',
          },
        },
      ]}
      isSessionBusy={false}
      displayStep="工作区对话失败"
      currentRunTiming={{
        turnId: 'turn-error-only',
        startedAt: '2026-05-15T14:00:00.000Z',
        finishedAt: '2026-05-15T14:00:06.000Z',
      }}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /OpenCode 会话创建失败/)
  assert.match(html, /00:06/)
  assert.match(html, /出错/)
})

test('TaskChatFeed renders delivery result change summary', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode={false}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-change-summary',
          isCurrent: false,
          user: {
            id: 'turn-change-summary-user',
            ts: '2026-05-17T00:00:00.000Z',
            turnId: 'turn-change-summary',
            seq: 1,
            kind: 'user_message',
            messageId: 'message-change-summary-user',
            text: '实现一下',
          },
          entries: [
            {
              kind: 'delivery_result',
              id: 'delivery-change-summary',
              message: '本轮变更已记录。',
              createdAt: '2026-05-17T00:00:05.000Z',
              remoteBranchName: 'vibemux/change-summary',
              changeSummary: {
                fileCount: 2,
                additions: 24,
                deletions: 5,
                patch: 'diff --git a/apps/web/src/components/chat/conversation-feed.tsx b/apps/web/src/components/chat/conversation-feed.tsx\n@@ -1 +1 @@\n-old\n+new',
                files: [
                  { path: 'apps/web/src/components/chat/conversation-feed.tsx', status: 'M', additions: 10, deletions: 2 },
                  { path: 'packages/shared/src/task-git-ops.ts', status: 'A', additions: 14, deletions: 3 },
                ],
              },
            },
          ],
        },
      ]}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /2 个文件已更改/)
  assert.match(html, /\+24/)
  assert.match(html, /-5/)
  assert.doesNotMatch(html, /系统交付/)
  assert.doesNotMatch(html, /本轮变更已记录/)
})

test('buildWorkspaceToolActionItems normalizes common coding agent tools', () => {
  const items = buildWorkspaceToolActionItems([
    {
      id: 'tool-search',
      name: 'Grep',
      args: JSON.stringify({ pattern: 'listWorkspaceSessions', path: 'apps/server/src' }),
      startedAt: '2026-05-17T00:00:01.000Z',
      finishedAt: '2026-05-17T00:00:02.000Z',
    },
    {
      id: 'tool-read',
      name: 'Read',
      args: JSON.stringify({ file_path: '/Users/x/work/Vibemux/apps/server/src/routes/task-route-support.ts' }),
      startedAt: '2026-05-17T00:00:02.000Z',
      finishedAt: '2026-05-17T00:00:03.000Z',
    },
    {
      id: 'tool-edit',
      name: 'Edit',
      args: JSON.stringify({ file_path: '/Users/x/work/Vibemux/apps/server/src/integrations/mcp/vibemux-mcp-workspace-session-tools.ts' }),
      result: '1 file changed, 14 insertions(+), 1 deletion(-)',
      startedAt: '2026-05-17T00:00:03.000Z',
      finishedAt: '2026-05-17T00:00:04.000Z',
    },
    {
      id: 'tool-run',
      name: 'Bash',
      args: JSON.stringify({ command: 'pnpm typecheck' }),
      result: 'Exit code 2\napps/server/src/integrations/mcp/vibemux-mcp-workspace-session-tools.ts(545,1): error',
      startedAt: '2026-05-17T00:00:04.000Z',
      finishedAt: '2026-05-17T00:00:05.000Z',
    },
  ], false, {
    fileCount: 1,
    additions: 21,
    deletions: 4,
    files: [
      {
        path: 'apps/server/src/integrations/mcp/vibemux-mcp-workspace-session-tools.ts',
        status: 'M',
        additions: 21,
        deletions: 4,
      },
    ],
  })

  assert.equal(items[0]?.kind, 'search')
  assert.equal(items[0]?.label, '已搜索')
  assert.equal(items[1]?.kind, 'read')
  assert.equal(items[1]?.title, 'task-route-support.ts')
  assert.equal(items[2]?.kind, 'edit')
  assert.equal(items[2]?.diffStat, '+21 -4')
  assert.equal(items[3]?.kind, 'run')
  assert.equal(items[3]?.status, 'failed')
  assert.equal(items[3]?.exitCode, 'Exit code 2')
})

test('TaskChatFeed groups consecutive tool calls into a compact workspace action timeline', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode={false}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-tool-group',
          isCurrent: false,
          user: {
            id: 'turn-tool-group-user',
            ts: '2026-05-17T00:00:00.000Z',
            turnId: 'turn-tool-group',
            seq: 1,
            kind: 'user_message',
            messageId: 'message-tool-group-user',
            text: '找一下相关实现并跑测试',
          },
          entries: [
            {
              kind: 'tool',
              id: 'tool-search-entry',
              tool: {
                id: 'tool-search',
                name: 'Grep',
                args: JSON.stringify({ pattern: 'workspace session', path: 'apps/server/src' }),
                startedAt: '2026-05-17T00:00:01.000Z',
                finishedAt: '2026-05-17T00:00:02.000Z',
              },
            },
            {
              kind: 'tool',
              id: 'tool-read-entry',
              tool: {
                id: 'tool-read',
                name: 'Read',
                args: JSON.stringify({ file_path: '/Users/x/work/Vibemux/apps/server/src/storage/distributed-task-store.ts' }),
                startedAt: '2026-05-17T00:00:02.000Z',
                finishedAt: '2026-05-17T00:00:03.000Z',
              },
            },
            {
              kind: 'tool',
              id: 'tool-run-entry',
              tool: {
                id: 'tool-run',
                name: 'Bash',
                args: JSON.stringify({ command: 'pnpm typecheck' }),
                result: 'Exit code 0',
                startedAt: '2026-05-17T00:00:03.000Z',
                finishedAt: '2026-05-17T00:00:04.000Z',
              },
            },
            {
              kind: 'tool',
              id: 'tool-edit-entry',
              tool: {
                id: 'tool-edit',
                name: 'Edit',
                args: JSON.stringify({ file_path: '/Users/x/work/Vibemux/apps/server/src/storage/distributed-task-store.ts' }),
                startedAt: '2026-05-17T00:00:04.000Z',
                finishedAt: '2026-05-17T00:00:05.000Z',
              },
            },
            {
              kind: 'delivery_result',
              id: 'delivery-tool-group',
              message: '本轮变更已记录。',
              changeSummary: {
                fileCount: 1,
                additions: 7,
                deletions: 2,
                files: [
                  { path: 'apps/server/src/storage/distributed-task-store.ts', status: 'M', additions: 7, deletions: 2 },
                ],
              },
            },
          ],
        },
      ]}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /data-workspace-tool-action-group/)
  assert.match(html, /搜索/)
  assert.match(html, /1 搜索, 1 文件, 1 编辑, 1 命令/)
  assert.match(html, /已读取/)
  assert.match(html, /distributed-task-store\.ts/)
  assert.match(html, /\+7 -2/)
  assert.match(html, /已执行/)
  assert.match(html, /Exit code 0/)
})

test('ToolCallRow hides omitted tool content in workspace session history UI', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode={true}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-tool-omitted',
          isCurrent: false,
          user: {
            id: 'turn-tool-omitted-user',
            ts: '2026-05-17T00:00:00.000Z',
            turnId: 'turn-tool-omitted',
            seq: 1,
            kind: 'user_message',
            messageId: 'message-tool-omitted-user',
            text: '看看这个文件',
          },
          entries: [
            {
              kind: 'tool',
              id: 'tool-omitted-history-entry',
              tool: {
                id: 'tool-omitted-history',
                name: 'Read',
                args: `[tool_call_persistence_meta]\n{"contentOmitted":true,"argsStored":false,"resultStored":false,"argsLength":6000,"resultLength":6000}`,
                startedAt: '2026-05-17T00:00:01.000Z',
                finishedAt: '2026-05-17T00:00:03.000Z',
              },
            },
          ],
        },
      ]}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
    />,
  )

  assert.match(html, /已读取/)
  assert.doesNotMatch(html, /\[tool_call_persistence_meta\]/)
  assert.doesNotMatch(html, /没有写入工作区会话历史存储/)
})

test('toolCallHasOmittedPersistenceContent still detects omitted tool content', () => {
  assert.equal(
    toolCallHasOmittedPersistenceContent({
      args: `[tool_call_persistence_meta]\n{"contentOmitted":true,"argsStored":false,"resultStored":false,"argsLength":6000,"resultLength":6000}`,
      result: undefined,
    }),
    true,
  )
})

test('canMutateWorkspaceUserTurn blocks editing answered migrated history turns', () => {
  assert.equal(canMutateWorkspaceUserTurn({
    turn: {
      id: 'turn-answered',
      isCurrent: true,
      user: {
        id: 'turn-answered-user',
        ts: '2026-05-15T03:11:00.000Z',
        turnId: 'turn-answered',
        seq: 1,
        kind: 'user_message',
        messageId: 'user-answered',
        text: '继续',
      },
      entries: [
        {
          kind: 'assistant',
          id: 'assistant-answered',
          message: {
            id: 'assistant-answered',
            role: 'assistant',
            text: '处理好了。',
            createdAt: '2026-05-15T03:11:20.000Z',
          },
        },
      ],
    },
    isWorkspaceHistoryMode: true,
    isSessionBusy: false,
  }), false)
})

test('TaskChatFeed hides edit and delete actions for answered migrated history turns', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode={true}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-answered',
          isCurrent: true,
          user: {
            id: 'turn-answered-user',
            ts: '2026-05-15T03:11:00.000Z',
            turnId: 'turn-answered',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-answered',
            text: '继续',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'assistant-answered',
              message: {
                id: 'assistant-answered',
                role: 'assistant',
                text: '处理好了。',
                createdAt: '2026-05-15T03:11:20.000Z',
              },
            },
          ],
          status: {
            id: 'turn-answered-status',
            ts: '2026-05-15T03:11:20.000Z',
            turnId: 'turn-answered',
            seq: 3,
            kind: 'status',
            status: 'complete',
            step: '工作区对话已完成',
          },
        },
      ]}
      isSessionBusy={false}
      displayStep="工作区对话已完成"
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
      onEditMessage={() => undefined}
      onDeleteMessage={() => undefined}
    />,
  )

  assert.doesNotMatch(html, /编辑消息/)
  assert.doesNotMatch(html, /删除消息/)
})

test('TaskChatFeed shows revise and retry actions for answered migrated history turns', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      hasMoreBefore={false}
      isWorkspaceHistoryMode={true}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-answered',
          isCurrent: true,
          user: {
            id: 'turn-answered-user',
            ts: '2026-05-15T03:11:00.000Z',
            turnId: 'turn-answered',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-answered',
            text: '继续',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'assistant-answered',
              message: {
                id: 'assistant-answered',
                role: 'assistant',
                text: '处理好了。',
                createdAt: '2026-05-15T03:11:20.000Z',
              },
            },
          ],
        },
      ]}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
      onReviseTurn={() => undefined}
    />,
  )

  assert.match(html, /改写并分叉/)
  assert.match(html, /重试并分叉/)
})

test('TaskChatFeed renders other workspace members as right-aligned user turns with their nickname', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      currentUserId="user-me"
      knownCollaborators={[{
        id: 'user-kyro',
        name: 'KYRO DR',
      }]}
      userLabel="我"
      hasMoreBefore={false}
      isWorkspaceHistoryMode={true}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-collaborator',
          isCurrent: false,
          user: {
            id: 'turn-collaborator-user',
            ts: '2026-05-15T03:11:00.000Z',
            turnId: 'turn-collaborator',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-collaborator',
            text: 'hi',
            authorId: 'user-kyro',
          },
          entries: [],
        },
      ]}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
      onEditMessage={() => undefined}
      onDeleteMessage={() => undefined}
      onReviseTurn={() => undefined}
    />,
  )

  assert.match(html, /KYRO DR/)
  assert.match(html, /flex-row-reverse/)
  assert.doesNotMatch(html, /工作区用户/)
  assert.doesNotMatch(html, /编辑消息/)
  assert.doesNotMatch(html, /删除消息/)
  assert.doesNotMatch(html, /改写并分叉/)
})

test('TaskChatFeed renders an Agent-authored workspace prompt with the Agent identity', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      currentUserId="user-me"
      userLabel="Demo User"
      userAvatarUrl="/avatars/demo-user.png"
      hasMoreBefore={false}
      isWorkspaceHistoryMode={true}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'turn-agent',
          isCurrent: false,
          user: {
            id: 'turn-agent-user',
            ts: '2026-07-23T03:11:00.000Z',
            turnId: 'turn-agent',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-agent',
            text: '请在这个工作区更新 PRD。',
            authorId: 'agent-research',
            author: {
              type: 'agent',
              id: 'agent-research',
              name: 'Research Agent',
              avatarUrl: '/avatars/research-agent.png',
            },
          },
          entries: [],
        },
      ]}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
      onEditMessage={() => undefined}
      onDeleteMessage={() => undefined}
      onReviseTurn={() => undefined}
    />,
  )

  assert.match(html, /Research Agent/)
  assert.match(html, />RA</)
  assert.doesNotMatch(html, /Demo User/)
  assert.doesNotMatch(html, /编辑消息|删除消息|改写并分叉/)
})

test('TaskChatFeed repairs the legacy first queued prompt identity for an Agent-created workspace', () => {
  const html = renderToStaticMarkup(
    <TaskChatFeed
      scrollRef={{ current: null }}
      onScroll={() => undefined}
      bottomInset={0}
      currentUserId="user-owner"
      workspaceOwnerUserId="user-owner"
      workspaceCreatedBy={{
        type: 'agent',
        id: 'agent-ceo',
        name: 'CEO',
        avatarUrl: '/avatars/ceo.png',
      }}
      userLabel="Demo User"
      hasMoreBefore={false}
      isWorkspaceHistoryMode={true}
      loadingMoreBefore={false}
      onLoadOlderTranscriptPage={() => undefined}
      selectedAgentType="Codex"
      boundCustomAgentName=""
      boundCustomAgentMode=""
      mountedSkillNames={[]}
      mountedMcpServerNames={[]}
      notices={[]}
      systemLogs={[]}
      displayTimeline={[
        {
          id: 'task-chat-queue:run-legacy',
          isCurrent: false,
          user: {
            id: 'turn-legacy-user',
            ts: '2026-07-23T03:11:00.000Z',
            turnId: 'task-chat-queue:run-legacy',
            seq: 1,
            kind: 'user_message',
            messageId: 'user-legacy',
            text: '请在这个工作区更新 PRD。',
            authorId: 'user-owner',
          },
          entries: [],
        },
      ]}
      isSessionBusy={false}
      displayStep=""
      currentRunTiming={null}
      queueStatusMessage=""
      scrollShortcutTarget={null}
      onJumpToBottom={() => undefined}
      onJumpToTop={() => undefined}
      onEditMessage={() => undefined}
      onDeleteMessage={() => undefined}
      onReviseTurn={() => undefined}
    />,
  )

  assert.match(html, />CEO</)
  assert.doesNotMatch(html, /Demo User/)
  assert.doesNotMatch(html, /编辑消息|删除消息|改写并分叉/)
})
