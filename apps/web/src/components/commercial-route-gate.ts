// [INPUT]: 可选扩展在启动时注册的路径解析器
// [OUTPUT]: /pricing 与 /enterprise/$ 核心壳路由所需的可选商业页面组件
// [POS]: 文件路由与私有扩展之间的边界；公开版默认没有任何商业页面。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ComponentType } from 'react'

type CommercialRouteResolver = (pathname: string) => ComponentType | null

let resolver: CommercialRouteResolver = () => null

export const registerCommercialRouteResolver = (nextResolver: CommercialRouteResolver): void => {
  resolver = nextResolver
}

export const getCommercialRouteComponent = (pathname: string): ComponentType | null => resolver(pathname)
