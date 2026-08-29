/**
 * [INPUT]: A claimed Agent event plus current server-owned task, workspace, and execution state.
 * [OUTPUT]: A bounded context capsule with authoritative references, snapshots, and run deltas.
 * [POS]: Claim-time context compiler for Agent Attention; it does not prescribe the next action.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { TaskExecutionResult } from '@shared/types'
import { getAgentTask } from '../repositories/agent'
import { getTaskRun, loadState } from '../storage/app-state-store'
import { getDistributedTask, getWorkspace } from '../storage/distributed-task-store'

type AgentAttentionEvent = {
  scope: Record<string, string>
  payload: Record<string, unknown>
  resumesEventId?: string
}

const readString = (value: unknown) => typeof value === 'string' && value.trim()
  ? value.trim()
  : undefined

const summarizeExecutionResult = (result?: TaskExecutionResult | null) => result
  ? {
      status: result.status,
      summary: result.summary,
      filesChanged: result.filesChanged,
      changeSummary: result.changeSummary,
      commitShas: result.commitShas,
      remoteBranchName: result.remoteBranchName,
      delivery: result.delivery,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      durationSec: result.durationSec,
    }
  : null

export const buildAgentAttentionContextCapsule = (params: {
  agentId: string
  eventId: string
  eventType: string
  event: AgentAttentionEvent
}) => {
  const state = loadState()
  const distributedTaskId = params.event.scope.distributedTaskId
  const distributedTask = distributedTaskId
    ? getDistributedTask(distributedTaskId)
    : null
  const taskId = params.event.scope.taskId || distributedTask?.originTaskId
  const projectId = params.event.scope.projectId || distributedTask?.projectId
  const workspaceId = params.event.scope.workspaceId || distributedTask?.workspaceId
  const workspaceSessionId = params.event.scope.workspaceSessionId || distributedTask?.workspaceSessionId
  const taskRunId = params.event.scope.taskRunId || distributedTask?.originTaskRunId
  const task = taskId ? state.tasks.find((item) => item.id === taskId) ?? null : null
  const project = projectId ? state.projects.find((item) => item.id === projectId) ?? null : null
  const workspace = workspaceId ? getWorkspace(workspaceId) : null
  const workspaceSession = workspaceSessionId
    ? state.workspaceSessions.find((item) => item.id === workspaceSessionId) ?? null
    : null
  const taskRun = taskRunId ? getTaskRun(taskRunId) : null
  const sourceAgentEventId = (
    readString(params.event.payload.sourceAgentEventId)
    || distributedTask?.sourceAgentEventId
    || params.event.resumesEventId
  )
  const sourceAgentEvent = sourceAgentEventId ? getAgentTask(sourceAgentEventId) : null
  const result = distributedTask?.result ?? taskRun?.result ?? null
  const sourceCheckpointAt = (
    sourceAgentEvent?.completedAt
    || sourceAgentEvent?.startedAt
    || sourceAgentEvent?.createdAt
  )

  return {
    reason: {
      eventId: params.eventId,
      eventType: params.eventType,
      agentId: params.agentId,
      sourceAgentEventId,
      resumesEventId: params.event.resumesEventId,
    },
    references: {
      taskId,
      projectId,
      workspaceId,
      workspaceSessionId,
      taskRunId,
      distributedTaskId,
    },
    task: task
      ? {
          id: task.id,
          title: task.title,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
          status: task.status,
          assigneeId: task.assigneeId,
          assigneeAgentId: task.assigneeAgentId,
          updatedAt: task.updatedAt,
        }
      : null,
    project: project
      ? {
          id: project.id,
          name: project.name,
          versionControl: project.versionControl,
          gitUrl: project.gitUrl,
          defaultBranch: project.defaultBranch,
          updatedAt: project.updatedAt,
        }
      : null,
    workspace: workspace
      ? {
          id: workspace.id,
          name: workspace.name,
          status: workspace.status,
          executorNodeId: workspace.executorNodeId,
          codeBranchName: workspace.codeBranchName,
          codeRemoteHeadSha: workspace.codeRemoteHeadSha,
          codeSyncedAt: workspace.codeSyncedAt,
          updatedAt: workspace.updatedAt,
        }
      : null,
    workspaceSession: workspaceSession
      ? {
          id: workspaceSession.id,
          title: workspaceSession.title,
          status: workspaceSession.status,
          agentRunningStatus: workspaceSession.agentRunningStatus,
          runtimeStatus: workspaceSession.runtimeStatus,
          runtimeSequence: workspaceSession.runtimeSequence,
          currentStep: workspaceSession.currentStep,
          needsHumanConfirm: workspaceSession.needsHumanConfirm,
          terminalReason: workspaceSession.terminalReason,
          runtimeSummary: workspaceSession.runtimeSummary,
          deliverySummary: workspaceSession.deliverySummary,
          historyProjection: workspaceSession.historyProjection,
          lastActiveAt: workspaceSession.lastActiveAt,
          updatedAt: workspaceSession.updatedAt,
        }
      : null,
    execution: distributedTask
      ? {
          id: distributedTask.id,
          status: distributedTask.status,
          requestedByUserId: distributedTask.requestedByUserId,
          requestedByAgentId: distributedTask.requestedByAgentId,
          sourceAgentEventId: distributedTask.sourceAgentEventId,
          errorMessage: distributedTask.errorMessage,
          startedAt: distributedTask.startedAt,
          completedAt: distributedTask.completedAt,
          updatedAt: distributedTask.updatedAt,
          result: summarizeExecutionResult(result),
        }
      : taskRun
        ? {
            id: taskRun.id,
            status: taskRun.status,
            startedAt: taskRun.result?.startedAt,
            completedAt: taskRun.result?.completedAt,
            updatedAt: taskRun.updatedAt,
            result: summarizeExecutionResult(result),
          }
        : null,
    deltaSinceSource: {
      checkpointAt: sourceCheckpointAt,
      taskUpdatedAt: task?.updatedAt,
      workspaceUpdatedAt: workspace?.updatedAt,
      workspaceSessionUpdatedAt: workspaceSession?.updatedAt,
      executionUpdatedAt: distributedTask?.updatedAt ?? taskRun?.updatedAt,
      result: summarizeExecutionResult(result),
    },
    sourceEvent: sourceAgentEvent
      ? {
          id: sourceAgentEvent.id,
          type: sourceAgentEvent.type,
          status: sourceAgentEvent.status,
          startedAt: sourceAgentEvent.startedAt,
          completedAt: sourceAgentEvent.completedAt,
          createdAt: sourceAgentEvent.createdAt,
        }
      : null,
    pendingQuestion: workspaceSession?.needsHumanConfirm
      ? workspaceSession.currentStep || workspaceSession.terminalReason || '工作区会话需要输入或确认。'
      : null,
  }
}
