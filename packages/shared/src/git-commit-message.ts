// [INPUT]: commit 消息输入
// [OUTPUT]: 生成/校验
// [POS]: Git commit 消息工具
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type WemuxAgentCoAuthorIdentity = {
  name?: string
  email?: string
}

export type WemuxAutomatedCommitIdentity = WemuxAgentCoAuthorIdentity & {
  agentCoAuthorName?: string
  agentCoAuthorEmail?: string
}

const DEFAULT_WEMUX_AGENT_CO_AUTHOR_NAME = 'Wemux'
const DEFAULT_WEMUX_AGENT_CO_AUTHOR_EMAIL = '289628643+wemux[bot]@users.noreply.github.com'

export const WEMUX_AGENT_CO_AUTHOR_TRAILER = `Co-authored-by: ${DEFAULT_WEMUX_AGENT_CO_AUTHOR_NAME} <${DEFAULT_WEMUX_AGENT_CO_AUTHOR_EMAIL}>`

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const normalizeIdentity = (identity?: WemuxAgentCoAuthorIdentity) => {
  const name = identity?.name?.trim()
  const email = identity?.email?.trim()
  return name && email ? { name, email } : undefined
}

const appendCoAuthorTrailer = (message: string, identity: WemuxAgentCoAuthorIdentity) => {
  const normalizedIdentity = normalizeIdentity(identity)
  if (!normalizedIdentity) {
    return message
  }

  const trailer = buildWemuxAgentCoAuthorTrailer(normalizedIdentity)
  if (!message.trim()) {
    return trailer
  }

  if (
    message.includes(trailer)
    || new RegExp(`^Co-authored-by: .+<${escapeRegex(normalizedIdentity.email)}>$`, 'm').test(message)
  ) {
    return message
  }

  return `${message}\n${trailer}`
}

export const buildWemuxAgentCoAuthorTrailer = (identity?: WemuxAgentCoAuthorIdentity) => {
  const name = identity?.name?.trim() || DEFAULT_WEMUX_AGENT_CO_AUTHOR_NAME
  const email = identity?.email?.trim() || DEFAULT_WEMUX_AGENT_CO_AUTHOR_EMAIL
  return `Co-authored-by: ${name} <${email}>`
}

export const resolveWemuxAutomatedCommitAuthor = (identity?: WemuxAutomatedCommitIdentity) => {
  return normalizeIdentity({
    name: identity?.agentCoAuthorName,
    email: identity?.agentCoAuthorEmail,
  }) ?? normalizeIdentity(identity)
}

export const appendWemuxAgentCoAuthorTrailer = (
  message: string,
  identity?: WemuxAgentCoAuthorIdentity,
) => {
  const normalizedMessage = message.trim()
  const trailer = buildWemuxAgentCoAuthorTrailer(identity)
  if (!normalizedMessage) {
    return trailer
  }

  const email = identity?.email?.trim()
  if (
    normalizedMessage.includes(trailer)
    || (email && new RegExp(`^Co-authored-by: .+<${escapeRegex(email)}>$`, 'm').test(normalizedMessage))
  ) {
    return normalizedMessage
  }

  return `${normalizedMessage}\n\n${trailer}`
}

export const appendWemuxCoAuthorTrailers = (
  message: string,
  identities: WemuxAgentCoAuthorIdentity[],
) => {
  const normalizedMessage = message.trim()
  const initialMessage = normalizedMessage || buildWemuxAgentCoAuthorTrailer()
  const [head, ...existingTrailerLines] = initialMessage.split(/\n(?=Co-authored-by: )/g)
  const trailerBlock = identities.reduce(
    (current, identity) => appendCoAuthorTrailer(current, identity),
    existingTrailerLines.join('\n').trim(),
  )

  if (!trailerBlock) {
    return head.trim()
  }

  return `${head.trim()}\n\n${trailerBlock}`
}

export const buildGitCommitSubjectFromReply = (reply: string, fallback: string) => {
  const firstLine = reply
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  if (!firstLine) {
    return fallback
  }

  const normalized = firstLine.replace(/[`#>*_~]/g, '').replace(/\s+/g, ' ').trim()
  return normalized.length > 72 ? normalized.slice(0, 72) : normalized
}

export const buildWemuxAgentCommitMessage = (params: {
  reply?: string
  fallback: string
  agentIdentity?: WemuxAgentCoAuthorIdentity
  userIdentity?: WemuxAgentCoAuthorIdentity
}) => {
  const subject = buildGitCommitSubjectFromReply(params.reply ?? '', params.fallback)
  const agentIdentity = normalizeIdentity(params.agentIdentity) ?? {
    name: DEFAULT_WEMUX_AGENT_CO_AUTHOR_NAME,
    email: DEFAULT_WEMUX_AGENT_CO_AUTHOR_EMAIL,
  }
  return appendWemuxCoAuthorTrailers(subject, [
    agentIdentity,
    params.userIdentity ?? {},
  ])
}
