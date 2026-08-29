// [INPUT]: 任务事件
// [OUTPUT]: 单调序号
// [POS]: 任务事件序号（去重）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export const createWorkerTaskEventSequence = (initialSequence = 0) => {
  let sequence = initialSequence
  return () => ++sequence
}
