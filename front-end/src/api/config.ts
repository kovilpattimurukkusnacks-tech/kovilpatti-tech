/**
 * API base URL.
 *
 * Reads from `VITE_API_URL` (set in `.env.local` for dev, in the Vercel
 * dashboard for UAT/Prod). Falls back to localhost so a fresh checkout
 * still talks to the dev backend without configuration.
 */
const FALLBACK = 'http://localhost:5219'

export const BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? FALLBACK
