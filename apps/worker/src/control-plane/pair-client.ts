// [INPUT]: 配对码输入
// [OUTPUT]: 配对请求（兑换 token）
// [POS]: 配对客户端
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ExecutorPairRequest, ExecutorPairResponse } from '@shared/types'
import { trimTrailingSlash } from './cloud-url'
import { requestJson } from './request-json'

export const pairWithControlPlane = async (
  request: ExecutorPairRequest,
  cloudUrl: string,
) => {
  return requestJson<ExecutorPairResponse>({
    url: `${trimTrailingSlash(cloudUrl)}/api/control-plane/executors/pair`,
    method: 'POST',
    body: request,
    errorMessage: 'Pair request failed.',
  })
}
