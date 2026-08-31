import { useEffect, useState } from 'react'
import { api } from './api'
import type { AppBrand } from './api/types'

// 应用品牌/版本的客户端读取：登录 bootstrap 接口携带服务端注册的 brand（默认 open-source）。
// 模块级缓存保证登录页与侧边栏等多个消费方每次页面加载只发一次请求。
let cachedBrandPromise: Promise<AppBrand | null> | null = null

const loadAppBrand = (): Promise<AppBrand | null> => {
  if (!cachedBrandPromise) {
    cachedBrandPromise = api.listDevLoginAccounts()
      .then((response) => response.brand ?? null)
      .catch(() => null)
  }
  return cachedBrandPromise
}

export const useAppBrand = (): AppBrand | null => {
  const [brand, setBrand] = useState<AppBrand | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadAppBrand().then((brand) => {
      if (!cancelled) {
        setBrand(brand)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  return brand
}

/** 开源社区版（未注册商业品牌覆盖的部署）渲染 Community 文案；商业部署保持中性品牌。 */
export const isCommunityEdition = (brand: AppBrand | null): boolean => brand?.edition === 'open-source'
