import type { ExecutorSkillScanResult } from '@shared/types'

export declare const scanLocalSkills: (
  workspaceRoot: string,
  rootPath: string,
) => Promise<ExecutorSkillScanResult>
