# GitHub Resource Model

## Goal

Pull requests, issues, and workflow runs are provider resources. Tasks, workspaces,
and workspace sessions may reference them, but do not own their remote state.

The system therefore keeps three independent authorities:

1. Provider-specific resource records store synchronized GitHub facts.
2. `github_project_resources` stores which Wemux projects can use each resource.
3. `github_resource_bindings` stores relationships to Wemux execution context.

`Task.result.delivery` and `Workspace.deliverySummary` remain historical execution
snapshots. They are not a live GitHub status source.

## Canonical Records

| Resource | Store | Identity |
| --- | --- | --- |
| Pull request | `project_pull_requests` | provider + repository + PR number |
| Issue | `project_issues` | provider + repository + issue number |
| Workflow run | `project_workflow_runs` | provider + repository + run id |

Webhook delivery, explicit synchronization, Agent delivery registration, and
manual PR creation all upsert these records. Repeated ingestion must update the
same record rather than create a second representation.

## Project Scope

Provider resource identity is global to the GitHub repository, so one PR, issue,
or workflow run has one synchronized fact record even when several Wemux
projects point at the same repository.

`github_project_resources` is the many-to-many project membership layer:

`provider + resourceType + resourceId + projectId`

Project-scoped APIs resolve records through this table and project the matching
`projectId` into compatibility response types. Synchronization must add a link;
it must not replace the resource record's previous project membership.

## Bindings

`github_resource_bindings` links one canonical resource to one local context:

- `taskId`
- `workspaceId`
- `workspaceSessionId`

A binding may contain any non-empty combination of these identifiers. The
combination is normalized into `contextKey`, and uniqueness is enforced by:

`provider + resourceType + resourceId + contextKey + role`

This supports:

- one PR linked to both its task and execution workspace;
- multiple PRs linked to one task;
- a workflow run linked to the workspace session whose branch triggered it;
- an issue referenced by several tasks without copying the issue itself.

## Confidence And Decisions

Branch matching creates `suggested` bindings. Agent delivery, manual selection,
PR creation, and review workflow creation create `confirmed` bindings.

An explicit `confirmed` or `rejected` decision is not overwritten by later
heuristic synchronization. A later explicit decision may replace an earlier
explicit decision.

## API Boundary

Core consumers use:

- `GET /api/github/pull-requests`
- `GET /api/github/resource-bindings`
- `POST /api/github/resource-bindings`

These routes require normal project authorization but do not depend on Review
Center feature access. Review Center keeps compatibility routes under
`/api/review/*`.

UI consumers join resource records and bindings by `resourceId`. Compatibility
fields such as `matchedTaskId` are projections for older Review Center callers,
not the relationship authority.

All binding joins must include `projectId` as well as `resourceId`, because the
same GitHub resource may be visible through more than one Wemux project.

## Synchronization

- Pull requests: explicit project sync, webhook updates, Agent/manual creation,
  and task PR status refresh.
- Issues: webhook updates and explicit Review Center refresh.
- Workflow runs: webhook updates and explicit Actions refresh.

Issue and Actions refreshes persist the returned records before responding.
Workflow run synchronization also creates branch-based suggested bindings.

## Future Remote Conversations

GitHub comments and review threads should be modeled as provider conversation
records referencing a canonical resource id. Wemux task comments remain local
collaboration records.

Do not copy GitHub comments into task comments as a second authority. Cross-post
operations should store provider ids, delivery state, actor identity, and an
idempotency key so retries cannot duplicate remote comments.
