// [INPUT]: 向导状态输入
// [OUTPUT]: 分步进度
// [POS]: Onboarding 契约
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type OnboardingStep = 'workspace' | 'executor' | 'runtime' | 'project' | 'first-task' | 'done'

export type OnboardingSnapshotInput = {
  onboardingCompletedAt?: string
  onboardingDismissedAt?: string
  workspaceReady: boolean
  executorCount: number
  runtimeReady: boolean
  projectCount: number
  taskCount: number
}

export type OnboardingSnapshot = {
  completed: boolean
  skipped: boolean
  nextStep: OnboardingStep
}

export const deriveOnboardingSnapshot = (
  input: OnboardingSnapshotInput,
): OnboardingSnapshot => {
  const completed = Boolean(input.onboardingCompletedAt)
  const skipped = Boolean(input.onboardingDismissedAt)

  if (completed) {
    return { completed, skipped, nextStep: 'done' }
  }

  if (!input.workspaceReady) {
    return { completed, skipped, nextStep: 'workspace' }
  }

  if (input.executorCount < 1) {
    return { completed, skipped, nextStep: 'executor' }
  }

  if (!input.runtimeReady) {
    return { completed, skipped, nextStep: 'runtime' }
  }

  if (input.projectCount < 1) {
    return { completed, skipped, nextStep: 'project' }
  }

  return { completed, skipped, nextStep: 'first-task' }
}
