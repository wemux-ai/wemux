import { createAuthClient } from 'better-auth/client'
import { getBetterAuthBaseUrl } from './runtime-config'

export const betterAuthClient = createAuthClient({
  baseURL: getBetterAuthBaseUrl(),
})
