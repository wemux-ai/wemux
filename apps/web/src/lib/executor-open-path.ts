import { api } from './api'

type ResolveOpenableDirectoryProbeEvent = {
  candidatePath: string
  durationMs?: number
  index: number
  message?: string
  ok?: boolean
  total: number
}

type ResolveFirstOpenableExecutorDirectoryOptions = {
  onProbeFinish?: (event: ResolveOpenableDirectoryProbeEvent) => void
  onProbeStart?: (event: ResolveOpenableDirectoryProbeEvent) => void
}

const normalizeCandidatePaths = (candidatePaths: string[]) => {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const candidatePath of candidatePaths) {
    const value = candidatePath.trim()
    if (!value || seen.has(value)) {
      continue
    }
    seen.add(value)
    normalized.push(value)
  }

  return normalized
}

export const resolveFirstOpenableExecutorDirectory = async (
  executorId: string,
  candidatePaths: string[],
  options?: ResolveFirstOpenableExecutorDirectoryOptions,
) => {
  const normalizedCandidatePaths = normalizeCandidatePaths(candidatePaths)
  if (normalizedCandidatePaths.length <= 1) {
    return normalizedCandidatePaths
  }

  for (const [index, candidatePath] of normalizedCandidatePaths.entries()) {
    const startedAt = globalThis.performance?.now?.() ?? Date.now()
    options?.onProbeStart?.({
      candidatePath,
      index: index + 1,
      total: normalizedCandidatePaths.length,
    })

    try {
      const result = await api.browseExecutorDirectory(executorId, candidatePath)
      const durationMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt
      options?.onProbeFinish?.({
        candidatePath,
        durationMs,
        index: index + 1,
        message: result.message,
        ok: result.ok,
        total: normalizedCandidatePaths.length,
      })
      if (result.ok) {
        return [candidatePath]
      }
    } catch (error) {
      const durationMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt
      options?.onProbeFinish?.({
        candidatePath,
        durationMs,
        index: index + 1,
        message: error instanceof Error ? error.message : '目录探测失败。',
        ok: false,
        total: normalizedCandidatePaths.length,
      })
      // Ignore directory probe failures and fall back to the next candidate path.
    }
  }

  return [normalizedCandidatePaths[0]]
}
