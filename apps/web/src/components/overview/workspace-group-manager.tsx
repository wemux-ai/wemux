/**
 * [INPUT]: 当前协作空间（workspaceId）、空间成员、可用 Agent、分组列表。
 * [OUTPUT]: 成员分组管理：建组/改名/删除、成员归类（人 + Agent 混合）、分组内成员展示。
 * [POS]: 空间内分组管理 UI（供 /overview「分组」tab 使用）；数据经 /api/collab/workspaces/:id/groups*。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useState } from 'react'
import { FolderPlus, Loader2, Pencil, Plus, Trash2, Users2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, resolveMediaUrl } from '../../lib/api'
import type { TeamMember, WorkspaceChatAgentOption, WorkspaceGroupWithMembers } from '../../lib/api'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'

type WorkspaceGroupManagerProps = {
  workspaceId: string
  members: TeamMember[]
  agents: WorkspaceChatAgentOption[]
  groups: WorkspaceGroupWithMembers[]
  language: string
  onReload: () => void
}

const memberName = (params: {
  memberType: 'user' | 'agent'
  memberId: string
  members: TeamMember[]
  agents: WorkspaceChatAgentOption[]
}) => {
  if (params.memberType === 'user') {
    return params.members.find((member) => member.id === params.memberId)?.name || params.memberId.slice(0, 8)
  }
  return params.agents.find((agent) => agent.id === params.memberId)?.name || params.memberId.slice(0, 8)
}

export function WorkspaceGroupManager({ workspaceId, members, agents, groups, language, onReload }: WorkspaceGroupManagerProps) {
  const tr = (zh: string, en: string) => (language === 'zh' ? zh : en)
  const [newGroupName, setNewGroupName] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [addingToGroupId, setAddingToGroupId] = useState('')
  const [addMemberType, setAddMemberType] = useState<'user' | 'agent'>('user')
  const [addMemberId, setAddMemberId] = useState('')
  const [renamingGroupId, setRenamingGroupId] = useState('')
  const [renameValue, setRenameValue] = useState('')

  const runBusy = async (key: string, action: () => Promise<void>) => {
    if (busyKey) return
    setBusyKey(key)
    try {
      await action()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr('操作失败', 'Failed'))
    } finally {
      setBusyKey('')
    }
  }

  const reload = async () => {
    await onReload()
  }

  const handleCreateGroup = () => {
    const name = newGroupName.trim()
    if (!name) return
    void runBusy('create', async () => {
      await api.createWorkspaceGroup(workspaceId, { name })
      setNewGroupName('')
      await reload()
    })
  }

  const handleAddMember = (groupId: string) => {
    if (!addMemberId) return
    void runBusy(`add:${groupId}`, async () => {
      await api.addWorkspaceGroupMember(workspaceId, groupId, { memberType: addMemberType, memberId: addMemberId })
      setAddMemberId('')
      setAddingToGroupId('')
      await reload()
    })
  }

  const candidateMembers = members.filter((member) => (
    !groups.some((group) => group.id === addingToGroupId && group.members.some((m) => m.memberType === 'user' && m.memberId === member.id))
  ))
  const candidateAgents = agents.filter((agent) => (
    !groups.some((group) => group.id === addingToGroupId && group.members.some((m) => m.memberType === 'agent' && m.memberId === agent.id))
  ))

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/75">
      <div className="flex items-center justify-between border-b border-zinc-900 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{tr('成员分组', 'Member groups')}</h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {tr('把人与 Agent 分到「市场营销组」「开发研发组」等协作子集，一个成员可属于多个分组。', 'Group people and agents into collaboration subsets; one member can belong to multiple groups.')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Input
            value={newGroupName}
            onChange={(event) => setNewGroupName(event.target.value)}
            placeholder={tr('新分组名…', 'New group name…')}
            className="h-7 w-36 rounded-md border-zinc-800 bg-zinc-950 text-xs"
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleCreateGroup()
            }}
          />
          <Button
            size="sm"
            disabled={!newGroupName.trim() || Boolean(busyKey)}
            onClick={handleCreateGroup}
            className="h-7 rounded-md bg-zinc-100 px-2 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
          >
            {busyKey === 'create' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FolderPlus className="mr-1 h-3 w-3" />}
            {tr('建组', 'Create')}
          </Button>
        </div>
      </div>

      <div className="divide-y divide-zinc-900">
        {groups.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-zinc-600">
            <Users2 className="mx-auto mb-2 h-8 w-8 text-zinc-700" />
            {tr('还没有分组。创建「市场营销组」「开发研发组」等，把成员归类。', 'No groups yet. Create one to organize members.')}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                {renamingGroupId === group.id ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <Input
                      autoFocus
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      className="h-7 w-44 rounded-md border-zinc-800 bg-zinc-950 text-xs"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          const name = renameValue.trim()
                          if (name) {
                            void runBusy(`rename:${group.id}`, async () => {
                              await api.renameWorkspaceGroup(workspaceId, group.id, { name })
                              setRenamingGroupId('')
                              await reload()
                            })
                          }
                        }
                        if (event.key === 'Escape') setRenamingGroupId('')
                      }}
                    />
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-zinc-400" onClick={() => setRenamingGroupId('')}>
                      {tr('取消', 'Cancel')}
                    </Button>
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-zinc-100">{group.name}</span>
                    <span className="rounded-full bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500">{group.members.length}</span>
                  </div>
                )}
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                    title={tr('重命名', 'Rename')}
                    onClick={() => {
                      setRenamingGroupId(group.id)
                      setRenameValue(group.name)
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 rounded-md text-rose-400 hover:bg-rose-500/10"
                    title={tr('删除分组', 'Delete group')}
                    disabled={Boolean(busyKey)}
                    onClick={() =>
                      void runBusy(`delete:${group.id}`, async () => {
                        await api.deleteWorkspaceGroup(workspaceId, group.id)
                        await reload()
                      })
                    }
                  >
                    {busyKey === `delete:${group.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              {group.members.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {group.members.map((member) => (
                    <span
                      key={`${member.memberType}:${member.memberId}`}
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/70 py-0.5 pl-1 pr-1 text-[11px] text-zinc-300"
                    >
                      <Avatar className="size-4">
                        {member.memberType === 'user'
                          ? (members.find((m) => m.id === member.memberId)?.avatarUrl
                              ? <AvatarImage src={resolveMediaUrl(members.find((m) => m.id === member.memberId)!.avatarUrl!)} />
                              : null)
                          : null}
                        <AvatarFallback className="bg-zinc-800 text-[8px] text-zinc-300">
                          {member.memberType === 'agent' ? 'A' : 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="max-w-32 truncate">
                        {memberName({ memberType: member.memberType, memberId: member.memberId, members, agents })}
                      </span>
                      <button
                        type="button"
                        className="rounded-full p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                        title={tr('移出分组', 'Remove from group')}
                        onClick={() =>
                          void runBusy(`remove:${group.id}:${member.memberType}:${member.memberId}`, async () => {
                            await api.removeWorkspaceGroupMember(workspaceId, group.id, member.memberType, member.memberId)
                            await reload()
                          })
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-zinc-600">{tr('暂无成员', 'No members')}</p>
              )}

              {addingToGroupId === group.id ? (
                <div className="mt-2 flex items-center gap-1.5">
                  <NativeSelect
                    value={addMemberType}
                    onChange={(event) => {
                      setAddMemberType(event.target.value as 'user' | 'agent')
                      setAddMemberId('')
                    }}
                    className="h-7 w-24 text-xs"
                  >
                    <option value="user">{tr('成员', 'Members')}</option>
                    <option value="agent">{tr('Agent', 'Agents')}</option>
                  </NativeSelect>
                  <NativeSelect
                    value={addMemberId}
                    onChange={(event) => setAddMemberId(event.target.value)}
                    className="h-7 min-w-0 flex-1 text-xs"
                  >
                    <option value="">{tr('选择…', 'Select…')}</option>
                    {(addMemberType === 'user' ? candidateMembers : candidateAgents).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!addMemberId || Boolean(busyKey)}
                    onClick={() => handleAddMember(group.id)}
                    className="h-7 rounded-md px-2 text-[11px] text-sky-300 hover:bg-sky-500/10 hover:text-sky-200"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    {tr('加入', 'Add')}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-zinc-500" onClick={() => setAddingToGroupId('')}>
                    {tr('取消', 'Cancel')}
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2 h-6 rounded-md px-2 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                  onClick={() => {
                    setAddingToGroupId(group.id)
                    setAddMemberId('')
                    setAddMemberType('user')
                  }}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  {tr('添加成员', 'Add member')}
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
