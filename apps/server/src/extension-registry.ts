// [INPUT]: 商业扩展模块在启动时向本注册表登记（enterprise/index.ts）
// [OUTPUT]: 注册表消费方（http 路由组装 / 后台服务启动 / store 初始化）遍历执行
// [POS]: 核心扩展注册表——依赖方向「商业扩展 → 核心注册表」，核心不 import 商业模块。
//        阶段 3 拆仓后本文件留在核心；商业扩展在云仓向同一注册表登记。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type EnterpriseRouteRegistration = (app: unknown, requireAuth: unknown) => void

export interface EnterpriseBackgroundService {
  start: () => void | Promise<void>
  stop: () => void | Promise<void>
}

export type EnterpriseStoreInitializer = () => void | Promise<void>

/** 商业路由注册（http.ts 组装时依次执行）。 */
export const enterpriseRouteRegistrations: EnterpriseRouteRegistration[] = []

/** 商业后台服务（startServerBackgroundServices / stopServerBackgroundServices 时启停）。 */
export const enterpriseBackgroundServices: EnterpriseBackgroundService[] = []

/** 商业 store 初始化（storage bootstrap 时依次执行）。 */
export const enterpriseStoreInitializers: EnterpriseStoreInitializer[] = []

/** 商业 dev seed（isDevLoginEnabled 时执行；公开版注册表为空则跳过）。 */
export const enterpriseDevSeedInitializers: Array<() => void | Promise<void>> = []

/** 商业 MCP 工具注册（registerVibemuxMcpTools 末尾依次执行；公开版为空）。 */
export const enterpriseMcpToolRegistrations: Array<(server: unknown, ctx: unknown) => void> = []

/** 商业 landing（marketing/docs SSR）entry：核心在路由装配时依次 registerRoutes，页面分发时依次 handlePageRequest。 */
export interface EnterpriseLandingEntry {
  registerRoutes: (app: unknown) => void | Promise<void>
  handlePageRequest: (c: { req: Request }) => Promise<Response | null>
}

export const enterpriseLandingEntries: EnterpriseLandingEntry[] = []
