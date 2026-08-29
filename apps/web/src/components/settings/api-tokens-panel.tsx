/**
 * [INPUT]: Current user's personal access tokens and create/delete API actions.
 * [OUTPUT]: A compact settings panel for creating, copying, revoking, and configuring API tokens.
 * [POS]: Settings detail panel for MCP authentication; owns only API-token presentation and local form state.
 *
 * [PROTOCOL]: Update this header when this file's responsibility or contracts change, then check AGENTS.md.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Key, Loader2, Plus, Shield, Trash2 } from 'lucide-react'
import { api, type PersonalAccessToken, type PersonalAccessTokenCreateResponse } from '../../lib/api'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { Separator } from '../ui/separator'

const EXPIRY_OPTIONS = [
  { value: '90d', label: '90 天' },
  { value: '180d', label: '180 天' },
  { value: '1y', label: '1 年' },
  { value: 'never', label: '永不过期' },
]

export function ApiTokensPanel() {
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newTokenName, setNewTokenName] = useState('')
  const [newTokenExpiry, setNewTokenExpiry] = useState('90d')
  const [createdToken, setCreatedToken] = useState<PersonalAccessTokenCreateResponse | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadTokens = async () => {
    try {
      const response = await api.listPersonalAccessTokens()
      setTokens(response.tokens)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载令牌列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTokens()
  }, [])

  const handleCreate = async () => {
    if (!newTokenName.trim()) {
      toast.error('请输入令牌名称')
      return
    }

    setCreating(true)
    try {
      const response = await api.createPersonalAccessToken({
        name: newTokenName.trim(),
        expiresIn: newTokenExpiry,
      })
      setCreatedToken(response)
      setNewTokenName('')
      setNewTokenExpiry('90d')
      setShowCreateForm(false)
      await loadTokens()
      toast.success('令牌创建成功')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建令牌失败')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (tokenId: string) => {
    if (!confirm('确定要删除此令牌吗？使用此令牌的所有应用将立即失去访问权限。')) {
      return
    }

    setDeletingId(tokenId)
    try {
      await api.deletePersonalAccessToken(tokenId)
      await loadTokens()
      toast.success('令牌已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除令牌失败')
    } finally {
      setDeletingId(null)
    }
  }

  const handleCopyToken = (token: string) => {
    void navigator.clipboard.writeText(token)
    toast.success('令牌已复制到剪贴板')
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '—'
    return new Date(dateString).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false
    return new Date(expiresAt) < new Date()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-xs leading-5 text-zinc-500">
        创建和管理个人访问令牌，用于外部 Agent（如 Hermes、OpenClaw）通过 MCP 协议访问 Wemux。
      </p>

      {createdToken && (
        <section className="border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
            <Shield className="size-4" />
            令牌创建成功
          </div>
          <p className="mt-1 text-xs leading-5 text-emerald-200/80">
            请立即复制并保存此令牌，关闭提示后将无法再次查看完整令牌。
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto border border-emerald-500/20 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200">
              {createdToken.token}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleCopyToken(createdToken.token)}
              className="h-8 shrink-0 rounded-md border-emerald-500/30 bg-zinc-950 text-emerald-200 hover:bg-emerald-500/10 hover:text-emerald-100"
            >
              <Copy className="size-4" />
              <span className="sr-only">复制令牌</span>
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-7 rounded-md px-2 text-xs text-emerald-200 hover:bg-emerald-500/10 hover:text-emerald-100"
            onClick={() => setCreatedToken(null)}
          >
            我已保存，关闭提示
          </Button>
        </section>
      )}

      <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
        <div className="text-xs text-zinc-500">
          共 {tokens.length} 个令牌
        </div>
        <Button
          size="sm"
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="h-7 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
        >
          <Plus className="mr-1.5 size-3.5" />
          {showCreateForm ? '收起表单' : '创建令牌'}
        </Button>
      </div>

      {showCreateForm && (
        <section className="border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-zinc-800 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">创建新令牌</h3>
              <p className="mt-1 text-xs text-zinc-500">为连接到 Wemux 的外部 Agent 命名此令牌。</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="token-name" className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                令牌名称
              </label>
              <Input
                id="token-name"
                placeholder="例如：Hermes Agent、OpenClaw CI"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
                className="h-9 border-zinc-800 bg-zinc-950 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:border-zinc-700"
              />
            </div>
            <div>
              <label htmlFor="token-expiry" className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                有效期
              </label>
              <NativeSelect
                id="token-expiry"
                value={newTokenExpiry}
                onChange={(e) => setNewTokenExpiry(e.target.value)}
                className="h-9 border-zinc-800 bg-zinc-950 text-sm text-zinc-200 focus:border-zinc-700"
              >
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-zinc-800 pt-3">
            <Button
              onClick={handleCreate}
              disabled={creating}
              className="h-7 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
            >
              {creating ? (
                <>
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                  创建中...
                </>
              ) : (
                '创建'
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setShowCreateForm(false)}
              className="h-7 rounded-md px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            >
              取消
            </Button>
          </div>
        </section>
      )}

      {tokens.length === 0 && !showCreateForm ? (
        <div className="flex min-h-[16rem] flex-col items-center justify-center rounded-md border border-dashed border-zinc-800 bg-zinc-950/70 px-6 text-center">
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-2.5 text-zinc-400">
            <Key className="size-5" />
          </div>
          <h3 className="mt-3 text-sm font-semibold text-zinc-100">还没有 API 令牌</h3>
          <p className="mt-1.5 max-w-md text-xs leading-5 text-zinc-500">
            创建令牌以允许外部 Agent 通过 MCP 访问 Wemux
          </p>
        </div>
      ) : (
        tokens.length > 0 && <div className="divide-y divide-zinc-800 border border-zinc-800 bg-zinc-950/70">
          {tokens.map((token) => (
            <div key={token.id} className={`flex items-center justify-between gap-4 p-3 ${isExpired(token.expires_at) ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-3">
                <Key className="size-4 text-zinc-500" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-200">{token.name}</span>
                    {isExpired(token.expires_at) && (
                      <span className="border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">已过期</span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    <code>{token.token_prefix}...</code>
                    <span className="mx-2">·</span>
                    创建于 {formatDate(token.created_at)}
                  </div>
                  {token.last_used_at && (
                    <div className="mt-1 text-xs text-zinc-500">
                      最后使用：{formatDate(token.last_used_at)}
                    </div>
                  )}
                  {token.expires_at && !isExpired(token.expires_at) && (
                    <div className="mt-1 text-xs text-zinc-500">
                      过期时间：{formatDate(token.expires_at)}
                    </div>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(token.id)}
                disabled={deletingId === token.id}
                className="h-7 w-7 shrink-0 rounded-md text-zinc-500 hover:bg-rose-500/10 hover:text-rose-300"
              >
                {deletingId === token.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4 text-destructive" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}

      <Separator />

      <div className="space-y-2 pt-1">
        <h4 className="text-sm font-semibold text-zinc-100">使用方法</h4>
        <p className="text-xs text-zinc-500">
          在外部 Agent 的 MCP 配置中使用令牌：
        </p>
        <pre className="overflow-x-auto border border-zinc-800 bg-zinc-950 p-3 text-xs leading-5 text-zinc-300">
{`{
  "mcpServers": {
    "Wemux": {
      "url": "https://your-wemux-host/mcp",
      "headers": {
        "Authorization": "Bearer vbx-your-token-here"
      }
    }
  }
}`}
        </pre>
      </div>
    </div>
  )
}
