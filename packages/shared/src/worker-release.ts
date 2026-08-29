// [INPUT]: worker 发布输入
// [OUTPUT]: 发布契约
// [POS]: worker 发布类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type WorkerReleaseChannel = 'preview' | 'production'

export type WorkerReleaseStatus = {
  channel: WorkerReleaseChannel
  packageName: string
  packageTag: string
  latestVersion?: string
  checkedAt: string
  ok: boolean
  message?: string
}

export type WorkerReleaseStatusMap = {
  preview: WorkerReleaseStatus
  production: WorkerReleaseStatus
}
