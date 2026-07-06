/**
 * Distribute items into two columns using a "place on the shorter side"
 * heuristic so the columns end at roughly the same height.
 *
 * Beats both alternative layouts for variable-height card grids:
 *  - CSS Grid with `align-items: start` leaves vertical gaps when one
 *    card in a row is much taller than its neighbours.
 *  - CSS `column-count: 2` packs everything into column 1 when the
 *    total content is shorter than one column's height.
 *
 * Order is preserved WITHIN each column — items are appended in the
 * order they appear in the input. The estimator doesn't need exact
 * pixel heights; relative comparison (e.g. number of rows per card)
 * is enough to drive balance.
 *
 *   const { left, right } = splitBalancedColumns(cards, c => c.items.length)
 *   // → render two flex columns side-by-side
 */
export function splitBalancedColumns<T>(
  items: readonly T[],
  heightOf: (item: T) => number,
): { left: T[]; right: T[] } {
  // Decide column membership via a Longest-Processing-Time-first greedy:
  // assign the biggest items first, always to the currently shorter side.
  // Assigning in original (encounter) order instead can badly misbalance
  // when a large item shows up after the smaller ones already committed —
  // e.g. heights [4, 10, 15] in order puts 4+15=19 on one side and only
  // 10 on the other, leaving a large blank gap under the short column.
  // Sorting by size first for the assignment decision (while still
  // rendering each column in original order below) keeps both sides
  // close to balanced regardless of input order.
  const indexed = items.map((item, index) => ({ item, index, h: heightOf(item) }))
  const bySizeDesc = [...indexed].sort((a, b) => b.h - a.h)

  const leftIndices = new Set<number>()
  let lH = 0
  let rH = 0
  for (const { index, h } of bySizeDesc) {
    if (lH <= rH) {
      leftIndices.add(index)
      lH += h
    } else {
      rH += h
    }
  }

  const left: T[] = []
  const right: T[] = []
  for (const { item, index } of indexed) {
    (leftIndices.has(index) ? left : right).push(item)
  }
  return { left, right }
}

/**
 * N-column generalisation of {@link splitBalancedColumns} — same
 * Longest-Processing-Time-first greedy (assign biggest items first, always
 * to the currently shortest column), generalised from 2 to `numColumns`
 * sides. Used by the cumulative batch-plan print, which needs 3 columns to
 * hit the client's 3-4 page target instead of the 2-column picklist layout.
 *
 *   const [c1, c2, c3] = splitBalancedColumnsN(cards, c => c.items.length, 3)
 */
export function splitBalancedColumnsN<T>(
  items: readonly T[],
  heightOf: (item: T) => number,
  numColumns: number,
): T[][] {
  const indexed = items.map((item, index) => ({ item, index, h: heightOf(item) }))
  const bySizeDesc = [...indexed].sort((a, b) => b.h - a.h)

  const colHeights = new Array(numColumns).fill(0)
  const colOf = new Array(indexed.length).fill(0)
  for (const { index, h } of bySizeDesc) {
    let shortest = 0
    for (let c = 1; c < numColumns; c++) {
      if (colHeights[c] < colHeights[shortest]) shortest = c
    }
    colOf[index] = shortest
    colHeights[shortest] += h
  }

  const columns: T[][] = Array.from({ length: numColumns }, () => [])
  for (const { item, index } of indexed) {
    columns[colOf[index]].push(item)
  }
  return columns
}

/**
 * Explicit page-aware bin-packing (07-Jul-2026) — needed when the
 * whole-document balance from {@link splitBalancedColumnsN} still leaves a
 * page mostly blank. That function only equalises the TOTAL height per
 * column across the whole document; it has no idea where physical page
 * breaks land. A column can hit the same grand total as its neighbours
 * while still wasting a big chunk of a specific page, because one of its
 * cards didn't fit in the space left on that page and (being atomic —
 * `.print-dense-section` never splits, so a category stays intact on one
 * physical sheet for dispatch) jumped whole to the next page, stranding
 * the leftover space on the page behind it with nothing to fill it.
 *
 * This simulates pagination directly instead: walks a page at a time and
 * tries to fill every column up to `pageCapacity` using FIRST-FIT over the
 * remaining items in their original relative order — i.e. it prefers the
 * next unplaced item, but if that item doesn't fit the column's remaining
 * space, it skips ahead to the next item that DOES fit. A smaller card
 * later in the list "backfills" the gap instead of leaving it empty.
 * Whatever still doesn't fit anywhere on the page carries to the next one.
 *
 * `firstPageCapacity` lets page 1 have a smaller budget than the rest —
 * e.g. to account for a brand header block that only prints once, at the
 * top of page 1, leaving less room for cards on that sheet specifically.
 *
 * Trade-off: cards are no longer guaranteed to render in strict input
 * order — a smaller later card can jump ahead of a larger earlier one to
 * plug a gap. Every card is still atomic (never split mid-card). Heights
 * and capacity are whatever unit the caller supplies — the picklist passes
 * REAL measured pixels from a hidden pre-render (see PrintRequestPicklist),
 * after two rounds of estimated "row unit" constants both drifted from the
 * browser's actual layout and broke the pagination in opposite directions.
 *
 *   const pages = paginateBalancedColumns(cards, c => heightOf(c), 3, 32, 21)
 *   // → pages[p][c] = the cards in column c on page p
 */
export function paginateBalancedColumns<T>(
  items: readonly T[],
  heightOf: (item: T) => number,
  numColumns: number,
  pageCapacity: number,
  firstPageCapacity: number = pageCapacity,
): T[][][] {
  const pool = items.map(item => ({ item, h: heightOf(item) }))
  const pages: T[][][] = []

  while (pool.length > 0) {
    const capacity = pages.length === 0 ? firstPageCapacity : pageCapacity
    const colUsed = new Array(numColumns).fill(0)
    const page: T[][] = Array.from({ length: numColumns }, () => [])

    let placedAny = true
    while (placedAny && pool.length > 0) {
      placedAny = false
      for (let c = 0; c < numColumns && pool.length > 0; c++) {
        const remaining = capacity - colUsed[c]
        if (remaining <= 0) continue
        const idx = pool.findIndex(p => p.h <= remaining)
        if (idx === -1) continue
        const [chosen] = pool.splice(idx, 1)
        page[c].push(chosen.item)
        colUsed[c] += chosen.h
        placedAny = true
      }
    }

    // Safety valve: an item taller than a whole page's capacity would
    // otherwise never satisfy `h <= remaining` and loop forever. Force it
    // onto the first column alone so pagination always makes progress.
    if (!page.some(col => col.length > 0) && pool.length > 0) {
      const [forced] = pool.splice(0, 1)
      page[0].push(forced.item)
    }

    pages.push(page)
  }

  return pages
}
