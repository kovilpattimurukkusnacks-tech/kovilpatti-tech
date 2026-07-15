import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
    // Capture unhandled Promise rejections too — the most common failure
    // mode in a React app that awaits API calls without try/catch.
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
  })
}

const queryClient = new QueryClient({
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
