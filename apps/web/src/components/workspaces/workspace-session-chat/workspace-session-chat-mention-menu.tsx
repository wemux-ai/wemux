import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Loader2, Wrench } from 'lucide-react'
import type { SkillRecord } from '@shared/skill'
import { getProjectColor } from '@shared/project-color'
import type { ExecutorDirectoryEntry, Project } from '@shared/types'
import type { AgentRecord } from '../../../lib/api'
import { api, resolveMediaUrl } from '../../../lib/api'
import { getAgentAvatarAccent } from '../../../lib/agent-avatar'
import { parseCustomAgentProfile } from '../../../lib/custom-agent/draft'
import { insertSkillMentionToken } from '../../../lib/skill-mentions'
import {
  isWorkspaceFilePathInsideRoot,
  normalizeWorkspaceFilePath,
} from '../../../lib/workspace-file-link'
import { cn } from '../../../lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '../../ui/avatar'

export type FileMentionItem = {
  absolutePath: string
  mentionPath: string
  label: string
  directoryLabel: string
}

type WorkspaceSessionChatMentionMenuProps = {
  executorId?: string
  fileRootPath?: string
  mentionAvailableAgents: AgentRecord[]
  mentionQuery: string
  mentionProjects?: Project[]
  mentionSkills: SkillRecord[]
  mentionSkillsLoading: boolean
  mentionUnavailableOptions: Array<{ agent: AgentRecord; blockerMessage: string }>
  onSelectAgent: (agent: AgentRecord) => void
  onSelectFile: (item: FileMentionItem) => void
  onSelectProject: (project: Project) => void
  onSelectSkill: (token: string) => void
  project?: Project | null
}

const FILE_MENTION_LIMIT = 8
const MAX_BROWSE_DIRECTORIES = 40
const MAX_COLLECTED_FILES = 120

const normalizeQuery = (value: string) => value.trim().toLowerCase()

const getAgentInitials = (name: string) => {
  const normalized = name.trim()
  if (!normalized) {
    return 'AI'
  }

  const parts = normalized.split(/\s+/).filter(Boolean)
  if (parts.length > 1) {
    return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  }

  return Array.from(normalized).slice(0, 2).join('').toUpperCase()
}

const joinInlineMeta = (...parts: Array<string | null | undefined>) => {
  return parts.map((part) => part?.trim()).filter(Boolean).join(' · ')
}

const buildFileMentionPath = (rootPath: string, filePath: string) => {
  const normalizedRootPath = normalizeWorkspaceFilePath(rootPath)
  const normalizedFilePath = normalizeWorkspaceFilePath(filePath)
  if (!normalizedRootPath || !normalizedFilePath) {
    return ''
  }

  if (!isWorkspaceFilePathInsideRoot(normalizedRootPath, normalizedFilePath)) {
    return normalizedFilePath
  }

  const relativePath = normalizedFilePath
    .slice(normalizedRootPath.length)
    .replace(/^\/+/, '')

  if (!relativePath) {
    return normalizedFilePath
  }

  return relativePath.includes('/') ? relativePath : `./${relativePath}`
}

const buildFileMentionItem = (rootPath: string, entry: ExecutorDirectoryEntry): FileMentionItem | null => {
  if (entry.kind !== 'file') {
    return null
  }

  const mentionPath = buildFileMentionPath(rootPath, entry.path)
  if (!mentionPath) {
    return null
  }

  const normalizedPath = normalizeWorkspaceFilePath(mentionPath)
  const pathSegments = normalizedPath.split('/').filter(Boolean)
  const label = pathSegments[pathSegments.length - 1] || normalizedPath
  const directoryLabel = pathSegments.length > 1
    ? pathSegments.slice(0, -1).join('/')
    : '.'

  return {
    absolutePath: entry.path,
    mentionPath,
    label,
    directoryLabel,
  }
}

const matchesProjectQuery = (project: Project, query: string) => {
  if (!query) {
    return true
  }

  const normalizedQuery = normalizeQuery(query)
  return [
    project.name,
    project.gitUrl || '',
    '项目',
    'project',
  ].some((value) => value.toLowerCase().includes(normalizedQuery))
}

const matchesSkillQuery = (skill: SkillRecord, query: string) => {
  if (!query) {
    return true
  }

  const normalizedQuery = normalizeQuery(query)
  return [
    skill.name,
    skill.slug,
    skill.description ?? '',
    'skill',
    '技能',
  ].some((value) => value.toLowerCase().includes(normalizedQuery))
}

const matchesFileQuery = (item: FileMentionItem, query: string) => {
  if (!query) {
    return true
  }

  const normalizedQuery = normalizeQuery(query)
  return [
    item.label,
    item.directoryLabel,
    item.mentionPath,
  ].some((value) => value.toLowerCase().includes(normalizedQuery))
}

async function collectWorkspaceFiles(params: {
  executorId: string
  rootPath: string
}) {
  const queue = [params.rootPath]
  const visited = new Set<string>()
  const files: FileMentionItem[] = []

  while (queue.length > 0 && visited.size < MAX_BROWSE_DIRECTORIES && files.length < MAX_COLLECTED_FILES) {
    const directoryPath = queue.shift()
    if (!directoryPath || visited.has(directoryPath)) {
      continue
    }

    visited.add(directoryPath)
    const result = await api.browseExecutorDirectory(params.executorId, directoryPath)
    if (!result.ok) {
      continue
    }

    for (const entry of result.entries) {
      if (entry.kind === 'directory') {
        if (queue.length < MAX_BROWSE_DIRECTORIES) {
          queue.push(entry.path)
        }
        continue
      }

      const item = buildFileMentionItem(params.rootPath, entry)
      if (item) {
        files.push(item)
      }
    }
  }

  return files
}

function MentionSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function MentionRow({
  disabled = false,
  leading,
  label,
  meta,
  onClick,
}: {
  disabled?: boolean
  leading: React.ReactNode
  label: string
  meta?: string
  onClick?: () => void
}) {
  const content = (
    <>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {leading}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <span className={cn('shrink-0 whitespace-nowrap text-[12px] font-medium', disabled ? 'text-zinc-300' : 'text-zinc-100')}>
          {label}
        </span>
        {meta ? (
          <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">{meta}</span>
        ) : null}
      </span>
    </>
  )

  if (disabled) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 py-2">
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-zinc-900"
    >
      {content}
    </button>
  )
}

export function WorkspaceSessionChatMentionMenu({
  executorId,
  fileRootPath,
  mentionAvailableAgents,
  mentionQuery,
  mentionProjects = [],
  mentionSkills,
  mentionSkillsLoading,
  mentionUnavailableOptions,
  onSelectAgent,
  onSelectFile,
  onSelectProject,
  onSelectSkill,
  project,
}: WorkspaceSessionChatMentionMenuProps) {
  const normalizedExecutorId = executorId?.trim() || ''
  const normalizedRootPath = fileRootPath?.trim() || ''
  const normalizedMentionQuery = normalizeQuery(mentionQuery)
  const [fileItems, setFileItems] = useState<FileMentionItem[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [fileError, setFileError] = useState('')
  const fileCacheRef = useRef<Map<string, FileMentionItem[]>>(new Map())

  useEffect(() => {
    if (!normalizedExecutorId || !normalizedRootPath) {
      setFileItems([])
      setLoadingFiles(false)
      setFileError('')
      return
    }

    const cacheKey = `${normalizedExecutorId}:${normalizedRootPath}`
    const cached = fileCacheRef.current.get(cacheKey)
    if (cached) {
      setFileItems(cached)
      setLoadingFiles(false)
      setFileError('')
      return
    }

    let cancelled = false
    setLoadingFiles(true)
    setFileError('')

    void collectWorkspaceFiles({
      executorId: normalizedExecutorId,
      rootPath: normalizedRootPath,
    }).then((items) => {
      if (cancelled) {
        return
      }

      fileCacheRef.current.set(cacheKey, items)
      setFileItems(items)
      setLoadingFiles(false)
    }).catch((error) => {
      if (cancelled) {
        return
      }

      setLoadingFiles(false)
      setFileError(error instanceof Error ? error.message : '文件列表加载失败。')
    })

    return () => {
      cancelled = true
    }
  }, [normalizedExecutorId, normalizedRootPath])

  const visibleProjects = useMemo(() => {
    const projects = new Map<string, Project>()
    if (project) {
      projects.set(project.id, project)
    }
    for (const item of mentionProjects) {
      projects.set(item.id, item)
    }

    return Array.from(projects.values())
      .filter((item) => matchesProjectQuery(item, normalizedMentionQuery))
      .slice(0, 8)
  }, [mentionProjects, normalizedMentionQuery, project])
  const visibleSkills = useMemo(() => {
    return mentionSkills
      .filter((skill) => matchesSkillQuery(skill, normalizedMentionQuery))
      .slice(0, 5)
  }, [mentionSkills, normalizedMentionQuery])
  const visibleAvailableAgents = useMemo(() => {
    return mentionAvailableAgents.slice(0, 6).map((agent) => {
      const profile = parseCustomAgentProfile(agent)
      const description = joinInlineMeta(
        profile.role || profile.summary || agent.type,
        `@${agent.name}`,
      )

      return {
        agent,
        avatarUrl: profile.avatarUrl,
        avatarClassName: getAgentAvatarAccent(agent.id || agent.name),
        description,
      }
    })
  }, [mentionAvailableAgents])
  const visibleUnavailableAgents = useMemo(() => {
    return mentionUnavailableOptions.map(({ agent, blockerMessage }) => {
      const profile = parseCustomAgentProfile(agent)
      const description = joinInlineMeta(
        blockerMessage || '当前范围不可用。',
        profile.role || profile.summary || agent.type,
      )

      return {
        agent,
        avatarUrl: profile.avatarUrl,
        avatarClassName: getAgentAvatarAccent(agent.id || agent.name),
        description,
      }
    })
  }, [mentionUnavailableOptions])
  const visibleFiles = useMemo(() => {
    return fileItems
      .filter((item) => matchesFileQuery(item, normalizedMentionQuery))
      .slice(0, FILE_MENTION_LIMIT)
  }, [fileItems, normalizedMentionQuery])
  const hasAnySection = visibleProjects.length > 0
    || visibleAvailableAgents.length > 0
    || visibleUnavailableAgents.length > 0
    || mentionSkillsLoading
    || visibleSkills.length > 0
    || loadingFiles
    || visibleFiles.length > 0
    || Boolean(fileError)

  return (
    <div className="mb-3 flex max-h-[min(24rem,calc(100dvh-12rem))] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-[#09090b] p-2 shadow-[0_12px_30px_rgba(0,0,0,0.35)] sm:max-h-[min(30rem,calc(100dvh-14rem))]">
      <p className="px-2 pb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">插入上下文</p>
      <div className="scrollbar-subtle min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
        {visibleProjects.length > 0 ? (
          <MentionSection title="项目">
            {visibleProjects.map((item) => (
              <MentionRow
                key={item.id}
                leading={(
                  <span
                    className="h-3.5 w-3.5 rounded-[4px] border border-white/10"
                    style={{ backgroundColor: getProjectColor(item) }}
                  />
                )}
                label={item.name}
                meta={joinInlineMeta(item.id === project?.id ? '@项目' : `@${item.name}`, item.gitUrl)}
                onClick={() => onSelectProject(item)}
              />
            ))}
          </MentionSection>
        ) : null}

        {(mentionSkillsLoading || visibleSkills.length > 0) ? (
          <MentionSection title="技能">
            {mentionSkillsLoading ? (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在加载技能...
              </div>
            ) : null}
            {visibleSkills.map((skill) => (
              <MentionRow
                key={skill.id}
                leading={<Wrench className="h-3.5 w-3.5 text-violet-300" />}
                label={skill.name}
                meta={joinInlineMeta(`@${skill.slug}`, skill.description)}
                onClick={() => onSelectSkill(insertSkillMentionToken('', skill).trim())}
              />
            ))}
          </MentionSection>
        ) : null}

        {(loadingFiles || visibleFiles.length > 0 || fileError || (!normalizedExecutorId || !normalizedRootPath)) ? (
          <MentionSection title="文件">
            {loadingFiles ? (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在索引工作区文件...
              </div>
            ) : null}
            {!loadingFiles && !normalizedExecutorId ? (
              <div className="rounded-lg px-3 py-2 text-xs text-zinc-500">
                当前还没有可用执行节点，暂时无法列出文件。
              </div>
            ) : null}
            {!loadingFiles && normalizedExecutorId && !normalizedRootPath ? (
              <div className="rounded-lg px-3 py-2 text-xs text-zinc-500">
                当前工作区目录还没准备好，暂时无法列出文件。
              </div>
            ) : null}
            {!loadingFiles && fileError ? (
              <div className="rounded-lg px-3 py-2 text-xs text-rose-300">
                {fileError}
              </div>
            ) : null}
            {!loadingFiles && !fileError && visibleFiles.map((item) => (
              <MentionRow
                key={item.absolutePath}
                leading={<FileText className="h-3.5 w-3.5 text-sky-300" />}
                label={item.label}
                meta={joinInlineMeta(item.directoryLabel, item.mentionPath)}
                onClick={() => onSelectFile(item)}
              />
            ))}
            {!loadingFiles && !fileError && normalizedExecutorId && normalizedRootPath && visibleFiles.length === 0 ? (
              <div className="rounded-lg px-3 py-2 text-xs text-zinc-500">
                没有匹配的文件。
              </div>
            ) : null}
          </MentionSection>
        ) : null}

        {(visibleAvailableAgents.length > 0 || visibleUnavailableAgents.length > 0) ? (
          <MentionSection title="Agent">
            {visibleAvailableAgents.map(({ agent, avatarClassName, avatarUrl, description }) => (
              <MentionRow
                key={agent.id}
                leading={(
                  <Avatar className="h-5 w-5 rounded-full">
                    {avatarUrl ? <AvatarImage src={resolveMediaUrl(avatarUrl)} /> : null}
                    <AvatarFallback className={cn(
                      'rounded-full bg-gradient-to-br text-[9px] font-black text-zinc-950',
                      avatarClassName,
                    )}>
                      {getAgentInitials(agent.name)}
                    </AvatarFallback>
                  </Avatar>
                )}
                label={agent.name}
                meta={description}
                onClick={() => onSelectAgent(agent)}
              />
            ))}
            {visibleUnavailableAgents.map(({ agent, avatarClassName, avatarUrl, description }) => (
              <MentionRow
                key={`${agent.id}:blocked`}
                disabled
                leading={(
                  <Avatar className="h-5 w-5 rounded-full grayscale">
                    {avatarUrl ? <AvatarImage src={resolveMediaUrl(avatarUrl)} /> : null}
                    <AvatarFallback className={cn(
                      'rounded-full bg-gradient-to-br text-[9px] font-black text-zinc-950',
                      avatarClassName,
                    )}>
                      {getAgentInitials(agent.name)}
                    </AvatarFallback>
                  </Avatar>
                )}
                label={agent.name}
                meta={description}
              />
            ))}
          </MentionSection>
        ) : null}

        {!hasAnySection ? (
          <div className={cn('rounded-lg px-3 py-2 text-xs text-zinc-500')}>
            没有匹配的上下文项。
          </div>
        ) : null}
      </div>
    </div>
  )
}
