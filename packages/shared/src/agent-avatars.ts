// [INPUT]: 无（纯常量与纯函数）
// [OUTPUT]: 内置 Agent 头像 url 列表与随机选取
// [POS]: 跨端共享契约（server 创建时分配默认头像，web 展示同一批 url）；避免 server/web 各维护一份漂移
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

/** 20 个内置 Agent 头像（与 web 的 BUILT_IN_AGENT_AVATARS 对应，url 单一来源） */
export const BUILT_IN_AGENT_AVATAR_URLS = [
  '/agents/avatars/agent-01.png',
  '/agents/avatars/agent-02.png',
  '/agents/avatars/agent-03.png',
  '/agents/avatars/agent-04.png',
  '/agents/avatars/agent-05.png',
  '/agents/avatars/agent-06.png',
  '/agents/avatars/agent-07.png',
  '/agents/avatars/agent-08.png',
  '/agents/avatars/agent-09.png',
  '/agents/avatars/agent-10.png',
  '/agents/avatars/agent-11.png',
  '/agents/avatars/agent-12.png',
  '/agents/avatars/agent-13.png',
  '/agents/avatars/agent-14.png',
  '/agents/avatars/agent-15.png',
  '/agents/avatars/agent-16.png',
  '/agents/avatars/agent-17.png',
  '/agents/avatars/agent-18.png',
  '/agents/avatars/agent-19.png',
  '/agents/avatars/agent-20.png',
] as const

export type BuiltInAgentAvatarUrl = typeof BUILT_IN_AGENT_AVATAR_URLS[number]

/** 随机选取一个内置头像 url（创建 Agent 未传 avatarUrl 时分配默认头像，落库稳定） */
export const randomBuiltInAgentAvatarUrl = (): BuiltInAgentAvatarUrl => {
  const index = Math.floor(Math.random() * BUILT_IN_AGENT_AVATAR_URLS.length)
  return BUILT_IN_AGENT_AVATAR_URLS[index]
}
