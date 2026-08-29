// [INPUT]: 后台服务输入
// [OUTPUT]: 启停管理
// [POS]: server 后台服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { agentService } from '../integrations/agent/service'
import { automationService } from './automation-service'
import { startCommunityUsageReporter, stopCommunityUsageReporter } from './community-usage-reporter-service'
import { startEmbeddedEasyTierPublicNode, stopEmbeddedEasyTierPublicNode } from './easytier-public-node-service'
import { stopStorageChangeSync } from './storage-change-sync-service'
import { reconcileAgentEventInboxLinks, startAgentEventRuntime, stopAgentEventRuntime } from './agent-event-runtime'
import { startAgentHeartbeatScheduler, stopAgentHeartbeatScheduler } from './agent-heartbeat-scheduler'
import { cleanupAgentHeartbeats } from '../storage/postgres/agent-store'
import { reconcileWorkspaceSessionAgentAttentions } from './workspace-session-completion-notifier'
import { withPostgresLease } from '../storage/postgres/db'
import { startFeishuLongConnections, stopFeishuLongConnections } from '../integrations/feishu/long-connection-service'
import { processFeishuInboundEvent } from './feishu-inbound-service'
import { startWechatLongPolling, stopWechatLongPolling } from '../integrations/wechat-ilink/long-polling-service'
import { processWechatInboundMessage } from './wechat-inbound-service'
import { startDiscordGateways, stopDiscordGateways } from '../integrations/discord/gateway'
import { processDiscordInboundMessage } from './discord-inbound-service'
import { startSlackSockets, stopSlackSockets } from '../integrations/slack/socket-mode'
import { processSlackInboundMessage } from './slack-inbound-service'
import { startDingtalkStreams, stopDingtalkStreams } from '../integrations/dingtalk/stream'
import { processDingtalkInboundMessage } from './dingtalk-inbound-service'
import { releaseExpiredInboxSnoozes } from './inbox-service'
import { scanFeedbackEscalations } from './feedback-escalation-service'
import { loadState } from '../storage/app-state-store'
import { getManagedCloudGate } from './gate/managed-cloud-gate'
import { enterpriseBackgroundServices } from '../extension-registry'

const startManagedCloudStartupReconcile = () => {
  void (async () => {
    try {
      const state = loadState()
      await getManagedCloudGate().reconcileExecutors(state.config)
    } catch (error) {
      console.warn('[managed-cloud] startup reconcile failed:', error instanceof Error ? error.message : error)
    }
  })()
}

export const startServerBackgroundServices = () => {
  startAgentHeartbeatScheduler()
  startHeartbeatRetentionCleanup()
  startManagedCloudStartupReconcile()
  startAgentEventRuntime()
  startAgentInboxReconciliation()
  startInboxSnoozeScheduler()
  startFeedbackEscalationScheduler()
  startWorkspaceAttentionReconciliation()
  startFeishuLongConnections(async ({ agentId, event }) => {
    await processFeishuInboundEvent({ agentId, event })
  })
  startWechatLongPolling(async ({ agentId, message }) => {
    await processWechatInboundMessage({ agentId, message })
  })
  startDiscordGateways(async ({ agentId, event }) => {
    await processDiscordInboundMessage({ agentId, event })
  })
  startSlackSockets(async ({ agentId, event }) => {
    await processSlackInboundMessage({ agentId, event })
  })
  startDingtalkStreams(async ({ agentId, message, text }) => {
    await processDingtalkInboundMessage({ agentId, message, text })
  })
  automationService.startScheduler()
  startEmbeddedEasyTierPublicNode()
  startCommunityUsageReporter()
  for (const service of enterpriseBackgroundServices) {
    void service.start()
  }
}

export const stopServerBackgroundServices = async () => {
  stopAgentHeartbeatScheduler()
  stopHeartbeatRetentionCleanup()
  stopAgentEventRuntime()
  stopAgentInboxReconciliation()
  stopInboxSnoozeScheduler()
  stopFeedbackEscalationScheduler()
  stopWorkspaceAttentionReconciliation()
  stopFeishuLongConnections()
  stopWechatLongPolling()
  stopDiscordGateways()
  stopSlackSockets()
  stopDingtalkStreams()
  automationService.stopScheduler()
  stopCommunityUsageReporter()
  stopEmbeddedEasyTierPublicNode()
  for (const service of enterpriseBackgroundServices) {
    await service.stop()
  }
  await stopStorageChangeSync()
}

let heartbeatRetentionTimer: NodeJS.Timeout | null = null

/** agent_heartbeats 保留策略清理：每天一次 + Postgres lease 单跑（表无限增长防复发）。 */
const runHeartbeatRetentionCleanup = () => withPostgresLease(
  'vibemux:cleanup:agent-heartbeats',
  () => cleanupAgentHeartbeats(),
).then((lease) => {
  if (lease.acquired && (lease.value.removedPerAgent > 0 || lease.value.removedByAge > 0)) {
    console.log('[agent-heartbeat] retention cleanup', JSON.stringify(lease.value))
  }
}).catch((error) => console.error('[agent-heartbeat] retention cleanup failed', error))

const startHeartbeatRetentionCleanup = () => {
  if (heartbeatRetentionTimer) return
  heartbeatRetentionTimer = setInterval(() => void runHeartbeatRetentionCleanup(), 24 * 60 * 60 * 1000)
}

const stopHeartbeatRetentionCleanup = () => {
  if (heartbeatRetentionTimer) clearInterval(heartbeatRetentionTimer)
  heartbeatRetentionTimer = null
}

let agentInboxReconciliationTimer: NodeJS.Timeout | null = null

const runAgentInboxReconciliation = () => withPostgresLease(
  'vibemux:reconcile:agent-inbox',
  () => reconcileAgentEventInboxLinks(),
).catch((error) => console.error('[agent-inbox-reconciliation] failed', error))

const startAgentInboxReconciliation = () => {
  if (agentInboxReconciliationTimer) return
  void runAgentInboxReconciliation()
  agentInboxReconciliationTimer = setInterval(() => void runAgentInboxReconciliation(), 60_000)
}

const stopAgentInboxReconciliation = () => {
  if (agentInboxReconciliationTimer) clearInterval(agentInboxReconciliationTimer)
  agentInboxReconciliationTimer = null
}

let inboxSnoozeTimer: NodeJS.Timeout | null = null

const runInboxSnoozeRelease = () => withPostgresLease(
  'vibemux:inbox:snooze-release',
  () => releaseExpiredInboxSnoozes(),
).catch((error) => console.error('[inbox-snooze-release] failed', error))

const startInboxSnoozeScheduler = () => {
  if (inboxSnoozeTimer) return
  void runInboxSnoozeRelease()
  inboxSnoozeTimer = setInterval(() => void runInboxSnoozeRelease(), 15_000)
}

const stopInboxSnoozeScheduler = () => {
  if (inboxSnoozeTimer) clearInterval(inboxSnoozeTimer)
  inboxSnoozeTimer = null
}

let feedbackEscalationTimer: NodeJS.Timeout | null = null

const runFeedbackEscalation = () => withPostgresLease(
  'vibemux:feedback:escalation',
  () => scanFeedbackEscalations(),
).catch((error) => console.error('[feedback-escalation] failed', error))

const startFeedbackEscalationScheduler = () => {
  if (feedbackEscalationTimer) return
  void runFeedbackEscalation()
  feedbackEscalationTimer = setInterval(() => void runFeedbackEscalation(), 60_000)
}

const stopFeedbackEscalationScheduler = () => {
  if (feedbackEscalationTimer) clearInterval(feedbackEscalationTimer)
  feedbackEscalationTimer = null
}

let workspaceAttentionTimer: NodeJS.Timeout | null = null

const startWorkspaceAttentionReconciliation = () => {
  if (workspaceAttentionTimer) return
  void withPostgresLease(
    'vibemux:reconcile:workspace-attentions',
    () => reconcileWorkspaceSessionAgentAttentions(),
  ).catch((error) => console.error('[workspace-attention-reconciliation] failed', error))
  workspaceAttentionTimer = setInterval(() => {
    void withPostgresLease(
      'vibemux:reconcile:workspace-attentions',
      () => reconcileWorkspaceSessionAgentAttentions(),
    ).catch((error) => console.error('[workspace-attention-reconciliation] failed', error))
  }, 60_000)
}

const stopWorkspaceAttentionReconciliation = () => {
  if (workspaceAttentionTimer) clearInterval(workspaceAttentionTimer)
  workspaceAttentionTimer = null
}
