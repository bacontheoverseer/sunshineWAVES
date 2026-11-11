import { apiFetch } from './games'

export interface User {
  user_id: string
  username: string
}

export interface AuthResult {
  token: string
  username: string
  user_id: string
}

export async function register(username: string, password: string): Promise<AuthResult> {
  const res = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  return res.json()
}

export async function login(username: string, password: string): Promise<AuthResult> {
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  return res.json()
}

export async function getMe(): Promise<User> {
  const res = await apiFetch('/users/me')
  return res.json()
}

export function saveSession(result: AuthResult) {
  localStorage.setItem('nero_token', result.token)
  localStorage.setItem('nero_user', JSON.stringify({ user_id: result.user_id, username: result.username }))
}

export function clearSession() {
  localStorage.removeItem('nero_token')
  localStorage.removeItem('nero_user')
}

export function getStoredUser(): User | null {
  try {
    const s = localStorage.getItem('nero_user')
    return s ? JSON.parse(s) : null
  } catch { return null }
}
