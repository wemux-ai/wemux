// [INPUT]: 配对码输入
// [OUTPUT]: 复用检测
// [POS]: 配对码复用
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { WorkerConfig } from '@shared/types'

type WorkerPairingSnapshot = Pick<WorkerConfig, 'executorId' | 'executorToken' | 'lastPairedPairingCode'>

export const normalizeReusablePairingCode = (pairingCode?: string) => {
  return pairingCode?.trim().toUpperCase() || ''
}

export const hasSavedWorkerPairing = (config: WorkerPairingSnapshot) => {
  return Boolean(config.executorId?.trim() && config.executorToken?.trim())
}

export const shouldReuseSavedWorkerPairing = (pairingCode: string, config: WorkerPairingSnapshot) => {
  const normalizedPairingCode = normalizeReusablePairingCode(pairingCode)
  if (!normalizedPairingCode || !hasSavedWorkerPairing(config)) {
    return false
  }

  return normalizedPairingCode === normalizeReusablePairingCode(config.lastPairedPairingCode)
}

export const buildSavedPairingCodeReuseMessage = () => {
  return 'This pairing code already completed on this worker. Reusing the saved executor token instead of pairing again.'
}
