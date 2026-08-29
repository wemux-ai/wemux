import { getIndexedMarketingPage } from '@shared/site-seo'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MarketingSection } from './marketing-page-layout'
import { getMarketingSiblingDocumentsByTopic, getMarketingTopicsForDocument, type MarketingContentDocument } from '../../lib/marketing-content'

export function MarketingContentPage({
  children,
  document,
}: {
  children?: React.ReactNode
  document: MarketingContentDocument
}) {
  const authorLine = document.authorUrl ? (
    <a className="underline decoration-white/20 underline-offset-4 transition hover:text-white hover:decoration-white/60" href={document.authorUrl} rel="author" target="_blank">
      {document.author}
    </a>
  ) : (
    document.author
  )

  return (
    <MarketingSection
      description={
        <>Published {document.publishedAt} · Updated {document.updatedAt} · By {authorLine}</>
      }
      title={document.heroTitle}
    >
      <div className="space-y-8">
        <div className="grid gap-4 border border-white/[0.08] bg-black/20 p-4 md:grid-cols-2">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Point of View</p>
            <p className="mt-2 text-sm leading-7 text-zinc-300">{document.pointOfView}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Key Claim</p>
            <p className="mt-2 text-sm leading-7 text-zinc-300">{document.keyClaim}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {getMarketingTopicsForDocument(document).map((topic) => (
            <a
              className="border border-white/[0.12] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300 transition hover:border-white/30 hover:text-white"
              href={`/topics/${topic.slug}`}
              key={topic.slug}
            >
              {topic.title}
            </a>
          ))}
        </div>
        <img
          alt={document.imageAlt}
          className="w-full border border-white/[0.08] bg-black/20 object-cover"
          loading="eager"
          src={document.imagePath}
        />
        <div className="marketing-markdown max-w-none text-sm leading-8 text-zinc-300">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{document.markdown}</ReactMarkdown>
        </div>
        {children}
      </div>
    </MarketingSection>
  )
}

export function MarketingRelatedLinks({ currentPath, relatedPaths }: { currentPath: string; relatedPaths: string[] }) {
  const relatedPages = relatedPaths
    .map((path) => getIndexedMarketingPage(path))
    .filter((page): page is NonNullable<ReturnType<typeof getIndexedMarketingPage>> => page !== null)
    .filter((page) => page.path !== currentPath)

  if (!relatedPages.length) {
    return null
  }

  return (
    <MarketingSection
      description="These pages keep the surrounding product story connected, which helps both readers and search engines navigate the topic cluster."
      title="Related pages"
    >
      <div className="flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-[0.18em]">
        {relatedPages.map((page) => (
          <a
            className="border border-white/[0.12] px-4 py-3 text-zinc-300 transition hover:border-white/30 hover:text-white"
            href={page.path}
            key={page.path}
          >
            {page.title}
          </a>
        ))}
        <a className="bg-white px-4 py-3 text-white transition hover:bg-zinc-200" href="/login">
          Book a demo
        </a>
      </div>
    </MarketingSection>
  )
}

export function MarketingTopicSiblingLinks({ document }: { document: MarketingContentDocument }) {
  const siblingDocuments = getMarketingSiblingDocumentsByTopic(document)

  if (!siblingDocuments.length) {
    return null
  }

  return (
    <MarketingSection
      description="These pages are discovered automatically from shared topics, so the internal linking graph grows with the content library instead of depending only on manual curation."
      title="More on this topic"
    >
      <div className="grid gap-4 md:grid-cols-2">
        {siblingDocuments.map((sibling) => (
          <article className="border border-white/[0.08] bg-black/25 p-5" key={sibling.path}>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{sibling.publishedAt}</p>
            <h3 className="mt-3 text-lg font-medium tracking-[-0.03em] text-white">
              <a className="transition hover:text-white" href={sibling.path}>
                {sibling.heroTitle}
              </a>
            </h3>
            <p className="mt-3 text-sm leading-7 text-zinc-400">{sibling.description}</p>
          </article>
        ))}
      </div>
    </MarketingSection>
  )
}

export function MarketingContentIndex({
  collectionLabel,
  documents,
}: {
  collectionLabel: string
  documents: MarketingContentDocument[]
}) {
  return (
    <MarketingSection
      description={`Browse ${collectionLabel.toLowerCase()} content that is organized for reusable SEO pages instead of one-off route components.`}
      title={`${collectionLabel} library`}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {documents.map((document) => (
          <article className="border border-white/[0.08] bg-black/25 p-5" key={document.path}>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {document.publishedAt}
            </p>
            <h2 className="mt-3 text-xl font-medium tracking-[-0.03em] text-white">
              <a className="transition hover:text-white" href={document.path}>
                {document.heroTitle}
              </a>
            </h2>
            <p className="mt-3 text-sm leading-7 text-zinc-400">{document.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {getMarketingTopicsForDocument(document).map((topic) => (
                <a
                  className="border border-white/[0.08] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400 transition hover:border-white/25 hover:text-zinc-200"
                  href={`/topics/${topic.slug}`}
                  key={topic.slug}
                >
                  {topic.title}
                </a>
              ))}
            </div>
          </article>
        ))}
      </div>
    </MarketingSection>
  )
}

export function MarketingFeaturedContent({
  documents,
  title,
}: {
  documents: MarketingContentDocument[]
  title: string
}) {
  if (!documents.length) {
    return null
  }

  const [featured, ...rest] = documents

  return (
    <MarketingSection
      description="Featured content gives you an editorial control layer on top of the automatic content graph."
      title={title}
    >
      <div className="space-y-4">
        <article className="border border-white/[0.08] bg-black/25 p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Featured</p>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.04em] text-white">
            <a className="transition hover:text-white" href={featured.path}>
              {featured.heroTitle}
            </a>
          </h2>
          <p className="mt-4 text-sm leading-8 text-zinc-400">{featured.description}</p>
        </article>
        {rest.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {rest.map((document) => (
              <article className="border border-white/[0.08] bg-black/20 p-5" key={document.path}>
                <h3 className="text-lg font-medium tracking-[-0.03em] text-white">
                  <a className="transition hover:text-white" href={document.path}>
                    {document.heroTitle}
                  </a>
                </h3>
                <p className="mt-3 text-sm leading-7 text-zinc-400">{document.description}</p>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </MarketingSection>
  )
}

export function MarketingTopicIndex({
  topics,
}: {
  topics: Array<{
    description: string
    documents: MarketingContentDocument[]
    slug: string
    title: string
  }>
}) {
  return (
    <MarketingSection
      description="Topic hubs create a stronger internal linking structure than isolated articles. They help readers and crawlers understand the product narrative around Wemux."
      title="Topic clusters"
    >
      <div className="grid gap-4 md:grid-cols-2">
        {topics.map((topic) => (
          <article className="border border-white/[0.08] bg-black/25 p-5" key={topic.slug}>
            <h2 className="text-xl font-medium tracking-[-0.03em] text-white">
              <a className="transition hover:text-white" href={`/topics/${topic.slug}`}>
                {topic.title}
              </a>
            </h2>
            <p className="mt-3 text-sm leading-7 text-zinc-400">{topic.description}</p>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {topic.documents.length} linked pages
            </p>
          </article>
        ))}
      </div>
    </MarketingSection>
  )
}
