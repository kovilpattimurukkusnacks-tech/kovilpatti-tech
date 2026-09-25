import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Sentry release (24-Sep-2026) — the deploy's git commit, so a Sentry event
// says which build the user was running. Cloudflare Pages / Vercel set these
// automatically at build time; an explicit VITE_RELEASE wins; local = unset.
const release =
  process.env.VITE_RELEASE ||
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  ''

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_RELEASE': JSON.stringify(release),
  },
})
