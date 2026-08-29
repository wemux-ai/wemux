// [INPUT]: 悬浮用户/Agent 卡片「聊天」按钮点击（userId / agentId）
// [OUTPUT]: 把发起私聊 / 进入 Agent 会话的动作路由到当前注册的消费方（/chat 页）
// [POS]: 跨页面轻量 launch 桥；卡片组件不感知具体页面，/chat 挂载时注册 handler
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

type DmLaunchHandler = (userId: string) => void
type AgentLaunchHandler = (agentId: string) => void

let dmLaunchHandler: DmLaunchHandler | null = null
let agentLaunchHandler: AgentLaunchHandler | null = null

export const setDmLaunchHandler = (handler: DmLaunchHandler | null) => {
  dmLaunchHandler = handler
}

export const setAgentLaunchHandler = (handler: AgentLaunchHandler | null) => {
  agentLaunchHandler = handler
}

/** 从用户卡片发起私聊；未注册消费方（不在 /chat 页）时返回 false。 */
export const launchDmFromUserCard = (userId: string): boolean => {
  if (!dmLaunchHandler) {
    return false
  }
  dmLaunchHandler(userId)
  return true
}

/** 从 Agent 卡片进入与该 Agent 的对话；未注册消费方时返回 false。 */
export const launchAgentFromCard = (agentId: string): boolean => {
  if (!agentLaunchHandler) {
    return false
  }
  agentLaunchHandler(agentId)
  return true
}
