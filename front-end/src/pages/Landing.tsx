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

  // Already authenticated? Bounce to the role-specific landing.
  if (currentUser) return <Navigate to={roleHomePath(currentUser.role)} replace />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const user = await login(username.trim(), password)
      navigate(roleHomePath(user.role))
    } catch (err) {
      // Distinguish the failure modes so the user gets an honest message:
      //   401 → wrong credentials   429 → rate-limited (BE message)
      //   other ApiError → BE message   non-ApiError → network/unreachable
      //
      // 29-Jun-2026: when login can't reach the BE at all, append the API
      // URL + a short tag to the user-facing error. Mobile users can read
      // this off the screen and report it back — much easier than asking
      // them to open DevTools on a phone.
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError('Invalid username or password.')
        } else if ([502, 503, 504].includes(err.status)) {
          setError(`Server is starting up — please try again in a few seconds.\n(API ${BASE_URL} · status ${err.status})`)
        } else {
          setError(`${err.message}\n(API ${BASE_URL} · status ${err.status})`)
        }
      } else {
        setError(`Could not reach the server. Check your connection and try again.\n(API ${BASE_URL} · network error)`)
      }
    } finally {
      setSubmitting(false)
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
              <div className="px-3 py-2 bg-red-50 border-2 border-red-700 rounded-lg text-sm text-red-700 font-medium whitespace-pre-line break-words">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!username || !password || submitting}
              className="landing-login-submit w-full gold-gradient gold-gradient-hover-target disabled:bg-gray-300 disabled:text-gray-500 py-3 rounded-lg text-sm font-bold uppercase tracking-widest transition"
            >
              {submitting ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
