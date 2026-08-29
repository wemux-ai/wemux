// [INPUT]: 版本检查输入
// [OUTPUT]: 更新状态
// [POS]: daemon 自动更新检查
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type IdleWorkerAutoUpdateState = {
  connected: boolean
  paired: boolean
  queuedTaskCount: number
  runningTaskCount: number
}

export const shouldRunIdleWorkerAutoUpdate = ({
  paired,
  queuedTaskCount,
  runningTaskCount,
}: IdleWorkerAutoUpdateState) => {
  return paired && queuedTaskCount === 0 && runningTaskCount === 0
}
