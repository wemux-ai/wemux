// [INPUT]: 无
// [OUTPUT]: admin analytics/用户详情扩展点的空实现注册表（开源版返回空，商业版注册实现）
// [POS]: 核心 admin 路由只依赖本 gate 的稳定接口，不直接 import enterprise 服务。
//        公开版：无注册 → 返回结构化空值（保持 API 形状，不抛错）。
//        私有版：enterprise/index.ts 启动时注册实现（返回完整商业数据）。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export interface AdminAnalyticsProvider {
  /** 产品分析看板数据（周交付/质量/留存/渠道/商业快照）。 */
  buildProductAnalytics: () => Promise<unknown>
  /** 用户概览（积分/订阅/失败登录/在线会话）。 */
  buildUserOverview: (userId: string) => Promise<unknown>
  /** 用户日活跃（近 30 天）。 */
  buildUserDailyActivity: (userId: string) => Promise<unknown>
  /** 用户操作流水。 */
  buildUserActivity: (userId: string) => Promise<unknown>
  /** 用户审计记录。 */
  buildUserAudit: (userId: string, limit?: number) => Promise<unknown>
}

/** 公开版默认实现：空结构，API 形状保持（consumers 端对端不崩）。 */
export const openSourceAdminAnalyticsProvider: AdminAnalyticsProvider = {
  async buildProductAnalytics() {
    return {}
  },
  async buildUserOverview() {
    return {
      credit: null,
      subscriptions: [],
      failedLogins: { last7d: 0, last30d: 0, lastFailedAt: null, lastFailedIp: null },
      onlineSessions: 0,
    }
  },
  async buildUserDailyActivity() {
    return []
  },
  async buildUserActivity() {
    return []
  },
  async buildUserAudit() {
    return []
  },
}

let currentProvider: AdminAnalyticsProvider = openSourceAdminAnalyticsProvider

/** 私有仓启动时注入商业实现；公开版不调用（保持默认空实现）。 */
export const registerAdminAnalyticsProvider = (impl: AdminAnalyticsProvider): void => {
  currentProvider = impl
}

/** 核心 admin 路由统一从这里获取 analytics 提供者。 */
export const getAdminAnalyticsProvider = (): AdminAnalyticsProvider => currentProvider
