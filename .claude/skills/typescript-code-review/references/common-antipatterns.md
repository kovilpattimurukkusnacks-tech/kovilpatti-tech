# Common TypeScript Anti-patterns

- **`any` escape hatch**: typing something `any` to silence an error instead of narrowing or fixing the actual type mismatch. Prefer `unknown` + a narrowing check if the type is genuinely unknown.
- **Non-null assertion abuse (`x!`)**: asserting non-null on a value that can legitimately be null/undefined at runtime (e.g. `array.find(...)!`) — a silent crash waiting for the one time the array doesn't contain the item.
- **Re-deriving state instead of computing it**: storing a value in `useState` that's a pure function of props/other state, instead of computing it inline or in a `useMemo`. Causes drift bugs when the source updates but the derived state doesn't.
- **`||` for defaults on falsy-valid values**: `qty || 0` when `qty` can legitimately be `0` collapses a real zero into the same branch as `null`/`undefined`. Use `??`.
- **Copy-pasted near-duplicate functions**: two functions that differ by one constant or one condition — should be one function parameterized by that difference.
- **Effect used for derived data**: `useEffect(() => setX(f(y)), [y])` when `const x = useMemo(() => f(y), [y])` (or even a plain `const x = f(y)`) would do, avoiding an extra render and a flash of stale state.
- **Catch-and-ignore**: `catch (e) {}` or `catch { /* ignore */ }` swallowing an error that should propagate or at least be logged.
- **Barrel-import entire libraries**: `import * as _ from 'lodash'` instead of `import debounce from 'lodash/debounce'` when the bundler can't tree-shake the namespace import.
