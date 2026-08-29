// [INPUT]: 设置路由 search 输入
// [OUTPUT]: 解析
// [POS]: 设置路由 search
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { SettingsMenuId } from '../components/settings/settings-page-shared'

const allowedSettingsSections = new Set<SettingsMenuId>([
  'profile',
  'git',
  'workspace',
  'workspaceOpen',
  'runtime',

  'usage',
  'notifications',
  'localNetworkAccess',
  'desktop',
  'floatingChat',
  'apiTokens',
  'experimental',
])

export const parseSettingsRouteSearch = (search: Record<string, unknown>) => ({
  section: typeof search.section === 'string' && allowedSettingsSections.has(search.section as SettingsMenuId)
    ? search.section as SettingsMenuId
    : undefined,
  workspaceId: typeof search.workspaceId === 'string' && search.workspaceId.trim()
    ? search.workspaceId.trim()
    : undefined,
})
