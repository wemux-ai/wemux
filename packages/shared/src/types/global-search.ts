// [INPUT]: 全局搜索契约输入
// [OUTPUT]: 全局搜索类型与结果结构
// [POS]: 跨端共享的全局搜索协议（server 返回结构 / web 面板消费）；纯类型无副作用
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

/** 全局搜索结果类型：会话/工作区/Agent/联系人/协作空间内容（项目/任务/云盘/技能）。 */
export const GLOBAL_SEARCH_TYPES = [
  'chat',
  'workspace',
  'agent',
  'contact',
  'project',
  'task',
  'drive',
  'skill',
] as const

export type GlobalSearchType = (typeof GLOBAL_SEARCH_TYPES)[number]

/** 单条全局搜索结果。route 为前端可跳转的深链（/kanban、/workspace、/agents、/profile 等）。 */
export type GlobalSearchResult = {
  type: GlobalSearchType
  id: string
  title: string
  snippet: string
  route: string
}

export type GlobalSearchResponse = {
  query: string
  results: GlobalSearchResult[]
}
