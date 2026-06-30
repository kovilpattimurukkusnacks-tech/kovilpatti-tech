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
  const left: T[] = []
  const right: T[] = []
  let lH = 0
  let rH = 0
  for (const it of items) {
    const h = heightOf(it)
    if (lH <= rH) {
      left.push(it)
      lH += h
    } else {
      right.push(it)
      rH += h
    }
  }
  return { left, right }
}
