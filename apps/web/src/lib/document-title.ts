const DEV_TITLE_PREFIX = '【DEV】'
const DEFAULT_APP_TITLE = 'Wemux'

export function getDefaultDocumentTitle() {
  return withDevDocumentTitlePrefix(DEFAULT_APP_TITLE)
}

export function withDevDocumentTitlePrefix(title: string) {
  if (!import.meta.env.DEV) {
    return title
  }

  if (title.startsWith(DEV_TITLE_PREFIX)) {
    return title
  }

  return `${DEV_TITLE_PREFIX}${title}`
}
