// [INPUT]: Git 分支输入
// [OUTPUT]: 分支生成/校验
// [POS]: 任务 Git 分支工具
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

const normalizeBranchSegment = (value: string) => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'task'
}

export const getTaskGitBranchName = (taskId: string) => `task/${normalizeBranchSegment(taskId)}`
