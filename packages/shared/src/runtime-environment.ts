// [INPUT]: runtime 环境输入
// [OUTPUT]: 环境契约
// [POS]: runtime 环境类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type RuntimeEnvironmentDeliveryMode = 'process-env' | 'env-file'

export interface RuntimeEnvironmentConfig {
  mode: RuntimeEnvironmentDeliveryMode
  fileName?: string
  content: string
}

export interface RuntimeEnvironmentVariableEntry {
  key: string
  value: string
}

export interface RuntimeEnvironmentIssue {
  code: 'invalid-line' | 'invalid-key' | 'duplicate-key' | 'missing-file-name' | 'invalid-file-name'
  line: number
  message: string
}

export interface RuntimeEnvironmentParseResult {
  entries: RuntimeEnvironmentVariableEntry[]
  issues: RuntimeEnvironmentIssue[]
}

export interface RuntimeEnvironmentSummary {
  configured: true
  mode: RuntimeEnvironmentDeliveryMode
  fileName?: string
  variableCount: number
}

export interface RuntimeEnvironmentEffectiveSummary {
  mode: RuntimeEnvironmentDeliveryMode
  fileName?: string
  variableCount: number
  projectVariableCount: number
  workspaceVariableCount: number
  overrideCount: number
}

export interface RuntimeEnvironmentExecutionPayload {
  mode: RuntimeEnvironmentDeliveryMode
  variables: Record<string, string>
  fileName?: string
  fileContent?: string
}

export interface RuntimeEnvironmentResolutionResult {
  payload: RuntimeEnvironmentExecutionPayload
  projectSummary: RuntimeEnvironmentSummary | null
  workspaceSummary: RuntimeEnvironmentSummary | null
  effectiveSummary: RuntimeEnvironmentEffectiveSummary
}

/**
 * Runtime context for expanding `${{ ... }}` references during resolve.
 * Platform variables are only injected when explicitly referenced.
 */
export interface RuntimeEnvironmentReferenceContext {
  platformVariables?: Record<string, string | undefined>
  /**
   * When a platform variable is missing:
   * - `preserve` keeps the original `${{ ... }}` token (default for non-preview flows)
   * - `error` throws (used when starting preview after publicUrl is known)
   */
  missingPlatformVariable?: 'preserve' | 'error'
}

export const DEFAULT_RUNTIME_ENVIRONMENT_FILE_NAME = '.env'

const RUNTIME_ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const RUNTIME_ENVIRONMENT_REFERENCE_PATTERN = /\$\{\{\s*([^}]+?)\s*\}\}/g
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u

/** Roots that always resolve as platform context paths. */
// 品牌迁移兼容窗口：`${{ vibemux.* }}` 是存量模板使用的引用前缀，与新前缀并存
const PLATFORM_REFERENCE_ROOTS = new Set(['preview', 'node', 'task', 'workspaceSession', 'wemux', 'vibemux'])
/** Exact platform paths that share a prefix with user scoped refs (`project.KEY` / `workspace.KEY`). */
const PLATFORM_REFERENCE_EXACT = new Set(['project.id', 'workspace.id'])

const normalizeContent = (content: string) => content.replace(/\r\n/g, '\n')

const normalizeFileName = (fileName?: string) => {
  const trimmed = fileName?.trim()
  return trimmed ? trimmed : undefined
}

export const normalizeRuntimeEnvironmentConfig = (config?: RuntimeEnvironmentConfig | null): RuntimeEnvironmentConfig | null => {
  if (!config) {
    return null
  }

  return {
    mode: config.mode === 'env-file' ? 'env-file' : 'process-env',
    fileName: normalizeFileName(config.fileName),
    content: normalizeContent(config.content ?? ''),
  }
}

export const isValidRuntimeEnvironmentKey = (key: string) => {
  return RUNTIME_ENVIRONMENT_KEY_PATTERN.test(key.trim())
}

export const isValidRuntimeEnvironmentFileName = (fileName: string) => {
  const normalized = normalizeFileName(fileName)
  if (!normalized) {
    return false
  }

  if (normalized.startsWith('/') || normalized.startsWith('\\') || WINDOWS_ABSOLUTE_PATH_PATTERN.test(normalized)) {
    return false
  }

  const segments = normalized.split(/[\\/]+/).filter((segment) => segment.length > 0)
  if (segments.length === 0) {
    return false
  }

  return segments.every((segment) => segment !== '.' && segment !== '..')
}

export const parseRuntimeEnvironmentContent = (content: string): RuntimeEnvironmentParseResult => {
  const entries: RuntimeEnvironmentVariableEntry[] = []
  const issues: RuntimeEnvironmentIssue[] = []
  const seenKeys = new Set<string>()
  const lines = normalizeContent(content).split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const rawLine = lines[index] ?? ''
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trimStart() : trimmed
    const separatorIndex = withoutExport.indexOf('=')
    if (separatorIndex <= 0) {
      issues.push({
        code: 'invalid-line',
        line: lineNumber,
        message: `第 ${lineNumber} 行不是合法的 KEY=VALUE 格式。`,
      })
      continue
    }

    const key = withoutExport.slice(0, separatorIndex).trim()
    const value = withoutExport.slice(separatorIndex + 1)
    if (!isValidRuntimeEnvironmentKey(key)) {
      issues.push({
        code: 'invalid-key',
        line: lineNumber,
        message: `第 ${lineNumber} 行的变量名无效：${key || '(empty)'}`,
      })
      continue
    }

    if (seenKeys.has(key)) {
      issues.push({
        code: 'duplicate-key',
        line: lineNumber,
        message: `第 ${lineNumber} 行的变量名重复：${key}`,
      })
      continue
    }

    seenKeys.add(key)
    entries.push({ key, value })
  }

  return {
    entries,
    issues,
  }
}

export const validateRuntimeEnvironmentConfig = (config?: RuntimeEnvironmentConfig | null) => {
  const normalized = normalizeRuntimeEnvironmentConfig(config)
  if (!normalized) {
    return [] as RuntimeEnvironmentIssue[]
  }

  const issues = [...parseRuntimeEnvironmentContent(normalized.content).issues]
  if (normalized.mode === 'env-file') {
    if (!normalized.fileName) {
      issues.push({
        code: 'missing-file-name',
        line: 0,
        message: '文件写入模式必须提供文件名。',
      })
    } else if (!isValidRuntimeEnvironmentFileName(normalized.fileName)) {
      issues.push({
        code: 'invalid-file-name',
        line: 0,
        message: '环境变量文件名必须是项目目录内的相对路径，且不能包含 ..。',
      })
    }
  }

  return issues
}

export const renderRuntimeEnvironmentEntries = (entries: RuntimeEnvironmentVariableEntry[]) => {
  return entries.map((entry) => `${entry.key}=${entry.value}`).join('\n')
}

export const buildRuntimeEnvironmentVariables = (entries: RuntimeEnvironmentVariableEntry[]) => {
  return Object.fromEntries(entries.map((entry) => [entry.key, entry.value]))
}

export const mergeRuntimeEnvironmentEntries = (
  projectEntries: RuntimeEnvironmentVariableEntry[],
  workspaceEntries: RuntimeEnvironmentVariableEntry[],
) => {
  const mergedEntries = projectEntries.map((entry) => ({ ...entry }))
  const entryIndexByKey = new Map(mergedEntries.map((entry, index) => [entry.key, index] as const))
  let overrideCount = 0

  for (const entry of workspaceEntries) {
    const existingIndex = entryIndexByKey.get(entry.key)
    if (typeof existingIndex === 'number') {
      mergedEntries[existingIndex] = { ...entry }
      overrideCount += 1
      continue
    }

    entryIndexByKey.set(entry.key, mergedEntries.length)
    mergedEntries.push({ ...entry })
  }

  return {
    entries: mergedEntries,
    variables: buildRuntimeEnvironmentVariables(mergedEntries),
    overrideCount,
    projectVariableCount: projectEntries.length,
    workspaceVariableCount: workspaceEntries.length,
  }
}

export const getRuntimeEnvironmentSummary = (config?: RuntimeEnvironmentConfig | null): RuntimeEnvironmentSummary | null => {
  const normalized = normalizeRuntimeEnvironmentConfig(config)
  if (!normalized) {
    return null
  }

  return {
    configured: true,
    mode: normalized.mode,
    fileName: normalized.fileName,
    variableCount: parseRuntimeEnvironmentContent(normalized.content).entries.length,
  }
}

const normalizeReferencePath = (rawPath: string) => rawPath.trim()

const isPlatformReferencePath = (path: string) => {
  const legacyStripped = path.startsWith('vibemux.') ? path.slice('vibemux.'.length) : path
  const normalized = path.startsWith('wemux.') ? path.slice('wemux.'.length) : legacyStripped
  if (PLATFORM_REFERENCE_EXACT.has(normalized)) {
    return true
  }
  const root = normalized.split('.')[0] ?? ''
  return PLATFORM_REFERENCE_ROOTS.has(root)
}

const lookupPlatformVariable = (
  path: string,
  platformVariables?: Record<string, string | undefined>,
): string | undefined => {
  if (!platformVariables) {
    return undefined
  }

  const candidates = path.startsWith('vibemux.')
    ? [path, path.slice('wemux.'.length)]
    : path.startsWith('vibemux.')
      ? [path, path.slice('vibemux.'.length)]
      : [path, `wemux.${path}`, `vibemux.${path}`]

  for (const candidate of candidates) {
    if (!Object.prototype.hasOwnProperty.call(platformVariables, candidate)) {
      continue
    }
    const value = platformVariables[candidate]
    if (typeof value === 'string') {
      return value
    }
  }

  return undefined
}

const formatReferenceToken = (path: string) => `\${{ ${path} }}`

/**
 * Expand `${{ ... }}` references across merged project/workspace entries.
 * - `${{ KEY }}` uses effective (workspace-over-project) values
 * - `${{ project.KEY }}` / `${{ workspace.KEY }}` use scoped user values
 * - `${{ preview.* }}` / `${{ node.* }}` / `${{ wemux.* }}` use platform context
 */
export const resolveRuntimeEnvironmentReferenceEntries = (params: {
  projectEntries: RuntimeEnvironmentVariableEntry[]
  workspaceEntries: RuntimeEnvironmentVariableEntry[]
  mergedEntries: RuntimeEnvironmentVariableEntry[]
  referenceContext?: RuntimeEnvironmentReferenceContext
}): RuntimeEnvironmentVariableEntry[] => {
  const projectValues = buildRuntimeEnvironmentVariables(params.projectEntries)
  const workspaceValues = buildRuntimeEnvironmentVariables(params.workspaceEntries)
  const effectiveValues = buildRuntimeEnvironmentVariables(params.mergedEntries)
  const platformVariables = params.referenceContext?.platformVariables
  const missingPlatformVariable = params.referenceContext?.missingPlatformVariable ?? 'preserve'

  const resolvedByPath = new Map<string, string>()
  const resolvingPaths = new Set<string>()

  const resolveUserRawValue = (scope: 'effective' | 'project' | 'workspace', key: string, stackPath: string): string => {
    if (resolvingPaths.has(stackPath)) {
      throw new Error(`环境变量引用存在循环：${stackPath}`)
    }

    const cached = resolvedByPath.get(stackPath)
    if (cached !== undefined) {
      return cached
    }

    const raw = scope === 'project'
      ? projectValues[key]
      : scope === 'workspace'
        ? workspaceValues[key]
        : effectiveValues[key]

    if (raw === undefined) {
      if (scope === 'project') {
        throw new Error(`项目级环境变量不存在：${key}`)
      }
      if (scope === 'workspace') {
        throw new Error(`工作区级环境变量不存在：${key}`)
      }
      throw new Error(`环境变量不存在：${key}`)
    }

    resolvingPaths.add(stackPath)
    try {
      const resolved = expandReferenceValue(raw)
      resolvedByPath.set(stackPath, resolved)
      return resolved
    } finally {
      resolvingPaths.delete(stackPath)
    }
  }

  const resolveReferencePath = (rawPath: string): string => {
    const path = normalizeReferencePath(rawPath)
    if (!path) {
      throw new Error('环境变量引用路径不能为空。')
    }

    if (isPlatformReferencePath(path)) {
      const platformValue = lookupPlatformVariable(path, platformVariables)
      if (platformValue !== undefined) {
        return platformValue
      }
      if (missingPlatformVariable === 'error') {
        throw new Error(`平台环境变量不可用：${path}`)
      }
      return formatReferenceToken(path)
    }

    if (!path.includes('.')) {
      if (!isValidRuntimeEnvironmentKey(path)) {
        throw new Error(`环境变量引用无效：${path}`)
      }
      return resolveUserRawValue('effective', path, path)
    }

    if (path.startsWith('project.')) {
      const key = path.slice('project.'.length)
      if (!isValidRuntimeEnvironmentKey(key) || key.includes('.')) {
        throw new Error(`环境变量引用无效：${path}`)
      }
      return resolveUserRawValue('project', key, path)
    }

    if (path.startsWith('workspace.')) {
      const key = path.slice('workspace.'.length)
      if (!isValidRuntimeEnvironmentKey(key) || key.includes('.')) {
        throw new Error(`环境变量引用无效：${path}`)
      }
      return resolveUserRawValue('workspace', key, path)
    }

    throw new Error(`未知的环境变量引用：${path}`)
  }

  const expandReferenceValue = (value: string): string => {
    if (!value.includes('${{')) {
      return value
    }

    return value.replace(RUNTIME_ENVIRONMENT_REFERENCE_PATTERN, (_match, rawPath: string) => {
      return resolveReferencePath(rawPath)
    })
  }

  return params.mergedEntries.map((entry) => ({
    key: entry.key,
    value: resolveUserRawValue('effective', entry.key, entry.key),
  }))
}

export const resolveRuntimeEnvironmentExecution = (params: {
  projectConfig?: RuntimeEnvironmentConfig | null
  workspaceConfig?: RuntimeEnvironmentConfig | null
  referenceContext?: RuntimeEnvironmentReferenceContext
}): RuntimeEnvironmentResolutionResult | null => {
  const projectConfig = normalizeRuntimeEnvironmentConfig(params.projectConfig)
  const workspaceConfig = normalizeRuntimeEnvironmentConfig(params.workspaceConfig)
  if (!projectConfig && !workspaceConfig) {
    return null
  }

  const projectIssues = validateRuntimeEnvironmentConfig(projectConfig)
  if (projectIssues.length > 0) {
    throw new Error(projectIssues[0]?.message || '项目级环境变量配置无效。')
  }

  const workspaceIssues = validateRuntimeEnvironmentConfig(workspaceConfig)
  if (workspaceIssues.length > 0) {
    throw new Error(workspaceIssues[0]?.message || '工作区级环境变量配置无效。')
  }

  const projectEntries = projectConfig ? parseRuntimeEnvironmentContent(projectConfig.content).entries : []
  const workspaceEntries = workspaceConfig ? parseRuntimeEnvironmentContent(workspaceConfig.content).entries : []
  const merged = mergeRuntimeEnvironmentEntries(projectEntries, workspaceEntries)
  const deliverySource = workspaceConfig ?? projectConfig
  if (!deliverySource) {
    return null
  }

  const resolvedEntries = resolveRuntimeEnvironmentReferenceEntries({
    projectEntries,
    workspaceEntries,
    mergedEntries: merged.entries,
    referenceContext: params.referenceContext,
  })
  const resolvedVariables = buildRuntimeEnvironmentVariables(resolvedEntries)

  return {
    payload: {
      mode: deliverySource.mode,
      variables: resolvedVariables,
      fileName: deliverySource.mode === 'env-file' ? deliverySource.fileName : undefined,
      fileContent: deliverySource.mode === 'env-file' ? renderRuntimeEnvironmentEntries(resolvedEntries) : undefined,
    },
    projectSummary: getRuntimeEnvironmentSummary(projectConfig),
    workspaceSummary: getRuntimeEnvironmentSummary(workspaceConfig),
    effectiveSummary: {
      mode: deliverySource.mode,
      fileName: deliverySource.mode === 'env-file' ? deliverySource.fileName : undefined,
      variableCount: resolvedEntries.length,
      projectVariableCount: merged.projectVariableCount,
      workspaceVariableCount: merged.workspaceVariableCount,
      overrideCount: merged.overrideCount,
    },
  }
}
