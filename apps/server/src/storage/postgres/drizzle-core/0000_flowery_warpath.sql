CREATE TABLE IF NOT EXISTS "active_free_execution_sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_key" text NOT NULL,
	"kind" text NOT NULL,
	"started_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_session_id" text NOT NULL,
	"action_type" text NOT NULL,
	"capability_name" text,
	"input_json" jsonb,
	"result_json" jsonb,
	"status" text NOT NULL,
	"approval_status" text NOT NULL,
	"risk_level" text NOT NULL,
	"error_message" text,
	"started_at" text NOT NULL,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_crons" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"cron_expression" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"enabled" boolean NOT NULL,
	"last_run_at" text,
	"next_run_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_heartbeats" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"status" text NOT NULL,
	"metrics_json" jsonb,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"project_id" text,
	"task_id" text,
	"runtime" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"agent_session_id" text,
	"context_snapshot_json" jsonb,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_task_inbox_items" (
	"agent_task_id" text NOT NULL,
	"inbox_item_id" text NOT NULL,
	"relation" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "agent_task_inbox_items_agent_task_id_inbox_item_id_pk" PRIMARY KEY("agent_task_id","inbox_item_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_task_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_task_id" text NOT NULL,
	"event_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"task_id" text,
	"project_id" text,
	"conversation_session_id" text,
	"attempt" integer NOT NULL,
	"retry_source" text NOT NULL,
	"retry_session_mode" text,
	"status" text NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"transcript_json" jsonb NOT NULL,
	"usage_json" jsonb,
	"started_at" text,
	"completed_at" text,
	"last_heartbeat_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "agent_task_runs_agent_task_id_key" UNIQUE("agent_task_id"),
	CONSTRAINT "agent_task_runs_event_id_key" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"status" text NOT NULL,
	"result_json" jsonb,
	"started_at" text,
	"completed_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"endpoint" text,
	"config_json" jsonb NOT NULL,
	"owner_user_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"last_heartbeat_at" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"agent_action_id" text NOT NULL,
	"requested_by_agent_session_id" text NOT NULL,
	"approver_user_id" text,
	"title" text NOT NULL,
	"detail" text,
	"status" text NOT NULL,
	"risk_level" text NOT NULL,
	"expires_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"project_id" text,
	"task_id" text,
	"conversation_id" text,
	"agent_session_id" text,
	"approval_request_id" text,
	"channel_binding_id" text,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"payload_json" jsonb,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"trigger_id" text,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"trigger_payload_json" jsonb,
	"resolved_variables_json" jsonb,
	"linked_task_id" text,
	"linked_task_run_id" text,
	"linked_distributed_task_id" text,
	"coalesced_into_run_id" text,
	"failure_reason" text,
	"idempotency_key" text,
	"triggered_at" text NOT NULL,
	"completed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_triggers" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"enabled" boolean NOT NULL,
	"cron_expression" text,
	"timezone" text,
	"next_run_at" text,
	"signing_mode" text,
	"secret_encrypted" text,
	"public_id" text,
	"replay_window_sec" integer,
	"last_fired_at" text,
	"last_result" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text NOT NULL,
	"priority" text NOT NULL,
	"difficulty" text NOT NULL,
	"agent_type" text NOT NULL,
	"execution_model" text,
	"opencode_config_json" jsonb,
	"workspace_id" text NOT NULL,
	"workspace_session_id" text,
	"base_branch" text,
	"return_mode" text NOT NULL,
	"sync_back_strategy" text NOT NULL,
	"git_identity_mode" text NOT NULL,
	"concurrency_policy" text NOT NULL,
	"catch_up_policy" text NOT NULL,
	"task_template_json" jsonb NOT NULL,
	"variables_json" jsonb NOT NULL,
	"last_triggered_at" text,
	"last_enqueued_at" text,
	"legacy_agent_id" text,
	"legacy_cron_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"token" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "device_tokens_user_token_idx" UNIQUE("user_id","token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "execution_event_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" text NOT NULL,
	"event_type" text NOT NULL,
	"severity" text NOT NULL,
	"is_failure" boolean NOT NULL,
	"message" text NOT NULL,
	"payload_summary" text NOT NULL,
	"payload_json" jsonb,
	"executor_id" text,
	"executor_name" text,
	"task_id" text,
	"origin_task_id" text,
	"project_id" text,
	"owner_user_id" text,
	"team_id" text,
	"layer" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "executor_pairing_codes" (
	"pairing_code" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"team_id" text,
	"workspace_ids_json" jsonb NOT NULL,
	"visibility" text NOT NULL,
	"preview_exposure_mode" text,
	"label" text,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"used_at" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "executors" (
	"id" text PRIMARY KEY NOT NULL,
	"machine_id" text NOT NULL,
	"machine_name" text NOT NULL,
	"name" text NOT NULL,
	"connected_node_id" text,
	"preview_exposure_mode" text,
	"preview_ingress_port" integer,
	"preview_ingress_base_url" text,
	"preview_ingress_detected_public_ip" text,
	"preview_ingress_detected_lan_ip" text,
	"preview_ingress_reachable" boolean,
	"preview_ingress_last_checked_at" text,
	"preview_ingress_last_error" text,
	"preview_proxy_secret" text,
	"executor_source" text NOT NULL,
	"managed_by" text NOT NULL,
	"runtime_class" text NOT NULL,
	"billing_class" text NOT NULL,
	"note" text,
	"owner_user_id" text NOT NULL,
	"team_id" text,
	"workspace_ids_json" jsonb NOT NULL,
	"visibility" text NOT NULL,
	"status" text NOT NULL,
	"workspace_root" text NOT NULL,
	"max_concurrency" integer NOT NULL,
	"capabilities_json" jsonb NOT NULL,
	"labels_json" jsonb NOT NULL,
	"ssh_pubkey" text,
	"platform" text,
	"version" text,
	"last_seen_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"token_hash" text NOT NULL,
	CONSTRAINT "executors_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "github_project_resources" (
	"provider" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"project_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "github_project_resources_resource_project_pk" PRIMARY KEY("provider","resource_type","resource_id","project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "github_resource_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"project_id" text NOT NULL,
	"context_key" text NOT NULL,
	"task_id" text,
	"workspace_id" text,
	"workspace_session_id" text,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"confidence" integer,
	"created_by_user_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "github_resource_bindings_resource_context_role_key" UNIQUE("provider","resource_type","resource_id","context_key","role")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inbox_items" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_type" text NOT NULL,
	"recipient_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"scope_json" jsonb NOT NULL,
	"group_key" text NOT NULL,
	"reply_to_json" jsonb NOT NULL,
	"trace_id" text NOT NULL,
	"chain_started_at" text NOT NULL,
	"source_inbox_item_id" text,
	"hop_count" integer DEFAULT 0 NOT NULL,
	"dedupe_key" text NOT NULL,
	"read_at" text,
	"snoozed_until" text,
	"archived_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "inbox_items_recipient_dedupe_key" UNIQUE("recipient_type","recipient_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lab_ideas" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"problem" text NOT NULL,
	"audience" text NOT NULL,
	"status" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lab_product_items" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"linked_idea_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"problem" text NOT NULL,
	"solution" text NOT NULL,
	"user_flow" text NOT NULL,
	"ui_structure" text NOT NULL,
	"interaction_notes" text NOT NULL,
	"states_notes" text NOT NULL,
	"copy_notes" text NOT NULL,
	"acceptance_notes" text NOT NULL,
	"status" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"room_id" text,
	"device_id" text NOT NULL,
	"started_at" text NOT NULL,
	"ended_at" text,
	"speaker_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"summary" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"room_id" text,
	"started_at" text NOT NULL,
	"ended_at" text NOT NULL,
	"duration_sec" integer NOT NULL,
	"transcript" text NOT NULL,
	"speaker_id" text,
	"value_label" text,
	"confidence" real,
	"channels" jsonb NOT NULL,
	"is_meeting" boolean NOT NULL,
	"meeting_title" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_profile_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"model_profile_id" text NOT NULL,
	"agent_type" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"label" text NOT NULL,
	"base_url" text,
	"api_token_encrypted" text,
	"is_default" boolean NOT NULL,
	"runtime_settings_json" jsonb,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"visibility" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"team_id" text,
	"workspace_id" text,
	"source" text NOT NULL,
	"source_executor_id" text,
	"enabled" boolean NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "preview_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"workspace_session_id" text NOT NULL,
	"executor_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"execution_surface" text NOT NULL,
	"access_mode" text NOT NULL,
	"status" text NOT NULL,
	"close_reason" text,
	"source_json" jsonb NOT NULL,
	"public_host" text NOT NULL,
	"public_url" text NOT NULL,
	"tunnel_token_hash" text NOT NULL,
	"tunnel_connected_at" text,
	"tunnel_disconnected_at" text,
	"tunnel_client_status" text,
	"tunnel_connection_id" text,
	"tunnel_connected_node_id" text,
	"share_token_hash" text,
	"share_url" text,
	"share_token_expires_at" text,
	"share_revoked_at" text,
	"last_share_issued_at" text,
	"last_error" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"project_id" text NOT NULL,
	"repo_host" text NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"repo_full_name" text NOT NULL,
	"repo_url" text NOT NULL,
	"number" integer NOT NULL,
	"url" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"author_login" text,
	"state" text NOT NULL,
	"labels_json" jsonb NOT NULL,
	"assignee_logins_json" jsonb NOT NULL,
	"comments" integer NOT NULL,
	"synced_at" text NOT NULL,
	"issue_created_at" text,
	"issue_updated_at" text,
	"closed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "project_issues_provider_repo_host_repo_owner_repo_name_number_key" UNIQUE("provider","repo_host","repo_owner","repo_name","number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_pull_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"project_id" text NOT NULL,
	"repo_host" text NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"repo_full_name" text NOT NULL,
	"repo_url" text NOT NULL,
	"number" integer NOT NULL,
	"url" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"author_login" text,
	"state" text NOT NULL,
	"merged" boolean NOT NULL,
	"draft" boolean NOT NULL,
	"base_branch" text NOT NULL,
	"compare_branch" text NOT NULL,
	"head_owner" text,
	"head_repo" text,
	"additions" integer NOT NULL,
	"deletions" integer NOT NULL,
	"changed_files" integer NOT NULL,
	"files_json" jsonb NOT NULL,
	"matched_workspace_id" text,
	"matched_workspace_session_id" text,
	"matched_task_id" text,
	"matched_task_title" text,
	"synced_at" text NOT NULL,
	"pr_created_at" text,
	"pr_updated_at" text,
	"merged_at" text,
	"closed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "project_pull_requests_provider_repo_host_repo_owner_repo_name_number_key" UNIQUE("provider","repo_host","repo_owner","repo_name","number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_runtime_environment_configs" (
	"project_id" text PRIMARY KEY NOT NULL,
	"delivery_mode" text NOT NULL,
	"file_name" text,
	"content_encrypted" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"project_id" text NOT NULL,
	"repo_host" text NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"repo_full_name" text NOT NULL,
	"repo_url" text NOT NULL,
	"run_id" bigint NOT NULL,
	"name" text NOT NULL,
	"display_title" text NOT NULL,
	"run_number" integer NOT NULL,
	"run_attempt" integer NOT NULL,
	"status" text NOT NULL,
	"conclusion" text,
	"event" text NOT NULL,
	"head_branch" text NOT NULL,
	"head_sha" text NOT NULL,
	"url" text,
	"synced_at" text NOT NULL,
	"run_created_at" text,
	"run_updated_at" text,
	"run_started_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "project_workflow_runs_provider_repo_host_repo_owner_repo_name_run_id_key" UNIQUE("provider","repo_host","repo_owner","repo_name","run_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "railway_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"account_email" text,
	"account_name" text,
	"status" text NOT NULL,
	"last_synced_at" text,
	"last_error" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "railway_connections_user_id_key" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "railway_deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"railway_project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"environment_name" text NOT NULL,
	"is_ephemeral" boolean NOT NULL,
	"pr_number" integer,
	"pr_title" text,
	"pr_repo" text,
	"branch" text,
	"base_branch" text,
	"service_id" text,
	"service_name" text,
	"status" text NOT NULL,
	"url" text,
	"static_url" text,
	"is_latest" boolean NOT NULL,
	"synced_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "railway_deployments_env_service_key" UNIQUE("railway_project_id","environment_id","service_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "railway_project_resources" (
	"railway_project_id" text NOT NULL,
	"project_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "railway_project_resources_project_pk" PRIMARY KEY("railway_project_id","project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "railway_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"primary_environment_id" text,
	"synced_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "railway_resource_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"project_id" text NOT NULL,
	"context_key" text NOT NULL,
	"task_id" text,
	"workspace_id" text,
	"workspace_session_id" text,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"confidence" integer,
	"created_by_user_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "railway_resource_bindings_resource_context_role_key" UNIQUE("provider","resource_type","resource_id","context_key","role")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "skill_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"markdown" text NOT NULL,
	"file_inventory_json" jsonb NOT NULL,
	"files_json" jsonb NOT NULL,
	"source_locator" text,
	"source_ref" text,
	"trust_level" text NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	CONSTRAINT "skill_versions_skill_id_version_number_key" UNIQUE("skill_id","version_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"markdown" text NOT NULL,
	"source_type" text NOT NULL,
	"enabled" boolean NOT NULL,
	"visibility" text NOT NULL,
	"owner_user_id" text,
	"workspace_id" text,
	"source_locator" text,
	"source_ref" text,
	"trust_level" text NOT NULL,
	"compatibility" text NOT NULL,
	"file_inventory_json" jsonb NOT NULL,
	"files_json" jsonb NOT NULL,
	"categories_json" jsonb NOT NULL,
	"current_version_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "skills_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "storage_change_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"operation" text NOT NULL,
	"event_key" text,
	"source_node_id" text,
	"payload_json" jsonb,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_change_events_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telegram_chats" (
	"chat_id" text NOT NULL,
	"thread_id" text,
	"type" text NOT NULL,
	"entity_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "telegram_chats_chat_thread_key" UNIQUE NULLS NOT DISTINCT("chat_id","thread_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telegram_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"thread_id" text,
	"user_id" text,
	"state_json" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_environment_template_configs" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"template_json" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_runtime_environment_configs" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"delivery_mode" text NOT NULL,
	"file_name" text,
	"content_encrypted" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_profiles" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"identity_json" jsonb NOT NULL,
	"okr_json" jsonb,
	"activity_log_json" jsonb,
	"health_score" double precision,
	"last_active_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"email" text,
	"event_type" text NOT NULL,
	"provider" text,
	"result" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"metadata_json" jsonb,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"project_id" text,
	"task_id" text,
	"conversation_id" text NOT NULL,
	"channel_type" text NOT NULL,
	"external_chat_id" text NOT NULL,
	"external_thread_id" text,
	"binding_mode" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collab_workspace_group_members" (
	"group_id" text NOT NULL,
	"member_type" text NOT NULL,
	"member_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "collab_workspace_group_members_group_id_member_type_member_id_pk" PRIMARY KEY("group_id","member_type","member_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collab_workspace_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collab_workspace_members" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "collab_workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collab_workspace_projects" (
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	CONSTRAINT "collab_workspace_projects_workspace_id_project_id_pk" PRIMARY KEY("workspace_id","project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collab_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"avatar_url" text,
	"owner_user_id" text NOT NULL,
	"partner_id" text,
	"brain_enabled" boolean DEFAULT false NOT NULL,
	"brain_agent_id" text,
	"brain_instructions" text,
	"legacy_team_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "collab_workspaces_legacy_team_id_unique" UNIQUE("legacy_team_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "community_usage_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"install_id" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"app_version" text DEFAULT '' NOT NULL,
	"os" text DEFAULT '' NOT NULL,
	"deployment_mode" text DEFAULT '' NOT NULL,
	"users_total" integer DEFAULT 0 NOT NULL,
	"teams_total" integer DEFAULT 0 NOT NULL,
	"tasks_total" integer DEFAULT 0 NOT NULL,
	"conversations_total" integer DEFAULT 0 NOT NULL,
	"agent_runs_total" integer DEFAULT 0 NOT NULL,
	"received_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connector_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"connection_name" text NOT NULL,
	"auth_type" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"workspace_id" text,
	"visibility" text NOT NULL,
	"status" text NOT NULL,
	"message" text,
	"account_label" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_members" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"member_type" text NOT NULL,
	"member_id" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text,
	"joined_at" text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	"left_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "conversation_members_conversation_id_member_type_member_id_key" UNIQUE("conversation_id","member_type","member_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text,
	"mentioner_id" text NOT NULL,
	"mentioner_type" text NOT NULL,
	"mentioned_id" text NOT NULL,
	"mentioned_type" text NOT NULL,
	"mention_scope" text DEFAULT 'agent_in_chat' NOT NULL,
	"context_json" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_read_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"last_read_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "conversation_read_state_user_conversation_unique" UNIQUE("user_id","conversation_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text,
	"shared_by" text NOT NULL,
	"shared_by_type" text NOT NULL,
	"share_type" text DEFAULT 'link' NOT NULL,
	"target_conversation_id" text,
	"access_scope" text DEFAULT 'members' NOT NULL,
	"share_token" text,
	"expires_at" text,
	"metadata_json" jsonb,
	"created_at" text NOT NULL,
	CONSTRAINT "conversation_shares_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"workspace_session_id" text,
	"project_id" text,
	"task_id" text,
	"group_id" text,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"chat_mode" text NOT NULL,
	"status" text NOT NULL,
	"external_sync_mode" text NOT NULL,
	"orchestrator_agent_id" text,
	"executor_id" text,
	"execution_model" text,
	"pinned_at" text,
	"source_channel" text,
	"external_chat_id" text,
	"external_thread_id" text,
	"external_conversation_id" text,
	"external_user_id" text,
	"runtime_json" jsonb,
	"created_by" text,
	"visibility" text DEFAULT 'public' NOT NULL,
	"description" text,
	"announcement" text,
	"announcement_updated_at" text,
	"announcement_updated_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "distributed_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"origin_task_id" text NOT NULL,
	"origin_task_run_id" text,
	"workspace_id" text,
	"workspace_session_id" text,
	"workspace_branch_name" text,
	"project_id" text NOT NULL,
	"local_path" text,
	"version_control" text,
	"requested_by_user_id" text,
	"requested_by_agent_id" text,
	"source_agent_event_id" text,
	"agent_type" text NOT NULL,
	"execution_model" text,
	"mcp_servers_json" jsonb,
	"runtime_skill_packages_json" jsonb,
	"opencode_config_json" jsonb,
	"runtime_env_json" jsonb,
	"working_directory_mode" text NOT NULL,
	"auto_commit_enabled" boolean,
	"repo_url" text NOT NULL,
	"default_branch" text NOT NULL,
	"base_commit" text NOT NULL,
	"description" text NOT NULL,
	"command_preset_json" jsonb,
	"status" text NOT NULL,
	"priority" text NOT NULL,
	"timeout_sec" integer NOT NULL,
	"origin_node_id" text NOT NULL,
	"executor_node_id" text,
	"return_mode" text NOT NULL,
	"sync_back_strategy" text NOT NULL,
	"git_identity_mode" text,
	"publish_policy" text NOT NULL,
	"git_auth_preference" text NOT NULL,
	"git_identity_json" jsonb,
	"idempotency_key" text NOT NULL,
	"worker_event_sequence" integer,
	"retry_count" integer NOT NULL,
	"lease_expires_at" text,
	"started_at" text,
	"completed_at" text,
	"error_message" text,
	"result_json" jsonb,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drive_file_permissions" (
	"file_id" text NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" text NOT NULL,
	"role" text NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	CONSTRAINT "drive_file_permissions_file_id_principal_type_principal_id_pk" PRIMARY KEY("file_id","principal_type","principal_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drive_file_references" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "drive_file_references_file_ref_key" UNIQUE("file_id","ref_type","ref_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drive_file_shares" (
	"file_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "drive_file_shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drive_file_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"version" integer NOT NULL,
	"s3_key" text NOT NULL,
	"size_bytes" bigint,
	"uploaded_by" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drive_files" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"parent_id" text,
	"name" text NOT NULL,
	"file_type" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"s3_key" text,
	"thumbnail_s3_key" text,
	"content_type" text DEFAULT 'other' NOT NULL,
	"search_text" text,
	"version" integer DEFAULT 1 NOT NULL,
	"visibility" text DEFAULT 'team' NOT NULL,
	"deleted_at" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "execution_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"workspace_id" text,
	"workspace_session_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feedback_items" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"user_id" text,
	"user_email" text,
	"conversation_id" text,
	"source" text DEFAULT 'product' NOT NULL,
	"origin_ref" jsonb,
	"normalized" jsonb,
	"routing" text,
	"github_ref" jsonb,
	"consent_public" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "github_app_connection_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"commit_author_name" text NOT NULL,
	"commit_author_email" text NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "github_app_installations" (
	"installation_id" bigint PRIMARY KEY NOT NULL,
	"account_id" bigint,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_host" text NOT NULL,
	"repository_selection" text NOT NULL,
	"permissions_json" jsonb NOT NULL,
	"access_token_encrypted" text,
	"access_token_expires_at" text,
	"suspended_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "github_app_user_auths" (
	"user_id" text PRIMARY KEY NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text,
	"expires_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "github_app_user_links" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"commit_author_name" text,
	"commit_author_email" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "github_app_user_links_user_id_installation_id_key" UNIQUE("user_id","installation_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"sender_id" text,
	"content" text NOT NULL,
	"content_type" text NOT NULL,
	"reply_to_message_id" text,
	"external_ref_json" jsonb,
	"parts_json" jsonb,
	"reactions_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"role" text,
	"author_name" text,
	"usage_json" jsonb,
	"runtime_status_json" jsonb,
	"finish_reason" text,
	"seq" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "messages_conversation_id_seq_key" UNIQUE("conversation_id","seq")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "node_capabilities" (
	"node_id" text NOT NULL,
	"capability" text NOT NULL,
	CONSTRAINT "node_capabilities_node_id_capability_pk" PRIMARY KEY("node_id","capability")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"relay_url" text,
	"status" text NOT NULL,
	"version" text,
	"region" text,
	"max_concurrent_tasks" integer NOT NULL,
	"last_heartbeat_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "personal_access_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"expires_at" text,
	"last_used_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "personal_access_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_bindings" (
	"project_id" text NOT NULL,
	"node_id" text NOT NULL,
	"repo_url" text NOT NULL,
	"default_branch" text NOT NULL,
	"path_hint" text,
	"is_active" boolean NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "project_bindings_project_id_node_id_pk" PRIMARY KEY("project_id","node_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_git_credential_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text,
	"auth_source_type" text NOT NULL,
	"github_installation_id" bigint,
	"github_repository_id" bigint,
	"github_account_login" text,
	"github_account_type" text,
	"github_repository_name" text,
	"provider_host" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "project_git_credential_bindings_project_id_user_id_key" UNIQUE("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_order" integer,
	"color" text,
	"workspace_id" text,
	"visibility" text NOT NULL,
	"git_url" text NOT NULL,
	"local_path" text NOT NULL,
	"version_control" text NOT NULL,
	"default_branch" text NOT NULL,
	"preferred_executor_id" text,
	"repository_clone_status" text,
	"repository_clone_message" text,
	"command_presets_json" jsonb NOT NULL,
	"default_command_preset_id" text,
	"environment_template_json" jsonb,
	"recent_base_branches_json" jsonb NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"last_used_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "r2_usage_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"bucket" text NOT NULL,
	"storage_bytes" bigint DEFAULT 0 NOT NULL,
	"object_count" integer DEFAULT 0 NOT NULL,
	"egress_bytes" bigint DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'local-list' NOT NULL,
	"captured_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "revoked_auth_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"expires_at" text NOT NULL,
	"revoked_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"workspace_id" text,
	"target_type" text NOT NULL,
	"target_id" text,
	"permission" text DEFAULT 'read' NOT NULL,
	"share_token_hash" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"revoked_at" text,
	"expires_at" text,
	CONSTRAINT "session_shares_source_kind_source_id_target_type_target_id_key" UNIQUE("source_kind","source_id","target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_chat_queue_items" (
	"id" text PRIMARY KEY NOT NULL,
	"session_key" text NOT NULL,
	"task_id" text,
	"workspace_id" text,
	"workspace_session_id" text,
	"task_run_id" text,
	"requested_by_agent_id" text,
	"source_agent_event_id" text,
	"author_json" jsonb,
	"dedupe_key" text,
	"message" text NOT NULL,
	"attachments_json" jsonb,
	"context_refs_json" jsonb,
	"runtime_config_json" jsonb,
	"created_at" text NOT NULL,
	"created_by" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claim_id" text,
	"claimed_at" text,
	"claimed_by" text,
	"lease_expires_at" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_chat_session_leases" (
	"session_key" text PRIMARY KEY NOT NULL,
	"lease_id" text NOT NULL,
	"claimed_by_node_id" text NOT NULL,
	"task_id" text,
	"workspace_id" text,
	"workspace_session_id" text,
	"lease_expires_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_collaboration" (
	"task_id" text PRIMARY KEY NOT NULL,
	"comments_json" jsonb NOT NULL,
	"subscriber_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_calls_json" jsonb NOT NULL,
	"history_json" jsonb NOT NULL,
	"orchestration_json" jsonb NOT NULL,
	"validation_checks_json" jsonb NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_custom_field_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"options_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"default_json" jsonb,
	"display_order" integer DEFAULT 0 NOT NULL,
	"archived_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "task_custom_field_definitions_project_key_key" UNIQUE("project_id","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_custom_field_values" (
	"task_id" text NOT NULL,
	"field_id" text NOT NULL,
	"value_json" jsonb NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "task_custom_field_values_task_id_field_id_pk" PRIMARY KEY("task_id","field_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"project_id" text NOT NULL,
	"distributed_task_id" text,
	"workspace_id" text,
	"workspace_session_id" text,
	"executor_node_id" text,
	"base_branch" text,
	"return_mode" text,
	"git_identity_mode" text,
	"agent_session_id" text,
	"execution_model" text,
	"usage_json" jsonb,
	"status" text NOT NULL,
	"summary" text,
	"result_json" jsonb,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_workspace_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "task_workspace_bindings_task_id_workspace_id_key" UNIQUE("task_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"parent_task_id" text,
	"creator_json" jsonb,
	"origin_type" text,
	"origin_id" text,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"assignee_id" text,
	"assignee_agent_id" text,
	"assignee_agent_group_id" text,
	"status" text NOT NULL,
	"agent_type" text NOT NULL,
	"execution_model" text,
	"opencode_config_json" jsonb,
	"execution_mode" text NOT NULL,
	"agent_managed" text NOT NULL,
	"priority" text NOT NULL,
	"retry_count" integer NOT NULL,
	"created_at" text NOT NULL,
	"started_at" text,
	"due_at" text,
	"updated_at" text NOT NULL,
	"base_branch" text NOT NULL,
	"acceptance_criteria" text,
	"draft_id" text,
	"draft_saved_at" text,
	"recommended_title" text,
	"command_preset_id" text,
	"base_branch_hint" text,
	"auto_review_json" jsonb,
	"requirement_type" text NOT NULL,
	"needs_human_confirm" boolean NOT NULL,
	"agent_running_status" text NOT NULL,
	"current_step" text NOT NULL,
	"attachments_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reactions_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details_json" jsonb,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text NOT NULL,
	"status" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "team_invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_members" (
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_projects" (
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	CONSTRAINT "team_projects_team_id_project_id_pk" PRIMARY KEY("team_id","project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"avatar_url" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telemetry_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"user_id" text,
	"team_id" text,
	"project_id" text,
	"workspace_id" text,
	"task_id" text,
	"executor_node_id" text,
	"payload_json" jsonb,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_kind" text NOT NULL,
	"run_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text,
	"agent_name" text,
	"conversation_id" text,
	"workspace_id" text,
	"workspace_session_id" text,
	"task_id" text,
	"project_id" text,
	"executor_node_id" text,
	"provider_id" text,
	"model_id" text,
	"execution_model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"billing_status" text DEFAULT 'none' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "usage_events_run_kind_run_id_key" UNIQUE("run_kind","run_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"requester_id" text NOT NULL,
	"addressee_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" text NOT NULL,
	"responded_at" text,
	CONSTRAINT "user_connections_workspace_pair_unique" UNIQUE("workspace_id","requester_id","addressee_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_git_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"provider" text NOT NULL,
	"host" text NOT NULL,
	"auth_mode" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"pat_token_encrypted" text,
	"ssh_public_key" text,
	"ssh_private_key_encrypted" text,
	"ssh_key_fingerprint" text,
	"activated_at" text,
	"is_default" boolean NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"title" text,
	"department" text,
	"skills" jsonb,
	"okr_json" jsonb,
	"work_summary_json" jsonb,
	"visibility" text DEFAULT 'team' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_projects" (
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"access_type" text NOT NULL,
	CONSTRAINT "user_projects_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"username" text,
	"username_updated_at" text,
	"avatar_url" text,
	"bio" text,
	"onboarding_completed_at" text,
	"onboarding_dismissed_at" text,
	"onboarding_path" text,
	"auth_provider" text NOT NULL,
	"is_internal" boolean NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"email_verified_at" text,
	"last_login_at" text,
	"last_login_ip" text,
	"suspended_until" text,
	"banned_reason" text,
	"banned_at" text,
	"support_note" text,
	"support_note_status" text,
	"initial_agent_provisioned_at" text,
	"partner_id" text,
	"created_at" text NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_records" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"record_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"title" text NOT NULL,
	"summary" text,
	"metadata_json" jsonb,
	"occurred_at" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_brain_files" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"file_id" text NOT NULL,
	"digest" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"digest_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_local_worktrees" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"executor_node_id" text NOT NULL,
	"code_base_branch" text,
	"code_branch_name" text NOT NULL,
	"working_directory_mode" text NOT NULL,
	"local_path" text,
	"worktree_id" text,
	"worktree_unique_id" integer,
	"status" text NOT NULL,
	"source_workspace_session_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "workspace_local_worktrees_workspace_id_executor_node_id_key" UNIQUE("workspace_id","executor_node_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_presence" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"state" text NOT NULL,
	"active_workspace_session_id" text,
	"last_seen_at" text NOT NULL,
	CONSTRAINT "workspace_presence_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_resource_sync_links" (
	"source_workspace_id" text NOT NULL,
	"target_workspace_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "workspace_resource_sync_links_source_workspace_id_target_workspace_id_owner_user_id_pk" PRIMARY KEY("source_workspace_id","target_workspace_id","owner_user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_session_history_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"task_id" text,
	"workspace_id" text NOT NULL,
	"turn_id" text NOT NULL,
	"session_seq" integer NOT NULL,
	"turn_seq" integer NOT NULL,
	"kind" text NOT NULL,
	"visibility" text NOT NULL,
	"created_at" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	CONSTRAINT "workspace_session_history_events_session_id_session_seq_key" UNIQUE("session_id","session_seq")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_session_history_projection" (
	"session_id" text PRIMARY KEY NOT NULL,
	"task_id" text,
	"workspace_id" text NOT NULL,
	"latest_turn_id" text,
	"latest_event_kind" text,
	"latest_event_seq" integer NOT NULL,
	"total_event_count" integer NOT NULL,
	"last_event_at" text,
	"latest_user_message_id" text,
	"latest_user_message_preview" text,
	"latest_assistant_message_id" text,
	"latest_assistant_message_preview" text,
	"last_persisted_turn_started_at" text,
	"last_persisted_turn_finished_at" text,
	"last_persisted_turn_status" text,
	"deleted_turn_count" integer NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_session_history_runtime" (
	"session_id" text PRIMARY KEY NOT NULL,
	"task_id" text,
	"workspace_id" text NOT NULL,
	"agent_running_status" text NOT NULL,
	"runtime_status" text,
	"current_step" text NOT NULL,
	"queue_status" text NOT NULL,
	"active_tool_calls_json" jsonb NOT NULL,
	"last_event_seq" integer NOT NULL,
	"last_event_at" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_session_history_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"task_id" text,
	"workspace_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" text NOT NULL,
	"finished_at" text,
	"first_seq" integer,
	"last_seq" integer,
	"event_count" integer NOT NULL,
	"usage_json" jsonb,
	"lineage_json" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"display_order" integer,
	"pinned_at" text,
	"title" text NOT NULL,
	"title_origin" text NOT NULL,
	"status" text NOT NULL,
	"session_kind" text NOT NULL,
	"session_role" text NOT NULL,
	"session_origin" text NOT NULL,
	"parent_session_id" text,
	"root_session_id" text,
	"fork_mode" text,
	"forked_from_session_id" text,
	"forked_from_message_id" text,
	"fork_revision_json" jsonb,
	"pending_revision_json" jsonb,
	"shared_worktree_source_session_id" text,
	"executor_node_id" text,
	"agent_type" text,
	"custom_agent_id" text,
	"custom_agent_name" text,
	"agent_invocation_mode" text,
	"mounted_skill_names_json" jsonb,
	"mounted_mcp_server_names_json" jsonb,
	"enabled_mcp_server_ids_json" jsonb,
	"delegated_prompt" text,
	"execution_model" text,
	"agent_settings_json" jsonb,
	"opencode_config_json" jsonb,
	"git_identity_mode" text,
	"publish_policy" text NOT NULL,
	"git_auth_preference" text NOT NULL,
	"distributed_task_id" text,
	"agent_session_id" text,
	"runtime_continuations_json" jsonb,
	"handoff_snapshot_json" jsonb,
	"base_branch" text,
	"worktree_id" text NOT NULL,
	"worktree_unique_id" integer,
	"branch_name" text NOT NULL,
	"worktree_status" text NOT NULL,
	"working_directory_mode" text NOT NULL,
	"needs_human_confirm" boolean NOT NULL,
	"agent_running_status" text NOT NULL,
	"runtime_status" text NOT NULL,
	"runtime_session_id" text,
	"runtime_owner_executor_id" text,
	"runtime_started_at" text,
	"last_heartbeat_at" text,
	"last_runtime_event_at" text,
	"terminal_reason" text,
	"runtime_summary_json" jsonb,
	"delivery_summary_json" jsonb,
	"runtime_sequence" integer NOT NULL,
	"current_step" text NOT NULL,
	"last_active_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"scope" text NOT NULL,
	"session_id" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"permission" text DEFAULT 'read' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"revoked_at" text,
	CONSTRAINT "workspace_shares_workspace_scope_session_target_key" UNIQUE("workspace_id","scope","session_id","target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"creator_json" jsonb,
	"display_order" integer,
	"executor_node_id" text NOT NULL,
	"agent_type" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"repo_ready" boolean NOT NULL,
	"repo_path" text,
	"worktree_root_path" text,
	"source" text NOT NULL,
	"working_directory_mode" text NOT NULL,
	"auto_commit_enabled" boolean,
	"default_branch" text,
	"suggested_base_branch" text,
	"code_base_branch" text,
	"code_branch_name" text,
	"code_remote_head_sha" text,
	"code_synced_at" text,
	"owner_user_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "active_free_execution_sessions_user_id_idx" ON "active_free_execution_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "active_free_execution_sessions_started_at_idx" ON "active_free_execution_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_actions_session_idx" ON "agent_actions" USING btree ("agent_session_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_heartbeats_agent_created_idx" ON "agent_heartbeats" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_task_idx" ON "agent_sessions" USING btree ("task_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_runtime_session_idx" ON "agent_sessions" USING btree ("agent_session_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_task_inbox_items_task_idx" ON "agent_task_inbox_items" USING btree ("agent_task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_task_inbox_items_item_idx" ON "agent_task_inbox_items" USING btree ("inbox_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_task_runs_task_created_idx" ON "agent_task_runs" USING btree ("task_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_task_runs_status_heartbeat_idx" ON "agent_task_runs" USING btree ("status","last_heartbeat_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tasks_agent_idx" ON "agent_tasks" USING btree ("agent_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_owner_idx" ON "agents" USING btree ("owner_user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_status_idx" ON "approval_requests" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_task_idx" ON "audit_logs" USING btree ("task_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_conversation_idx" ON "audit_logs" USING btree ("conversation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_automation_runs_automation_id" ON "automation_runs" USING btree ("automation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_automation_runs_linked_task_id" ON "automation_runs" USING btree ("linked_task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_automation_triggers_due" ON "automation_triggers" USING btree ("kind","enabled","next_run_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_automation_triggers_public_id" ON "automation_triggers" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_tokens_user_idx" ON "device_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_event_logs_occurred_at_idx" ON "execution_event_logs" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_event_logs_task_idx" ON "execution_event_logs" USING btree ("task_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_event_logs_origin_task_idx" ON "execution_event_logs" USING btree ("origin_task_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_event_logs_executor_idx" ON "execution_event_logs" USING btree ("executor_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_event_logs_project_idx" ON "execution_event_logs" USING btree ("project_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_event_logs_owner_idx" ON "execution_event_logs" USING btree ("owner_user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_event_logs_type_idx" ON "execution_event_logs" USING btree ("event_type","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_event_logs_layer_idx" ON "execution_event_logs" USING btree ("layer","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_event_logs_failure_idx" ON "execution_event_logs" USING btree ("is_failure","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_executor_pairing_codes_owner_user_id" ON "executor_pairing_codes" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_executor_pairing_codes_expires_at" ON "executor_pairing_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_executor_pairing_codes_used_at" ON "executor_pairing_codes" USING btree ("used_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "executors_owner_idx" ON "executors" USING btree ("owner_user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_project_resources_project_idx" ON "github_project_resources" USING btree ("project_id","resource_type","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_project_resources_resource_idx" ON "github_project_resources" USING btree ("provider","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_resource_bindings_project_resource_idx" ON "github_resource_bindings" USING btree ("project_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_resource_bindings_task_idx" ON "github_resource_bindings" USING btree ("task_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_resource_bindings_workspace_idx" ON "github_resource_bindings" USING btree ("workspace_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_resource_bindings_session_idx" ON "github_resource_bindings" USING btree ("workspace_session_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_items_recipient_open_idx" ON "inbox_items" USING btree ("recipient_type","recipient_id","archived_at","read_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_items_recipient_group_idx" ON "inbox_items" USING btree ("recipient_type","recipient_id","group_key","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_items_snooze_idx" ON "inbox_items" USING btree ("snoozed_until");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_items_trace_idx" ON "inbox_items" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lab_ideas_updated_idx" ON "lab_ideas" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lab_ideas_project_idx" ON "lab_ideas" USING btree ("project_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lab_product_items_updated_idx" ON "lab_product_items" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lab_product_items_project_idx" ON "lab_product_items" USING btree ("project_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lab_product_items_idea_idx" ON "lab_product_items" USING btree ("linked_idea_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_entities_user_idx" ON "meeting_entities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_segments_user_idx" ON "meeting_segments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_segments_meeting_idx" ON "meeting_segments" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_model_profile_bindings_profile_id" ON "model_profile_bindings" USING btree ("model_profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_model_profiles_owner_user_id" ON "model_profiles" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_model_profiles_team_id" ON "model_profiles" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preview_sessions_workspace_idx" ON "preview_sessions" USING btree ("workspace_session_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preview_sessions_owner_idx" ON "preview_sessions" USING btree ("owner_user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preview_sessions_public_host_idx" ON "preview_sessions" USING btree ("public_host");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preview_sessions_task_workspace_purpose_idx" ON "preview_sessions" USING btree ("task_id","workspace_id","purpose","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_issues_project_updated_idx" ON "project_issues" USING btree ("project_id","issue_updated_at" DESC NULLS LAST,"updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_issues_repo_number_idx" ON "project_issues" USING btree ("repo_host","repo_owner","repo_name","number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_pull_requests_project_updated_idx" ON "project_pull_requests" USING btree ("project_id","pr_updated_at" DESC NULLS LAST,"updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_pull_requests_workspace_idx" ON "project_pull_requests" USING btree ("matched_workspace_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_pull_requests_branch_idx" ON "project_pull_requests" USING btree ("project_id","compare_branch","base_branch");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_workflow_runs_project_updated_idx" ON "project_workflow_runs" USING btree ("project_id","run_updated_at" DESC NULLS LAST,"updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_workflow_runs_repo_run_idx" ON "project_workflow_runs" USING btree ("repo_host","repo_owner","repo_name","run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_workflow_runs_branch_idx" ON "project_workflow_runs" USING btree ("project_id","head_branch");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "railway_connections_user_idx" ON "railway_connections" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "railway_deployments_project_updated_idx" ON "railway_deployments" USING btree ("railway_project_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "railway_deployments_branch_idx" ON "railway_deployments" USING btree ("railway_project_id","branch");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "railway_deployments_env_idx" ON "railway_deployments" USING btree ("environment_id","is_latest","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "railway_project_resources_project_idx" ON "railway_project_resources" USING btree ("project_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "railway_project_resources_railway_project_idx" ON "railway_project_resources" USING btree ("railway_project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "railway_projects_updated_idx" ON "railway_projects" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "railway_resource_bindings_project_resource_idx" ON "railway_resource_bindings" USING btree ("project_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "railway_resource_bindings_task_idx" ON "railway_resource_bindings" USING btree ("task_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "railway_resource_bindings_workspace_idx" ON "railway_resource_bindings" USING btree ("workspace_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "railway_resource_bindings_session_idx" ON "railway_resource_bindings" USING btree ("workspace_session_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_versions_skill_id_idx" ON "skill_versions" USING btree ("skill_id","version_number" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_skills_owner_user_id" ON "skills" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_skills_workspace_id" ON "skills" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storage_change_events_changed_at_idx" ON "storage_change_events" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telegram_sessions_chat_idx" ON "telegram_sessions" USING btree ("chat_id","thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_events_user_created_idx" ON "auth_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_events_email_created_idx" ON "auth_events" USING btree ("email","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_bindings_conversation_idx" ON "channel_bindings" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collab_workspace_group_members_group_idx" ON "collab_workspace_group_members" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collab_workspace_groups_ws_idx" ON "collab_workspace_groups" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collab_workspaces_partner_idx" ON "collab_workspaces" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_usage_reports_install_received_idx" ON "community_usage_reports" USING btree ("install_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_usage_reports_received_idx" ON "community_usage_reports" USING btree ("received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_connector_connections_service_name" ON "connector_connections" USING btree ("service","connection_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_connector_connections_owner" ON "connector_connections" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_connector_connections_workspace" ON "connector_connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_members_member_idx" ON "conversation_members" USING btree ("member_type","member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_mentions_mentioned_idx" ON "conversation_mentions" USING btree ("mentioned_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_read_state_user_idx" ON "conversation_read_state" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_shares_conv_idx" ON "conversation_shares" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_task_idx" ON "conversations" USING btree ("task_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_project_idx" ON "conversations" USING btree ("project_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_workspace_mode_idx" ON "conversations" USING btree ("workspace_id","chat_mode","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_workspace_session_idx" ON "conversations" USING btree ("workspace_session_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "distributed_tasks_project_idx" ON "distributed_tasks" USING btree ("project_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "distributed_tasks_workspace_session_idx" ON "distributed_tasks" USING btree ("workspace_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "distributed_tasks_executor_idx" ON "distributed_tasks" USING btree ("executor_node_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "distributed_tasks_idempotency_key_idx" ON "distributed_tasks" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drive_file_references_ref_idx" ON "drive_file_references" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drive_file_versions_file_idx" ON "drive_file_versions" USING btree ("file_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drive_files_workspace_idx" ON "drive_files" USING btree ("workspace_id","parent_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drive_files_deleted_at_idx" ON "drive_files" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_logs_task_idx" ON "execution_logs" USING btree ("task_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_logs_workspace_session_idx" ON "execution_logs" USING btree ("workspace_session_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_items_status_created_idx" ON "feedback_items" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_items_user_created_idx" ON "feedback_items" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_conversation_seq_idx" ON "messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personal_access_tokens_user_id_idx" ON "personal_access_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personal_access_tokens_hash_idx" ON "personal_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "r2_usage_snapshots_bucket_time_idx" ON "r2_usage_snapshots" USING btree ("bucket","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revoked_auth_tokens_expires_at_idx" ON "revoked_auth_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_shares_source_idx" ON "session_shares" USING btree ("source_kind","source_id","revoked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_shares_target_idx" ON "session_shares" USING btree ("target_type","target_id","revoked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_shares_token_idx" ON "session_shares" USING btree ("share_token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_chat_queue_items_session_status_idx" ON "task_chat_queue_items" USING btree ("session_key","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_chat_queue_items_dedupe_idx" ON "task_chat_queue_items" USING btree ("session_key","dedupe_key") WHERE "task_chat_queue_items"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_chat_session_leases_expires_idx" ON "task_chat_session_leases" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_custom_field_definitions_project_idx" ON "task_custom_field_definitions" USING btree ("project_id","display_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_runs_task_created_idx" ON "task_runs" USING btree ("task_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_origin_key" ON "tasks" USING btree ("origin_type","origin_id") WHERE "tasks"."origin_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_project_created_idx" ON "tasks" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telemetry_events_type_created_idx" ON "telemetry_events" USING btree ("event_type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telemetry_events_user_created_idx" ON "telemetry_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telemetry_events_created_idx" ON "telemetry_events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_user_created_idx" ON "usage_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_agent_created_idx" ON "usage_events" USING btree ("agent_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_workspace_created_idx" ON "usage_events" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connections_workspace_idx" ON "user_connections" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connections_addressee_idx" ON "user_connections" USING btree ("addressee_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connections_requester_idx" ON "user_connections" USING btree ("requester_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_records_actor_idx" ON "work_records" USING btree ("actor_type","actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_records_target_idx" ON "work_records" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_brain_files_ws_idx" ON "workspace_brain_files" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_brain_files_file_idx" ON "workspace_brain_files" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_brain_files_ws_file_uq" ON "workspace_brain_files" USING btree ("workspace_id","file_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_local_worktrees_workspace_executor_idx" ON "workspace_local_worktrees" USING btree ("workspace_id","executor_node_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_local_worktrees_updated_idx" ON "workspace_local_worktrees" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_presence_last_seen_idx" ON "workspace_presence" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workspace_session_history_events_session_seq_v2" ON "workspace_session_history_events" USING btree ("session_id","session_seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workspace_session_history_events_turn_seq_v2" ON "workspace_session_history_events" USING btree ("turn_id","turn_seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workspace_session_history_projection_workspace_updated_at" ON "workspace_session_history_projection" USING btree ("workspace_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workspace_session_history_projection_task_updated_at" ON "workspace_session_history_projection" USING btree ("task_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_session_history_turns_session_idx" ON "workspace_session_history_turns" USING btree ("session_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_sessions_workspace_idx" ON "workspace_sessions" USING btree ("workspace_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_sessions_executor_idx" ON "workspace_sessions" USING btree ("executor_node_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_sessions_distributed_task_idx" ON "workspace_sessions" USING btree ("distributed_task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_shares_target_idx" ON "workspace_shares" USING btree ("target_type","target_id","revoked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_shares_workspace_idx" ON "workspace_shares" USING btree ("workspace_id","revoked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspaces_project_idx" ON "workspaces" USING btree ("project_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspaces_executor_idx" ON "workspaces" USING btree ("executor_node_id");