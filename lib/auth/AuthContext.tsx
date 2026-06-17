"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { usePathname, useRouter } from "next/navigation"
import { httpClient } from "@/lib/http/client"
import type { AuthUser } from "@/lib/auth/users"

const PUBLIC_PATHS = ["/login", "/register"]

interface AuthContextType {
  user: AuthUser | null
  isLoading: boolean
  setUser: (user: AuthUser | null) => void
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const bouncingRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const data = await httpClient.get<{ user: AuthUser | null }>("/api/auth/me")
      setUser(data.user)
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Logout clears the (possibly stale) cookie server-side before navigating, so
  // a revoked-but-present cookie can't bounce between /login and / forever.
  const logout = useCallback(async () => {
    try {
      await httpClient.post("/api/auth/logout")
    } catch {
      // ignore — navigate regardless
    } finally {
      setUser(null)
      router.push("/login")
    }
  }, [router])

  // /api/auth/me is the source of truth: if the server says we're not logged in
  // while on a protected page (e.g. the session was revoked), bounce to /login.
  useEffect(() => {
    if (isLoading) return
    if (user) {
      bouncingRef.current = false
      return
    }
    if (PUBLIC_PATHS.includes(pathname)) return
    if (bouncingRef.current) return
    bouncingRef.current = true
    void logout()
  }, [isLoading, user, pathname, logout])

  return (
    <AuthContext.Provider value={{ user, isLoading, setUser, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
