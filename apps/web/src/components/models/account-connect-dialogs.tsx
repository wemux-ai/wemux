// [INPUT]: ChatGPT（设备码）与 Claude（粘贴授权码）的连接 API；在线执行节点。
// [OUTPUT]: 受控连接弹窗：账号登录 → 应用到所有节点 → 回调已连接状态。
// [POS]: 模型中心「新增」菜单触发的账号接入弹窗；替代原左面板账号区块。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, KeyRound, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ExecutorRecord } from '@shared/types'
import { cn } from '../../lib/utils'
import { api, type CodexAccountRecord, type ModelProfileCreatePayload } from '../../lib/api'
import { useTranslation } from '../../lib/i18n/react'
import { Button } from '../ui/button'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import type { AuthProviderTemplate } from './provider-auth-templates'
import { ProviderLogo } from './provider-logo'

const POLL_INTERVAL_MS = 3000

// ── ChatGPT（设备码登录）──────────────────────────────────────────

type ChatgptDeviceView = {
  state: 'starting' | 'pending' | 'complete' | 'error'
  userCode?: string
  verificationUri?: string
  startedAt?: string
  account?: CodexAccountRecord
  message?: string
}

export function ChatgptConnectDialog({
  open,
  onOpenChange,
  onlineExecutors,
  onConnected,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onlineExecutors: ExecutorRecord[]
  onConnected: (accounts: CodexAccountRecord[], activeAccountId: string | null) => void
}) {
  const { t, language } = useTranslation()
  const [deviceView, setDeviceView] = useState<ChatgptDeviceView | null>(null)
  const [copied, setCopied] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const executorId = onlineExecutors[0]?.executorId || ''

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // 父组件轮询会刷新 onConnected 引用；用 ref 持有最新回调，避免授权码被反复重取。
  const onConnectedRef = useRef(onConnected)
  onConnectedRef.current = onConnected
  const executorIdRef = useRef(executorId)
  executorIdRef.current = executorId

  useEffect(() => {
    return stopPolling
  }, [stopPolling])

  useEffect(() => {
    if (!open) {
      return
    }
    setDeviceView(null)
    const executorId = executorIdRef.current
    if (!executorId) {
      toast.error(language === 'zh' ? '没有在线执行节点，请先连接 worker。' : 'No online worker available.')
      return
    }
    let cancelled = false
    setDeviceView({ state: 'starting' })
    void api.startCodexDeviceLogin(executorId)
      .then((result) => {
        if (cancelled) {
          return
        }
        setDeviceView({
          state: 'pending',
          userCode: result.userCode,
          verificationUri: result.verificationUri,
          startedAt: result.startedAt,
        })
        pollRef.current = setInterval(() => {
          void api.getCodexDeviceStatus(executorId)
            .then(async (status) => {
              if (status.state === 'complete' && status.account) {
                stopPolling()
                setDeviceView({ state: 'complete', account: status.account })
                onConnectedRef.current([status.account], status.account.id)
                try {
                  const imported = await api.importCodexAccountToAllExecutors(executorId)
                  toast.success(imported.message || (language === 'zh' ? 'ChatGPT 账号已应用到所有执行节点。' : 'ChatGPT account applied to all executors.'))
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : (language === 'zh' ? '应用账号到所有节点失败。' : 'Failed to apply account to all executors.'))
                }
              } else if (status.state === 'error') {
                stopPolling()
                setDeviceView({ state: 'error', message: status.message || 'login failed' })
              }
            })
            .catch(() => {
              // 轮询失败继续重试
            })
        }, POLL_INTERVAL_MS)
      })
      .catch((error) => {
        if (!cancelled) {
          setDeviceView({ state: 'error', message: error instanceof Error ? error.message : 'failed to start login' })
        }
      })
    return () => {
      cancelled = true
      stopPolling()
    }
  }, [open, language, stopPolling])

  const close = () => {
    stopPolling()
    if (executorId) {
      void api.dismissCodexDeviceLogin(executorId).catch(() => {})
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next) {
        close()
      }
    }}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <ProviderLogo providerId="openai" size={18} />
            {language === 'zh' ? '连接 ChatGPT 账号' : 'Connect ChatGPT Account'}
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-3">
        {deviceView?.state === 'starting' ? (
          <div className="flex items-center gap-2 py-6 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {language === 'zh' ? '正在请求授权码...' : 'Requesting device code...'}
          </div>
        ) : null}

        {deviceView?.state === 'pending' ? (
          <div className="space-y-4 py-2">
            <ol className="space-y-2 text-xs leading-5 text-zinc-400">
              <li className="flex gap-2">
                <span className="font-medium text-zinc-500">1.</span>
                <span>
                  {language === 'zh'
                    ? '在浏览器打开 OpenAI 授权页并登录你的 ChatGPT 账号：'
                    : 'Open the OpenAI authorization page in your browser and sign in with your ChatGPT account:'}
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-medium text-zinc-500">2.</span>
                <span>{language === 'zh' ? '输入下方一次性代码：' : 'Enter the one-time code below:'}</span>
              </li>
            </ol>

            <div className="flex flex-col gap-2">
              <Button
                type="button"
                size="sm"
                className="h-9 w-full justify-center gap-2 rounded-lg bg-zinc-100 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
                onClick={() => {
                  if (deviceView.verificationUri) {
                    window.open(deviceView.verificationUri, '_blank', 'noopener,noreferrer')
                  }
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {language === 'zh' ? '打开授权页面' : 'Open authorization page'}
              </Button>
              <a
                href={deviceView.verificationUri}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-6 max-w-full items-center gap-1 truncate text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                <span className="truncate">{deviceView.verificationUri}</span>
              </a>
            </div>

            <div className="flex items-center gap-2">
              <code className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-lg font-semibold tracking-[0.2em] text-zinc-100">
                {deviceView.userCode}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                onClick={async () => {
                  if (deviceView.userCode) {
                    try {
                      await navigator.clipboard.writeText(deviceView.userCode)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    } catch {
                      // 剪贴板不可用时忽略
                    }
                  }
                }}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              {language === 'zh' ? '正在等待授权（15 分钟内有效）...' : 'Waiting for authorization (valid for 15 minutes)...'}
            </div>
          </div>
        ) : null}

        {deviceView?.state === 'complete' && deviceView.account ? (
          <div className="py-4">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-300">
              <Check className="h-4 w-4 shrink-0" />
              {language === 'zh'
                ? `已连接：${deviceView.account.email}`
                : `Connected: ${deviceView.account.email}`}
            </div>
          </div>
        ) : null}

        {deviceView?.state === 'error' ? (
          <div className="py-4">
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
              {deviceView.message || (language === 'zh' ? '连接失败。' : 'Connection failed.')}
            </p>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            onClick={close}
          >
            <X className="h-3.5 w-3.5" />
            {deviceView?.state === 'complete' || deviceView?.state === 'error'
              ? (language === 'zh' ? '完成' : 'Done')
              : (language === 'zh' ? '取消' : 'Cancel')}
          </Button>
        </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

// ── Claude（粘贴授权码）───────────────────────────────────────────

export function ClaudeConnectDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}) {
  const { t, language } = useTranslation()
  const [authorizeUrl, setAuthorizeUrl] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    setAuthCode('')
    setAuthorizeUrl('')
    setLoading(true)
    void api.getClaudeAuthorizeUrl()
      .then((result) => setAuthorizeUrl(result.authorizeUrl))
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : 'failed to get authorize url')
      })
      .finally(() => setLoading(false))
  }, [open])

  const submitCode = async () => {
    const code = authCode.trim()
    if (!code) {
      toast.error(language === 'zh' ? '请先粘贴授权码。' : 'Paste the authorization code first.')
      return
    }
    setSubmitting(true)
    try {
      const result = await api.importClaudeAccount(code)
      onConnected()
      onOpenChange(false)
      toast.success(result.message || (language === 'zh' ? 'Claude 账号已连接。' : 'Claude account connected.'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'import failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <ProviderLogo providerId="anthropic" size={18} />
            {language === 'zh' ? '连接 Claude 账号' : 'Connect Claude Account'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <ol className="space-y-2 text-xs leading-5 text-zinc-400">
            <li className="flex gap-2">
              <span className="font-medium text-zinc-500">1.</span>
              <span>
                {language === 'zh'
                  ? '点击下方链接，在浏览器中登录你的 Claude 账号并完成授权：'
                  : 'Open the link below in your browser, sign in to your Claude account and authorize:'}
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-medium text-zinc-500">2.</span>
              <span>
                {language === 'zh'
                  ? '授权完成后，Claude 页面会显示一个授权码（Paste into Claude Code），复制它。'
                  : 'After authorizing, Claude shows an authorization code (Paste into Claude Code). Copy it.'}
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-medium text-zinc-500">3.</span>
              <span>{language === 'zh' ? '把授权码粘贴到下方并提交：' : 'Paste the code below and submit:'}</span>
            </li>
          </ol>

          {authorizeUrl ? (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                size="sm"
                className="h-9 w-full justify-center gap-2 rounded-lg bg-zinc-100 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
                onClick={() => {
                  window.open(authorizeUrl, '_blank', 'noopener,noreferrer')
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {language === 'zh' ? '打开授权页面' : 'Open authorization page'}
              </Button>
              <a
                href={authorizeUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-6 max-w-full items-center gap-1 truncate text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                <span className="truncate">platform.claude.com</span>
              </a>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              {language === 'zh' ? '正在生成授权链接...' : 'Preparing authorize link...'}
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
              <Input
                value={authCode}
                onChange={(event) => setAuthCode(event.target.value)}
                placeholder={language === 'zh' ? '粘贴授权码' : 'Paste authorization code'}
                className="h-8 rounded-lg border-zinc-800 bg-zinc-950 pl-8 pr-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void submitCode()
                  }
                }}
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
              disabled={submitting || loading}
              onClick={() => void submitCode()}
            >
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {language === 'zh' ? '提交' : 'Submit'}
            </Button>
          </div>

          <p className="text-[11px] leading-5 text-zinc-500">
            {language === 'zh'
              ? '授权码一次性有效（通常 10-15 分钟）。提交后账号会应用到你的所有执行节点。'
              : 'The code is one-time (valid ~10-15 min). It will be applied to all your executors.'}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-3.5 w-3.5" />
            {language === 'zh' ? '取消' : 'Cancel'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── 账号状态点（菜单 / 状态条共用）────────────────────────────────

// ── OpenRouter（OAuth PKCE 粘贴授权码，免费模型零成本起步）────

export function OpenrouterConnectDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}) {
  const { t, language } = useTranslation()
  const [authorizeUrl, setAuthorizeUrl] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    setAuthCode('')
    setAuthorizeUrl('')
    setLoading(true)
    void api.getOpenrouterAuthorizeUrl()
      .then((result) => setAuthorizeUrl(result.authorizeUrl))
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : 'failed to get authorize url')
      })
      .finally(() => setLoading(false))
  }, [open])

  const submitCode = async () => {
    const code = authCode.trim()
    if (!code) {
      toast.error(language === 'zh' ? '请先粘贴授权码。' : 'Paste the authorization code first.')
      return
    }
    setSubmitting(true)
    try {
      const result = await api.importOpenrouterAccount(code)
      onConnected()
      onOpenChange(false)
      toast.success(result.message || (language === 'zh' ? 'OpenRouter 已连接。' : 'OpenRouter connected.'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'import failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <ProviderLogo providerId="openrouter" size={18} />
            {language === 'zh' ? '连接 OpenRouter 账号' : 'Connect OpenRouter Account'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <ol className="space-y-2 text-xs leading-5 text-zinc-400">
            <li className="flex gap-2">
              <span className="font-medium text-zinc-500">1.</span>
              <span>
                {language === 'zh'
                  ? '点击下方链接，在浏览器中登录你的 OpenRouter 账号并完成授权：'
                  : 'Open the link below, sign in to your OpenRouter account and authorize:'}
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-medium text-zinc-500">2.</span>
              <span>
                {language === 'zh'
                  ? '授权完成后，页面会显示一个授权码，复制它。'
                  : 'After authorizing, the page shows an authorization code. Copy it.'}
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-medium text-zinc-500">3.</span>
              <span>
                {language === 'zh'
                  ? '把授权码粘贴到下方并提交，我们会自动创建 Key 并登记免费模型。'
                  : 'Paste the code below. We will create the key and register free models for you.'}
              </span>
            </li>
          </ol>

          {authorizeUrl ? (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                size="sm"
                className="h-9 w-full justify-center gap-2 rounded-lg bg-zinc-100 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
                onClick={() => {
                  window.open(authorizeUrl, '_blank', 'noopener,noreferrer')
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {language === 'zh' ? '打开授权页面' : 'Open authorization page'}
              </Button>
              <a
                href={authorizeUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-6 max-w-full items-center gap-1 truncate text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                <span className="truncate">openrouter.ai</span>
              </a>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              {language === 'zh' ? '正在生成授权链接...' : 'Preparing authorize link...'}
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
              <Input
                value={authCode}
                onChange={(event) => setAuthCode(event.target.value)}
                placeholder={language === 'zh' ? '粘贴授权码' : 'Paste authorization code'}
                className="h-8 rounded-lg border-zinc-800 bg-zinc-950 pl-8 pr-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void submitCode()
                  }
                }}
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
              disabled={submitting || loading}
              onClick={() => void submitCode()}
            >
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {language === 'zh' ? '提交' : 'Submit'}
            </Button>
          </div>

          <p className="text-[11px] leading-5 text-zinc-500">
            {language === 'zh'
              ? '授权码一次性有效（10 分钟）。费用记在你自己的 OpenRouter 账户；免费模型有每日请求限额。'
              : 'The code is one-time (valid 10 min). Usage is billed to your own OpenRouter account; :free models have daily limits.'}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-3.5 w-3.5" />
            {language === 'zh' ? '取消' : 'Cancel'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AccountStatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn(
        'ml-auto h-1.5 w-1.5 shrink-0 rounded-full',
        connected ? 'bg-emerald-400' : 'bg-zinc-600',
      )}
    />
  )
}

// ── API Key 快捷接入（DeepSeek / Kimi 等开放平台）────────────────────

export function ApiKeyConnectDialog({
  open,
  onOpenChange,
  template,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  template: AuthProviderTemplate | null
  onCreated: () => void
}) {
  const { t, language } = useTranslation()
  const [apiKey, setApiKey] = useState('')
  const [modelsText, setModelsText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setApiKey('')
      setModelsText(template?.modelExamples?.join(', ') ?? '')
    }
  }, [open, template])

  const submit = async () => {
    const key = apiKey.trim()
    if (!key) {
      toast.error(language === 'zh' ? '请填入 API Key。' : 'API key is required.')
      return
    }
    const models = modelsText.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean)
    if (models.length === 0) {
      toast.error(language === 'zh' ? '至少填一个模型 ID。' : 'At least one model ID is required.')
      return
    }
    if (!template) {
      return
    }
    setSubmitting(true)
    try {
      const payload: ModelProfileCreatePayload = {
        name: template.label,
        description: `${template.label}（API Key 快捷接入）`,
        visibility: 'private',
        bindings: models.map((modelId) => ({
          agentType: 'OpenCode',
          providerId: template.providerId,
          modelId,
          label: modelId,
          baseUrl: template.baseUrl,
          apiToken: key,
        })),
      }
      const response = await api.createModelProfile(payload)
      toast.success(response.message || (language === 'zh' ? `${template.label} 模型已接入。` : `${template.label} models connected.`))
      onOpenChange(false)
      onCreated()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'create failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <ProviderLogo providerId={template?.providerId} size={18} />
            {language === 'zh' ? `连接 ${template?.label ?? ''}（API Key）` : `Connect ${template?.label ?? ''} (API Key)`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="space-y-2">
            <label className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              {language === 'zh' ? 'API Key' : 'API Key'}
            </label>
            <Input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              type="password"
              placeholder="sk-..."
              className="h-8 rounded-lg border-zinc-800 bg-zinc-950 pl-2.5 pr-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700"
            />
            <p className="text-[11px] text-zinc-500">
              {language === 'zh'
                ? `在 ${template?.label ?? ''} 开放平台创建 API Key。密钥保存在平台配置并随任务下发到你的执行节点。`
                : `Create an API key on the ${template?.label ?? ''} platform. It is stored in platform config and sent to your executors.`}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              {language === 'zh' ? '模型 ID（逗号分隔）' : 'Model IDs (comma separated)'}
            </label>
            <Input
              value={modelsText}
              onChange={(event) => setModelsText(event.target.value)}
              placeholder="model-1, model-2"
              className="h-8 rounded-lg border-zinc-800 bg-zinc-950 pl-2.5 pr-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700"
            />
          </div>

          {template?.baseUrl ? (
            <div className="rounded-lg border border-zinc-900 bg-zinc-950 px-3 py-2 text-[11px] text-zinc-500">
              {language === 'zh' ? 'Base URL' : 'Base URL'}: <span className="font-mono text-zinc-400">{template.baseUrl}</span>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-3.5 w-3.5" />
            {language === 'zh' ? '取消' : 'Cancel'}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
            disabled={submitting}
            onClick={() => void submit()}
          >
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {language === 'zh' ? '接入' : 'Connect'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
