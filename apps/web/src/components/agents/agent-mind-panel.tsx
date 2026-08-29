/**
 * [INPUT]: Agent id
 * [OUTPUT]: Agent 灵魂与个人记忆的文件浏览编辑面板（左侧文件列表 + 右侧单文件 markdown 编辑）
 * [POS]: Agent 设置页 Mind 标签；读/写云盘个人域 mind/ 文件；框架先行 + 逐文件渐进加载
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { BrainCircuit, Check, FileText, Loader2, RefreshCw, Sparkles, User } from 'lucide-react'
import { api } from '../../lib/api'
import type { AgentMindFile } from '../../lib/api/types'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { SectionHeader } from './custom-agent-detail-panel-shared'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'

type MindFileKey = 'soul' | 'user' | 'memory'

const MIND_FILES: Array<{ key: MindFileKey; name: string; title: string; description: string; icon: typeof FileText }> = [
  { key: 'soul', name: 'soul.md', title: '灵魂', description: '身份 / 性格 / 工作风格 / 边界', icon: Sparkles },
  { key: 'user', name: 'USER.md', title: '用户偏好', description: '偏好 / 沟通风格 / 工作习惯', icon: User },
  { key: 'memory', name: 'MEMORY.md', title: '自己的知识', description: '环境事实 / 项目约定 / 踩坑', icon: BrainCircuit },
]

export function AgentMindPanel({ agentId }: { agentId: string }) {
  const { language } = useTranslation()
  const [files, setFiles] = useState<Partial<Record<MindFileKey, AgentMindFile>>>({})
  const [loadingKeys, setLoadingKeys] = useState<Set<MindFileKey>>(new Set())
  const [saving, setSaving] = useState<MindFileKey | null>(null)
  const [savedKey, setSavedKey] = useState<MindFileKey | null>(null)
  const [activeFile, setActiveFile] = useState<MindFileKey>('soul')
  const [error, setError] = useState('')
  const loadTokenRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const loadFile = useCallback(async (key: MindFileKey) => {
    const token = loadTokenRef.current
    setLoadingKeys((current) => new Set(current).add(key))
    setError('')
    try {
      const result = await api.getAgentMindFile(agentId, key)
      if (!mountedRef.current || token !== loadTokenRef.current) return
      const loaded = result.mind[key]
      setFiles((current) => ({ ...current, [key]: loaded }))
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : '读取记忆文件失败。')
      }
    } finally {
      if (mountedRef.current) {
        setLoadingKeys((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
      }
    }
  }, [agentId])

  // 框架先行：依次加载 soul → user → memory，每个文件就绪后独立填充。
  useEffect(() => {
    const token = ++loadTokenRef.current
    void (async () => {
      for (const key of ['soul', 'user', 'memory'] as MindFileKey[]) {
        if (token !== loadTokenRef.current) return
        await loadFile(key)
      }
    })()
    return () => { loadTokenRef.current += 1 }
  }, [loadFile])

  const updateActiveFile = (content: string) => {
    setFiles((current) => ({ ...current, [activeFile]: { ...(current[activeFile] ?? { fileId: null, content: '' }), content } }))
    setSavedKey(null)
  }

  const saveActiveFile = async () => {
    const active = files[activeFile]
    if (!active) return
    setSaving(activeFile)
    setError('')
    try {
      await api.updateAgentMind(agentId, activeFile, active.content)
      setSavedKey(activeFile)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败。')
    } finally {
      setSaving(null)
    }
  }

  const switchFile = (key: MindFileKey) => {
    setActiveFile(key)
    setSavedKey(null)
    if (!files[key] && !loadingKeys.has(key)) {
      void loadFile(key)
    }
  }

  const active = files[activeFile]
  const activeLoading = loadingKeys.has(activeFile)

  return (
    <div className="space-y-4">
      <section className="space-y-1 border border-zinc-800 bg-[#09090b] p-4">
        <SectionHeader
          icon={<Sparkles className="h-4 w-4" />}
          title={language === 'zh' ? '灵魂与记忆' : 'Soul & Memory'}
          description={language === 'zh'
            ? '这些 markdown 文件存在你的云盘个人域（agents/<id>/mind/），每次执行都会注入 Agent 上下文。左侧选择文件，右侧编辑并保存。'
            : 'These markdown files live in your personal Drive (agents/<id>/mind/) and are injected into the Agent context on every run. Pick a file on the left, edit and save on the right.'}
        />
      </section>

      {error ? (
        <p className="border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
      ) : null}

      {/* 框架先行：文件列表 + 编辑器骨架始终渲染，内容逐文件填充 */}
      <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
        {/* 左侧：文件列表（每个条目独立加载态） */}
        <section className="h-fit space-y-2 border border-zinc-800 bg-[#09090b] p-3">
          <p className="px-1 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            {language === 'zh' ? '记忆文件' : 'Memory files'}
          </p>
          {MIND_FILES.map((item) => {
            const Icon = item.icon
            const isActive = activeFile === item.key
            const isLoading = loadingKeys.has(item.key)
            const loaded = files[item.key]
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => switchFile(item.key)}
                className={cn(
                  'flex w-full items-start gap-3 border px-3 py-2.5 text-left transition-colors',
                  isActive
                    ? 'border-violet-500/40 bg-violet-500/10'
                    : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900',
                )}
              >
                <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', isActive ? 'text-violet-300' : 'text-zinc-500')} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm font-medium', isActive ? 'text-violet-100' : 'text-zinc-200')}>
                    {item.name}
                  </span>
                  <span className="block text-[11px] text-zinc-500">{item.title} · {item.description}</span>
                  {loaded ? (
                    <span className={cn('mt-1 block text-[10px]', loaded.fileId ? 'text-emerald-500' : 'text-zinc-600')}>
                      {loaded.fileId
                        ? (language === 'zh' ? '已就绪' : 'Ready')
                        : (language === 'zh' ? '尚未初始化' : 'Not initialized')}
                    </span>
                  ) : null}
                </span>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-300" />
                ) : savedKey === item.key ? (
                  <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : null}
              </button>
            )
          })}
        </section>

        {/* 右侧：单文件编辑（未加载时显示骨架占位） */}
        <section className="space-y-3 border border-zinc-800 bg-[#09090b] p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-200">
                {activeFile === 'soul' ? '灵魂 soul.md' : activeFile === 'user' ? '用户偏好 USER.md' : '自己的知识 MEMORY.md'}
              </p>
              <p className="text-[11px] text-zinc-500">
                {activeLoading
                  ? (language === 'zh' ? '正在加载...' : 'Loading...')
                  : active?.fileId
                    ? (language === 'zh' ? '云盘文件已就绪' : 'Drive file ready')
                    : (language === 'zh' ? '文件尚未初始化' : 'File not initialized')}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={saving === activeFile || !active?.fileId || activeLoading}
              onClick={saveActiveFile}
              className={cn(
                'shrink-0',
                savedKey === activeFile ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-zinc-100 text-zinc-950 hover:bg-zinc-200',
              )}
            >
              {saving === activeFile ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : savedKey === activeFile ? (
                <Check className="h-3.5 w-3.5" />
              ) : null}
              <span className="ml-1">
                {saving === activeFile
                  ? (language === 'zh' ? '保存中...' : 'Saving...')
                  : savedKey === activeFile
                    ? (language === 'zh' ? '已保存' : 'Saved')
                    : (language === 'zh' ? '保存' : 'Save')}
              </span>
            </Button>
          </div>
          {activeLoading ? (
            <div className="min-h-80 w-full space-y-2 rounded border border-zinc-800 bg-zinc-950 p-4">
              <div className="h-4 w-2/5 animate-pulse rounded bg-zinc-800" />
              <div className="h-4 w-3/5 animate-pulse rounded bg-zinc-800" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-zinc-800" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-800" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-800" />
              <div className="pt-2 text-center text-xs text-zinc-500">
                {language === 'zh' ? '内容加载中...' : 'Loading content...'}
              </div>
            </div>
          ) : (
            <Textarea
              value={active?.content ?? ''}
              onChange={(event) => updateActiveFile(event.target.value)}
              rows={20}
              className="min-h-80 w-full resize-y bg-zinc-950 font-mono text-xs leading-5 text-zinc-200"
              placeholder={MIND_FILES.find((item) => item.key === activeFile)?.description ?? ''}
            />
          )}
          {!activeLoading && !active?.fileId ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void loadFile(activeFile)} className="w-fit border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900">
              <RefreshCw className="h-3.5 w-3.5" />
              {language === 'zh' ? '重新加载' : 'Reload'}
            </Button>
          ) : null}
        </section>
      </div>
    </div>
  )
}
