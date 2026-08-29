// [INPUT]: 协作组织输入
// [OUTPUT]: 协作类型契约
// [POS]: 协作组织类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

/** 默认组织名后缀（当前）。 */
export const DEFAULT_ORG_NAME_SUFFIX = ' 的组织'

/** 历史默认组织名后缀（旧版叫"工作空间"），仅用于识别存量数据。 */
export const LEGACY_DEFAULT_ORG_NAME_SUFFIX = ' 的工作空间'

export const buildDefaultWorkspaceName = (userName?: string, email?: string) => {
  const baseName = userName?.trim() || email?.split('@')[0]?.trim() || '我的'
  return `${baseName}${DEFAULT_ORG_NAME_SUFFIX}`
}

const buildLegacyDefaultWorkspaceName = (userName?: string, email?: string) => {
  const baseName = userName?.trim() || email?.split('@')[0]?.trim() || '我的'
  return `${baseName}${LEGACY_DEFAULT_ORG_NAME_SUFFIX}`
}

export const isDefaultWorkspaceName = (
  workspaceName: string | undefined,
  userName?: string,
  email?: string,
) => {
  const normalizedWorkspaceName = workspaceName?.trim() || ''
  if (!normalizedWorkspaceName) {
    return false
  }

  return (
    normalizedWorkspaceName === buildDefaultWorkspaceName(userName, email)
    || normalizedWorkspaceName === buildLegacyDefaultWorkspaceName(userName, email)
  )
}
