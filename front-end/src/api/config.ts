/**
 * API base URL.
 *
 * Reads from `VITE_API_URL` (set in `.env.local` for dev, in the
 * Cloudflare Pages dashboard for UAT/Prod). Falls back to localhost so a
 * fresh checkout still talks to the dev backend without configuration.
 */
const FALLBACK = 'http://localhost:5219'
const explicit = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')

export const BASE_URL: string = explicit ?? FALLBACK

// Diagnostic — logged once at module load and pinned to `window` so it's
// readable from a remote-debug session on a phone. When a user reports
// "login failed on mobile", the first thing to check is whether the FE
// bundle is actually pointing at the right BE (a stale Cloudflare Pages
// cache, or a missing VITE_API_URL on a redeploy, both manifest here).
//   • Open chrome://inspect on desktop while the phone is USB-tethered,
//     pick the page, and read the console line below, OR
//   • Run `window.__KOVILPATTI_API_URL__` in the remote console.
if (typeof window !== 'undefined') {
  const tag = explicit ? '' : '  (FALLBACK — VITE_API_URL env var is MISSING!)'
  // eslint-disable-next-line no-console
  console.info(`[kovilpatti] API base = ${BASE_URL}${tag}`)
  ;(window as unknown as { __KOVILPATTI_API_URL__: string }).__KOVILPATTI_API_URL__ = BASE_URL
}
