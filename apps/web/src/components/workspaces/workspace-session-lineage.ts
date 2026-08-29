import type { WorkspaceSession } from '@shared/types'

export type WorkspaceSessionLineageSummary = {
  badgeLabel: string
  description: string
}

export const resolveWorkspaceSessionLineageSummary = (
  session: Pick<
    WorkspaceSession,
    'sessionOrigin' | 'forkMode' | 'forkedFromSessionId' | 'forkRevision'
  >,
  workspaceSessions: Pick<WorkspaceSession, 'id' | 'title'>[],
): WorkspaceSessionLineageSummary | null => {
  if (session.sessionOrigin !== 'fork') {
    return null
  }

  const sourceSessionTitle = workspaceSessions.find((item) => item.id === session.forkedFromSessionId)?.title?.trim() || '较早会话'

  if (session.forkRevision?.kind === 'rewrite-user-turn') {
    return {
      badgeLabel: '改写分叉',
      description: `来源会话「${sourceSessionTitle}」的较早用户回合`,
    }
  }

  if (session.forkRevision?.kind === 'retry-assistant-turn') {
    return {
      badgeLabel: '重试分叉',
      description: `来源会话「${sourceSessionTitle}」的较早助手回复`,
    }
  }

  return {
    badgeLabel: session.forkMode === 'worktree' ? '历史分叉' : '本地分叉',
    description: `来源会话「${sourceSessionTitle}」的较早消息`,
  }
}
