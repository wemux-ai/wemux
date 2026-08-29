// [INPUT]: 「新增」入口、账号连接状态、在线执行节点；模板目录 provider-auth-templates。
// [OUTPUT]: 新增模型选择浮窗：自定义配置入口 + 账号订阅登录 + API Key 模板网格。
// [POS]: 模型中心新增入口选择器；替代原下拉菜单，以网格承载持续扩充的内置模板。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { ChevronRight, SlidersHorizontal } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useTranslation } from '../../lib/i18n/react'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { AccountStatusDot } from './account-connect-dialogs'
import { AUTH_PROVIDER_TEMPLATES, type AuthProviderTemplate } from './provider-auth-templates'
import { ProviderLogo } from './provider-logo'

function TemplateCard({
  template,
  connected,
  disabled,
  onSelect,
}: {
  template: AuthProviderTemplate
  connected?: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  const { language } = useTranslation()
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'group flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5 text-left transition-colors',
        'hover:border-zinc-600 hover:bg-zinc-900',
        'disabled:pointer-events-none disabled:opacity-45',
      )}
    >
      <ProviderLogo providerId={template.providerId} size={28} className="rounded-[6px]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-zinc-200">
          {template.label}
        </span>
        <span className="block truncate text-[10px] leading-4 text-zinc-500">
          {language === 'zh' ? template.descriptionZh : template.descriptionEn}
        </span>
      </span>
      {connected !== undefined ? <AccountStatusDot connected={connected} /> : null}
    </button>
  )
}

export function ModelAddDialog({
  open,
  onOpenChange,
  chatgptConnected,
  claudeConnected,
  openrouterConnected,
  chatgptDisabled,
  onSelectCustom,
  onSelectChatgpt,
  onSelectClaude,
  onSelectOpenrouter,
  onSelectApiKeyTemplate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chatgptConnected: boolean
  claudeConnected: boolean
  openrouterConnected: boolean
  /** 无在线执行节点时禁用 ChatGPT 账号登录 */
  chatgptDisabled: boolean
  onSelectCustom: () => void
  onSelectChatgpt: () => void
  onSelectClaude: () => void
  onSelectOpenrouter: () => void
  onSelectApiKeyTemplate: (templateId: string) => void
}) {
  const { language } = useTranslation()
  const oauthTemplates = AUTH_PROVIDER_TEMPLATES.filter((template) => template.kind !== 'api-key')
  const apiKeyTemplates = AUTH_PROVIDER_TEMPLATES.filter((template) => template.kind === 'api-key')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{language === 'zh' ? '新增模型' : 'Add Model'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="max-h-[70vh] overflow-y-auto py-4">
          <div className="space-y-5">
            {/* 自定义配置 */}
            <button
              type="button"
              onClick={onSelectCustom}
              className="flex w-full items-center gap-3 rounded-lg border border-dashed border-zinc-700 px-3 py-3 text-left transition-colors hover:border-zinc-500 hover:bg-zinc-900"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-zinc-800 bg-zinc-900 text-zinc-300">
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-zinc-200">
                  {language === 'zh' ? '自定义模型配置' : 'Custom Model Config'}
                </span>
                <span className="block text-[10px] leading-4 text-zinc-500">
                  {language === 'zh'
                    ? '手动填写 Provider、Base URL 与模型 ID，适合任意 OpenAI/Anthropic 兼容服务'
                    : 'Manually set provider, base URL and model IDs for any OpenAI/Anthropic-compatible service'}
                </span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
            </button>

            {/* 账号订阅登录 */}
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                {language === 'zh' ? '账号订阅登录' : 'Account Subscription'}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <TemplateCard
                  template={oauthTemplates.find((template) => template.id === 'chatgpt')!}
                  connected={chatgptConnected}
                  disabled={chatgptDisabled}
                  onSelect={onSelectChatgpt}
                />
                <TemplateCard
                  template={oauthTemplates.find((template) => template.id === 'claude')!}
                  connected={claudeConnected}
                  onSelect={onSelectClaude}
                />
                <TemplateCard
                  template={oauthTemplates.find((template) => template.id === 'openrouter')!}
                  connected={openrouterConnected}
                  onSelect={onSelectOpenrouter}
                />
              </div>
            </div>

            {/* API Key 快速接入 */}
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                {language === 'zh' ? 'API Key 快速接入' : 'API Key Quick Connect'}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {apiKeyTemplates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onSelect={() => onSelectApiKeyTemplate(template.id)}
                  />
                ))}
              </div>
            </div>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
