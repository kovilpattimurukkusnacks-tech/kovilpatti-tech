// Generic two-level grouper used by the request detail / cart / picklist
// screens. Outer = category (alphabetical), inner = pack weight (unit asc,
// then numeric value asc). Items without a weight fall into a "No weight"
// bucket rendered last in their category.
//
// Callers supply a `pick` function so any item shape can be grouped — the
// shop request detail items, cart lines (where the weight lives on
// `line.product`), the cumulative-pending rows, etc.

export type WeightGroup<T>   = { label: string; items: T[] }
export type CategoryGroup<T> = { category: string; weightGroups: WeightGroup<T>[] }

export type GroupKey = {
  category: string
  weightValue: number | null
  weightUnit: string | null
}

const NONE = '__none__'
const NONE_LABEL = 'No weight'

export function groupByCategoryWeight<T>(
  items: T[],
  pick: (item: T) => GroupKey,
): CategoryGroup<T>[] {
  // Bucket by category first
  const byCategory = new Map<string, T[]>()
  for (const it of items) {
    const { category } = pick(it)
    const key = category || 'Uncategorised'
    const arr = byCategory.get(key)
    if (arr) arr.push(it)
    else byCategory.set(key, [it])
  }

  return Array.from(byCategory.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, catItems]) => {
      // Inside each category, bucket by (weightValue, weightUnit)
      const byWeight = new Map<string, T[]>()
      for (const it of catItems) {
        const { weightValue, weightUnit } = pick(it)
        const key = (weightValue != null && weightUnit)
          ? `${weightValue}|${weightUnit}`
          : NONE
        const arr = byWeight.get(key)
        if (arr) arr.push(it)
        else byWeight.set(key, [it])
      }
      const sortedKeys = Array.from(byWeight.keys()).sort((a, b) => {
        if (a === NONE) return 1
        if (b === NONE) return -1
        const [av, au] = a.split('|')
        const [bv, bu] = b.split('|')
        if (au !== bu) return au.localeCompare(bu)
        return Number(av) - Number(bv)
      })
      const weightGroups = sortedKeys.map(k => {
        if (k === NONE) return { label: NONE_LABEL, items: byWeight.get(k)! }
        const [v, u] = k.split('|')
        return { label: `${v} ${u}`, items: byWeight.get(k)! }
      })
      return { category, weightGroups }
    })
}
