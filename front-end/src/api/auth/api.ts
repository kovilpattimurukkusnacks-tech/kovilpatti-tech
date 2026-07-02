import { apiClient } from '../client'
import { ApiError } from '../errors'
import type { LoginRequest, LoginResponse } from './types'

// Login retry/backoff (29-Jun-2026, mobile-login flakiness diagnostic).
// Mobile clients occasionally see login fail on the first attempt due to:
//   • Railway BE cold-start (502/503/504 from the Railway proxy while the
//     container boots) — typically resolves in ~5–15s.
//   • Mobile-data DNS / TLS hiccup — fetch throws a TypeError (network
//     failure), and a retry on the same socket usually succeeds.
// Wrong-credential (401), validation (400), forbidden (403) etc. are NOT
// retried — those are deterministic and the user needs the error now.
const MAX_ATTEMPTS = 3
// Delay BEFORE attempt 2 and 3. Tuned for Railway cold-start: first wait
// ~1.5s covers a warm transient blip; second ~3.5s gives a cold container
// time to be ready. Total worst-case wait before failure: ~5s.
const RETRY_DELAYS_MS = [1500, 3500]

function isRetryable(err: unknown): boolean {
  // fetch() throws TypeError on DNS / TCP / TLS / CORS pre-flight failures.
  if (err instanceof TypeError) return true
  // Railway proxy returns 502/503/504 while the container is spinning up.
  if (err instanceof ApiError && [502, 503, 504].includes(err.status)) return true
  return false
}

export const authApi = {
  async login(req: LoginRequest): Promise<LoginResponse> {
    let lastErr: unknown
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const t0 = performance.now()
      try {
        const result = await apiClient.post<LoginResponse>('/api/auth/login', req)
        if (attempt > 1) {
          // eslint-disable-next-line no-console
          console.info(`[kovilpatti] login succeeded on attempt ${attempt} (${Math.round(performance.now() - t0)}ms)`)
        }
        return result
      } catch (err) {
        lastErr = err
        const dt = Math.round(performance.now() - t0)
        const retry = isRetryable(err) && attempt < MAX_ATTEMPTS
        const tag = retry ? `→ retrying in ${RETRY_DELAYS_MS[attempt - 1]}ms` : '→ giving up'
        // eslint-disable-next-line no-console
        console.warn(`[kovilpatti] login attempt ${attempt} failed after ${dt}ms ${tag}`, err)
        if (!retry) break
        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]))
      }
    }
    throw lastErr
  },
}
