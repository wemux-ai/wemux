import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api, resolveApiUrl, type AuthUser } from './api'
import { betterAuthClient } from './better-auth-client'

export type User = AuthUser

type AuthContextType = {
  user: User | null
  token: string | null
  loading: boolean
  login: (user: User, token: string) => void
  updateUser: (user: User) => void
  logout: () => void
  checkAuth: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

let pendingAuthMeRequest: Promise<{ user?: User } | null> | null = null

const fetchAuthMe = (storedToken: string) => {
  if (pendingAuthMeRequest) {
    return pendingAuthMeRequest
  }

  pendingAuthMeRequest = fetch(resolveApiUrl('/api/auth/me'), {
    headers: { Authorization: `Bearer ${storedToken}` },
  })
    .then(async (res) => {
      if (!res.ok) {
        return null
      }

      return await res.json() as { user?: User }
    })
    .finally(() => {
      pendingAuthMeRequest = null
    })

  return pendingAuthMeRequest
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const existingContext = useContext(AuthContext)

  if (existingContext) {
    return <>{children}</>
  }

  return <AuthProviderInner>{children}</AuthProviderInner>
}

function AuthProviderInner({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const login = (newUser: User, newToken: string) => {
    localStorage.setItem('auth_token', newToken)
    localStorage.setItem('user', JSON.stringify(newUser))
    setUser(newUser)
    setToken(newToken)
    window.dispatchEvent(new Event('wemux:auth-changed'))
  }

  const updateUser = (nextUser: User) => {
    localStorage.setItem('user', JSON.stringify(nextUser))
    setUser(nextUser)
    window.dispatchEvent(new Event('wemux:auth-changed'))
  }

  const logout = async () => {
    try { await betterAuthClient.signOut() } catch { /* 忽略第三方 session 清理失败 */ }
    try { await api.logout() } catch { /* 服务端不可达也继续清理 */ }
    localStorage.removeItem('auth_token')
    localStorage.removeItem('user')
    setUser(null)
    setToken(null)
    window.location.href = '/login'
  }

  const checkAuth = async () => {
    const storedToken = localStorage.getItem('auth_token')
    const storedUser = localStorage.getItem('user')

    if (!storedToken || !storedUser) {
      setLoading(false)
      return
    }

    try {
      const data = await fetchAuthMe(storedToken)
      if (data?.user) {
        updateUser(data.user)
        setToken(storedToken)
      } else {
        localStorage.removeItem('auth_token')
        localStorage.removeItem('user')
        setUser(null)
        setToken(null)
      }
    } catch {
      // 网络不可达时不强制登出，保留本地缓存
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    checkAuth()
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, loading, login, updateUser, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
