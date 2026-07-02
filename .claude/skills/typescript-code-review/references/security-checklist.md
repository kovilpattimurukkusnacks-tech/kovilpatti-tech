# Security Checklist (Frontend TypeScript)

- **No `dangerouslySetInnerHTML`** with unsanitized data — check any usage renders only trusted/static content or goes through a sanitizer.
- **No hardcoded secrets/tokens** in source — this repo's JWT is stored in `localStorage` via `api/tokenStore.ts`; never hardcode a token or API key as a literal for "testing".
- **No `eval` / `new Function(...)`** on any string derived from user or server input.
- **API error messages**: don't surface raw backend error bodies to the user if they might contain internal details (stack traces, SQL fragments) — this repo's `api/errors.ts` (`ApiError`/`ValidationError`/`NotFoundError`) should be the boundary that shapes what reaches the UI.
- **Input going into the DB is server-validated, not just client-validated** — FluentValidation on the .NET side is the real gate; client-side checks are UX only and should never be treated as the security boundary during review.
- **Dependency vulnerabilities**: recommend `npm audit` in `front-end/` if a review touches `package.json`.
