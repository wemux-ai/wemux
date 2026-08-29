import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Project, Task, Workspace, WorkspaceSession } from '@shared/types'
import { WorkspaceShell } from './workspace-shell'

test('renders a taskless workspace session through its runtime task view', () => {
  const project = {
    id: 'project-1',
    name: 'Project',
    gitUrl: 'https://example.com/project.git',
    defaultBranch: 'main',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  } as Project
  const workspace = {
    id: 'workspace-1',
    projectId: project.id,
    name: 'Workspace',
  } as Workspace
  const workspaceSession = {
    id: 'workspace-session-1',
    workspaceId: workspace.id,
    title: '默认会话',
    status: 'active',
  } as WorkspaceSession
  const runtimeTask = {
    id: 'workspace-session-runtime:workspace-session-1',
    projectId: project.id,
    title: workspaceSession.title,
  } as Task

  const html = renderToStaticMarkup(
    <WorkspaceShell
      project={project}
      workspace={workspace}
      displayTask={runtimeTask}
      workspaceSessions={[workspaceSession]}
      selectedWorkspaceSessionId={workspaceSession.id}
      workspaceSessionUnreadState={{
        sessionAttentionById: {},
        acknowledgedSessionAttentionById: {},
        manuallyUnreadSessionAttentionById: {},
      }}
      workspaceSessionListPlacement="side"
      activePrimaryView="chat"
      titleDraft={workspace.name}
      renameBusy={false}
      isEditingTitle={false}
      onTitleDraftChange={() => undefined}
      onStartEditTitle={() => undefined}
      onCancelEditTitle={() => undefined}
      onRenameWorkspace={() => undefined}
      onSelectWorkspaceSession={() => undefined}
      onPrimaryViewChange={() => undefined}
      chatContent={<div>taskless workspace chat ready</div>}
    />,
  )

  assert.match(html, /taskless workspace chat ready/)
  assert.doesNotMatch(html, /这个工作区还没有 AI 对话/)
})
