// [INPUT]: Shared task/project/workspace contracts and PostgreSQL snake-case row shapes.
// [OUTPUT]: Typed core app-state rows, including creator identity and persisted task collaboration subscriber IDs.
// [POS]: Storage mapping boundary between Drizzle rows and shared application records.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import type { CreatorIdentity, Project, Task, TaskRun, TaskWorkspaceBinding, WorkspaceSession } from '@shared/types'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { MessageReaction } from '@shared/thread-message'

export type ProjectRow = {
  id: string
  name: string
  display_order: number | null
  color: string | null
  workspace_id: string | null
  visibility: Project['visibility'] | null
  git_url: string
  local_path: string | null
  version_control: Project['versionControl'] | null
  default_branch: string | null
  preferred_executor_id: string | null
  repository_clone_status: Project['repositoryCloneStatus'] | null
  repository_clone_message: string | null
  command_presets_json: unknown
  default_command_preset_id: string | null
  environment_template_json: unknown
  recent_base_branches_json: unknown
  created_by: string | null
  creator_name: string | null
  creator_avatar_url: string | null
  created_at: string
  updated_at: string
}

export type TaskRow = {
  id: string
  project_id: string
  parent_task_id: string | null
  creator_json: CreatorIdentity | null
  origin_type: Task['originType'] | null
  origin_id: string | null
  title: string
  description: string
  assignee_id: string | null
  assignee_agent_id: string | null
  assignee_agent_group_id: string | null
  status: Task['status']
  agent_type: Task['agentType']
  execution_model: string | null
  opencode_config_json: unknown
  execution_mode: Task['executionMode'] | null
  agent_managed: Task['agentManaged'] | null
  priority: Task['priority']
  retry_count: number
  created_at: string
  started_at: string | null
  due_at: string | null
  updated_at: string
  base_branch: string | null
  acceptance_criteria: string | null
  draft_id: string | null
  draft_saved_at: string | null
  recommended_title: string | null
  command_preset_id: string | null
  base_branch_hint: string | null
  auto_review_json: unknown
  requirement_type: 'task' | 'requirement' | null
  needs_human_confirm: boolean
  agent_running_status: Task['agentRunningStatus'] | null
  current_step: string | null
  attachments_json: TaskChatAttachment[] | null
  reactions_json: MessageReaction[] | null
  completed_at: string | null
}

export type TaskCollaborationRow = {
  task_id: string
  comments_json: unknown
  subscriber_ids_json: unknown
  tool_calls_json: unknown
  history_json: unknown
  orchestration_json: unknown
  validation_checks_json: unknown
  updated_at: string
}

export type LogRow = {
  id: string
  task_id: string
  role: Task['logs'][number]['role']
  content: string
  workspace_id: string | null
  workspace_session_id: string | null
  created_at: string
}

export type TaskRunRow = {
  id: string
  task_id: string
  project_id: string
  distributed_task_id: string | null
  workspace_id: string | null
  workspace_session_id: string | null
  executor_node_id: string | null
  base_branch: string | null
  return_mode: TaskRun['returnMode'] | null
  git_identity_mode: TaskRun['gitIdentityMode'] | null
  agent_session_id: string | null
  execution_model: string | null
  usage_json: unknown
  status: TaskRun['status']
  summary: string | null
  result_json: unknown
  created_at: string
  updated_at: string
}

export type TaskWorkspaceBindingRow = {
  id: string
  task_id: string
  workspace_id: string
  status: TaskWorkspaceBinding['status']
  created_at: string
  updated_at: string
}

export type WorkspaceSessionRow = {
  id: string
  workspace_id: string
  history_task_id: string | null
  display_order: number | null
  pinned_at: string | null
  title: string | null
  title_origin: WorkspaceSession['titleOrigin'] | null
  status: WorkspaceSession['status'] | null
  session_kind: WorkspaceSession['sessionKind'] | null
  session_role: WorkspaceSession['sessionRole'] | null
  session_origin: WorkspaceSession['sessionOrigin'] | null
  parent_session_id: string | null
  root_session_id: string | null
  fork_mode: WorkspaceSession['forkMode'] | null
  forked_from_session_id: string | null
  forked_from_message_id: string | null
  fork_revision_json: unknown
  pending_revision_json: unknown
  shared_worktree_source_session_id: string | null
  executor_node_id: string | null
  agent_type: WorkspaceSession['agentType'] | null
  custom_agent_id: string | null
  custom_agent_name: string | null
  agent_invocation_mode: WorkspaceSession['agentInvocationMode'] | null
  mounted_skill_names_json: unknown
  mounted_mcp_server_names_json: unknown
  enabled_mcp_server_ids_json: unknown
  delegated_prompt: string | null
  execution_model: string | null
  agent_settings_json: unknown
  opencode_config_json: unknown
  git_identity_mode: WorkspaceSession['gitIdentityMode'] | null
  publish_policy: WorkspaceSession['publishPolicy'] | null
  git_auth_preference: WorkspaceSession['gitAuthPreference'] | null
  distributed_task_id: string | null
  agent_session_id: string | null
  runtime_continuations_json: unknown
  handoff_snapshot_json: unknown
  base_branch: string | null
  worktree_id: string
  worktree_unique_id: number | null
  branch_name: string
  worktree_status: WorkspaceSession['worktreeStatus']
  working_directory_mode: WorkspaceSession['workingDirectoryMode'] | null
  needs_human_confirm: boolean
  agent_running_status: WorkspaceSession['agentRunningStatus'] | null
  runtime_status: WorkspaceSession['runtimeStatus'] | null
  runtime_session_id: string | null
  runtime_owner_executor_id: string | null
  runtime_started_at: string | null
  last_heartbeat_at: string | null
  last_runtime_event_at: string | null
  terminal_reason: string | null
  runtime_summary_json: unknown
  delivery_summary_json: unknown
  runtime_sequence: number | null
  current_step: string | null
  history_latest_turn_id: string | null
  history_latest_event_kind: string | null
  history_latest_event_seq: number | null
  history_total_event_count: number | null
  history_last_event_at: string | null
  history_latest_user_message_id: string | null
  history_latest_user_message_preview: string | null
  history_latest_assistant_message_id: string | null
  history_latest_assistant_message_preview: string | null
  history_last_persisted_turn_started_at: string | null
  history_last_persisted_turn_finished_at: string | null
  history_last_persisted_turn_status: string | null
  history_deleted_turn_count: number | null
  history_updated_at: string | null
  last_active_at: string
  created_at: string
  updated_at: string
}
