/**
 * [INPUT]: Primary database readiness plus every persisted control-plane repository bootstrap.
 * [OUTPUT]: Fully initialized server caches, including AgentTaskRun history, before background services start.
 * [POS]: Ordered storage bootstrap coordinator; it owns initialization order, not repository business logic.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { getPrimaryDatabaseMode, getPrimaryDatabaseStatus } from '../storage/primary/service'
import { getAllAgents, provisionInitialUserAgents } from '../storage/postgres/agent-store'
import { initAgentTaskRunStore } from '../storage/postgres/agent-task-run-store'
import { initAgentStore } from '../storage/postgres/agent-store'
import { initAutomationStore } from '../storage/postgres/automation-store'
import { getAllUsers, initAuthStore } from '../storage/postgres/auth-store'
import { initAppStateStore } from '../storage/postgres/app-state-store'
import { startMainChatRetentionSchedule } from '../storage/postgres/thread-message-store'
import { startDriveLifecycleSchedule } from './drive-lifecycle-service'
import { enterpriseStoreInitializers } from '../extension-registry'
import { initConversationStore } from '../storage/postgres/conversation-store'
import { initDistributedTaskStore } from '../storage/postgres/distributed-task-store'
import { initExecutorStore } from '../storage/postgres/executor-store'
import { initGovernanceStore } from '../storage/postgres/governance-store'
import { ensurePostgresReady } from '../storage/postgres/db'
import { initModelProfileStore } from '../storage/postgres/model-profile-store'
import { initRuntimeEnvironmentStore } from '../storage/postgres/runtime-environment-store'
import { initSkillStore } from '../storage/postgres/skill-store'
import { initTelegramStore } from '../storage/postgres/telegram-store'
import { initTaskChatQueueStore } from '../storage/postgres/task-chat-queue-store'
import { initWorkspaceSessionHistoryStore } from '../storage/postgres/workspace-session-history-store'
import { initWorkspaceShareStore } from '../storage/postgres/workspace-share-store'
import { loadState, saveTaskAndWait } from '../storage/app-state-store'
import { initBetterAuth } from './better-auth-service'
import { previewSessionService } from './preview-session-service'
import { startStorageChangeSync } from './storage-change-sync-service'
import { normalizeLegacyTaskCommentAuthors } from './task-comment-service'
import { migrateLegacyTaskChatQueuesFromMeta } from '../control-plane/task-chat-service'
import { recoverStaleTaskChatRuntimeAfterBootstrap } from './task-chat-runtime-recovery'

const migrateLegacyTaskCommentAuthors = async () => {
  const state = loadState()
  const agents = getAllAgents()
  const projectOwnerById = new Map(state.projects.map((project) => [project.id, project.createdById]))
  const changedTasks = state.tasks
    .map((task) => normalizeLegacyTaskCommentAuthors({
      task,
      agents,
      projectOwnerUserId: projectOwnerById.get(task.projectId),
    }))
    .filter((task, index) => task !== state.tasks[index])

  await Promise.all(changedTasks.map((task) => saveTaskAndWait(task)))
  if (changedTasks.length > 0) {
    console.log(`[storage] migrated legacy Agent comment authors in ${changedTasks.length} task(s)`)
  }
}

export const bootstrapStorage = async () => {
  const result = getPrimaryDatabaseStatus()
  if (!result.ready) {
    throw new Error(result.message)
  }

  await ensurePostgresReady()
  await initBetterAuth()
  await initAuthStore()
  for (const init of enterpriseStoreInitializers) {
    await init()
  }
  await initDistributedTaskStore()
  await initExecutorStore()
  await initAppStateStore()
  // 免费额度保留期（R8.3：消息 6 个月 + 附件 30 天回收站）需要周期性执行；只在启动时跑一次的话，
  // 长期运行的实例永远不会再触发裁剪。
  startMainChatRetentionSchedule()
  startDriveLifecycleSchedule()
  await initConversationStore()
  await initWorkspaceShareStore()
  await initGovernanceStore()
  await initTelegramStore()
  await initAgentStore()
  await provisionInitialUserAgents(getAllUsers().map((user) => user.id))
  await initAgentTaskRunStore()
  await migrateLegacyTaskCommentAuthors()
  await initAutomationStore()
  await initModelProfileStore()
  await initRuntimeEnvironmentStore()
  await initSkillStore()
  await initWorkspaceSessionHistoryStore()
  await initTaskChatQueueStore()
  await migrateLegacyTaskChatQueuesFromMeta()
  await previewSessionService.bootstrap()
  recoverStaleTaskChatRuntimeAfterBootstrap()
  await startStorageChangeSync()

  console.log(`[storage] primary=${getPrimaryDatabaseMode()} ${result.message}`)
}
