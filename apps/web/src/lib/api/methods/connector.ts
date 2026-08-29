import { request } from '../client'

export type ConnectorProviderAuthField = {
  type: string
  label?: string
  placeholder?: string
  description?: string
}

export type ConnectorProviderRecord = {
  service: string
  displayName: string
  description?: string
  iconUrl?: string
  categories?: string[]
  authTypes?: string[]
  auth?: ConnectorProviderAuthField[]
  homepageUrl?: string
  execution?: {
    actionCount?: number
    locallyExecutableActionCount?: number
  }
  actions?: Array<{ id: string; name: string; description?: string }>
}

export type ConnectorConnectionProfile = {
  accountId?: string
  displayName?: string
  grantedScopes?: string[]
}

export type ConnectorConnectionRecord = {
  id: string
  service: string
  connectionName: string
  authType: string
  ownerUserId: string
  workspaceId?: string
  visibility: 'personal' | 'workspace'
  status: 'ok' | 'error'
  message?: string
  accountLabel?: string
  runtimeConfigured?: boolean
}

export const connectorMethods = {
  listConnectorProviders: () =>
    request<ConnectorProviderRecord[]>('/api/connector/providers'),
  listConnectorConnections: (workspaceId?: string) =>
    request<ConnectorConnectionRecord[]>(`/api/connector/connections${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`),
  createConnectorConnection: (service: string, payload: { authType: string; values: Record<string, string>; connectionName?: string; workspaceId?: string }) =>
    request<{ ok: boolean; connection?: ConnectorConnectionRecord; error?: { code?: string; message?: string } }>(`/api/connector/connections/${encodeURIComponent(service)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteConnectorConnection: (id: string) =>
    request<unknown>(`/api/connector/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  updateConnectorConnection: (id: string, payload: { visibility: 'personal' | 'workspace'; workspaceId?: string }) =>
    request<{ ok: boolean; connection?: ConnectorConnectionRecord }>(`/api/connector/connections/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  runConnectorAction: (actionId: string, payload: { input?: Record<string, unknown>; connectionName?: string }) =>
    request<unknown>(`/api/connector/actions/${encodeURIComponent(actionId)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
}
