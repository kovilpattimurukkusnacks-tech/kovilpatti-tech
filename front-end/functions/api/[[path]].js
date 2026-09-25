/**
 * Same-origin API proxy — Cloudflare Pages Function (25-Sep-2026).
 *
 * Every request to https://<pages-site>/api/* is forwarded server-side to the
 * Railway backend named in the API_ORIGIN runtime variable (e.g.
 * https://kovilpatti-tech-uat.up.railway.app) and the response streamed back.
 *
 * Why: some client networks cannot open a connection to *.up.railway.app at
 * all (Sentry JAVASCRIPT-REACT-1Q — login fetch timed out after ~21s, the
 * Windows TCP connect timeout, while the Pages site itself loaded fine). The
 * browser now only ever talks to the Pages domain it already reaches;
 * Cloudflare → Railway happens inside Cloudflare's network. Side benefit:
 * same-origin calls need no CORS preflight.
 *
 * Enable per Pages project:
 *   1. Settings → Variables and secrets → add runtime var
 *        API_ORIGIN = https://<railway-service>.up.railway.app
 *   2. Set the build var VITE_API_URL = /   (FE calls /api/... on its own origin)
 *   3. Redeploy.
 * Projects that keep VITE_API_URL pointing at Railway never hit this file.
 *
 * Local `npm run dev` doesn't run Pages Functions — .env.local keeps pointing
 * straight at the Railway DEV backend.
 */

// Hop-by-hop / origin-specific headers that must not be forwarded as-is.
const DROP_REQUEST_HEADERS = ['host', 'origin', 'cf-connecting-ip', 'x-forwarded-host', 'x-forwarded-proto']

export async function onRequest({ request, env }) {
  const origin = (env.API_ORIGIN || '').replace(/\/$/, '')
  if (!origin) {
    return Response.json(
      { error: 'API proxy is not configured (API_ORIGIN is missing on this Pages project).' },
      { status: 502 },
    )
  }

  const incoming = new URL(request.url)
  const target = origin + incoming.pathname + incoming.search

  const headers = new Headers(request.headers)
  for (const h of DROP_REQUEST_HEADERS) headers.delete(h)
  // Real client IP for BE logs + the per-IP login lockout (AuthService).
  const clientIp = request.headers.get('cf-connecting-ip')
  if (clientIp) headers.set('X-Forwarded-For', clientIp)
  headers.set('X-Forwarded-Host', incoming.host)
  headers.set('X-Forwarded-Proto', 'https')

  // Buffered, not streamed: request bodies here are small JSON or the ≤5 MB
  // product-import upload, and a buffered body avoids the half-duplex
  // streaming rules that differ between runtimes.
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const body = hasBody ? await request.arrayBuffer() : undefined

  let upstream
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
    })
  } catch (err) {
    // Railway unreachable from Cloudflare (container down / mid-deploy).
    // 502 lets the FE's existing cold-start retry path kick in.
    return Response.json(
      { error: `Backend unreachable via proxy: ${err && err.message ? err.message : 'fetch failed'}` },
      { status: 502 },
    )
  }

  // Re-wrap so headers are mutable; body streams through untouched
  // (Excel exports / imports included).
  return new Response(upstream.body, upstream)
}
