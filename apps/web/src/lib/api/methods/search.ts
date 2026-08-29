import type { GlobalSearchResponse, GlobalSearchType } from '@shared/types'
import { request } from '../client'

export type GlobalSearchQuery = {
  q: string
  type?: GlobalSearchType
  limit?: number
}

export const searchMethods = {
  /** 全局搜索：跨会话/工作区/Agent/联系人/协作空间内容，按类型分组返回。 */
  globalSearch: (query: GlobalSearchQuery) => {
    const search = new URLSearchParams({ q: query.q })
    if (query.type) search.set('type', query.type)
    if (query.limit) search.set('limit', String(query.limit))
    return request<GlobalSearchResponse>(`/api/search?${search.toString()}`)
  },
}
