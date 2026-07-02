# Type Safety Checklist

- No implicit `any` — every parameter, return value, and variable has an inferred or explicit type that isn't `any`.
- `strict: true` (or the individual strict flags) enabled — **not currently set** in this repo's `front-end/tsconfig.app.json`; treat as a known gap, not a per-PR regression.
- Type guards: custom guards use a type predicate (`x is Foo`), not a bare boolean return that callers then have to re-assert.
- Discriminated unions: `switch`/`if` chains over a union's discriminant are exhaustive — a `never`-typed default branch catches missing cases at compile time.
- Optional chaining (`?.`) / nullish coalescing (`??`) used instead of manual `!= null` checks or `||` (which incorrectly falls through on `0`/`''`/`false`).
- Type assertions (`as X`, `x!`) are the exception, not the rule — each one should have a comment explaining why the compiler can't infer it, and should not be used to silence a real type error.
- Generic functions/components have constraints (`<T extends X>`) where unconstrained generics would let callers pass unusable types.
- Return types are explicit on exported functions (inference is fine for local helpers, but a public API's return type shouldn't require callers to hover to find out).
- `import type` used for type-only imports where `verbatimModuleSyntax` is on (this repo's `tsconfig.app.json` sets it) — a plain `import` of a type-only symbol is a build error, not just a lint nit.
