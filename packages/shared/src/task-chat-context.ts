// [INPUT]: 任务对话上下文输入
// [OUTPUT]: 上下文契约
// [POS]: 任务对话上下文
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

const normalizeOptionalString = (value: unknown) => {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export type TaskChatContextRef =
  | {
      kind: 'workspace_file'
      workspaceId: string
      workspaceSessionId: string
      path: string
    }
  | {
      kind: 'project'
      projectId: string
    }

export const normalizeTaskChatContextRefs = (value: unknown): TaskChatContextRef[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const normalized: TaskChatContextRef[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const kind = normalizeOptionalString(record.kind)
    if (kind === 'workspace_file') {
      const workspaceId = normalizeOptionalString(record.workspaceId)
      const workspaceSessionId = normalizeOptionalString(record.workspaceSessionId)
      const path = normalizeOptionalString(record.path)
      if (!workspaceId || !workspaceSessionId || !path) {
        continue
      }
      const dedupeKey = `${kind}:${workspaceId}:${workspaceSessionId}:${path}`
      if (seen.has(dedupeKey)) {
        continue
      }
      seen.add(dedupeKey)
      normalized.push({
        kind,
        workspaceId,
        workspaceSessionId,
        path,
      })
      continue
    }

    if (kind === 'project') {
      const projectId = normalizeOptionalString(record.projectId)
      if (!projectId) {
        continue
      }
      const dedupeKey = `${kind}:${projectId}`
      if (seen.has(dedupeKey)) {
        continue
      }
      seen.add(dedupeKey)
      normalized.push({
        kind,
        projectId,
      })
    }
  }

  return normalized
}
