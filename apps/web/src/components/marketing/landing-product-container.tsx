/**
 * 真实产品界面预览容器
 * 直接复用真实产品的组件，展示完整的桌面应用界面
 */

import { useState } from 'react'
import type { Language } from '../../lib/i18n'
import { AppSidebar } from '../app-sidebar'
import { RealSettingsAppearancePreview } from './landing-real-product-preview'

type PreviewTab = 'workspace' | 'comments' | 'agents' | 'settings' | 'dashboard'

/**
 * macOS 风格的标题栏 - 多个 Tab 标签
 */
function MacOSTitleBar({ activeTab, onTabChange, language }: {
  activeTab: PreviewTab
  onTabChange: (tab: PreviewTab) => void
  language: Language
}) {
  const tabs: Array<{ id: PreviewTab; label: string; icon?: string }> = [
    { id: 'workspace', label: language === 'zh' ? '会话' : 'Workspace', icon: '💬' },
    { id: 'comments', label: 'Comments', icon: '💬' },
    { id: 'agents', label: 'Agents', icon: '🤖' },
    { id: 'settings', label: language === 'zh' ? '设置' : 'Settings', icon: '⚙️' },
    { id: 'dashboard', label: language === 'zh' ? '仪表盘' : 'Dashboard' },
  ]

  return (
    <div className="relative flex h-[52px] items-center border-b border-white/[0.06] bg-[#1a1a1d]/60 backdrop-blur-xl">
      {/* 顶部细微高光 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* 左侧：留空给红绿灯 */}
      <div className="w-20" />

      {/* 中间：Tab 标签 */}
      <div className="flex flex-1 items-center gap-1 overflow-x-auto px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`group relative flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-xs transition ${
              activeTab === tab.id
                ? 'bg-white/[0.08] text-zinc-200'
                : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300'
            }`}
          >
            {tab.icon && <span className="text-sm">{tab.icon}</span>}
            <span className="whitespace-nowrap">{tab.label}</span>
            {activeTab === tab.id && (
              <span className="absolute inset-x-2 -bottom-px h-[2px] bg-white/40" />
            )}
          </button>
        ))}
      </div>

      {/* 右侧：添加按钮 */}
      <div className="flex items-center gap-2 px-4">
        <button className="rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-white/[0.06]">
          +
        </button>
      </div>
    </div>
  )
}

/**
 * 简化版侧边栏（模拟真实侧边栏的样式）
 */
function MockSidebar({ language }: { language: Language }) {
  return (
    <aside className="flex min-h-full flex-col border-r border-white/[0.08] bg-[#0f0f11]/80 backdrop-blur-2xl">
      {/* 顶部工作区信息 */}
      <div className="border-b border-white/[0.06] px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-gradient-to-br from-zinc-800/50 to-zinc-900/50 text-xs font-semibold text-zinc-100 shadow-inner">
            AC
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-50">
              {language === 'zh' ? '项目团队' : 'Project Team'}
            </p>
            <p className="truncate text-xs text-zinc-500">
              {language === 'zh' ? '组织A' : 'Organization A'}
            </p>
          </div>
        </div>
      </div>

      {/* 新建任务按钮 */}
      <div className="px-3 py-3">
        <button className="flex w-full items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.06]">
          <span>+</span>
          <span>{language === 'zh' ? '新建任务' : 'New Task'}</span>
        </button>
      </div>

      {/* 导航项 */}
      <div className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        <NavLink icon="📊" label={language === 'zh' ? '仪表盘' : 'Dashboard'} />
        <NavLink icon="💼" label={language === 'zh' ? '工作区' : 'Workspaces'} />
        <NavLink icon="☁️" label={language === 'zh' ? '云盘 Drive' : 'Drive'} />
        <NavLink icon="🔄" label={language === 'zh' ? '自动化' : 'Automation'} />
        <NavLink icon="💬" label={language === 'zh' ? '聊天' : 'Chat'} />
        <NavLink icon="📄" label={language === 'zh' ? '收件箱' : 'Inbox'} />

        {/* 项目分组 */}
        <div className="pt-4">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-medium text-zinc-600">
              {language === 'zh' ? '项目' : 'Projects'}
            </span>
          </div>
          <NavLink icon="🟢" label="Release Checks" badge />
        </div>

        {/* Agents 分组 */}
        <div className="pt-4">
          <div className="flex items-center gap-2 px-2 py-1">
            <span className="text-xs font-medium text-zinc-600">AGENTS</span>
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400">
              ALPHA
            </span>
          </div>
          <NavLink icon="🤖" label="Project Agent" subtitle="🟢 Wemux Assistant" />
        </div>

        {/* 系统分组 */}
        <div className="pt-4">
          <div className="px-2 py-1">
            <span className="text-xs font-medium text-zinc-600">
              {language === 'zh' ? '系统' : 'System'}
            </span>
          </div>
          <NavLink icon="🔧" label={language === 'zh' ? 'Skills' : 'Skills'} badge="ALPHA" />
          <NavLink icon="🔌" label="MCP" badge="ALPHA" />
          <NavLink icon="⚙️" label={language === 'zh' ? '设置' : 'Settings'} active />
        </div>
      </div>

      {/* 底部用户信息 */}
      <div className="border-t border-white/[0.06] p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.03]">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-500 text-xs font-bold text-white">
            AC
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-100">Project Owner</p>
            <p className="truncate text-xs text-zinc-500">owner@example.com</p>
          </div>
        </div>
      </div>
    </aside>
  )
}

function NavLink({
  icon,
  label,
  subtitle,
  badge,
  active = false,
}: {
  icon: string
  label: string
  subtitle?: string
  badge?: string | boolean
  active?: boolean
}) {
  return (
    <button
      className={`group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition ${
        active
          ? 'bg-white/[0.08] text-zinc-100'
          : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
      }`}
    >
      <span className="text-base">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm">{label}</span>
          {badge && typeof badge === 'string' && (
            <span className={badge === 'ALPHA' ? 'text-xs text-amber-400' : 'text-xs text-emerald-400'}>
              {badge}
            </span>
          )}
          {badge === true && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
        </div>
        {subtitle && <p className="truncate text-xs text-zinc-600">{subtitle}</p>}
      </div>
    </button>
  )
}

/**
 * 完整的产品预览容器
 */
export function RealProductPreviewContainer({ language }: { language: Language }) {
  const [activeTab, setActiveTab] = useState<PreviewTab>('settings')

  return (
    <div className="flex h-full min-h-[700px] flex-col">
      <MacOSTitleBar activeTab={activeTab} onTabChange={setActiveTab} language={language} />

      <div className="flex min-h-0 flex-1">
        <div className="w-[240px]">
          <MockSidebar language={language} />
        </div>

        <div className="flex-1 overflow-y-auto bg-[#09090b]">
          {activeTab === 'settings' && (
            <RealSettingsAppearancePreview language={language} />
          )}
          {activeTab === 'workspace' && (
            <div className="p-6 text-zinc-400">
              {language === 'zh' ? '工作区视图...' : 'Workspace view...'}
            </div>
          )}
          {activeTab === 'dashboard' && (
            <div className="p-6 text-zinc-400">
              {language === 'zh' ? '仪表盘视图...' : 'Dashboard view...'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
