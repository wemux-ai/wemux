import { useState, useEffect } from 'react'
import { ChevronRight, LogOut, Settings, User as UserIcon, HelpCircle, FileText, Home } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Button } from './ui/button'
import { Separator } from './ui/separator'
import { resolveMediaUrl, api } from '../lib/api'
import { cn } from '../lib/utils'
import { getUserMenuCommercialSection } from './user-menu-commercial-gate'

interface UserMenuPopoverProps {
  user: {
    id: string
    name: string
    avatarUrl?: string
    email?: string
    bio?: string
  } | null
  onLogout: () => void
  language?: 'zh' | 'en'
}

const getInitials = (name: string) => {
  return (name.trim() || 'U').slice(0, 2).toUpperCase()
}

export function UserMenuPopover({ user, onLogout, language = 'zh' }: UserMenuPopoverProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  if (!user) {
    return null
  }

  const handleNavigate = (path: string, search?: Record<string, string>) => {
    setOpen(false)
    void navigate({ to: path as never, search: search as never })
  }

  const handleLogout = () => {
    setOpen(false)
    onLogout()
  }

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-xl transition-colors hover:bg-zinc-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700"
          aria-label={language === 'zh' ? '用户菜单' : 'User menu'}
        >
          <Avatar className="h-8 w-8 shrink-0 rounded-xl border border-zinc-800 bg-zinc-900">
            <AvatarImage src={resolveMediaUrl(user.avatarUrl)} />
            <AvatarFallback className="rounded-xl bg-zinc-900 text-[10px] font-semibold text-zinc-100">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="user-menu-popover wemux-sidebar-menu-surface w-[280px] rounded-xl border border-zinc-800 bg-[#09090b]/[.98] p-2.5 shadow-2xl backdrop-blur-xl"
      >
        <div className="space-y-2">
          {/* 用户信息头部 */}
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12 rounded-full border border-zinc-800 bg-zinc-900">
              <AvatarImage src={resolveMediaUrl(user.avatarUrl)} />
              <AvatarFallback className="rounded-full bg-zinc-900 text-sm font-semibold text-zinc-100">
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-zinc-100">{user.name}</p>
              <p className="truncate text-xs text-zinc-500">{language === 'zh' ? '个人' : 'Personal'}</p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
              onClick={() => handleNavigate('/settings')}
              aria-label={language === 'zh' ? '设置' : 'Settings'}
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>

          {/* 商业区块（套餐/升级/积分）——公开版空渲染，私有版经 gate 注册 */}
          {(() => {
            const renderCommercialSection = getUserMenuCommercialSection()
            return renderCommercialSection
              ? renderCommercialSection({ language, onNavigate: handleNavigate })
              : null
          })()}

          <Separator className="my-1 bg-zinc-800" />

          {/* 菜单项 */}
          <div className="space-y-0.5">
            <MenuItem
              icon={UserIcon}
              label={language === 'zh' ? '账户' : 'Account'}
              onClick={() => handleNavigate('/settings', { section: 'account' })}
            />
            <MenuItem
              icon={Settings}
              label={language === 'zh' ? '设置' : 'Settings'}
              onClick={() => handleNavigate('/settings')}
            />
          </div>

          <Separator className="bg-zinc-800" />

          {/* 外部链接 */}
          <div className="space-y-0.5">
            <MenuLinkItem
              icon={Home}
              label={language === 'zh' ? '主页' : 'Home'}
              onClick={() => window.open('https://vibemux.com', '_blank')}
            />
            <MenuLinkItem
              icon={HelpCircle}
              label={language === 'zh' ? '获取帮助' : 'Get Help'}
              onClick={() => window.open('https://docs.vibemux.com', '_blank')}
            />
            <MenuLinkItem
              icon={FileText}
              label={language === 'zh' ? '文档' : 'Docs'}
              onClick={() => window.open('https://docs.vibemux.com', '_blank')}
            />
          </div>

          <Separator className="bg-zinc-800" />

          {/* 退出登录 */}
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-red-400 transition-colors hover:bg-zinc-900/50"
          >
            <LogOut className="h-4 w-4" />
            <span className="font-medium">{language === 'zh' ? '退出登录' : 'Sign Out'}</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>


  </>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof UserIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-zinc-900/50"
    >
      <Icon className="h-4 w-4 text-zinc-500" />
      <span className="text-sm text-zinc-300">{label}</span>
    </button>
  )
}

function MenuLinkItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof UserIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-zinc-900/50"
    >
      <div className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 text-zinc-500" />
        <span className="text-sm text-zinc-300">{label}</span>
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
    </button>
  )
}
