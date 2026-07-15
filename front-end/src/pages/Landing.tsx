import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { roleHomePath } from '../routes'
import { ApiError } from '../api/errors'
import { BASE_URL } from '../api/config'
import './Landing.css'

export default function Landing() {
  const navigate = useNavigate()
  const { currentUser, login } = useApp()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Network-error retry state (11-Jul-2026, client feedback):
  // Railway free-tier apps sleep after ~10 min idle. First user of the day
  // hits a cold container and their browser gives up before the wake
  // completes (~20-30s). Auto-retry once with a "server starting up"
  // message so the client doesn't see a scary red error for what's
  // effectively an infrastructure warm-up. On the second failure we
  // surface the harder escalation copy.
  const [retryCount, setRetryCount] = useState(0)
  const [wakingUp, setWakingUp] = useState(false)

  // Already authenticated? Bounce to the role-specific landing.
  if (currentUser) return <Navigate to={roleHomePath(currentUser.role)} replace />

  // Extracted so both the initial submit and the auto-retry can share the
  // same login flow without duplicating the try/catch tree.
  const attemptLogin = async () => {
    setSubmitting(true)
    try {
      const user = await login(username.trim(), password)
      // Success — reset retry state so a subsequent login attempt on the
      // same page (e.g. after a logout) starts fresh.
      setRetryCount(0)
      setWakingUp(false)
      navigate(roleHomePath(user.role))
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, err }
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setWakingUp(false)
    setRetryCount(0)

    const first = await attemptLogin()
    if (first.ok) return

    // Distinguish the failure modes so the user gets an honest message:
    //   401 → wrong credentials  (no retry)
    //   429 → rate-limited        (no retry — BE says wait)
    //   5xx → server error        (auto-retry — likely cold start)
    //   network → unreachable     (auto-retry — likely cold start)
    //
    // For 5xx + network errors we retry ONCE after 3 sec with a friendlier
    // "server is starting up" message. If the second attempt also fails,
    // we escalate to the harder "still can't reach" copy.
    const err = first.err
    if (err instanceof ApiError) {
      if (err.status === 401) {
        setError('Invalid username or password.')
        return
      }
      if (err.status === 429) {
        // BE-supplied message already carries "wait X minutes". No retry.
        setError(err.message)
        return
      }
      if ([502, 503, 504].includes(err.status)) {
        await runAutoRetryWithMessage(
          "Server is starting up — this can take up to 30 seconds on the first login of the day. Trying again…"
        )
        return
      }
      // Anything else (400 with a specific message etc.) — surface as-is.
      setError(`${err.message}\n(API ${BASE_URL} · status ${err.status})`)
      return
    }
    // Non-ApiError = network/DNS/CORS/TLS — browser couldn't reach the API.
    // Same "waking up" story as 5xx: most likely Railway container cold start.
    await runAutoRetryWithMessage(
      "Trying to reach the server — this can take up to 30 seconds on the first login of the day…"
    )
  }

  // Show the friendly message, wait 3s, retry. If the retry ALSO fails,
  // show the escalation copy with the API tag so the client can screenshot
  // and forward it to support.
  const runAutoRetryWithMessage = async (friendlyMsg: string) => {
    setWakingUp(true)
    setError(friendlyMsg)
    // 3-second wait — long enough for Railway to progress through the cold
    // start, short enough that a real "network is broken" doesn't feel like
    // an infinite hang.
    await new Promise(r => setTimeout(r, 3000))

    setRetryCount(1)
    const second = await attemptLogin()
    if (second.ok) return

    // Still failed — set the escalation message with technical detail so
    // support can debug. Include the API URL so mobile users can read it
    // off the screen without opening DevTools.
    setWakingUp(false)
    const err = second.err
    if (err instanceof ApiError && [502, 503, 504].includes(err.status)) {
      setError(
        `Still can't reach the server. Try again in a minute, switch to mobile data, or contact support.\n(API ${BASE_URL} · status ${err.status})`
      )
    } else if (err instanceof ApiError) {
      setError(`${err.message}\n(API ${BASE_URL} · status ${err.status})`)
    } else {
      setError(
        `Still can't reach the server. Check your internet connection, try mobile data instead of Wi-Fi, or contact support.\n(API ${BASE_URL} · network error)`
      )
    }
  }

  return (
    <div className="relative min-h-screen flex flex-col">
      <header className="relative z-10 px-6 sm:px-8 py-5 flex items-center gap-3">
        {/* Logo on its own — the emblem already spells out the brand, so
            the redundant text title that lived here was dropped. */}
        <img src="/logo.png" alt="Kovilpatti Murukku & Snacks" className="h-12 sm:h-14 w-auto" />
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-md w-full">
          <div className="landing-welcome-card text-center mb-6 px-6 py-8 rounded-2xl bg-[#FFFBE6]">
            <img src="/logo.png" alt="Kovilpatti Murukku & Snacks" className="mx-auto w-56 sm:w-64 h-auto mb-4" />
            <p className="text-[#1F1F1F] text-base font-bold uppercase tracking-widest">Welcome — sign in to continue</p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="landing-welcome-card bg-[#FFFBE6] rounded-2xl p-6 sm:p-8 space-y-4"
            noValidate
          >
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-[#1F1F1F]/75 mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="username"
                className="landing-login-input w-full px-3 py-2.5 rounded-lg text-sm text-[#1F1F1F] focus:outline-none focus:ring-2 focus:ring-[#FCD835] bg-white"
                required
                autoComplete="username"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-[#1F1F1F]/75 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="landing-login-input w-full px-3 py-2.5 pr-10 rounded-lg text-sm text-[#1F1F1F] focus:outline-none focus:ring-2 focus:ring-[#FCD835] bg-white"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[#1F1F1F]/60 hover:text-[#1F1F1F] focus:outline-none"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              // "Waking up" is informational, not an error — amber styling so
              // the client doesn't panic during the 3-second cold-start retry.
              // Escalation copy (after both attempts fail) reverts to red.
              <div
                className={
                  wakingUp
                    ? 'px-3 py-2 bg-yellow-50 border-2 border-yellow-600 rounded-lg text-sm text-yellow-900 font-medium whitespace-pre-line break-words'
                    : 'px-3 py-2 bg-red-50 border-2 border-red-700 rounded-lg text-sm text-red-700 font-medium whitespace-pre-line break-words'
                }
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!username || !password || submitting}
              className="landing-login-submit w-full gold-gradient gold-gradient-hover-target disabled:bg-gray-300 disabled:text-gray-500 py-3 rounded-lg text-sm font-bold uppercase tracking-widest transition"
            >
              {wakingUp
                ? 'Waking server…'
                : submitting
                  ? (retryCount > 0 ? 'Retrying…' : 'Signing in…')
                  : 'Sign In'}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
