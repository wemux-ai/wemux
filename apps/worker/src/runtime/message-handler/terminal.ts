/**
 * [INPUT]: Control-plane terminal protocol messages and worker terminal session callbacks.
 * [OUTPUT]: Terminal lifecycle responses, live events, local attach tickets, and Zellij metadata updates.
 * [POS]: Worker protocol boundary for persistent terminal session management.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { mkdirSync } from 'node:fs'
import { buildWorkspaceTerminalSessionKey, type ControlPlaneToExecutorMessage, type WorkspaceTerminalSessionDescriptor } from '@shared/types'
import { loadWorkerConfig, getWorkerHome } from '../../core/config'
import { getWorkerRuntimeState } from '../../core/runtime-state'
import { logTerminalMessage } from './shared'
import type { ControlPlaneMessageHandlerParams } from './types'
import { normalizeFilesystemPath } from '../local-git-repository'
import { createLocalTerminalAttachTicket, hasLocalTerminalDirectSession } from '../local-terminal-direct'
import { isManagedProjectPath, remapManagedProjectPath } from '../managed-workspace-path'
import { removeZellijTerminalMetadata, upsertZellijTerminalMetadata } from '../zellij-terminal-metadata'

const resolveTerminalTitle = (message: Extract<ControlPlaneToExecutorMessage, { type: 'executor.terminal.session.create' }>) => {
  const explicit = message.title?.trim()
  if (explicit) {
    return explicit
  }
  return message.scope === 'workspace'
    ? `Workspace ${message.terminalId}`
    : `Terminal ${message.terminalId}`
}

const listSessions = (
  message: Extract<ControlPlaneToExecutorMessage, { type: 'executor.terminal.sessions.list.request' }>,
  params: ControlPlaneMessageHandlerParams,
) => {
  const config = params.getConfig()
  params.send({
    type: 'executor.terminal.sessions.list.response',
    executorId: config.executorId!,
    requestId: message.requestId,
    result: {
      ok: true,
      sessions: params.terminalSessions.list({
        executorId: config.executorId!,
        scope: message.scope,
        workspaceId: message.workspaceId,
      }),
    },
    at: new Date().toISOString(),
  })
}

const ensureTerminalCwd = (workspaceRoot: string, cwd?: string) => {
  const resolvedCwd = remapManagedProjectPath(workspaceRoot, cwd || workspaceRoot) || normalizeFilesystemPath(workspaceRoot)
  if (isManagedProjectPath(workspaceRoot, resolvedCwd)) {
    mkdirSync(resolvedCwd, { recursive: true })
  }
  return resolvedCwd
}

const removePersistedZellijTerminalMetadata = (
  workspaceRoot: string,
  descriptor: Pick<WorkspaceTerminalSessionDescriptor, 'executorId' | 'scope' | 'terminalId' | 'workspaceId'>,
) => {
  try {
    removeZellijTerminalMetadata(workspaceRoot, descriptor)
  } catch (error) {
    const warning = error instanceof Error ? error.message : 'unknown'
    console.warn('[worker] failed to remove zellij terminal metadata', warning)
  }
}

export const buildTerminalSessionCallbacks = (params: {
  config: ReturnType<ControlPlaneMessageHandlerParams['getConfig']>
  send: ControlPlaneMessageHandlerParams['send']
  ownerUserId?: string
}) => ({
  onPersistentReady: (descriptor: WorkspaceTerminalSessionDescriptor) => {
    try {
      // zellij 会话元数据是节点级状态：固定落机器级 workerHome，不随 workspaceRoot 走
      upsertZellijTerminalMetadata(getWorkerHome(), {
        executorId: descriptor.executorId,
        scope: descriptor.scope,
        terminalId: descriptor.terminalId,
        workspaceId: descriptor.workspaceId,
        title: descriptor.title,
        cwd: descriptor.cwd,
        ownerUserId: descriptor.ownerUserId ?? params.ownerUserId,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown'
      console.warn('[worker] failed to persist zellij terminal metadata', message)
    }
  },
  onReady: (descriptor: WorkspaceTerminalSessionDescriptor) => {
    params.send({
      type: 'executor.terminal.session.ready',
      executorId: params.config.executorId!,
      terminalId: descriptor.terminalId,
      terminalKey: descriptor.terminalKey,
      cwd: descriptor.cwd,
      mode: descriptor.mode,
      at: new Date().toISOString(),
    })
  },
  onOutput: (descriptor: WorkspaceTerminalSessionDescriptor, stream: 'stdout' | 'stderr' | 'system', chunk: string) => {
    params.send({
      type: 'executor.terminal.session.output',
      executorId: params.config.executorId!,
      output: {
        terminalId: descriptor.terminalId,
        terminalKey: descriptor.terminalKey,
        stream,
        chunk,
        at: new Date().toISOString(),
      },
    })
  },
  onExit: (descriptor: WorkspaceTerminalSessionDescriptor, exitCode: number) => {
    if (descriptor.backend === 'zellij') {
      removePersistedZellijTerminalMetadata(getWorkerHome(), descriptor)
    }
    params.send({
      type: 'executor.terminal.session.exit',
      executorId: params.config.executorId!,
      terminalId: descriptor.terminalId,
      terminalKey: descriptor.terminalKey,
      exitCode,
      at: new Date().toISOString(),
    })
  },
})

export const handleTerminalMessage = (
  message: ControlPlaneToExecutorMessage,
  params: ControlPlaneMessageHandlerParams,
) => {
  let config = params.getConfig()

  const refreshConfig = () => {
    config = loadWorkerConfig()
    params.setConfig(config)
    return config
  }

  if (message.type === 'executor.terminal.request') {
    refreshConfig()
    const startedAt = Date.now()
    let resolvedCwd: string
    try {
      resolvedCwd = ensureTerminalCwd(config.workspaceRoot, message.cwd)
    } catch (error) {
      const stderr = error instanceof Error ? `项目目录准备失败：${error.message}` : '项目目录准备失败。'
      params.send({
        type: 'executor.terminal.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result: {
          command: message.command,
          cwd: message.cwd,
          stdout: '',
          stderr,
          exitCode: 1,
          mode: message.mode ?? 'wait',
          at: new Date().toISOString(),
        },
      })
      return true
    }
    logTerminalMessage('received one-shot terminal request', {
      requestId: message.requestId,
      command: message.command,
      cwd: resolvedCwd,
      mode: message.mode ?? 'wait',
    })
    void params.runTerminalCommand(message.command, resolvedCwd, {
      mode: message.mode ?? 'wait',
      timeoutMs: message.timeoutMs,
      runtimeEnvironment: message.runtimeEnvironment,
    }).then((result) => {
      params.send({
        type: 'executor.terminal.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
      })
      logTerminalMessage('completed one-shot terminal request', {
        requestId: message.requestId,
        durationMs: Date.now() - startedAt,
        exitCode: result.exitCode,
      })
    }).catch((error) => {
      logTerminalMessage('failed one-shot terminal request', {
        requestId: message.requestId,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return true
  }

  if (message.type === 'executor.terminal.sessions.list.request') {
    refreshConfig()
    listSessions(message, params)
    return true
  }

  if (message.type === 'executor.terminal.session.create') {
    refreshConfig()
    let resolvedCwd: string
    try {
      resolvedCwd = ensureTerminalCwd(config.workspaceRoot, message.cwd)
    } catch (error) {
      params.send({
        type: 'executor.terminal.session.create.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result: {
          ok: false,
          created: false,
          message: error instanceof Error ? `项目目录准备失败：${error.message}` : '项目目录准备失败。',
        },
        at: new Date().toISOString(),
      })
      return true
    }
    const title = resolveTerminalTitle(message)
    const result = params.terminalSessions.ensure({
      executorId: config.executorId!,
      scope: message.scope,
      terminalId: message.terminalId,
      workspaceId: message.workspaceId,
      title,
      cwd: resolvedCwd,
      ownerUserId: message.ownerUserId,
      cols: message.cols,
      rows: message.rows,
      workspaceRoot: config.workspaceRoot,
      runtimeEnvironment: message.runtimeEnvironment,
      ...buildTerminalSessionCallbacks({ config, send: params.send, ownerUserId: message.ownerUserId }),
    })

    params.send({
      type: 'executor.terminal.session.create.response',
      executorId: config.executorId!,
      requestId: message.requestId,
      result: {
        ok: true,
        created: result.created,
        session: result.descriptor,
        sessions: params.terminalSessions.list({
          executorId: config.executorId!,
          scope: message.scope,
          workspaceId: message.workspaceId,
        }),
      },
      at: new Date().toISOString(),
    })
    return true
  }

  if (message.type === 'executor.terminal.session.attach') {
    refreshConfig()
    const attached = params.terminalSessions.attach({
      executorId: config.executorId!,
      scope: message.scope,
      terminalId: message.terminalId,
      workspaceId: message.workspaceId,
      clientId: message.clientId,
    })

    if (!attached) {
      params.send({
        type: 'executor.terminal.session.attach.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result: {
          ok: false,
          message: '终端会话不存在。',
        },
        at: new Date().toISOString(),
      })
      return true
    }

    params.send({
      type: 'executor.terminal.session.attach.response',
      executorId: config.executorId!,
      requestId: message.requestId,
      result: {
        ok: true,
        session: attached.descriptor,
        snapshot: attached.snapshot,
      },
      at: new Date().toISOString(),
    })
    return true
  }

  if (message.type === 'executor.terminal.local-attach-ticket.request') {
    refreshConfig()
    const localConsole = getWorkerRuntimeState().localConsole
    if (!localConsole?.enabled || !localConsole.port) {
      params.send({
        type: 'executor.terminal.local-attach-ticket.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result: {
          ok: false,
          message: localConsole?.disabledReason || 'Local console is not available on this worker.',
        },
        at: new Date().toISOString(),
      })
      return true
    }

    if (!hasLocalTerminalDirectSession({
      executorId: config.executorId!,
      scope: message.scope,
      terminalId: message.terminalId,
      workspaceId: message.workspaceId,
    })) {
      let resolvedCwd: string
      try {
        resolvedCwd = ensureTerminalCwd(config.workspaceRoot, message.cwd)
      } catch (error) {
        params.send({
          type: 'executor.terminal.local-attach-ticket.response',
          executorId: config.executorId!,
          requestId: message.requestId,
          result: {
            ok: false,
            message: error instanceof Error ? `项目目录准备失败：${error.message}` : '项目目录准备失败。',
          },
          at: new Date().toISOString(),
        })
        return true
      }

      const title = message.scope === 'workspace'
        ? `Workspace ${message.terminalId}`
        : `Terminal ${message.terminalId}`

      params.terminalSessions.ensure({
        executorId: config.executorId!,
        scope: message.scope,
        terminalId: message.terminalId,
        workspaceId: message.workspaceId,
        title,
        cwd: resolvedCwd,
        workspaceRoot: config.workspaceRoot,
        ...buildTerminalSessionCallbacks({ config, send: params.send }),
      })

      if (!hasLocalTerminalDirectSession({
        executorId: config.executorId!,
        scope: message.scope,
        terminalId: message.terminalId,
        workspaceId: message.workspaceId,
      })) {
        params.send({
          type: 'executor.terminal.local-attach-ticket.response',
          executorId: config.executorId!,
          requestId: message.requestId,
          result: {
            ok: false,
            message: '终端会话不存在。',
          },
          at: new Date().toISOString(),
        })
        return true
      }
    }

    const result = createLocalTerminalAttachTicket({
      executorId: config.executorId!,
      scope: message.scope,
      terminalId: message.terminalId,
      workspaceId: message.workspaceId,
    })

    params.send({
      type: 'executor.terminal.local-attach-ticket.response',
      executorId: config.executorId!,
      requestId: message.requestId,
      result: result.ok
        ? {
            ...result,
            wsUrl: `ws://127.0.0.1:${localConsole.port}/api/terminal-direct/ws`,
          }
        : result,
      at: new Date().toISOString(),
    })
    return true
  }

  if (message.type === 'executor.terminal.session.detach') {
    refreshConfig()
    params.terminalSessions.detach({
      executorId: config.executorId!,
      scope: message.scope,
      terminalId: message.terminalId,
      workspaceId: message.workspaceId,
      clientId: message.clientId,
    })
    return true
  }

  if (message.type === 'executor.terminal.session.input') {
    refreshConfig()
    params.terminalSessions.write({
      executorId: config.executorId!,
      scope: message.scope,
      terminalId: message.terminalId,
      workspaceId: message.workspaceId,
      input: message.input,
    })
    return true
  }

  if (message.type === 'executor.terminal.session.resize') {
    refreshConfig()
    params.terminalSessions.resize({
      executorId: config.executorId!,
      scope: message.scope,
      terminalId: message.terminalId,
      workspaceId: message.workspaceId,
      cols: message.cols,
      rows: message.rows,
    })
    return true
  }

  if (message.type === 'executor.terminal.session.close') {
    refreshConfig()
    removePersistedZellijTerminalMetadata(getWorkerHome(), {
      executorId: config.executorId!,
      scope: message.scope,
      terminalId: message.terminalId,
      workspaceId: message.workspaceId,
    })
    const closed = params.terminalSessions.close({
      executorId: config.executorId!,
      scope: message.scope,
      terminalId: message.terminalId,
      workspaceId: message.workspaceId,
    })
    params.send({
      type: 'executor.terminal.session.close.response',
      executorId: config.executorId!,
      requestId: message.requestId,
      result: {
        ok: true,
        closed: Boolean(closed),
        session: closed ?? undefined,
        sessions: params.terminalSessions.list({
          executorId: config.executorId!,
        }),
      },
      at: new Date().toISOString(),
    })
    return true
  }

  return false
}
