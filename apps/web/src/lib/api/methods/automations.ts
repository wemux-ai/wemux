import type {
  AutomationDetail,
  AutomationListItem,
  AutomationMutationPayload,
  AutomationUpdatePayload,
  AutomationRunMutationPayload,
  AutomationTriggerMutationPayload,
  AutomationTriggerSecretResponse,
  AutomationTriggerUpdatePayload,
} from '../types'
import { request } from '../client'

export const automationsMethods = {
  listProjectAutomations: (projectId: string) =>
    request<{ automations: AutomationListItem[] }>(`/api/projects/${projectId}/automations`),
  createAutomation: (projectId: string, payload: AutomationMutationPayload) =>
    request<{ automation: AutomationListItem }>(`/api/projects/${projectId}/automations`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getAutomation: (automationId: string) =>
    request<{ automation: AutomationDetail }>(`/api/automations/${automationId}`),
  updateAutomation: (automationId: string, payload: AutomationUpdatePayload) =>
    request<{ automation: AutomationListItem }>(`/api/automations/${automationId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  runAutomation: (automationId: string, payload?: AutomationRunMutationPayload) =>
    request<{ run: AutomationDetail['runs'][number] }>(`/api/automations/${automationId}/run`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  createAutomationTrigger: (automationId: string, payload: AutomationTriggerMutationPayload) =>
    request<AutomationTriggerSecretResponse>(`/api/automations/${automationId}/triggers`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateAutomationTrigger: (triggerId: string, payload: AutomationTriggerUpdatePayload) =>
    request<{ trigger: AutomationDetail['triggers'][number] }>(`/api/automation-triggers/${triggerId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteAutomationTrigger: (triggerId: string) =>
    request<{ ok: boolean }>(`/api/automation-triggers/${triggerId}`, {
      method: 'DELETE',
    }),
  rotateAutomationTriggerSecret: (triggerId: string) =>
    request<AutomationTriggerSecretResponse>(`/api/automation-triggers/${triggerId}/rotate-secret`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  fireAutomationTrigger: (triggerId: string, payload?: AutomationRunMutationPayload) =>
    request<{ run: AutomationDetail['runs'][number] }>(`/api/automation-triggers/${triggerId}/fire`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
}
