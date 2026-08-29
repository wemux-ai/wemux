// [INPUT]: 无
// [OUTPUT]: 页面级商业 UI 区块渲染器注册表（usage 页积分面板等）——公开版空，私有版注册实现
// [POS]: 核心页面只经本 gate 渲染商业区块，不 import enterprise 组件。
//        公开版：无注册 → 渲染 null。
//        私有版：enterprise/index.ts 注册完整实现。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ReactNode } from 'react'

export type CommercialUiSectionId = 'usage.credits-panel'

type SectionRenderer = () => ReactNode

const renderers: Partial<Record<CommercialUiSectionId, SectionRenderer>> = {}

/** enterprise 启动时注册商业 UI 区块渲染器（幂等）。 */
export const registerCommercialUiSection = (id: CommercialUiSectionId, renderer: SectionRenderer): void => {
  renderers[id] = renderer
}

/** 核心页面渲染点调用：无注册返回 null。 */
export const getCommercialUiSection = (id: CommercialUiSectionId): SectionRenderer | null => {
  return renderers[id] ?? null
}
