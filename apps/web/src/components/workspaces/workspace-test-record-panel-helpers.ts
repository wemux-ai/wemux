import type { TaskSubagentObservation, TestReportSnapshot } from '@shared/subagent-role'
import type { ConversationMessageRecord } from '../../lib/api'
import i18n, { getCurrentLanguage } from '../../lib/i18n'
import { formatDate } from '../../lib/utils'

export type TestRecordViewMode = 'latest' | 'all'

export type TestRunRecord = {
  id: string
  startedAt: string
  endedAt?: string
  title: string
  status: 'running' | 'completed' | 'failed'
  observations: TaskSubagentObservation[]
}

export type SubagentHandoffRecord = {
  messageId: string
  createdAt: string
  content: string
  childSessionId: string
  childTitle: string
  childRole: string
  status: 'completed' | 'failed'
}

export type TestReportSnapshotRecord = TestReportSnapshot & {
  messageId: string
}

export type StructuredReportSection = {
  key: 'passed' | 'failed' | 'blocked' | 'next'
  label: string
  items: string[]
}

const t = (key: string, defaultValue: string, options?: Record<string, unknown>) => {
  return i18n.t(key, {
    lng: getCurrentLanguage(),
    defaultValue,
    ...options,
  })
}

export const getObservationFromMessage = (message: ConversationMessageRecord) => {
  const observation = message.externalRef && typeof message.externalRef === 'object'
    ? (message.externalRef as { observation?: unknown }).observation
    : undefined

  return observation && typeof observation === 'object'
    ? observation as TaskSubagentObservation
    : null
}

export const getSubagentHandoffFromMessage = (message: ConversationMessageRecord) => {
  const handoff = message.externalRef && typeof message.externalRef === 'object'
    ? (message.externalRef as { subagentHandoff?: unknown }).subagentHandoff
    : undefined

  if (!handoff || typeof handoff !== 'object') {
    return null
  }

  const record = handoff as Record<string, unknown>
  const childSessionId = typeof record.childSessionId === 'string' ? record.childSessionId : ''
  if (!childSessionId) {
    return null
  }

  return {
    messageId: message.id,
    createdAt: message.createdAt,
    content: message.content,
    childSessionId,
    childTitle: typeof record.childTitle === 'string' ? record.childTitle : t('workspace.records.handoff.defaultTitle', '子会话'),
    childRole: typeof record.childRole === 'string' ? record.childRole : 'general',
    status: record.status === 'failed' ? 'failed' : 'completed',
  } satisfies SubagentHandoffRecord
}

const toStringArray = (value: unknown) => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export const getTestReportSnapshotFromMessage = (message: ConversationMessageRecord) => {
  const snapshot = message.externalRef && typeof message.externalRef === 'object'
    ? (message.externalRef as { testReportSnapshot?: unknown }).testReportSnapshot
    : undefined

  if (!snapshot || typeof snapshot !== 'object') {
    return null
  }

  const record = snapshot as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : ''
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : message.createdAt
  const workspaceSessionId = typeof record.workspaceSessionId === 'string' ? record.workspaceSessionId : ''
  const runStatus = record.runStatus === 'failed' || record.runStatus === 'running' ? record.runStatus : 'completed'
  const summary = typeof record.summary === 'string' ? record.summary : message.content
  if (!id || !workspaceSessionId) {
    return null
  }

  return {
    messageId: message.id,
    id,
    createdAt,
    workspaceSessionId,
    runId: typeof record.runId === 'string' ? record.runId : undefined,
    startedAt: typeof record.startedAt === 'string' ? record.startedAt : undefined,
    endedAt: typeof record.endedAt === 'string' ? record.endedAt : undefined,
    goal: typeof record.goal === 'string' ? record.goal : undefined,
    runStatus,
    summary,
    passed: toStringArray(record.passed),
    failed: toStringArray(record.failed),
    blocked: toStringArray(record.blocked),
    next: toStringArray(record.next),
    observationsCount: typeof record.observationsCount === 'number' ? record.observationsCount : 0,
    errorCount: typeof record.errorCount === 'number' ? record.errorCount : 0,
    warningCount: typeof record.warningCount === 'number' ? record.warningCount : 0,
    screenshotCount: typeof record.screenshotCount === 'number' ? record.screenshotCount : 0,
    branchName: typeof record.branchName === 'string' ? record.branchName : undefined,
    baseBranch: typeof record.baseBranch === 'string' ? record.baseBranch : undefined,
    commitSha: typeof record.commitSha === 'string' ? record.commitSha : undefined,
    commitShortSha: typeof record.commitShortSha === 'string' ? record.commitShortSha : undefined,
    commitTitle: typeof record.commitTitle === 'string' ? record.commitTitle : undefined,
    finalUrl: typeof record.finalUrl === 'string' ? record.finalUrl : undefined,
    sourceObservationIds: toStringArray(record.sourceObservationIds),
  } satisfies TestReportSnapshotRecord
}

export const normalizeTextPreview = (value: string, limit = 220) => {
  const compact = value
    .replace(/!\[[^\]]*\]\([^)]+\)/g, t('workspace.records.preview.image', '图片'))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`#>*_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!compact) {
    return t('workspace.records.preview.empty', '暂无摘要。')
  }

  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact
}

export const extractStructuredReport = (content: string): StructuredReportSection[] => {
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean)
  const sectionMap: StructuredReportSection[] = [
    { key: 'passed', label: t('workspace.records.reportSections.passed', '通过项'), items: [] },
    { key: 'failed', label: t('workspace.records.reportSections.failed', '失败项'), items: [] },
    { key: 'blocked', label: t('workspace.records.reportSections.blocked', '阻塞项'), items: [] },
    { key: 'next', label: t('workspace.records.reportSections.next', '建议'), items: [] },
  ]

  let currentSection: StructuredReportSection | null = null
  for (const line of lines) {
    const compact = line.replace(/^#+\s*/, '').replace(/[：:]\s*$/, '')
    if (/通过项|通过|已验证|pass/i.test(compact)) {
      currentSection = sectionMap[0]
      continue
    }
    if (/失败项|失败|异常|问题|fail/i.test(compact)) {
      currentSection = sectionMap[1]
      continue
    }
    if (/阻塞项|阻塞|block/i.test(compact)) {
      currentSection = sectionMap[2]
      continue
    }
    if (/下一步|建议|后续|next/i.test(compact)) {
      currentSection = sectionMap[3]
      continue
    }

    const item = line.replace(/^[-*•]\s*/, '').trim()
    if (!item) {
      continue
    }

    if (currentSection) {
      currentSection.items.push(item)
      continue
    }

    if (item.includes('通过') || item.includes('正常')) {
      sectionMap[0].items.push(item)
    } else if (item.includes('失败') || item.includes('报错') || item.includes('异常')) {
      sectionMap[1].items.push(item)
    } else if (item.includes('阻塞')) {
      sectionMap[2].items.push(item)
    } else {
      sectionMap[3].items.push(item)
    }
  }

  return sectionMap.filter((section) => section.items.length > 0)
}

export const buildReportCopyText = (params: {
  run: TestRunRecord | null
  latestProblem: TaskSubagentObservation | null
  latestReport: ConversationMessageRecord | null
  latestSnapshot: TestReportSnapshotRecord | null
}) => {
  const sections = [
    t('workspace.records.copy.resultHeader', '[测试结果]'),
    params.run
      ? t('workspace.records.copy.statusLine', '状态：{{value}}', {
        value: params.run.status === 'failed'
          ? t('workspace.records.status.failed', '异常')
          : params.run.status === 'completed'
            ? t('workspace.records.status.completed', '完成')
            : t('workspace.records.status.running', '进行中'),
      })
      : t('workspace.records.copy.statusEmpty', '状态：暂无记录'),
    params.run?.startedAt ? t('workspace.records.copy.startedAt', '开始时间：{{value}}', { value: formatDate(params.run.startedAt) }) : '',
    params.run?.endedAt ? t('workspace.records.copy.endedAt', '结束时间：{{value}}', { value: formatDate(params.run.endedAt) }) : '',
    '',
    t('workspace.records.copy.problemHeader', '[最近异常]'),
    params.latestProblem
      ? `${params.latestProblem.title}${params.latestProblem.detail ? `\n${params.latestProblem.detail}` : ''}`
      : t('workspace.records.copy.problemEmpty', '暂无异常'),
    '',
    t('workspace.records.copy.snapshotHeader', '[测试快照]'),
    params.latestSnapshot
      ? [
          params.latestSnapshot.summary,
          params.latestSnapshot.branchName ? t('workspace.records.copy.snapshotBranch', '分支：{{value}}', { value: params.latestSnapshot.branchName }) : '',
          params.latestSnapshot.commitShortSha
            ? t('workspace.records.copy.snapshotCommit', '提交：{{value}}', {
              value: `${params.latestSnapshot.commitShortSha}${params.latestSnapshot.commitTitle ? ` ${params.latestSnapshot.commitTitle}` : ''}`,
            })
            : '',
          params.latestSnapshot.finalUrl ? t('workspace.records.copy.snapshotFinalUrl', '最终页面：{{value}}', { value: params.latestSnapshot.finalUrl }) : '',
        ].filter(Boolean).join('\n')
      : t('workspace.records.copy.snapshotEmpty', '暂无快照'),
    '',
    t('workspace.records.copy.reportHeader', '[Tester 报告]'),
    params.latestReport?.content?.trim() || t('workspace.records.copy.reportEmpty', '暂无报告'),
  ].filter(Boolean)

  return sections.join('\n')
}

const isRunStart = (observation: TaskSubagentObservation) => {
  return observation.kind === 'action'
    && (
      observation.title.includes('开始浏览器巡检')
      || observation.title.toLowerCase().includes('start browser inspection')
    )
}

const isRunEnd = (observation: TaskSubagentObservation) => {
  return observation.kind === 'action'
    && (
      observation.title.includes('浏览器巡检完成')
      || observation.title.includes('浏览器巡检失败')
      || observation.title.toLowerCase().includes('browser inspection completed')
      || observation.title.toLowerCase().includes('browser inspection failed')
    )
}

const getRunStatus = (run: TestRunRecord): TestRunRecord['status'] => {
  if (run.observations.some((item) => item.level === 'error')) {
    return 'failed'
  }

  if (run.endedAt) {
    return 'completed'
  }

  return 'running'
}

export const buildRuns = (messages: ConversationMessageRecord[]) => {
  const observations = messages
    .map((message) => getObservationFromMessage(message))
    .filter(Boolean) as TaskSubagentObservation[]

  const runs: TestRunRecord[] = []
  let currentRun: TestRunRecord | null = null

  for (const observation of observations) {
    if (isRunStart(observation) || !currentRun) {
      if (currentRun) {
        currentRun.status = getRunStatus(currentRun)
        runs.push(currentRun)
      }

      currentRun = {
        id: observation.id,
        startedAt: observation.ts,
        title: observation.title,
        status: 'running',
        observations: [observation],
      }
      continue
    }

    currentRun.observations.push(observation)
    if (isRunEnd(observation)) {
      currentRun.endedAt = observation.ts
      currentRun.status = getRunStatus(currentRun)
      runs.push(currentRun)
      currentRun = null
    }
  }

  if (currentRun) {
    currentRun.status = getRunStatus(currentRun)
    runs.push(currentRun)
  }

  return runs.reverse()
}
