// [INPUT]: 站点 SEO 配置输入
// [OUTPUT]: 配置
// [POS]: 站点 SEO 配置
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export const siteOrigin = 'https://wemux.ai'
export const siteOgImageUrl = new URL('/og-image.png', siteOrigin).toString()
export const siteLogoUrl = new URL('/logo.png', siteOrigin).toString()
export const siteSeoLastUpdated = '2026-07-06'

export function buildPageUrl(path: string) {
  return new URL(path, siteOrigin).toString()
}
