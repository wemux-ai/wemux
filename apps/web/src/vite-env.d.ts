/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_BASE_URL?: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_GA_MEASUREMENT_ID?: string
  readonly VITE_COMMUNITY_DISCORD_URL?: string
  readonly VITE_COMMUNITY_WECHAT_QR_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __APP_VERSION__: string
declare const __APP_BUILD_ID__: string

declare module 'virtual:commercial-extension' {}

declare module "@/*" {
  const value: any
  export default value
}
