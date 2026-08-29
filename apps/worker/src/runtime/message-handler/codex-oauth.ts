// [INPUT]: 控制面下发的 codex-oauth WS 请求（device/accounts/export 操作）与 worker 本地 codex-oauth 服务。
// [OUTPUT]: 把控制面请求转成 worker 本地 codex-oauth 函数调用并通过 WS 回包。
// [POS]: worker 消息分发边界；与 local-api/server.ts 的 HTTP 端点共用同一套 codex-oauth 实现。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ControlPlaneToExecutorMessage, ExecutorCodexOauthResponsePayload } from '@shared/types'
import { loadWorkerRuntimeConfig } from '../../core/runtime-cloud-url'
import {
  dismissCodexDeviceLogin,
  getCodexDeviceStatus,
  listCodexAccounts,
  readSelectedCodexAuthContent,
  removeCodexAccount,
  selectCodexAccount,
  startCodexDeviceLogin,
} from '../codex-oauth'
import type { ControlPlaneMessageHandlerParams } from './types'

const respond = (params: ControlPlaneMessageHandlerParams, message: Extract<ControlPlaneToExecutorMessage, { type: 'executor.codex-oauth.request' }>, result: {
  ok: true
  payload?: ExecutorCodexOauthResponsePayload
} | {
  ok: false
  error: string
}) => {
  params.send({
    type: 'executor.codex-oauth.response',
    executorId: loadWorkerRuntimeConfig().executorId ?? '',
    requestId: message.requestId,
    operation: message.operation,
    ok: result.ok,
    payload: result.ok ? result.payload : undefined,
    error: result.ok ? undefined : result.error,
    at: new Date().toISOString(),
  })
}

export const handleCodexOauthMessage = (
  message: ControlPlaneToExecutorMessage,
  params: ControlPlaneMessageHandlerParams,
): boolean => {
  if (message.type !== 'executor.codex-oauth.request') {
    return false
  }

  const userId = message.userId?.trim()
  if (!userId) {
    respond(params, message, { ok: false, error: 'userId is required' })
    return true
  }

  const fail = (error: unknown) => respond(params, message, {
    ok: false,
    error: error instanceof Error ? error.message : 'codex oauth operation failed',
  })

  switch (message.operation) {
    case 'device.start':
      void startCodexDeviceLogin(userId).then(
        (status) => respond(params, message, { ok: true, payload: status }),
        fail,
      )
      return true

    case 'device.status':
      respond(params, message, { ok: true, payload: getCodexDeviceStatus(userId) })
      return true

    case 'device.dismiss':
      dismissCodexDeviceLogin(userId)
      respond(params, message, { ok: true, payload: { ok: true } })
      return true

    case 'accounts.list':
      respond(params, message, { ok: true, payload: listCodexAccounts(userId) })
      return true

    case 'accounts.select': {
      const accountId = message.accountId?.trim()
      if (!accountId) {
        respond(params, message, { ok: false, error: 'userId and accountId are required' })
        return true
      }
      const index = selectCodexAccount(userId, accountId)
      respond(params, message, { ok: true, payload: index })
      return true
    }

    case 'accounts.remove': {
      const accountId = message.accountId?.trim()
      if (!accountId) {
        respond(params, message, { ok: false, error: 'userId and accountId are required' })
        return true
      }
      const index = removeCodexAccount(userId, accountId)
      respond(params, message, { ok: true, payload: index })
      return true
    }

    case 'export': {
      const index = listCodexAccounts(userId)
      respond(params, message, {
        ok: true,
        payload: {
          authContent: readSelectedCodexAuthContent(userId),
          account: index.accounts.find((item) => item.id === index.activeAccountId) ?? null,
        },
      })
      return true
    }

    default:
      respond(params, message, { ok: false, error: `unknown codex oauth operation: ${message.operation}` })
      return true
  }
}
