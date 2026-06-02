import { useCallback, useEffect, useState } from "react"

import { login as apiLogin } from "../core/api"
import type { AuthState } from "../core/types"
import { clearAuth, getAuth, setAuth } from "../store/session"

interface UseAuthReturn {
  auth: AuthState
  isLoading: boolean
  error: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export function useAuth(): UseAuthReturn {
  const [auth, setAuthState] = useState<AuthState>({ token: null, user: null })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getAuth().then((stored) => {
      setAuthState(stored)
      setIsLoading(false)
    })
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await apiLogin(username, password)
      await setAuth(result)
      setAuthState(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка входу")
    } finally {
      setIsLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    await clearAuth()
    setAuthState({ token: null, user: null })
    setError(null)
  }, [])

  return { auth, isLoading, error, login, logout }
}
