# Iconography System

## Decision

Wemux uses `lucide-react` as the only general-purpose product icon library.
It already ships in the web bundle and is used throughout the application, so
adding a second general icon set would create mixed stroke weight, corner
geometry, naming, and bundle behavior.

Animated icon asset libraries are not a system primitive. They are appropriate
only for intentionally illustrative marketing or onboarding media, and must not
represent persistent operational state. Agent execution needs to remain readable
in dense task, chat, and workspace views even when motion is disabled.

## Semantic Layers

| Layer | Owner | Examples | Rule |
| --- | --- | --- | --- |
| Action | `lucide-react` | create, search, retry, open, delete | Use a Lucide icon for familiar compact controls. |
| Runtime brand | `components/runtime/runtime-icons.tsx` | Codex, Claude Code, OpenCode, Pi, VS Code | Use only for the external runtime or provider identity. |
| Task workflow | `components/task-status-icon.tsx` | backlog, in progress, review, done | Use only for `TaskStatus`; it never represents Agent runtime activity. |
| Agent activity | `components/agent-activity-indicator.tsx` | thinking, executing, waiting, complete, error | Use only for canonical `AgentRunningStatus`. |
| Async action | Local `Loader2` | submit, fetch, upload, save | Represents a short-lived UI request, not an Agent lifecycle. |

## Agent Activity Contract

`AgentActivityIndicator` is the only reusable running effect:

| State | Glyph | Tone | Motion |
| --- | --- | --- | --- |
| `idle` | bot | zinc | none |
| `thinking` | brain | sky | glyph pulse and status dot |
| `executing` | terminal | sky | status dot ping |
| `waiting` | clock | amber | none |
| `complete` | check | emerald | none |
| `error` | error circle | rose | none |

Motion is restricted to active work and uses Tailwind `motion-safe` variants,
so users who request reduced motion receive the same state information without
animation. A status label must remain visible whenever the indicator is the
only explanation of state.

## State Adapters

Do not pass unrelated state types directly into the component:

- Map `AgentTaskRunStatus` at the task-log boundary.
- Keep `WorkspaceSessionRuntimeStatus` as a session/executor state; it does not
  become an Agent activity icon merely because a session is busy.
- Keep `TaskStatus` in `TaskStatusIcon`.
- Keep generic button/request loading as `Loader2`.

This prevents an offline worker, a queued workspace session, and an executing
Agent from accidentally sharing the same visual meaning.

## Usage Rules

- Default compact icon size is `sm` (14px); dense rows use an `xs` dot (6px);
  prominent status text uses `md` (16px).
- Icon-only controls need an accessible name from their button or tooltip.
- Decorative icons are `aria-hidden`; `AgentActivityIndicator` accepts
  `ariaLabel` when it must stand alone.
- Use semantic tones only for state. Do not recolor action icons merely for
  decoration.
- New inline SVGs require a product-specific visual reason. Charts, graphs,
  and task workflow glyphs are valid exceptions; ordinary actions are not.

## Migration Order

1. Use `AgentActivityIndicator` for Agent lifecycle status in chat, task
   execution, and Kanban surfaces.
2. Replace duplicated runtime brand image handling with `RuntimeIcon` or
   `BrandIcon` when touching those screens.
3. Replace duplicated task-status SVGs with `TaskStatusIcon` when changing
   task-list or task-creation UI.
4. Keep one-off `Loader2` uses for local async actions unless they actually
   represent a long-lived Agent state.
