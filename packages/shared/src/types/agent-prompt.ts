import type { ModelTokenUsage } from './task-domain'

/**
 * Shared base for all agent prompt result types.
 *
 * Worker, executor protocol, and server layers each extend this
 * with layer-specific fields. The common fields ensure a consistent
 * contract for "what came back from an agent prompt execution."
 */
export interface AgentPromptResultBase {
  /** Whether the execution succeeded. */
  ok: boolean
  /** The text output from the agent. */
  output: string
  /** Runtime session ID for multi-turn continuation. */
  sessionId?: string
  /** Whether the execution was aborted (vs failed). */
  aborted?: boolean
  /** Token usage statistics, if available. */
  usage?: ModelTokenUsage
}
