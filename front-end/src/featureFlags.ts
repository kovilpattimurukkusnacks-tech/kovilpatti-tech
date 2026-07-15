/**
 * Feature flags — build-time booleans gated on Vite env vars.
 *
 * Each flag reads a dedicated `VITE_ENABLE_*` env var. Vite inlines
 * `import.meta.env.*` at build time, so flipping a flag on a deployed
 * environment (Cloudflare Pages) requires a REDEPLOY after changing the
 * variable — not a runtime toggle. Fine for hide-until-signoff work;
 * reach for GrowthBook / LaunchDarkly if we ever need instant toggles.
 *
 * FAIL-CLOSED: every flag defaults to `false` when the env var is unset
 * (or set to anything other than the exact string 'true'). A new
 * environment that forgets to set the var stays safely hidden rather than
 * accidentally showing an in-development feature.
 *
 * How to set the vars:
 *   • Local dev — front-end/.env.local:
 *       VITE_ENABLE_BILLING=true
 *   • Cloudflare Pages (Settings → Environment Variables → Production):
 *       kovilpatti-tech-dev   → VITE_ENABLE_BILLING=true
 *       kovilpatti-tech-uat   → VITE_ENABLE_BILLING=false (or omit)
 *       kovilpatti-tech-prod  → VITE_ENABLE_BILLING=false (or omit)
 *     After changing, trigger a redeploy (Deployments → Retry latest).
 */

/** True only when the env var is exactly the string 'true'. Anything
 *  else — including 'false', '1', 'yes', undefined — is treated as off. */
function envFlag(value: unknown): boolean {
  return value === 'true'
}

export const featureFlags = {
  /** Phase 4 POS billing. Sidebar item hidden on environments where the
   *  flag is off. Route + backing components are left intact — direct
   *  URL access still works during in-progress development. */
  billing: envFlag(import.meta.env.VITE_ENABLE_BILLING),
} as const
