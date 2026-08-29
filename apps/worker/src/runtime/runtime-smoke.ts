// [INPUT]: runtime 启动检查输入
// [OUTPUT]: smoke 结果
// [POS]: runtime smoke 测试
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { isAgentType, AGENT_TYPES } from '@shared/agent-type'
import { getStringFlag, hasFlag, parseCliFlags } from '../cli-flags'
import { loadWorkerConfig } from '../core/config'
import { runWorkerAgentPrompt } from '../execution/agent-runner'

const resolveAgentType = (value: string) => {
  if (isAgentType(value)) {
    return value
  }

  throw new Error(`Unknown agent type: ${value || '<empty>'}. Expected one of: ${AGENT_TYPES.join(', ')}`)
}

export const runWorkerRuntimeSmokeCli = async (args: string[]) => {
  const flags = parseCliFlags(args)
  const agentType = resolveAgentType(getStringFlag(flags, 'agent'))
  const prompt = getStringFlag(flags, 'prompt')

  if (!prompt) {
    throw new Error('Missing required `--prompt` value.')
  }

  const cwd = getStringFlag(flags, 'cwd') || process.cwd()
  const title = getStringFlag(flags, 'title') || `${agentType} Runtime Smoke`
  const executionModel = getStringFlag(flags, 'model') || undefined
  const config = loadWorkerConfig()
  const result = await runWorkerAgentPrompt({
    agentType,
    cwd,
    title,
    prompt,
    executionModel,
    agentSettings: config.agentSettings[agentType],
    mcpServers: config.mcpServers,
    runtimeSkillPackages: config.runtimeSkillPackages,
    skipRuntimeCheck: hasFlag(flags, 'skip-runtime-check'),
  })

  const payload = {
    ok: true,
    agentType,
    cwd,
    title,
    executionModel: executionModel ?? '',
    output: result.output,
    sessionId: result.sessionId ?? '',
    filesChanged: 'filesChanged' in result ? (result.filesChanged ?? []) : [],
  }

  if (hasFlag(flags, 'json')) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  console.log(`[worker] ${agentType} runtime smoke succeeded`)
  console.log(result.output)
}
