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
