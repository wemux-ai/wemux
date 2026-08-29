import type { TaskChatContextRef } from '@shared/task-chat-context'
import { getProjectColor } from '@shared/project-color'
import type { Project } from '@shared/types'
import { normalizeWorkspaceFilePath } from '../../../lib/workspace-file-link'
import type { WorkspaceSessionSelectedContextItem } from './workspace-session-chat-types'

const FILE_REF_PATTERN = /(^|\s)@((?:\/|\.{1,2}\/)[^\s]+|(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9_-]{1,16})(?=\s|$)/g
const PROJECT_REF_PATTERN = /(^|\s)@(项目|project)(?=\s|$)/gi

const joinContextMeta = (...parts: Array<string | null | undefined>) => {
  return parts.map((part) => part?.trim()).filter(Boolean).join(' · ')
}

const buildFileDisplay = (path: string) => {
  const normalizedPath = normalizeWorkspaceFilePath(path)
  const pathSegments = normalizedPath.split('/').filter(Boolean)
  const label = pathSegments[pathSegments.length - 1] || normalizedPath
  const directoryLabel = pathSegments.length > 1
    ? pathSegments.slice(0, -1).join('/')
    : '.'

  return {
    label,
    directoryLabel,
  }
}

export const getTaskChatContextRefKey = (ref: TaskChatContextRef) => {
  if (ref.kind === 'workspace_file') {
    return `${ref.kind}:${ref.workspaceId}:${ref.workspaceSessionId}:${ref.path}`
  }

  return `${ref.kind}:${ref.projectId}`
}

export const buildWorkspaceFileContextRef = (params: {
  workspaceId: string
  workspaceSessionId: string
  path: string
}) => {
  return {
    kind: 'workspace_file' as const,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
    path: params.path,
  }
}

export const buildProjectContextRef = (params: {
  projectId: string
}) => {
  return {
    kind: 'project' as const,
    projectId: params.projectId,
  }
}

export const buildWorkspaceFileSelectedContextItem = (params: {
  workspaceId: string
  workspaceSessionId: string
  path: string
}) => {
  const ref = buildWorkspaceFileContextRef(params)
  const display = buildFileDisplay(params.path)

  return {
    key: getTaskChatContextRefKey(ref),
    kind: ref.kind,
    label: display.label,
    meta: joinContextMeta(display.directoryLabel, params.path),
    ref,
  } satisfies WorkspaceSessionSelectedContextItem
}

export const buildProjectSelectedContextItem = (params: {
  project: Project
  workspacePath?: string
}) => {
  const ref = buildProjectContextRef({
    projectId: params.project.id,
  })

  return {
    key: getTaskChatContextRefKey(ref),
    kind: ref.kind,
    label: params.project.name,
    meta: joinContextMeta(params.workspacePath, params.project.gitUrl, params.project.defaultBranch),
    accentColor: getProjectColor(params.project),
    ref,
  } satisfies WorkspaceSessionSelectedContextItem
}

export const buildSelectedContextItemsFromRefs = (params: {
  refs: TaskChatContextRef[]
  project?: Project | null
  projects?: Project[]
  workspacePath?: string
}): WorkspaceSessionSelectedContextItem[] => {
  const projectById = new Map<string, Project>()
  if (params.project) {
    projectById.set(params.project.id, params.project)
  }
  for (const project of params.projects ?? []) {
    projectById.set(project.id, project)
  }

  return params.refs.map((ref) => {
    if (ref.kind === 'workspace_file') {
      return buildWorkspaceFileSelectedContextItem({
        workspaceId: ref.workspaceId,
        workspaceSessionId: ref.workspaceSessionId,
        path: ref.path,
      })
    }

    const referencedProject = projectById.get(ref.projectId)
    if (referencedProject) {
      return buildProjectSelectedContextItem({
        project: referencedProject,
        workspacePath: params.workspacePath,
      })
    }

    return {
      key: getTaskChatContextRefKey(ref),
      kind: ref.kind,
      label: ref.projectId,
      meta: joinContextMeta(params.workspacePath, ref.projectId),
      ref,
    } satisfies WorkspaceSessionSelectedContextItem
  })
}

export const mergeTaskChatContextRefs = (...groups: TaskChatContextRef[][]) => {
  const merged: TaskChatContextRef[] = []
  const seen = new Set<string>()

  for (const group of groups) {
    for (const ref of group) {
      const key = getTaskChatContextRefKey(ref)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      merged.push(ref)
    }
  }

  return merged
}

export const extractWorkspaceContextRefs = (params: {
  input: string
  projectId?: string
  projects?: Array<{ id: string; name: string }>
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const projectId = params.projectId?.trim()
  const workspaceId = params.workspaceId?.trim()
  const workspaceSessionId = params.workspaceSessionId?.trim()
  const projects = params.projects?.filter((item) => item.id.trim() && item.name.trim()) ?? []
  if (!projectId && projects.length === 0 && (!workspaceId || !workspaceSessionId)) {
    return {
      message: params.input.trim(),
      contextRefs: [] as TaskChatContextRef[],
    }
  }

  const refs: TaskChatContextRef[] = []
  const seen = new Set<string>()
  const appendWorkspaceFileRef = (path: string) => {
    if (!workspaceId || !workspaceSessionId) {
      return
    }

    const normalizedPath = path.trim()
    if (!normalizedPath) {
      return
    }

    const dedupeKey = `${workspaceId}:${workspaceSessionId}:${normalizedPath}`
    if (seen.has(dedupeKey)) {
      return
    }

    seen.add(dedupeKey)
    refs.push({
      kind: 'workspace_file',
      workspaceId,
      workspaceSessionId,
      path: normalizedPath,
    })
  }

  let message = params.input
  if (workspaceId && workspaceSessionId) {
    FILE_REF_PATTERN.lastIndex = 0
    message.replace(FILE_REF_PATTERN, (match, leadingWhitespace: string, path: string) => {
      appendWorkspaceFileRef(path)
      return leadingWhitespace || ' '
    })
  }

  const appendProjectRef = (nextProjectId: string) => {
    const normalizedProjectId = nextProjectId.trim()
    if (!normalizedProjectId) {
      return
    }

    const dedupeKey = `project:${normalizedProjectId}`
    if (seen.has(dedupeKey)) {
      return
    }

    seen.add(dedupeKey)
    refs.push({
      kind: 'project',
      projectId: normalizedProjectId,
    })
  }

  if (projectId) {
    PROJECT_REF_PATTERN.lastIndex = 0
    message.replace(PROJECT_REF_PATTERN, () => {
      appendProjectRef(projectId)
      return ''
    })
  }

  for (const project of [...projects].sort((left, right) => right.name.length - left.name.length)) {
    const token = `@${project.name.trim()}`
    let start = message.indexOf(token)
    while (start !== -1) {
      const end = start + token.length
      const leftOk = start === 0 || /\s|[(\[{]/.test(message[start - 1] ?? '')
      const rightOk = end >= message.length || /\s|[.,!?，。！？:：)\]}]/.test(message[end] ?? '')
      if (leftOk && rightOk) {
        appendProjectRef(project.id)
      }
      start = message.indexOf(token, end)
    }
  }

  return {
    message: message.replace(/[ \t]+/g, ' ').trim(),
    contextRefs: refs,
  }
}

export const extractWorkspaceFileContextRefs = extractWorkspaceContextRefs
