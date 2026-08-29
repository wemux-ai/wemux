// [INPUT]: 环境模板输入
// [OUTPUT]: 模板契约
// [POS]: 项目环境模板类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { parse } from 'yaml'
import type {
  ImportedProjectEnvironmentTemplate,
  Project,
  ProjectEnvironmentTemplate,
  ProjectEnvironmentTemplateSource,
  WorkspaceSession,
} from './types'
import { getWorkspaceRepoName } from './workspace-paths'

export const PROJECT_ENVIRONMENT_TEMPLATE_FIELD_KEYS = [
  'installCommand',
  'buildCommand',
  'testCommand',
  'lintCommand',
  'branchNamePattern',
  'startCommandTemplate',
  'stopCommandTemplate',
  'nukeCommandTemplate',
  'appPort',
  'healthPath',
  'logsCommandTemplate',
  'ports',
  'previewDomainBindings',
] as const

export type ProjectEnvironmentTemplateFieldKey = (typeof PROJECT_ENVIRONMENT_TEMPLATE_FIELD_KEYS)[number]

const VIBEMUX_YML_IMPORTED_FIELD_KEYS = [
  'installCommand',
  'startCommandTemplate',
  'stopCommandTemplate',
  'appPort',
  'healthPath',
  'logsCommandTemplate',
  'ports',
] as const

type VibemuxYmlImportedFieldKey = (typeof VIBEMUX_YML_IMPORTED_FIELD_KEYS)[number]

const slugifyTemplateIdentifier = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const sanitizeTemplateIdentifier = (value: string, fallback: string) => slugifyTemplateIdentifier(value) || fallback
const sanitizeWorktreeName = (value: string) => sanitizeTemplateIdentifier(value, 'worktree')
const buildEnvironmentSlug = (projectSlug: string, uniqueId: number) => {
  return sanitizeTemplateIdentifier(`${projectSlug}-${uniqueId}`, `environment-${uniqueId}`)
}

const parseTemplateSource = (_configPath: string): ProjectEnvironmentTemplateSource => 'vibemux-yml'

const normalizeTemplateString = (value: unknown) => {
  return typeof value === 'string' ? value.trim() : ''
}

const normalizeYamlString = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? String(value) : normalizeTemplateString(value)
)

const normalizeTemplateStringList = (value: unknown) => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => normalizeTemplateString(item))
    .filter(Boolean)
}

const normalizeHealthPath = (value: unknown) => {
  const trimmed = normalizeTemplateString(value)
  if (!trimmed) {
    return undefined
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

const normalizePreviewPort = (value: unknown) => {
  const port = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return undefined
  }
  return port
}

export const normalizeEnvironmentPorts = (value: unknown) => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        return null
      }
      const candidate = item as {
        id?: unknown
        domain?: unknown
        port?: unknown
        note?: unknown
        type?: unknown
      }
      const port = normalizeTemplateString(candidate.port)
      if (!port) {
        return null
      }
      const type = candidate.type === 'custom' ? 'custom' as const : 'generated' as const
      return {
        id: normalizeTemplateString(candidate.id) || `port-${index + 1}`,
        domain: normalizeTemplateString(candidate.domain) || undefined,
        port,
        note: normalizeTemplateString(candidate.note) || undefined,
        type,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

export const normalizePreviewDomainBindings = (value: unknown) => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        return null
      }
      const candidate = item as {
        id?: unknown
        domain?: unknown
        port?: unknown
        note?: unknown
        type?: unknown
      }
      const port = normalizePreviewPort(candidate.port)
      if (!port) {
        return null
      }
      const type = candidate.type === 'custom' ? 'custom' as const : 'generated' as const
      return {
        id: normalizeTemplateString(candidate.id) || `preview-domain-${index + 1}`,
        domain: normalizeTemplateString(candidate.domain) || undefined,
        port,
        note: normalizeTemplateString(candidate.note) || undefined,
        type,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

const buildLocalPreviewUrlFromPort = (port: number) => `http://127.0.0.1:${port}/`
const buildLocalHealthUrl = (port: number, healthPath?: string) => (
  healthPath ? `http://127.0.0.1:${port}${healthPath}` : undefined
)

const scoreResolvedPreviewBinding = (binding: {
  id: string
  domain?: string
  note?: string
  type?: 'generated' | 'custom'
}) => {
  let score = 0
  if (binding.type === 'custom') {
    score += 8
  }
  if (binding.domain?.trim()) {
    score += 4
  }
  if (binding.note?.trim()) {
    score += 2
  }
  if (binding.id && binding.id !== 'app') {
    score += 1
  }
  return score
}

const inferInstallCommandFromPackageManager = (value: string) => {
  const normalized = normalizeTemplateString(value).toLowerCase()
  if (!normalized) {
    return undefined
  }

  if (normalized.startsWith('pnpm')) return 'pnpm install'
  if (normalized.startsWith('npm')) return 'npm install'
  if (normalized.startsWith('yarn')) return 'yarn install'
  if (normalized.startsWith('bun')) return 'bun install'
  return undefined
}

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
)

const parseTemplateYaml = (content: string) => {
  try {
    return asRecord(parse(content))
  } catch {
    return null
  }
}

export const parseProjectEnvironmentTemplate = (
  content: string,
  options?: { configPath?: string; source?: ProjectEnvironmentTemplateSource },
): ProjectEnvironmentTemplate | null => {
  const config = parseTemplateYaml(content)
  if (!config) {
    return null
  }

  const env = asRecord(config.environment)
  const startCommand = normalizeYamlString(env.start)
  const appPort = normalizeYamlString(env.appPort)
  if (!startCommand && !appPort) {
    const services = Object.entries(asRecord(config.services)).map(([id, value]) => {
      const service = asRecord(value)
      return {
        id,
        command: normalizeYamlString(service.command) || undefined,
        port: normalizeYamlString(service.port) || undefined,
        healthPath: normalizeHealthPath(asRecord(service.healthCheck).path),
      }
    })
    if (services.length === 0) {
      return null
    }

    const primaryService = services.find((service) => service.command || service.port) ?? services[0]
    if (!primaryService?.command && !primaryService?.port) {
      return null
    }

    const additionalPorts = services
      .filter((service) => service.id !== primaryService.id)
      .map((service) => {
        const port = normalizeTemplateString(service.port)
        if (!port) {
          return null
        }

        return {
          id: service.id,
          port,
          note: service.id,
          type: 'generated' as const,
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))

    const packageManager = normalizeYamlString(asRecord(config.runtime).packageManager)
    const installCommand = inferInstallCommandFromPackageManager(packageManager || '')
    const imported: ImportedProjectEnvironmentTemplate = {
      installCommand,
      startCommandTemplate: normalizeTemplateString(primaryService.command) || undefined,
      appPort: normalizeTemplateString(primaryService.port) || undefined,
      healthPath: primaryService.healthPath,
      ports: additionalPorts,
      configPath: options?.configPath,
    }

    return {
      ...imported,
      configPath: options?.configPath,
      source: options?.source ?? (options?.configPath ? parseTemplateSource(options.configPath) : 'manual'),
      imported,
    }
  }

  const imported: ImportedProjectEnvironmentTemplate = {
    installCommand: normalizeYamlString(env.install) || undefined,
    startCommandTemplate: startCommand || undefined,
    stopCommandTemplate: normalizeYamlString(env.stop) || undefined,
    appPort: appPort || undefined,
    healthPath: normalizeHealthPath(env.healthPath),
    logsCommandTemplate: normalizeYamlString(env.logs) || undefined,
    ports: normalizeEnvironmentPorts(Array.isArray(env.ports)
      ? env.ports.map((port) => ({ ...asRecord(port), port: normalizeYamlString(asRecord(port).port) }))
      : env.ports),
    configPath: options?.configPath,
  }

  return {
    ...imported,
    configPath: options?.configPath,
    source: options?.source ?? (options?.configPath ? parseTemplateSource(options.configPath) : 'manual'),
    imported,
  }
}

const normalizeTemplateValue = (value?: string) => normalizeTemplateString(value)

export const isProjectEnvironmentTemplateFieldOverridden = (
  template: Pick<ProjectEnvironmentTemplate, 'source' | 'imported'> & Partial<ProjectEnvironmentTemplate>,
  key: VibemuxYmlImportedFieldKey,
) => {
  if (template.source !== 'vibemux-yml' || !template.imported) {
    return false
  }

  if (key === 'ports') {
    const currentList = normalizeEnvironmentPorts(template[key])
    const importedList = normalizeEnvironmentPorts(template.imported[key])
    return JSON.stringify(currentList) !== JSON.stringify(importedList)
  }

  return normalizeTemplateValue(template[key]) !== normalizeTemplateValue(template.imported[key])
}

export const countProjectEnvironmentTemplateOverrides = (template?: ProjectEnvironmentTemplate | null) => {
  if (!template || template.source !== 'vibemux-yml' || !template.imported) {
    return 0
  }

  return VIBEMUX_YML_IMPORTED_FIELD_KEYS.reduce((count, key) => (
    isProjectEnvironmentTemplateFieldOverridden(template, key) ? count + 1 : count
  ), 0)
}

export const resolveEffectiveProjectEnvironmentTemplate = (params: {
  project?: Pick<Project, 'environmentTemplate'> | null
  workspaceEnvironmentTemplate?: ProjectEnvironmentTemplate | null
}) => {
  const projectTemplate = params.project?.environmentTemplate
  const workspaceTemplate = params.workspaceEnvironmentTemplate
  if (!workspaceTemplate) {
    return projectTemplate
  }
  if (!projectTemplate) {
    return workspaceTemplate
  }

  const resolveStringField = (key: Exclude<ProjectEnvironmentTemplateFieldKey, 'ports' | 'previewDomainBindings'>) => {
    return normalizeTemplateString(workspaceTemplate[key]) || normalizeTemplateString(projectTemplate[key]) || undefined
  }
  const workspaceDomainBindings = normalizePreviewDomainBindings(workspaceTemplate.previewDomainBindings)
  const projectDomainBindings = normalizePreviewDomainBindings(projectTemplate.previewDomainBindings)
  const workspacePorts = normalizeEnvironmentPorts(workspaceTemplate.ports)
  const projectPorts = normalizeEnvironmentPorts(projectTemplate.ports)

  return {
    installCommand: resolveStringField('installCommand'),
    buildCommand: resolveStringField('buildCommand'),
    testCommand: resolveStringField('testCommand'),
    lintCommand: resolveStringField('lintCommand'),
    branchNamePattern: resolveStringField('branchNamePattern'),
    startCommandTemplate: resolveStringField('startCommandTemplate'),
    stopCommandTemplate: resolveStringField('stopCommandTemplate'),
    nukeCommandTemplate: resolveStringField('nukeCommandTemplate'),
    appPort: resolveStringField('appPort'),
    healthPath: normalizeHealthPath(resolveStringField('healthPath')),
    logsCommandTemplate: resolveStringField('logsCommandTemplate'),
    ports: workspacePorts.length > 0 ? workspacePorts : projectPorts,
    previewDomainBindings: workspaceDomainBindings.length > 0 ? workspaceDomainBindings : projectDomainBindings,
    configPath: workspaceTemplate.configPath ?? projectTemplate.configPath,
    source: workspaceTemplate.source ?? projectTemplate.source,
    imported: workspaceTemplate.imported ?? projectTemplate.imported,
  } satisfies ProjectEnvironmentTemplate
}

export const mergeImportedProjectEnvironmentTemplate = (params: {
  current?: ProjectEnvironmentTemplate | null
  imported: ProjectEnvironmentTemplate
}): ProjectEnvironmentTemplate => {
  const nextImported = params.imported.imported ?? {
    installCommand: params.imported.installCommand,
    buildCommand: params.imported.buildCommand,
    testCommand: params.imported.testCommand,
    lintCommand: params.imported.lintCommand,
    branchNamePattern: params.imported.branchNamePattern,
    startCommandTemplate: params.imported.startCommandTemplate,
    stopCommandTemplate: params.imported.stopCommandTemplate,
    nukeCommandTemplate: params.imported.nukeCommandTemplate,
    appPort: params.imported.appPort,
    healthPath: params.imported.healthPath,
    logsCommandTemplate: params.imported.logsCommandTemplate,
    ports: params.imported.ports,
    previewDomainBindings: params.imported.previewDomainBindings,
    configPath: params.imported.configPath,
  }

  const current = params.current
  if (!current) {
    return {
      ...params.imported,
      imported: nextImported,
      source: 'vibemux-yml',
      configPath: nextImported.configPath,
    }
  }

  const previousImported = current.imported
  const merged: ProjectEnvironmentTemplate = {
    source: 'vibemux-yml',
    buildCommand: current.buildCommand,
    testCommand: current.testCommand,
    lintCommand: current.lintCommand,
    branchNamePattern: current.branchNamePattern,
    nukeCommandTemplate: current.nukeCommandTemplate,
    previewDomainBindings: current.previewDomainBindings,
    configPath: nextImported.configPath,
    imported: nextImported,
  }

  for (const key of VIBEMUX_YML_IMPORTED_FIELD_KEYS) {
    if (key === 'ports') {
      const currentValue = current.ports
      const importedValue = nextImported.ports
      const hasOverride = previousImported
        ? JSON.stringify(normalizeEnvironmentPorts(currentValue)) !== JSON.stringify(normalizeEnvironmentPorts(previousImported.ports))
        : normalizeEnvironmentPorts(currentValue).length > 0
      merged.ports = hasOverride ? currentValue : importedValue
      continue
    }

    const currentValue = current[key]
    const importedValue = nextImported[key]
    const hasOverride = previousImported
      ? normalizeTemplateValue(currentValue) !== normalizeTemplateValue(previousImported[key])
      : normalizeTemplateValue(currentValue) !== ''
    merged[key] = hasOverride ? currentValue : importedValue
  }

  return merged
}

const resolveTemplateValue = (
  token: string,
  context: {
    environment: { slug: string }
    project: { name: string; slug: string }
    worktree: { unique_id: number; name: string; path: string }
  },
) => {
  if (token === 'environment.slug') return context.environment.slug
  if (token === 'worktree.unique_id') return context.worktree.unique_id
  if (token === 'worktree.name') return context.worktree.name
  if (token === 'worktree.path') return context.worktree.path
  if (token === 'project.name') return context.project.name
  if (token === 'project.slug') return context.project.slug
  return ''
}

const resolveMathOperand = (
  token: string,
  context: {
    environment: { slug: string }
    project: { name: string; slug: string }
    worktree: { unique_id: number; name: string; path: string }
  },
) => {
  if (/^-?\d+$/.test(token)) {
    return Number(token)
  }

  const resolved = resolveTemplateValue(token, context)
  if (typeof resolved === 'number') {
    return resolved
  }

  const numeric = Number(resolved)
  return Number.isFinite(numeric) ? numeric : 0
}

const renderExpression = (
  expression: string,
  context: {
    environment: { slug: string }
    project: { name: string; slug: string }
    worktree: { unique_id: number; name: string; path: string }
  },
) => {
  const tokens = expression.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) {
    return ''
  }
  if (tokens.length === 1) {
    return String(resolveTemplateValue(tokens[0], context))
  }
  if (tokens.length === 3) {
    const [operator, leftToken, rightToken] = tokens
    const left = resolveMathOperand(leftToken, context)
    const right = resolveMathOperand(rightToken, context)
    if (operator === 'add') return String(left + right)
    if (operator === 'sub') return String(left - right)
    if (operator === 'mul') return String(left * right)
  }

  return ''
}

export const buildEnvironmentWorktreeName = (session: Pick<WorkspaceSession, 'branchName' | 'title' | 'worktreeUniqueId'>) => {
  const base = sanitizeWorktreeName(session.branchName.split('/').pop() || session.title)
  return session.worktreeUniqueId ? `${base}-${session.worktreeUniqueId}` : base
}

type ProjectCommandFieldsSource = Pick<Project, 'environmentTemplate'>

export const resolveProjectEnvironmentCommandFields = (
  project?: ProjectCommandFieldsSource | null,
  workspaceEnvironmentTemplate?: ProjectEnvironmentTemplate | null,
) => {
  const template = resolveEffectiveProjectEnvironmentTemplate({
    project,
    workspaceEnvironmentTemplate,
  })

  return {
    installCommand: normalizeTemplateString(template?.installCommand) || undefined,
    buildCommand: normalizeTemplateString(template?.buildCommand) || undefined,
    testCommand: normalizeTemplateString(template?.testCommand) || undefined,
    lintCommand: normalizeTemplateString(template?.lintCommand) || undefined,
    branchNamePattern: normalizeTemplateString(template?.branchNamePattern) || undefined,
  }
}

export const hasProjectEnvironmentCommandFields = (
  commands: ReturnType<typeof resolveProjectEnvironmentCommandFields>,
) => {
  return Boolean(
    commands.installCommand
    || commands.buildCommand
    || commands.testCommand
    || commands.lintCommand
    || commands.branchNamePattern,
  )
}

export const describeProjectEnvironmentCommands = (project?: ProjectCommandFieldsSource | null) => {
  const commands = resolveProjectEnvironmentCommandFields(project)

  return [
    commands.installCommand ? `install: ${commands.installCommand}` : null,
    commands.buildCommand ? `build: ${commands.buildCommand}` : null,
    commands.testCommand ? `test: ${commands.testCommand}` : null,
    commands.lintCommand ? `lint: ${commands.lintCommand}` : null,
    commands.branchNamePattern ? `branch: ${commands.branchNamePattern}` : null,
  ].filter((item): item is string => Boolean(item))
}

export const hasProjectEnvironmentTemplateContent = (template?: ProjectEnvironmentTemplate | null) => {
  if (!template) {
    return false
  }

  return Boolean(
    normalizeTemplateString(template.installCommand)
    || normalizeTemplateString(template.buildCommand)
    || normalizeTemplateString(template.testCommand)
    || normalizeTemplateString(template.lintCommand)
    || normalizeTemplateString(template.branchNamePattern)
    || normalizeTemplateString(template.startCommandTemplate)
    || normalizeTemplateString(template.stopCommandTemplate)
    || normalizeTemplateString(template.nukeCommandTemplate)
    || normalizeTemplateString(template.appPort)
    || normalizeTemplateString(template.healthPath)
    || normalizeTemplateString(template.logsCommandTemplate)
    || normalizeEnvironmentPorts(template.ports).length > 0
    || normalizePreviewDomainBindings(template.previewDomainBindings).length > 0
  )
}

export const toProjectCommandPresetFromEnvironment = (project?: ProjectCommandFieldsSource | null) => {
  const commands = resolveProjectEnvironmentCommandFields(project)
  if (!hasProjectEnvironmentCommandFields(commands)) {
    return undefined
  }

  return {
    id: 'environment-template',
    name: '环境模板',
    ...commands,
  }
}

export const renderProjectEnvironmentTemplate = (template: string, params: {
  project: Pick<Project, 'name' | 'gitUrl'>
  session: Pick<WorkspaceSession, 'branchName' | 'title' | 'worktreeUniqueId'>
  cwd: string
}) => {
  const uniqueId = params.session.worktreeUniqueId
  if (!uniqueId || !Number.isFinite(uniqueId)) {
    return ''
  }

  const projectSlug = sanitizeTemplateIdentifier(getWorkspaceRepoName(params.project), 'project')
  const context = {
    environment: {
      slug: buildEnvironmentSlug(projectSlug, uniqueId),
    },
    project: {
      name: params.project.name,
      slug: projectSlug,
    },
    worktree: {
      unique_id: uniqueId,
      name: buildEnvironmentWorktreeName(params.session),
      path: params.cwd,
    },
  }

  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression: string) => renderExpression(expression, context))
}

export const resolveProjectEnvironmentPreview = (params: {
  project: Project
  session?: Pick<WorkspaceSession, 'branchName' | 'title' | 'worktreeUniqueId'> | null
  cwd?: string
  workspaceEnvironmentTemplate?: ProjectEnvironmentTemplate | null
}) => {
  const template = resolveEffectiveProjectEnvironmentTemplate({
    project: params.project,
    workspaceEnvironmentTemplate: params.workspaceEnvironmentTemplate,
  })
  const session = params.session
  if (
    !template
    || !session
    || !params.cwd?.trim()
    || (
      !normalizeTemplateString(template.installCommand)
      && !normalizeTemplateString(template.startCommandTemplate)
      && !normalizeTemplateString(template.stopCommandTemplate)
      && !normalizeTemplateString(template.logsCommandTemplate)
      && !normalizeTemplateString(template.appPort)
      && !normalizeTemplateString(template.healthPath)
      && !normalizeTemplateString(template.nukeCommandTemplate)
      && normalizeEnvironmentPorts(template.ports).length === 0
      && normalizePreviewDomainBindings(template.previewDomainBindings).length === 0
    )
  ) {
    return null
  }

  const cwd = params.cwd.trim()
  const renderedAppPort = template.appPort
    ? normalizePreviewPort(renderProjectEnvironmentTemplate(template.appPort, { project: params.project, session, cwd }).trim())
    : undefined
  const previewDomainBindings = normalizePreviewDomainBindings(template.previewDomainBindings)
  const renderedPortBindings = normalizeEnvironmentPorts(template.ports)
    .map((binding) => {
      const port = normalizePreviewPort(renderProjectEnvironmentTemplate(binding.port, { project: params.project, session, cwd }).trim())
      if (!port) {
        return null
      }
      return {
        id: binding.id,
        domain: binding.domain,
        port,
        note: binding.note,
        type: binding.type,
      }
    })
    .filter((binding): binding is NonNullable<typeof binding> => Boolean(binding))
  const configuredBindings = [...renderedPortBindings, ...previewDomainBindings]
  const effectivePreviewDomainBindings = renderedAppPort && !configuredBindings.some((binding) => binding.port === renderedAppPort)
    ? [
        {
          id: 'app',
          domain: undefined,
          port: renderedAppPort,
          note: undefined,
          type: 'generated' as const,
        },
        ...configuredBindings,
      ]
    : configuredBindings
  const dedupedPreviewDomainBindings = Array.from(
    effectivePreviewDomainBindings.reduce((map, binding) => {
      const existing = map.get(binding.port)
      if (!existing || scoreResolvedPreviewBinding(binding) > scoreResolvedPreviewBinding(existing)) {
        map.set(binding.port, binding)
      }
      return map
    }, new Map<number, typeof effectivePreviewDomainBindings[number]>()),
  ).map(([, binding]) => binding)
  const primaryPort = renderedAppPort ?? dedupedPreviewDomainBindings[0]?.port
  const resolvedDomainBindings = dedupedPreviewDomainBindings.map((binding) => ({
    ...binding,
    appUrl: buildLocalPreviewUrlFromPort(binding.port),
    primary: binding.port === primaryPort,
  }))
  const primaryDomainBinding = resolvedDomainBindings.find((binding) => binding.primary) ?? resolvedDomainBindings[0]
  const appUrl = primaryDomainBinding?.appUrl || (renderedAppPort ? buildLocalPreviewUrlFromPort(renderedAppPort) : undefined)
  const additionalAppUrls = resolvedDomainBindings
    .filter((binding) => binding !== primaryDomainBinding)
    .map((binding) => binding.appUrl)
  const healthPath = normalizeHealthPath(template.healthPath)

  return {
    installCommand: template.installCommand
      ? renderProjectEnvironmentTemplate(template.installCommand, { project: params.project, session, cwd })
      : undefined,
    startCommand: template.startCommandTemplate
      ? renderProjectEnvironmentTemplate(template.startCommandTemplate, { project: params.project, session, cwd })
      : '',
    stopCommand: template.stopCommandTemplate
      ? renderProjectEnvironmentTemplate(template.stopCommandTemplate, { project: params.project, session, cwd })
      : '',
    nukeCommand: template.nukeCommandTemplate
      ? renderProjectEnvironmentTemplate(template.nukeCommandTemplate, { project: params.project, session, cwd })
      : undefined,
    healthUrl: renderedAppPort ? buildLocalHealthUrl(renderedAppPort, healthPath) : undefined,
    appUrl,
    logsCommand: template.logsCommandTemplate
      ? renderProjectEnvironmentTemplate(template.logsCommandTemplate, { project: params.project, session, cwd })
      : undefined,
    additionalAppUrls,
    domainBindings: resolvedDomainBindings,
  }
}
