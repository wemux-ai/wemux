import { Check, ChevronsUpDown, Plus, Settings2 } from 'lucide-react'
import { useState } from 'react'
import type { User } from '../lib/auth-context'
import { type CollaborationWorkspace, resolveMediaUrl } from '../lib/api'
import { cn } from '../lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Input } from './ui/input'

/** 未填写描述时的默认组织描述文案；同时用于判断是否展示「个人默认」徽章，两处必须同源。 */
const DEFAULT_ORG_META = '个人默认组织'

const getWorkspaceInitials = (name?: string) => {
  const normalized = name?.trim() || 'WS'
  return normalized.slice(0, 2).toUpperCase()
}

export function AppSidebarWorkspaceSwitcher({
  collapsed = false,
  compact = false,
  currentWorkspace,
  user,
  workspaces,
  onCreateWorkspace,
  onOpenSettings,
  onSelectWorkspace,
}: {
  collapsed?: boolean
  compact?: boolean
  currentWorkspace: CollaborationWorkspace | null
  user: User | null
  workspaces: CollaborationWorkspace[]
  onCreateWorkspace: (name: string) => Promise<void>
  onOpenSettings: () => void
  onSelectWorkspace: (workspaceId: string) => void
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [creating, setCreating] = useState(false)

  const title = currentWorkspace?.name || `${user?.name || '我的'} 的组织`
  const currentWorkspaceMeta = currentWorkspace?.description?.trim() || DEFAULT_ORG_META
  const showDefaultBadge = currentWorkspaceMeta === DEFAULT_ORG_META
  const triggerAvatarSize = compact ? 28 : 22
  const itemAvatarSize = compact ? 36 : 22

  const handleCreateWorkspace = async () => {
    const normalizedName = draftName.trim()
    if (!normalizedName || creating) {
      return
    }

    setCreating(true)
    try {
      await onCreateWorkspace(normalizedName)
      setDraftName('')
      setCreateOpen(false)
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className={cn(
              "text-zinc-100 transition-colors hover:bg-zinc-900/60 data-[state=open]:bg-zinc-900/60 data-[state=open]:text-zinc-50",
              collapsed
                ? "h-10 w-10 justify-center rounded-xl px-0"
                : compact
                  ? "h-11 w-full justify-start gap-2.5 rounded-xl px-2 text-left"
                  : "h-8 w-full justify-start gap-1.5 rounded-md px-1 text-left",
            )}
            title={title}
          >
            <Avatar
              className={cn(
                "shrink-0 border border-zinc-800 bg-zinc-900",
                compact ? "rounded-lg" : "rounded-md",
              )}
              style={{ width: triggerAvatarSize, height: triggerAvatarSize }}
            >
              <AvatarImage src={resolveMediaUrl(currentWorkspace?.avatarUrl)} />
              <AvatarFallback className={cn(
                "bg-zinc-900 font-semibold text-zinc-100",
                compact ? "rounded-lg text-[11px]" : "rounded-md text-[10px]",
              )}>
                {getWorkspaceInitials(currentWorkspace?.name || user?.name || 'WS')}
              </AvatarFallback>
            </Avatar>
            {!collapsed ? (
              <>
                <div className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "truncate font-semibold text-zinc-100",
                      compact ? "text-[15px]" : "text-[13px]",
                    )}>{title}</span>
                    {showDefaultBadge ? (
                      <span className="shrink-0 rounded-full border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] leading-none text-zinc-500">
                        默认
                      </span>
                    ) : null}
                  </div>
                </div>
                <ChevronsUpDown className="ml-auto h-3 w-3 text-zinc-500" />
              </>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          sideOffset={8}
          className={cn(
            "wemux-sidebar-menu-surface w-[--radix-dropdown-menu-trigger-width] min-w-60 rounded-xl p-1.5",
            compact && "rounded-2xl p-2",
          )}
        >
          <DropdownMenuLabel className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            组织
          </DropdownMenuLabel>
          {workspaces.length > 0 ? workspaces.map((workspace) => {
            const selected = workspace.id === currentWorkspace?.id
            const workspaceMeta = workspace.description?.trim() || DEFAULT_ORG_META
            return (
              <DropdownMenuItem
                key={workspace.id}
                className={cn(
                  "gap-2 rounded-lg px-2 py-1.5",
                  compact && "gap-3 rounded-xl px-2.5 py-2.5",
                )}
                onSelect={() => onSelectWorkspace(workspace.id)}
              >
                <Avatar
                  className={cn(
                    "shrink-0 border border-zinc-800 bg-zinc-950",
                    compact ? "rounded-xl" : "rounded-md",
                  )}
                  style={{ width: itemAvatarSize, height: itemAvatarSize }}
                >
                  <AvatarImage src={resolveMediaUrl(workspace.avatarUrl)} />
                  <AvatarFallback className={cn(
                    "bg-zinc-900 font-semibold text-zinc-100",
                    compact ? "rounded-xl text-[11px]" : "rounded-md text-[10px]",
                  )}>
                    {getWorkspaceInitials(workspace.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className={cn(
                    "block truncate font-medium text-zinc-100",
                    compact ? "text-[15px]" : "text-[13px]",
                  )}>
                    {workspace.name}
                  </span>
                  <span className={cn(
                    "block truncate text-zinc-500",
                    compact ? "text-[13px] leading-5" : "text-[11px] leading-4",
                  )}>
                    {workspaceMeta}
                  </span>
                </span>
                <Check className={cn(
                  "text-emerald-400",
                  compact ? "h-4 w-4" : "h-3.5 w-3.5",
                  !selected && 'opacity-0',
                )} />
              </DropdownMenuItem>
            )
          }) : (
            <div className="px-2 py-2 text-sm text-zinc-500">
              还没有组织，先创建一个。
            </div>
          )}
          <DropdownMenuSeparator className="my-1 bg-zinc-800" />
          <DropdownMenuItem
            className={cn(
              "gap-2 rounded-lg px-2 py-1.5",
              compact && "gap-3 rounded-xl px-2.5 py-2.5",
            )}
            onSelect={(event) => {
              event.preventDefault()
              setCreateOpen(true)
            }}
          >
            <span
              className={cn(
                "flex items-center justify-center border border-zinc-800 bg-zinc-950 text-zinc-400",
                compact ? "h-9 w-9 rounded-xl" : "h-[22px] w-[22px] rounded-md",
              )}
            >
              <Plus className="h-3.5 w-3.5" />
            </span>
            <span className={cn(
              "min-w-0 flex-1 font-medium text-zinc-100",
              compact ? "text-[15px]" : "text-[13px]",
            )}>
              创建组织
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className={cn(
              "gap-2 rounded-lg px-2 py-1.5",
              compact && "gap-3 rounded-xl px-2.5 py-2.5",
            )}
            onSelect={() => onOpenSettings()}
          >
            <span
              className={cn(
                "flex items-center justify-center border border-zinc-800 bg-zinc-950 text-zinc-400",
                compact ? "h-9 w-9 rounded-xl" : "h-[22px] w-[22px] rounded-md",
              )}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </span>
            <span className={cn(
              "min-w-0 flex-1 font-medium text-zinc-100",
              compact ? "text-[15px]" : "text-[13px]",
            )}>
              组织管理
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>创建组织</DialogTitle>
            <DialogDescription className="text-zinc-500">
              用一个统一组织承载项目、模型、Skills、MCP 和执行器边界。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-5 py-4">
            <label className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
              组织名称
            </label>
            <Input
              autoFocus
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="例如：Growth Lab"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900"
              disabled={creating}
              onClick={() => setCreateOpen(false)}
            >
              取消
            </Button>
            <Button disabled={creating || !draftName.trim()} onClick={() => void handleCreateWorkspace()}>
              {creating ? '创建中...' : '创建组织'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
