import type { AppState } from '@shared/types'

export const getLegacyStorageMode = () => 'postgres'

export const isD1Enabled = () => false

export const syncBoardStateToLegacyStorage = async (_state: AppState) => ({
  enabled: true,
  message: 'State writes are persisted through the Postgres-backed store.',
})
