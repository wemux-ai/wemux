/**
 * [INPUT]: Workspace metadata, current workspace session, environment settings, and save callbacks.
 * [OUTPUT]: Workspace settings UI with scoped template and runtime environment persistence.
 * [POS]: Workspace-detail settings surface; writes environment files for the active workspace session.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ArrowUpRight, Info } from 'lucide-react'
import type { Project, ProjectEnvironmentPort, Workspace } from '@shared/types'
import { validateProjectEnvironmentPreviewPorts } from '@shared/types'
import { normalizeRuntimeEnvironmentConfig, type RuntimeEnvironmentConfig, type RuntimeEnvironmentSummary } from '@shared/runtime-environment'
import { isImeComposingKeyboardEvent } from '../../lib/ime-keyboard'
import { api } from '../../lib/api'
import { normalizeEnvironmentPortDrafts } from '../../lib/preview-domain-bindings'
import { workspaceQueryKeys } from '../../lib/workspace-query-keys'
import { toast } from 'sonner'
import { EnvironmentTemplateEditor, type EnvironmentTemplateEditorValue } from '../environment-template-editor'
import { RuntimeEnvironmentEditor } from '../runtime-environment-editor'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { SettingsDialogShell } from '../ui/settings-dialog-shell'
import { Switch } from '../ui/switch'

interface WorkspaceSettingsDialogProps {
  open: boolean
  workspace: Workspace | null
  workspaceSessionId?: string
  project?: Project | null
  autoCommitEnabled: boolean
  nameDraft: string
  renameBusy?: boolean
  saving?: boolean
  onOpenProjectSettings?: (projectId: string) => void
  onOpenChange: (open: boolean) => void
  onNameDraftChange: (value: string) => void
  onRename: () => void
  onAutoCommitEnabledChange: (enabled: boolean) => void
  onEnvironmentTemplateChange?: (template: WorkspaceEnvironmentTemplate, effectiveTemplate: WorkspaceEnvironmentTemplate) => void
  onSave: () => void
}

const workspaceModeLabel: Record<Workspace['workingDirectoryMode'], string> = {
  worktree: '隔离目录（worktree）',
  'original-dir': '原始目录',
}

type WorkspaceSettingsSectionId = 'overview' | 'git-policy' | 'env-template' | 'env'
type WorkspaceEnvironmentTemplate = Project['environmentTemplate'] | null

type WorkspaceEnvironmentTemplateDraft = {
  installCommand: string
  buildCommand: string
  testCommand: string
  lintCommand: string
  branchNamePattern: string
  startCommandTemplate: string
  stopCommandTemplate: string
  nukeCommandTemplate: string
  appPort: string
  healthPath: string
  logsCommandTemplate: string
  ports: ProjectEnvironmentPort[]
}

const createEmptyEnvironmentTemplateDraft = (): WorkspaceEnvironmentTemplateDraft => ({
  installCommand: '',
  buildCommand: '',
  testCommand: '',
  lintCommand: '',
  branchNamePattern: '',
  startCommandTemplate: '',
  stopCommandTemplate: '',
  nukeCommandTemplate: '',
  appPort: '',
  healthPath: '',
  logsCommandTemplate: '',
  ports: [],
})

const templateToDraft = (template?: WorkspaceEnvironmentTemplate | null): WorkspaceEnvironmentTemplateDraft => {
  const ports = template?.ports ?? []

  return {
    installCommand: template?.installCommand ?? '',
    buildCommand: template?.buildCommand ?? '',
    testCommand: template?.testCommand ?? '',
    lintCommand: template?.lintCommand ?? '',
    branchNamePattern: template?.branchNamePattern ?? '',
    startCommandTemplate: template?.startCommandTemplate ?? '',
    stopCommandTemplate: template?.stopCommandTemplate ?? '',
    nukeCommandTemplate: template?.nukeCommandTemplate ?? '',
    appPort: template?.appPort ?? '',
    healthPath: template?.healthPath ?? '',
    logsCommandTemplate: template?.logsCommandTemplate ?? '',
    ports: normalizeEnvironmentPortDrafts(ports),
  }
}

const draftToTemplate = (draft: WorkspaceEnvironmentTemplateDraft): WorkspaceEnvironmentTemplate => {
  const ports = normalizeEnvironmentPortDrafts(draft.ports)

  const template = {
    installCommand: draft.installCommand.trim() || undefined,
    buildCommand: draft.buildCommand.trim() || undefined,
    testCommand: draft.testCommand.trim() || undefined,
    lintCommand: draft.lintCommand.trim() || undefined,
    branchNamePattern: draft.branchNamePattern.trim() || undefined,
    startCommandTemplate: draft.startCommandTemplate.trim() || undefined,
    stopCommandTemplate: draft.stopCommandTemplate.trim() || undefined,
    nukeCommandTemplate: draft.nukeCommandTemplate.trim() || undefined,
    appPort: draft.appPort.trim() || undefined,
    healthPath: draft.healthPath.trim() || undefined,
    logsCommandTemplate: draft.logsCommandTemplate.trim() || undefined,
    ports: ports.length > 0 ? ports : undefined,
    source: 'manual' as const,
  } satisfies NonNullable<WorkspaceEnvironmentTemplate>

  return (
    template.installCommand
    || template.buildCommand
    || template.testCommand
    || template.lintCommand
    || template.branchNamePattern
    || template.startCommandTemplate
    || template.stopCommandTemplate
    || template.nukeCommandTemplate
    || template.appPort
    || template.healthPath
    || template.logsCommandTemplate
    || (template.ports?.length ?? 0) > 0
  ) ? template : null
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-zinc-50">{title}</h2>
        <p className="text-sm leading-6 text-zinc-400">{description}</p>
      </div>
      {children}
    </section>
  )
}

function SettingsRow({
  label,
  hint,
  children,
  last = false,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <div className={cn('space-y-3 py-5', last ? '' : 'border-b border-zinc-900')}>
      <div className="space-y-1">
        <p className="text-sm font-medium text-zinc-100">{label}</p>
        {hint ? <p className="text-xs leading-5 text-zinc-500">{hint}</p> : null}
      </div>
      {children}
    </div>
  )
}

function InheritanceNotice({
  title,
  description,
  projectId,
  onOpenProjectSettings,
}: {
  title: string
  description: string
  projectId?: string
  onOpenProjectSettings?: (projectId: string) => void
}) {
  return (
    <div className="flex flex-col gap-3 border border-sky-500/20 bg-sky-500/10 p-4 text-sm text-sky-100 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
        <div className="min-w-0">
          <p className="font-medium text-sky-50">{title}</p>
          <p className="mt-1 text-xs leading-5 text-sky-100/75">{description}</p>
        </div>
      </div>
      {projectId && onOpenProjectSettings ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onOpenProjectSettings(projectId)}
          className="h-8 shrink-0 rounded-md border border-sky-400/20 bg-sky-400/10 px-2.5 text-xs text-sky-50 hover:bg-sky-400/20 hover:text-white"
        >
          项目设置
          <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

export function WorkspaceSettingsDialog({
  open,
  workspace,
  workspaceSessionId,
  project,
  autoCommitEnabled,
  nameDraft,
  renameBusy = false,
  saving = false,
  onOpenProjectSettings,
  onOpenChange,
  onNameDraftChange,
  onRename,
  onAutoCommitEnabledChange,
  onEnvironmentTemplateChange,
  onSave,
}: WorkspaceSettingsDialogProps) {
  const queryClient = useQueryClient()
  const autoCommitSwitchId = workspace ? `workspace-settings-auto-commit-${workspace.id}` : 'workspace-settings-auto-commit'
  const renameDisabled = !workspace || renameBusy || nameDraft.trim().length === 0 || nameDraft.trim() === workspace.name
  const [runtimeEnvironmentConfig, setRuntimeEnvironmentConfig] = useState<RuntimeEnvironmentConfig | null>(null)
  const [runtimeEnvironmentSummary, setRuntimeEnvironmentSummary] = useState<RuntimeEnvironmentSummary | null>(null)
  const [projectRuntimeEnvironmentSummary, setProjectRuntimeEnvironmentSummary] = useState<RuntimeEnvironmentSummary | null>(null)
  const [runtimeEnvironmentLoading, setRuntimeEnvironmentLoading] = useState(false)
  const [runtimeEnvironmentSaving, setRuntimeEnvironmentSaving] = useState(false)
  const [environmentTemplateDraft, setEnvironmentTemplateDraft] = useState<WorkspaceEnvironmentTemplateDraft>(createEmptyEnvironmentTemplateDraft)
  const [workspaceEnvironmentTemplate, setWorkspaceEnvironmentTemplate] = useState<WorkspaceEnvironmentTemplate>(null)
  const [effectiveEnvironmentTemplate, setEffectiveEnvironmentTemplate] = useState<WorkspaceEnvironmentTemplate>(null)
  const [environmentTemplateLoading, setEnvironmentTemplateLoading] = useState(false)
  const [environmentTemplateSaving, setEnvironmentTemplateSaving] = useState(false)
  const [environmentTemplateImporting, setEnvironmentTemplateImporting] = useState(false)
  const [workspaceSettingsSyncing, setWorkspaceSettingsSyncing] = useState(false)
  const [activeSection, setActiveSection] = useState<WorkspaceSettingsSectionId>('overview')

  const sectionItems: Array<{
    id: WorkspaceSettingsSectionId
    label: string
    description: string
  }> = [
    { id: 'overview', label: '基本信息', description: '名称与目录模式' },
    { id: 'git-policy', label: '提交策略', description: '自动提交与推送行为' },
    { id: 'env-template', label: '环境模板', description: '工作区级命令覆盖' },
    { id: 'env', label: '环境变量', description: '工作区级覆盖变量' },
  ]

  useEffect(() => {
    if (!open || !workspace) {
      setRuntimeEnvironmentConfig(null)
      setRuntimeEnvironmentSummary(null)
      setProjectRuntimeEnvironmentSummary(null)
      setRuntimeEnvironmentLoading(false)
      setWorkspaceEnvironmentTemplate(null)
      setEffectiveEnvironmentTemplate(null)
      setEnvironmentTemplateDraft(createEmptyEnvironmentTemplateDraft())
      setEnvironmentTemplateLoading(false)
      return
    }

    let cancelled = false
    setEnvironmentTemplateLoading(true)
    void queryClient.fetchQuery({
      queryKey: workspaceQueryKeys.workspaceEnvironmentTemplate(workspace.id),
      queryFn: () => api.getWorkspaceEnvironmentTemplate(workspace.id),
      staleTime: 30_000,
    })
      .then((response) => {
        if (cancelled) {
          return
        }
        setWorkspaceEnvironmentTemplate(response.template)
        setEffectiveEnvironmentTemplate(response.effectiveTemplate)
        setEnvironmentTemplateDraft(templateToDraft(response.template))
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setWorkspaceEnvironmentTemplate(null)
        setEffectiveEnvironmentTemplate(null)
        setEnvironmentTemplateDraft(createEmptyEnvironmentTemplateDraft())
      })
      .finally(() => {
        if (!cancelled) {
          setEnvironmentTemplateLoading(false)
        }
      })

    setRuntimeEnvironmentLoading(true)
    void queryClient.fetchQuery({
      queryKey: workspaceQueryKeys.workspaceRuntimeEnvironment(workspace.id),
      queryFn: () => api.getWorkspaceRuntimeEnvironment(workspace.id),
      staleTime: 30_000,
    })
      .then((response) => {
        if (cancelled) {
          return
        }
        setRuntimeEnvironmentConfig(response.config)
        setRuntimeEnvironmentSummary(response.summary)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setRuntimeEnvironmentConfig(null)
        setRuntimeEnvironmentSummary(null)
      })
      .finally(() => {
        if (!cancelled) {
          setRuntimeEnvironmentLoading(false)
        }
      })

    setProjectRuntimeEnvironmentSummary(null)
    if (project?.id) {
      void api.getProjectRuntimeEnvironment(project.id)
        .then((response) => {
          if (!cancelled) {
            setProjectRuntimeEnvironmentSummary(response.summary)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setProjectRuntimeEnvironmentSummary(null)
          }
        })
    } else {
      setProjectRuntimeEnvironmentSummary(null)
    }

    return () => {
      cancelled = true
    }
  }, [open, project?.id, queryClient, workspace])

  useEffect(() => {
    if (!open) {
      setActiveSection('overview')
    }
  }, [open])

  const handleSaveRuntimeEnvironment = async () => {
    if (!workspace) {
      return
    }

    setRuntimeEnvironmentSaving(true)
    try {
      const response = await api.updateWorkspaceRuntimeEnvironment(workspace.id, {
        config: normalizeRuntimeEnvironmentConfig(runtimeEnvironmentConfig),
        workspaceSessionId,
      })
      queryClient.setQueryData(workspaceQueryKeys.workspaceRuntimeEnvironment(workspace.id), response)
      setRuntimeEnvironmentConfig(response.config)
      setRuntimeEnvironmentSummary(response.summary)
      if (response.fileWrite && !response.fileWrite.ok) {
        toast.warning(response.message || response.fileWrite.message || '配置已保存，但工作区环境变量文件未写入。')
      } else {
        if (response.fileWrite?.ok) {
          void queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.filesDirectoryExecutorScope(workspace.executorNodeId) })
        }
        toast.success(response.message || '工作区环境变量已保存')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存工作区环境变量失败')
    } finally {
      setRuntimeEnvironmentSaving(false)
    }
  }

  const handleSaveEnvironmentTemplate = async () => {
    if (!workspace) {
      return
    }

    const duplicatePorts = validateProjectEnvironmentPreviewPorts({
      appPort: environmentTemplateDraft.appPort,
      ports: environmentTemplateDraft.ports,
      previewDomainBindings: effectiveEnvironmentTemplate?.previewDomainBindings ?? project?.environmentTemplate?.previewDomainBindings,
    })
    if (duplicatePorts.length > 0) {
      toast.error(`预览端口不能重复：${duplicatePorts.join('、')}`)
      return
    }

    setEnvironmentTemplateSaving(true)
    try {
      const response = await api.updateWorkspaceEnvironmentTemplate(workspace.id, {
        template: draftToTemplate(environmentTemplateDraft),
      })
      queryClient.setQueryData(workspaceQueryKeys.workspaceEnvironmentTemplate(workspace.id), response)
      setWorkspaceEnvironmentTemplate(response.template)
      setEffectiveEnvironmentTemplate(response.effectiveTemplate)
      setEnvironmentTemplateDraft(templateToDraft(response.template))
      onEnvironmentTemplateChange?.(response.template, response.effectiveTemplate)
      toast.success(response.message || '工作区环境模板已保存')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存工作区环境模板失败')
    } finally {
      setEnvironmentTemplateSaving(false)
    }
  }

  const handleImportEnvironmentTemplate = async () => {
    if (!workspace) {
      return
    }

    setEnvironmentTemplateImporting(true)
    try {
      const response = await api.importWorkspaceEnvironmentTemplate(workspace.id, { workspaceSessionId })
      queryClient.setQueryData(workspaceQueryKeys.workspaceEnvironmentTemplate(workspace.id), response)
      setWorkspaceEnvironmentTemplate(response.template)
      setEffectiveEnvironmentTemplate(response.effectiveTemplate)
      setEnvironmentTemplateDraft(templateToDraft(response.template))
      onEnvironmentTemplateChange?.(response.template, response.effectiveTemplate)
      toast.success(response.message || '工作区环境模板已重新导入')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重新导入工作区环境模板失败')
    } finally {
      setEnvironmentTemplateImporting(false)
    }
  }

  const handleSyncWorkspaceSettings = async () => {
    if (!workspace) {
      return
    }

    setWorkspaceSettingsSyncing(true)
    try {
      const response = await api.syncWorkspaceSettings(workspace.id, { workspaceSessionId })
      queryClient.setQueryData(workspaceQueryKeys.workspaceEnvironmentTemplate(workspace.id), response)
      setWorkspaceEnvironmentTemplate(response.template)
      setEffectiveEnvironmentTemplate(response.effectiveTemplate)
      setEnvironmentTemplateDraft(templateToDraft(response.template))
      onEnvironmentTemplateChange?.(response.template, response.effectiveTemplate)
      const runtimeEnvironmentResponse = await api.getWorkspaceRuntimeEnvironment(workspace.id).catch(() => null)
      if (runtimeEnvironmentResponse) {
        setRuntimeEnvironmentConfig(runtimeEnvironmentResponse.config)
        setRuntimeEnvironmentSummary(runtimeEnvironmentResponse.summary)
      }
      toast.success(response.message || '工作区设置已同步')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '同步工作区设置失败')
    } finally {
      setWorkspaceSettingsSyncing(false)
    }
  }

  const handleOpenProjectSettings = () => {
    if (!project?.id || !onOpenProjectSettings) {
      return
    }

    onOpenProjectSettings(project.id)
  }
  const environmentTemplateEditorValue: EnvironmentTemplateEditorValue = {
    installCommand: environmentTemplateDraft.installCommand,
    startCommandTemplate: environmentTemplateDraft.startCommandTemplate,
    stopCommandTemplate: environmentTemplateDraft.stopCommandTemplate,
    logsCommandTemplate: environmentTemplateDraft.logsCommandTemplate,
    appPort: environmentTemplateDraft.appPort,
    healthPath: environmentTemplateDraft.healthPath,
    ports: environmentTemplateDraft.ports,
  }

  const handleEnvironmentTemplateChange = (value: EnvironmentTemplateEditorValue) => {
    setEnvironmentTemplateDraft((current) => ({
      ...current,
      installCommand: value.installCommand,
      startCommandTemplate: value.startCommandTemplate,
      stopCommandTemplate: value.stopCommandTemplate,
      logsCommandTemplate: value.logsCommandTemplate,
      appPort: value.appPort,
      healthPath: value.healthPath,
      ports: value.ports,
    }))
  }

  const templateInheritanceNotice = !workspaceEnvironmentTemplate && project?.environmentTemplate
    ? {
        title: '已继承项目级运行模板',
        description: '当前工作区没有单独配置运行模板，启动、停止、预览和日志命令会使用项目级模板。',
      }
    : workspaceEnvironmentTemplate && project?.environmentTemplate
      ? {
          title: '工作区运行模板覆盖中',
          description: '工作区已配置自己的运行模板；留空字段会继续回退到项目级模板。',
        }
      : null

  const runtimeEnvironmentNotice = !runtimeEnvironmentSummary && projectRuntimeEnvironmentSummary
    ? {
        title: '已继承项目级环境变量',
        description: `当前工作区没有单独配置环境变量，执行时会使用项目级 ${projectRuntimeEnvironmentSummary.variableCount} 个变量。`,
      }
    : runtimeEnvironmentSummary && projectRuntimeEnvironmentSummary
      ? {
          title: '工作区环境变量覆盖中',
          description: `执行时会合并项目级 ${projectRuntimeEnvironmentSummary.variableCount} 个变量和工作区级 ${runtimeEnvironmentSummary.variableCount} 个变量，同名变量使用工作区值。`,
        }
      : null

  return (
    <SettingsDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="工作区设置"
      description={workspace ? `调整「${workspace.name}」的执行行为。` : '调整当前工作区的执行行为。'}
      closeLabel="关闭工作区设置"
      sections={sectionItems}
      activeSection={activeSection}
      onActiveSectionChange={setActiveSection}
    >
      <div className="mx-auto w-full max-w-4xl px-4 py-6 lg:px-8 lg:py-7">
            {activeSection === 'overview' ? (
              <SettingsSection
                title="基本信息"
                description="编辑工作区名称，查看当前目录模式。"
              >
                <div className="space-y-0">
                  <SettingsRow label="工作区名称" hint="名称会显示在工作区列表和会话入口里。">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                      <Input
                        value={nameDraft}
                        onChange={(event) => onNameDraftChange(event.target.value)}
                        onKeyDown={(event) => {
                          if (isImeComposingKeyboardEvent(event)) {
                            return
                          }

                          if (event.key === 'Enter' && !renameDisabled) {
                            event.preventDefault()
                            onRename()
                          }
                        }}
                        maxLength={80}
                        disabled={!workspace || renameBusy}
                        className="h-12 rounded-md border-zinc-800 bg-zinc-950 text-sm text-zinc-100"
                      />
                      <Button
                        type="button"
                        onClick={onRename}
                        disabled={renameDisabled}
                        className="w-full rounded-md bg-zinc-100 text-zinc-950 hover:bg-zinc-200 lg:w-auto"
                      >
                        {renameBusy ? '保存中...' : '保存名字'}
                      </Button>
                    </div>
                  </SettingsRow>

                  <SettingsRow
                    label="工作目录模式"
                    hint="目录模式当前不在这里修改；项目目录统一在项目编辑的仓库设置中维护。"
                    last
                  >
                    <p className="text-lg font-semibold text-zinc-50">
                      {workspace ? workspaceModeLabel[workspace.workingDirectoryMode] : '未选择'}
                    </p>
                  </SettingsRow>
                </div>
              </SettingsSection>
            ) : null}

            {activeSection === 'git-policy' ? (
              <SettingsSection
                title="提交策略"
                description="控制 AI 修改完成后的提交和推送行为。"
              >
                <div className="space-y-0">
                  <SettingsRow
                    label="自动提交 / 推送"
                    hint={autoCommitEnabled
                      ? 'AI 修改完成后会自动提交；有凭证时也会自动推送。'
                      : 'AI 修改完成后只保留本地改动，不自动提交或推送。'}
                    last
                  >
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-4 border border-zinc-800 bg-zinc-950/70 px-4 py-4">
                        <div>
                          <p className="text-sm font-medium text-zinc-100">自动提交开关</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">修改后需要单独保存这一项。</p>
                        </div>
                        <Switch
                          id={autoCommitSwitchId}
                          checked={autoCommitEnabled}
                          onCheckedChange={onAutoCommitEnabledChange}
                          className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-zinc-700"
                        />
                      </div>
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          onClick={onSave}
                          disabled={!workspace || saving}
                          className="w-full rounded-md bg-zinc-100 text-zinc-950 hover:bg-zinc-200 sm:w-auto"
                        >
                          {saving ? '保存中...' : '保存提交策略'}
                        </Button>
                      </div>
                    </div>
                  </SettingsRow>
                </div>
              </SettingsSection>
            ) : null}

            {activeSection === 'env-template' ? (
              <SettingsSection
                title="环境模板"
                description="工作区级环境模板会覆盖项目级模板；留空的字段会继续回退到项目级。"
              >
                <div className="space-y-5">
                  {templateInheritanceNotice ? (
                    <InheritanceNotice
                      title={templateInheritanceNotice.title}
                      description={templateInheritanceNotice.description}
                      projectId={project?.id}
                      onOpenProjectSettings={onOpenProjectSettings ? handleOpenProjectSettings : undefined}
                    />
                  ) : null}
                  <div className="border border-zinc-800 bg-zinc-950/70 p-4 text-xs leading-6 text-zinc-400">
                    <p>当前工作区覆盖：{workspaceEnvironmentTemplate ? '已配置' : '未配置，完全继承项目模板'}</p>
                    <p>当前生效模板：{effectiveEnvironmentTemplate ? '可用' : '未配置'}</p>
                  </div>
                  <EnvironmentTemplateEditor
                    value={environmentTemplateEditorValue}
                    onChange={handleEnvironmentTemplateChange}
                  />
                  <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleSyncWorkspaceSettings()}
                      disabled={!workspace || environmentTemplateLoading || environmentTemplateImporting || workspaceSettingsSyncing}
                    >
                      {workspaceSettingsSyncing ? '同步中...' : '同步工作区设置'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => void handleImportEnvironmentTemplate()}
                      disabled={!workspace || environmentTemplateLoading || environmentTemplateImporting || workspaceSettingsSyncing}
                    >
                      {environmentTemplateImporting ? '导入中...' : '从工作区重新导入'}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void handleSaveEnvironmentTemplate()}
                      disabled={!workspace || environmentTemplateLoading || environmentTemplateSaving}
                      className="w-full rounded-md bg-zinc-100 text-zinc-950 hover:bg-zinc-200 sm:w-auto"
                    >
                      {environmentTemplateSaving ? '保存中...' : '保存工作区环境模板'}
                    </Button>
                  </div>
                </div>
              </SettingsSection>
            ) : null}

            {activeSection === 'env' ? (
              <SettingsSection
                title="环境变量"
                description="工作区级变量会覆盖项目级同名变量。支持 ${{ KEY }} 互相引用，以及 ${{ preview.publicUrl }} 等平台变量（执行 / 启动 Preview 时解析）。"
              >
                <div className="space-y-5">
                  {runtimeEnvironmentNotice ? (
                    <InheritanceNotice
                      title={runtimeEnvironmentNotice.title}
                      description={runtimeEnvironmentNotice.description}
                      projectId={project?.id}
                      onOpenProjectSettings={onOpenProjectSettings ? handleOpenProjectSettings : undefined}
                    />
                  ) : null}
                  <RuntimeEnvironmentEditor
                    title="工作区级环境变量"
                    description="优先级高于项目级配置；同名变量会覆盖项目值。可用 ${{ project.KEY }} / ${{ workspace.KEY }} 明确作用域。"
                    config={runtimeEnvironmentConfig}
                    summary={runtimeEnvironmentSummary}
                    onChange={setRuntimeEnvironmentConfig}
                    chrome="minimal"
                    scope="workspace"
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      onClick={() => void handleSaveRuntimeEnvironment()}
                      disabled={!workspace || runtimeEnvironmentLoading || runtimeEnvironmentSaving}
                      className="w-full rounded-md bg-zinc-100 text-zinc-950 hover:bg-zinc-200 sm:w-auto"
                    >
                      {runtimeEnvironmentSaving ? '保存中...' : '保存工作区环境变量'}
                    </Button>
                  </div>
                </div>
              </SettingsSection>
            ) : null}
      </div>
    </SettingsDialogShell>
  )
}
