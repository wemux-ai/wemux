// [INPUT]: 主题输入
// [OUTPUT]: 主题库
// [POS]: 营销主题
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type MarketingTopic = {
  description: string
  slug: string
  title: string
}

export const marketingTopics = [
  {
    slug: 'ai-coding-delivery',
    title: 'AI Coding Delivery',
    description: 'Pages about turning AI coding output into routed, reviewable, production-facing delivery work.',
  },
  {
    slug: 'real-workstations',
    title: 'Real Workstations',
    description: 'Pages about why AI coding needs real machines, real repos, and accountable execution surfaces.',
  },
  {
    slug: 'persistent-ai-coding',
    title: 'Persistent AI Coding',
    description: 'Pages about keeping AI coding tasks alive across long-running workflows, time, and device changes.',
  },
  {
    slug: 'remote-handoff',
    title: 'Remote Handoff',
    description: 'Pages about moving active AI coding work between laptops, remote hosts, and cloud environments.',
  },
  {
    slug: 'multi-agent-orchestration',
    title: 'Multi-Agent Orchestration',
    description: 'Pages about coordinating multiple AI agents, routing tasks, and keeping execution reviewable.',
  },
  {
    slug: 'small-engineering-teams',
    title: 'Small Engineering Teams',
    description: 'Pages for small teams that need AI leverage without losing delivery control or execution visibility.',
  },
] satisfies MarketingTopic[]

const marketingTopicMap = new Map(marketingTopics.map((topic) => [topic.slug, topic] satisfies [string, MarketingTopic]))

export function listMarketingTopics() {
  return marketingTopics
}

export function getMarketingTopicBySlug(slug: string) {
  return marketingTopicMap.get(slug) ?? null
}
