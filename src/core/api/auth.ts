import { API_BASE_URL, MOCK_MODE } from "../config"
import type { AuthState, User } from "../types"
import { delay, MOCK_TOKEN, MOCK_USER } from "./mock-data"

function authHeader(token: string) {
  return { Authorization: `Basic ${token}` }
}

export async function login(
  username: string,
  password: string
): Promise<AuthState> {
  if (MOCK_MODE) {
    await delay()
    if (!username || password.length < 4)
      throw new Error("Невірний username або пароль")
    return { token: MOCK_TOKEN, user: MOCK_USER }
  }
  const token = btoa(`${username}:${password.replace(/\s+/g, "")}`)
  const res = await fetch(`${API_BASE_URL}/wp-json/wp/v2/users/me`, {
    headers: { ...authHeader(token) },
    credentials: "omit"
  })
  if (!res.ok) throw new Error("Невірний username або пароль")
  const wpUser = await res.json()
  const user: User = {
    id: String(wpUser.id),
    username: wpUser.slug ?? username,
    name: wpUser.name
  }
  return { token, user }
}
