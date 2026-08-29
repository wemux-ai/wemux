// [INPUT]: Shared project, task, run, binding, and workspace-session records.
// [OUTPUT]: Durable Drizzle writes, including task creator identity snapshots.
// [POS]: Write-side persistence boundary for the server core app-state store.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { and, eq, sql } from 'drizzle-orm'

import { deriveProjectColor, normalizeHexColor } from '@shared/project-color'
import { sanitizeToolCallsForPersistence } from '@shared/tool-call-persistence'
import type { Project, ProjectCommandPreset, Task, TaskRun, TaskWorkspaceBinding, WorkspaceSession } from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb, withDrizzleTransaction } from './drizzle-db'
import {
  executionLogs,
  projects,
  taskCollaboration,
  taskRuns,
  tasks,
  taskWorkspaceBindings,
  workspaceSessions,
} from './schema'

export const persistProject = async (project: Project) => {
  await ensurePostgresReady()
  const values = {
    id: project.id,
    name: project.name,
    displayOrder: project.displayOrder ?? null,
    color: normalizeHexColor(project.color) ?? deriveProjectColor(project.name),
    workspaceId: project.workspaceId ?? null,
    visibility: project.visibility ?? ('private' as const),
    gitUrl: project.gitUrl,
    localPath: project.rootPath?.trim() || '',
    versionControl: project.versionControl ?? (project.gitUrl.trim() ? ('git-remote' as const) : ('none' as const)),
    defaultBranch: project.defaultBranch ?? 'main',
    preferredExecutorId: project.preferredExecutorId ?? null,
    repositoryCloneStatus: project.repositoryCloneStatus ?? null,
    repositoryCloneMessage: project.repositoryCloneMessage?.trim() || null,
    commandPresetsJson: [] as ProjectCommandPreset[],
    defaultCommandPresetId: null as string | null,
    environmentTemplateJson: project.environmentTemplate ?? null,
    recentBaseBranchesJson: project.recentBaseBranches ?? [],
    createdBy: project.createdById ?? null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }

  await getDrizzleDb()
    .insert(projects)
    .values({
      ...values,
      commandPresetsJson: [],
    })
    .onConflictDoUpdate({
      target: projects.id,
      setWhere: sql`${projects.updatedAt} <= excluded.updated_at`,
      set: {
        name: values.name,
        displayOrder: values.displayOrder,
        color: values.color,
        workspaceId: values.workspaceId,
        visibility: values.visibility,
        gitUrl: values.gitUrl,
        localPath: values.localPath,
        versionControl: values.versionControl,
        defaultBranch: values.defaultBranch,
        preferredExecutorId: values.preferredExecutorId,
        repositoryCloneStatus: values.repositoryCloneStatus,
        repositoryCloneMessage: values.repositoryCloneMessage,
        commandPresetsJson: [],
        defaultCommandPresetId: null,
        environmentTemplateJson: values.environmentTemplateJson,
        recentBaseBranchesJson: values.recentBaseBranchesJson,
        createdBy: values.createdBy,
        updatedAt: values.updatedAt,
      },
    })
}

export const persistTask = async (task: Task) => {
  await withDrizzleTransaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`task:${task.id}`}))`)
    const currentRows = await tx
      .select({ updatedAt: tasks.updatedAt })
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .limit(1)
    if (currentRows[0] && currentRows[0].updatedAt > task.updatedAt) {
      return
    }

    await tx
      .insert(tasks)
      .values({
        id: task.id,
        projectId: task.projectId,
        parentTaskId: task.parentTaskId ?? null,
        creatorJson: task.createdBy ?? null,
        originType: task.originType ?? null,
        originId: task.originId ?? null,
        title: task.title,
        description: task.description,
        assigneeId: task.assigneeId ?? null,
        assigneeAgentId: task.assigneeAgentId ?? null,
        assigneeAgentGroupId: task.assigneeAgentGroupId ?? null,
        status: task.status,
        agentType: task.agentType,
        executionModel: task.executionModel ?? null,
        opencodeConfigJson: task.opencodeConfig ?? null,
        executionMode: task.executionMode,
        agentManaged: task.agentManaged,
        priority: task.priority,
        retryCount: task.retryCount,
        createdAt: task.createdAt,
        startedAt: task.startedAt ?? null,
        dueAt: task.dueAt ?? null,
        updatedAt: task.updatedAt,
        baseBranch: task.baseBranch ?? 'main',
        acceptanceCriteria: task.acceptanceCriteria ?? null,
        draftId: task.draftId ?? null,
        draftSavedAt: task.draftSavedAt ?? null,
        recommendedTitle: task.recommendedTitle ?? null,
        commandPresetId: null,
        baseBranchHint: task.baseBranchHint ?? null,
        autoReviewJson: null,
        requirementType: task.requirementType ?? 'task',
        needsHumanConfirm: task.needsHumanConfirm,
        agentRunningStatus: task.agentRunningStatus,
        currentStep: task.currentStep,
        attachmentsJson: task.attachments ?? [],
        reactionsJson: task.reactions ?? [],
        completedAt: task.completedAt ?? null,
      })
      .onConflictDoUpdate({
        target: tasks.id,
        setWhere: sql`${tasks.updatedAt} <= excluded.updated_at`,
        set: {
          projectId: task.projectId,
          parentTaskId: task.parentTaskId ?? null,
          creatorJson: task.createdBy ?? null,
          originType: task.originType ?? null,
          originId: task.originId ?? null,
          title: task.title,
          description: task.description,
          assigneeId: task.assigneeId ?? null,
          assigneeAgentId: task.assigneeAgentId ?? null,
          assigneeAgentGroupId: task.assigneeAgentGroupId ?? null,
          status: task.status,
          agentType: task.agentType,
          executionModel: task.executionModel ?? null,
          opencodeConfigJson: task.opencodeConfig ?? null,
          executionMode: task.executionMode,
          agentManaged: task.agentManaged,
          priority: task.priority,
          retryCount: task.retryCount,
          startedAt: task.startedAt ?? null,
          dueAt: task.dueAt ?? null,
          updatedAt: task.updatedAt,
          baseBranch: task.baseBranch ?? 'main',
          acceptanceCriteria: task.acceptanceCriteria ?? null,
          draftId: task.draftId ?? null,
          draftSavedAt: task.draftSavedAt ?? null,
          recommendedTitle: task.recommendedTitle ?? null,
          commandPresetId: null,
          baseBranchHint: task.baseBranchHint ?? null,
          autoReviewJson: null,
          requirementType: task.requirementType ?? 'task',
          needsHumanConfirm: task.needsHumanConfirm,
          agentRunningStatus: task.agentRunningStatus,
          currentStep: task.currentStep,
          attachmentsJson: task.attachments ?? [],
          reactionsJson: task.reactions ?? [],
          completedAt: task.completedAt ?? null,
        },
      })

    await tx
      .insert(taskCollaboration)
      .values({
        taskId: task.id,
        commentsJson: task.comments,
        subscriberIdsJson: task.subscriberIds ?? [],
        toolCallsJson: sanitizeToolCallsForPersistence(task.toolCalls ?? []),
        historyJson: task.history,
        orchestrationJson: task.orchestration,
        validationChecksJson: task.validationChecks,
        updatedAt: task.updatedAt,
      })
      .onConflictDoUpdate({
        target: taskCollaboration.taskId,
        setWhere: sql`${taskCollaboration.updatedAt} <= excluded.updated_at`,
        set: {
          commentsJson: task.comments,
          subscriberIdsJson: task.subscriberIds ?? [],
          toolCallsJson: sanitizeToolCallsForPersistence(task.toolCalls ?? []),
          historyJson: task.history,
          orchestrationJson: task.orchestration,
          validationChecksJson: task.validationChecks,
          updatedAt: task.updatedAt,
        },
      })

    await tx.delete(executionLogs).where(eq(executionLogs.taskId, task.id))

    for (const log of task.logs) {
      await tx
        .insert(executionLogs)
        .values({
          id: log.id,
          taskId: task.id,
          role: log.role,
          content: log.content,
          workspaceId: log.workspaceId ?? null,
          workspaceSessionId: log.workspaceSessionId ?? null,
          createdAt: log.createdAt,
        })
        .onConflictDoUpdate({
          target: executionLogs.id,
          set: {
            role: log.role,
            content: log.content,
            workspaceId: log.workspaceId ?? null,
            workspaceSessionId: log.workspaceSessionId ?? null,
            createdAt: log.createdAt,
          },
        })
    }
  })
}

export const persistTaskRun = async (taskRun: TaskRun) => {
  await ensurePostgresReady()
  const resultJson = taskRun.result
    ? {
        ...taskRun.result,
        agentSessionId: taskRun.result.agentSessionId ?? taskRun.result.opencodeSessionId,
        opencodeSessionId: taskRun.result.opencodeSessionId ?? taskRun.result.agentSessionId,
      }
    : null

  await getDrizzleDb()
    .insert(taskRuns)
    .values({
      id: taskRun.id,
      taskId: taskRun.taskId,
      projectId: taskRun.projectId,
      distributedTaskId: taskRun.distributedTaskId ?? null,
      workspaceId: taskRun.workspaceId ?? null,
      workspaceSessionId: taskRun.workspaceSessionId ?? null,
      executorNodeId: taskRun.executorNodeId ?? null,
      baseBranch: taskRun.baseBranch ?? null,
      returnMode: taskRun.returnMode ?? null,
      gitIdentityMode: taskRun.gitIdentityMode ?? null,
      agentSessionId: taskRun.agentSessionId ?? taskRun.opencodeSessionId ?? null,
      executionModel: taskRun.executionModel ?? null,
      usageJson: taskRun.usage ?? null,
      status: taskRun.status,
      summary: taskRun.summary ?? null,
      resultJson,
      createdAt: taskRun.createdAt,
      updatedAt: taskRun.updatedAt,
    })
    .onConflictDoUpdate({
      target: taskRuns.id,
      setWhere: sql`${taskRuns.updatedAt} <= excluded.updated_at`,
      set: {
        distributedTaskId: taskRun.distributedTaskId ?? null,
        workspaceId: taskRun.workspaceId ?? null,
        workspaceSessionId: taskRun.workspaceSessionId ?? null,
        executorNodeId: taskRun.executorNodeId ?? null,
        baseBranch: taskRun.baseBranch ?? null,
        returnMode: taskRun.returnMode ?? null,
        gitIdentityMode: taskRun.gitIdentityMode ?? null,
        agentSessionId: taskRun.agentSessionId ?? taskRun.opencodeSessionId ?? null,
        executionModel: taskRun.executionModel ?? null,
        usageJson: taskRun.usage ?? null,
        status: taskRun.status,
        summary: taskRun.summary ?? null,
        resultJson,
        updatedAt: taskRun.updatedAt,
      },
    })
}

export const persistTaskWorkspaceBinding = async (binding: TaskWorkspaceBinding) => {
  await ensurePostgresReady()
  const existingPair = await getDrizzleDb()
    .select({ id: taskWorkspaceBindings.id })
    .from(taskWorkspaceBindings)
    .where(and(
      eq(taskWorkspaceBindings.taskId, binding.taskId),
      eq(taskWorkspaceBindings.workspaceId, binding.workspaceId),
    ))
    .limit(1)

  if (existingPair[0]) {
    await getDrizzleDb()
      .update(taskWorkspaceBindings)
      .set({
        status: binding.status,
        updatedAt: binding.updatedAt,
      })
      .where(and(
        eq(taskWorkspaceBindings.id, existingPair[0].id),
        sql`${taskWorkspaceBindings.updatedAt} <= ${binding.updatedAt}`,
      ))
    return
  }

  await getDrizzleDb()
    .insert(taskWorkspaceBindings)
    .values({
      id: binding.id,
      taskId: binding.taskId,
      workspaceId: binding.workspaceId,
      status: binding.status,
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt,
    })
    .onConflictDoUpdate({
      target: taskWorkspaceBindings.id,
      setWhere: sql`${taskWorkspaceBindings.updatedAt} <= excluded.updated_at`,
      set: {
        taskId: binding.taskId,
        workspaceId: binding.workspaceId,
        status: binding.status,
        createdAt: binding.createdAt,
        updatedAt: binding.updatedAt,
      },
    })
}

export const persistWorkspaceSession = async (session: WorkspaceSession) => {
  await ensurePostgresReady()
  const values = {
    id: session.id,
    workspaceId: session.workspaceId,
    displayOrder: session.displayOrder ?? null,
    pinnedAt: session.pinnedAt ?? null,
    title: session.title,
    titleOrigin: session.titleOrigin,
    status: session.status,
    sessionKind: session.sessionKind,
    sessionRole: session.sessionRole,
    sessionOrigin: session.sessionOrigin,
    parentSessionId: session.parentSessionId ?? null,
    rootSessionId: session.rootSessionId ?? session.parentSessionId ?? session.id,
    forkMode: session.forkMode ?? null,
    forkedFromSessionId: session.forkedFromSessionId ?? null,
    forkedFromMessageId: session.forkedFromMessageId ?? null,
    forkRevisionJson: session.forkRevision ?? null,
    pendingRevisionJson: session.pendingRevision ?? null,
    sharedWorktreeSourceSessionId: session.sharedWorktreeSourceSessionId ?? null,
    executorNodeId: session.executorNodeId ?? null,
    agentType: session.agentType ?? null,
    customAgentId: session.customAgentId ?? null,
    customAgentName: session.customAgentName ?? null,
    agentInvocationMode: session.agentInvocationMode ?? null,
    mountedSkillNamesJson: session.mountedSkillNames ?? [],
    mountedMcpServerNamesJson: session.mountedMcpServerNames ?? [],
    enabledMcpServerIdsJson: Array.isArray(session.enabledMcpServerIds) ? session.enabledMcpServerIds : null,
    delegatedPrompt: session.delegatedPrompt ?? null,
    executionModel: session.executionModel ?? null,
    agentSettingsJson: session.agentSettings ?? null,
    opencodeConfigJson: session.opencodeConfig ?? null,
    gitIdentityMode: session.gitIdentityMode ?? null,
    publishPolicy: session.publishPolicy ?? ('pull-request' as const),
    gitAuthPreference: session.gitAuthPreference ?? ('project-default' as const),
    distributedTaskId: session.distributedTaskId ?? null,
    agentSessionId: session.agentSessionId ?? session.opencodeSessionId ?? null,
    runtimeContinuationsJson: session.runtimeContinuations ?? [],
    handoffSnapshotJson: session.handoffSnapshot ?? null,
    baseBranch: session.baseBranch ?? null,
    worktreeId: session.worktreeId,
    worktreeUniqueId: session.worktreeUniqueId ?? null,
    branchName: session.branchName,
    worktreeStatus: session.worktreeStatus,
    workingDirectoryMode: session.workingDirectoryMode,
    needsHumanConfirm: session.needsHumanConfirm,
    agentRunningStatus: session.agentRunningStatus,
    runtimeStatus: session.runtimeStatus,
    runtimeSessionId: session.runtimeSessionId ?? null,
    runtimeOwnerExecutorId: session.runtimeOwnerExecutorId ?? null,
    runtimeStartedAt: session.runtimeStartedAt ?? null,
    lastHeartbeatAt: session.lastHeartbeatAt ?? null,
    lastRuntimeEventAt: session.lastRuntimeEventAt ?? null,
    terminalReason: session.terminalReason ?? null,
    runtimeSummaryJson: session.runtimeSummary ?? null,
    deliverySummaryJson: session.deliverySummary ?? null,
    runtimeSequence: session.runtimeSequence,
    currentStep: session.currentStep,
    lastActiveAt: session.lastActiveAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }

  await getDrizzleDb()
    .insert(workspaceSessions)
    .values(values)
    .onConflictDoUpdate({
      target: workspaceSessions.id,
      setWhere: sql`${workspaceSessions.updatedAt} <= excluded.updated_at`,
      set: {
        workspaceId: values.workspaceId,
        displayOrder: values.displayOrder,
        pinnedAt: values.pinnedAt,
        title: values.title,
        titleOrigin: values.titleOrigin,
        status: values.status,
        sessionKind: values.sessionKind,
        sessionRole: values.sessionRole,
        sessionOrigin: values.sessionOrigin,
        parentSessionId: values.parentSessionId,
        rootSessionId: values.rootSessionId,
        forkMode: values.forkMode,
        forkedFromSessionId: values.forkedFromSessionId,
        forkedFromMessageId: values.forkedFromMessageId,
        forkRevisionJson: values.forkRevisionJson,
        pendingRevisionJson: values.pendingRevisionJson,
        sharedWorktreeSourceSessionId: values.sharedWorktreeSourceSessionId,
        executorNodeId: values.executorNodeId,
        agentType: values.agentType,
        customAgentId: values.customAgentId,
        customAgentName: values.customAgentName,
        agentInvocationMode: values.agentInvocationMode,
        mountedSkillNamesJson: values.mountedSkillNamesJson,
        mountedMcpServerNamesJson: values.mountedMcpServerNamesJson,
        enabledMcpServerIdsJson: values.enabledMcpServerIdsJson,
        delegatedPrompt: values.delegatedPrompt,
        executionModel: values.executionModel,
        agentSettingsJson: values.agentSettingsJson,
        opencodeConfigJson: values.opencodeConfigJson,
        gitIdentityMode: values.gitIdentityMode,
        publishPolicy: values.publishPolicy,
        gitAuthPreference: values.gitAuthPreference,
        distributedTaskId: values.distributedTaskId,
        agentSessionId: values.agentSessionId,
        runtimeContinuationsJson: values.runtimeContinuationsJson,
        handoffSnapshotJson: values.handoffSnapshotJson,
        baseBranch: values.baseBranch,
        worktreeId: values.worktreeId,
        worktreeUniqueId: values.worktreeUniqueId,
        branchName: values.branchName,
        worktreeStatus: values.worktreeStatus,
        workingDirectoryMode: values.workingDirectoryMode,
        needsHumanConfirm: values.needsHumanConfirm,
        agentRunningStatus: values.agentRunningStatus,
        runtimeStatus: values.runtimeStatus,
        runtimeSessionId: values.runtimeSessionId,
        runtimeOwnerExecutorId: values.runtimeOwnerExecutorId,
        runtimeStartedAt: values.runtimeStartedAt,
        lastHeartbeatAt: values.lastHeartbeatAt,
        lastRuntimeEventAt: values.lastRuntimeEventAt,
        terminalReason: values.terminalReason,
        runtimeSummaryJson: values.runtimeSummaryJson,
        deliverySummaryJson: values.deliverySummaryJson,
        runtimeSequence: values.runtimeSequence,
        currentStep: values.currentStep,
        lastActiveAt: values.lastActiveAt,
        updatedAt: values.updatedAt,
      },
    })
}
