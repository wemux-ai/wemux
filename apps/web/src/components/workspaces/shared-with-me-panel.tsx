// [INPUT]: /api/shared-workspaces（共享给我的工作区/会话条目）
// [OUTPUT]: 工作区列表页顶部的「共享给我的」区块，点击跳转 /workspace；自带外层滚动容器/分隔线，无共享条目时整体不渲染
// [POS]: 协作共享的对方视角展示；替代已下线的 /chat「共享给我的」侧边栏区域
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FolderOpen, Loader2, Share2, X } from 'lucide-react'
import { api, type SharedWorkspaceEntry } from '../../lib/api'
import { buildWorkspaceRouteSearch } from '../../routes/-workspace-route-shared'
import { useTranslation } from '../../lib/i18n/react'
import type { Language } from '../../lib/i18n'
import type { WorkspaceSharePermission, WorkspaceShareScope } from '@shared/types'

const text = (language: Language, zh: string, en: string) => (language === 'zh' ? zh : en)

const PERMISSION_LABEL: Record<WorkspaceSharePermission, [string, string]> = {
  read: ['查看', 'View'],
  edit: ['可编辑', 'Can edit'],
  collaborate: ['可协助', 'Collaborate'],
}

const SCOPE_LABEL: Record<WorkspaceShareScope, [string, string]> = {
  workspace: ['整个工作区', 'Workspace'],
  all_sessions: ['所有会话', 'All sessions'],
  session: ['会话', 'Session'],
}

export function SharedWithMePanel() {
  const { language } = useTranslation()
  const navigate = useNavigate()
  const [entries, setEntries] = useState<SharedWorkspaceEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.getSharedWorkspaces()
      setEntries(response.entries)
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  if (dismissed || (!loading && entries.length === 0)) {
    return null
  }

  const openEntry = (entry: SharedWorkspaceEntry) => {
    const route = entry.route
    if (!route?.workspaceId) {
      return
    }
    void navigate({
      to: '/workspace',
      search: buildWorkspaceRouteSearch({
        projectId: route.projectId || undefined,
        workspaceId: route.workspaceId,
        workspaceSessionId: route.workspaceSessionId || undefined,
      }),
    })
  }

  return (
    <div className="shrink-0 overflow-y-auto border-b border-zinc-900/60 px-2 pt-2" style={{ maxHeight: '38%' }}>
      <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-600">
            <Share2 className="size-3" />
            {text(language, '共享给我的', 'Shared with me')}
          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
            aria-label={text(language, '收起', 'Dismiss')}
          >
            <X className="size-3" />
          </button>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-zinc-500">
            <Loader2 className="size-3 animate-spin" />
            {text(language, '加载中…', 'Loading…')}
          </div>
        ) : (
          <div className="space-y-1">
            {entries.map((entry) => {
              const [scopeZh, scopeEn] = SCOPE_LABEL[entry.share.scope]
              const [permissionZh, permissionEn] = PERMISSION_LABEL[entry.share.permission]
              const title = entry.share.scope === 'session'
                ? entry.sessionTitle || entry.workspace?.name || text(language, '共享会话', 'Shared session')
                : entry.workspace?.name || text(language, '共享工作区', 'Shared workspace')
              return (
                <button
                  key={entry.share.id}
                  type="button"
                  onClick={() => openEntry(entry)}
                  className="flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-1.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400">
                    <FolderOpen className="size-3" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-zinc-200">{title}</span>
                    <span className="block truncate text-[10px] text-zinc-500">
                      {text(language, scopeZh, scopeEn)} · {text(language, permissionZh, permissionEn)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
