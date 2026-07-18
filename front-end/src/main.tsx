import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import './styles/global.css'
import App from './App.tsx'
import { ToastProvider } from './context/ToastContext'

// Sentry — client-side error tracking (11-Jul-2026, client login-issue postmortem).
// Only initialises when VITE_SENTRY_DSN is set at build time; otherwise this
// is a no-op so devs without a DSN aren't spammed with Sentry noise and no
// events are sent from local runs. To enable:
//   1. Create a Sentry project (React) at sentry.io — free tier, 5k events/mo
//   2. Copy the DSN into front-end/.env as `VITE_SENTRY_DSN=https://...`
//   3. Rebuild + redeploy. Every network error / uncaught exception now
//      shows up in the Sentry inbox with the client's browser + route +
//      full stack, instead of vanishing silently.
//
// The `import.meta.env` value is inlined at build time by Vite, so the
// build succeeds even if the var isn't set — the block below is just gated
// by falsiness at runtime.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    // Environment label — visible in the Sentry dashboard so UAT / prod
    // errors don't blend together. Prefers an explicit VITE_APP_ENV
    // (e.g. 'uat' / 'prod') set on each Cloudflare Pages project;
    // falls back to Vite's build MODE ('production' / 'development')
    // when the explicit label isn't set — useful locally.
    environment: (import.meta.env.VITE_APP_ENV as string | undefined) || import.meta.env.MODE,
    // Sample rate for performance traces — 10% keeps us well under the
    // free tier's 100k spans/month while still surfacing slow endpoints.
    tracesSampleRate: 0.1,
    integrations: [
      Sentry.browserTracingIntegration(),
      // Session tracking so Sentry shows "how many users hit this error"
      // and session health per release. No PII collected — just a session id.
      Sentry.browserSessionIntegration(),
    ],
  })
}

// React Query's queryCache / mutationCache expose a global onError callback
// that fires for every failed query and mutation. Wired to Sentry so every
// API failure (500s, network errors, ApiError from client.ts) surfaces
// automatically — without this, React Query silently absorbs errors into
// query state and Sentry only ever sees uncaught throws (rare in practice).
//
// Client picked "capture all" (15-Jul-2026) — every failed request goes to
// Sentry regardless of status. Trade-off: expected 4xx (401 login typo,
// 404 empty result) show up as issues too. Filter later via `beforeSend`
// if the inbox gets noisy; for now, one signal per real user error beats
// a curated silence.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => Sentry.captureException(err),
  }),
  mutationCache: new MutationCache({
    onError: (err) => Sentry.captureException(err),
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,  // 30s — fresh enough for an admin tool
    },
    mutations: {
      retry: 0,
    },
  },
})

/** Top-level fallback when a React render/lifecycle error escapes every
 *  component boundary. Kovilpatti card grammar (cream ground, 2px black
 *  border, offset gold shadow) so the crash screen still looks like
 *  "the app", not a raw browser error page. Reload button re-mounts the
 *  root — usually enough to recover if the crash was a transient state. */
function AppCrashScreen() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#FFF8DC',
      padding: 24,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        maxWidth: 480,
        background: '#FFFBE6',
        border: '2px solid #1F1F1F',
        boxShadow: '4px 4px 0 0 #FCD835',
        borderRadius: 8,
        padding: 28,
        color: '#1F1F1F',
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: 1.4,
          textTransform: 'uppercase', color: '#C62828', marginBottom: 6,
        }}>
          Something went wrong
        </div>
        <h2 style={{ margin: '4px 0 12px', fontSize: 20, fontWeight: 800 }}>
          The app hit an unexpected error
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.5, margin: '0 0 20px', color: '#1F1F1FB3' }}>
          The details were reported automatically. Please reload the page — if
          the problem keeps happening, contact support.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 20px',
            border: '2px solid #1F1F1F',
            borderRadius: 6,
            background: '#FCD835',
            color: '#1F1F1F',
            fontWeight: 800,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Sentry's ErrorBoundary — catches React render/effect crashes that
        globalHandlers can't see (React 16+ swallows render errors and
        shows a blank screen in production if there's no boundary). The
        AppCrashScreen is inline so a crash during App's own imports still
        renders. */}
    <Sentry.ErrorBoundary fallback={<AppCrashScreen />} showDialog={false}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
