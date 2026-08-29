// [INPUT]: DriveFileRecord + 当前 scope
// [OUTPUT]: 文件权限面板（协作者列表 + 添加 user/agent + 移除）与分享弹窗（链接 + 复制 + 关闭）
// [POS]: Drive 权限/分享 UI；manage 权限才能管理（服务端校验）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Bot, Copy, Link2, Loader2, Plus, Send, Trash2, User as UserIcon } from 'lucide-react'
import type { DriveFilePermissionRecord, DriveFileRecord, DriveFileShareRecord, DrivePermissionPrincipalType } from '@shared/types'
import { api } from '../../lib/api'
import type { TaskSummary } from '../../lib/api/methods/tasks'
import { Button } from '../ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Label } from '../ui/label'
import { SearchableSelect, type SearchableSelectOption } from '../ui/searchable-select'
import { cn } from '../../lib/utils'

type Scope = { kind: 'personal' } | { kind: 'team'; workspaceId: string }

const runForScope = (scope: Scope, file: DriveFileRecord, action: {
  list: () => Promise<{ permissions: DriveFilePermissionRecord[] }>
  set: (payload: { principalType: 'user' | 'agent'; principalId: string; role: 'read' | 'edit' | 'manage' }) => Promise<unknown>
  remove: (principalType: 'user' | 'agent', principalId: string) => Promise<unknown>
  getShare: () => Promise<{ share: DriveFileShareRecord | null }>
  createShare: (expiresAt?: string | null) => Promise<{ share: DriveFileShareRecord; url: string }>
  deleteShare: () => Promise<{ message: string }>
}) => action

export function DrivePermissionDialog({
  file,
  scope,
  onClose,
}: {
  file: DriveFileRecord
  scope: Scope
  onClose: () => void
}) {
  const [permissions, setPermissions] = useState<DriveFilePermissionRecord[]>([])
  const [principalType, setPrincipalType] = useState<'user' | 'agent'>('user')
  const [principalId, setPrincipalId] = useState('')
  const [role, setRole] = useState<'read' | 'edit' | 'manage'>('read')
  const [loading, setLoading] = useState(true)
  // 协作者候选（用户 + Agent），供选择器与显示名映射
  const [userOptions, setUserOptions] = useState<SearchableSelectOption[]>([])
  const [agentOptions, setAgentOptions] = useState<SearchableSelectOption[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(true)

  // 候选加载：全部用户 + Agents（团队按工作区过滤）
  useEffect(() => {
    setCandidatesLoading(true)
    void api.searchDrivePermissionCandidates()
      .then((res) => setUserOptions(res.users.map((u) => ({
        value: u.id,
        label: u.name,
        description: u.email,
        icon: <UserIcon className="h-3.5 w-3.5" />,
      }))))
      .catch(() => {})
    void (scope.kind === 'team' ? api.listAgents(scope.workspaceId) : api.listAgents())
      .then((res) => setAgentOptions(res.agents.map((a) => ({
        value: a.id,
        label: a.name,
        icon: <Bot className="h-3.5 w-3.5" />,
      }))))
      .catch(() => {})
      .finally(() => setCandidatesLoading(false))
  }, [scope])

  const displayName = useCallback((kind: DrivePermissionPrincipalType, id: string) => {
    if (kind === 'workspace') return id
    const options = kind === 'agent' ? agentOptions : userOptions
    return options.find((o) => o.value === id)?.label ?? id
  }, [userOptions, agentOptions])

  const ownerName = useMemo(() => {
    const asUser = displayName('user', file.createdBy)
    return asUser !== file.createdBy ? asUser : displayName('agent', file.createdBy)
  }, [file.createdBy, displayName])

  const reload = () => {
    const promise = scope.kind === 'personal'
      ? api.listMyDrivePermissions(file.id)
      : api.listTeamDrivePermissions(scope.workspaceId, file.id)
    promise.then((res) => setPermissions(res.permissions)).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(reload, [file.id])

  const addPermission = async () => {
    if (!principalId.trim()) return
    const payload = { principalType, principalId: principalId.trim(), role }
    try {
      if (scope.kind === 'personal') {
        await api.setMyDrivePermission(file.id, payload)
      } else {
        await api.setTeamDrivePermission(scope.workspaceId, file.id, payload)
      }
      toast.success('已添加协作者。')
      setPrincipalId('')
      reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加失败。')
    }
  }

  const changeRole = async (permission: DriveFilePermissionRecord, nextRole: 'read' | 'edit' | 'manage') => {
    try {
      const payload = { principalType: permission.principalType as 'user' | 'agent', principalId: permission.principalId, role: nextRole }
      if (scope.kind === 'personal') {
        await api.setMyDrivePermission(file.id, payload)
      } else {
        await api.setTeamDrivePermission(scope.workspaceId, file.id, payload)
      }
      toast.success('已更新权限。')
      reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新失败。')
    }
  }

  const removePermission = async (permission: DriveFilePermissionRecord) => {
    try {
      if (scope.kind === 'personal') {
        await api.removeMyDrivePermission(file.id, permission.principalType as 'user' | 'agent', permission.principalId)
      } else {
        await api.removeTeamDrivePermission(scope.workspaceId, file.id, permission.principalType as 'user' | 'agent', permission.principalId)
      }
      reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移除失败。')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate text-zinc-100">权限设置 · {file.name}</DialogTitle>
          <p className="text-[11px] text-zinc-500">所有者：<span className="text-zinc-400">{ownerName}</span> · 协作者权限按「文件 → 父目录 → 根」继承</p>
        </DialogHeader>
        <div className="space-y-1.5 px-5 py-4">
          {loading ? (
            <div className="flex justify-center py-6 text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /></div>
          ) : (
            permissions.map((permission) => (
              <div key={`${permission.principalType}:${permission.principalId}`} className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs">
                {permission.principalType === 'agent' ? <Bot className="h-3.5 w-3.5 text-zinc-500" /> : <UserIcon className="h-3.5 w-3.5 text-zinc-500" />}
                <span className="flex-1 truncate text-zinc-300">{displayName(permission.principalType, permission.principalId)}</span>
                <select
                  className="h-6 w-20 rounded-md border border-zinc-800 bg-zinc-950 px-1 text-[11px] text-zinc-400 focus:border-zinc-700 focus:outline-none"
                  value={permission.role}
                  onChange={(event) => void changeRole(permission, event.target.value as 'read' | 'edit' | 'manage')}
                  title="修改协作者角色"
                >
                  <option value="read">可阅读</option>
                  <option value="edit">可编辑</option>
                  <option value="manage">可管理</option>
                </select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-rose-300"
                  onClick={() => void removePermission(permission)}
                  title="移除协作者"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
          {!loading && permissions.length === 0 && (
            <p className="py-4 text-center text-xs text-zinc-500">暂无显式协作者（成员默认按组织继承权限）。</p>
          )}
        </div>
        <div className="space-y-2 border-t border-zinc-800 px-5 pb-1 pt-3">
          <p className="text-xs font-medium text-zinc-300">添加协作者</p>
          <div className="flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
            {([['user', '用户'], ['agent', 'Agent']] as Array<['user' | 'agent', string]>).map(([kind, label]) => (
              <button
                key={kind}
                className={cn(
                  'flex h-6 flex-1 items-center justify-center rounded-sm px-2 text-xs transition-colors',
                  principalType === kind ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
                )}
                onClick={() => { setPrincipalType(kind); setPrincipalId('') }}
              >{label}</button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-[10px] text-zinc-500">{principalType === 'user' ? '选择用户' : '选择 Agent'}</Label>
              <SearchableSelect
                value={principalId}
                options={principalType === 'user' ? userOptions : agentOptions}
                placeholder={candidatesLoading ? '加载候选…' : '搜索名称 / 邮箱'}
                emptyText="没有匹配的协作者"
                searchPlaceholder="输入名称搜索…"
                disabled={candidatesLoading}
                triggerClassName="h-8 w-full rounded-lg px-2.5 text-xs"
                onChange={setPrincipalId}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-zinc-500">权限</Label>
              <select
                className="h-8 w-20 rounded-lg border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200 focus:border-zinc-700 focus:outline-none"
                value={role}
                onChange={(event) => setRole(event.target.value as 'read' | 'edit' | 'manage')}
              >
                <option value="read">可阅读</option>
                <option value="edit">可编辑</option>
                <option value="manage">可管理</option>
              </select>
            </div>
            <Button
              size="sm"
              onClick={() => void addPermission()}
              disabled={!principalId.trim()}
              className="h-8 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
            ><Plus className="mr-1 h-3.5 w-3.5" />添加</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function DriveShareDialog({
  file,
  scope,
  onClose,
}: {
  file: DriveFileRecord
  scope: Scope
  onClose: () => void
}) {
  const [share, setShare] = useState<DriveFileShareRecord | null>(null)
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(true)

  // 分享到聊天（8a：Drive 引用附件——不复制内容，Agent 直接读原文件）
  type ChatTargetKind = 'task' | 'main-chat' | 'group-chat'
  const [targetKind, setTargetKind] = useState<ChatTargetKind>('task')
  const [taskOptions, setTaskOptions] = useState<SearchableSelectOption[]>([])
  const [taskOptionsLoading, setTaskOptionsLoading] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [mainChatSessions, setMainChatSessions] = useState<SearchableSelectOption[]>([])
  const [mainChatSessionsLoading, setMainChatSessionsLoading] = useState(false)
  const [selectedMainChatSessionId, setSelectedMainChatSessionId] = useState('')
  const [groupWorkspaces, setGroupWorkspaces] = useState<SearchableSelectOption[]>([])
  const [selectedGroupWorkspaceId, setSelectedGroupWorkspaceId] = useState('')
  const [groupOptions, setGroupOptions] = useState<SearchableSelectOption[]>([])
  const [groupOptionsLoading, setGroupOptionsLoading] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [groupSessionOptions, setGroupSessionOptions] = useState<SearchableSelectOption[]>([])
  const [groupSessionOptionsLoading, setGroupSessionOptionsLoading] = useState(false)
  const [selectedGroupSessionId, setSelectedGroupSessionId] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    setTaskOptionsLoading(true)
    setMainChatSessionsLoading(true)
    void api.listTaskSummaries()
      .then((res) => setTaskOptions(res.tasks.map((task: TaskSummary) => ({
        value: task.id,
        label: task.title || task.id,
      }))))
      .catch(() => {})
      .finally(() => setTaskOptionsLoading(false))
    void api.listMainChatSessionSummaries()
      .then((res) => setMainChatSessions(res.sessions.map((session) => ({
        value: session.id,
        label: session.title || session.id,
      }))))
      .catch(() => {})
      .finally(() => setMainChatSessionsLoading(false))
    void api.listCollaborationWorkspaces()
      .then((res) => setGroupWorkspaces(res.workspaces.map((workspace) => ({
        value: workspace.id,
        label: workspace.name,
      }))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setGroupOptions([])
    setGroupSessionOptions([])
    setSelectedGroupId('')
    setSelectedGroupSessionId('')
    if (!selectedGroupWorkspaceId) return
    setGroupOptionsLoading(true)
    void api.listWorkspaceChatGroups(selectedGroupWorkspaceId)
      .then((res) => setGroupOptions(res.groups.map((group) => ({
        value: group.conversation.id,
        label: group.conversation.title || group.conversation.id,
      }))))
      .catch(() => {})
      .finally(() => setGroupOptionsLoading(false))
  }, [selectedGroupWorkspaceId])

  useEffect(() => {
    setGroupSessionOptions([])
    setSelectedGroupSessionId('')
    if (!selectedGroupWorkspaceId || !selectedGroupId) return
    setGroupSessionOptionsLoading(true)
    void api.listWorkspaceChatGroupSessions(selectedGroupWorkspaceId, selectedGroupId)
      .then((res) => setGroupSessionOptions(res.sessions.map((session) => ({
        value: session.conversation.id,
        label: session.conversation.title || session.conversation.id,
      }))))
      .catch(() => {})
      .finally(() => setGroupSessionOptionsLoading(false))
  }, [selectedGroupWorkspaceId, selectedGroupId])

  const canSend = targetKind === 'task'
    ? Boolean(selectedTaskId)
    : targetKind === 'main-chat'
      ? Boolean(selectedMainChatSessionId)
      : Boolean(selectedGroupWorkspaceId && selectedGroupId && selectedGroupSessionId)

  const sendToChat = async () => {
    if (!canSend) return
    setSending(true)
    try {
      if (targetKind === 'task') {
        await api.sendDriveFileToTask(selectedTaskId, file.id)
      } else if (targetKind === 'main-chat') {
        await api.sendDriveFileToMainChat(selectedMainChatSessionId, file.id)
      } else {
        await api.sendDriveFileToGroupChat(selectedGroupWorkspaceId, selectedGroupId, selectedGroupSessionId, file.id)
      }
      toast.success(`已发送「${file.name}」到会话。`)
      setSelectedTaskId('')
      setSelectedMainChatSessionId('')
      setSelectedGroupSessionId('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发送失败。')
    } finally {
      setSending(false)
    }
  }

  const reload = () => {
    const promise = scope.kind === 'personal'
      ? api.getMyDriveShare(file.id)
      : api.getTeamDriveShare(scope.workspaceId, file.id)
    promise.then((res) => setShare(res.share)).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(reload, [file.id])

  const createShare = async () => {
    try {
      const res = scope.kind === 'personal'
        ? await api.createMyDriveShare(file.id)
        : await api.createTeamDriveShare(scope.workspaceId, file.id)
      setShare(res.share)
      setUrl(res.url)
      toast.success('分享链接已生成。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成失败。')
    }
  }

  const closeShare = async () => {
    try {
      if (scope.kind === 'personal') {
        await api.deleteMyDriveShare(file.id)
      } else {
        await api.deleteTeamDriveShare(scope.workspaceId, file.id)
      }
      setShare(null)
      setUrl('')
      toast.success('已关闭分享。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '关闭失败。')
    }
  }

  const copyLink = async () => {
    const link = url ? `${window.location.origin}${url}` : ''
    await navigator.clipboard.writeText(link).catch(() => {})
    toast.success('已复制分享链接。')
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate text-zinc-100">分享 · {file.name}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6 text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : share ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2">
              <Link2 className="h-4 w-4 shrink-0 text-zinc-500" />
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{window.location.origin}{url}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                onClick={() => void copyLink()}
              ><Copy className="h-3.5 w-3.5" /></Button>
            </div>
            <p className="text-[11px] text-zinc-500">
              链接公开可访问（只读）。任何人持链接可下载，无需登录。
            </p>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => void closeShare()}
                className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              >关闭分享</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-zinc-500">生成一个公开只读链接，任何持链接者无需登录即可下载该文件。</p>
            <DialogFooter>
              <Button
                onClick={() => void createShare()}
                className="h-8 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
              ><Link2 className="mr-1.5 h-3.5 w-3.5" />生成分享链接</Button>
            </DialogFooter>
          </div>
        )}

        {/* 分享到聊天（8a：Drive 引用附件，Agent 可读原文件） */}
        <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
          <p className="text-xs font-medium text-zinc-300">分享到聊天</p>
          <p className="text-[11px] text-zinc-500">
            发送到会话（引用，不复制内容）：会话中的 Agent 可直接读取该文件。
          </p>
          <div className="flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
            {([['task', '任务'], ['main-chat', '主聊天'], ['group-chat', '群聊']] as Array<[ChatTargetKind, string]>).map(([kind, label]) => (
              <button
                key={kind}
                className={cn(
                  'flex h-6 flex-1 items-center justify-center rounded-sm px-2 text-xs transition-colors',
                  targetKind === kind ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
                )}
                onClick={() => setTargetKind(kind)}
              >{label}</button>
            ))}
          </div>

          <div className="space-y-2">
            {targetKind === 'task' && (
              <SearchableSelect
                value={selectedTaskId}
                options={taskOptions}
                placeholder={taskOptionsLoading ? '加载任务…' : '选择任务会话'}
                emptyText="没有可见的任务"
                disabled={taskOptionsLoading || sending}
                triggerClassName="h-8 w-full rounded-lg px-2.5 text-xs"
                onChange={setSelectedTaskId}
              />
            )}
            {targetKind === 'main-chat' && (
              <SearchableSelect
                value={selectedMainChatSessionId}
                options={mainChatSessions}
                placeholder={mainChatSessionsLoading ? '加载主聊天会话…' : '选择主聊天会话'}
                emptyText="没有主聊天会话"
                disabled={mainChatSessionsLoading || sending}
                triggerClassName="h-8 w-full rounded-lg px-2.5 text-xs"
                onChange={setSelectedMainChatSessionId}
              />
            )}
            {targetKind === 'group-chat' && (
              <>
                <SearchableSelect
                  value={selectedGroupWorkspaceId}
                  options={groupWorkspaces}
                  placeholder="选择工作区"
                  emptyText="没有可见的工作区"
                  disabled={sending}
                  triggerClassName="h-8 w-full rounded-lg px-2.5 text-xs"
                  onChange={setSelectedGroupWorkspaceId}
                />
                <SearchableSelect
                  value={selectedGroupId}
                  options={groupOptions}
                  placeholder={groupOptionsLoading ? '加载群聊…' : '选择群聊'}
                  emptyText="该工作区没有群聊"
                  disabled={!selectedGroupWorkspaceId || groupOptionsLoading || sending}
                  triggerClassName="h-8 w-full rounded-lg px-2.5 text-xs"
                  onChange={setSelectedGroupId}
                />
                <SearchableSelect
                  value={selectedGroupSessionId}
                  options={groupSessionOptions}
                  placeholder={groupSessionOptionsLoading ? '加载会话…' : '选择群聊会话'}
                  emptyText="该群聊没有会话"
                  disabled={!selectedGroupId || groupSessionOptionsLoading || sending}
                  triggerClassName="h-8 w-full rounded-lg px-2.5 text-xs"
                  onChange={setSelectedGroupSessionId}
                />
              </>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!canSend || sending}
              onClick={() => void sendToChat()}
              className="h-8 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
            >
              {sending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              发送
            </Button>
          </div>
        </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
