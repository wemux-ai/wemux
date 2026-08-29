// [INPUT]: 无
// [OUTPUT]: 用户菜单商业区块渲染器注册表（套餐/升级/积分）——公开版空，私有版注册实现
// [POS]: 核心 user-menu-popover 只经本 gate 渲染商业区块，不 import enterprise 组件。
//        公开版：无注册 → 渲染 null（用户菜单无套餐/积分区块）。
//        私有版：enterprise/index.ts 注册完整实现（含 UpgradePlanDialog、积分显示）。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ReactNode } from 'react'

export interface UserMenuCommercialSectionProps {
  language: 'zh' | 'en'
  onNavigate: (path: string, search?: Record<string, string>) => void
}

type UserMenuCommercialSectionRenderer = (props: UserMenuCommercialSectionProps) => ReactNode

let renderer: UserMenuCommercialSectionRenderer | null = null

/** enterprise 启动时注册用户菜单商业区块渲染器（幂等）。 */
export const registerUserMenuCommercialSection = (impl: UserMenuCommercialSectionRenderer): void => {
  renderer = impl
}

/** 核心用户菜单渲染点调用：无注册返回 null。 */
export const getUserMenuCommercialSection = (): UserMenuCommercialSectionRenderer | null => renderer
