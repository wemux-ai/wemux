// [INPUT]: Railway Account Token + GraphQL 查询参数
// [OUTPUT]: 归一化后的 Railway 事实（me/projects/environments/deployments）
// [POS]: Railway GraphQL API 客户端（fetch + Bearer，超时/错误归一化，分页）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

const RAILWAY_GRAPHQL_ENDPOINT = 'https://backboard.railway.com/graphql/v2'
const REQUEST_TIMEOUT_MS = 12_000
const PAGE_SIZE = 100

export type RailwayGraphqlResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string }

export type RailwayMe = {
  id: string
  name?: string
  email?: string
}

export type RailwayProjectFact = {
  id: string
  name: string
  description?: string
  primaryEnvironmentId?: string
  createdAt?: string
  updatedAt?: string
}

export type RailwayEnvironmentFact = {
  id: string
  name: string
  isEphemeral: boolean
  prNumber?: number
  prTitle?: string
  prRepo?: string
  branch?: string
  baseBranch?: string
  prCommentId?: number
  latestSuccessfulGitHubDeploymentId?: number
}

export type RailwayDeploymentFact = {
  id: string
  status: string
  url?: string
  staticUrl?: string
  createdAt?: string
  updatedAt?: string
  environmentId?: string
  serviceId?: string
  serviceName?: string
}

type PageInfo = {
  hasNextPage?: boolean
  endCursor?: string | null
}

type Edge<T> = { node?: T | null } | null | undefined

const createHeaders = (token: string) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
})

const executeGraphql = async <T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<RailwayGraphqlResult<T>> => {
  let response: Response
  try {
    response = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: createHeaders(token),
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof Error && (
      error.name === 'TimeoutError'
      || error.name === 'AbortError'
      || /timed out|timeout/i.test(error.message)
    )
    return {
      ok: false,
      status: 0,
      message: timedOut
        ? `Railway GraphQL 请求超时（>${REQUEST_TIMEOUT_MS}ms）。`
        : (error instanceof Error ? error.message : 'Railway GraphQL 请求失败。'),
    }
  }

  const rawText = await response.text().catch(() => '')

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      status: response.status,
      message: 'Railway Account Token 无效或已过期，请重新连接。',
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: `Railway GraphQL 请求失败（HTTP ${response.status}）。`,
    }
  }

  let payload: { data?: T; errors?: Array<{ message?: string }> }
  try {
    payload = JSON.parse(rawText) as { data?: T; errors?: Array<{ message?: string }> }
  } catch {
    return { ok: false, status: response.status, message: 'Railway GraphQL 响应格式不正确。' }
  }

  if (payload.errors && payload.errors.length > 0) {
    return {
      ok: false,
      status: response.status,
      message: payload.errors[0]?.message || 'Railway GraphQL 返回错误。',
    }
  }

  if (!payload.data) {
    return { ok: false, status: response.status, message: 'Railway GraphQL 响应缺少 data。' }
  }

  return { ok: true, data: payload.data }
}

const collectEdges = <T>(
  page: { edges?: Edge<T>[] },
): T[] => (page.edges ?? [])
  .map((edge) => edge?.node)
  .filter((node): node is T => Boolean(node))

export const fetchRailwayMe = async (token: string): Promise<RailwayGraphqlResult<RailwayMe>> => {
  const result = await executeGraphql<{ me?: RailwayMe | null }>(
    token,
    `query RailwayMe { me { id name email } }`,
  )
  if (!result.ok) return result
  if (!result.data.me) {
    return { ok: false, status: 401, message: 'Railway Account Token 无法识别账号。' }
  }
  return { ok: true, data: result.data.me }
}

const RAILWAY_PROJECTS_QUERY = `
  query RailwayProjects($first: Int, $after: String) {
    projects(first: $first, after: $after) {
      edges { node { id name description primaryEnvironmentId createdAt updatedAt } }
      pageInfo { hasNextPage endCursor }
    }
  }
`

export const listRailwayProjects = async (
  token: string,
): Promise<RailwayGraphqlResult<RailwayProjectFact[]>> => {
  const projects: RailwayProjectFact[] = []
  let cursor: string | undefined | null

  do {
    const result = await executeGraphql<{
      projects?: { edges?: Edge<RailwayProjectFact>[]; pageInfo?: PageInfo } | null
    }>(token, RAILWAY_PROJECTS_QUERY, { first: PAGE_SIZE, after: cursor ?? null })
    if (!result.ok) return result
    const page = result.data.projects
    projects.push(...collectEdges(page ?? {}))
    cursor = page?.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null
  } while (cursor)

  return { ok: true, data: projects }
}

const RAILWAY_ENVIRONMENTS_QUERY = `
  query RailwayEnvironments($projectId: String!, $first: Int, $after: String) {
    environments(projectId: $projectId, first: $first, after: $after) {
      edges {
        node {
          id name isEphemeral
          meta {
            prNumber prTitle prRepo branch baseBranch
            prCommentId latestSuccessfulGitHubDeploymentId
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

type EnvironmentMeta = {
  prNumber?: number | null
  prTitle?: string | null
  prRepo?: string | null
  branch?: string | null
  baseBranch?: string | null
  prCommentId?: number | null
  latestSuccessfulGitHubDeploymentId?: number | null
}

type EnvironmentNode = {
  id: string
  name?: string | null
  isEphemeral?: boolean | null
  meta?: EnvironmentMeta | null
}

export const listRailwayEnvironments = async (
  token: string,
  projectId: string,
): Promise<RailwayGraphqlResult<RailwayEnvironmentFact[]>> => {
  const environments: RailwayEnvironmentFact[] = []
  let cursor: string | undefined | null

  do {
    const result = await executeGraphql<{
      environments?: { edges?: Edge<EnvironmentNode>[]; pageInfo?: PageInfo } | null
    }>(token, RAILWAY_ENVIRONMENTS_QUERY, { projectId, first: PAGE_SIZE, after: cursor ?? null })
    if (!result.ok) return result
    const page = result.data.environments
    for (const node of collectEdges(page ?? {})) {
      environments.push({
        id: node.id,
        name: node.name?.trim() || 'environment',
        isEphemeral: Boolean(node.isEphemeral),
        prNumber: node.meta?.prNumber ?? undefined,
        prTitle: node.meta?.prTitle ?? undefined,
        prRepo: node.meta?.prRepo ?? undefined,
        branch: node.meta?.branch ?? undefined,
        baseBranch: node.meta?.baseBranch ?? undefined,
        prCommentId: node.meta?.prCommentId ?? undefined,
        latestSuccessfulGitHubDeploymentId: node.meta?.latestSuccessfulGitHubDeploymentId ?? undefined,
      })
    }
    cursor = page?.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null
  } while (cursor)

  return { ok: true, data: environments }
}

const RAILWAY_DEPLOYMENTS_QUERY = `
  query RailwayDeployments($input: DeploymentListInput!, $first: Int, $after: String) {
    deployments(input: $input, first: $first, after: $after) {
      edges {
        node {
          id status url staticUrl createdAt updatedAt
          environmentId serviceId
          service { name }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

type DeploymentNode = {
  id: string
  status?: string | null
  url?: string | null
  staticUrl?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  environmentId?: string | null
  serviceId?: string | null
  service?: { name?: string | null } | null
}

export const listRailwayDeployments = async (
  token: string,
  params: { projectId: string; environmentId?: string; serviceId?: string },
): Promise<RailwayGraphqlResult<RailwayDeploymentFact[]>> => {
  const deployments: RailwayDeploymentFact[] = []
  let cursor: string | undefined | null

  do {
    const result = await executeGraphql<{
      deployments?: { edges?: Edge<DeploymentNode>[]; pageInfo?: PageInfo } | null
    }>(token, RAILWAY_DEPLOYMENTS_QUERY, {
      input: {
        projectId: params.projectId,
        environmentId: params.environmentId ?? null,
        serviceId: params.serviceId ?? null,
      },
      first: PAGE_SIZE,
      after: cursor ?? null,
    })
    if (!result.ok) return result
    const page = result.data.deployments
    for (const node of collectEdges(page ?? {})) {
      deployments.push({
        id: node.id,
        status: node.status ?? 'UNKNOWN',
        url: node.url ?? undefined,
        staticUrl: node.staticUrl ?? undefined,
        createdAt: node.createdAt ?? undefined,
        updatedAt: node.updatedAt ?? undefined,
        environmentId: node.environmentId ?? undefined,
        serviceId: node.serviceId ?? undefined,
        serviceName: node.service?.name ?? undefined,
      })
    }
    cursor = page?.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null
  } while (cursor)

  return { ok: true, data: deployments }
}
