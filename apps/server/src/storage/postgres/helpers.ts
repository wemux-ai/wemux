export const schedulePersistence = (label: string, action: Promise<unknown>) => {
  void action.catch((error) => {
    persistenceFailures += 1
    console.error(`[postgres] ${label} failed`, error)
  })
}

// fire-and-forget 写入失败计数（P1-4 可观测性）：核心写入迁移完成前，这里必须能告警。
let persistenceFailures = 0
export const getPersistenceFailureCount = () => persistenceFailures

export const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
