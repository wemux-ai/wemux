const AGENT_AVATAR_ACCENTS = [
  'from-emerald-400/90 via-teal-300/80 to-sky-400/90',
  'from-violet-400/90 via-fuchsia-300/80 to-rose-400/90',
  'from-amber-300/90 via-orange-300/80 to-red-400/90',
  'from-cyan-300/90 via-blue-300/80 to-indigo-400/90',
  'from-lime-300/90 via-emerald-300/80 to-cyan-400/90',
  'from-pink-300/90 via-rose-300/80 to-orange-300/90',
]

export const BUILT_IN_AGENT_AVATARS = [
  { id: 'engineering', labelKey: 'agents.custom.detail.builtInAvatars.portrait01', url: '/agents/avatars/agent-01.png' },
  { id: 'design', labelKey: 'agents.custom.detail.builtInAvatars.portrait02', url: '/agents/avatars/agent-02.png' },
  { id: 'research', labelKey: 'agents.custom.detail.builtInAvatars.portrait03', url: '/agents/avatars/agent-03.png' },
  { id: 'product', labelKey: 'agents.custom.detail.builtInAvatars.portrait04', url: '/agents/avatars/agent-04.png' },
  { id: 'testing', labelKey: 'agents.custom.detail.builtInAvatars.portrait05', url: '/agents/avatars/agent-05.png' },
  { id: 'docs', labelKey: 'agents.custom.detail.builtInAvatars.portrait06', url: '/agents/avatars/agent-06.png' },
  { id: 'ops', labelKey: 'agents.custom.detail.builtInAvatars.portrait07', url: '/agents/avatars/agent-07.png' },
  { id: 'review', labelKey: 'agents.custom.detail.builtInAvatars.portrait08', url: '/agents/avatars/agent-08.png' },
  { id: 'portrait-09', labelKey: 'agents.custom.detail.builtInAvatars.portrait09', url: '/agents/avatars/agent-09.png' },
  { id: 'portrait-10', labelKey: 'agents.custom.detail.builtInAvatars.portrait10', url: '/agents/avatars/agent-10.png' },
  { id: 'portrait-11', labelKey: 'agents.custom.detail.builtInAvatars.portrait11', url: '/agents/avatars/agent-11.png' },
  { id: 'portrait-12', labelKey: 'agents.custom.detail.builtInAvatars.portrait12', url: '/agents/avatars/agent-12.png' },
  { id: 'portrait-13', labelKey: 'agents.custom.detail.builtInAvatars.portrait13', url: '/agents/avatars/agent-13.png' },
  { id: 'portrait-14', labelKey: 'agents.custom.detail.builtInAvatars.portrait14', url: '/agents/avatars/agent-14.png' },
  { id: 'portrait-15', labelKey: 'agents.custom.detail.builtInAvatars.portrait15', url: '/agents/avatars/agent-15.png' },
  { id: 'portrait-16', labelKey: 'agents.custom.detail.builtInAvatars.portrait16', url: '/agents/avatars/agent-16.png' },
  { id: 'portrait-17', labelKey: 'agents.custom.detail.builtInAvatars.portrait17', url: '/agents/avatars/agent-17.png' },
  { id: 'portrait-18', labelKey: 'agents.custom.detail.builtInAvatars.portrait18', url: '/agents/avatars/agent-18.png' },
  { id: 'portrait-19', labelKey: 'agents.custom.detail.builtInAvatars.portrait19', url: '/agents/avatars/agent-19.png' },
  { id: 'portrait-20', labelKey: 'agents.custom.detail.builtInAvatars.portrait20', url: '/agents/avatars/agent-20.png' },
] as const

const LEGACY_BUILT_IN_AGENT_AVATAR_URLS: Record<string, string> = {
  '/agents/avatars/agent-engineering.png': '/agents/avatars/agent-01.png',
  '/agents/avatars/agent-design.png': '/agents/avatars/agent-02.png',
  '/agents/avatars/agent-research.png': '/agents/avatars/agent-03.png',
  '/agents/avatars/agent-product.png': '/agents/avatars/agent-04.png',
  '/agents/avatars/agent-testing.png': '/agents/avatars/agent-05.png',
  '/agents/avatars/agent-docs.png': '/agents/avatars/agent-06.png',
  '/agents/avatars/agent-ops.png': '/agents/avatars/agent-07.png',
  '/agents/avatars/agent-review.png': '/agents/avatars/agent-08.png',
}

export type BuiltInAgentAvatarId = typeof BUILT_IN_AGENT_AVATARS[number]['id']

export const getBuiltInAgentAvatarUrl = (avatarId: BuiltInAgentAvatarId) => {
  return BUILT_IN_AGENT_AVATARS.find((avatar) => avatar.id === avatarId)?.url ?? BUILT_IN_AGENT_AVATARS[0].url
}

export const normalizeBuiltInAgentAvatarUrl = (url: string) => {
  const replacement = LEGACY_BUILT_IN_AGENT_AVATAR_URLS[url]
  if (replacement) {
    return replacement
  }

  if (!/^https?:\/\//.test(url)) {
    return url
  }

  try {
    const parsedUrl = new URL(url)
    const absoluteReplacement = LEGACY_BUILT_IN_AGENT_AVATAR_URLS[parsedUrl.pathname]
    if (!absoluteReplacement) {
      return url
    }

    parsedUrl.pathname = absoluteReplacement
    return parsedUrl.toString()
  } catch {
    return url
  }
}

const hashSeed = (seed: string) => {
  let hash = 0

  for (const character of seed) {
    hash = ((hash << 5) - hash) + character.charCodeAt(0)
    hash |= 0
  }

  return Math.abs(hash)
}

export const getAgentAvatarAccent = (seed: string) => {
  return AGENT_AVATAR_ACCENTS[hashSeed(seed) % AGENT_AVATAR_ACCENTS.length]
}
