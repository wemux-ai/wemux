import { ArrowUpRight } from 'lucide-react'
import { Button } from '../ui/button'
import type { AgentSettings, ExecutionModelOption, ExecutorRecord, Project } from '@shared/types'
import type { CreateWorkspaceState } from '../workspaces/workspaces-create-panel'
import { WorkspacesCreatePanel } from '../workspaces/workspaces-create-panel'

export function OnboardingStepFirstTask({
  busy,
  agentSettings,
  createState,
  defaultModel,
  executorOptions,
  modelLoading,
  modelOptions,
  promptSuggestions,
  projects,
  onBack,
  onGoControlPanel,
  onCreate,
  onSelectPromptSuggestion,
  onUpdate,
}: {
  busy: boolean
  agentSettings: AgentSettings
  createState: CreateWorkspaceState
  defaultModel: string
  executorOptions: ExecutorRecord[]
  modelLoading: boolean
  modelOptions: ExecutionModelOption[]
  promptSuggestions: Array<{ label: string; prompt: string }>
  projects: Project[]
  onBack: () => void
  onGoControlPanel: () => void
  onCreate: (options?: { startAgent?: boolean }) => Promise<void>
  onSelectPromptSuggestion: (prompt: string) => void
  onUpdate: (patch: Partial<CreateWorkspaceState>) => void
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center -translate-y-5">
      <div className="w-full max-w-[68rem] px-4">
        <div className="flex flex-col items-end gap-3">
          <WorkspacesCreatePanel
            busy={busy}
            agentSettings={agentSettings}
            createState={createState}
            defaultModel={defaultModel}
            embedded
            executorOptions={executorOptions}
            githubAppConfigured
            githubAppInstallations={[]}
            githubRepositories={[]}
            githubRepositoriesLoading={false}
            modelLoading={modelLoading}
            modelOptions={modelOptions}
            promptSuggestions={promptSuggestions}
            projects={projects}
            onBack={onBack}
            onCancel={onGoControlPanel}
            onCreate={onCreate}
            onSelectPromptSuggestion={onSelectPromptSuggestion}
            onUpdate={onUpdate}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={onGoControlPanel}
            className="h-10 rounded-full border border-zinc-800/80 bg-[#09090b]/88 px-3.5 text-xs text-zinc-300 shadow-[0_12px_36px_rgba(0,0,0,0.22)] backdrop-blur-md hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100"
          >
            直接进入控制面板
            <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
