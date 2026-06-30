# Stale-Products on Rapid Next-Category Clicks

> **Status:** Planned — not built. Spec parked 30-Jun-2026.
> Build cost ~30 minutes (FE-only, no DB / BE changes).

## Problem

On the shop's New Stock Request page, the sticky bottom bar has a
Prev / `N/M` / Next category pager. When the shop user rapid-clicks
Next:

- The **counter advances** instantly (e.g. 1/11 → 2/11 → 3/11 → 4/11).
- The **products grid stays stuck** showing the previous category's
  items.

The client observed and reported this on 30-Jun-2026.

## Root cause

`selectedCategoryId` is React local state — updates **instantly** on
click. The products grid is fed by `useProducts({ categoryIds })` which
is **async via React Query** — every category change triggers a fresh
fetch (Railway BE round-trip is **400–700 ms**).

When the user clicks faster than the API can respond:

1. Click 1 → counter 2/11 → fetch A starts (categories[1]).
2. Click 2 → counter 3/11 → fetch A is **discarded by React Query**,
   fetch B starts (categories[2]).
3. Click 3 → counter 4/11 → fetch B discarded, fetch C starts.
4. … each rapid click cancels the in-flight fetch and starts a new one.

While this loops, the rendered products are the **last successfully
resolved data** — usually whatever category the user had loaded BEFORE
the burst. Counter raceahead of data → user confusion.

## Strategies considered

| # | Strategy | Latency felt | FE cost | Network cost |
|---|---|---|---|---|
| **A** | **Prefetch next 1–2 root categories** as soon as current loads. Click Next → cache hit → instant render. | ~0 ms when cached; falls back to spinner if user outruns prefetch | Low — `queryClient.prefetchQuery` in a `useEffect` | +1–2 fetches per category visit |
| **B** | **Loading overlay** dimming the grid + small "Loading…" pill while `isFetching`. Clear visual feedback. | 400–700 ms per click | Low — wrap grid, react to `productsQuery.isFetching` | None |
| **C** | **Throttle Next** to 1 click per ~400–500 ms. | UI feels sluggish | Lowest — `useRef` cooldown | None |
| **D** | **Counter mirrors LOADED category, not SELECTED one** (pending + loaded states). | Counter waits for data — feels honest but laggy | Medium — split state | None |

## Recommendation: **A + B combined**

- **Primary:** **Prefetch (A).** When a category's products land,
  prefetch the **next** root in `sortedRootCats`. Common case (one
  step at a time) becomes instant.
- **Fallback:** **Loading overlay (B).** If the user outpaces the
  prefetch (burst of 3+ clicks), the grid dims + shows "Loading next
  category…" so they understand they're waiting — no more
  counter-ahead-of-items confusion.

C (throttle) and D (counter sync to loaded) explicitly rejected:
- C frustrates the eager user — the Next button should feel snappy.
- D solves the visual mismatch but adds a 400–700 ms latency to EVERY
  click, including ones where data is already cached.

Both A and B are **FE-only**. No SP / BE / migration work.

## Implementation outline

### File: `front-end/src/pages/shop/ShopRequestNew.tsx`

1. **Prefetch effect** — after the current category loads, prefetch
   the next root in priority order. Roughly:
   ```ts
   const qc = useQueryClient()
   useEffect(() => {
     if (!productsQuery.data || !hasNextCat) return
     const nextRootId = sortedRootCats[currentCatIndex + 1].id
     const nextSubtreeIds = computeSubtreeIds(nextRootId, allCats)
     qc.prefetchQuery({
       queryKey: productsKeys.list({
         categoryIds: nextSubtreeIds,
         types: selectedTypes.length ? selectedTypes : undefined,
         search: debouncedSearch.trim() || undefined,
         pageSize: PRODUCT_PAGE_SIZE,
       }),
       queryFn: ...same as useProducts internals...,
     })
   }, [productsQuery.data, currentCatIndex, sortedRootCats, ...])
   ```
   Must use the **exact same query key + selectors** as `useProducts`
   so the prefetched data lines up byte-for-byte. Easiest path: expose
   a `prefetchProducts(filters)` helper from `useProducts.ts` so the
   page never reaches into `productsKeys` directly.

2. **Loading overlay** — when `productsQuery.isFetching` is true,
   render a translucent dim layer + small "Loading next category…"
   pill positioned absolute over the products grid. Keep the existing
   grid mounted underneath so there's no layout shift; just visually
   indicate "this data is stale". Remove the dim when
   `isFetching` flips false.
   ```jsx
   <Box sx={{ position: 'relative' }}>
     {productsQuery.isFetching && (
       <Box sx={{
         position: 'absolute', inset: 0, zIndex: 5,
         bgcolor: 'rgba(255,255,255,0.55)',
         display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
         pt: 4, pointerEvents: 'none',
       }}>
         <Chip label="Loading next category…" size="small" sx={{ bgcolor: '#FFF8DC', border: '1px solid #1F1F1F', fontWeight: 700 }} />
       </Box>
     )}
     {/* existing products grid */}
   </Box>
   ```

### Files NOT touched

- `useProducts.ts` — already cache-friendly; prefetch piggybacks on it.
- Next/Prev button handlers — stay simple.
- Cart / save logic — concurrency was already fixed by the
  in-pending-skip guard on the auto-save effect (30-Jun-2026).

## Edge cases

- **User clicks Next very fast** → counter advances, prefetch can't
  keep up → overlay shows on the (cached or in-flight) target
  category until data lands.
- **User goes Back to a previously-viewed category** → already in
  React Query cache → instant.
- **User changes filters / types / search** → query key changes →
  prefetch invalidated naturally; one extra fetch for the new shape.
- **Last category** (`!hasNextCat`) → prefetch effect no-ops.
- **Slow network beyond 700 ms** → overlay extends until BE responds;
  user sees clear feedback rather than silently-stale data.

## Open decision

**Prefetch radius:** 1 ahead (lean) vs 2–3 ahead (eager).
**Proposed:** 1 ahead — covers the natural step-at-a-time flow, keeps
network usage minimal. The overlay handles the rare burst case
cleanly. Revisit if users actually do click 3+ Next in a row often.

## Build estimate

~30 minutes end-to-end:
- 10 min: expose a `prefetchProducts(filters)` helper on `useProducts`.
- 10 min: wire the prefetch effect on `ShopRequestNew.tsx`.
- 10 min: overlay JSX + sx + smoke test.

No DB script, no BE work, no migration.
