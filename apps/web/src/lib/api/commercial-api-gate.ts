// [INPUT]: 无
// [OUTPUT]: Web 侧商业 API 扩展注册表——enterprise 启动时注册方法集合，核心 api 对象展开
// [POS]: 核心 api 聚合只依赖本 gate 的注册表，不直接 import enterprise 方法。
//        公开版：无注册 → 展开空对象（api 不暴露商业方法）。
//        私有版：enterprise/index.ts 注册 adminOpsMethods 等（须满足 AdminOpsMethods 契约）。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { AdminOpsMethods } from '@shared/admin-ops'

export interface CommercialApiMethodGroups {
  adminOps?: AdminOpsMethods
}

const registered: CommercialApiMethodGroups[] = []

/** enterprise 启动时注册商业 API 方法组（幂等追加）。 */
export const registerCommercialApiMethods = (group: CommercialApiMethodGroups): void => {
  registered.push(group)
}

/**
 * 核心 api 聚合展开调用：返回全部商业方法（公开版为空对象）。
 * 返回类型声明为 AdminOpsMethods（全量签名），使 api 推断类型完整；
 * 公开版运行时空对象展开，方法 undefined 由消费方在开源版不渲染商业 UI 规避。
 */
export const getCommercialApiMethods = (): AdminOpsMethods => {
  return Object.assign({}, ...registered.map((g) => g.adminOps ?? {})) as AdminOpsMethods
}
