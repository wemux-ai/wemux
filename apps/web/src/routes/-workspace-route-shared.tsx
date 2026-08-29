// [INPUT]: 工作区路由共享输入
// [OUTPUT]: 共享逻辑
// [POS]: 工作区路由共享
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { TaskSubagentObservation } from '@shared/subagent-role'
import { Loader2 } from 'lucide-react'
import type { ConversationMessageRecord } from '../lib/api'
import { safeSessionStorageSetItem } from '../lib/browser-storage'
import i18n, { getCurrentLanguage, type Language } from '../lib/i18n'

export type WorkspaceLaunchRecord = {
  launchId: string
  taskId: string
  workspaceId: string
  projectId: string
  initialPrompt: string
  baseBranch?: string
  createdAt: string
}

export type WorkspaceLaunchStatus =
  | 'idle'
  | 'restoring'
  | 'binding'
  | 'waiting_chat'
  | 'sending'
  | 'done'
  | 'failed'

export type WorkspacePanelView = 'git' | 'records' | 'files' | 'preview' | 'desktop' | 'browser'

export type WorkspacePrimaryView = 'chat' | WorkspacePanelView
export type PreviewUrlAddressSpace = 'local' | 'private' | 'public' | 'unknown'

export type WorkspaceRouteSearch = {
  projectId: string | undefined
  taskId: string | undefined
  workspaceId: string | undefined
  workspaceSessionId: string | undefined
  launchId: string | undefined
  autoEnvironmentInstall: '1' | undefined
  panel: WorkspacePanelView | undefined
  terminal: '1' | undefined
  mobileView: 'detail' | undefined
  create?: '1' | undefined
}

const LOOPBACK_PREVIEW_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const LOCAL_PREVIEW_SITE_SUFFIX = '.localtest.me'
const PREVIEW_ADDRESS_SPACE_ORDER: Record<PreviewUrlAddressSpace, number> = {
  unknown: -1,
  public: 0,
  private: 1,
  local: 2,
}

const isPrivateIpv4PreviewHostname = (hostname: string) => /^10\./.test(hostname)
  || /^192\.168\./.test(hostname)
  || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)

export const resolveWorkspacePanelView = (value: unknown): WorkspacePanelView | undefined => {
  if (value === 'git' || value === 'records' || value === 'files' || value === 'preview' || value === 'desktop' || value === 'browser') {
    return value
  }

  return undefined
}

export const resolveWorkspacePrimaryView = (value: unknown): WorkspacePrimaryView => {
  return resolveWorkspacePanelView(value) ?? 'chat'
}

export const isLoopbackPreviewSourceUrl = (value?: string) => {
  if (!value?.trim()) {
    return false
  }

  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return LOOPBACK_PREVIEW_HOSTNAMES.has(hostname)
  } catch {
    return false
  }
}

export const resolvePreviewUrlAddressSpace = (value?: string): PreviewUrlAddressSpace => {
  if (!value?.trim()) {
    return 'unknown'
  }

  try {
    const hostname = new URL(value).hostname.toLowerCase()
    if (LOOPBACK_PREVIEW_HOSTNAMES.has(hostname) || hostname.endsWith(LOCAL_PREVIEW_SITE_SUFFIX)) {
      return 'local'
    }

    if (isPrivateIpv4PreviewHostname(hostname)) {
      return 'private'
    }

    return 'public'
  } catch {
    return 'unknown'
  }
}

export const resolvePreviewSourceDirectAccess = (params: {
  currentPageUrl?: string
  sourceUrl?: string
}) => {
  const currentAddressSpace = resolvePreviewUrlAddressSpace(params.currentPageUrl)
  const sourceAddressSpace = resolvePreviewUrlAddressSpace(params.sourceUrl)
  const allowed = (
    sourceAddressSpace !== 'unknown'
    && currentAddressSpace !== 'unknown'
    && PREVIEW_ADDRESS_SPACE_ORDER[currentAddressSpace] >= PREVIEW_ADDRESS_SPACE_ORDER[sourceAddressSpace]
  )

  return {
    allowed,
    currentAddressSpace,
    sourceAddressSpace,
  }
}

export const resolveWorkspacePrimaryViewForWorkspace = ({
  previousWorkspaceId,
  routePanel,
  savedPrimaryView,
  workspaceId,
}: {
  previousWorkspaceId?: string
  routePanel: unknown
  savedPrimaryView?: WorkspacePrimaryView
  workspaceId?: string
}): WorkspacePrimaryView => {
  if (savedPrimaryView) {
    return savedPrimaryView
  }

  // Honor explicit route panels on first load only. Once the user switches workspaces,
  // each workspace should restore its own panel state instead of inheriting the previous one.
  if (previousWorkspaceId && workspaceId && previousWorkspaceId !== workspaceId) {
    return 'chat'
  }

  return resolveWorkspacePrimaryView(routePanel)
}

export const buildWorkspaceRouteSearch = (
  search: Partial<Record<keyof WorkspaceRouteSearch, unknown>>,
): WorkspaceRouteSearch => {
  const projectId = typeof search.projectId === 'string' && search.projectId ? search.projectId : undefined
  const workspaceId = typeof search.workspaceId === 'string' && search.workspaceId ? search.workspaceId : undefined
  const workspaceSessionId = typeof search.workspaceSessionId === 'string' && search.workspaceSessionId ? search.workspaceSessionId : undefined
  const routeTaskId = typeof search.taskId === 'string' && search.taskId ? search.taskId : undefined
  const taskId = routeTaskId === workspaceSessionId ? undefined : routeTaskId
  const launchId = typeof search.launchId === 'string' && search.launchId ? search.launchId : undefined
  const create = search.create === '1' ? '1' : undefined
  const hasWorkspaceDetailTarget = Boolean(workspaceId || taskId || workspaceSessionId || launchId)

  return {
    projectId,
    taskId,
    workspaceId,
    workspaceSessionId,
    launchId,
    autoEnvironmentInstall: search.autoEnvironmentInstall === '1' ? '1' : undefined,
    panel: resolveWorkspacePanelView(search.panel),
    terminal: search.terminal === '1' ? '1' : undefined,
    mobileView: search.mobileView === 'detail' ? 'detail' : undefined,
    create: hasWorkspaceDetailTarget ? undefined : create,
  }
}

export const buildWorkspacesRouteSearch = (
  search: Partial<Record<keyof WorkspaceRouteSearch, unknown>>,
) => buildWorkspaceRouteSearch({ ...search, taskId: undefined })

export const loadWorkspaceLaunch = (launchId?: string): WorkspaceLaunchRecord | null => {
  if (!launchId || typeof window === 'undefined') {
    return null
  }

  const raw = sessionStorage.getItem(`workspace-launch:${launchId}`)
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as WorkspaceLaunchRecord
  } catch {
    sessionStorage.removeItem(`workspace-launch:${launchId}`)
    return null
  }
}

export const clearWorkspaceLaunch = (launchId?: string) => {
  if (!launchId || typeof window === 'undefined') {
    return
  }

  sessionStorage.removeItem(`workspace-launch:${launchId}`)
}

export const text = (language: Language, zh: string, en: string) => language === 'zh' ? zh : en

export const shouldRunEnvironmentStartInTerminal = (preview?: {
  startCommand?: string
  stopCommand?: string
  logsCommand?: string
} | null) => {
  return Boolean(preview?.startCommand?.trim())
}

export const shouldShowEnvironmentStopCommand = (preview?: {
  startCommand?: string
  stopCommand?: string
  logsCommand?: string
} | null) => {
  if (shouldRunEnvironmentStartInTerminal(preview)) {
    return Boolean(preview?.startCommand?.trim())
  }

  return Boolean(preview?.stopCommand?.trim())
}

export const shouldShowEnvironmentLogsCommand = (preview?: {
  startCommand?: string
  stopCommand?: string
  logsCommand?: string
} | null) => {
  if (shouldRunEnvironmentStartInTerminal(preview)) {
    return Boolean(preview?.startCommand?.trim())
  }

  return Boolean(preview?.logsCommand?.trim())
}

const translate = (language: Language, key: string, defaultValue: string, options?: Record<string, unknown>) => {
  return i18n.t(key, {
    lng: language,
    defaultValue,
    ...options,
  })
}

export const getObservationFromConversationMessage = (message: ConversationMessageRecord) => {
  const observation = message.externalRef && typeof message.externalRef === 'object'
    ? (message.externalRef as { observation?: unknown }).observation
    : undefined

  return observation && typeof observation === 'object'
    ? observation as TaskSubagentObservation
    : null
}

export const buildObservationConversationMessage = (observation: TaskSubagentObservation): ConversationMessageRecord => {
  return {
    id: `observation:${observation.id}`,
    conversationId: 'observation-stream',
    role: 'system',
    content: observation.detail || observation.title,
    contentType: 'json',
    externalRef: { observation },
    createdAt: observation.ts,
  }
}

export const hasObservationId = (observation: TaskSubagentObservation | null, id: string) => {
  if (!observation) {
    return false
  }

  return observation.id === id
}

export const getObservationKindLabel = (kind: TaskSubagentObservation['kind'], language: Language = getCurrentLanguage()) => {
  if (kind === 'action') return translate(language, 'workspace.testing.observationKinds.action', '页面动作')
  if (kind === 'terminal') return translate(language, 'workspace.testing.observationKinds.terminal', '终端日志')
  if (kind === 'browser-console') return translate(language, 'workspace.testing.observationKinds.browserConsole', '浏览器 Console')
  if (kind === 'network') return translate(language, 'workspace.testing.observationKinds.network', '网络请求')
  return translate(language, 'workspace.testing.observationKinds.screenshot', '页面截图')
}

export const getObservationLevelLabel = (level: TaskSubagentObservation['level'], language: Language = getCurrentLanguage()) => {
  if (level === 'error') return translate(language, 'common.error', '错误')
  if (level === 'warning') return translate(language, 'common.warning', '警告')
  if (level === 'success') return translate(language, 'common.success', '成功')
  return translate(language, 'common.info', '信息')
}

export const buildRepairPrompt = (observation: TaskSubagentObservation, language: Language = getCurrentLanguage()) => {
  const attachmentLines = (observation.attachments ?? []).map((attachment) =>
    translate(
      language,
      'workspace.testing.repairPrompt.attachmentLine',
      '- 附件: {{filename}} {{url}}',
      {
        filename: attachment.filename,
        url: attachment.url,
      },
    ),
  )

  return language === 'zh'
    ? [
        translate(language, 'workspace.testing.repairPrompt.intro', '请根据下面这条测试异常直接进入修复模式。'),
        translate(language, 'workspace.testing.repairPrompt.goal', '目标是先定位根因，必要时直接修改代码，并给出修复后的验证方法。'),
        '',
        translate(language, 'workspace.testing.repairPrompt.observationHeader', '[异常观测]'),
        translate(language, 'workspace.testing.repairPrompt.typeLine', '- 类型: {{value}}', { value: getObservationKindLabel(observation.kind, language) }),
        translate(language, 'workspace.testing.repairPrompt.levelLine', '- 级别: {{value}}', { value: getObservationLevelLabel(observation.level, language) }),
        translate(language, 'workspace.testing.repairPrompt.titleLine', '- 标题: {{value}}', { value: observation.title }),
        observation.detail ? translate(language, 'workspace.testing.repairPrompt.detailLine', '- 详情: {{value}}', { value: observation.detail }) : '',
        observation.url ? translate(language, 'workspace.testing.repairPrompt.linkLine', '- 链接: {{value}}', { value: observation.url }) : '',
        ...attachmentLines,
        '',
        translate(language, 'workspace.testing.repairPrompt.executionHeader', '[执行要求]'),
        translate(language, 'workspace.testing.repairPrompt.inferCause', '- 先结合当前任务改动和项目上下文判断最可能原因。'),
        translate(language, 'workspace.testing.repairPrompt.directFix', '- 如果可以直接修复，就在本会话里完成修改并说明改动点。'),
        translate(language, 'workspace.testing.repairPrompt.retestOrBlock', '- 修复后请明确告诉我如何复测；如果暂时无法修复，说明阻塞点和建议下一步。'),
      ].filter(Boolean).join('\n')
    : [
        translate(language, 'workspace.testing.repairPrompt.intro', 'Enter repair mode directly based on the test issue below.'),
        translate(language, 'workspace.testing.repairPrompt.goal', 'First identify the root cause, edit code directly if needed, and provide verification steps after the fix.'),
        '',
        translate(language, 'workspace.testing.repairPrompt.observationHeader', '[Observation]'),
        translate(language, 'workspace.testing.repairPrompt.typeLine', '- Type: {{value}}', { value: getObservationKindLabel(observation.kind, language) }),
        translate(language, 'workspace.testing.repairPrompt.levelLine', '- Level: {{value}}', { value: getObservationLevelLabel(observation.level, language) }),
        translate(language, 'workspace.testing.repairPrompt.titleLine', '- Title: {{value}}', { value: observation.title }),
        observation.detail ? translate(language, 'workspace.testing.repairPrompt.detailLine', '- Detail: {{value}}', { value: observation.detail }) : '',
        observation.url ? translate(language, 'workspace.testing.repairPrompt.linkLine', '- Link: {{value}}', { value: observation.url }) : '',
        ...attachmentLines,
        '',
        translate(language, 'workspace.testing.repairPrompt.executionHeader', '[Execution Requirements]'),
        translate(language, 'workspace.testing.repairPrompt.inferCause', '- First infer the most likely cause from the current task changes and project context.'),
        translate(language, 'workspace.testing.repairPrompt.directFix', '- If you can fix it directly, complete the change in this session and explain the fix.'),
        translate(language, 'workspace.testing.repairPrompt.retestOrBlock', '- After fixing, clearly explain how to retest; if blocked, explain the blocker and suggested next step.'),
      ].filter(Boolean).join('\n')
}

export const buildRepairSessionTitle = (observation: TaskSubagentObservation, language: Language = getCurrentLanguage()) => {
  const suffix = observation.title.trim().slice(0, 18)
  return suffix
    ? translate(language, 'workspace.testing.repairSession.titleWithSuffix', '修复 · {{suffix}}', { suffix })
    : translate(language, 'workspace.testing.repairSession.title', '修复会话')
}

export function WorkspaceLoadingState({ message }: { message: string }) {
  const language = getCurrentLanguage()

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#09090b]">
      <div className="flex h-full min-h-[calc(100vh-3.5rem)] flex-col overflow-hidden border border-zinc-900 bg-[#09090b] text-zinc-100">
        <div className="border-b border-zinc-900 bg-[#060606] px-4 py-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="h-6 w-24 animate-pulse rounded-md border border-zinc-800 bg-zinc-950" />
              <div className="h-6 w-20 animate-pulse rounded-full border border-zinc-800 bg-zinc-950" />
              <div className="h-6 w-16 animate-pulse rounded-full border border-zinc-800 bg-zinc-950" />
            </div>
            <div className="h-8 w-56 max-w-full animate-pulse rounded-lg bg-zinc-800/70" />
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
              <div className="h-4 w-40 animate-pulse rounded bg-zinc-900" />
              <div className="h-4 w-28 animate-pulse rounded bg-zinc-900" />
              <div className="h-4 w-24 animate-pulse rounded bg-zinc-900" />
            </div>
          </div>
        </div>

        <div className="grid flex-1 gap-4 overflow-hidden p-4 [grid-template-rows:minmax(0,1fr)_minmax(240px,38vh)]">
          <div className="grid min-h-0 gap-3 md:grid-cols-[250px_minmax(0,1fr)]">
            <div className="hidden min-h-0 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 md:block">
              <div className="h-4 w-24 animate-pulse rounded bg-zinc-800/80" />
              <div className="mt-4 space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                    <div className="h-4 w-28 animate-pulse rounded bg-zinc-800/80" />
                    <div className="mt-2 h-3 w-20 animate-pulse rounded bg-zinc-900" />
                    <div className="mt-2 h-3 w-24 animate-pulse rounded bg-zinc-900" />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex min-h-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/70 p-6">
              <div className="max-w-sm space-y-4 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                </div>
                <div className="space-y-2">
                  <p className="text-base font-medium text-zinc-100">{message}</p>
                  <p className="text-sm leading-6 text-zinc-500">
                    {translate(language, 'workspace.page.syncingDetails', '正在同步工作区详情、任务绑定和执行环境，请稍候。')}
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-56 max-w-full animate-pulse rounded bg-zinc-800/80" />
                  <div className="mx-auto h-3 w-44 max-w-full animate-pulse rounded bg-zinc-900" />
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="h-4 w-20 animate-pulse rounded bg-zinc-800/80" />
                <div className="mt-2 h-3 w-40 animate-pulse rounded bg-zinc-900" />
              </div>
              <div className="h-8 w-16 animate-pulse rounded-lg border border-zinc-800 bg-zinc-950" />
            </div>
            <div className="mt-4 h-full min-h-[140px] rounded-lg border border-dashed border-zinc-800 bg-[#050506]" />
          </div>
        </div>
      </div>
    </div>
  )
}
