export type AuthMode = 'eoa' | 'passkey' | 'oauth'

const KEY = 'aiwallet_auth_v1'

export function isAuthed(): boolean {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return false
    const obj = JSON.parse(raw)
    return !!obj?.mode
  } catch {
    return false
  }
}

export function getAuth() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setAuthed(mode: AuthMode, extra?: Record<string, any>) {
  localStorage.setItem(KEY, JSON.stringify({ mode, ts: Date.now(), ...(extra || {}) }))
}

export function clearAuth() {
  localStorage.removeItem(KEY)
}
