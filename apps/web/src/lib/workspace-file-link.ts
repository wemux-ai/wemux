const FILE_PROTOCOL_PREFIX = /^file:\/\//i
const VSCODE_FILE_PROTOCOL_PREFIX = /^vscode:\/\/file\/?/i
const EXTERNAL_PROTOCOL_PREFIX = /^(https?:|data:|blob:|mailto:|tel:|javascript:)/i
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/
const WINDOWS_DRIVE_ROOT = /^[A-Za-z]:\/$/
const FILE_EXTENSION_SUFFIX = /\.[A-Za-z0-9_-]{1,16}$/
const OBVIOUS_POSIX_ROOT_PREFIXES = [
  '/Users/',
  '/home/',
  '/var/',
  '/tmp/',
  '/private/',
  '/Volumes/',
  '/opt/',
  '/etc/',
  '/srv/',
  '/mnt/',
  '/root/',
] as const

const decodeLinkValue = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const stripWorkspaceFileLineSuffix = (value: string) => value.replace(/(?::\d+(?::\d+)?)$/, '')

const sanitizeWorkspaceFileLinkHref = (href: string) => {
  let normalized = decodeLinkValue(href.trim())
  if (!normalized) {
    return ''
  }

  if (FILE_PROTOCOL_PREFIX.test(normalized)) {
    normalized = normalized.replace(FILE_PROTOCOL_PREFIX, '')
  } else if (VSCODE_FILE_PROTOCOL_PREFIX.test(normalized)) {
    normalized = normalized.replace(VSCODE_FILE_PROTOCOL_PREFIX, '')
  } else if (EXTERNAL_PROTOCOL_PREFIX.test(normalized)) {
    return ''
  }

  normalized = normalized
    .replace(/^<|>$/g, '')
    .split('#', 1)[0]
    .split('?', 1)[0]
    .trim()

  if (!normalized) {
    return ''
  }

  if (/^\/[A-Za-z]:\//.test(normalized)) {
    normalized = normalized.slice(1)
  }

  if (!normalized.startsWith('/') && !WINDOWS_DRIVE_PATH.test(normalized) && href.trim().startsWith('/')) {
    normalized = `/${normalized}`
  }

  return stripWorkspaceFileLineSuffix(normalized)
}

const splitWorkspacePathSegments = (value: string) => {
  const trimmed = value.trim().replace(/\\/g, '/')
  if (!trimmed) {
    return {
      absolute: false,
      drive: '',
      segments: [] as string[],
    }
  }

  if (/^[A-Za-z]:$/.test(trimmed)) {
    return {
      absolute: true,
      drive: trimmed,
      segments: [] as string[],
    }
  }

  const absolute = trimmed.startsWith('/') || WINDOWS_DRIVE_PATH.test(trimmed)
  const parts = trimmed.split('/')
  const firstPart = parts.find((part) => part.length > 0) ?? ''
  const drive = WINDOWS_DRIVE_PATH.test(trimmed) ? firstPart : ''
  const segments: string[] = []

  for (const part of parts) {
    if (!part || part === '.') {
      continue
    }

    if (part === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') {
        segments.pop()
      } else if (!absolute) {
        segments.push(part)
      }
      continue
    }

    segments.push(part)
  }

  return {
    absolute,
    drive,
    segments,
  }
}

const getWorkspaceFileBasename = (value: string) => {
  const normalized = normalizeWorkspaceFilePath(value)
  if (!normalized) {
    return ''
  }

  return normalized.split('/').filter(Boolean).pop() || normalized
}

const isLikelyAbsoluteWorkspaceFilePath = (value: string) => {
  const normalized = normalizeWorkspaceFilePath(value)
  if (!normalized) {
    return false
  }

  if (WINDOWS_DRIVE_ROOT.test(normalized) || WINDOWS_DRIVE_PATH.test(normalized)) {
    return true
  }

  if (!normalized.startsWith('/')) {
    return false
  }

  if (OBVIOUS_POSIX_ROOT_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true
  }

  return FILE_EXTENSION_SUFFIX.test(getWorkspaceFileBasename(normalized))
}

export const normalizeWorkspaceFilePath = (value: string) => {
  const { absolute, drive, segments } = splitWorkspacePathSegments(value)
  if (drive) {
    const [, ...rest] = segments
    return rest.length > 0 ? `${drive}/${rest.join('/')}` : `${drive}/`
  }

  if (absolute) {
    return segments.length > 0 ? `/${segments.join('/')}` : '/'
  }

  return segments.join('/')
}

export const getWorkspaceFileParentPath = (value: string) => {
  const normalized = normalizeWorkspaceFilePath(value)
  if (!normalized || normalized === '/' || WINDOWS_DRIVE_ROOT.test(normalized)) {
    return normalized
  }

  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
  const separatorIndex = trimmed.lastIndexOf('/')
  if (separatorIndex < 0) {
    return ''
  }

  if (separatorIndex === 0) {
    return '/'
  }

  const candidate = trimmed.slice(0, separatorIndex)
  if (/^[A-Za-z]:$/.test(candidate)) {
    return `${candidate}/`
  }

  return candidate
}

export const isWorkspaceFilePathInsideRoot = (rootPath: string, filePath: string) => {
  const normalizedRootPath = normalizeWorkspaceFilePath(rootPath)
  const normalizedFilePath = normalizeWorkspaceFilePath(filePath)
  if (!normalizedRootPath || !normalizedFilePath) {
    return false
  }

  if (normalizedRootPath === normalizedFilePath) {
    return true
  }

  if (normalizedRootPath === '/') {
    return normalizedFilePath.startsWith('/')
  }

  return normalizedFilePath.startsWith(
    normalizedRootPath.endsWith('/')
      ? normalizedRootPath
      : `${normalizedRootPath}/`,
  )
}

const normalizeWorkspaceCandidateRoots = (candidateRootPaths: string[]) => {
  const seen = new Set<string>()
  const normalizedRoots: string[] = []

  for (const candidateRootPath of candidateRootPaths) {
    const normalizedCandidateRootPath = normalizeWorkspaceFilePath(candidateRootPath)
    if (!normalizedCandidateRootPath || seen.has(normalizedCandidateRootPath)) {
      continue
    }

    seen.add(normalizedCandidateRootPath)
    normalizedRoots.push(normalizedCandidateRootPath)
  }

  return normalizedRoots
}

const isWorkspaceFilePathInsideAnyRoot = (rootPaths: string[], filePath: string) => {
  return normalizeWorkspaceCandidateRoots(rootPaths)
    .some((rootPath) => isWorkspaceFilePathInsideRoot(rootPath, filePath))
}

const resolveWorkspaceHomeRootPath = (candidatePaths: string[]) => {
  for (const candidatePath of candidatePaths) {
    const normalizedCandidatePath = normalizeWorkspaceFilePath(candidatePath)
    if (!normalizedCandidatePath) {
      continue
    }

    const homeRootMatch = normalizedCandidatePath.match(/^((?:\/Users|\/home)\/[^/]+|\/root)(?:\/|$)/)
    if (homeRootMatch?.[1]) {
      return homeRootMatch[1]
    }
  }

  return ''
}

export const pickWorkspaceFileRootPath = (
  filePath: string,
  candidateRootPaths: string[],
  fallbackRootPath?: string,
) => {
  const normalizedFilePath = normalizeWorkspaceFilePath(filePath)
  const normalizedCandidateRootPaths = normalizeWorkspaceCandidateRoots([
    ...candidateRootPaths,
    fallbackRootPath || '',
  ])

  const matchedRootPath = normalizedCandidateRootPaths
    .filter((candidateRootPath) => isWorkspaceFilePathInsideRoot(candidateRootPath, normalizedFilePath))
    .sort((left, right) => right.length - left.length)[0]

  if (matchedRootPath) {
    return matchedRootPath
  }

  return getWorkspaceFileParentPath(normalizedFilePath) || normalizedFilePath
}

export const listWorkspaceAncestorDirectories = (rootPath: string, filePath: string) => {
  const normalizedRootPath = normalizeWorkspaceFilePath(rootPath)
  const normalizedFilePath = normalizeWorkspaceFilePath(filePath)
  if (!isWorkspaceFilePathInsideRoot(normalizedRootPath, normalizedFilePath)) {
    return []
  }

  const ancestorDirectories: string[] = []
  let currentDirectoryPath = getWorkspaceFileParentPath(normalizedFilePath)
  while (
    currentDirectoryPath
    && currentDirectoryPath !== normalizedRootPath
    && currentDirectoryPath !== '/'
    && !WINDOWS_DRIVE_ROOT.test(currentDirectoryPath)
  ) {
    ancestorDirectories.unshift(currentDirectoryPath)
    const nextDirectoryPath = getWorkspaceFileParentPath(currentDirectoryPath)
    if (!nextDirectoryPath || nextDirectoryPath === currentDirectoryPath) {
      break
    }
    currentDirectoryPath = nextDirectoryPath
  }

  return ancestorDirectories
}

export const isLikelyWorkspaceFileLinkHref = (href?: string | null) => {
  if (!href) {
    return false
  }

  const normalizedHref = sanitizeWorkspaceFileLinkHref(href)
  if (!normalizedHref) {
    return false
  }

  if (isLikelyAbsoluteWorkspaceFilePath(normalizedHref)) {
    return true
  }

  if (normalizedHref.startsWith('/')) {
    return FILE_EXTENSION_SUFFIX.test(getWorkspaceFileBasename(normalizedHref))
  }

  return normalizedHref.startsWith('./')
    || normalizedHref.startsWith('../')
    || normalizedHref.startsWith('~/')
    || normalizedHref.includes('/')
    || FILE_EXTENSION_SUFFIX.test(getWorkspaceFileBasename(normalizedHref))
}

export const resolveWorkspaceFileLinkPath = ({
  href,
  baseDirectoryPath,
  candidateRootPaths = [],
}: {
  href?: string | null
  baseDirectoryPath?: string
  candidateRootPaths?: string[]
}) => {
  if (!href) {
    return null
  }

  const normalizedHref = sanitizeWorkspaceFileLinkHref(href)
  if (!normalizedHref || !isLikelyWorkspaceFileLinkHref(href)) {
    return null
  }

  const normalizedCandidateRootPaths = normalizeWorkspaceCandidateRoots(candidateRootPaths)
  const normalizedBaseDirectoryPath = normalizeWorkspaceFilePath(baseDirectoryPath || '')
  const allowedRootPaths = normalizeWorkspaceCandidateRoots([
    normalizedBaseDirectoryPath,
    ...normalizedCandidateRootPaths,
  ])
  const preferredCandidateRootPath = [...normalizedCandidateRootPaths].sort((left, right) => right.length - left.length)[0] || ''
  if (normalizedHref.startsWith('~/')) {
    const homeRootPath = resolveWorkspaceHomeRootPath([
      baseDirectoryPath || '',
      ...normalizedCandidateRootPaths,
    ])
    if (!homeRootPath) {
      return null
    }

    const resolvedHomePath = normalizeWorkspaceFilePath(`${homeRootPath}/${normalizedHref.slice(2)}`)
    if (allowedRootPaths.length > 0 && !isWorkspaceFilePathInsideAnyRoot(allowedRootPaths, resolvedHomePath)) {
      return null
    }

    return resolvedHomePath
  }

  if (normalizedHref.startsWith('/') || WINDOWS_DRIVE_ROOT.test(normalizedHref) || WINDOWS_DRIVE_PATH.test(normalizedHref)) {
    if (allowedRootPaths.length === 0) {
      return isLikelyAbsoluteWorkspaceFilePath(normalizedHref)
        ? normalizeWorkspaceFilePath(normalizedHref)
        : null
    }

    return isWorkspaceFilePathInsideAnyRoot(allowedRootPaths, normalizedHref)
      ? normalizeWorkspaceFilePath(normalizedHref)
      : null
  }

  const basePath = normalizedBaseDirectoryPath && (
    normalizedCandidateRootPaths.length === 0
    || isWorkspaceFilePathInsideAnyRoot(normalizedCandidateRootPaths, normalizedBaseDirectoryPath)
  )
    ? normalizedBaseDirectoryPath
    : preferredCandidateRootPath || normalizedBaseDirectoryPath
  if (!basePath) {
    return null
  }

  const resolvedRelativePath = normalizeWorkspaceFilePath(`${basePath}/${normalizedHref}`)
  if (allowedRootPaths.length > 0 && !isWorkspaceFilePathInsideAnyRoot(allowedRootPaths, resolvedRelativePath)) {
    return null
  }

  return resolvedRelativePath
}
