import { Cpu, MessageSquareText, Settings2 } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { cn } from '../../lib/utils'
import { text } from './chat-route-helpers'
import type { ChatRouteController } from './use-chat-route-controller'
import type { Language } from '../../lib/i18n'

type ChatConfigDialogProps = {
  controller: ChatRouteController
  language: Language
}

export function ChatConfigDialog({ controller, language }: ChatConfigDialogProps) {
  const selectedCustomAgentId = controller.selectedChatAgent?.kind === 'custom'
    ? controller.selectedChatAgent.id
    : ''

  return (
    <Dialog open={controller.showConfigDialog} onOpenChange={controller.setShowConfigDialog}>
      <DialogContent className="max-h-[92vh] max-w-[760px] overflow-y-auto border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-50">
            <Settings2 size={18} />
            {text(language, 'Agent 设置', 'Agent Settings')}
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            {text(
              language,
              '在对话页里查看 Agent / OpenCode 相关配置与全局 MCP 概览；系统级 MCP 请到设置页维护。',
              'View Agent / OpenCode config and global MCP overview from the chat page. Manage system-level MCP in Settings.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 px-5 py-4 md:grid-cols-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Skills</p>
            <p className="mt-2 text-base font-semibold text-zinc-50">{controller.primaryAgentStats.skills}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">MCP</p>
            <p className="mt-2 text-base font-semibold text-zinc-50">{controller.primaryAgentStats.mcpServers}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{text(language, '渠道', 'Channels')}</p>
            <p className="mt-2 text-base font-semibold text-zinc-50">{controller.primaryAgentStats.channels}</p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-4 rounded-[24px] border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Cpu size={16} />
              {text(language, '能力摘要', 'Capability Summary')}
            </div>
            <div className="rounded-lg border border-zinc-800 bg-[#09090b] p-4">
              <p className="text-sm font-medium text-zinc-100">
                {controller.primaryAgentSummary?.name || text(language, 'Agent', 'Agent')}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {controller.primaryAgentSummary?.endpoint || text(language, '未设置 endpoint', 'Endpoint not set')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(controller.primaryAgentConfig?.skills ?? []).slice(0, 6).map((skill) => (
                  <Badge
                    key={skill.id}
                    variant="outline"
                    className={cn(
                      'rounded-full border px-3 py-1',
                      skill.enabled
                        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400',
                    )}
                  >
                    {skill.name}
                  </Badge>
                ))}
                {(controller.primaryAgentConfig?.skills.length ?? 0) === 0 ? (
                  <p className="text-sm text-zinc-500">{text(language, '还没有配置 skill。', 'No skills configured yet.')}</p>
                ) : null}
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-[#09090b] p-4">
              <p className="text-sm font-medium text-zinc-100">{text(language, 'MCP 挂载', 'MCP Mounts')}</p>
              <div className="mt-3 space-y-2">
                {controller.globalMcpServers.slice(0, 4).map((server) => (
                  <div key={server.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-100">{server.name}</p>
                      <p className="mt-1 text-xs text-zinc-500">{server.transport} · {server.capabilityMode}</p>
                    </div>
                    <Badge className={server.enabled ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-zinc-800 bg-zinc-950 text-zinc-400'}>
                      {server.enabled ? text(language, '已启用', 'Enabled') : text(language, '已禁用', 'Disabled')}
                    </Badge>
                  </div>
                ))}
                {controller.globalMcpServers.length === 0 ? (
                  <p className="text-sm text-zinc-500">{text(language, '还没有配置 MCP server。', 'No MCP servers configured yet.')}</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-[24px] border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <MessageSquareText size={16} />
              {text(language, '渠道与路由', 'Channels and Routing')}
            </div>
            <div className="rounded-lg border border-zinc-800 bg-[#09090b] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-zinc-100">Telegram</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {controller.primaryAgentConfig?.channels.telegram.enabled
                      ? text(language, '已为 Agent 启用 Telegram 出站渠道。', 'Telegram outbound channel is enabled for the agent.')
                      : text(language, '未启用 Telegram 渠道。', 'Telegram channel is not enabled.')}
                  </p>
                </div>
                <Badge className={controller.primaryAgentConfig?.channels.telegram.enabled ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-zinc-800 bg-zinc-950 text-zinc-400'}>
                  {controller.primaryAgentConfig?.channels.telegram.enabled ? text(language, '已启用', 'Enabled') : text(language, '已禁用', 'Disabled')}
                </Badge>
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-[#09090b] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-zinc-100">Feishu</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {controller.primaryAgentConfig?.channels.feishu.enabled
                      ? text(language, '已为 Agent 启用飞书出站渠道。', 'Feishu outbound channel is enabled for the agent.')
                      : text(language, '未启用飞书渠道。', 'Feishu channel is not enabled.')}
                  </p>
                </div>
                <Badge className={controller.primaryAgentConfig?.channels.feishu.enabled ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-zinc-800 bg-zinc-950 text-zinc-400'}>
                  {controller.primaryAgentConfig?.channels.feishu.enabled ? text(language, '已启用', 'Enabled') : text(language, '已禁用', 'Disabled')}
                </Badge>
              </div>
            </div>
            <div className="rounded-lg border border-amber-500/10 bg-amber-500/5 p-4 text-sm leading-6 text-zinc-300">
              {text(
                language,
                '正式编辑入口已经迁到独立 `Agents` 页面。头像、长期指令和挂载能力都在当前 Agent 的编辑页维护。',
                'The official editor has moved to the dedicated `Agents` page. Manage the current agent avatar, long-term instructions, and mounted capabilities there.',
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => controller.setShowConfigDialog(false)}
            className="border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-900"
          >
            {text(language, '关闭', 'Close')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              controller.setShowConfigDialog(false)
              window.location.assign(selectedCustomAgentId ? `/agents?agentId=${encodeURIComponent(selectedCustomAgentId)}` : '/agents')
            }}
            className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
          >
            {text(language, selectedCustomAgentId ? '前往该 Agent 编辑页' : '前往 Agents 页面', selectedCustomAgentId ? 'Open This Agent' : 'Open Agents')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
