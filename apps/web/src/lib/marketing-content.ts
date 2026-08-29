import { getMarketingContentEntryByCollectionSlug, getMarketingContentEntryByPath, listFeaturedMarketingContentEntriesByCollection, listPublishedMarketingContentEntries, listPublishedMarketingContentEntriesByCollection, listPublishedMarketingContentEntriesByTopic, type MarketingContentCollection, type MarketingContentEntry } from '@shared/marketing-content'
import { getMarketingTopicBySlug, listMarketingTopics } from '@shared/marketing-topics'

import blogCodexHandoffMarkdown from '../content/blog/codex-handoff-and-persistent-ai-coding.md?raw'
import blogAiCodingSurvivesSleepMarkdown from '../content/blog/ai-coding-needs-work-that-survives-sleep.md?raw'
import blogFromDemoToDeliveryMarkdown from '../content/blog/from-ai-demo-to-ai-delivery-stack.md?raw'
import blogBeyondChatMarkdown from '../content/blog/how-to-move-ai-coding-beyond-chat.md?raw'
import blogRemoteHandoffMarkdown from '../content/blog/why-remote-handoff-will-matter-for-ai-agents.md?raw'
import blogRealWorkstationsMarkdown from '../content/blog/why-ai-coding-needs-real-workstations.md?raw'
import compareAiChatVsDeliveryMarkdown from '../content/compare/ai-chat-vs-ai-delivery.md?raw'
import compareBestAiCodingPlatformForTeamsMarkdown from '../content/compare/best-ai-coding-platform-for-teams.md?raw'
import compareBestCursorAlternativeForTeamsMarkdown from '../content/compare/best-cursor-alternative-for-teams.md?raw'
import compareCodexHandoffAlternativeMarkdown from '../content/compare/codex-handoff-alternative.md?raw'
import compareWemuxVsClineKanbanMarkdown from '../content/compare/wemux-vs-cline-kanban.md?raw'
import compareWemuxVsClaudeCodeMarkdown from '../content/compare/wemux-vs-claude-code.md?raw'
import compareWemuxVsCodexMarkdown from '../content/compare/wemux-vs-codex.md?raw'
import compareWemuxVsCursorMarkdown from '../content/compare/wemux-vs-cursor.md?raw'
import compareWemuxVsDevinMarkdown from '../content/compare/wemux-vs-devin.md?raw'
import compareWemuxVsGitHubCopilotMarkdown from '../content/compare/wemux-vs-github-copilot.md?raw'
import compareWemuxVsOpenHandsMarkdown from '../content/compare/wemux-vs-openhands.md?raw'
import compareWemuxVsOrcaMarkdown from '../content/compare/wemux-vs-orca.md?raw'
import compareWemuxVsReplitMarkdown from '../content/compare/wemux-vs-replit.md?raw'
import useCaseAiCodingDeliveryMarkdown from '../content/use-cases/ai-coding-delivery.md?raw'
import useCaseRemoteTeamsMarkdown from '../content/use-cases/ai-coding-workflow-for-remote-teams.md?raw'
import useCaseContinueOnAnotherMachineMarkdown from '../content/use-cases/continue-ai-coding-work-on-another-machine.md?raw'
import useCaseManageMultipleAgentsMarkdown from '../content/use-cases/manage-multiple-ai-coding-agents.md?raw'
import useCaseSmallTeamsMarkdown from '../content/use-cases/small-engineering-teams.md?raw'

export type MarketingContentDocument = MarketingContentEntry & {
  markdown: string
}

const contentMarkdownByPath = new Map<string, string>([
  ['/blog/ai-coding-needs-work-that-survives-sleep', blogAiCodingSurvivesSleepMarkdown],
  ['/blog/codex-handoff-and-persistent-ai-coding', blogCodexHandoffMarkdown],
  ['/blog/from-ai-demo-to-ai-delivery-stack', blogFromDemoToDeliveryMarkdown],
  ['/blog/how-to-move-ai-coding-beyond-chat', blogBeyondChatMarkdown],
  ['/blog/why-remote-handoff-will-matter-for-ai-agents', blogRemoteHandoffMarkdown],
  ['/blog/why-ai-coding-needs-real-workstations', blogRealWorkstationsMarkdown],
  ['/compare/ai-chat-vs-ai-delivery', compareAiChatVsDeliveryMarkdown],
  ['/compare/best-ai-coding-platform-for-teams', compareBestAiCodingPlatformForTeamsMarkdown],
  ['/compare/best-cursor-alternative-for-teams', compareBestCursorAlternativeForTeamsMarkdown],
  ['/compare/codex-handoff-alternative', compareCodexHandoffAlternativeMarkdown],
  ['/compare/wemux-vs-cline-kanban', compareWemuxVsClineKanbanMarkdown],
  ['/compare/wemux-vs-claude-code', compareWemuxVsClaudeCodeMarkdown],
  ['/compare/wemux-vs-codex', compareWemuxVsCodexMarkdown],
  ['/compare/wemux-vs-cursor', compareWemuxVsCursorMarkdown],
  ['/compare/wemux-vs-devin', compareWemuxVsDevinMarkdown],
  ['/compare/wemux-vs-github-copilot', compareWemuxVsGitHubCopilotMarkdown],
  ['/compare/wemux-vs-openhands', compareWemuxVsOpenHandsMarkdown],
  ['/compare/wemux-vs-orca', compareWemuxVsOrcaMarkdown],
  ['/compare/wemux-vs-replit', compareWemuxVsReplitMarkdown],
  ['/use-cases/ai-coding-delivery', useCaseAiCodingDeliveryMarkdown],
  ['/use-cases/ai-coding-workflow-for-remote-teams', useCaseRemoteTeamsMarkdown],
  ['/use-cases/continue-ai-coding-work-on-another-machine', useCaseContinueOnAnotherMachineMarkdown],
  ['/use-cases/manage-multiple-ai-coding-agents', useCaseManageMultipleAgentsMarkdown],
  ['/use-cases/small-engineering-teams', useCaseSmallTeamsMarkdown],
])

const materializeDocument = (entry: MarketingContentEntry | null): MarketingContentDocument | null => {
  if (!entry) {
    return null
  }

  const markdown = contentMarkdownByPath.get(entry.path)
  if (!markdown) {
    return null
  }

  return {
    ...entry,
    markdown,
  }
}

export function listMarketingContentDocuments() {
  return listPublishedMarketingContentEntries()
    .map((entry) => materializeDocument(entry))
    .filter((entry): entry is MarketingContentDocument => entry !== null)
}

export function listMarketingContentDocumentsByCollection(collection: MarketingContentCollection) {
  return listPublishedMarketingContentEntriesByCollection(collection)
    .map((entry) => materializeDocument(entry))
    .filter((entry): entry is MarketingContentDocument => entry !== null)
}

export function getMarketingContentDocumentByCollectionSlug(collection: MarketingContentCollection, slug: string) {
  return materializeDocument(getMarketingContentEntryByCollectionSlug(collection, slug))
}

export function getMarketingContentDocumentByPath(path: string) {
  return materializeDocument(getMarketingContentEntryByPath(path))
}

export function listMarketingTopicDocuments(topicSlug: string) {
  return listPublishedMarketingContentEntriesByTopic(topicSlug)
    .map((entry) => materializeDocument(entry))
    .filter((entry): entry is MarketingContentDocument => entry !== null)
}

export function listFeaturedMarketingContentDocumentsByCollection(collection: MarketingContentCollection) {
  return listFeaturedMarketingContentEntriesByCollection(collection)
    .map((entry) => materializeDocument(entry))
    .filter((entry): entry is MarketingContentDocument => entry !== null)
}

export function listMarketingTopicsWithDocuments() {
  return listMarketingTopics().map((topic) => ({
    ...topic,
    documents: listMarketingTopicDocuments(topic.slug),
  }))
}

export function getMarketingTopicWithDocuments(slug: string) {
  const topic = getMarketingTopicBySlug(slug)
  if (!topic) {
    return null
  }

  return {
    ...topic,
    documents: listMarketingTopicDocuments(slug),
  }
}

export function getMarketingTopicsForDocument(document: MarketingContentDocument) {
  return document.topicSlugs
    .map((slug) => getMarketingTopicBySlug(slug))
    .filter((topic): topic is NonNullable<ReturnType<typeof getMarketingTopicBySlug>> => topic !== null)
}

export function getMarketingSiblingDocumentsByTopic(document: MarketingContentDocument, maxItems = 4) {
  const siblingMap = new Map<string, MarketingContentDocument>()

  for (const topicSlug of document.topicSlugs) {
    for (const sibling of listMarketingTopicDocuments(topicSlug)) {
      if (sibling.path === document.path) {
        continue
      }

      if (!siblingMap.has(sibling.path)) {
        siblingMap.set(sibling.path, sibling)
      }
    }
  }

  return [...siblingMap.values()].slice(0, maxItems)
}
