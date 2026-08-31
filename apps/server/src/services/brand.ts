// [INPUT]: 应用品牌/版本标识注册请求
// [OUTPUT]: AppBrand 解析结果（name / site / edition）
// [POS]: 品牌唯一事实来源——核心链路只依赖本模块；公开版默认 open-source。
//        私有版（云托管）在启动时通过 registerAppBrand 注入覆盖，避免商业部署
//        被渲染成社区版（登录页/侧边栏按 edition 渲染 Community 文案）。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type AppBrand = {
  name: string
  site: string
  edition: string
}

const defaultBrand: AppBrand = {
  name: 'wemux',
  site: 'https://wemux.ai',
  edition: 'open-source',
}

let currentBrand: AppBrand | null = null

export const registerAppBrand = (brand: AppBrand): void => {
  currentBrand = { ...defaultBrand, ...brand }
}

export const resolveAppBrand = (): AppBrand => currentBrand ?? defaultBrand
