// [INPUT]: 路由请求
// [OUTPUT]: 路由选择
// [POS]: 路由客户端
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ExecutorConnectionRouteResponse } from '@shared/types'
import { trimTrailingSlash } from './cloud-url'
import { requestJson } from './request-json'

export const resolveWorkerConnectionRoute = async (params: {
  bootstrapCloudUrl: string
  executorToken: string
}) => {
  return requestJson<ExecutorConnectionRouteResponse>({
    url: `${trimTrailingSlash(params.bootstrapCloudUrl)}/api/control-plane/executors/connection-route`,
    headers: {
      Authorization: `Bearer ${params.executorToken}`,
    },
    errorMessage: 'Worker connection route resolution failed.',
  })
}
