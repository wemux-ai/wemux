// [INPUT]: Saved QR-bound Feishu credentials and a normalized inbound callback.
// [OUTPUT]: One managed SDK long connection per enabled custom Agent.
// [POS]: Feishu transport runtime; business message handling is injected by the service layer.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md.
import * as Lark from '@larksuiteoapi/node-sdk'
import { readCustomAgentConfig } from '@shared/custom-agent'
import { getAllAgents } from '../../repositories/agent'

type InboundHandler = (params: { agentId: string; event: unknown }) => Promise<void>

const clients = new Map<string, { fingerprint: string; client: Lark.WSClient }>()
let inboundHandler: InboundHandler | null = null

export const startFeishuLongConnections = (handler: InboundHandler) => {
  inboundHandler = handler
  syncFeishuLongConnections()
}

export const syncFeishuLongConnections = () => {
  const desired = new Map<string, { fingerprint: string; appId: string; appSecret: string }>()
  for (const agent of getAllAgents()) {
    const feishu = readCustomAgentConfig(agent.config).channels.feishu
    if (feishu.enabled && feishu.connectionMode === 'long-connection' && feishu.appId && feishu.appSecret) {
      desired.set(agent.id, { fingerprint: `${feishu.appId}:${feishu.appSecret}`, appId: feishu.appId, appSecret: feishu.appSecret })
    }
  }

  for (const [agentId, entry] of clients) {
    if (desired.get(agentId)?.fingerprint !== entry.fingerprint) {
      entry.client.close({ force: true })
      clients.delete(agentId)
    }
  }

  for (const [agentId, config] of desired) {
    if (clients.has(agentId) || !inboundHandler) continue
    const client = new Lark.WSClient({
      appId: config.appId,
      appSecret: config.appSecret,
      source: 'vibemux',
      loggerLevel: Lark.LoggerLevel.warn,
      onError: (error) => console.error(`[feishu] Long connection failed for ${agentId}:`, error),
    })
    const dispatcher = new Lark.EventDispatcher({ loggerLevel: Lark.LoggerLevel.warn }).register({
      'im.message.receive_v1': async (event: unknown) => {
        void inboundHandler?.({ agentId, event }).catch((error) => {
          console.error(`[feishu] Long connection inbound failed for ${agentId}:`, error)
        })
      },
    })
    clients.set(agentId, { fingerprint: config.fingerprint, client })
    void client.start({ eventDispatcher: dispatcher }).catch((error: unknown) => {
      console.error(`[feishu] Long connection start failed for ${agentId}:`, error)
    })
  }
}

export const stopFeishuLongConnections = () => {
  for (const { client } of clients.values()) client.close({ force: true })
  clients.clear()
  inboundHandler = null
}
