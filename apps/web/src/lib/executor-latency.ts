import type { ExecutorLatencySnapshot } from '@shared/types'

export type ExecutorLatencyTone = 'fast' | 'medium' | 'slow' | 'unknown'

export const formatLatencyValue = (roundTripMs?: number | null) => {
  if (typeof roundTripMs !== 'number' || !Number.isFinite(roundTripMs)) {
    return '-'
  }

  if (roundTripMs < 1000) {
    return `${Math.max(0, Math.round(roundTripMs))}ms`
  }

  if (roundTripMs < 10_000) {
    return `${(roundTripMs / 1000).toFixed(1)}s`
  }

  return `${Math.round(roundTripMs / 1000)}s`
}

export const resolveLatencyToneValue = (roundTripMs?: number | null): ExecutorLatencyTone => {
  if (typeof roundTripMs !== 'number' || !Number.isFinite(roundTripMs)) {
    return 'unknown'
  }

  if (roundTripMs < 250) {
    return 'fast'
  }

  if (roundTripMs < 800) {
    return 'medium'
  }

  return 'slow'
}

export const formatExecutorLatency = (latency?: ExecutorLatencySnapshot | null) => {
  return formatLatencyValue(latency?.roundTripMs)
}

export const resolveExecutorLatencyTone = (latency?: ExecutorLatencySnapshot | null): ExecutorLatencyTone => {
  return resolveLatencyToneValue(latency?.roundTripMs)
}
