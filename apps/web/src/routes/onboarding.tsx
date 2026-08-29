// [INPUT]: 向导状态
// [OUTPUT]: 引导页
// [POS]: Onboarding 页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createFileRoute } from '@tanstack/react-router'
import { resolveMatchingAgentExecutionModelOptionId } from '@shared/model-profile'
import { isDefaultWorkspaceName } from '@shared/collaboration-workspace'
import { deriveOnboardingSnapshot } from '@shared/onboarding'
import type { ExecutionModelOption, ExecutorRecord, Project, Task } from '@shared/types'
import { buildWorkspaceTitleFallback } from '@shared/workspace-title'
import { CreateProjectModal } from '../components/kanban/create-project-modal'
import { OnboardingShell } from '../components/onboarding/onboarding-shell'
import { OnboardingStepDone } from '../components/onboarding/onboarding-step-done'
import { OnboardingStepExecutor } from '../components/onboarding/onboarding-step-executor'
import { OnboardingStepFirstTask } from '../components/onboarding/onboarding-step-first-task'
import { OnboardingStepProject } from '../components/onboarding/onboarding-step-project'
import { OnboardingStepRuntime } from '../components/onboarding/onboarding-step-runtime'
import { OnboardingStepWorkspace } from '../components/onboarding/onboarding-step-workspace'
import type { ExecutorNetworkType } from '../components/execution/executor-network-type'
import { api, type CollaborationWorkspace } from '../lib/api'
import { useApp } from '../lib/app-provider'
import { useAuth } from '../lib/auth-context'
import { useTranslation } from '../lib/i18n/react'
import { buildWorkerRunCommand, type WorkerLocalInstallTarget, type WorkerRunMode } from '../lib/worker-connect-command'
import {
  readWorkspaceCreationImage,
  resolveDefaultWorkspaceCreationExecutorId,
  resolvePreferredWorkspaceCreationRuntime,
  resolveWorkspaceCreationCloneBlockReason,
  runWorkspaceCreationUseCase,
} from '../lib/workspace-creation-use-case'
import {
  readWorkspaceCreateBaseBranchPreference,
  writeWorkspaceCreateBaseBranchPreference,
  writeWorkspaceCreateRuntimePreference,
} from '../lib/workspace-create-preferences'
import { buildWorkspaceRouteSearch } from './-workspace-route-shared'
import {
  DEFAULT_BRANCH_FALLBACK,
  resolveBranchSelectionState,
} from '../components/workspaces/workspaces-page-utils'
import { createWorkspaceInitialState, type CreateWorkspaceState } from '../components/workspaces/workspaces-create-state'

type InteractiveOnboardingStep = 'workspace' | 'executor' | 'runtime' | 'project' | 'first-task'
type RuntimeAgentType = Task['agentType']
type RuntimeAgentDetectionStatus = 'ready' | 'needs-model' | 'missing'
type RuntimeAgentDetection = {
  value: RuntimeAgentType
  label: string
  description: string
  status: RuntimeAgentDetectionStatus
  modelCount: number
  defaultModel: string
  models: ExecutionModelOption[]
  reason: string
}
type RuntimeSetupMode = 'node' | 'manual'
type ManualRuntimeModelDraft = {
  providerId: string
  modelId: string
  baseUrl: string
  apiToken: string
}

const MODEL_OPTIONS_CACHE_TTL_MS = 30_000

const RUNTIME_AGENT_OPTIONS: Array<{ value: RuntimeAgentType; label: string; description: string }> = [
  { value: 'Codex', label: 'Codex', description: '优先使用本机已登录的 Codex。' },
  { value: 'ClaudeCode', label: 'Claude Code', description: '如果本机已有 Claude Code，也会自动接进来。' },
  { value: 'OpenCode', label: 'OpenCode', description: '会读取本机 provider 和模型配置。' },
  { value: 'Pi', label: 'Pi', description: '如果本机已有 Pi runtime，也会一起探测。' },
]

const ONBOARDING_PROMPT_SUGGESTIONS = [
  {
    label: '了解这个项目',
    prompt: '先了解一下这个项目是什么项目，帮我快速梳理它的结构、技术栈和当前主要模块。',
  },
  {
    label: '读代码入口',
    prompt: '先帮我找到这个项目最关键的入口文件和主流程，然后告诉我应该从哪里开始看。',
  },
  {
    label: '检查能否运行',
    prompt: '先检查这个项目现在怎么启动、依赖是否完整、有没有明显的运行问题。',
  },
  {
    label: '给我一个开发计划',
    prompt: '先根据当前项目状态，给我一个简短的开发计划，告诉我接下来最值得优先做什么。',
  },
  {
    label: '先看 README',
    prompt: '先读一下这个项目的 README 和关键配置文件，然后告诉我这个项目是做什么的。',
  },
  {
    label: '帮我找启动命令',
    prompt: '先帮我找这个项目的启动命令、依赖安装方式，以及本地开发应该怎么跑起来。',
  },
  {
    label: '梳理目录结构',
    prompt: '先帮我梳理一下这个项目的目录结构，告诉我每个核心目录大概负责什么。',
  },
  {
    label: '看最近要做什么',
    prompt: '先基于当前项目状态，判断现在最值得优先推进的事情是什么，并给我一个很短的建议。',
  },
  {
    label: '检查技术栈',
    prompt: '先识别一下这个项目使用了哪些技术栈、框架、构建工具和主要依赖。',
  },
  {
    label: '帮我快速上手',
    prompt: '我刚接手这个项目。请先带我快速上手，告诉我最重要的入口、流程和应该先看哪里。',
  },
  {
    label: '分析主要页面',
    prompt: '先帮我分析这个项目最主要的页面或功能模块，告诉我用户最常接触的是哪几块。',
  },
  {
    label: '找核心接口',
    prompt: '先帮我找出这个项目最核心的接口、服务调用或数据流入口，并解释一下它们之间的关系。',
  },
  {
    label: '看待办问题',
    prompt: '先看看这个项目里有没有明显的待修问题、TODO、报错点或者不合理的地方。',
  },
  {
    label: '总结当前状态',
    prompt: '先基于代码现状，总结一下这个项目现在处于什么阶段，哪些部分看起来已经完成，哪些还不完善。',
  },
  {
    label: '帮我做第一次排查',
    prompt: '先帮我做一次初步排查，看看这个项目里有没有最值得优先关注的风险点或者坑。',
  },
]

const isNonGitBranchSnapshot = (response: {
  ok: boolean
  branches: string[]
  versionControl?: NonNullable<CreateWorkspaceState['branchVersionControl']>
  message?: string
}) => {
  if (response.versionControl === 'none') {
    return true
  }

  if (response.ok || response.branches.length > 0) {
    return false
  }

  const message = response.message?.trim() || ''
  return /未启用 Git|无 Git 仓库|不是有效 Git 仓库|仓库未配置 origin|no git|not a git/i.test(message)
}

const createOnboardingWorkspaceInitialState = (params: {
  executorId?: string
  fallbackAgentType?: Task['agentType']
  project: Project | null
  projectId: string
}) => {
  const runtimePreference = resolvePreferredWorkspaceCreationRuntime({
    fallbackAgentType: params.fallbackAgentType,
    project: params.project,
    projectId: params.projectId,
  })

  return {
    ...createWorkspaceInitialState(params.projectId, params.executorId || ''),
    agentType: runtimePreference.agentType,
    workingDirectoryMode: runtimePreference.workingDirectoryMode,
  }
}

export const Route = createFileRoute('/onboarding')({
  component: OnboardingRoute,
})

function OnboardingRoute() {
  const { t, language } = useTranslation()
  const { user, updateUser } = useAuth()
  const { state, setState, selectedProjectId, setSelectedProjectId, settingsDraft, setSettingsDraft, runMutation } = useApp()
  const [executors, setExecutors] = useState<ExecutorRecord[]>([])
  const [executorLoading, setExecutorLoading] = useState(true)
  const [pairingCode, setPairingCode] = useState('')
  const [pairingExpiresAt, setPairingExpiresAt] = useState('')
  const [pairingNetworkType, setPairingNetworkType] = useState<ExecutorNetworkType>('internal')
  const [pairingRunMode, setPairingRunMode] = useState<WorkerRunMode>('local')
  const [pairingInstallTarget, setPairingInstallTarget] = useState<WorkerLocalInstallTarget>('unix')
  const [pairingDisplayName, setPairingDisplayName] = useState(() => (language === 'zh' ? '我的 Worker' : 'My Worker'))
  const [pairingBusy, setPairingBusy] = useState(false)
  const [runtimeSaving, setRuntimeSaving] = useState(false)
  const [runtimeModelLoading, setRuntimeModelLoading] = useState(false)
  const [runtimeModelOptions, setRuntimeModelOptions] = useState<ExecutionModelOption[]>([])
  const [selectedRuntimeAgentType, setSelectedRuntimeAgentType] = useState<Task['agentType']>('Codex')
  const [selectedRuntimeModel, setSelectedRuntimeModel] = useState('')
  const [runtimeSetupMode, setRuntimeSetupMode] = useState<RuntimeSetupMode>('node')
  const [runtimeDetectionLoading, setRuntimeDetectionLoading] = useState(false)
  const [runtimeDiscoveryMessage, setRuntimeDiscoveryMessage] = useState('')
  const [runtimeConfirmed, setRuntimeConfirmed] = useState(false)
  const [runtimeAgentDetections, setRuntimeAgentDetections] = useState<Partial<Record<RuntimeAgentType, RuntimeAgentDetection>>>({})
  const [manualRuntimeModelDraft, setManualRuntimeModelDraft] = useState<ManualRuntimeModelDraft>({
    providerId: '',
    modelId: '',
    baseUrl: '',
    apiToken: '',
  })
  const [manualStep, setManualStep] = useState<InteractiveOnboardingStep | null>(null)
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [projectAutoCreating, setProjectAutoCreating] = useState(false)
  const [defaultProjectCreated, setDefaultProjectCreated] = useState(false)
  const projectAutoCreateInFlight = useRef(false)
  const [projectModalMode, setProjectModalMode] = useState<'create' | 'clone'>('create')
  const [projectModalCloneSource, setProjectModalCloneSource] = useState<'github-app' | 'manual'>('github-app')
  const [workspaces, setWorkspaces] = useState<CollaborationWorkspace[]>([])
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceSaving, setWorkspaceSaving] = useState(false)
  const [createState, setCreateState] = useState<CreateWorkspaceState>(() => createWorkspaceInitialState())
  const [createModelOptions, setCreateModelOptions] = useState<ExecutionModelOption[]>([])
  const [createDefaultModel, setCreateDefaultModel] = useState('')
  const [createModelLoading, setCreateModelLoading] = useState(false)
  const connectCommand = pairingCode
    ? buildWorkerRunCommand(pairingCode, pairingRunMode, {
        displayName: pairingDisplayName,
        installTarget: pairingInstallTarget,
      })
    : ''
  const ownedWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.ownerUserId === user?.id),
    [user?.id, workspaces],
  )
  const primaryWorkspace = ownedWorkspaces[0] ?? null
  const workspaceReady = useMemo(() => {
    if (!user || !primaryWorkspace) {
      return false
    }

    return !isDefaultWorkspaceName(primaryWorkspace.name, user.name, user.email)
  }, [primaryWorkspace, user])
  const readyExecutors = useMemo(
    () => executors.filter((executor) => executor.status === 'online' || executor.status === 'paired'),
    [executors],
  )
  const onlineExecutors = useMemo(
    () => executors.filter((executor) => executor.status === 'online'),
    [executors],
  )
  const activeRuntimeExecutor = onlineExecutors[0] ?? null
  const selectedRuntimeDetection = runtimeAgentDetections[selectedRuntimeAgentType] ?? null
  const detectedRuntimeDefaultModel = selectedRuntimeDetection?.defaultModel?.trim() || ''
  const visibleDefaultRuntimeModel = resolveMatchingAgentExecutionModelOptionId(
    selectedRuntimeAgentType,
    runtimeModelOptions,
    settingsDraft.agentSettings[selectedRuntimeAgentType].defaultModel,
  ) || detectedRuntimeDefaultModel || settingsDraft.agentSettings[selectedRuntimeAgentType].defaultModel
  const manualRuntimeReady = Boolean(
    manualRuntimeModelDraft.providerId.trim()
      && manualRuntimeModelDraft.modelId.trim(),
  )
  const runtimeSelectionReady = Boolean(
    runtimeSetupMode === 'manual'
      ? manualRuntimeReady
      : true,
  )
  const runtimeNextDisabled = runtimeSaving || !runtimeSelectionReady

  const snapshot = useMemo(() => deriveOnboardingSnapshot({
    onboardingCompletedAt: user?.onboardingCompletedAt,
    onboardingDismissedAt: user?.onboardingDismissedAt,
    workspaceReady,
    executorCount: executors.filter((executor) => executor.status === 'online' || executor.status === 'paired').length,
    runtimeReady: runtimeConfirmed,
    projectCount: state.projects.length,
    taskCount: state.tasks.length,
  }), [executors, runtimeConfirmed, state.projects.length, state.tasks.length, user?.onboardingCompletedAt, user?.onboardingDismissedAt, workspaceReady])
  const interactiveSteps: InteractiveOnboardingStep[] = ['workspace', 'executor', 'runtime', 'project', 'first-task']
  const displayStep = snapshot.nextStep === 'done' ? 'done' : (manualStep ?? snapshot.nextStep)
  const currentProject = state.projects.find((project) => project.id === selectedProjectId) || state.projects[0] || null
  const createPanelSelectedProject = state.projects.find((project) => project.id === createState.projectId) ?? null
  const createPanelProjectDefaultBranch = createPanelSelectedProject?.defaultBranch || DEFAULT_BRANCH_FALLBACK

  const goToPreviousStep = () => {
    if (displayStep === 'done') {
      return
    }

    const index = interactiveSteps.indexOf(displayStep)
    if (index > 0) {
      setManualStep(interactiveSteps[index - 1])
    }
  }

  const goToNextStep = () => {
    if (displayStep === 'done') {
      return
    }

    const index = interactiveSteps.indexOf(displayStep)
    if (index >= 0 && index < interactiveSteps.length - 1) {
      setManualStep(interactiveSteps[index + 1])
    }
  }

  useEffect(() => {
    setWorkspaceName(primaryWorkspace?.name ?? '')
  }, [primaryWorkspace?.name])

  useEffect(() => {
    setSelectedRuntimeAgentType((current) => current || 'Codex')
  }, [])

  useEffect(() => {
    if (!activeRuntimeExecutor?.executorId) {
      setRuntimeAgentDetections({})
      setRuntimeDiscoveryMessage('')
      setRuntimeModelOptions([])
      setRuntimeModelLoading(false)
      setRuntimeDetectionLoading(false)
      setRuntimeConfirmed(false)
      return
    }

    let cancelled = false
    setRuntimeDetectionLoading(true)
    setRuntimeModelLoading(true)
    setRuntimeConfirmed(false)

    void (async () => {
      const executorId = activeRuntimeExecutor.executorId
      const [doctorResponse, exportResponse, ...modelResponses] = await Promise.all([
        api.runExecutorDoctor(executorId).catch(() => null),
        api.exportExecutorAgentRuntimeConfig(executorId).catch(() => null),
        ...RUNTIME_AGENT_OPTIONS.map((option) => api.listAgentModels(option.value, executorId).catch(() => null)),
      ])

      if (cancelled) {
        return
      }

      const checks = doctorResponse?.doctor.checks ?? {}
      const exportedAgentSettings = exportResponse?.agentSettings
      const nextDetections = {} as Record<RuntimeAgentType, RuntimeAgentDetection>

      RUNTIME_AGENT_OPTIONS.forEach((option, index) => {
        const modelResponse = modelResponses[index]
        const models = modelResponse?.models ?? []
        const exportedDefaultModel = exportedAgentSettings?.[option.value]?.defaultModel?.trim() || ''
        const defaultModel = resolveMatchingAgentExecutionModelOptionId(
          option.value,
          models,
          exportedDefaultModel,
        ) || modelResponse?.defaultModel?.trim() || exportedDefaultModel

        const available = option.value === 'Codex'
          ? Boolean(checks.codexCliAvailable && checks.codexAuthenticated)
          : option.value === 'ClaudeCode'
            ? Boolean(checks.claudeCliAvailable && checks.claudeAuthenticated)
            : option.value === 'OpenCode'
              ? Boolean(checks.opencodeAvailable || models.length > 0)
              : Boolean(exportedDefaultModel || exportedAgentSettings?.Pi?.agentDir?.trim() || models.length > 0)

        const status: RuntimeAgentDetectionStatus = !available
          ? 'missing'
          : models.length > 0
            ? 'ready'
            : 'needs-model'

        const reason = option.value === 'Codex'
          ? (!checks.codexCliAvailable ? '本机未检测到 Codex CLI。' : !checks.codexAuthenticated ? 'Codex 还没有登录。' : models.length > 0 ? `${models.length} 个模型已就绪。` : 'Codex 已就绪，但还没有探测到可用模型。')
          : option.value === 'ClaudeCode'
            ? (!checks.claudeCliAvailable ? '本机未检测到 Claude Code CLI。' : !checks.claudeAuthenticated ? 'Claude Code 还没有登录。' : models.length > 0 ? `${models.length} 个模型已就绪。` : 'Claude Code 已就绪，但还没有探测到可用模型。')
            : option.value === 'OpenCode'
              ? (available ? (models.length > 0 ? `${models.length} 个模型已同步。` : '已检测到 OpenCode，但本机 provider 里还没有模型。') : '本机未检测到 OpenCode runtime。')
              : (available ? (models.length > 0 ? `${models.length} 个模型已就绪。` : '已检测到 Pi，但还没有可用模型。') : '本机未检测到 Pi runtime。')

        nextDetections[option.value] = {
          value: option.value,
          label: option.label,
          description: option.description,
          status,
          modelCount: models.length,
          defaultModel,
          models,
          reason,
        }
      })

      const preferredRuntime =
        RUNTIME_AGENT_OPTIONS.map((option) => nextDetections[option.value]).find((item) => item?.status === 'ready')
        || RUNTIME_AGENT_OPTIONS.map((option) => nextDetections[option.value]).find((item) => item?.status === 'needs-model')
        || null

      setRuntimeAgentDetections(nextDetections)
      setSelectedRuntimeAgentType((current) => {
        const currentDetection = nextDetections[current]
        return currentDetection && currentDetection.status !== 'missing'
          ? current
          : (preferredRuntime?.value || current)
      })

      if (preferredRuntime?.defaultModel && !settingsDraft.agentSettings[preferredRuntime.value].defaultModel.trim()) {
        setSettingsDraft({
          ...settingsDraft,
          defaultModel: preferredRuntime.value === 'OpenCode'
            ? preferredRuntime.defaultModel
            : settingsDraft.defaultModel,
          agentSettings: {
            ...settingsDraft.agentSettings,
            [preferredRuntime.value]: {
              ...settingsDraft.agentSettings[preferredRuntime.value],
              defaultModel: preferredRuntime.defaultModel,
            },
          },
        })
      }

      setRuntimeModelLoading(false)
      setRuntimeDetectionLoading(false)
    })().catch(() => {
      if (!cancelled) {
        setRuntimeAgentDetections({})
        setRuntimeDiscoveryMessage('')
        setRuntimeModelOptions([])
        setRuntimeModelLoading(false)
        setRuntimeDetectionLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeRuntimeExecutor?.executorId, setSettingsDraft, settingsDraft])

  useEffect(() => {
    const detection = runtimeAgentDetections[selectedRuntimeAgentType]
    if (!detection) {
      setRuntimeModelOptions([])
      setRuntimeModelLoading(runtimeDetectionLoading)
      return
    }

    setRuntimeModelOptions(detection.models)
    setRuntimeModelLoading(false)
    if (selectedRuntimeModel && !detection.models.some((model) => model.id === selectedRuntimeModel)) {
      setSelectedRuntimeModel('')
    }
  }, [runtimeAgentDetections, runtimeDetectionLoading, selectedRuntimeAgentType, selectedRuntimeModel])

  useEffect(() => {
    if (snapshot.nextStep === 'done') {
      setManualStep(null)
      return
    }

    setManualStep((current) => {
      if (!current) {
        return null
      }

      const currentIndex = interactiveSteps.indexOf(current)
      const snapshotIndex = snapshot.nextStep === 'done' ? interactiveSteps.length : interactiveSteps.indexOf(snapshot.nextStep)
      return currentIndex < snapshotIndex ? null : current
    })
  }, [interactiveSteps, snapshot.nextStep])

  useEffect(() => {
    if (displayStep !== 'first-task') {
      return
    }

    const nextProjectId = currentProject?.id || state.projects[0]?.id || ''
    const nextProject = state.projects.find((project) => project.id === nextProjectId) ?? null
    const nextExecutorId = resolveDefaultWorkspaceCreationExecutorId(nextProject, readyExecutors)

    setCreateState((current) => {
      if (current.busy) {
        return current
      }

      if (current.projectId === nextProjectId && current.executorId) {
        return current
      }

      return createOnboardingWorkspaceInitialState({
        executorId: nextExecutorId,
        fallbackAgentType: selectedRuntimeAgentType,
        project: nextProject,
        projectId: nextProjectId,
      })
    })
  }, [currentProject?.id, displayStep, readyExecutors, selectedRuntimeAgentType, state.projects])

  useEffect(() => {
    if (snapshot.nextStep !== 'done' || user?.onboardingCompletedAt) {
      return
    }

    let cancelled = false
    void api.updateMyOnboarding({
      onboardingCompletedAt: new Date().toISOString(),
    })
      .then((response) => {
        if (!cancelled) {
          updateUser(response.user)
        }
      })
      .catch(() => undefined)

    // 自有 telemetry：onboarding 完成（激活漏斗节点）
    void api.trackEvent({ eventType: 'onboarding_completed' }).catch(() => undefined)

    return () => {
      cancelled = true
      }
  }, [snapshot.nextStep, updateUser, user?.onboardingCompletedAt])

  useEffect(() => {
    if (displayStep !== 'first-task') {
      return
    }

    if (createState.branchVersionControl === 'none' || createPanelSelectedProject?.versionControl === 'none') {
      setCreateState((current) => ({
        ...current,
        workingDirectoryMode: 'original-dir',
        autoCommitEnabled: false,
        branchOptions: [],
        selectedBranch: '',
        defaultBranch: '',
        branchLoading: false,
        branchVersionControl: 'none',
        branchMessage: t('workspace.createPanel.branchMessages.nonGitProject'),
      }))
      return
    }

    if (createState.workingDirectoryMode === 'original-dir') {
      setCreateState((current) => ({
        ...current,
        branchOptions: [],
        selectedBranch: '',
        defaultBranch: '',
        branchLoading: false,
        branchVersionControl: createPanelSelectedProject?.versionControl,
        branchMessage: t('workspace.createPanel.branchMessages.originalDirDirect'),
      }))
      return
    }

    if (!createState.projectId || !createState.executorId) {
      setCreateState((current) => ({
        ...current,
        branchOptions: [],
        selectedBranch: '',
        defaultBranch: '',
        branchLoading: false,
        branchVersionControl: undefined,
        branchMessage: current.executorId ? t('workspace.page.errors.selectProjectFirst') : t('workspace.page.errors.selectExecutorFirst'),
      }))
      return
    }

    const cloneBlockReason = resolveWorkspaceCreationCloneBlockReason(createPanelSelectedProject, t)
    if (cloneBlockReason) {
      setCreateState((current) => ({
        ...current,
        branchOptions: [],
        selectedBranch: '',
        defaultBranch: createPanelProjectDefaultBranch,
        branchLoading: false,
        branchVersionControl: undefined,
        branchMessage: cloneBlockReason,
      }))
      return
    }

    let cancelled = false
    setCreateState((current) => ({
      ...current,
      branchLoading: true,
      branchMessage: '',
    }))

    void api.listProjectBranches(createState.projectId, createState.executorId)
      .then((response) => {
        if (cancelled) {
          return
        }

        if (isNonGitBranchSnapshot(response)) {
          setCreateState((current) => ({
            ...current,
            workingDirectoryMode: 'original-dir',
            autoCommitEnabled: false,
            branchOptions: [],
            selectedBranch: '',
            defaultBranch: response.defaultBranch || createPanelProjectDefaultBranch,
            branchVersionControl: 'none',
            branchMessage: t('workspace.createPanel.branchMessages.nonGitProject'),
          }))
          return
        }

        if (!response.ok && response.branches.length === 0) {
          setCreateState((current) => ({
            ...current,
            branchOptions: [],
            selectedBranch: '',
            defaultBranch: response.defaultBranch || createPanelProjectDefaultBranch,
            branchVersionControl: response.versionControl,
            branchMessage: response.message?.trim() || t('workspace.page.errors.loadBranchesFailed'),
          }))
          return
        }

        const preferredBranch = readWorkspaceCreateBaseBranchPreference(createState.projectId)
        setCreateState((current) => ({
          ...current,
          ...resolveBranchSelectionState({
            branches: response.branches,
            currentBranch: current.selectedBranch || preferredBranch,
            defaultBranch: response.defaultBranch,
            fallbackBranch: createPanelProjectDefaultBranch,
            language,
            message: response.message,
          }),
          branchVersionControl: response.versionControl,
        }))
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        const preferredBranch = readWorkspaceCreateBaseBranchPreference(createState.projectId)
        setCreateState((current) => ({
          ...current,
          ...resolveBranchSelectionState({
            branches: [],
            currentBranch: current.selectedBranch || preferredBranch,
            fallbackBranch: createPanelProjectDefaultBranch,
            language,
            message: `${error instanceof Error ? error.message : t('workspace.page.errors.loadBranchesFailed')} ${t('workspace.page.errors.fallbackToDefaultBranch')}`,
          }),
          branchVersionControl: undefined,
        }))
      })
      .finally(() => {
        if (!cancelled) {
          setCreateState((current) => ({ ...current, branchLoading: false }))
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    createPanelProjectDefaultBranch,
    createPanelSelectedProject,
    createState.branchVersionControl,
    createState.executorId,
    createState.projectId,
    createState.workingDirectoryMode,
    displayStep,
    language,
    t,
  ])

  useEffect(() => {
    if (displayStep !== 'first-task') {
      return
    }

    let cancelled = false
    const modelAgentType = createState.agentType
    const modelExecutorId = createState.executorId.trim()

    if ((modelAgentType === 'OpenCode' || modelAgentType === 'Pi') && !modelExecutorId) {
      setCreateModelOptions([])
      setCreateDefaultModel('')
      setCreateModelLoading(false)
      setCreateState((current) => current.executionModel ? { ...current, executionModel: '' } : current)
      return
    }

    setCreateModelLoading(true)
    void api.listAgentModels(modelAgentType, modelExecutorId || undefined)
      .then((response) => {
        if (cancelled) {
          return
        }

        setCreateModelOptions(response.models)
        setCreateDefaultModel(response.defaultModel ?? '')
        setCreateState((current) => {
          if (!current.executionModel) {
            return current
          }
          const matchedModel = resolveMatchingAgentExecutionModelOptionId(
            current.agentType,
            response.models,
            current.executionModel,
          )
          return matchedModel ? current : { ...current, executionModel: '' }
        })
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setCreateModelOptions([])
        setCreateDefaultModel('')
      })
      .finally(() => {
        if (!cancelled) {
          setCreateModelLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [createState.agentType, createState.executionModel, createState.executorId, displayStep])

  useEffect(() => {
    let cancelled = false

    const loadWorkspaces = async () => {
      try {
        const response = await api.listCollaborationWorkspaces()
        if (!cancelled) {
          setWorkspaces(response.workspaces)
        }
      } catch {
        if (!cancelled) {
          setWorkspaces([])
        }
      }
    }

    const loadExecutors = async () => {
      try {
        const response = await api.listExecutors()
        if (!cancelled) {
          setExecutors(response.executors)
        }
      } catch {
        if (!cancelled) {
          setExecutors([])
        }
      } finally {
        if (!cancelled) {
          setExecutorLoading(false)
        }
      }
    }

    void loadWorkspaces()
    void loadExecutors()
    const timer = window.setInterval(() => {
      void loadExecutors()
    }, 8000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  // 新用户 onboarding：进入项目步骤且没有任何项目时，默认创建一个 onboarding 项目，
  // 用户可以直接进入下一步，不必手动接入仓库。
  const defaultProjectName = t('onboarding.project.defaultProjectName')
  const autoCreatedProjectName = defaultProjectCreated
    && state.projects.some((project) => project.name === defaultProjectName)
    ? defaultProjectName
    : undefined

  useEffect(() => {
    if (displayStep !== 'project') {
      setProjectAutoCreating(false)
      return
    }

    if (state.projects.length > 0) {
      setProjectAutoCreating(false)
      return
    }

    if (projectAutoCreateInFlight.current) {
      return
    }

    projectAutoCreateInFlight.current = true
    setProjectAutoCreating(true)
    let cancelled = false

    void api.createProject({
      name: defaultProjectName,
      gitUrl: '',
      versionControl: 'none',
      workspaceId: primaryWorkspace?.id,
      visibility: 'private',
    })
      .then((response) => {
        if (cancelled) {
          return
        }
        if (response.state) {
          setState(response.state)
        }
        setDefaultProjectCreated(true)
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setDefaultProjectCreated(false)
        toast.error(error instanceof Error ? error.message : t('onboarding.project.autoCreateFailed'))
      })
      .finally(() => {
        projectAutoCreateInFlight.current = false
        if (!cancelled) {
          setProjectAutoCreating(false)
        }
      })

    return () => {
      cancelled = true
      projectAutoCreateInFlight.current = false
    }
  }, [defaultProjectName, displayStep, primaryWorkspace?.id, setState, state.projects.length, t])

  const handleSkip = async () => {
    try {
      const response = await api.updateMyOnboarding({
        onboardingDismissedAt: new Date().toISOString(),
      })
      updateUser(response.user)
      window.location.href = '/dashboard'
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('onboarding.route.skipFailed'))
    }
  }

  const handleSaveWorkspaceName = async () => {
    if (!primaryWorkspace || !workspaceName.trim()) {
      return false
    }

    setWorkspaceSaving(true)
    try {
      const response = await api.updateCollaborationWorkspace(primaryWorkspace.id, {
        name: workspaceName.trim(),
      })
      setWorkspaces((current) => current.map((workspace) => (
        workspace.id === response.workspace.id ? response.workspace : workspace
      )))
      toast.success(response.message || t('workspace.rename.updated'))
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.rename.updateFailed'))
      return false
    } finally {
      setWorkspaceSaving(false)
    }
  }

  const handleCreatePairingCode = async () => {
    setPairingBusy(true)
    try {
      const response = await api.createExecutorPairingCode({
        visibility: 'private',
        previewExposureMode: pairingNetworkType === 'public' ? 'public-ingress' : 'private',
        label: pairingDisplayName.trim() || (language === 'zh' ? '我的 Worker' : 'My Worker'),
      })
      setPairingCode(response.pairingCode.pairingCode)
      setPairingExpiresAt(response.pairingCode.expiresAt)
      const nextConnectCommand = buildWorkerRunCommand(response.pairingCode.pairingCode, pairingRunMode, {
        displayName: pairingDisplayName.trim() || (language === 'zh' ? '我的 Worker' : 'My Worker'),
        installTarget: pairingInstallTarget,
      })
      try {
        await navigator.clipboard.writeText(nextConnectCommand)
        toast.success(t('onboarding.route.connectCommandGeneratedCopied'))
      } catch {
        toast.success(t('onboarding.route.connectCommandGenerated'))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('onboarding.route.connectCommandGenerateFailed'))
    } finally {
      setPairingBusy(false)
    }
  }

  const handleCopyConnectCommand = async () => {
    if (!connectCommand) {
      return
    }

    try {
      await navigator.clipboard.writeText(connectCommand)
      toast.success(t('onboarding.route.connectCommandCopied'))
    } catch {
      toast.error(t('onboarding.route.copyFailed'))
    }
  }

  const handleSaveRuntimeSelection = async () => {
    if (!runtimeSelectionReady) {
      return
    }

    if (runtimeSetupMode === 'manual') {
      const nextModelId = `${manualRuntimeModelDraft.providerId.trim()}/${manualRuntimeModelDraft.modelId.trim()}`
      const payload = {
        name: nextModelId,
        visibility: 'private' as const,
        bindings: RUNTIME_AGENT_OPTIONS.map((option) => ({
          agentType: option.value,
          providerId: manualRuntimeModelDraft.providerId.trim(),
          modelId: manualRuntimeModelDraft.modelId.trim(),
          label: `${option.label} · ${nextModelId}`,
          baseUrl: manualRuntimeModelDraft.baseUrl.trim() || undefined,
          apiToken: manualRuntimeModelDraft.apiToken.trim() || undefined,
          isDefault: true,
          runtimeSettings: {
            defaultModel: nextModelId,
          },
        })),
      }

      setRuntimeSaving(true)
      try {
        await api.createModelProfile(payload)
        const nextConfig = {
          ...settingsDraft,
          defaultModel: nextModelId,
          agentSettings: {
            ...settingsDraft.agentSettings,
            OpenCode: {
              ...settingsDraft.agentSettings.OpenCode,
              defaultModel: nextModelId,
            },
            Codex: {
              ...settingsDraft.agentSettings.Codex,
              defaultModel: nextModelId,
            },
            ClaudeCode: {
              ...settingsDraft.agentSettings.ClaudeCode,
              defaultModel: nextModelId,
            },
            Pi: {
              ...settingsDraft.agentSettings.Pi,
              defaultModel: nextModelId,
            },
          },
        }
        setSelectedRuntimeAgentType('Codex')
        setSelectedRuntimeModel(nextModelId)
        setSettingsDraft(nextConfig)
        await runMutation(() => api.saveSettings(nextConfig))
        setRuntimeConfirmed(true)
        setManualStep('project')
      } finally {
        setRuntimeSaving(false)
      }
      return
    }

    const nextConfig = {
      ...settingsDraft,
      defaultModel: selectedRuntimeAgentType === 'OpenCode'
        ? (selectedRuntimeModel || visibleDefaultRuntimeModel || settingsDraft.defaultModel)
        : settingsDraft.defaultModel,
      agentSettings: {
        ...settingsDraft.agentSettings,
        [selectedRuntimeAgentType]: {
          ...settingsDraft.agentSettings[selectedRuntimeAgentType],
          defaultModel: selectedRuntimeModel || visibleDefaultRuntimeModel || settingsDraft.agentSettings[selectedRuntimeAgentType].defaultModel || '',
        },
      },
    }

    setRuntimeSaving(true)
    try {
      setSettingsDraft(nextConfig)
      await runMutation(() => api.saveSettings(nextConfig))
      setRuntimeConfirmed(true)
      setManualStep('project')
    } finally {
      setRuntimeSaving(false)
    }
  }

  const handleUpdateCreateState = (patch: Partial<CreateWorkspaceState>) => {
    if (patch.selectedBranch && createState.projectId) {
      writeWorkspaceCreateBaseBranchPreference(createState.projectId, patch.selectedBranch)
    }

    if (createState.projectId && (patch.agentType || patch.workingDirectoryMode)) {
      writeWorkspaceCreateRuntimePreference(createState.projectId, {
        agentType: patch.agentType ?? createState.agentType,
        workingDirectoryMode: patch.workingDirectoryMode ?? createState.workingDirectoryMode,
      })
    }

    setCreateState((current) => {
      const nextProjectId = patch.projectId ?? current.projectId
      const projectChanged = Boolean(patch.projectId && patch.projectId !== current.projectId)
      const nextProject = projectChanged
        ? state.projects.find((project) => project.id === nextProjectId) ?? null
        : createPanelSelectedProject
      const projectRuntimePreference = projectChanged
        ? resolvePreferredWorkspaceCreationRuntime({
            fallbackAgentType: selectedRuntimeAgentType,
            project: nextProject,
            projectId: nextProjectId,
          })
        : null
      const nextBranchVersionControl = patch.branchVersionControl
        ?? (projectChanged ? nextProject?.versionControl : current.branchVersionControl)
      const defaultExecutorId = projectChanged ? resolveDefaultWorkspaceCreationExecutorId(nextProject, readyExecutors) : ''
      const nextAgentType = patch.agentType ?? projectRuntimePreference?.agentType ?? current.agentType
      const nextWorkingDirectoryMode = nextBranchVersionControl === 'none'
        ? 'original-dir'
        : patch.workingDirectoryMode ?? projectRuntimePreference?.workingDirectoryMode ?? current.workingDirectoryMode
      const agentChanged = nextAgentType !== current.agentType

      return {
        ...current,
        ...patch,
        executorId: projectChanged ? defaultExecutorId : patch.executorId ?? current.executorId,
        agentType: nextAgentType,
        agentSettings: agentChanged || projectChanged ? patch.agentSettings : patch.agentSettings ?? current.agentSettings,
        executionModel: agentChanged || projectChanged ? '' : patch.executionModel ?? current.executionModel,
        workingDirectoryMode: nextWorkingDirectoryMode,
        branchVersionControl: nextBranchVersionControl,
        autoCommitEnabled: patch.workingDirectoryMode
          ? patch.autoCommitEnabled ?? (nextWorkingDirectoryMode !== 'original-dir' && nextBranchVersionControl !== 'none')
          : nextBranchVersionControl === 'none'
            ? false
            : patch.autoCommitEnabled ?? current.autoCommitEnabled,
      }
    })
  }

  const handleCreateWorkspaceFromOnboarding = async (options: { startAgent?: boolean } = {}) => {
    const startAgent = options.startAgent ?? true
    const nextInitialPrompt = createState.initialPrompt.trim()
    const nextImages = createState.images
    const manualWorkspaceName = createState.name.trim()
    const fallbackName = manualWorkspaceName
      || buildWorkspaceTitleFallback(
        nextInitialPrompt,
        startAgent ? nextImages[0]?.filename : undefined,
        startAgent ? t('workspace.createPanel.title') : t('workspace.createPanel.emptyWorkspaceFallbackTitle'),
      )
    const nextTitleOrigin = manualWorkspaceName || !startAgent ? 'manual' : 'system'
    const nextProjectId = createState.projectId
    const nextExecutorId = createState.executorId
    const nextExecutionModel = createState.executionModel.trim()
    const nextWorkingDirectoryMode = createState.workingDirectoryMode
    const nextAutoCommitEnabled = createState.autoCommitEnabled
    const nextSelectedBranch = createState.selectedBranch
    const needsBranch = createState.workingDirectoryMode !== 'original-dir'

    if (!nextProjectId) {
      toast.error(t('workspace.page.errors.selectProjectFirst'))
      return
    }
    if (!nextExecutorId) {
      toast.error(t('workspace.page.errors.selectExecutorFirst'))
      return
    }

    const cloneBlockReason = resolveWorkspaceCreationCloneBlockReason(createPanelSelectedProject, t)
    if (cloneBlockReason) {
      toast.error(cloneBlockReason)
      return
    }
    if (needsBranch && !nextSelectedBranch) {
      toast.error(t('workspace.page.errors.selectBaseBranchFirst'))
      return
    }
    if (startAgent && !nextInitialPrompt && nextImages.length === 0) {
      toast.error(t('workspace.createPanel.promptRequired'))
      return
    }
    if (!startAgent && nextImages.length > 0) {
      toast.error(t('workspace.createPanel.emptyWorkspaceImageBlocked'))
      return
    }

    if (needsBranch) {
      writeWorkspaceCreateBaseBranchPreference(nextProjectId, nextSelectedBranch)
    }
    writeWorkspaceCreateRuntimePreference(nextProjectId, {
      agentType: createState.agentType,
      workingDirectoryMode: nextWorkingDirectoryMode,
    })

    setCreateState((current) => ({ ...current, busy: true, creatingStep: 'workspace' }))

    try {
      const creation = await runWorkspaceCreationUseCase({
        createWorkspace: () => api.createWorkspace(nextProjectId, {
          executorNodeId: nextExecutorId,
          agentType: createState.agentType,
          executionModel: nextExecutionModel || undefined,
          agentSettings: createState.agentSettings,
          workingDirectoryMode: nextWorkingDirectoryMode,
          autoCommitEnabled: nextAutoCommitEnabled,
          name: fallbackName,
          initialPrompt: startAgent ? nextInitialPrompt || undefined : undefined,
          imageFilename: startAgent ? nextImages[0]?.filename : undefined,
          suggestedBaseBranch: needsBranch ? nextSelectedBranch : undefined,
          nameOrigin: nextTitleOrigin,
          titleOrigin: nextTitleOrigin,
        }),
        createSession: (workspaceResponse) => api.createWorkspaceSession(workspaceResponse.workspace.id, {
              agentType: createState.agentType,
              executionModel: nextExecutionModel || undefined,
              agentSettings: createState.agentSettings,
              baseBranch: needsBranch ? nextSelectedBranch : undefined,
              createNewSession: true,
              title: workspaceResponse.workspace.name,
              titleOrigin: workspaceResponse.workspaceTitleOrigin ?? nextTitleOrigin,
        }),
        startAgent,
        initialPrompt: nextInitialPrompt,
        images: nextImages,
        deferUntilWorkspaceReady: nextWorkingDirectoryMode === 'worktree',
        onSessionCreate: () => setCreateState((current) => ({ ...current, creatingStep: 'session' })),
        onUploadStart: () => setCreateState((current) => ({
          ...current,
          images: current.images.map((image) => ({
            ...image,
            uploadState: 'uploading',
            uploadProgress: 0,
            uploadError: undefined,
          })),
        })),
        uploadImage: async (taskId, image) => {
          const source = nextImages.find((item) => item.id === image.id)!
          const result = await api.uploadImage(taskId, await readWorkspaceCreationImage(source.file), image.filename)
          return { id: result.id, url: result.url, filename: image.filename, contentType: image.contentType }
        },
        onUploadSuccess: (image) => setCreateState((current) => ({
              ...current,
              images: current.images.map((item) => item.id === image.id
                ? { ...item, uploadProgress: 100 }
                : item),
        })),
        onUploadError: (image, error) => {
          const message = error instanceof Error ? error.message : t('workspace.createPanel.imageUploadFailed', { defaultValue: '图片上传失败。' })
          setCreateState((current) => ({
              ...current,
              images: current.images.map((item) => item.id === image.id
                ? { ...item, uploadState: 'failed', uploadError: message }
                : item),
          }))
          toast.error(message)
        },
        enqueueInitialMessage: (input) => api.enqueueTaskChatMessage(
            input.taskId,
            input.message,
            input.workspaceId,
            input.workspaceSessionId,
            input.attachments,
            undefined,
            undefined,
            {
              deferUntilWorkspaceReady: input.deferUntilWorkspaceReady,
              dedupeKey: `workspace-initial:${input.taskId}:${input.workspaceId}:${input.workspaceSessionId}`,
            },
        ),
        onInitialMessageError: (error) => {
          toast.error(error instanceof Error ? error.message : t('workspace.createPanel.initialMessageSendFailed', { defaultValue: '工作区已创建，但首条消息发送失败。' }))
        },
      })
      const { response, taskId: nextTaskId, workspaceSessionId: nextWorkspaceSessionId } = creation

      if (response.state) {
        setState(response.state)
      }

      setSelectedProjectId(nextProjectId)
      const nextSearch = buildWorkspaceRouteSearch({
        projectId: nextProjectId,
        workspaceId: response.workspace.id,
        workspaceSessionId: nextWorkspaceSessionId || undefined,
        taskId: nextTaskId || undefined,
      })
      const params = new URLSearchParams()
      if (nextSearch.projectId) params.set('projectId', nextSearch.projectId)
      if (nextSearch.workspaceId) params.set('workspaceId', nextSearch.workspaceId)
      if (nextSearch.workspaceSessionId) params.set('workspaceSessionId', nextSearch.workspaceSessionId)
      if (nextSearch.taskId) params.set('taskId', nextSearch.taskId)
      window.location.href = params.toString() ? `/workspace?${params.toString()}` : '/workspace'
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.page.errors.createFailed'))
      setCreateState((current) => ({ ...current, busy: false, creatingStep: '' }))
    }
  }

  const handleSelectPromptSuggestion = (prompt: string) => {
    const nextPrompt = prompt.trim()
    if (!nextPrompt || createState.busy) {
      return
    }

    setCreateState((current) => ({
      ...current,
      initialPrompt: nextPrompt,
    }))
  }

  const openWorkspaceFromOnboarding = (projectId?: string, create?: boolean) => {
    const nextProjectId = projectId || currentProject?.id || state.projects[0]?.id || undefined
    if (nextProjectId) {
      setSelectedProjectId(nextProjectId)
    }
    const nextSearch = buildWorkspaceRouteSearch({
      projectId: nextProjectId,
      workspaceId: create
        ? undefined
        : (state.projects.find((project) => project.id === nextProjectId)?.workspaceId || currentProject?.workspaceId || primaryWorkspace?.id || undefined),
      create: create ? '1' : undefined,
    })
    const params = new URLSearchParams()
    if (nextSearch.projectId) {
      params.set('projectId', nextSearch.projectId)
    }
    if (nextSearch.workspaceId) {
      params.set('workspaceId', nextSearch.workspaceId)
    }
    if (nextSearch.create) {
      params.set('create', nextSearch.create)
    }
    window.location.href = params.toString() ? `/workspace?${params.toString()}` : '/workspace'
  }

  if (!user) {
    return null
  }

  if (snapshot.completed || snapshot.skipped) {
    window.location.href = '/dashboard'
    return null
  }

  if (displayStep === 'workspace') {
    return (
      <OnboardingShell
        currentStep="workspace"
        title={t('onboarding.route.steps.workspace.title')}
        description={t('onboarding.route.steps.workspace.description')}
        nextLabel={t('onboarding.workspace.saveAndContinue')}
        nextDisabled={!primaryWorkspace || !workspaceName.trim() || workspaceSaving || isDefaultWorkspaceName(workspaceName, user.name, user.email)}
        backDisabled
        onNext={() => {
          void handleSaveWorkspaceName().then((saved) => {
            if (saved) {
              setManualStep('executor')
            }
          })
        }}
        onSkip={() => {
          void handleSkip()
        }}
      >
        <OnboardingStepWorkspace
          workspaceName={workspaceName}
          onWorkspaceNameChange={setWorkspaceName}
          saving={workspaceSaving}
        />
      </OnboardingShell>
    )
  }

  if (displayStep === 'executor') {
    return (
      <OnboardingShell
        currentStep="executor"
        title={t('onboarding.route.steps.executor.title')}
        description={t('onboarding.route.steps.executor.description')}
        onBack={goToPreviousStep}
        onNext={() => {
          goToNextStep()
        }}
        onSkip={() => {
          void handleSkip()
        }}
      >
        <OnboardingStepExecutor
          executors={executors}
          loading={executorLoading}
          pairingCode={pairingCode}
          connectCommand={connectCommand}
          pairingExpiresAt={pairingExpiresAt}
          pairingRunMode={pairingRunMode}
          pairingInstallTarget={pairingInstallTarget}
          pairingDisplayName={pairingDisplayName}
          pairingBusy={pairingBusy}
          onPairingRunModeChange={setPairingRunMode}
          onPairingInstallTargetChange={setPairingInstallTarget}
          onPairingDisplayNameChange={setPairingDisplayName}
          onCreatePairingCode={() => {
            void handleCreatePairingCode()
          }}
          onCopyConnectCommand={() => {
            void handleCopyConnectCommand()
          }}
        />
      </OnboardingShell>
    )
  }

  if (displayStep === 'runtime') {
    return (
      <OnboardingShell
        currentStep="runtime"
        title="先确认 coding agent"
        description="节点已经连上。先确认默认使用哪个 coding agent 和模型，再继续接项目。"
        nextDisabled={runtimeNextDisabled}
        onBack={goToPreviousStep}
        onNext={() => {
          void handleSaveRuntimeSelection()
        }}
        onSkip={() => {
          void handleSkip()
        }}
      >
        <OnboardingStepRuntime
          mode={runtimeSetupMode}
          onModeChange={(mode) => {
            setRuntimeSetupMode(mode)
            setRuntimeConfirmed(false)
          }}
          agentOptions={RUNTIME_AGENT_OPTIONS.map((option) => runtimeAgentDetections[option.value] ?? {
            ...option,
            status: activeRuntimeExecutor ? 'missing' : 'needs-model',
            modelCount: 0,
            defaultModel: '',
            models: [],
            reason: activeRuntimeExecutor ? '正在读取本机状态…' : '节点上线后会自动探测。',
          })}
          detectedExecutorName={activeRuntimeExecutor?.name || activeRuntimeExecutor?.machineName || ''}
          detectionLoading={runtimeDetectionLoading}
          discoveryMessage={runtimeDiscoveryMessage}
          selectedAgentType={selectedRuntimeAgentType}
          onSelectAgentType={(agentType) => {
            setSelectedRuntimeAgentType(agentType)
            setSelectedRuntimeModel('')
            setRuntimeConfirmed(false)
          }}
          modelOptions={runtimeModelOptions}
          selectedModel={selectedRuntimeModel}
          defaultModel={visibleDefaultRuntimeModel}
          onSelectModel={(model) => {
            setSelectedRuntimeModel(model)
            setRuntimeConfirmed(false)
          }}
          manualModelDraft={manualRuntimeModelDraft}
          onManualModelDraftChange={setManualRuntimeModelDraft}
          modelLoading={runtimeModelLoading}
          saving={runtimeSaving}
        />
      </OnboardingShell>
    )
  }

  if (displayStep === 'project') {
    return (
      <>
        <OnboardingShell
          currentStep="project"
          title={t('onboarding.route.steps.project.title')}
          description={t('onboarding.route.steps.project.description')}
          onBack={goToPreviousStep}
          onNext={goToNextStep}
          onSkip={() => {
            void handleSkip()
          }}
        >
          <OnboardingStepProject
            projectCount={state.projects.length}
            readyExecutors={readyExecutors}
            autoCreating={projectAutoCreating}
            autoCreatedProjectName={autoCreatedProjectName}
            onCreateLocalProject={() => {
              setProjectModalMode('create')
              setProjectModalCloneSource('manual')
              setProjectModalOpen(true)
            }}
            onCloneProject={() => {
              setProjectModalMode('clone')
              setProjectModalCloneSource('manual')
              setProjectModalOpen(true)
            }}
            onConnectGitHubProject={() => {
              setProjectModalMode('clone')
              setProjectModalCloneSource('github-app')
              setProjectModalOpen(true)
            }}
          />
        </OnboardingShell>
        <CreateProjectModal
          open={projectModalOpen}
          onOpenChange={setProjectModalOpen}
          mode={projectModalMode}
          initialCloneSource={projectModalCloneSource}
          preferredExecutorId={readyExecutors[0]?.executorId || ''}
          flow="onboarding"
        />
      </>
    )
  }

  if (displayStep === 'first-task') {
    return (
      <OnboardingShell
        currentStep="first-task"
        title="开始工作"
        description="直接输入你想让 AI 做什么，然后开始第一轮协作。"
        footerHidden
        contentBare
      >
        <OnboardingStepFirstTask
          busy={createState.busy}
          agentSettings={settingsDraft.agentSettings}
          createState={createState}
          defaultModel={createDefaultModel}
          executorOptions={readyExecutors}
          modelLoading={createModelLoading}
          modelOptions={createModelOptions}
          promptSuggestions={ONBOARDING_PROMPT_SUGGESTIONS}
          projects={state.projects}
          onBack={goToPreviousStep}
          onGoControlPanel={() => {
            openWorkspaceFromOnboarding(currentProject?.id)
          }}
          onCreate={handleCreateWorkspaceFromOnboarding}
          onSelectPromptSuggestion={handleSelectPromptSuggestion}
          onUpdate={handleUpdateCreateState}
        />
      </OnboardingShell>
    )
  }

  if (snapshot.nextStep === 'done') {
    return (
      <OnboardingShell
        currentStep={snapshot.nextStep}
        title={t('onboarding.route.steps.done.title')}
        description={t('onboarding.route.steps.done.description')}
        nextLabel={t('onboarding.route.steps.done.nextLabel')}
        onBack={() => {
          window.location.href = '/dashboard'
        }}
        onNext={() => {
          window.location.href = '/kanban'
        }}
        onSkip={() => {
          window.location.href = '/dashboard'
        }}
      >
        <OnboardingStepDone
          onGoKanban={() => {
            window.location.href = '/kanban'
          }}
          onGoExecution={() => {
            window.location.href = '/execution'
          }}
          onGoSettings={() => {
            window.location.href = '/settings'
          }}
        />
      </OnboardingShell>
    )
  }

  return (
    null
  )
}
