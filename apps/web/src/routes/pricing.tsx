// [INPUT]: /pricing 请求与可选商业路由注册表
// [OUTPUT]: 私有版定价页；公开版返回标准 Not Found
// [POS]: 公开核心拥有的稳定路由壳，可选扩展页面通过注册表提供。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute, notFound } from '@tanstack/react-router'
import { getCommercialRouteComponent } from '@/components/commercial-route-gate'

export const Route = createFileRoute('/pricing')({
  component: PricingRoute,
})

function PricingRoute() {
  const Component = getCommercialRouteComponent('/pricing')
  if (!Component) {
    throw notFound()
  }
  return <Component />
}
