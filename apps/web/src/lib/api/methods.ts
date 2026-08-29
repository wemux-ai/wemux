/**
 * [INPUT]: Web API request/response contracts and the shared authenticated request client.
 * [OUTPUT]: Typed HTTP methods consumed by Wemux web routes and components.
 * [POS]: Web control-plane client surface; business validation stays on the server.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { bootstrapMethods } from './methods/bootstrap'
import { connectorMethods } from './methods/connector'
import { collaborationMethods } from './methods/collaboration'
import { projectsMethods } from './methods/projects'
import { automationsMethods } from './methods/automations'
import { tasksMethods } from './methods/tasks'
import { workspacesMethods } from './methods/workspaces'
import { modelsMethods } from './methods/models'
import { chatMethods } from './methods/chat'
import { executorsMethods } from './methods/executors'
import { identityMethods } from './methods/identity'
import { teamsMethods } from './methods/teams'
import { agentsMethods } from './methods/agents'
import { skillsMethods } from './methods/skills'
import { feedbackMethods } from './methods/feedback'
import { miscMethods } from './methods/misc'
import { getCommercialApiMethods } from './commercial-api-gate'
import { driveMethods } from './methods/drive'
import { overviewMethods } from './methods/overview'
import { searchMethods } from './methods/search'
import { profileMethods } from './methods/profiles'
import { connectionMethods } from './methods/connections'
import { usageMethods } from './methods/usage'
import { adminMethods } from './methods/admin'
import { railwayMethods } from './methods/railway'

export type { RuntimeEnvironmentResponse, RuntimeEnvironmentUpdatePayload, WorkspaceEnvironmentTemplateResponse, ProjectMemberCandidate, ProjectMemberInfo } from './methods/projects'
export type { ModelProfileAgentTestResult } from './methods/models'
export type { CodexAccountRecord } from './types'
export type { TaskCustomFieldDefinition, TaskCustomFieldDefinitionInput, TaskCustomFieldType } from './methods/tasks'
export type {
  ConnectorConnectionRecord,
  ConnectorConnectionProfile,
  ConnectorProviderAuthField,
  ConnectorProviderRecord,
} from './methods/connector'

/** 核心 api 对象类型：核心方法 + 商业扩展（admin-ops 等，公开版无实现）。 */
export type Api = typeof api

export const api = {
  ...bootstrapMethods,
  ...collaborationMethods,
  ...projectsMethods,
  ...automationsMethods,
  ...tasksMethods,
  ...workspacesMethods,
  ...modelsMethods,
  ...chatMethods,
  ...executorsMethods,
  ...identityMethods,
  ...teamsMethods,
  ...agentsMethods,
  ...skillsMethods,
  ...driveMethods,
  ...overviewMethods,
  ...searchMethods,
  ...profileMethods,
  ...connectionMethods,
  ...usageMethods,
  ...feedbackMethods,
  ...adminMethods,
  ...railwayMethods,
  ...connectorMethods,
  ...miscMethods,
  ...getCommercialApiMethods(),
}
