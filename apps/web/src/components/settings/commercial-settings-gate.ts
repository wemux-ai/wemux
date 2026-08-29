// [INPUT]: 商业设置区块注册契约（核心侧，公开版安全）
// [OUTPUT]: enterprise 启动时注册的设置面板渲染器与动作；公开版 registry 为空
// [POS]: settings 页商业扩展槽位——核心不 import enterprise，enterprise 不改核心
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
//
// payload 契约：核心渲染点只传"核心已知上下文"（团队/语言等非商业数据），
// 商业数据（billingStatus 等）由 enterprise 组件自行获取。

import type { ReactNode } from 'react'

export interface SettingsSectionPayloads {
  /** settings 左侧菜单的 Bill & Usage 面板（无核心上下文，组件全自包含） */
  'settings.billing': Record<string, never>
  /** workspace 团队详情页的 billing summary 卡（核心提供团队上下文） */
  'workspace.billing.summary': {
    teamId: string
    teamName: string
    membersCount: number
    language: string
  }
}

export interface SettingsSectionActions {
  /** brain 功能付费墙升级入口 */
  'workspace.billing.checkout': { teamId?: string }
}

type SectionRenderers = {
  [K in keyof SettingsSectionPayloads]: (payload: SettingsSectionPayloads[K]) => ReactNode
}
type SectionActionMap = {
  [K in keyof SettingsSectionActions]: (payload: SettingsSectionActions[K]) => void
}

const renderers: Partial<SectionRenderers> = {}
const actions: Partial<SectionActionMap> = {}

export function registerSettingsSection<K extends keyof SectionRenderers>(
  id: K,
  renderer: SectionRenderers[K],
): void {
  renderers[id] = renderer as SectionRenderers[K]
}

export function getSettingsSection<K extends keyof SectionRenderers>(
  id: K,
): SectionRenderers[K] | undefined {
  return renderers[id] as SectionRenderers[K] | undefined
}

export function registerSettingsAction<K extends keyof SettingsSectionActions>(
  id: K,
  action: SectionActionMap[K],
): void {
  actions[id] = action as SectionActionMap[K]
}

export function getSettingsAction<K extends keyof SettingsSectionActions>(
  id: K,
): SectionActionMap[K] | undefined {
  return actions[id] as SectionActionMap[K] | undefined
}
