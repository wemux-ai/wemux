/**
 * [INPUT]: Personal access token records produced by the server auth store.
 * [OUTPUT]: Stable personal access token API contracts shared by server and web.
 * [POS]: Cross-runtime auth contract; contains no token persistence or UI behavior.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

export type PersonalAccessToken = {
  id: string
  name: string
  token_prefix: string
  expires_at: string | null
  last_used_at: string | null
  created_at: string
}

export type PersonalAccessTokenCreateResponse = {
  id: string
  token: string
  prefix: string
  name: string
  expiresAt: string | null
  createdAt: string
}

export type PersonalAccessTokenListResponse = {
  tokens: PersonalAccessToken[]
}
